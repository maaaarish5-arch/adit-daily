// Daily check-in — did we actually take an update from this student today?
//
// One document per day: `adit:checkin:YYYY-MM-DD`. The roster supplies who
// exists; this supplies what happened. Adit ticks, Dr. Marish sees the same day.

import { MONTHS, type Student } from "./roster";

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
// Active first, then Paused, then Left, then anyone who has a check-in today but
// has since come off the roster. Losing a note because a row was deleted would
// be worse than showing a tidy list.

export type Row = Student & { archived?: boolean };

/** Section order: Active → Completed → Paused → Left → Archived.
 *  Inside a section, newest join month first. */
export function rankOf(s: Row): number {
  if (s.archived) return 5;
  if (s.status === "Left") return 4;
  if (s.status === "Paused") return 3;
  if (s.status === "Completed") return 2;
  return 1;
}

export const BANDS: Record<number, { cls: string; label: string }> = {
  1: { cls: "active", label: "Active" },
  2: { cls: "completed", label: "Completed" },
  3: { cls: "paused", label: "Paused" },
  4: { cls: "left", label: "Left" },
  5: { cls: "archived", label: "Archived — no longer on the tracker" },
};

/** Roster rows plus any orphaned entries from this day, in display order. */
export function buildRows(students: Student[], entries: Entries): Row[] {
  const known = new Set(students.map((s) => s.id));
  const orphans: Row[] = Object.keys(entries)
    .filter((id) => !known.has(id))
    .map((id) => ({
      id,
      name: entries[id].n ? "(removed student)" : "(removed student)",
      month: "",
      status: "Left" as const,
      currency: "USD" as const,
      total: 0,
      installments: [],
      payment: "Pending" as const,
      remaining: 0,
      notes: "",
      archived: true,
    }));

  const all = [...students, ...orphans];
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
  /** Every active student ticked. False when the roster is empty. */
  complete: boolean;
  /** False until the roster and the day's entries have both loaded. */
  known: boolean;
};

export const UNKNOWN_COVERAGE: Coverage = {
  taken: 0,
  total: 0,
  missing: [],
  complete: false,
  known: false,
};

/** The students owed an update today. */
export function owedRows(rows: Row[]): Row[] {
  return rows.filter((r) => !r.archived && r.status === "Active");
}

export function coverageOf(students: Student[], entries: Entries): Coverage {
  const owed = owedRows(buildRows(students, entries));
  const missing = owed
    .filter((r) => !entryFor(entries, r.id).c)
    .map((r) => r.name || "(unnamed)");
  const taken = owed.length - missing.length;
  return {
    taken,
    total: owed.length,
    missing,
    complete: owed.length > 0 && missing.length === 0,
    known: true,
  };
}
