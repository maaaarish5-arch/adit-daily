"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RosterView from "./roster-view";
import CheckinView from "./checkin-view";
import LogsView from "./logs-view";
import {
  cleanEntries,
  coverageOf,
  UNKNOWN_COVERAGE,
  type Coverage,
} from "@/lib/checkin";
import { cleanRoster } from "@/lib/roster";
import {
  PLAYBOOKS,
  SECTIONS,
  TOTAL_TASKS,
  counterKey,
  counterValue,
  countDone,
  grade,
  isSectionSkipped,
  isTaskDone,
  outstanding,
  percent,
  pillKey,
  skippedNotes,
  slotKey,
  type Section,
  type SopBlock,
  type Task,
  type Ticks,
} from "@/lib/tasks";
import {
  SHIFTS,
  allShiftStates,
  duration,
  inKey,
  isCurrent,
  istTime,
  outKey,
  shiftReportLines,
  stampAt,
} from "@/lib/shifts";
import {
  dayNumber,
  daysInMonth,
  longDate,
  monthName,
  monthOf,
  parseKey,
  relativeLabel,
  shiftDays,
  todayKey,
  weekdayName,
} from "@/lib/date";

type MonthData = Record<string, { done: number; percent: number }>;
type SyncState = "idle" | "saving" | "saved" | "error";
type Tab = "today" | "checkin" | "students" | "logs" | "sop";

const PASSCODE_KEY = "adit-daily:passcode";

/* --------------------------------- SOP UI --------------------------------- */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="copy"
      data-copied={String(copied)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

function Creds({ label, user, pass }: { label: string; user: string; pass: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="creds">
      <span className="creds-label">{label}</span>
      <code>{user}</code>
      <code className="creds-pass">{shown ? pass : "••••••••"}</code>
      <button className="copy" onClick={() => setShown((s) => !s)}>
        {shown ? "Hide" : "Reveal"}
      </button>
    </div>
  );
}

function Sop({ blocks }: { blocks: SopBlock[] }) {
  return (
    <div className="sop">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "p":
            return <p key={i}>{block.text}</p>;
          case "steps":
            return (
              <ol key={i} className="sop-steps">
                {block.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ol>
            );
          case "script":
            return (
              <div key={i} className="script">
                <div className="script-head">
                  <span>{block.title}</span>
                  <CopyButton text={block.body} />
                </div>
                <pre>{block.body}</pre>
              </div>
            );
          case "link":
            return (
              <a
                key={i}
                className="sop-link"
                href={block.href}
                target="_blank"
                rel="noreferrer"
              >
                {block.label}
                <span>{block.href.replace(/^https?:\/\//, "")}</span>
              </a>
            );
          case "creds":
            return (
              <Creds key={i} label={block.label} user={block.user} pass={block.pass} />
            );
          case "warn":
            return (
              <p key={i} className="sop-warn">
                {block.text}
              </p>
            );
          case "pending":
            return (
              <p key={i} className="sop-pending">
                {block.text}
              </p>
            );
        }
      })}
    </div>
  );
}

/* -------------------------------- the page -------------------------------- */

