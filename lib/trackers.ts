// Student trackers — the day-by-day study plans sent to students.
//
// Dr. Marish posts a task list in the group; the /checklist skill
// (.claude/skills/checklist) turns it into a Tracker and publishes it here. The
// student opens /t/<token>, ticks tasks off and types scores; anyone with the
// link sees the same progress. A score on a task tagged with a system or an NBME
// also fills that progress pill on Check-in (see /api/t/[token]).
//
// A tracker is two documents: the plan (written once by the skill, replaced
// only if the skill re-publishes it) and its state (the ticks, written by
// whoever has the link). Nothing a student does can change the plan.
//
// Open-ended tasks carry a `split` kind, and the student says how much they're
// doing. UWorld and NBME split into blocks (50 questions, 20 per block: Block 1
// · 20, Block 2 · 20, Block 3 · 10), each with its own score; the progress pill
// on Check-in is the running average across every scored block, weighted by
// questions. Reading, flashcards and videos only record the amount (120 pages,
// 6 videos) for reference. They stay one tick; nobody ticks off every video.

import { NBMES, SYSTEMS, cleanPct } from "./progress";

/** A tick and, for score tasks, the % entered. */
export type TaskMark = { at: string; score?: number };

/** How a split task was divided: `total` questions in blocks of `per`. For a
 *  reference-only kind (pages, cards, videos) `per` equals `total`. */
export type Setup = { total: number; per: number };

export type TrackerState = {
  /** Ticks, keyed by task id, or `<taskId>.<n>` for unit n of a split task. */
  done: Record<string, TaskMark>;
  /** How each split task was divided, by task id. */
  setup: Record<string, Setup>;
  /** Reference-only tasks whose "how many?" question was closed with ×. The
   *  count is optional; closing it keeps it closed for everyone. */
  skip: Record<string, true>;
  updatedAt: string | null;
};

export const EMPTY_STATE: TrackerState = { done: {}, setup: {}, skip: {}, updatedAt: null };

/* ------------------------------ split tasks ------------------------------ */

export const SPLIT_KINDS = ["uworld", "nbme", "pages", "cards", "videos"] as const;
export type SplitKind = (typeof SPLIT_KINDS)[number];

type SplitSpec = {
  /** What the student is asked: two questions for blocks, one for the rest. */
  ask: [string] | [string, string];
  /** Per-block score boxes. */
  scored: boolean;
  /** Only records the amount. The task stays one tick, with no parts. */
  info: boolean;
  /** "pages", "cards", "videos": how the amount reads back. */
  noun: string;
  /** Biggest first answer, and biggest second (chunk) answer. */
  maxA: number;
  maxB: number;
};

export const SPLITS: Record<SplitKind, SplitSpec> = {
  uworld: { ask: ["Total questions", "Questions per block"], scored: true, info: false, noun: "questions", maxA: 4000, maxB: 40 },
  nbme: { ask: ["Number of blocks", "Questions per block"], scored: true, info: false, noun: "questions", maxA: 8, maxB: 60 },
  pages: { ask: ["Pages"], scored: false, info: true, noun: "pages", maxA: 5000, maxB: 0 },
  cards: { ask: ["Cards"], scored: false, info: true, noun: "cards", maxA: 50000, maxB: 0 },
  videos: { ask: ["Videos"], scored: false, info: true, noun: "videos", maxA: 500, maxB: 0 },
};

/** No task splits into more than this many units. */
export const MAX_UNITS = 100;

/** The student's answers as a Setup, or a sentence saying what to fix. */
export function makeSetup(kind: SplitKind, a: unknown, b: unknown): Setup | string {
  const spec = SPLITS[kind];
  const whole = (v: unknown) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : 0;
  };
  const x = whole(a);
  if (!x) return `Enter ${spec.ask[0].toLowerCase()} as a whole number`;
  if (spec.info) return x > spec.maxA ? `${spec.ask[0]} can be at most ${spec.maxA}` : { total: x, per: x };
  const y = whole(b);
  if (!y) return `Enter ${(spec.ask[1] ?? "").toLowerCase()} as a whole number`;
  if (x > spec.maxA) return `${spec.ask[0]} can be at most ${spec.maxA}`;
  if (y > spec.maxB) return `${spec.ask[1]} can be at most ${spec.maxB}`;
  const setup = kind === "nbme" ? { total: x * y, per: y } : { total: x, per: Math.min(y, x) };
  const count = Math.ceil(setup.total / setup.per);
  if (count > MAX_UNITS) {
    return `That makes ${count} blocks and the most is ${MAX_UNITS}. Use bigger blocks.`;
  }
  return setup;
}

