// The brain-dump checklist — every loose task, each with a priority.
//
// One document holds the whole list. It is not per-day: a task stays on the
// list until it is ticked or removed, however many days that takes.

export type Priority = "highest" | "urgent" | "important";

/** In rank order — the first is done first. */
export const PRIORITIES: { id: Priority; label: string; hint: string }[] = [
  { id: "highest", label: "Highest", hint: "Top priority — do this first" },
  { id: "urgent", label: "Urgent", hint: "Second — soon" },
  { id: "important", label: "Important", hint: "Can be done later" },
];

export const PRIORITY_RANK: Record<Priority, number> = {
  highest: 0,
  urgent: 1,
  important: 2,
};

export type DumpTask = {
  id: string;
  text: string;
  p: Priority;
  done: boolean;
  /** ISO instant the task was added. */
  at: string;
  /** ISO instant it was ticked, while it is ticked. */
  doneAt?: string;
};

export type DumpDoc = { tasks: DumpTask[]; updatedAt: string | null };

export const EMPTY_DUMP: DumpDoc = { tasks: [], updatedAt: null };

const MAX_TASKS = 500;

export function isPriority(v: unknown): v is Priority {
  return v === "highest" || v === "urgent" || v === "important";
}

/** Whatever arrives over the wire, keep only well-formed tasks. */
export function cleanTasks(raw: unknown): DumpTask[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: DumpTask[] = [];
  for (const t of raw.slice(0, MAX_TASKS)) {
    if (!t || typeof t !== "object") continue;
    const id = typeof t.id === "string" ? t.id.slice(0, 40) : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const done = t.done === true;
    out.push({
      id,
      text: typeof t.text === "string" ? t.text.slice(0, 500) : "",
      p: isPriority(t.p) ? t.p : "important",
      done,
      at: typeof t.at === "string" ? t.at.slice(0, 40) : new Date().toISOString(),
      ...(done && typeof t.doneAt === "string" ? { doneAt: t.doneAt.slice(0, 40) } : {}),
    });
  }
  return out;
}

/** Open before done; then Highest → Urgent → Important; then oldest first. */
export function sortTasks(tasks: DumpTask[]): DumpTask[] {
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const r = PRIORITY_RANK[a.p] - PRIORITY_RANK[b.p];
    if (r !== 0) return r;
    return a.at.localeCompare(b.at);
  });
}
