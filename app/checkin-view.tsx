"use client";


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DND_CHOICES,
  DND_MAX_DAYS,
  MONTHS,
  PHASES,
  PHASE_LABELS,
  PHASE_PRIORITY,
  PHASE_TAGS,
  currentPhase,
  longDay,
  phase1DaysLeft,
  phaseName,
  today,
  type Phase,
  type Student,
} from "@/lib/roster";
import {
  BANDS,
  activeRows,
  buildRows,
  entryFor,
  owedRows,
  rankOf,
  takenCount,
  type Entries,
  type Row,
} from "@/lib/checkin";
import { longDate, shiftDays, todayKey } from "@/lib/date";

type SyncState = "idle" | "saving" | "saved" | "error";

const PASSCODE_KEY = "adit-daily:passcode";

export default function CheckinView() {
  const [date, setDate] = useState<string | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [entries, setEntries] = useState<Entries>({});
  const [loading, setLoading] = useState(true);
  const [sync, setSync] = useState<SyncState>("idle");
  const [storeError, setStoreError] = useState<string | null>(null);

  const [month, setMonth] = useState("all");
  const [phase, setPhase] = useState("all");
  const [openOnly, setOpenOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  /** The student whose DND length picker is open, if any. */
  const [dndOpen, setDndOpen] = useState<string | null>(null);
  /** What is typed in the picker's custom "__ days" box. */
  const [dndDays, setDndDays] = useState("");

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDate(todayKey()), []);

  /* -------------------------------- loading -------------------------------- */

  const loadRoster = useCallback(() => {
    fetch("/api/roster", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setStudents(d.students ?? []))
      .catch(() => undefined);
  }, []);

  const loadDay = useCallback((d: string, initial = false) => {
    fetch(`/api/checkin?date=${d}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((doc) => {
        setStoreError(doc.error ?? null);
        // Never clobber something being typed right now.
        if (!pending.current) setEntries(doc.entries ?? {});
        if (initial) setLoading(false);
      })
      .catch(() => {
        if (initial) setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadRoster();
  }, [loadRoster]);

  useEffect(() => {
    if (!date) return;
    setLoading(true);
    pending.current = false;
    loadDay(date, true);
  }, [date, loadDay]);

  // Two-way: pick up the other person's ticks without a reload.
  useEffect(() => {
    if (!date) return;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      if (pending.current) return;
      const active = document.activeElement;
      if (active && rootRef.current?.contains(active)) return;
      loadDay(date);
      loadRoster();
    };
    const id = setInterval(refresh, 15_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [date, loadDay, loadRoster]);

  /* -------------------------------- saving --------------------------------- */

  const save = useCallback((d: string, next: Entries) => {
    setSync("saving");
    fetch("/api/checkin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-passcode": localStorage.getItem(PASSCODE_KEY) ?? "",
      },
      body: JSON.stringify({ date: d, entries: next }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("save failed");
        pending.current = false;
        setSync("saved");
      })
      .catch(() => setSync("error"));
  }, []);

  const patch = useCallback(
    (id: string, next: Partial<{ c: boolean; n: string }>) => {
      if (!date) return;
      setEntries((prev) => {
        const current = prev[id] ?? { c: false, n: "" };
        const merged = { ...prev, [id]: { ...current, ...next } };
        pending.current = true;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => save(date, merged), 500);
        return merged;
      });
    },
    [date, save]
  );

  // Phase and DND live on the roster, not the day. Re-read the roster first
  // and change only this one student, so a stale copy here never overwrites an
  // edit made on the Students tab in the meantime.
  const patchStudent = useCallback(async (id: string, change: Partial<Student>) => {
    const patchOne = (list: Student[]) =>
      list.map((s) => (s.id === id ? { ...s, ...change } : s));
    setStudents(patchOne);
    setSync("saving");
    try {
      const fresh = await fetch("/api/roster", { cache: "no-store" }).then((r) => r.json());
      if (!Array.isArray(fresh.students)) throw new Error("roster unavailable");
      const next = patchOne(fresh.students);
      const r = await fetch("/api/roster", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-passcode": localStorage.getItem(PASSCODE_KEY) ?? "",
        },
        body: JSON.stringify({ students: next }),
      });
      if (!r.ok) throw new Error("save failed");
      setStudents(next);
      setSync("saved");
    } catch {
      setSync("error");
      loadRoster();
    }
  }, [loadRoster]);

  // Setting Phase 1 restarts its two-week clock from today.
  const changePhase = (id: string, p: Phase) =>
    patchStudent(id, { phase: p, phaseSince: today() });

  // DND starts on the day being viewed and ends by itself after `days` days.
  const startDnd = (id: string, days: number) => {
    if (!date) return;
    setDndOpen(null);
    setDndDays("");
    patchStudent(id, { dndFrom: date, dndUntil: shiftDays(date, days) });
  };

  // Ending early keeps the days already spent on DND, so past check-ins still
  // read right; ending on the first day removes it altogether.
  const endDnd = (s: Student) => {
    if (!date) return;
    patchStudent(
      s.id,
      date <= s.dndFrom ? { dndFrom: "", dndUntil: "" } : { dndUntil: date }
    );
  };

  /* -------------------------------- derived -------------------------------- */

  const allRows = useMemo(
    () => buildRows(students, entries, date ?? ""),
    [students, entries, date]
  );
  // The day is about Active students only. Completed, Paused, Left and removed
  // students stay out of the list, the bar and the copy — until their name is
  // searched, so a status can still be looked up. Students on DND stay in the
  // list, in their own band, but out of the bar and the count.
  const listed = useMemo(() => activeRows(allRows), [allRows]);
  const rows = useMemo(() => owedRows(allRows), [allRows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? allRows : listed).filter((r) => {
      if (month !== "all" && r.month !== month) return false;
      if (phase !== "all" && (r.status !== "Active" || String(currentPhase(r)) !== phase))
        return false;
      if (openOnly && entryFor(entries, r.id).c) return false;
      if (q && !`${r.name} ${entryFor(entries, r.id).n}`.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [allRows, listed, entries, month, phase, openOnly, query]);

  const taken = takenCount(rows, entries);
  const total = rows.length;
  const pct = total ? Math.round((taken / total) * 100) : 0;

  const copyDay = async () => {
    if (!date) return;
    const done = rows.filter((r) => entryFor(entries, r.id).c);
    const missed = rows.filter((r) => !entryFor(entries, r.id).c);
    const quiet = listed.filter((r) => r.dnd);
    const text = [
      `Daily check-in — ${longDate(date)}`,
      `Updates taken: ${taken}/${total} (${pct}%)`,
      "",
      "Taken:",
      ...(done.length
        ? done.map((r) => {
            const n = entryFor(entries, r.id).n.trim();
            return `  · ${r.name} (${PHASE_TAGS[currentPhase(r)]})${n ? ` — ${n}` : ""}`;
          })
        : ["  —"]),
      "",
      "Not yet reached:",
      ...(missed.length ? missed.map((r) => `  · ${r.name} (${PHASE_TAGS[currentPhase(r)]})`) : ["  — nobody"]),
      ...(quiet.length
        ? [
            "",
            "On DND (no update owed):",
            ...quiet.map((r) => `  · ${r.name} — back ${longDay(r.dndUntil)}`),
          ]
        : []),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  };

  if (!date) return <p className="skeleton">Reading the clock…</p>;

  const isToday = date === todayKey();
  let lastRank = -1;

  return (
    <div className="checkin" ref={rootRef}>
      <div className="roster-head">
        <div>
          <h2>Daily check-in</h2>
          <p className="hint">
            Who we actually took an update from today, and what came out of it.
            Adit ticks, Dr. Marish sees the same day.
          </p>
        </div>
        <span className="roster-sync">
          <span className="sync-dot" data-state={sync} />
          {sync === "saving"
            ? "Saving"
            : sync === "error"
              ? "Not saved"
              : sync === "saved"
                ? "Saved"
                : "Synced"}
        </span>
      </div>

      {storeError && (
        <div className="lock">
          <span>Storage not connected — check-ins will not save</span>
        </div>
      )}

      <div className="checkin-bar">
        <button className="btn ghost" onClick={() => setDate(shiftDays(date, -1))}>
          ← Prev
        </button>
        <input
          type="date"
          defaultValue={date}
          key={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          aria-label="Check-in date"
        />
        <button className="btn ghost" onClick={() => setDate(shiftDays(date, 1))}>
          Next →
        </button>
        {!isToday && (
          <button className="btn ghost" onClick={() => setDate(todayKey())}>
            Today
          </button>
        )}
        <span className="checkin-date">{longDate(date)}</span>
      </div>

      {/* one tick per student — the day at a glance */}
      <div className="pulse">
        <div className="pulse-strip">
          {rows.map((r) => (
            <i
              key={r.id}
              className="tick"
              data-on={entryFor(entries, r.id).c ? "1" : "0"}
              title={r.name}
            />
          ))}
        </div>
        <div className="pulse-read">
          <span>
            <b>{taken}</b> of {total} updates taken
          </span>
          <span>{pct}%</span>
        </div>
      </div>

      <div className="filters">
        <input
          className="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search any student by name…"
        />
        <select value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value="all">All months</option>
          {MONTHS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <select
          className="pay-filter"
          data-on={String(phase !== "all")}
          value={phase}
          onChange={(e) => setPhase(e.target.value)}
          aria-label="Filter by phase"
        >
          <option value="all">All phases</option>
          {PHASE_PRIORITY.map((p) => (
            <option key={p} value={String(p)}>
              {phaseName(p)}
            </option>
          ))}
        </select>
        <button
          className="btn ghost"
          data-on={String(openOnly)}
          onClick={() => setOpenOnly((v) => !v)}
        >
          {openOnly ? "Showing outstanding" : "Show outstanding only"}
        </button>
        <button className="btn" onClick={copyDay}>
          {copied ? "Copied ✓" : "Copy the day"}
        </button>
      </div>

      {loading ? (
        <p className="skeleton">Loading {longDate(date)}…</p>
      ) : total === 0 && !query.trim() ? (
        <p className="empty">
          No active students right now. Add students in the <b>Students</b> tab,
          or search a name to find someone who is Completed, Paused or Left.
        </p>
      ) : visible.length === 0 ? (
        <p className="empty">
          {openOnly
            ? "Everyone has been reached. That's the whole roster done."
            : "No one matches that — on any status. Clear the search or switch months or phases."}
        </p>
      ) : (
        visible.map((r: Row) => {
          const e = entryFor(entries, r.id);
          const rank = rankOf(r);
          let band = null;
          if (rank !== lastRank && BANDS[rank]) {
            const n = visible.filter((x) => rankOf(x) === rank).length;
            band = (
              <div className={`band ${BANDS[rank].cls}`} key={`band-${rank}`}>
                {BANDS[rank].label} <b>{n}</b>
              </div>
            );
          }
          lastRank = rank;

          return (
            <div key={r.id}>
              {band}
              <div
                className="checkin-row"
                data-on={String(e.c)}
                data-archived={String(Boolean(r.archived))}
              >
                <button
                  className="box"
                  data-on={String(e.c)}
                  aria-pressed={e.c}
                  aria-label={`Mark ${r.name} as taken`}
                  onClick={() => patch(r.id, { c: !e.c })}
                >
                  <svg viewBox="0 0 24 24">
                    <polyline points="4,12 10,18 20,6" />
                  </svg>
                </button>

                <div className="who">
                  <div className="nm">{r.name}</div>
                  <div className="meta">
                    {r.status === "Active" && !r.archived && (() => {
                      const p = currentPhase(r);
                      const left = phase1DaysLeft(r);
                      return (
                        <span
                          className="phase-toggle phase-edit"
                          role="radiogroup"
                          aria-label={`Phase for ${r.name}`}
                          title={`${phaseName(p)}${left !== null ? ` — moves to Phase 2 in ${left}d` : ""}`}
                        >
                          {PHASES.map((x) => (
                            <button
                              key={x}
                              role="radio"
                              aria-checked={p === x}
                              data-phase={x}
                              data-on={String(p === x)}
                              onClick={() => p !== x && changePhase(r.id, x)}
                            >
                              {PHASE_TAGS[x]}
                            </button>
                          ))}
                          <i className="phase-name">
                            {p === 4
                              ? r.examDate
                                ? `Exam ${longDay(r.examDate)}`
                                : "Exam date not set"
                              : PHASE_LABELS[p]}
                            {left !== null && ` · ${left}d left`}
                          </i>
                        </span>
                      );
                    })()}
                    {r.month}
                    {r.archived ? (
                      <span className="archived"> · no longer on the tracker</span>
                    ) : r.status !== "Active" ? (
                      <span className="flag"> · {r.status}</span>
                    ) : null}
                  </div>
                  {r.status === "Active" && !r.archived && (
                    <div className="dnd" data-on={String(Boolean(r.dnd))}>
                      {r.dnd ? (
                        <>
                          <span className="dnd-tag">DND</span>
                          <span>Don&rsquo;t message · back {longDay(r.dndUntil)}</span>
                          <button onClick={() => endDnd(r)}>End DND</button>
                        </>
                      ) : dndOpen === r.id ? (
                        <>
                          <span>Do not disturb for</span>
                          {DND_CHOICES.map((n) => (
                            <button key={n} onClick={() => startDnd(r.id, n)}>
                              {n} day{n === 1 ? "" : "s"}
                            </button>
                          ))}
                          {(() => {
                            const n = Math.floor(Number(dndDays));
                            const ok = n >= 1 && n <= DND_MAX_DAYS;
                            return (
                              <span className="dnd-custom">
                                <span>or</span>
                                <input
                                  className="dnd-days"
                                  type="number"
                                  min={1}
                                  max={DND_MAX_DAYS}
                                  value={dndDays}
                                  onChange={(e) => setDndDays(e.target.value)}
                                  onKeyDown={(e) => e.key === "Enter" && ok && startDnd(r.id, n)}
                                  placeholder="__"
                                  aria-label={`Number of DND days for ${r.name}`}
                                />
                                <span>days</span>
                                {ok && <span className="dnd-back">back {longDay(shiftDays(date, n))}</span>}
                                <button disabled={!ok} onClick={() => startDnd(r.id, n)}>
                                  Set
                                </button>
                              </span>
                            );
                          })()}
                          <button className="dnd-cancel" onClick={() => setDndOpen(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button onClick={() => setDndOpen(r.id)}>DND</button>
                      )}
                    </div>
                  )}
                </div>

                <input
                  className="note"
                  value={e.n}
                  onChange={(ev) => patch(r.id, { n: ev.target.value })}
                  placeholder="What came out of the update…"
                  aria-label={`Note for ${r.name}`}
                />
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
