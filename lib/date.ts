// All date keys are LOCAL dates, never UTC — otherwise the day flips at the wrong hour.

export type DayKey = string; // YYYY-MM-DD

export function keyOf(d: Date): DayKey {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Today, read from the device clock every time it is called. */
export function todayKey(): DayKey {
  return keyOf(new Date());
}

export function parseKey(key: DayKey): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function shiftDays(key: DayKey, delta: number): DayKey {
  const d = parseKey(key);
  d.setDate(d.getDate() + delta);
  return keyOf(d);
}

export function monthOf(key: DayKey): string {
  return key.slice(0, 7); // YYYY-MM
}

export function isValidKey(key: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(key) && !Number.isNaN(parseKey(key).getTime());
}

export function isValidMonth(month: string): boolean {
  return /^\d{4}-\d{2}$/.test(month);
}

/** Every day key in the given YYYY-MM. */
export function daysInMonth(month: string): DayKey[] {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const out: DayKey[] = [];
  for (let i = 1; i <= last; i++) {
    out.push(`${month}-${String(i).padStart(2, "0")}`);
  }
  return out;
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function weekdayName(key: DayKey): string {
  return WEEKDAYS[parseKey(key).getDay()];
}

export function weekdayShort(key: DayKey): string {
  return weekdayName(key).slice(0, 3);
}

export function monthName(key: DayKey): string {
  return MONTHS[parseKey(key).getMonth()];
}

export function dayNumber(key: DayKey): number {
  return parseKey(key).getDate();
}

/** "Saturday, 26 July 2026" */
export function longDate(key: DayKey): string {
  const d = parseKey(key);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function relativeLabel(key: DayKey, today: DayKey): string | null {
  if (key === today) return "Today";
  if (key === shiftDays(today, -1)) return "Yesterday";
  if (key === shiftDays(today, 1)) return "Tomorrow";
  return null;
}
