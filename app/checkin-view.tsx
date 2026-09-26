"use client";


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MONTHS, type Student } from "@/lib/roster";
import {
  BANDS,
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
  const [openOnly, setOpenOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);

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

  /* -------------------------------- derived -------------------------------- */

  const allRows = useMemo(() => buildRows(students, entries), [students, entries]);
  // The day is about Active students only. Completed, Paused, Left and removed
  // students stay out of the list, the bar and the copy — until their name is
  // searched, so a status can still be looked up.
  const rows = useMemo(() => owedRows(allRows), [allRows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? allRows : rows).filter((r) => {
      if (month !== "all" && r.month !== month) return false;
      if (openOnly && entryFor(entries, r.id).c) return false;
      if (q && !`${r.name} ${entryFor(entries, r.id).n}`.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [allRows, rows, entries, month, openOnly, query]);

  const taken = takenCount(rows, entries);
  const total = rows.length;
  const pct = total ? Math.round((taken / total) * 100) : 0;

  const copyDay = async () => {
    if (!date) return;
    const done = rows.filter((r) => entryFor(entries, r.id).c);
    const missed = rows.filter((r) => !entryFor(entries, r.id).c);
    const text = [
      `Daily check-in — ${longDate(date)}`,
      `Updates taken: ${taken}/${total} (${pct}%)`,
      "",
      "Taken:",
      ...(done.length
        ? done.map((r) => {
            const n = entryFor(entries, r.id).n.trim();
            return `  · ${r.name}${n ? ` — ${n}` : ""}`;
          })
        : ["  —"]),
      "",
      "Not yet reached:",
      ...(missed.length ? missed.map((r) => `  · ${r.name}`) : ["  — nobody"]),
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
            : "No one matches that — on any status. Clear the search or switch months."}
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
                    {r.month}
                    {r.archived ? (
                      <span className="archived"> · no longer on the tracker</span>
                    ) : r.status !== "Active" ? (
                      <span className="flag"> · {r.status}</span>
                    ) : null}
                  </div>
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
