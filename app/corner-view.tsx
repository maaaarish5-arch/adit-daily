"use client";

// One person's corner — their checklist, clock, grade, month and close-out.
// Same layout as Today, but every day is stored per person (/api/corner), so
// the three corners never share ticks or scores with each other or with Today.

import { useCallback, useEffect, useRef, useState } from "react";
import { Sop } from "./sop";
import {
  clockKey,
  cornerClockLines,
  cornerScore,
  cornerShiftStates,
  cornerSplit,
  isCornerSectionSkipped,
  isCornerTaskDone,
  type Corner,
} from "@/lib/corners";
import {
  counterKey,
  counterValue,
  pillKey,
  slotKey,
  type Section,
  type Task,
  type Ticks,
} from "@/lib/tasks";
import { duration, istTime } from "@/lib/shifts";
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

const PASSCODE_KEY = "adit-daily:passcode";

export default function CornerView({ corner }: { corner: Corner }) {
  const [today, setToday] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
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

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const k = todayKey();
    setToday(k);
    setDate(k);
    setPasscode(localStorage.getItem(PASSCODE_KEY) ?? "");
  }, []);

  /* ------------------------------- load a day ------------------------------- */

  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    setLoading(true);
    setReport(null);
    fetch(`/api/corner?person=${corner.id}&date=${date}`, { cache: "no-store" })
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
  }, [date, corner.id]);

  const loadMonth = useCallback(
    (m: string) => {
      fetch(`/api/corner/month?person=${corner.id}&month=${m}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => setMonth(d.days ?? {}))
        .catch(() => undefined);
    },
    [corner.id]
  );

  useEffect(() => {
    if (date) loadMonth(monthOf(date));
  }, [date, loadMonth]);

  /* --------------------------------- saving --------------------------------- */

  const save = useCallback(
    (nextTicks: Ticks, nextNotes: string) => {
      if (!date) return;
      setSync("saving");
      fetch("/api/corner", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-passcode": passcode },
        body: JSON.stringify({ person: corner.id, date, ticks: nextTicks, notes: nextNotes }),
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
    [date, passcode, corner.id, loadMonth]
  );

  const queueSave = useCallback(
    (nextTicks: Ticks, nextNotes: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save(nextTicks, nextNotes), 500);
    },
    [save]
  );

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

  const toggle = (key: string) =>
    mutate((draft) => {
      if (draft[key]) delete draft[key];
      else draft[key] = true;
    });

  /** Slots and clock stamps both record the moment they were tapped. */
  const stamp = (key: string) =>
    mutate((draft) => {
      if (draft[key]) delete draft[key];
      else draft[key] = new Date().toISOString();
    });

  const bumpCounter = (key: string, delta: number) =>
    mutate((draft) => {
      const current = typeof draft[key] === "number" ? (draft[key] as number) : 0;
      const next = Math.max(0, Math.min(current + delta, 99));
      if (next === 0) delete draft[key];
      else draft[key] = next;
    });

  const toggleRow = (task: Task) => {
    const done = isCornerTaskDone(corner, task, ticks);
    mutate((draft) => {
      if (task.pills?.length) {
        for (const p of task.pills) {
          if (done) delete draft[pillKey(task, p)];
          else draft[pillKey(task, p)] = true;
        }
      } else if (task.slots?.length) {
        const at = new Date().toISOString();
        for (const s of task.slots) {
          const key = slotKey(task, s);
          if (done) delete draft[key];
          else if (!draft[key]) draft[key] = at;
        }
      } else if (task.counter) {
        if (done) delete draft[counterKey(task)];
        else draft[counterKey(task)] = task.counter.target;
      } else if (done) {
        delete draft[task.id];
      } else {
        draft[task.id] = true;
      }
    });
  };

  const onNotes = (value: string) => {
    setNotes(value);
    setReport(null);
    queueSave(ticks, value);
  };

  /* ------------------------------ close-out --------------------------------- */

  const score = cornerScore(corner, ticks);

  const buildReport = () => {
    if (!date) return;
    const { done, open: stillOpen } = cornerSplit(corner, ticks);
    const lines = [
      `${corner.name}'s close-out — ${longDate(date)}`,
      score.total
        ? `Completed: ${score.done}/${score.total} (${score.percent}%) — ${score.grade} day`
        : null,
      `Clock:\n${cornerClockLines(ticks).join("\n")}`,
      "",
      `Done:\n${done.length ? done.map((d) => `  · ${d}`).join("\n") : "  —"}`,
      "",
      `Outstanding:\n${stillOpen.length ? stillOpen.map((o) => `  · ${o}`).join("\n") : "  Nothing — full sweep."}`,
      "",
      `Notes:\n${notes.trim() || "—"}`,
      "",
      `— ${corner.name}`,
    ].filter((l) => l !== null) as string[];
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

  /* --------------------------------- render --------------------------------- */

  if (!date || !today) return <p className="skeleton">Reading the clock…</p>;

  const rel = relativeLabel(date, today);
  const isPast = parseKey(date) < parseKey(today);
  const monthDays = daysInMonth(monthOf(date));
  const leading = parseKey(monthDays[0]).getDay();
  const pct = score.percent;
  let rowIndex = 0;

  const renderTask = (task: Task, section: Section) => {
    rowIndex += 1;
    const isDone = isCornerTaskDone(corner, task, ticks);
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
        data-muted={String(isCornerSectionSkipped(section, ticks))}
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
                const raw = ticks[key];
                const at = typeof raw === "string" ? istTime(new Date(raw)) : null;
                return (
                  <button
                    key={s.id}
                    className="pill"
                    data-on={String(Boolean(raw))}
                    onClick={() => stamp(key)}
                    aria-pressed={Boolean(raw)}
                  >
                    {s.label}
                    {at && <b>{at}</b>}
                  </button>
                );
              })}
            </div>
          )}

          {task.counter && (
            <div className="counter">
              <button
                onClick={() => bumpCounter(counterKey(task), -1)}
                aria-label="One fewer"
                disabled={count === 0}
              >
                −
              </button>
              <span className="counter-read" data-on={String(isDone)}>
                {count}
                <i>/{task.counter.target}</i>
              </span>
              <button onClick={() => bumpCounter(counterKey(task), 1)} aria-label="One more">
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
          aria-pressed={isDone}
          aria-label={`Mark "${task.label}" ${isDone ? "not done" : "done"}`}
        >
          <svg viewBox="0 0 24 24">
            <polyline points="4,12 10,18 20,6" />
          </svg>
        </button>
      </div>
    );
  };

  const shiftStates = cornerShiftStates(ticks);

  return (
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
            <div className="stamp" data-grade={score.grade ?? "C-"} title="Daily grade">
              {score.grade ?? "—"}
            </div>
          </div>
          <div className="meter">
            <div
              className="meter-fill"
              data-grade={score.grade ?? "C-"}
              style={{ width: `${pct}%` }}
            />
            <div className="meter-mark" title="75% — A+ threshold" />
          </div>
          <div className="score-legend">
            <span>
              {score.done} of {score.total} done
            </span>
            <span>{score.grade ? `${score.grade} day` : "No rows yet"}</span>
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
              {score.total ? Object.values(month).filter((d) => d.percent >= 75).length : 0} A+
            </span>
          </div>
          <div className="month-grid">
            {Array.from({ length: leading }).map((_, i) => (
              <span key={`pad-${i}`} />
            ))}
            {monthDays.map((key) => {
              const data = month[key];
              const g = data && score.total ? (data.percent >= 75 ? "A+" : "C-") : "none";
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
                      ? `${key} — ${data.done}/${score.total} (${data.percent}%)`
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
        <div className="corner-head">
          <h2>{corner.name}&rsquo;s Corner</h2>
          <span className="corner-blurb">{corner.blurb}</span>
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
            <span>Storage not connected — ticks will not save yet</span>
          </div>
        )}

        <section className="clock">
          <div className="clock-head">
            <h3>Clock</h3>
            <span className="hair" />
            <span className="clock-note">Times shown in IST</span>
          </div>
          <div className="shifts">
            {shiftStates.map((st) => (
              <div
                className="shift"
                key={st.shift.id}
                data-open={String(st.open)}
                data-live="false"
                data-done={String(Boolean(st.out))}
              >
                <div className="shift-top">
                  <b>{st.shift.label}</b>
                </div>
                <div className="shift-stamps">
                  <span data-set={String(Boolean(st.in))}>
                    In {st.in ? istTime(st.in) : "—"}
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
                    onClick={() => stamp(clockKey(st.shift.id, "in"))}
                  >
                    {st.in ? "Clear in" : "Clock in"}
                  </button>
                  <button
                    className="btn ghost"
                    disabled={!st.in}
                    onClick={() => stamp(clockKey(st.shift.id, "out"))}
                  >
                    {st.out ? "Clear out" : "Clock out"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {loading ? (
          <p className="skeleton">Loading {longDate(date)}…</p>
        ) : corner.sections.length === 0 ? (
          <p className="sop-pending corner-pending">{corner.pending}</p>
        ) : (
          corner.sections.map((section, si) => {
            const skipped = isCornerSectionSkipped(section, ticks);
            const sectionDone = section.tasks.filter((t) =>
              isCornerTaskDone(corner, t, ticks)
            ).length;
            return (
              <section
                className="section"
                key={section.id}
                data-skipped={String(skipped)}
                style={{ animationDelay: `${si * 70}ms` }}
              >
                <div className="section-head">
                  <h2>{section.title}</h2>
                  <span className="hair" />
                  {section.skip && (
                    <button
                      className="skip"
                      data-on={String(skipped)}
                      onClick={() => toggle(section.skip!.id)}
                      aria-pressed={skipped}
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
            Three parts: Done (ticked rows), Outstanding (unticked rows) and your
            Notes. Clock times go in automatically. Generate it, copy it, send it
            to {corner.sendTo}.
          </p>

          {(() => {
            const missing = shiftStates.filter((st) => !st.in);
            const openShifts = shiftStates.filter((st) => st.open);
            if (!missing.length && !openShifts.length) return null;
            return (
              <div className="clock-warn">
                {missing.map((st) => (
                  <p key={`m-${st.shift.id}`}>
                    <b>{st.shift.label} never clocked in.</b> If you worked it, stamp
                    it above before you send this. If not, say why in the notes.
                  </p>
                ))}
                {openShifts.map((st) => (
                  <p key={`o-${st.shift.id}`}>
                    <b>{st.shift.label} is still open</b> — clocked in at{" "}
                    {st.in ? istTime(st.in) : "—"} with no clock-out.
                  </p>
                ))}
              </div>
            );
          })()}

          <label htmlFor={`notes-${corner.id}`}>Notes</label>
          <textarea
            id={`notes-${corner.id}`}
            value={notes}
            onChange={(e) => onNotes(e.target.value)}
            placeholder="Anything the checklist can't see…"
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
              onChange={(e) => setPasscode(e.target.value.replace(/\D/g, "").slice(0, 4))}
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
  );
}
