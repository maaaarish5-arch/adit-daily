// Where a student lives, so the tracker can show their clock next to their name.
//
// Stored on the student as an IANA zone ("Asia/Karachi"), never as a fixed
// offset: the browser works out daylight saving by itself, so the UK and US
// times stay right when their clocks change and India's does not.

export type Place = {
  /** IANA zone — what is stored. */
  tz: string;
  country: string;
  /** Short tag shown on the chip. */
  code: string;
  /** Phone country code, so a number can be matched to a place. */
  dial: string;
  /** For countries with more than one zone: which part. */
  region?: string;
};

export const IST = "Asia/Kolkata";

export const PLACES: Place[] = [
  { tz: IST, country: "India", code: "IN", dial: "+91" },
  { tz: "Asia/Karachi", country: "Pakistan", code: "PK", dial: "+92" },
  { tz: "Asia/Dhaka", country: "Bangladesh", code: "BD", dial: "+880" },
  { tz: "Asia/Kathmandu", country: "Nepal", code: "NP", dial: "+977" },
  { tz: "Asia/Colombo", country: "Sri Lanka", code: "LK", dial: "+94" },
  { tz: "Asia/Yerevan", country: "Armenia", code: "AM", dial: "+374" },
  { tz: "Asia/Dubai", country: "UAE", code: "AE", dial: "+971" },
  { tz: "Asia/Riyadh", country: "Saudi Arabia", code: "SA", dial: "+966" },
  { tz: "Asia/Qatar", country: "Qatar", code: "QA", dial: "+974" },
  { tz: "Asia/Kuwait", country: "Kuwait", code: "KW", dial: "+965" },
  { tz: "Asia/Muscat", country: "Oman", code: "OM", dial: "+968" },
  { tz: "Asia/Bahrain", country: "Bahrain", code: "BH", dial: "+973" },
  { tz: "Asia/Singapore", country: "Singapore", code: "SG", dial: "+65" },
  { tz: "Asia/Kuala_Lumpur", country: "Malaysia", code: "MY", dial: "+60" },
  { tz: "Asia/Manila", country: "Philippines", code: "PH", dial: "+63" },
  { tz: "Africa/Cairo", country: "Egypt", code: "EG", dial: "+20" },
  { tz: "Africa/Lagos", country: "Nigeria", code: "NG", dial: "+234" },
  { tz: "Europe/London", country: "UK", code: "UK", dial: "+44" },
  { tz: "Europe/Dublin", country: "Ireland", code: "IE", dial: "+353" },
  { tz: "Europe/Berlin", country: "Germany", code: "DE", dial: "+49" },
  { tz: "America/New_York", country: "US", code: "US", dial: "+1", region: "Eastern — NY, NJ, FL, GA, MI…" },
  { tz: "America/Chicago", country: "US", code: "US", dial: "+1", region: "Central — TX, IL, MN…" },
  { tz: "America/Denver", country: "US", code: "US", dial: "+1", region: "Mountain — CO, UT…" },
  { tz: "America/Phoenix", country: "US", code: "US", dial: "+1", region: "Arizona" },
  { tz: "America/Los_Angeles", country: "US", code: "US", dial: "+1", region: "Pacific — CA, WA, NV…" },
  { tz: "America/Anchorage", country: "US", code: "US", dial: "+1", region: "Alaska" },
  { tz: "Pacific/Honolulu", country: "US", code: "US", dial: "+1", region: "Hawaii" },
  { tz: "America/Halifax", country: "Canada", code: "CA", dial: "+1", region: "Atlantic" },
  { tz: "America/Toronto", country: "Canada", code: "CA", dial: "+1", region: "Eastern — ON, QC" },
  { tz: "America/Winnipeg", country: "Canada", code: "CA", dial: "+1", region: "Central — MB" },
  { tz: "America/Edmonton", country: "Canada", code: "CA", dial: "+1", region: "Mountain — AB" },
  { tz: "America/Vancouver", country: "Canada", code: "CA", dial: "+1", region: "Pacific — BC" },
  { tz: "America/Guayaquil", country: "Ecuador", code: "EC", dial: "+593" },
  { tz: "America/Sao_Paulo", country: "Brazil", code: "BR", dial: "+55", region: "São Paulo, Rio, Brasília" },
  { tz: "Australia/Sydney", country: "Australia", code: "AU", dial: "+61", region: "Sydney, Melbourne" },
  { tz: "Australia/Brisbane", country: "Australia", code: "AU", dial: "+61", region: "Brisbane" },
  { tz: "Australia/Adelaide", country: "Australia", code: "AU", dial: "+61", region: "Adelaide" },
  { tz: "Australia/Perth", country: "Australia", code: "AU", dial: "+61", region: "Perth" },
  { tz: "Pacific/Auckland", country: "New Zealand", code: "NZ", dial: "+64" },
];

