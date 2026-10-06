// Daily check-in — did we actually take an update from this student today?
//
// One document per day: `adit:checkin:YYYY-MM-DD`. The roster supplies who
// exists; this supplies what happened. Adit ticks, Dr. Marish sees the same day.

import {
  MONTHS,
  PHASE_PRIORITY,
  currentPhase,
  onDnd,
  phaseName,
  type Phase,
  type Student,
} from "./roster";

export type Entry = {
  /** Checked — an update was taken. */
  c: boolean;
  /** What came out of it. */
  n: string;
};

export type Entries = Record<string, Entry>;

export type CheckinDoc = { entries: Entries; updatedAt: string | null };

export const EMPTY_CHECKIN: CheckinDoc = { entries: {}, updatedAt: null };

export function cleanEntries(raw: unknown): Entries {
  if (!raw || typeof raw !== "object") return {};
  const out: Entries = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (id.length > 40) continue;
    if (!value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const c = v.c === true;
    const n = typeof v.n === "string" ? v.n.slice(0, 2000) : "";
    // A row that is neither ticked nor annotated carries no information.
    if (!c && !n) continue;
    out[id] = { c, n };
    if (Object.keys(out).length >= 1000) break;
  }
  return out;
}

/* -------------------------------- ordering -------------------------------- */
// Active first (by phase), then Awaiting results, Completed, Paused, Left, then
// anyone who has a check-in today but has since come off the roster. Losing a note because a row was deleted would
// be worse than showing a tidy list.

/** `dnd` is worked out for the day being viewed — see onDnd(). */
export type Row = Student & { archived?: boolean; dnd?: boolean };

/** Section order: Active students by phase priority (Phase 3 NBME, then
 *  Phase 1 new, then Phase 2 maintenance, then Phase 4 exam date set, then
 *  Match) → Do not disturb → Awaiting results → Completed → Paused → Left →
 *  Archived. Inside a section, newest join month first. */
const P = PHASE_PRIORITY.length;

export function rankOf(s: Row): number {
  if (s.archived) return P + 6;
  if (s.status === "Left") return P + 5;
  if (s.status === "Paused") return P + 4;
  if (s.status === "Completed") return P + 3;
  if (s.status === "Awaiting results") return P + 2;
  if (s.dnd) return P + 1;
  return PHASE_PRIORITY.indexOf(currentPhase(s)) + 1;
}

const PRIORITY_NOTE: Partial<Record<Phase, string>> = {
  3: " — highest priority",
  1: " — high priority",
};

export const BANDS: Record<number, { cls: string; label: string }> = {
  ...Object.fromEntries(
    PHASE_PRIORITY.map((p, i) => [
      i + 1,
      { cls: `phase-${p}`, label: `${phaseName(p)}${PRIORITY_NOTE[p] ?? ""}` },
    ])
  ),
  [P + 1]: { cls: "dnd", label: "Do not disturb — no update owed today" },
  [P + 2]: { cls: "awaiting", label: "Awaiting results — exam written, results not out" },
  [P + 3]: { cls: "completed", label: "Completed" },
  [P + 4]: { cls: "paused", label: "Paused" },
  [P + 5]: { cls: "left", label: "Left" },
  [P + 6]: { cls: "archived", label: "Archived — no longer on the tracker" },
};

/** Roster rows plus any orphaned entries from this day, in display order. */
export function buildRows(students: Student[], entries: Entries, day: string): Row[] {
  const known = new Set(students.map((s) => s.id));
  const orphans: Row[] = Object.keys(entries)
    .filter((id) => !known.has(id))
    .map((id) => ({
      id,
      name: entries[id].n ? "(removed student)" : "(removed student)",
      month: "",
      status: "Left" as const,
      phase: 2 as const,
      phaseSince: "",
      examDate: "",
      dndFrom: "",
      dndUntil: "",
      currency: "USD" as const,
      total: 0,
      installments: [],
      payment: "Pending" as const,
      remaining: 0,
      notes: "",
      archived: true,
    }));

  const all: Row[] = [
    ...students.map((s) => ({ ...s, dnd: s.status === "Active" && onDnd(s, day) })),
    ...orphans,
  ];
  const order = new Map(all.map((r, i) => [r.id, i]));
  const now = new Date().getMonth();
  return all.sort((a, b) => {
    const r = rankOf(a) - rankOf(b);
    if (r !== 0) return r;
    const m = monthsAgo(b.month, now) - monthsAgo(a.month, now);
    if (m !== 0) return -m;
    // Same join month: whoever was added to the roster later joined later.
    return order.get(b.id)! - order.get(a.id)!;
  });
}

/** How many months ago a join month was, assuming it falls in the last year.
 *  The roster stores only the month name, so a month later than this one is
 *  read as last year's — January 2027 sorts above December 2026. */
function monthsAgo(month: string, now: number): number {
  const i = MONTHS.indexOf(month as (typeof MONTHS)[number]);
  if (i < 0) return 12;
  return (now - i + 12) % 12;
}

export function entryFor(entries: Entries, id: string): Entry {
  return entries[id] ?? { c: false, n: "" };
}

export function takenCount(rows: Row[], entries: Entries): number {
  return rows.filter((r) => entryFor(entries, r.id).c).length;
}

/* -------------------------------- coverage -------------------------------- */
// The day's sweep, expressed as one number: did every active student get an
// update? Paused and Left students are not owed one, and neither are orphaned
// rows — counting them would make a complete day look incomplete forever.

export type Coverage = {
  /** Active students ticked today. */
  taken: number;
  /** Active students on the roster. */
  total: number;
  /** Names still waiting, in display order — the nightly report needs these. */
  missing: string[];
  /** Active students on DND today — not owed an update, not counted. */
  dnd: string[];
  /** Every active student ticked. False when the roster is empty. */
  complete: boolean;
  /** False until the roster and the day's entries have both loaded. */
  known: boolean;
};

export const UNKNOWN_COVERAGE: Coverage = {
  taken: 0,
  total: 0,
  missing: [],
  dnd: [],
  complete: false,
  known: false,
};

/** Every Active student, DND or not — what the Check-in list shows. */
export function activeRows(rows: Row[]): Row[] {
  return rows.filter((r) => !r.archived && r.status === "Active");
}

/** The students owed an update that day: Active and not on DND. */
export function owedRows(rows: Row[]): Row[] {
  return activeRows(rows).filter((r) => !r.dnd);
}

export function coverageOf(students: Student[], entries: Entries, day: string): Coverage {
  const all = buildRows(students, entries, day);
  const owed = owedRows(all);
  const missing = owed
    .filter((r) => !entryFor(entries, r.id).c)
    .map((r) => r.name || "(unnamed)");
  const taken = owed.length - missing.length;
  return {
    taken,
    total: owed.length,
    missing,
    dnd: activeRows(all)
      .filter((r) => r.dnd)
      .map((r) => r.name || "(unnamed)"),
    complete: owed.length > 0 && missing.length === 0,
    known: true,
  };
}
