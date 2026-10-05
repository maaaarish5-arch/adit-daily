// The to-do board — one-off work, not the daily loop.
//
// The daily checklist in tasks.ts repeats every day and is scored. This is the
// opposite: project work with an owner and a deadline, ticked once and done.
// It is deliberately NOT part of the daily score — a build task sitting open
// should not drag Adit's A+ down.
//
// Seeded from the 29 September planning meeting (Marish, Adit, Sanskar,
// Shreeman), where ops moved off Adit and onto the two new hires.

import { isPriority, type DumpTask, type Priority } from "./dump";

export const OWNERS = ["Marish", "Adit", "Ops team", "App"] as const;
export type Owner = (typeof OWNERS)[number];

export const OWNER_BLURB: Record<Owner, string> = {
  Marish: "Decisions and inputs only he can give.",
  Adit: "The handover, then his new remit — Instagram, calendar, content.",
  "Ops team": "Sanskar and Shreeman. Trial runs to 14 October.",
  App: "Changes to this tracker so it matches the new structure.",
};

export type Todo = {
  id: string;
  title: string;
  detail: string;
  owner: Owner;
  /** YYYY-MM-DD, empty when undated. */
  due: string;
  done: boolean;
  /** ISO instant it was ticked. */
  doneAt: string;
  /** Priority carried over from the old Checklist tab; "" when unset. */
  p: Priority | "";
};

export const EMPTY_TODOS: Todo[] = [];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function cleanTodo(raw: unknown, i: number): Todo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const title = typeof r.title === "string" ? r.title.slice(0, 300) : "";
  return {
    id: typeof r.id === "string" && r.id ? r.id.slice(0, 40) : `t${i}`,
    title,
    detail: typeof r.detail === "string" ? r.detail.slice(0, 1500) : "",
    owner: OWNERS.includes(r.owner as Owner) ? (r.owner as Owner) : "Adit",
    due: typeof r.due === "string" && DATE_RE.test(r.due) ? r.due : "",
    done: r.done === true,
    doneAt: typeof r.doneAt === "string" ? r.doneAt.slice(0, 40) : "",
    p: isPriority(r.p) ? r.p : "",
  };
}

export function cleanTodos(raw: unknown): Todo[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 300)
    .map((t, i) => cleanTodo(t, i))
    .filter((t): t is Todo => Boolean(t && t.title));
}

export function blankTodo(owner: Owner): Todo {
  return {
    id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    title: "",
    detail: "",
    owner,
    due: "",
    done: false,
    doneAt: "",
    p: "",
  };
}

/** The old Checklist tab, folded into the to-do list as Adit's items. Runs
 *  once, server-side (see /api/todos); ids are kept so it can never double up. */
export function mergeDump(todos: Todo[], dump: DumpTask[]): Todo[] {
  const have = new Set(todos.map((t) => t.id));
  const added: Todo[] = dump
    .filter((d) => d.text.trim() && !have.has(`dump-${d.id}`.slice(0, 40)))
    .map((d) => ({
      id: `dump-${d.id}`.slice(0, 40),
      title: d.text.trim().slice(0, 300),
      detail: "",
      owner: "Adit" as Owner,
      due: "",
      done: d.done,
      doneAt: d.done ? d.doneAt ?? "" : "",
      p: d.p,
    }));
  return [...todos, ...added];
}

export type OwnerProgress = { owner: Owner; done: number; total: number };

export function progress(todos: Todo[]): OwnerProgress[] {
  return OWNERS.map((owner) => {
    const mine = todos.filter((t) => t.owner === owner);
    return { owner, done: mine.filter((t) => t.done).length, total: mine.length };
  });
}

/** Undone and past its date. */
export function isLate(t: Todo, today: string): boolean {
  return !t.done && Boolean(t.due) && t.due < today;
}