export default function Page() {
  // `null` until mounted — the date comes from the device clock, so it cannot be
  // rendered on the server without a hydration mismatch.
  const [today, setToday] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>("today");
  const [ticks, setTicks] = useState<Ticks>({});
  const [notes, setNotes] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [sync, setSync] = useState<SyncState>("idle");
  const [locked, setLocked] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [month, setMonth] = useState<MonthData>({});
  const [report, setReport] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<Coverage>(UNKNOWN_COVERAGE);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---------------------- clock: keep the page on today ---------------------- */

  useEffect(() => {
    const k = todayKey();
    setToday(k);
    setDate(k);
    setPasscode(localStorage.getItem(PASSCODE_KEY) ?? "");

    const tick = () => {
      const now = todayKey();
      setToday((prev) => {
        // If the day rolled over while the page sat open on "today", follow it.
        if (prev && prev !== now) {
          setDate((d) => (d === prev ? now : d));
        }
        return now;
      });
    };
    const id = setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  /* ------------------------- presence heartbeat ----------------------------- */
  // A ping while the tab is open and visible. The server buckets these into
  // five-minute slots, which is what the Logs tab reads to show whether he was
  // actually on it between clocking in and clocking out.

  useEffect(() => {
    const ping = (kind?: string) => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind ? { kind } : { ping: true }),
        keepalive: true,
      }).catch(() => undefined);
    };
    ping("opened");
    const id = setInterval(() => ping(), 60_000);
    document.addEventListener("visibilitychange", () => ping());
    return () => clearInterval(id);
  }, []);

  /* ------------------------------- load a day ------------------------------- */

  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    setLoading(true);
    setReport(null);
    fetch(`/api/day?date=${date}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setStoreError(d.error ?? null);
        setTicks(d.ticks ?? {});
        setNotes(d.notes ?? "");
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSync("error");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  /* --------------------- the sweep, read off the check-in -------------------- */
  // This one row is not scored from the ticks. The roster says who is owed an
  // update and the day's check-in says who got one, so both are reloaded on
  // every tab change — otherwise the score sits stale while Adit ticks students.

  const loadCoverage = useCallback((forDate: string) => {
    Promise.all([
      fetch("/api/roster", { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/checkin?date=${forDate}`, { cache: "no-store" }).then((r) =>
        r.json()
      ),
    ])
      .then(([roster, checkin]) => {
        setCoverage(
          coverageOf(cleanRoster(roster?.students), cleanEntries(checkin?.entries))
        );
      })
      .catch(() => setCoverage(UNKNOWN_COVERAGE));
  }, []);

  useEffect(() => {
    if (!date) return;
    loadCoverage(date);
  }, [date, tab, loadCoverage]);

  const loadMonth = useCallback((m: string) => {
    fetch(`/api/month?month=${m}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setMonth(d.days ?? {}))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (date) loadMonth(monthOf(date));
  }, [date, loadMonth]);

  /* --------------------------------- saving --------------------------------- */

  const save = useCallback(
    (nextTicks: Ticks, nextNotes: string) => {
      if (!date) return;
      setSync("saving");
      fetch("/api/day", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-passcode": passcode },
        body: JSON.stringify({ date, ticks: nextTicks, notes: nextNotes }),
      })
        .then((r) => {
          if (r.status === 401) {
            setLocked(true);
            setSync("error");
            return;
          }
          if (!r.ok) throw new Error("save failed");
          setLocked(false);
          setSync("saved");
          loadMonth(monthOf(date));
        })
        .catch(() => setSync("error"));
    },
    [date, passcode, loadMonth]
  );

  const queueSave = useCallback(
    (nextTicks: Ticks, nextNotes: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save(nextTicks, nextNotes), 500);
    },
    [save]
  );

  /** Every mutation funnels through here so saving and report-clearing stay in one place. */
  const mutate = useCallback(
    (fn: (draft: Ticks) => void) => {
      setTicks((prev) => {
        const next = { ...prev };
        fn(next);
        queueSave(next, notes);
        return next;
      });
      setReport(null);
    },
    [notes, queueSave]
  );

  const toggle = useCallback(
    (key: string) => {
      mutate((draft) => {
        if (draft[key]) delete draft[key];
        else draft[key] = true;
      });
    },
    [mutate]
  );

  /** Stamp a follow-up slot with the time it was actually sent. */
  const stampSlot = useCallback(
    (key: string) => {
      mutate((draft) => {
        if (draft[key]) delete draft[key];
        else draft[key] = new Date().toISOString();
      });
    },
    [mutate]
  );

  const bumpCounter = useCallback(
    (key: string, delta: number) => {
      mutate((draft) => {
        const current = typeof draft[key] === "number" ? (draft[key] as number) : 0;
        const next = Math.max(0, Math.min(current + delta, 99));
        if (next === 0) delete draft[key];
        else draft[key] = next;
      });
    },
    [mutate]
  );

  /** The big box on the right of a row: fill the whole row, or clear it. */
  const toggleRow = useCallback(
    (task: Task) => {
      // The sweep closes itself off the check-in register. Nothing to toggle.
      if (task.coverage) return;
      const done = isTaskDone(task, ticks);
      mutate((draft) => {
        if (task.pills?.length) {
          for (const p of task.pills) {
            const key = pillKey(task, p);
            if (done) delete draft[key];
            else draft[key] = true;
          }
        } else if (task.slots?.length) {
          const stamp = new Date().toISOString();
          for (const s of task.slots) {
            const key = slotKey(task, s);
            if (done) delete draft[key];
            else if (!draft[key]) draft[key] = stamp;
          }
        } else if (task.counter) {
          const key = counterKey(task);
          if (done) delete draft[key];
          else draft[key] = task.counter.target;
        } else if (done) {
          delete draft[task.id];
        } else {
          draft[task.id] = true;
        }
      });
    },
    [mutate, ticks]
  );

  /** Stamp a clock-in or clock-out with the moment it was pressed, and write an
   *  entry to the append-only log. Clearing a stamp is logged as a removal —
   *  a mistake leaves a trace rather than vanishing. */
  const stamp = useCallback(
    (key: string, shift: string, edge: "in" | "out") => {
      let kind: string = edge;
      mutate((draft) => {
        if (draft[key]) {
          delete draft[key];
          kind = edge === "in" ? "cleared-in" : "cleared-out";
        } else {
          draft[key] = new Date().toISOString();
          kind = edge;
        }
      });
      fetch("/api/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, shift }),
      }).catch(() => undefined);
    },
    [mutate]
  );

  const onNotes = (value: string) => {
    setNotes(value);
    queueSave(ticks, value);
  };

  /* --------------------------------- derived -------------------------------- */

  const done = countDone(ticks, coverage);
  const pct = percent(ticks, coverage);
  const dayGrade = grade(ticks, coverage);
  const stillOpen = useMemo(
    () => outstanding(ticks, coverage),
    [ticks, coverage]
  );
  const skipped = useMemo(() => skippedNotes(ticks), [ticks]);

  const [bump, setBump] = useState(false);
  const prevGrade = useRef(dayGrade);
  useEffect(() => {
    if (prevGrade.current !== dayGrade) {
      prevGrade.current = dayGrade;
      setBump(true);
      const id = setTimeout(() => setBump(false), 450);
      return () => clearTimeout(id);
    }
  }, [dayGrade]);

  const buildReport = () => {
    if (!date) return;
    const lines = [
      `Founder's Office — ${longDate(date)}`,
      `Completed: ${done}/${TOTAL_TASKS} (${pct}%) — ${dayGrade} day`,
      `Shifts:\n${shiftReportLines(ticks).join("\n")}`,
      coverage.known
        ? `Student check-in: ${coverage.taken}/${coverage.total} active students${
            coverage.missing.length
              ? `\nNot reached:\n${coverage.missing.map((n) => `  · ${n}`).join("\n")}`
              : " — everyone reached."
          }`
        : "Student check-in: not loaded.",
      skipped.length ? `Not applicable:\n${skipped.map((s) => `  · ${s}`).join("\n")}` : null,
      stillOpen.length
        ? `Outstanding:\n${stillOpen.map((o) => `  · ${o}`).join("\n")}`
        : "Outstanding: nothing — full sweep.",
      `Notes: ${notes.trim() || "—"}`,
      "",
      "— Adit",
    ].filter(Boolean) as string[];
    setReport(lines.join("\n"));
    setCopied(false);
  };

  const copyReport = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  };

  const unlock = () => {
    localStorage.setItem(PASSCODE_KEY, passcode);
    setLocked(false);
    save(ticks, notes);
  };

  const stampLabel = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  /* --------------------------------- render --------------------------------- */

  if (!date || !today) {
    return (
      <main className="shell">
        <p className="skeleton">Reading the clock…</p>
      </main>
    );
  }

  const rel = relativeLabel(date, today);
  const isPast = parseKey(date) < parseKey(today);
  const currentMonth = monthOf(date);
  const monthDays = daysInMonth(currentMonth);
  const leading = parseKey(monthDays[0]).getDay();

  let rowIndex = 0;

  const renderTask = (task: Task, section: Section) => {
    rowIndex += 1;
    const sectionSkipped = isSectionSkipped(section, ticks);
    const isDone = isTaskDone(task, ticks, coverage);
    const count = task.counter ? counterValue(task, ticks) : 0;
    const partial =
      !isDone &&
      (Boolean(task.pills?.some((p) => ticks[pillKey(task, p)])) ||
        Boolean(task.slots?.some((s) => ticks[slotKey(task, s)])) ||
        count > 0);
    const sopOpen = Boolean(open[task.id]);

    return (
      <div
        className="row"
        key={task.id}
        data-done={String(isDone)}
        data-muted={String(sectionSkipped)}
      >
        <span className="row-index">{String(rowIndex).padStart(2, "0")}</span>

        <div>
          <div className="row-label">
            {task.label}
            <span className="strike" />
          </div>
          {task.detail && <p className="row-detail">{task.detail}</p>}

          {task.pills && (
            <div className="pills">
              {task.pills.map((p) => {
                const key = pillKey(task, p);
                return (
                  <button
                    key={p.id}
                    className="pill"
                    data-on={String(Boolean(ticks[key]))}
                    onClick={() => toggle(key)}
                    aria-pressed={Boolean(ticks[key])}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          )}

          {task.slots && (
            <div className="pills">
              {task.slots.map((s) => {
                const key = slotKey(task, s);
                const at = stampLabel(ticks[key]);
                return (
                  <button
                    key={s.id}
                    className="pill"
                    data-on={String(Boolean(ticks[key]))}
                    onClick={() => stampSlot(key)}
                    aria-pressed={Boolean(ticks[key])}
                    title={at ? `Sent at ${at}` : "Tap when you send it"}
                  >
                    {s.label}
                    {at && <b>{at}</b>}
                  </button>
                );
              })}
            </div>
          )}

          {task.coverage && (
            <div className="sweep">
              <div className="sweep-head">
                <span className="sweep-read" data-on={String(isDone)}>
                  {coverage.taken}
                  <i>/{coverage.total}</i>
                </span>
                <span className="sweep-noun">
                  {coverage.known
                    ? "active students ticked"
                    : "reading the roster…"}
                </span>
                <button className="pill" onClick={() => setTab("checkin")}>
                  Open check-in
                </button>
              </div>
              <div className="sweep-bar">
                <i
                  style={{
                    width: `${coverage.total ? (coverage.taken / coverage.total) * 100 : 0}%`,
                  }}
                />
              </div>
              {coverage.known && coverage.missing.length > 0 && (
                <p className="sweep-missing">
                  <b>Not yet reached:</b> {coverage.missing.slice(0, 10).join(", ")}
                  {coverage.missing.length > 10
                    ? ` · and ${coverage.missing.length - 10} more`
                    : ""}
                </p>
              )}
            </div>
          )}

          {task.counter && (
            <div className="counter">
              <button
                onClick={() => bumpCounter(counterKey(task), -1)}
                aria-label="One fewer sweep"
                disabled={count === 0}
              >
                −
              </button>
              <span className="counter-read" data-on={String(isDone)}>
                {count}
                <i>/{task.counter.target}</i>
              </span>
              <button
                onClick={() => bumpCounter(counterKey(task), 1)}
                aria-label="Log a sweep"
              >
                +
              </button>
              <span className="counter-noun">{task.counter.noun}</span>
            </div>
          )}

          {task.sop && (
            <>
              <button
                className="sop-toggle"
                data-open={String(sopOpen)}
                onClick={() => setOpen((o) => ({ ...o, [task.id]: !o[task.id] }))}
                aria-expanded={sopOpen}
              >
                {sopOpen ? "Hide how" : "How to do this"}
              </button>
              {sopOpen && <Sop blocks={task.sop} />}
            </>
          )}
        </div>

        <button
          className="box"
          data-on={String(isDone)}
          data-partial={String(partial)}
          onClick={() => toggleRow(task)}
          disabled={Boolean(task.coverage)}
          aria-pressed={isDone}
          title={
            task.coverage
              ? "Closes itself once every active student is ticked on the check-in"
              : undefined
          }
          aria-label={
            task.coverage
              ? `${task.label} — ${coverage.taken} of ${coverage.total} ticked`
              : `Mark "${task.label}" ${isDone ? "not done" : "done"}`
          }
        >
          <svg viewBox="0 0 24 24">
            <polyline points="4,12 10,18 20,6" />
          </svg>
        </button>
      </div>
    );
  };

  return (
    <main className="shell">
      <header className="masthead">
        <div className="wordmark">
          <b>USMLE Vault</b> &nbsp;·&nbsp; Founder&rsquo;s Office &nbsp;·&nbsp; Adit
        </div>
        <div className="masthead-right">
          <span>
            <span className="sync-dot" data-state={sync} />
            {sync === "saving"
              ? "Saving"
              : sync === "error"
                ? "Not saved"
                : sync === "saved"
                  ? "Saved"
                  : "Synced"}
          </span>
          <span>{TOTAL_TASKS} tasks · 75% = A+</span>
        </div>
      </header>

      <nav className="tabs">
        <button data-on={String(tab === "today")} onClick={() => setTab("today")}>
          Today
        </button>
        <button
          data-on={String(tab === "checkin")}
          onClick={() => setTab("checkin")}
        >
          Check-in
        </button>
        <button
          data-on={String(tab === "students")}
          onClick={() => setTab("students")}
        >
          Students
        </button>
        <button data-on={String(tab === "logs")} onClick={() => setTab("logs")}>
          Time logs
        </button>
        <button data-on={String(tab === "sop")} onClick={() => setTab("sop")}>
          SOP
        </button>
      </nav>

      {storeError && (
        <div className="lock" style={{ marginTop: "1.25rem" }}>
          <span>Storage not connected — ticks will not save yet</span>
        </div>
      )}

      {tab === "logs" ? (
        <LogsView />
      ) : tab === "checkin" ? (
        <CheckinView />
      ) : tab === "students" ? (
        <RosterView />
      ) : tab === "sop" ? (
        /* ---------------------------- the manual ---------------------------- */
        <div className="manual">
          <blockquote className="note">
            <span className="note-label">The manual</span>
            <p>
              Everything on the checklist, and how it is actually done. Read it
              once cold. After that, reach for the piece you need mid-conversation
              — every script here is copy-and-send.
            </p>
          </blockquote>

          {PLAYBOOKS.map((pb) => (
            <section className="section" key={pb.id}>
              <div className="section-head">
                <h2>{pb.title}</h2>
                <span className="hair" />
              </div>
              <p className="playbook-blurb">{pb.blurb}</p>
              <Sop blocks={pb.blocks} />
            </section>
          ))}

          {SECTIONS.map((section) => (
            <section className="section" key={section.id}>
              <div className="section-head">
                <h2>{section.title}</h2>
                <span className="hair" />
              </div>
              {section.tasks.map((task) => (
                <div className="manual-entry" key={task.id}>
                  <h3>{task.label}</h3>
                  {task.detail && <p className="row-detail">{task.detail}</p>}
                  {task.sop ? (
                    <Sop blocks={task.sop} />
                  ) : (
                    <p className="row-detail">No procedure beyond the row itself.</p>
                  )}
                </div>
              ))}
            </section>
          ))}
        </div>
      ) : (
        /* --------------------------- the checklist --------------------------- */
        <div className="columns">
          <aside className="rail">
            <div className="weekday">{weekdayName(date)}</div>
            <div className="daynum">
              {dayNumber(date)}
              <small>
                {monthName(date)}
                <br />
                {date.slice(0, 4)}
              </small>
            </div>
            {rel ? (
              <span className="relative-tag" data-past={String(rel !== "Today")}>
                {rel}
              </span>
            ) : (
              <span className="relative-tag" data-past="true">
                {isPast ? "Past day" : "Upcoming"}
              </span>
            )}

            <section className="score">
              <div className="score-row">
                <div className="score-num">
                  {pct}
                  <i>%</i>
                </div>
                <div
                  className={`stamp${bump ? " bump" : ""}`}
                  data-grade={dayGrade}
                  title={`${dayGrade} day`}
                >
                  {dayGrade}
                </div>
              </div>
              <div className="meter">
                <div
                  className="meter-fill"
                  data-grade={dayGrade}
                  style={{ width: `${pct}%` }}
                />
                <div className="meter-mark" title="75% — A+ threshold" />
              </div>
              <div className="score-legend">
                <span>
                  {done} of {TOTAL_TASKS} done
                </span>
                <span>{dayGrade === "A+" ? "A+ day" : "C- day"}</span>
              </div>
            </section>

            <nav className="daynav">
              <button onClick={() => setDate(shiftDays(date, -1))}>← Prev</button>
              <button onClick={() => setDate(today)} disabled={date === today}>
                Today
              </button>
              <button onClick={() => setDate(shiftDays(date, 1))}>Next →</button>
            </nav>

            <section className="month">
              <div className="month-head">
                <span>
                  {monthName(date)} {date.slice(0, 4)}
                </span>
                <span>
                  {Object.values(month).filter((d) => d.percent >= 75).length} A+
                </span>
              </div>
              <div className="month-grid">
                {Array.from({ length: leading }).map((_, i) => (
                  <span key={`pad-${i}`} />
                ))}
                {monthDays.map((key) => {
                  const data = month[key];
                  const g = data ? (data.percent >= 75 ? "A+" : "C-") : "none";
                  return (
                    <button
                      key={key}
                      className="month-cell"
                      data-selected={String(key === date)}
                      data-today={String(key === today)}
                      data-grade={g}
                      onClick={() => setDate(key)}
                      title={
                        data
                          ? `${key} — ${data.done}/${TOTAL_TASKS} (${data.percent}%)`
                          : `${key} — no entry`
                      }
                    >
                      {dayNumber(key)}
                      <span className="pip" />
                    </button>
                  );
                })}
              </div>
            </section>
          </aside>

          <div>
            <section className="clock">
              <div className="clock-head">
                <h3>Clock</h3>
                <span className="hair" />
                <span className="clock-note">All times IST</span>
              </div>
              <div className="shifts">
                {allShiftStates(ticks).map((st) => {
                  const live = date === today && isCurrent(st.shift);
                  return (
                    <div
                      className="shift"
                      key={st.shift.id}
                      data-open={String(st.open)}
                      data-live={String(live)}
                      data-done={String(Boolean(st.out))}
                    >
                      <div className="shift-top">
                        <b>{st.shift.label}</b>
                        <span className="shift-window">{st.shift.window}</span>
                        {live && <span className="shift-live">Now</span>}
                      </div>

                      <div className="shift-stamps">
                        <span data-set={String(Boolean(st.in))}>
                          In {st.in ? istTime(st.in) : "—"}
                          {st.lateBy > 0 && (
                            <i className="late"> {st.lateBy}m late</i>
                          )}
                        </span>
                        <span data-set={String(Boolean(st.out))}>
                          Out {st.out ? istTime(st.out) : "—"}
                        </span>
                        {st.workedMin !== null && (
                          <span className="worked">{duration(st.workedMin)}</span>
                        )}
                      </div>

                      <div className="shift-actions">
                        <button
                          className="btn"
                          data-on={String(Boolean(st.in))}
                          onClick={() => stamp(inKey(st.shift), st.shift.id, "in")}
                        >
                          {st.in ? "Clear in" : "Clock in"}
                        </button>
                        <button
                          className="btn ghost"
                          disabled={!st.in}
                          onClick={() => stamp(outKey(st.shift), st.shift.id, "out")}
                        >
                          {st.out ? "Clear out" : "Clock out"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <blockquote className="note">
              <span className="note-label">How this list is worked</span>
              <p>
                Every item here is done <em>by hand</em>, on purpose. Automation
                reads fast and skims — it will clear forty-seven messages and
                quietly miss the one student who needed us that day. Then it gets
                redone manually anyway, which defeats the point. Your eyes on every
                inbox <em>is</em> the work.
              </p>
            </blockquote>

            {loading ? (
              <p className="skeleton">Loading {longDate(date)}…</p>
            ) : (
              SECTIONS.map((section, si) => {
                const sectionSkipped = isSectionSkipped(section, ticks);
                const sectionDone = section.tasks.filter((t) =>
                  isTaskDone(t, ticks)
                ).length;
                return (
                  <section
                    className="section"
                    key={section.id}
                    data-skipped={String(sectionSkipped)}
                    style={{ animationDelay: `${si * 70}ms` }}
                  >
                    <div className="section-head">
                      <h2>{section.title}</h2>
                      <span className="hair" />
                      {section.skip && (
                        <button
                          className="skip"
                          data-on={String(sectionSkipped)}
                          onClick={() => toggle(section.skip!.id)}
                          aria-pressed={sectionSkipped}
                        >
                          {section.skip.label}
                        </button>
                      )}
                      <span
                        className="tally"
                        data-complete={String(sectionDone === section.tasks.length)}
                      >
                        {sectionDone}/{section.tasks.length}
                      </span>
                    </div>

                    {section.tasks.map((task) => renderTask(task, section))}
                  </section>
                );
              })
            )}

            <section className="closeout">
              <h3>Daily close-out</h3>
              <p className="hint">
                Generate the report, copy it, send it to Dr. Marish. Then tick
                &ldquo;Daily report sent&rdquo; above.
              </p>

              {/* Catch an unclocked or still-open shift before the day is closed,
                  rather than reporting the gap to Dr. Marish afterwards. */}
              {(() => {
                const states = allShiftStates(ticks);
                const missing = states.filter((st) => !st.in);
                const open = states.filter((st) => st.open);
                if (!missing.length && !open.length) return null;
                return (
                  <div className="clock-warn">
                    {missing.map((st) => (
                      <p key={`m-${st.shift.id}`}>
                        <b>{st.shift.label} shift never clocked in</b> — {st.shift.window}.
                        If you worked it, stamp it at the top of the page before you
                        send this. If you didn&rsquo;t, say why in the notes.
                      </p>
                    ))}
                    {open.map((st) => (
                      <p key={`o-${st.shift.id}`}>
                        <b>{st.shift.label} shift is still open</b> — clocked in at{" "}
                        {st.in ? istTime(st.in) : "—"} with no clock-out. Close it before
                        you send the report.
                      </p>
                    ))}
                  </div>
                );
              })()}

              <label htmlFor="notes">Anything Dr. Marish should know</label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => onNotes(e.target.value)}
                placeholder="Students who need him, payment flags, anything odd…"
              />

              <div className="actions">
                <button className="btn" onClick={buildReport}>
                  Generate daily report
                </button>
                {report && (
                  <button className="btn ghost" onClick={copyReport}>
                    {copied ? "Copied ✓" : "Copy to clipboard"}
                  </button>
                )}
              </div>

              {report && (
                <div className="report">
                  <pre>{report}</pre>
                </div>
              )}
            </section>

            {locked && (
              <div className="lock">
                <span>Enter your 4-digit PIN to save</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  value={passcode}
                  onChange={(e) =>
                    setPasscode(e.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  onKeyDown={(e) => e.key === "Enter" && unlock()}
                  placeholder="0000"
                  autoFocus
                />
                <button className="btn" onClick={unlock}>
                  Unlock
                </button>
              </div>
            )}

            <footer className="footer">
              <span>{longDate(date)}</span>
              <span>≥75% A+ day · below 75% C- day</span>
            </footer>
          </div>
        </div>
      )}
    </main>
  );
}
