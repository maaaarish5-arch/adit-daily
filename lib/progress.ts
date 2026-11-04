// Study progress — which systems a student has finished, and their NBME scores.
//
// Lives on the student record, not the day: once Renal is done it stays done on
// every later check-in. Phase 1 and Phase 2 share one record, so a system ticked
// in Phase 1 is already ticked when the student moves to Phase 2.

import type { Phase } from "./roster";

/** First Aid's chapters, in book order — Biochemistry through Respiratory.
 *  Skin is taught inside Musculoskeletal, so it has no pill of its own. */
export const SYSTEMS = [
  { id: "biochem", label: "Biochem", name: "Biochemistry" },
  { id: "immuno", label: "Immuno", name: "Immunology" },
  { id: "micro", label: "Micro", name: "Microbiology" },
  { id: "path", label: "Path", name: "Pathology" },
  { id: "pharm", label: "Pharm", name: "Pharmacology" },
  { id: "biostats", label: "Biostats", name: "Public health & biostats" },
  { id: "cvs", label: "CVS", name: "Cardiovascular" },
  { id: "endo", label: "Endo", name: "Endocrine" },
  { id: "gi", label: "GI", name: "Gastrointestinal" },
  { id: "heme", label: "Heme/Onc", name: "Hematology & oncology" },
  { id: "msk", label: "MSK/Derm", name: "Musculoskeletal & skin" },
  { id: "neuro", label: "Neuro", name: "Neurology" },
  { id: "psych", label: "Psych", name: "Psychiatry" },
  { id: "renal", label: "Renal", name: "Renal" },
  { id: "repro", label: "Repro", name: "Reproductive" },
  { id: "respi", label: "Respi", name: "Respiratory" },
] as const;

export type SystemId = (typeof SYSTEMS)[number]["id"];

/** Phase 1 is the foundation: these four only. */
export const P1_SYSTEMS: SystemId[] = ["micro", "pharm", "renal", "respi"];

/** NBME forms 26 to 34. */
export const NBMES = [26, 27, 28, 29, 30, 31, 32, 33, 34] as const;

/** Older forms one student is doing on top of the usual ones, by student id.
 *  Nobody else gets these pills, and their scores are refused for anyone else. */
export const EXTRA_NBMES: Record<string, readonly number[]> = {
  csv045: [10, 12, 13, 14, 15], // Manthan
  csv047: [20], // Ana
};

/** The highest NBME form number accepted. Forms are numbered from 1. */
export const MAX_NBME = 60;

/** An NBME form number as a whole number 1 to MAX_NBME, or null. */
export function cleanForm(v: unknown): number | null {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= MAX_NBME ? n : null;
}

/** The NBME forms this student's pills show, lowest first: forms 26 to 34, the
 *  student's own older forms, and any other form a tracker or a score brought
 *  in (`progress.extra`, or a score already stored for it). A form number that
 *  has no pill yet gets one the first time it is used. */
export function nbmesFor(studentId: string, progress?: Pick<Progress, "nbme" | "extra">): number[] {
  const own = progress
    ? [...(progress.extra ?? []), ...Object.keys(progress.nbme).map(Number).filter((n) => cleanForm(n) !== null)]
    : [];
  return [...new Set([...(EXTRA_NBMES[studentId] ?? []), ...NBMES, ...own])].sort((a, b) => a - b);
}

/** Every form someone holds a fixed pill for. */
export const ALL_NBMES: number[] = [
  ...new Set([...NBMES, ...Object.values(EXTRA_NBMES).flat()]),
].sort((a, b) => a - b);

/** The NBME line that matters — the bar marks it on every pill. */
export const NBME_TARGET = 65;

/** Stored in a pill that is done but has no % — ticked without an average.
 *  Every real score is 0 to 100, so a negative number can't be mistaken for one. */
export const DONE_NO_SCORE = -1;

/** True when a pill holds a real % rather than absent or DONE_NO_SCORE. */
export function hasScore(v: number | undefined): v is number {
  return v !== undefined && v !== DONE_NO_SCORE;
}

/** Done systems and NBMEs, each holding the % entered for it, or DONE_NO_SCORE
 *  when ticked without one. Absent = not done. */
export type Progress = {
  sys: Partial<Record<SystemId, number>>;
  nbme: Partial<Record<string, number>>;
  /** NBME forms that have a pill for this student beyond the standard ones: a
   *  form number a student entered on a tracker, or one a plan named. The pill
   *  shows even before it has a score. */
  extra?: number[];
};

export const EMPTY_PROGRESS: Progress = { sys: {}, nbme: {} };

const SYSTEM_IDS = new Set<string>(SYSTEMS.map((s) => s.id));
/** A percentage 0–100, one decimal at most, or null if it isn't one. */
export function cleanPct(v: unknown): number | null {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 10) / 10;
}

/** Every form number a score can be stored under. */
const FORM_KEYS = { has: (k: string) => String(cleanForm(k)) === k };

export function cleanProgress(raw: unknown): Progress {
  const out: Progress = { sys: {}, nbme: {} };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  const pick = (src: unknown, allowed: { has: (k: string) => boolean }, into: Record<string, number>) => {
    if (!src || typeof src !== "object") return;
    for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
      const pct = v === DONE_NO_SCORE ? DONE_NO_SCORE : cleanPct(v);
      if (allowed.has(k) && pct !== null) into[k] = pct;
    }
  };
  pick(r.sys, SYSTEM_IDS, out.sys as Record<string, number>);
  pick(r.nbme, FORM_KEYS, out.nbme as Record<string, number>);
  if (Array.isArray(r.extra)) {
    const extra = [...new Set(r.extra.map(cleanForm).filter((n): n is number => n !== null))].sort((a, b) => a - b);
    if (extra.length) out.extra = extra;
  }
  return out;
}

/** Which pills a phase shows: Phase 1 and Trial the foundation, then the other
 *  systems; Phase 2 all 16 systems; Phase 3 and 4 the NBMEs, then all 16
 *  systems as they are revised (the same record, so Phase 1–2 averages carry
 *  over). */
export function pillsFor(phase: Phase): "p1" | "p2" | "nbme" | null {
  if (phase === 1 || phase === 6) return "p1";
  if (phase === 2) return "p2";
  if (phase === 3 || phase === 4) return "nbme";
  return null;
}
