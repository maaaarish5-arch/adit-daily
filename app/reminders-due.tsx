"use client";

// The panel on top of Adit's Corner: what to check on one day (today unless
// paged), in the same shape as "Due today" on the Students tab. Overdue items
// sit under today's so nothing missed drops out of sight.

import { useMemo, useState } from "react";
import { useReminderData } from "./reminders-view";
import { buildReminders, KIND_LABEL, remindersOn, type Reminder } from "@/lib/reminders";
import { longDay } from "@/lib/roster";
import { shiftDays } from "@/lib/date";

export default function RemindersDue() {
  const { today, students, todos, meetings, loading, toggle } = useReminderData();
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked ?? today;
  const isToday = day === today;

  const items = useMemo(
    () => (day ? remindersOn(students, todos, meetings, day) : []),
    [students, todos, meetings, day]
  );
  const overdue = useMemo(
    () => (today ? buildReminders(students, todos, meetings, today).overdue : []),
    [students, todos, meetings, today]
  );

  if (!today || !day) return null;

  const open = items.filter((r) => !r.done);
  const counts = (["payment", "task", "followup", "exam", "dnd"] as const)
    .map((k) => ({ k, n: open.filter((r) => r.kind === k).length }))
    .filter((x) => x.n > 0);

  const row = (r: Reminder, late = false) => (
    <div className="due-row rem-due-row" key={r.key} data-paid={String(r.done)} data-late={String(late)}>
      <span className="due-name">
        {r.title}
        {r.detail && <i> · {r.detail}</i>}
      </span>
      <span className="due-which">{late ? longDay(r.day) : KIND_LABEL[r.kind]}</span>
      {r.todoId ? (
        <button className="btn ghost rem-tick" onClick={() => toggle(r)}>
          {r.done ? "Done ✓" : "Mark done"}
        </button>
      ) : (
        <span className="due-state">{late ? KIND_LABEL[r.kind] : "Check"}</span>
      )}
    </div>
  );

  return (
    <section className="due rem-due">
      <div className="due-head">
        <h3>{isToday ? "Reminders today" : `Reminders on ${longDay(day)}`}</h3>
        <span className="hair" />
        <div className="due-nav">
          <button className="btn ghost" onClick={() => setPicked(shiftDays(day, -1))} aria-label="Previous day">
            ←
          </button>
          <button className="btn ghost" onClick={() => setPicked(null)} disabled={isToday}>
            Today
          </button>
          <button className="btn ghost" onClick={() => setPicked(shiftDays(day, 1))} aria-label="Next day">
            →
          </button>
        </div>
      </div>

      {loading ? (
        <p className="due-empty">Loading…</p>
      ) : items.length === 0 ? (
        <p className="due-empty">{isToday ? "Nothing to check today" : `Nothing on ${longDay(day)}`}</p>
      ) : (
        <>
          <p className="due-sum">
            <b>{open.length}</b> to check
            {counts.length > 0 && <> · {counts.map((x) => `${x.n} ${KIND_LABEL[x.k].toLowerCase()}`).join(" · ")}</>}
            {items.length > open.length && <> · {items.length - open.length} done</>}
          </p>
          <div className="due-list">{items.map((r) => row(r))}</div>
        </>
      )}

      {isToday && !loading && overdue.length > 0 && (
        <>
          <p className="due-sum rem-late-sum">
            <b>{overdue.length}</b> overdue
          </p>
          <div className="due-list">{overdue.map((r) => row(r, true))}</div>
        </>
      )}
    </section>
  );
}
