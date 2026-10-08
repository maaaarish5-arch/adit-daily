// Read Google Calendar's secret iCal feed — the only way the server sees the
// Calendly bookings that still land there. Read-only, and unlike an OAuth
// login it never expires.

type Prop = { params: string; value: string };
type VEvent = Record<string, Prop[]>;

/** Unfold RFC 5545 lines and split into VEVENT property maps. */
function parseIcs(text: string): VEvent[] {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const events: VEvent[] = [];
  let cur: VEvent | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT") {
      if (cur) events.push(cur);
      cur = null;
    } else if (cur) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const head = line.slice(0, i);
      const semi = head.indexOf(";");
      const name = (semi < 0 ? head : head.slice(0, semi)).toUpperCase();
      (cur[name] ??= []).push({ params: semi < 0 ? "" : head.slice(semi + 1), value: line.slice(i + 1) });
    }
  }
  return events;
}

const unescape = (v: string) =>
  v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");

/** Wall-clock time in a zone → UTC instant. */
function zonedToUtc(p: number[], tz: string): Date {
  const [y, mo, d, h, mi, s] = p;
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((x) => x.type === t)?.value);
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return new Date(guess - (asIfUtc - guess));
}

/** DTSTART → ISO UTC, or null for all-day / unreadable dates. */
function icsStart(prop: Prop | undefined): string | null {
  if (!prop) return null;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(prop.value);
  if (!m) return null;
  const nums = m.slice(1, 7).map(Number);
  if (m[7]) return new Date(Date.UTC(nums[0], nums[1] - 1, nums[2], nums[3], nums[4], nums[5])).toISOString();
  const tz = /TZID=([^;:]+)/.exec(prop.params)?.[1] ?? "Asia/Kolkata";
  try {
    return zonedToUtc(nums, tz).toISOString();
  } catch {
    return zonedToUtc(nums, "Asia/Kolkata").toISOString();
  }
}

/** The feed as Google-API-shaped events, so the Calendly reader handles both.
 *  `id` drops Google's "@google.com" so it matches events imported via the API. */
export type FeedEvent = {
  id: string;
  summary: string;
  description: string;
  start: { dateTime: string };
  attendees: { email: string; self: boolean }[];
};

export async function readIcsFeed(
  url: string,
  ownEmails: string[],
  from: number,
  to: number
): Promise<FeedEvent[]> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Google Calendar feed ${res.status}`);
  const own = ownEmails.map((e) => e.toLowerCase());
  const out: FeedEvent[] = [];
  for (const ev of parseIcs(await res.text())) {
    if (ev["RECURRENCE-ID"] || ev.RRULE) continue; // sales calls are one-offs
    const start = icsStart(ev.DTSTART?.[0]);
    const uid = ev.UID?.[0]?.value;
    if (!start || !uid) continue;
    const t = Date.parse(start);
    if (t < from || t > to) continue;
    out.push({
      id: uid.replace(/@google\.com$/i, ""),
      summary: unescape(ev.SUMMARY?.[0]?.value ?? ""),
      description: unescape(ev.DESCRIPTION?.[0]?.value ?? ""),
      start: { dateTime: start },
      attendees: (ev.ATTENDEE ?? []).map((a) => {
        const email = a.value.replace(/^mailto:/i, "").trim();
        return { email, self: own.includes(email.toLowerCase()) };
      }),
    });
  }
  return out;
}
