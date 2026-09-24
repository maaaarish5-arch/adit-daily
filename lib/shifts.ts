// Clock-in / clock-out.
//
// Two shifts a day, both fixed in Indian Standard Time. Stamps are stored as
// absolute ISO instants inside the day document (so they ride the same save
// path as the ticks) and always DISPLAYED in IST — otherwise Adit's phone and
// Dr. Marish's laptop would show two different numbers for the same moment.

import type { Ticks } from "./tasks";

export const IST = "Asia/Kolkata";

export type Shift = {
  id: string;
  label: string;
  /** Scheduled window, in IST, as minutes past midnight. */
  startMin: number;
  endMin: number;
  window: string;
};

const hm = (h: number, m = 0) => h * 60 + m;

export const SHIFTS: Shift[] = [
  {
    id: "morning",
    label: "Morning",
    startMin: hm(10),
    endMin: hm(12),
    window: "10:00 – 12:00 IST",
  },
  {
    id: "evening",
    label: "Evening",
    startMin: hm(16),
    endMin: hm(22),
    window: "16:00 – 22:00 IST",
  },
];

export const inKey = (s: Shift) => `shift:${s.id}:in`;
export const outKey = (s: Shift) => `shift:${s.id}:out`;

/** The stored value is an ISO instant; anything else is treated as absent. */
export function stampAt(ticks: Ticks, key: string): Date | null {
  const raw = ticks[key];
  if (typeof raw !== "string" || !raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

const istFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: IST,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "10:04" — always IST, whoever is looking. */
export function istTime(d: Date): string {
  return istFormatter.format(d);
}


const istDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: IST,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The IST calendar date for an instant — "2026-09-07". Logs are keyed by the
 *  shift day, which is Adit's day, not the viewer's. */
export function istDayKey(d: Date = new Date()): string {
  return istDateFormatter.format(d);
}

/** Minutes past IST midnight, for comparing against the scheduled window. */
export function istMinutes(d: Date): number {
  const [h, m] = istTime(d).split(":").map(Number);
  return h * 60 + m;
}

export function nowIstMinutes(): number {
  return istMinutes(new Date());
}

/** Is this shift's scheduled window running right now? */
export function isCurrent(shift: Shift): boolean {
  const now = nowIstMinutes();
  return now >= shift.startMin && now < shift.endMin;
}

export type ShiftState = {
  shift: Shift;
  in: Date | null;
  out: Date | null;
  /** Clocked in and not yet out. */
  open: boolean;
  /** Minutes late clocking in. 0 when on time or early. */
  lateBy: number;
  /** Minutes worked, once both stamps exist. */
  workedMin: number | null;
};

export function shiftState(shift: Shift, ticks: Ticks): ShiftState {
  const start = stampAt(ticks, inKey(shift));
  const end = stampAt(ticks, outKey(shift));
  const lateBy = start ? Math.max(0, istMinutes(start) - shift.startMin) : 0;
  const workedMin =
    start && end ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000)) : null;
  return {
    shift,
    in: start,
    out: end,
    open: Boolean(start && !end),
    lateBy,
    workedMin,
  };
}

export function allShiftStates(ticks: Ticks): ShiftState[] {
  return SHIFTS.map((s) => shiftState(s, ticks));
}

export function duration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Lines for the daily report — what he actually worked, not what was scheduled. */
export function shiftReportLines(ticks: Ticks): string[] {
  return allShiftStates(ticks).map((s) => {
    const label = `${s.shift.label} (${s.shift.window})`;
    if (!s.in) return `  · ${label} — not clocked in`;
    const late = s.lateBy > 0 ? ` (${s.lateBy}m late)` : "";
    if (!s.out) return `  · ${label} — in ${istTime(s.in)}${late}, still open`;
    return `  · ${label} — in ${istTime(s.in)}${late}, out ${istTime(s.out)} · ${duration(s.workedMin ?? 0)}`;
  });
}
