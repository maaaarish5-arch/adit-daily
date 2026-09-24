// The activity log — append-only, server-stamped, not editable from the UI.
//
// Two things are recorded:
//   1. Discrete events — every clock-in, clock-out, and every stamp cleared
//      afterwards. A mistake is not erased, it is logged as a correction.
//   2. Presence — five-minute buckets in which the page was actually open and
//      visible. This is what answers "was he on it between the stamps, or did
//      he clock in and disappear".
//
// Nothing here has an edit or delete path. The API appends and reads, and the
// timestamp is assigned by the server, so a stamp cannot be backdated.

export const BUCKET_MIN = 5;
export const BUCKETS_PER_DAY = (24 * 60) / BUCKET_MIN; // 288

export type LogKind =
  | "in"
  | "out"
  | "cleared-in"
  | "cleared-out"
  | "opened";

export type LogEvent = {
  /** ISO instant, assigned server-side. */
  t: string;
  kind: LogKind;
  /** Which shift, when the event is a clock event. */
  shift?: string;
};

export const KIND_LABEL: Record<LogKind, string> = {
  in: "Clocked in",
  out: "Clocked out",
  "cleared-in": "Clock-in removed",
  "cleared-out": "Clock-out removed",
  opened: "Opened the page",
};

export function isLogKind(v: unknown): v is LogKind {
  return (
    typeof v === "string" &&
    ["in", "out", "cleared-in", "cleared-out", "opened"].includes(v)
  );
}

export function cleanEvent(raw: unknown): LogEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isLogKind(r.kind)) return null;
  if (typeof r.t !== "string" || Number.isNaN(new Date(r.t).getTime())) return null;
  return {
    t: r.t,
    kind: r.kind,
    shift: typeof r.shift === "string" ? r.shift.slice(0, 20) : undefined,
  };
}

/* -------------------------------- presence -------------------------------- */

/** Bucket index for a minute-of-IST-day. */
export const bucketOf = (istMin: number) => Math.floor(istMin / BUCKET_MIN);

export const bucketStartMin = (bucket: number) => bucket * BUCKET_MIN;

export function cleanBuckets(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<number>();
  for (const v of raw) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 0 && n < BUCKETS_PER_DAY) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

export type Coverage = {
  /** Buckets inside the shift window in which he was present. */
  present: number;
  /** Total buckets in the window. */
  total: number;
  /** Minutes present inside the window. */
  minutes: number;
  percent: number;
};

/** How much of a scheduled window he was actually on the page for. */
export function coverage(
  buckets: number[],
  startMin: number,
  endMin: number
): Coverage {
  const first = bucketOf(startMin);
  const last = bucketOf(endMin - 1);
  const total = last - first + 1;
  const present = buckets.filter((b) => b >= first && b <= last).length;
  return {
    present,
    total,
    minutes: present * BUCKET_MIN,
    percent: total ? Math.round((present / total) * 100) : 0,
  };
}

/** Presence between two arbitrary IST minutes — used for the clocked span,
 *  which is what he claimed rather than what was scheduled. */
export function coverageBetween(
  buckets: number[],
  fromMin: number,
  toMin: number
): Coverage {
  if (toMin <= fromMin) return { present: 0, total: 0, minutes: 0, percent: 0 };
  return coverage(buckets, fromMin, toMin);
}
