// How the Students tab lists people. Whatever the sort, students who have Left
// sink to the bottom; they are kept for the record, not for daily work.

import {
  PHASE_PRIORITY,
  currentPhase,
  monthsAgo,
  summarise,
  type Payment,
  type Status,
  type Student,
} from "./roster";

export const SORTS = {
  status: "Status, then newest joined",
  newest: "Joined — newest first",
  oldest: "Joined — oldest first",
  name: "Name, A to Z",
  payment: "Payment — overdue first",
  phase: "Phase — by priority",
} as const;
export type SortKey = keyof typeof SORTS;

export function isSortKey(v: unknown): v is SortKey {
  return typeof v === "string" && v in SORTS;
}

/** The group order for the "status" sort, Left last. */
export const STATUS_ORDER: Status[] = [
  "Active",
  "Pending",
  "Awaiting results",
  "Paused",
  "Completed",
  "Left",
];

const PAYMENT_ORDER: Payment[] = ["Overdue", "Partial", "Pending", "Paid"];

/** Ids in list order. `students` is in roster order, which is also the order
 *  they were added, so inside one join month a later row joined later. */
export function sortStudents(students: Student[], key: SortKey, at: Date = new Date()): string[] {
  const now = at.getMonth();
  const added = new Map(students.map((s, i) => [s.id, i]));
  const left = (s: Student) => (s.status === "Left" ? 1 : 0);
  // Newest first: fewer months ago, then added later.
  const newest = (a: Student, b: Student) =>
    monthsAgo(a.month, now) - monthsAgo(b.month, now) || added.get(b.id)! - added.get(a.id)!;
  const byName = (a: Student, b: Student) => {
    const x = a.name.trim();
    const y = b.name.trim();
    // Unnamed rows go after the named ones.
    if (!x || !y) return Number(!x) - Number(!y);
    return x.localeCompare(y, undefined, { sensitivity: "base", numeric: true });
  };

  const compare: Record<SortKey, (a: Student, b: Student) => number> = {
    status: (a, b) =>
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || newest(a, b),
    newest,
    oldest: (a, b) => -newest(a, b),
    name: byName,
    payment: (a, b) =>
      PAYMENT_ORDER.indexOf(summarise(a).status) - PAYMENT_ORDER.indexOf(summarise(b).status) ||
      newest(a, b),
    // A phase only matters while someone is Active, so the rest follow.
    phase: (a, b) =>
      Number(a.status !== "Active") - Number(b.status !== "Active") ||
      PHASE_PRIORITY.indexOf(currentPhase(a)) - PHASE_PRIORITY.indexOf(currentPhase(b)) ||
      newest(a, b),
  };

  return [...students]
    .sort((a, b) => left(a) - left(b) || compare[key](a, b))
    .map((s) => s.id);
}