/** A setup as the student's two answers again, for editing it. */
export function setupAnswers(kind: SplitKind, s: Setup): [number, number] {
  return kind === "nbme" ? [Math.ceil(s.total / s.per), s.per] : [s.total, s.per];
}

export type Unit = {
  /** `<taskId>.<n>`, n from 1. */
  id: string;
  label: string;
  /** Questions, pages, cards: what the unit's score is weighted by. */
  size: number;
};

/** The blocks a UWorld / NBME task was divided into. Reference-only kinds
 *  have none. */
export function unitsOf(task: { id: string; split: SplitKind | null }, setup: Setup | undefined): Unit[] {
  if (!task.split || !setup || SPLITS[task.split].info) return [];
  const out: Unit[] = [];
  const count = Math.ceil(setup.total / setup.per);
  for (let i = 1; i <= count; i++) {
    const start = (i - 1) * setup.per + 1;
    const size = Math.min(setup.per, setup.total - start + 1);
    out.push({ id: `${task.id}.${i}`, label: `Block ${i} · ${size} question${size === 1 ? "" : "s"}`, size });
  }
  return out;
}

/** How much of a task is done, 0 to 1. A split task counts its units. */
export function taskShare(task: TrackerTask, state: TrackerState): number {
  const units = unitsOf(task, state.setup[task.id]);
  if (!units.length) return state.done[task.id] ? 1 : 0;
  return units.filter((u) => state.done[u.id]).length / units.length;
}

/** The value a progress pill should hold: the average of every scored unit
 *  linked to it, weighted by questions, or null if nothing is scored yet. */
export function pillValue(
  tracker: Pick<Tracker, "sections">,
  state: TrackerState,
  link: ScoreLink
): number | null {
  let sum = 0;
  let weight = 0;
  for (const t of allTasks(tracker)) {
    if (!t.score || t.score.kind !== link.kind || t.score.key !== link.key) continue;
    const units = unitsOf(t, state.setup[t.id]);
    if (units.length) {
      for (const u of units) {
        const s = state.done[u.id]?.score;
        if (s !== undefined) {
          sum += s * u.size;
          weight += u.size;
        }
      }
    } else {
      const s = state.done[t.id]?.score;
      if (s !== undefined) {
        sum += s;
        weight += 1;
      }
    }
  }
  return weight ? Math.round((sum / weight) * 10) / 10 : null;
}

/** Which progress pill a task's score fills: a system's UWorld average, or an NBME. */
export type ScoreLink = { kind: "sys" | "nbme"; key: string };

export type TrackerTask = {
  id: string;
  text: string;
  /** The grey line under the task, in Dr. Marish's words. */
  meta: string;
  /** The pill this task's scores feed. On a UWorld task, its system. */
  score: ScoreLink | null;
  /** Open-ended work the student sizes themselves; see SPLITS. */
  split: SplitKind | null;
};

/** "Morning · as soon as you wake up", "By end of day" — or no label. */
export type TrackerBlock = { label: string; tasks: TrackerTask[] };

export type TrackerDay = {
  /** "Day 1", "Day 5–7" — the dates are shown next to it. Or, for a plan run
   *  on time budgets instead of dates, "Phase 1 · MSK". */
  label: string;
  /** YYYY-MM-DD, or "" for an undated phase. `to` is the same as `from` for a
   *  one-day entry. */
  from: string;
  to: string;
  /** The topic on the right: "GIT", "UWorld". */
  topic: string;
  blocks: TrackerBlock[];
  /** Closing line under the day. **double asterisks** for bold. */
  callout: string;
};

/** A system's stretch in a multi-system sprint: "Psychiatry · Fri 16 – Wed 21 Oct". */
export type TrackerSection = { title: string; sub: string; days: TrackerDay[] };

/** Reference card at the top: Timeline, Hard cutoffs, Already done… */
export type TrackerCard = { title: string; rows: { label: string; value: string }[] };

export type Tracker = {
  token: string;
  studentId: string;
  /** As it was when published — the roster name can change later. */
  studentName: string;
  title: string;
  subtitle: string;
  cards: TrackerCard[];
  sections: TrackerSection[];
  /** First and last date across every day. A plan run on time budgets has
   *  no dated days, so these come from the plan itself (start, deadline) —
   *  either can be "". */
  start: string;
  end: string;
  createdAt: string;
  /** Set when the skill re-publishes the plan. */
  editedAt: string;
  archived: boolean;
};

/** One line in the Trackers tab, and the Tracker button on Check-in. */
export type TrackerSummary = {
  token: string;
  studentId: string;
  studentName: string;
  title: string;
  start: string;
  end: string;
  days: number;
  createdAt: string;
  archived: boolean;
  total: number;
  done: number;
  lastActivity: string | null;
};

