// Reminders — Adit's Corner, day by day.
//
// Nothing here is stored. Every row is read off data the app already keeps:
//   payment   an unpaid instalment's due date (Students tab)
//   task      a to-do with a due date (To-do tab; "+ Add reminder" makes one)
//   exam      a student's exam date
//   dnd       the day a student's do-not-disturb ends
//   followup  a sales follow-up date (Sales Calendar, only when unlocked here)
// So a reminder can never drift from the record it points at: mark the
// instalment paid on Students, or tick the follow-up on Sales, and it goes.

import { followUpOf, shownName, type Meeting } from "./sales";
import { money, summarise, type Student } from "./roster";
import type { Todo } from "./todos";
import { shiftDays } from "./date";

export type ReminderKind = "payment" | "task" | "exam" | "dnd" | "followup";

export const KIND_LABEL: Record<ReminderKind, string> = {
  payment: "Payment",
  task: "Reminder",
  exam: "Exam",
  dnd: "DND ends",
  followup: "Follow-up",
};

export type Reminder = {
  key: string;
  kind: ReminderKind;
  /** YYYY-MM-DD it falls on. */
  day: string;
  title: string;
  detail: string;
  done: boolean;
  /** Set on task rows, so they can be ticked from here. */
  todoId?: string;
};

export type ReminderDay = { day: string; items: Reminder[] };

/** How far ahead the list runs. */
export const HORIZON_DAYS = 30;
/** Missed sales follow-ups older than this stop nagging. */
const FOLLOWUP_GRACE_DAYS = 14;

const ORDER: ReminderKind[] = ["payment", "task", "followup", "exam", "dnd"];

function rowsFor(
  students: Student[],
  todos: Todo[],
  meetings: Meeting[],
): Reminder[] {
  const out: Reminder[] = [];
  const live = students.filter((s) => s.status !== "Left");

  for (const s of live) {
    const dated = s.installments.filter((i) => i.due).sort((a, b) => a.due.localeCompare(b.due));
    const balance = summarise(s).remaining;
    dated.forEach((i, idx) => {
      if (i.paid) return;
      out.push({
        key: `pay:${s.id}:${i.id}`,
        kind: "payment",
        day: i.due,
        title: `${s.name} — ${money(i.amount, s.currency)}`,
        detail: `Instalment ${idx + 1} of ${s.installments.length} · ${money(balance, s.currency)} still owed in total`,
        done: false,
      });
    });
    if (s.examDate) {
      out.push({
        key: `exam:${s.id}:${s.examDate}`,
        kind: "exam",
        day: s.examDate,
        title: `${s.name}'s exam`,
        detail: s.notes,
        done: false,
      });
    }
    if (s.dndUntil) {
      out.push({
        key: `dnd:${s.id}:${s.dndUntil}`,
        kind: "dnd",
        day: s.dndUntil,
        title: `${s.name} can be messaged again`,
        detail: "Do-not-disturb is over today",
        done: false,
      });
    }
  }

  for (const t of todos) {
    if (!t.due || !t.title.trim()) continue;
    out.push({
      key: `todo:${t.id}`,
      kind: "task",
      day: t.due,
      title: t.title,
      detail: [t.owner === "Adit" ? "" : t.owner, t.detail].filter(Boolean).join(" · "),
      done: t.done,
      todoId: t.id,
    });
  }

  for (const m of meetings) {
    const fu = followUpOf(m);
    if (!fu || m.notSales) continue;
    out.push({
      key: `fu:${m.id}:${fu}`,
      kind: "followup",
      day: fu,
      title: `Follow up with ${shownName(m)}`,
      detail: m.log.next || m.note,
      done: m.fuDone === fu,
    });
  }

  return out;
}

const byKind = (a: Reminder, b: Reminder) =>
  ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.title.localeCompare(b.title);

/**
 * Overdue (open items before today) plus every day from today to the horizon
 * that has something on it. Today is always listed, even when empty.
 */
export function buildReminders(
  students: Student[],
  todos: Todo[],
  meetings: Meeting[],
  today: string,
): { overdue: Reminder[]; days: ReminderDay[] } {
  const all = rowsFor(students, todos, meetings);
  const end = shiftDays(today, HORIZON_DAYS);
  const fuFloor = shiftDays(today, -FOLLOWUP_GRACE_DAYS);

  const overdue = all
    .filter((r) => r.day < today && !r.done)
    // Exams and DND ends that have passed are history, not jobs.
    .filter((r) => r.kind === "payment" || r.kind === "task" || (r.kind === "followup" && r.day >= fuFloor))
    .sort((a, b) => a.day.localeCompare(b.day) || byKind(a, b));

  const grouped = new Map<string, Reminder[]>([[today, []]]);
  for (const r of all) {
    if (r.day < today || r.day > end) continue;
    grouped.set(r.day, [...(grouped.get(r.day) ?? []), r]);
  }
  const days = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, items]) => ({ day, items: items.sort(byKind) }));

  return { overdue, days };
}
