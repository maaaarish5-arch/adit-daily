"use client";

// What the student sees: design A, "today first". A sidebar of every day, a
// card with today's tasks, then each system with its own progress. Ticks are
// saved on the server, so the student, Adit and Dr. Marish all see the same
// progress.
//
// UWorld and NBME tasks ask the student how much they're doing (total
// questions, questions per block) and split into blocks as they type. Each
// block takes a score; the server keeps the Check-in pill at the running
// average. Reading, flashcards and videos just ask "how many?" for reference
// and stay a single tick. That question is optional: × closes it for good,
// leaving an "Add count" link.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SPLITS,
  allTasks,
  dayRange,
  makeSetup,
  pillValue,
  scorePrompt,
  setupAnswers,
  spanDays,
  taskShare,
  unitsOf,
  type SplitKind,
  type Tracker,
  type TrackerDay,
  type TrackerState,
  type TrackerTask,
} from "@/lib/trackers";
import { todayKey } from "@/lib/date";

type Save = "idle" | "saving" | "saved" | "error";
type Body = {
  taskId: string;
  done?: boolean;
  score?: number | null;
  unit?: number;
  setup?: { a: string; b: string } | null;
  skip?: boolean;
};
type Send = (body: Body, optimistic?: (s: TrackerState) => TrackerState) => Promise<string | null>;

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayParts = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return { d, wd: WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] };
};

/** "**bold**" in a callout, without ever rendering HTML from the plan. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part))}
    </>
  );
}

const Check = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <polyline points="3,8.5 6.5,12 13,4.5" />
  </svg>
);

/** A % typed by the student: number 0–100, one decimal, "" to clear. */
function parsePct(raw: string): number | null | "bad" {
  const v = raw.trim().replace(/%$/, "");
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 10) / 10 : "bad";
}

