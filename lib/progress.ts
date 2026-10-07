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

/** NBME forms 26 to 33. */
export const NBMES = [26, 27, 28, 29, 30, 31, 32, 33] as const;

/** The NBME line that matters — the bar marks it on every pill. */
export const NBME_TARGET = 65;

/** Done systems and NBMEs, each holding the % entered for it. Absent = not done. */
export type Progress = {
  sys: Partial<Record<SystemId, number>>;
  nbme: Partial<Record<string, number>>;
};

export const EMPTY_PROGRESS: Progress = { sys: {}, nbme: {} };

const SYSTEM_IDS = new Set<string>(SYSTEMS.map((s) => s.id));
const NBME_IDS = new Set<string>(NBMES.map(String));

/** A percentage 0–100, one decimal at most, or null if it isn't one. */
export function cleanPct(v: unknown): number | null {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 10) / 10;
}

export function cleanProgress(raw: unknown): Progress {
  const out: Progress = { sys: {}, nbme: {} };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  const pick = (src: unknown, allowed: Set<string>, into: Record<string, number>) => {
    if (!src || typeof src !== "object") return;
    for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
      const pct = cleanPct(v);
      if (allowed.has(k) && pct !== null) into[k] = pct;
    }
  };
  pick(r.sys, SYSTEM_IDS, out.sys as Record<string, number>);
  pick(r.nbme, NBME_IDS, out.nbme as Record<string, number>);
  return out;
}

/** Which pills a phase shows: systems for Phase 1 and 2, NBMEs for Phase 3. */
export function pillsFor(phase: Phase): "p1" | "p2" | "nbme" | null {
  if (phase === 1) return "p1";
  if (phase === 2) return "p2";
  if (phase === 3) return "nbme";
  return null;
}
