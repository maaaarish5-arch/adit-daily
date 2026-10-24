"use client";

// Adit's Corner → Reminders. Everything due, day by day: payments, dated
// to-dos, sales follow-ups, exams and DND ends. Read-only except for to-dos,
// which can be ticked or added here (they are the same rows as the To-do tab).

import { useCallback, useEffect, useMemo, useState } from "react";
import DateField from "./date-field";
import { cleanRoster, type Student } from "@/lib/roster";
import { blankTodo, cleanTodos, type Todo } from "@/lib/todos";
import { cleanMeeting, type Meeting } from "@/lib/sales";
import { buildReminders, HORIZON_DAYS, KIND_LABEL, type Reminder } from "@/lib/reminders";
import { longDate, relativeLabel, todayKey } from "@/lib/date";

const PASSCODE_KEY = "adit-daily:passcode";
const SALES_KEY = "adit-daily:sales-passcode";

type SyncState = "idle" | "saving" | "saved" | "error";

const readKey = (k: string) => {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
};

/** Roster, to-dos and (when unlocked) sales meetings, reloaded on focus, plus
 *  a tick for to-do rows. Shared by this page and the panel on top of the corner. */
export function useReminderData() {
  const [today, setToday] = useState<string | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [salesOn, setSalesOn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sync, setSync] = useState<SyncState>("idle");
  const load = useCallback(() => {
    setToday(todayKey());
    const sales = readKey(SALES_KEY);
    Promise.all([
      fetch("/api/roster", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/todos", { cache: "no-store" }).then((r) => r.json()),
      sales
        ? fetch("/api/sales", { cache: "no-store", headers: { "x-sales-passcode": sales } })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
        : Promise.resolve(null),
    ])
      .then(([roster, td, sl]) => {
        setStudents(cleanRoster(roster?.students));
        setTodos(cleanTodos(td?.todos));
        const ms = Array.isArray(sl?.meetings) ? sl.meetings : null;
        setSalesOn(Boolean(ms));
        setMeetings(ms ? ms.map(cleanMeeting).filter((m: Meeting | null): m is Meeting => Boolean(m)) : []);
      })
      .catch(() => setSync("error"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);

  /** Read-modify-write on the latest list, so an edit made on the To-do tab
   *  in the meantime is never overwritten. */
  const writeTodos = useCallback(
    async (change: (latest: Todo[]) => Todo[]) => {
      setSync("saving");
      try {
        const latest = cleanTodos((await (await fetch("/api/todos", { cache: "no-store" })).json())?.todos);
        const next = change(latest);
        const r = await fetch("/api/todos", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-passcode": readKey(PASSCODE_KEY) },
          body: JSON.stringify({ todos: next }),
        });
        if (!r.ok) throw new Error("save failed");
        setTodos(next);
        setSync("saved");
      } catch {
        setSync("error");
      }
    },
    []
  );

  const toggle = (r: Reminder) =>
    writeTodos((latest) =>
      latest.map((t) =>
        t.id === r.todoId ? { ...t, done: !t.done, doneAt: t.done ? "" : new Date().toISOString() } : t
      )
    );

  return { today, students, todos, meetings, salesOn, loading, sync, writeTodos, toggle };
}

export default function RemindersView() {
  const { today, students, todos, meetings, salesOn, loading, sync, writeTodos, toggle } =
    useReminderData();
  const [newDay, setNewDay] = useState("");
  const [newText, setNewText] = useState("");

  const add = () => {
    const title = newText.trim();
    if (!title || !newDay) return;
    writeTodos((latest) => [...latest, { ...blankTodo("Adit"), title, due: newDay }]).then(() => {
      setNewText("");
    });
  };

  const { overdue, days } = useMemo(
    () => (today ? buildReminders(students, todos, meetings, today) : { overdue: [], days: [] }),
    [students, todos, meetings, today]
  );

  if (!today || loading) return <p className="empty">Loading reminders…</p>;

  const row = (r: Reminder, showDay = false) => (
    <div className="rem" key={r.key} data-kind={r.kind} data-done={String(r.done)}>
      {r.todoId ? (
        <button
          className="box"
          data-on={String(r.done)}
          aria-pressed={r.done}
          aria-label={`Mark "${r.title}" ${r.done ? "not done" : "done"}`}
          onClick={() => toggle(r)}
        >
          <svg viewBox="0 0 24 24">
            <polyline points="4,12 10,18 20,6" />
          </svg>
        </button>
      ) : (
        <span className="rem-dot" aria-hidden />
      )}
      <div className="rem-body">
        <div className="rem-title">{r.title}</div>
        {r.detail && <div className="rem-detail">{r.detail}</div>}
      </div>
      <span className="rem-kind">
        {KIND_LABEL[r.kind]}
        {showDay && <i>{longDate(r.day)}</i>}
      </span>
    </div>
  );

  return (
    <div className="reminders">
      <div className="roster-head">
        <div>
          <h2>Reminders</h2>
          <p className="hint">
            Everything due over the next {HORIZON_DAYS} days, day by day: unpaid instalments,
            dated to-dos, sales follow-ups, exams and DND ends. Mark a payment paid on Students
            or a follow-up done on Sales Calendar and it drops off here.
          </p>
        </div>
        <span className="roster-sync">
          <span className="sync-dot" data-state={sync} />
          {sync === "saving" ? "Saving" : sync === "error" ? "Not saved" : sync === "saved" ? "Saved" : "Synced"}
        </span>
      </div>

      <div className="rem-add">
        <DateField value={newDay} onCommit={setNewDay} ariaLabel="Reminder date" />
        <input
          className="todo-title"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="What to be reminded of…"
        />
        <button className="btn" onClick={add} disabled={!newDay || !newText.trim()}>
          + Add reminder
        </button>
      </div>

      {!salesOn && (
        <p className="hint rem-note">
          Sales follow-ups are hidden: open Sales Calendar once on this device and enter its passcode.
        </p>
      )}

      {overdue.length > 0 && (
        <section className="section rem-overdue">
          <div className="section-head">
            <h2>Overdue</h2>
            <span className="hair" />
            <span className="tally">{overdue.length}</span>
          </div>
          {overdue.map((r) => row(r, true))}
        </section>
      )}

      {days.map(({ day, items }) => {
        const rel = relativeLabel(day, today);
        const open = items.filter((r) => !r.done).length;
        return (
          <section className="section" key={day} data-today={String(day === today)}>
            <div className="section-head">
              <h2>
                {longDate(day)}
                {rel && <span className="rem-rel">{rel}</span>}
              </h2>
              <span className="hair" />
              <span className="tally" data-complete={String(items.length > 0 && open === 0)}>
                {open} open
              </span>
            </div>
            {items.length ? items.map((r) => row(r)) : <p className="empty todo-empty">Nothing due today.</p>}
          </section>
        );
      })}
    </div>
  );
}