const BY_TZ = new Map(PLACES.map((p) => [p.tz, p]));

export function placeFor(tz: string): Place | undefined {
  return BY_TZ.get(tz);
}

/** Only zones on the list are kept; anything else reads as "not set". */
export function cleanTz(v: unknown): string {
  return typeof v === "string" && BY_TZ.has(v) ? v : "";
}

/** "Pakistan" or "US · Pacific — CA, WA, NV…" — the picker's option text. */
export function placeLabel(p: Place): string {
  return p.region ? `${p.country} · ${p.region}` : p.country;
}

/** Wall-clock minutes since 1970 in a zone — only differences between two of
 *  these mean anything. */
function wallMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((x) => x.type === t)?.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute")) / 60_000;
}

export type HomeClock = {
  /** "3:12 PM" */
  time: string;
  /** "Tue" — set only when their day is not today's day in India. */
  day: string;
  /** Minutes ahead of IST; negative when behind. */
  vsIst: number;
  /** 10 PM – 7 AM there: probably not the moment to message. */
  night: boolean;
};

export function homeClock(tz: string, at: Date): HomeClock {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
  const weekday = (z: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: z, weekday: "short" }).format(at);
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(at)
  );
  const theirs = weekday(tz);
  return {
    time,
    day: theirs === weekday(IST) ? "" : theirs,
    vsIst: wallMinutes(tz, at) - wallMinutes(IST, at),
    night: hour >= 22 || hour < 7,
  };
}

/** "IST −30m", "IST −9h 30m", "IST +2h". */
export function offsetLabel(min: number): string {
  if (min === 0) return "same as IST";
  const sign = min < 0 ? "−" : "+";
  const a = Math.abs(min);
  const h = Math.floor(a / 60);
  const m = a % 60;
  return `IST ${sign}${h ? `${h}h` : ""}${h && m ? " " : ""}${m ? `${m}m` : ""}`;
}

/* ----------------------------- message order ------------------------------ */
// Check-in lists each band in the order a day runs where the student is: whoever
// is just up first, whoever it is 11 PM – 6 AM for last. No country set sits
// between the two — they may well be awake.

/** Their day starts at 6 AM and ends at 11 PM. */
const DAY_START = 6 * 60;
const NIGHT_START = 23 * 60;

/** Minutes since midnight where they are. */
function minuteOfDay(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((x) => x.type === t)?.value);
  return n("hour") * 60 + n("minute");
}

/** 11 PM – 6 AM where they are: leave the message for their morning. */
export function lateNight(tz: string, at: Date): boolean {
  if (!placeFor(tz)) return false;
  const m = minuteOfDay(tz, at);
  return m >= NIGHT_START || m < DAY_START;
}

/** Sort key, lowest first: 6 AM there → 10:59 PM there → no country set →
 *  11 PM there → 5:59 AM there. */
export function messageOrder(tz: string, at: Date): number {
  if (!placeFor(tz)) return NIGHT_START - DAY_START + 0.5;
  return (minuteOfDay(tz, at) - DAY_START + 1440) % 1440 + 1;
}