export default function TrackerPage({
  token,
  tracker,
  initial,
}: {
  token: string;
  tracker: Tracker;
  initial: TrackerState;
}) {
  const [state, setState] = useState<TrackerState>(initial);
  const [save, setSave] = useState<Save>("idle");
  const [savedAt, setSavedAt] = useState("");
  const [today, setToday] = useState("");
  const inFlight = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => setToday(todayKey()), []);

  // Live: pick up ticks made on another device or by someone else with the link.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible" || inFlight.current) return;
      if (document.activeElement?.tagName === "INPUT") return;
      fetch(`/api/t/${token}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d?.state && !inFlight.current && setState(d.state))
        .catch(() => undefined);
    };
    const id = setInterval(refresh, 20_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [token]);

  // Saves go one at a time, in order. Resolves to an error message, or null.
  const send: Send = useCallback(
    (body, optimistic) => {
      const undo = stateRef.current;
      if (optimistic) setState(optimistic(undo));
      inFlight.current += 1;
      setSave("saving");
      const run = () =>
        fetch(`/api/t/${token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
          .then(async (r) => {
            const d = await r.json().catch(() => ({}));
            if (!r.ok || !d.state) {
              if (optimistic) setState(undo);
              setSave(r.status === 400 ? "idle" : "error");
              return (d.error as string) ?? "Not saved, check your connection";
            }
            if (inFlight.current === 1) setState(d.state);
            setSave("saved");
            setSavedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
            return null;
          })
          .catch(() => {
            if (optimistic) setState(undo);
            setSave("error");
            return "Not saved, check your connection";
          })
          .finally(() => {
            inFlight.current -= 1;
          });
      const result = queue.current.then(run, run);
      queue.current = result;
      return result;
    },
    [token]
  );

  const tasks = useMemo(() => allTasks(tracker), [tracker]);
  const shares = tasks.map((t) => taskShare(t, state));
  const fullyDone = shares.filter((x) => x === 1).length;
  const pct = tasks.length ? Math.round((shares.reduce((a, b) => a + b, 0) / tasks.length) * 100) : 0;

  const isToday = (d: TrackerDay) => Boolean(today && d.from) && d.from <= today && today <= d.to;
  const span = spanDays(tracker.start, tracker.end);
  const dayNo =
    today && tracker.start && today >= tracker.start && (!tracker.end || today <= tracker.end)
      ? spanDays(tracker.start, today)
      : 0;

  const days = tracker.sections.flatMap((s, si) =>
    s.days.map((d, di) => ({ d, si, di, id: `day-${si}-${di}`, section: s }))
  );
  const todays = days.filter((x) => isToday(x.d));
  const dayDone = (d: TrackerDay) => {
    const list = d.blocks.flatMap((b) => b.tasks);
    return { k: list.filter((t) => taskShare(t, state) === 1).length, n: list.length };
  };
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const ring = 2 * Math.PI * 23;

  const blocksOf = (d: TrackerDay, where: string) =>
    d.blocks.map((b, bi) => (
      <div key={bi}>
        {b.label && <div className="trk-blk">{b.label}</div>}
        {b.tasks.map((t) => (
          <TaskRow key={t.id} task={t} state={state} send={send} where={where} />
        ))}
      </div>
    ));

  return (
    <div className="trk">
      <header className="trk-head">
        <div className="trk-head-text">
          {tracker.subtitle && <div className="trk-who">{tracker.subtitle}</div>}
          <h1>{tracker.title}</h1>
        </div>
        <div className="trk-stats">
          {dayNo > 0 && span > 0 && (
            <div className="trk-stat">
              Day<b>{dayNo} of {span}</b>
            </div>
          )}
          <div className="trk-stat">
            Tasks<b>{fullyDone} of {tasks.length}</b>
          </div>
          <div className="trk-ring" role="img" aria-label={`${pct}% done`}>
            <svg width="56" height="56" viewBox="0 0 56 56">
              <circle className="bg" cx="28" cy="28" r="23" />
              <circle
                className="fg"
                cx="28"
                cy="28"
                r="23"
                strokeDasharray={ring}
                strokeDashoffset={ring * (1 - pct / 100)}
              />
            </svg>
            <span>{pct}%</span>
          </div>
        </div>
        <div className="trk-strip">
          {days.map(({ d, id }) => {
            const p = d.from ? dayParts(d.from) : null;
            const { k, n } = dayDone(d);
            return (
              <button key={id} className="trk-chip" data-today={String(isToday(d))} data-done={String(k === n)} onClick={() => jump(id)}>
                {p ? (
                  <>
                    <small>{p.wd}</small>
                    <b>{p.d}</b>
                  </>
                ) : (
                  <b className="trk-chip-label">{d.label}</b>
                )}
              </button>
            );
          })}
        </div>
      </header>

      <div className="trk-grid">
        <aside className="trk-side">
          <nav className="trk-daylist" aria-label="Every day">
            <h3>Every day</h3>
            {tracker.sections.map((s, si) => (
              <div key={si}>
                {s.title && <div className="trk-sysname">{s.title}</div>}
                {s.days.map((d, di) => {
                  const { k, n } = dayDone(d);
                  const p = d.from ? dayParts(d.from) : null;
                  const past = Boolean(today && d.to && d.to < today);
                  return (
                    <button
                      key={di}
                      className="trk-drow"
                      data-today={String(isToday(d))}
                      data-late={String(past && k < n)}
                      onClick={() => jump(`day-${si}-${di}`)}
                    >
                      <span className="dt">
                        {p ? (
                          <>
                            <small>{p.wd}</small>
                            <b>{p.d}</b>
                          </>
                        ) : (
                          <b>·</b>
                        )}
                      </span>
                      <span className="nm">
                        {d.label}
                        {d.topic && <span>{d.topic}</span>}
                      </span>
                      <span className="st">{k === n ? "✓" : `${k}/${n}`}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
          {tracker.cards.map((c, i) => (
            <div key={i} className="trk-ref">
              {c.title && <h3>{c.title}</h3>}
              {c.rows.map((r, j) => (
                <div key={j}>
                  {r.label}
                  <span>{r.value}</span>
                </div>
              ))}
            </div>
          ))}
        </aside>

        <main className="trk-main">
          {todays.map(({ d, id, section }) => {
            const { k, n } = dayDone(d);
            return (
              <section key={`today-${id}`} className="trk-today">
                <div className="trk-today-top">
                  <div>
                    <span className="trk-today-tag">Today · {dayRange(d.from, d.to)}</span>
                    <h2>{d.topic || d.label}</h2>
                  </div>
                  <div className="trk-today-sub">
                    {d.label}
                    {section.title ? ` of ${section.title}` : ""} · {k} of {n} done
                  </div>
                </div>
                {blocksOf(d, "today")}
              </section>
            );
          })}

          {tracker.sections.map((s, si) => {
            const list = s.days.flatMap((d) => d.blocks.flatMap((b) => b.tasks));
            const k = list.filter((t) => taskShare(t, state) === 1).length;
            const share = list.length ? list.reduce((a, t) => a + taskShare(t, state), 0) / list.length : 0;
            const sysLink = list.find((t) => t.score?.kind === "sys")?.score ?? null;
            const avg = sysLink ? pillValue(tracker, state, sysLink) : null;
            return (
              <section key={si} className="trk-sys">
                <div className="trk-sys-head">
                  <div>
                    <h2>{s.title || tracker.title}</h2>
                    {s.sub && <div className="trk-dates">{s.sub}</div>}
                  </div>
                  <div>
                    <div className="trk-sys-meta">
                      <span>
                        {k} of {list.length} done
                      </span>
                      {sysLink && (
                        <span>
                          UWorld avg <b>{avg === null ? "—" : `${avg}%`}</b>
                        </span>
                      )}
                    </div>
                    <div className="trk-bar">
                      <i style={{ width: `${share * 100}%` }} />
                    </div>
                  </div>
                </div>
                {s.days.map((d, di) => (
                  <div key={di} className="trk-day" id={`day-${si}-${di}`} data-today={String(isToday(d))}>
                    <div className="trk-day-h">
                      <span>{d.label}</span>
                      {d.from && <b>{dayRange(d.from, d.to)}</b>}
                      {isToday(d) && <em>Today</em>}
                    </div>
                    <div className="trk-day-body">
                      {d.topic && <div className="trk-topic">{d.topic}</div>}
                      {blocksOf(d, "plan")}
                      {d.callout && (
                        <div className="trk-callout">
                          <Rich text={d.callout} />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </section>
            );
          })}

          <footer className="trk-foot" data-state={save}>
            {save === "saving"
              ? "Saving…"
              : save === "error"
                ? "Not saved. Check your connection and try again."
                : save === "saved"
                  ? `Saved · ${savedAt} · your mentor sees this live`
                  : "Saved automatically · your mentor sees this live"}
          </footer>
        </main>
      </div>
    </div>
  );
}

/* --------------------------------- a task --------------------------------- */

function TaskRow({
  task,
  state,
  send,
  where,
}: {
  task: TrackerTask;
  state: TrackerState;
  send: Send;
  where: string;
}) {
  const setup = state.setup[task.id];
  const units = unitsOf(task, setup);
  const share = taskShare(task, state);
  const on = share === 1;
  const [editing, setEditing] = useState(false);

  const tick = () =>
    send({ taskId: task.id, done: !on }, (s) => {
      const done = { ...s.done };
      if (on) delete done[task.id];
      else done[task.id] = { at: new Date().toISOString() };
      return { ...s, done };
    });

  const split = task.split;
  // Pages, cards and videos only note the amount; the task stays one tick.
  const info = Boolean(split && SPLITS[split].info);
  const blocks = Boolean(split && !info);
  const skipped = Boolean(state.skip?.[task.id]);
  // × on the optional count: close it, and remember that for everyone.
  const closeAsk = () => {
    setEditing(false);
    if (setup || skipped) return;
    send({ taskId: task.id, skip: true }, (s) => ({ ...s, skip: { ...s.skip, [task.id]: true } }));
  };
  const scored = Boolean(split && SPLITS[split].scored && task.score);
  const scoredUnits = units.filter((u) => state.done[u.id]?.score !== undefined);
  const avg = scoredUnits.length
    ? Math.round(
        (scoredUnits.reduce((a, u) => a + state.done[u.id]!.score! * u.size, 0) /
          scoredUnits.reduce((a, u) => a + u.size, 0)) *
          10
      ) / 10
    : null;

  return (
    <div className="trk-task" data-done={String(on)} data-split={String(blocks)}>
      {blocks && units.length ? (
        <span className="trk-tick" data-on={String(on)} data-part={String(share > 0 && !on)} aria-hidden="true">
          <Check />
        </span>
      ) : blocks ? (
        <span className="trk-tick" data-on="false" aria-hidden="true" />
      ) : (
        <button className="trk-tick" data-on={String(on)} role="checkbox" aria-checked={on} aria-label={task.text} onClick={tick}>
          <Check />
        </button>
      )}
      <div className="trk-tx">
        <strong onClick={blocks ? undefined : tick} data-click={String(!blocks)}>
          {task.text}
        </strong>
        {task.meta && <small>{task.meta}</small>}

        {info && setup && !editing && (
          <div className="trk-amount">
            <span>
              <b>{setup.total}</b> {setup.total === 1 ? SPLITS[split!].noun.replace(/s$/, "") : SPLITS[split!].noun}
            </span>
            <button className="trk-link" onClick={() => setEditing(true)}>
              Change
            </button>
          </div>
        )}

        {info && !setup && skipped && !editing && (
          <button className="trk-addcount" onClick={() => setEditing(true)}>
            + Add count
          </button>
        )}

        {split && (blocks ? !units.length || editing : (!setup && !skipped) || editing) && (
          <SetupForm
            kind={split}
            taskId={task.id}
            where={where}
            current={setup ?? null}
            hasMarks={units.some((u) => state.done[u.id])}
            send={send}
            onFocusIn={() => setEditing(true)}
            onDone={() => setEditing(false)}
            onClose={info ? closeAsk : undefined}
          />
        )}

        {units.length > 0 && (
          <div className="trk-units">
            <div className="trk-units-head">
              <span>
                {summary(split!, setup!, units.length)} · {units.filter((u) => state.done[u.id]).length} of{" "}
                {units.length} done
                {scored && avg !== null && (
                  <>
                    {" "}
                    · avg <b>{avg}%</b>
                  </>
                )}
              </span>
              {!editing && (
                <button className="trk-link" onClick={() => setEditing(true)}>
                  Change
                </button>
              )}
            </div>
            {units.map((u, i) => (
              <UnitRow
                key={u.id}
                taskId={task.id}
                n={i + 1}
                label={u.label}
                mark={state.done[u.id]}
                scored={scored}
                where={where}
                send={send}
                unitId={u.id}
              />
            ))}
          </div>
        )}

        {!split && task.score && (
          <ScoreBox
            id={`${where}-${task.id}`}
            label={scorePrompt(task.score)}
            value={state.done[task.id]?.score}
            onSave={(score) =>
              send({ taskId: task.id, score }, (s) => ({
                ...s,
                done: {
                  ...s.done,
                  [task.id]: score === null ? { at: s.done[task.id]?.at ?? new Date().toISOString() } : { at: s.done[task.id]?.at ?? new Date().toISOString(), score },
                },
              }))
            }
          />
        )}
      </div>
    </div>
  );
}

function summary(_kind: SplitKind, s: { total: number; per: number }, count: number): string {
  return `${count} block${count === 1 ? "" : "s"} · ${s.total} questions`;
}

/* ------------------------- "how much are you doing?" ------------------------ */

function SetupForm({
  kind,
  taskId,
  where,
  current,
  hasMarks,
  send,
  onFocusIn,
  onDone,
  onClose,
}: {
  kind: SplitKind;
  taskId: string;
  where: string;
  current: { total: number; per: number } | null;
  hasMarks: boolean;
  send: Send;
  /** The form stays open while it has focus, so blocks can appear below it as
   *  the student types without the form vanishing mid-number. */
  onFocusIn: () => void;
  onDone: () => void;
  /** The optional count's × button. Whatever is typed is dropped. */
  onClose?: () => void;
}) {
  const spec = SPLITS[kind];
  const start = current ? setupAnswers(kind, current) : null;
  const [a, setA] = useState(start ? String(start[0]) : "");
  const [b, setB] = useState(start ? String(start[1]) : "");
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const made = a.trim() && (spec.info || b.trim()) ? makeSetup(kind, a, b) : null;
  const preview = made && typeof made !== "string" ? previewOf(kind, made) : "";
  const problem = typeof made === "string" ? made : "";
  // Changing the chunk size on a task with ticks clears them, so that waits
  // for a click. Everything else saves as the student types.
  const destructive = Boolean(
    current && hasMarks && made && typeof made !== "string" && made.per !== current.per
  );
  const unchanged = Boolean(
    current && made && typeof made !== "string" && made.per === current.per && made.total === current.total
  );

  const apply = useCallback(async () => {
    if (!made || typeof made === "string" || unchanged) return;
    const err = await send({ taskId, setup: { a, b: spec.info ? a : b } });
    setError(err ?? "");
  }, [made, unchanged, send, taskId, a, b, spec.info]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!made || typeof made === "string" || destructive || unchanged) return;
    timer.current = setTimeout(apply, 700);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [a, b, made, destructive, unchanged, apply]);

  const ask = (i: 0 | 1, value: string, set: (v: string) => void) => (
    <label className="trk-ask" htmlFor={`${where}-${taskId}-q${i}`}>
      <span>{spec.ask[i]}</span>
      <input
        id={`${where}-${taskId}-q${i}`}
        inputMode="numeric"
        value={value}
        placeholder="—"
        onChange={(e) => set(e.target.value.replace(/[^\d]/g, ""))}
      />
    </label>
  );

  // Leaving the form saves what's pending straight away, then folds it.
  const leave = (e: React.FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      apply();
    }
    onDone();
  };

  return (
    <div className="trk-setup" data-info={String(spec.info)} onFocus={onFocusIn} onBlur={leave}>
      {onClose && (
        <button
          className="trk-x"
          aria-label="Close, skip the count"
          title="Skip this. The count is optional."
          onClick={() => {
            if (timer.current) clearTimeout(timer.current);
            timer.current = null;
            onClose();
          }}
        >
          ×
        </button>
      )}
      <div className="trk-setup-q">{current ? (spec.info ? "Change the amount" : "Change how this is split") : intro(kind)}</div>
      <div className="trk-asks">
        {ask(0, a, setA)}
        {!spec.info && ask(1, b, setB)}
      </div>
      <div className="trk-setup-out" aria-live="polite">
        {problem ? <em>{problem}</em> : error ? <em>{error}</em> : preview}
      </div>
      {destructive && (
        <div className="trk-setup-warn">
          A new block size clears the ticks and scores on this task&rsquo;s blocks.
          <button className="trk-apply" onClick={async () => { await apply(); onDone(); }}>
            Split it again
          </button>
        </div>
      )}
      {current && (
        <button className="trk-link" onClick={onDone}>
          Done
        </button>
      )}
    </div>
  );
}

function intro(kind: SplitKind): string {
  if (kind === "uworld") return "How many UWorld questions are you doing?";
  if (kind === "nbme") return "How is this NBME split?";
  if (kind === "pages") return "How many pages is this? (optional)";
  if (kind === "cards") return "How many cards is this? (optional)";
  return "How many videos is this? (optional)";
}

function previewOf(kind: SplitKind, s: { total: number; per: number }): string {
  if (SPLITS[kind].info) return `${s.total} ${s.total === 1 ? SPLITS[kind].noun.replace(/s$/, "") : SPLITS[kind].noun}, noted`;
  const count = Math.ceil(s.total / s.per);
  const last = s.total - (count - 1) * s.per;
  const sizes = last === s.per ? `${count} × ${s.per}` : `${count - 1} × ${s.per} + ${last}`;
  return `→ ${count} block${count === 1 ? "" : "s"}: ${sizes} = ${s.total}`;
}

/* ------------------------------ one block / part ----------------------------- */

function UnitRow({
  taskId,
  n,
  unitId,
  label,
  mark,
  scored,
  where,
  send,
}: {
  taskId: string;
  n: number;
  unitId: string;
  label: string;
  mark: { at: string; score?: number } | undefined;
  scored: boolean;
  where: string;
  send: Send;
}) {
  const on = Boolean(mark);
  const toggle = () =>
    send({ taskId, unit: n, done: !on }, (s) => {
      const done = { ...s.done };
      if (on) delete done[unitId];
      else done[unitId] = { at: new Date().toISOString() };
      return { ...s, done };
    });
  return (
    <div className="trk-unit" data-done={String(on)}>
      <button className="trk-tick small" data-on={String(on)} role="checkbox" aria-checked={on} aria-label={label} onClick={toggle}>
        <Check />
      </button>
      <span className="trk-unit-label" onClick={toggle}>
        {label}
      </span>
      {scored && (
        <ScoreBox
          id={`${where}-${unitId}`}
          label="Score"
          value={mark?.score}
          compact
          onSave={(score) =>
            send({ taskId, unit: n, score }, (s) => ({
              ...s,
              done: {
                ...s.done,
                [unitId]: score === null ? { at: s.done[unitId]?.at ?? new Date().toISOString() } : { at: s.done[unitId]?.at ?? new Date().toISOString(), score },
              },
            }))
          }
        />
      )}
    </div>
  );
}

/* --------------------------------- a % box --------------------------------- */

function ScoreBox({
  id,
  label,
  value,
  compact,
  onSave,
}: {
  id: string;
  label: string;
  value: number | undefined;
  compact?: boolean;
  onSave: (score: number | null) => Promise<string | null>;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const [error, setError] = useState("");
  const editing = useRef(false);

  // Follow scores saved elsewhere, unless this box is being typed in.
  useEffect(() => {
    if (!editing.current) setText(value === undefined ? "" : String(value));
  }, [value]);

  const commit = async () => {
    editing.current = false;
    const v = parsePct(text);
    if (v === "bad") return setError("Enter a % from 0 to 100");
    setError("");
    if (v === (value ?? null)) return;
    const err = await onSave(v);
    if (err) setError(err);
  };

  return (
    <label className="trk-score" data-compact={String(Boolean(compact))} data-filled={String(value !== undefined)} htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        inputMode="decimal"
        value={text}
        placeholder="—"
        onFocus={() => (editing.current = true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        aria-label={`${label} (%)`}
      />
      <span>%</span>
      {error && <em>{error}</em>}
    </label>
  );
}