/* ------------------------------ cleaning ------------------------------ */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;
const SYSTEM_IDS = new Set<string>(SYSTEMS.map((s) => s.id));
const NBME_IDS = new Set<string>(NBMES.map(String));

const str = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
const date = (v: unknown) => (typeof v === "string" && DATE_RE.test(v) ? v : "");
const stamp = (v: unknown) => (typeof v === "string" && ISO_RE.test(v) ? v : "");
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);

export function cleanScoreLink(v: unknown): ScoreLink | null {
  if (!v || typeof v !== "object") return null;
  const { kind, key } = v as Record<string, unknown>;
  const k = String(key ?? "");
  if (kind === "sys" && SYSTEM_IDS.has(k)) return { kind, key: k };
  if (kind === "nbme" && NBME_IDS.has(k)) return { kind, key: k };
  return null;
}

/** Problems that make a plan unpublishable, in words the skill can act on. */
export class TrackerError extends Error {}

/** Sanitise a plan coming from the skill. Task ids are kept if given (so a
 *  re-published plan keeps its ticks) and filled in where missing. */
export function cleanPlan(raw: unknown): Omit<
  Tracker,
  "token" | "studentId" | "studentName" | "createdAt" | "editedAt" | "archived"
> {
  if (!raw || typeof raw !== "object") throw new TrackerError("plan missing");
  const r = raw as Record<string, unknown>;
  const title = str(r.title, 120);
  if (!title) throw new TrackerError("title is required");

  const ids = new Set<string>();
  let n = 0;
  const sections: TrackerSection[] = list(r.sections, 20).map((s, si) => {
    const sr = (s ?? {}) as Record<string, unknown>;
    return {
      title: str(sr.title, 120),
      sub: str(sr.sub, 200),
      days: list(sr.days, 120).map((d, di) => {
        const dr = (d ?? {}) as Record<string, unknown>;
        const from = date(dr.from);
        const to = date(dr.to) || from;
        const where = `section ${si + 1}, day ${di + 1}`;
        if (dr.from && !from) throw new TrackerError(`${where}: "from" must be YYYY-MM-DD`);
        if (dr.to && !date(dr.to)) throw new TrackerError(`${where}: "to" must be YYYY-MM-DD`);
        if (!from && to) throw new TrackerError(`${where}: "to" without "from"`);
        if (to < from) throw new TrackerError(`${where}: "to" is before "from"`);
        return {
          label: str(dr.label, 60) || `Day ${di + 1}`,
          from,
          to,
          topic: str(dr.topic, 80),
          callout: str(dr.callout, 400),
          blocks: list(dr.blocks, 12).map((b) => {
            const br = (b ?? {}) as Record<string, unknown>;
            return {
              label: str(br.label, 80),
              tasks: list(br.tasks, 40).map((t) => {
                const tr = (t ?? {}) as Record<string, unknown>;
                const text = str(tr.text, 200);
                if (!text) throw new TrackerError(`section ${si + 1}, day ${di + 1}: a task has no text`);
                n += 1;
                let id = str(tr.id, 40).replace(/[^\w-]/g, "") || `t${n}`;
                while (ids.has(id)) id = `${id}x`;
                ids.add(id);
                const split = SPLIT_KINDS.includes(tr.split as SplitKind) ? (tr.split as SplitKind) : null;
                return { id, text, meta: str(tr.meta, 300), score: cleanScoreLink(tr.score), split };
              }),
            };
          }),
        };
      }),
    };
  });

  const days = sections.flatMap((s) => s.days);
  if (!days.length) throw new TrackerError("the plan has no days");
  const dated = days.filter((d) => d.from);
  const planStart = date(r.start);
  const planEnd = date(r.end);
  if (r.start && !planStart) throw new TrackerError('"start" must be YYYY-MM-DD');
  if (r.end && !planEnd) throw new TrackerError('"end" must be YYYY-MM-DD');
  if (n === 0) throw new TrackerError("the plan has no tasks");
  if (n > 600) throw new TrackerError("too many tasks (600 max)");

  return {
    title,
    subtitle: str(r.subtitle, 300),
    cards: list(r.cards, 8).map((c) => {
      const cr = (c ?? {}) as Record<string, unknown>;
      return {
        title: str(cr.title, 60),
        rows: list(cr.rows, 24)
          .map((row) => {
            const rr = (row ?? {}) as Record<string, unknown>;
            return { label: str(rr.label, 80), value: str(rr.value, 200) };
          })
          .filter((row) => row.label || row.value),
      };
    }),
    sections,
    // Dated days decide the span; the plan's own start/end fill in for phases.
    start: dated.length ? dated.reduce((m, d) => (d.from < m ? d.from : m), dated[0].from) : planStart,
    end: dated.length ? dated.reduce((m, d) => (d.to > m ? d.to : m), dated[0].to) : planEnd,
  };
}

