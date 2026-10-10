// The Notes box on Check-in — a running scratchpad per student.
//
// Not the day's "what came out of the update" line (that one is per day), and
// not the Notes column on the Students tab (payment remarks). This one stays
// until someone clears it: "cover Repro tomorrow", "send the NBME 28 sheet".
//
// Two jobs live here:
//   1. When the red dot shows — notes written and nobody has opened the box
//      for MEMO_STALE_DAYS.
//   2. Reading scores out of the text — "NBME 28 - 72%", "renal done 81" — so
//      they can be added to the progress pills with one tap. Nothing is ever
//      saved from here by itself; Check-in shows what was found and asks.

import { NBMES, SYSTEMS, cleanPct, type Progress, type SystemId } from "./progress";

/** The longest a note can get. */
export const MEMO_MAX = 5000;

/** Days without the box being opened before its Notes button shows a red dot. */
export const MEMO_STALE_DAYS = 3;

export const BULLET = "• ";

const ISO_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

/** An ISO timestamp, or "" if it isn't one. */
export function cleanStamp(v: unknown): string {
  return typeof v === "string" && ISO_RE.test(v) && !Number.isNaN(Date.parse(v)) ? v : "";
}

/** Red dot: there are notes, and nobody has opened them in MEMO_STALE_DAYS. */
export function memoStale(
  s: { memo: string; memoEditedAt: string; memoSeenAt: string },
  now: Date = new Date()
): boolean {
  if (!s.memo.trim()) return false;
  const last = Math.max(Date.parse(s.memoSeenAt) || 0, Date.parse(s.memoEditedAt) || 0);
  if (!last) return true;
  return now.getTime() - last >= MEMO_STALE_DAYS * 86_400_000;
}

/** "10 Oct 2026, 4:32 PM", in the viewer's own time. */
export function stampLabel(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day}, ${time}`;
}

/* ------------------------------ score reading ------------------------------ */

/** Ways people actually write each system. Matched as whole words, any case. */
const ALIASES: Record<SystemId, string[]> = {
  biochem: ["biochem", "biochemistry"],
  immuno: ["immuno", "immunology"],
  micro: ["micro", "microbio", "microbiology"],
  path: ["path", "patho", "pathology"],
  pharm: ["pharm", "pharma", "pharmac", "pharmacology"],
  biostats: ["biostats", "biostat", "biostatistics", "public health"],
  cvs: ["cvs", "cardio", "cardiology", "cardiovascular", "cardiac"],
  endo: ["endo", "endocrine", "endocrinology"],
  gi: ["gi", "gastro", "gastrointestinal"],
  heme: ["heme/onc", "heme onc", "heme", "hemat", "hematology", "haem", "haematology", "onco", "oncology"],
  msk: ["msk/derm", "msk", "musculoskeletal", "derm", "dermatology"],
  neuro: ["neuro", "neurology"],
  psych: ["psych", "psychiatry"],
  renal: ["renal", "nephro", "nephrology", "kidney"],
  repro: ["repro", "reproductive", "reproduction"],
  respi: ["respi", "resp", "respiratory", "pulm", "pulmo", "pulmonary"],
};

const NBME_SET = new Set<string>(NBMES.map(String));
const SYSTEM_LABEL = new Map<string, string>(SYSTEMS.map((s) => [s.id, s.label]));

// "heme onc", "heme/onc" and "hemeonc" all look up the same way.
const squash = (s: string) => s.toLowerCase().replace(/[\s/]+/g, "");
const escape = (s: string) =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[ /]/g, "[\\s/]*");

const ALIAS_TO_ID = new Map<string, SystemId>();
const allAliases: string[] = [];
for (const [id, list] of Object.entries(ALIASES) as [SystemId, string[]][]) {
  for (const a of list) {
    ALIAS_TO_ID.set(squash(a), id);
    allAliases.push(a);
  }
}
// Longest first, so "heme/onc" is tried before "heme".
const ALIAS_RE = allAliases
  .sort((a, b) => b.length - a.length)
  .map(escape)
  .join("|");

// A score is a number 0–100 sitting just after the name, with nothing but a
// few connecting words in between ("NBME 28 - 72%", "renal done, 81").
const GAP = "[^\\d\\n]{0,24}?";
const NUM = "(\\d{1,3}(?:\\.\\d+)?)(?!\\d|\\.\\d)";
const SYSTEM_RE = new RegExp(`(?<![a-z])(${ALIAS_RE})(?![a-z])(${GAP})${NUM}`, "gi");
const NBME_RE = new RegExp(`(?<![a-z])nbme\\s*(?:form\\s*)?#?\\s*(\\d{2})(?!\\d)(${GAP})${NUM}`, "gi");

// Words between the name and the number that mean it isn't a score yet.
const NOT_A_SCORE =
  /\b(aim|aiming|target|goal|want|wants|need|needs|plan|planned|expect|expected|predict|predicted|tomorrow|next|will|should|by|on|at|before|after|in|day|days|week|weeks)\b/i;
// Units right after the number that mean it's a count or a time, not a %.
const UNIT_AFTER =
  /^\s*(\/|:|-\s*\d|to\s+\d|days?\b|d\b|hrs?\b|hours?\b|h\b|mins?\b|minutes?\b|q\b|qs\b|questions?\b|pages?\b|ch\b|chapters?\b|am\b|pm\b|th\b|st\b|nd\b|rd\b|blocks?\b|times?\b|x\b)/i;

export type FoundScore = {
  kind: "sys" | "nbme";
  key: string;
  /** "NBME 28" or "Renal". */
  label: string;
  pct: number;
};

/** Every score written in the notes. If the same pill appears twice, the
 *  later line wins — notes are written top to bottom. */
export function readScores(text: string): FoundScore[] {
  const found = new Map<string, FoundScore>();
  const take = (f: FoundScore) => {
    const id = `${f.kind}:${f.key}`;
    found.delete(id);
    found.set(id, f);
  };

  for (const line of text.split("\n")) {
    // NBMEs first, and blank them out so "NBME 28" never also reads as a system.
    let rest = line;
    for (const m of line.matchAll(NBME_RE)) {
      const [whole, form, gap, num] = m;
      rest = rest.replace(whole, " ".repeat(whole.length));
      if (!NBME_SET.has(form) || NOT_A_SCORE.test(gap)) continue;
      const after = line.slice((m.index ?? 0) + whole.length);
      if (UNIT_AFTER.test(after)) continue;
      const pct = cleanPct(num);
      if (pct !== null) take({ kind: "nbme", key: form, label: `NBME ${form}`, pct });
    }
    for (const m of rest.matchAll(SYSTEM_RE)) {
      const [whole, name, gap, num] = m;
      const id = ALIAS_TO_ID.get(squash(name));
      if (!id || NOT_A_SCORE.test(gap)) continue;
      const after = rest.slice((m.index ?? 0) + whole.length);
      if (UNIT_AFTER.test(after)) continue;
      const pct = cleanPct(num);
      if (pct !== null) take({ kind: "sys", key: id, label: SYSTEM_LABEL.get(id) ?? id, pct });
    }
  }
  return [...found.values()];
}

/** Scores in the notes that the pills don't already hold, with what they'd replace. */
export function newScores(
  text: string,
  progress: Progress
): (FoundScore & { was: number | undefined })[] {
  return readScores(text)
    .map((f) => ({ ...f, was: (progress[f.kind] as Record<string, number | undefined>)[f.key] }))
    .filter((f) => f.was !== f.pct);
}
