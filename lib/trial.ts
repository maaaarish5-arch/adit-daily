// Trial clients check-in — Adit's Corner. Every student whose phase is T is
// checked on three times a day (11 AM, 4 PM, 9 PM). One entry per student per
// day: a tick for each round, and what came out of the update.
//
// Stored apart from Check-in (`adit:trialcheckin:<date>`), so a tick here never
// shows on the Check-in tab and the other way round.

import type { Coverage } from "./checkin";
import { currentPhase, onCheckin, onDnd, type Student } from "./roster";

export const TRIAL_ROUNDS = [
  { id: "am", label: "11 AM" },
  { id: "pm", label: "4 PM" },
  { id: "night", label: "9 PM" },
] as const;

export type TrialRound = (typeof TRIAL_ROUNDS)[number]["id"];

export type TrialEntry = {
  /** One tick per round, in TRIAL_ROUNDS order. */
  r: [boolean, boolean, boolean];
  /** What came out of the update. */
  n: string;
};

export type TrialEntries = Record<string, TrialEntry>;

export type TrialDoc = { entries: TrialEntries; updatedAt: string | null };

export const EMPTY_TRIAL: TrialDoc = { entries: {}, updatedAt: null };

export const blankTrial = (): TrialEntry => ({ r: [false, false, false], n: "" });

export function trialEntryFor(entries: TrialEntries, id: string): TrialEntry {
  return entries[id] ?? blankTrial();
}

/** Days saved before the three rounds held one tick (`c`); it counts as 11 AM. */
export function cleanTrialEntries(raw: unknown): TrialEntries {
  if (!raw || typeof raw !== "object") return {};
  const out: TrialEntries = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (id.length > 40) continue;
    if (!value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const r: [boolean, boolean, boolean] = Array.isArray(v.r)
      ? [v.r[0] === true, v.r[1] === true, v.r[2] === true]
      : [v.c === true, false, false];
    const n = typeof v.n === "string" ? v.n.slice(0, 2000) : "";
    // A row with no tick and no note carries no information.
    if (!r.some(Boolean) && !n) continue;
    out[id] = { r, n };
    if (Object.keys(out).length >= 1000) break;
  }
  return out;
}

export function parseTrialDoc(raw: unknown): TrialDoc {
  if (!raw) return EMPTY_TRIAL;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      entries: cleanTrialEntries(parsed?.entries),
      updatedAt: parsed?.updatedAt ?? null,
    };
  } catch {
    return EMPTY_TRIAL;
  }
}

/** Phase T students still on Check-in (Active or Trial). */
export const trialStudents = (students: Student[]): Student[] =>
  students.filter((s) => onCheckin(s) && currentPhase(s) === 6);

/**
 * The Daily Flow row "every trial client checked in on thrice", as one number:
 * a student counts once all three rounds are ticked. Students on DND that day
 * are not owed a check. Same shape as Check-in coverage, so the corner's sweep
 * row reads it unchanged.
 */
export function trialCoverage(students: Student[], entries: TrialEntries, date: string): Coverage {
  const all = trialStudents(students);
  const owed = all.filter((s) => !onDnd(s, date));
  const full = (s: Student) => trialEntryFor(entries, s.id).r.every(Boolean);
  const taken = owed.filter(full).length;
  return {
    taken,
    total: owed.length,
    // No trial client that day = nothing owed, so the row is not held open.
    complete: taken === owed.length,
    known: true,
    missing: owed.filter((s) => !full(s)).map((s) => s.name.trim()),
    dnd: all.filter((s) => onDnd(s, date)).map((s) => s.name.trim()),
  };
}