/** A stored plan, read back. */
export function cleanTracker(raw: unknown): Tracker | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  try {
    return {
      ...cleanPlan(r),
      token: str(r.token, 40),
      studentId: str(r.studentId, 40),
      studentName: str(r.studentName, 120),
      createdAt: stamp(r.createdAt),
      editedAt: stamp(r.editedAt),
      archived: r.archived === true,
    };
  } catch {
    return null;
  }
}

export function cleanState(raw: unknown): TrackerState {
  if (!raw || typeof raw !== "object") return { done: {}, setup: {}, skip: {}, updatedAt: null };
  const r = raw as Record<string, unknown>;
  const done: Record<string, TaskMark> = {};
  if (r.done && typeof r.done === "object") {
    for (const [id, v] of Object.entries(r.done as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const m = v as Record<string, unknown>;
      const at = stamp(m.at);
      if (!at) continue;
      const score = cleanPct(m.score);
      done[id] = score === null ? { at } : { at, score };
    }
  }
  const setup: Record<string, Setup> = {};
  if (r.setup && typeof r.setup === "object") {
    for (const [id, v] of Object.entries(r.setup as Record<string, unknown>)) {
      const s = (v ?? {}) as Record<string, unknown>;
      const total = Number(s.total);
      const per = Number(s.per);
      if (Number.isInteger(total) && Number.isInteger(per) && total > 0 && per > 0 && per <= total && Math.ceil(total / per) <= MAX_UNITS) {
        setup[id] = { total, per };
      }
    }
  }
  const skip: Record<string, true> = {};
  if (r.skip && typeof r.skip === "object") {
    for (const [id, v] of Object.entries(r.skip as Record<string, unknown>)) if (v === true) skip[id] = true;
  }
  return { done, setup, skip, updatedAt: stamp(r.updatedAt) || null };
}

/* ------------------------------ reading ------------------------------ */

export function allTasks(t: Pick<Tracker, "sections">): TrackerTask[] {
  return t.sections.flatMap((s) => s.days.flatMap((d) => d.blocks.flatMap((b) => b.tasks)));
}

/** Days from start to end, both included. */
export function spanDays(start: string, end: string): number {
  if (!start || !end) return 0;
  const ms = (k: string) => {
    const [y, m, d] = k.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(end) - ms(start)) / 86_400_000) + 1;
}

export function summarise(t: Tracker, state: TrackerState): TrackerSummary {
  const tasks = allTasks(t);
  return {
    token: t.token,
    studentId: t.studentId,
    studentName: t.studentName,
    title: t.title,
    start: t.start,
    end: t.end,
    days: spanDays(t.start, t.end),
    createdAt: t.createdAt,
    archived: t.archived,
    total: tasks.length,
    done: tasks.filter((x) => taskShare(x, state) === 1).length,
    lastActivity: state.updatedAt,
  };
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parts(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d, wd: WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] };
}

/** "Fri 9 Oct", or "Tue 13 – Thu 15 Oct", or "Sat 31 Oct – Sun 1 Nov". "" if undated. */
export function dayRange(from: string, to: string): string {
  if (!from) return "";
  const a = parts(from);
  if (!to || to === from) return `${a.wd} ${a.d} ${SHORT_MONTHS[a.m - 1]}`;
  const b = parts(to);
  const left = a.m === b.m ? `${a.wd} ${a.d}` : `${a.wd} ${a.d} ${SHORT_MONTHS[a.m - 1]}`;
  return `${left} – ${b.wd} ${b.d} ${SHORT_MONTHS[b.m - 1]}`;
}

/** "8 Oct" / "8 Oct 2026" when it isn't this year. */
export function shortDate(key: string, thisYear = new Date().getFullYear()): string {
  if (!key) return "";
  const a = parts(key);
  return `${a.d} ${SHORT_MONTHS[a.m - 1]}${a.y !== thisYear ? ` ${a.y}` : ""}`;
}

/** What a score task asks for: "UWorld average" for a system, "Score" for an NBME. */
export function scorePrompt(link: ScoreLink): string {
  return link.kind === "sys" ? "UWorld average" : `NBME ${link.key} score`;
}

/** An unguessable link id — the link is the only key to a tracker. */
export function newToken(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
