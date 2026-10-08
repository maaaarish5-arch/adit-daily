// Sales log — every sales call, one record per meeting.
//
// The calendar supplies who and when (synced daily, and on every page open).
// Dr. Marish supplies what happened, by tapping. A sync only ever updates the
// calendar half of a record; the tapped half is never touched by it.

/* --------------------------------- shape ---------------------------------- */

/** How the meeting went — one of these, or none yet. */
export const OUTCOMES = [
  { id: "showed", label: "Showed up" },
  { id: "noshow", label: "Didn't show" },
  { id: "cancelled", label: "Cancelled" },
] as const;
export type Outcome = (typeof OUTCOMES)[number]["id"];

/** Everything else is a toggle: any number can be on at once. */
export const TAGS = [
  { id: "followup", label: "Follow up", group: "follow" },
  { id: "followedup", label: "Followed up", group: "follow" },
  { id: "fuscheduled", label: "Follow-up scheduled", group: "follow" },
  { id: "keepfollowing", label: "Keep following up", group: "follow" },
  { id: "potential", label: "Potential close", group: "signal" },
  { id: "price", label: "Price told", group: "signal" },
  { id: "confused", label: "Confused", group: "signal" },
  { id: "closed", label: "Closed", group: "deal" },
  { id: "paid", label: "Paid", group: "deal" },
] as const;
export type Tag = (typeof TAGS)[number]["id"];

/** One intake answer from the Calendly form, as asked. */
export type Answer = { q: string; a: string };

export type Meeting = {
  /** The calendar event's UID — stable across syncs and reschedules. */
  id: string;
  /** YYYY-MM-DD in IST, the day it is filed under. */
  date: string;
  /** ISO start time (UTC). */
  start: string;

  /* ---- from the calendar (sync overwrites these) ---- */
  calName: string;
  calEmail: string;
  calWhatsapp: string;
  answers: Answer[];
  /** Cancelled in Cal.com, or renamed "Canceled: …" by Calendly. */
  calCancelled: boolean;
  /** Marked absent in Cal.com. */
  calNoShow: boolean;
  /** No longer in the calendar at all (deleted). Kept, never lost. */
  gone: boolean;
  /** Added by hand on the page, not from the calendar. */
  manual: boolean;

  /* ---- from Dr. Marish (sync never touches these) ---- */
  /** Typed corrections win over the calendar's version. */
  name: string;
  email: string;
  whatsapp: string;
  outcome: Outcome | "";
  tags: Tag[];
  note: string;
  updatedAt: string;
};

/** The fields the page is allowed to change. */
export const EDITABLE = ["name", "email", "whatsapp", "outcome", "tags", "note"] as const;
export type Edit = Partial<Pick<Meeting, (typeof EDITABLE)[number]>>;

const OUTCOME_IDS = new Set<string>(OUTCOMES.map((o) => o.id));
const TAG_IDS = new Set<string>(TAGS.map((t) => t.id));

export function cleanEdit(raw: unknown): Edit {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: Edit = {};
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : undefined);
  if ("name" in r) out.name = str(r.name, 120) ?? "";
  if ("email" in r) out.email = str(r.email, 160) ?? "";
  if ("whatsapp" in r) out.whatsapp = str(r.whatsapp, 40) ?? "";
  if ("note" in r) out.note = str(r.note, 4000) ?? "";
  if ("outcome" in r) out.outcome = OUTCOME_IDS.has(r.outcome as string) ? (r.outcome as Outcome) : "";
  if ("tags" in r && Array.isArray(r.tags)) {
    out.tags = [...new Set(r.tags.filter((t) => TAG_IDS.has(t as string)))] as Tag[];
  }
  return out;
}

export function cleanMeeting(raw: unknown): Meeting | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id || typeof r.date !== "string") return null;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  const e = cleanEdit(r);
  return {
    id: r.id.slice(0, 200),
    date: r.date,
    start: s(r.start),
    calName: s(r.calName),
    calEmail: s(r.calEmail),
    calWhatsapp: s(r.calWhatsapp),
    answers: Array.isArray(r.answers)
      ? (r.answers as Answer[]).filter((x) => x && typeof x.q === "string").slice(0, 30)
      : [],
    calCancelled: r.calCancelled === true,
    calNoShow: r.calNoShow === true,
    gone: r.gone === true,
    manual: r.manual === true,
    name: e.name ?? "",
    email: e.email ?? "",
    whatsapp: e.whatsapp ?? "",
    outcome: e.outcome ?? "",
    tags: e.tags ?? [],
    note: e.note ?? "",
    updatedAt: s(r.updatedAt),
  };
}

/** What the page shows: the typed value if there is one, else the calendar's. */
export const shownName = (m: Meeting) => m.name || m.calName || "(no name)";
export const shownEmail = (m: Meeting) => m.email || m.calEmail;
export const shownWhatsapp = (m: Meeting) => m.whatsapp || m.calWhatsapp;

/** The outcome: what was tapped, else what the calendar says (cancelled / absent). */
export const effectiveOutcome = (m: Meeting): Outcome | "" =>
  m.outcome || (m.calCancelled ? "cancelled" : m.calNoShow ? "noshow" : "");

/* ------------------------------ where they come from ------------------------------ */
// Live: Cal.com bookings, pulled by /api/sales/sync (daily cron + every page open).
// History: Calendly "Strategy Session with Marish" events from Google Calendar,
// imported once — see scripts/import-calendly.mjs.

export const IST = "Asia/Kolkata";

/** YYYY-MM-DD of an instant, in IST. */
export function istDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** The calendar half of a meeting — the only part a sync may write. */
export type CalendarPart = Pick<
  Meeting,
  "id" | "date" | "start" | "calName" | "calEmail" | "calWhatsapp" | "answers" | "calCancelled"
> & { calNoShow: boolean; source: "cal" | "calendly" };

type CalAttendee = {
  name?: string;
  email?: string;
  absent?: boolean;
  bookingFieldsResponses?: Record<string, unknown> | null;
};
type CalBooking = {
  uid?: string;
  start?: string;
  status?: string;
  title?: string;
  description?: string;
  attendees?: CalAttendee[];
};

/** "stage: Graduate · country: UAE · usmle: Stuck at systems" → answers. */
function dotAnswers(line: string): Answer[] {
  return line
    .split("·")
    .map((part) => {
      const i = part.indexOf(":");
      return i < 0 ? null : { q: part.slice(0, i).trim(), a: part.slice(i + 1).trim() };
    })
    .filter((x): x is Answer => Boolean(x && x.q && x.a && x.q.length < 40));
}

/** One Cal.com booking → the calendar half of a meeting. Null for your own test bookings. */
export function meetingFromCal(b: CalBooking, ownEmails: string[]): CalendarPart | null {
  if (!b.uid || !b.start) return null;
  const own = ownEmails.map((e) => e.toLowerCase());
  const guest = (b.attendees ?? []).find((a) => a.email && !own.includes(a.email.toLowerCase()));
  if (!guest) return null; // nobody but Dr. Marish on it — a test booking

  const fields = guest.bookingFieldsResponses ?? {};
  const phone = [fields.attendeePhoneNumber, fields.whatsapp, fields.phone, fields.whatsappNumber].find(
    (v) => typeof v === "string" && v.trim()
  ) as string | undefined;

  const answers: Answer[] = [];
  const firstLine = (b.description ?? "").split("\n")[0];
  const notes = typeof fields.notes === "string" ? fields.notes : "";
  answers.push(...dotAnswers(notes || firstLine));
  const rest = (b.description ?? "").split("\n").slice(1).join("\n").trim();
  if (rest) answers.push({ q: "Their note", a: rest.slice(0, 1500) });

  return {
    id: `cal:${b.uid}`,
    date: istDate(b.start),
    start: new Date(b.start).toISOString(),
    calName: (guest.name ?? "").trim(),
    calEmail: guest.email ?? "",
    calWhatsapp: phone?.trim() ?? "",
    answers: answers.slice(0, 20),
    calCancelled: b.status === "cancelled" || b.status === "rejected",
    calNoShow: guest.absent === true,
    source: "cal",
  };
}

/** Calendly writes its form as "Question?: Answer" blocks in the event description. */
export const CALENDLY_MARKER = "Strategy Session with Marish";

export function meetingFromCalendly(ev: {
  id: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string };
  attendees?: { email?: string; self?: boolean }[];
}): CalendarPart | null {
  const description = ev.description ?? "";
  const start = ev.start?.dateTime;
  if (!description.includes(CALENDLY_MARKER) || !start) return null;
  const title = (ev.summary ?? "").trim();
  const answers: Answer[] = [];
  let calWhatsapp = "";
  for (const block of description.split(/\n\s*\n/)) {
    const i = block.indexOf(":");
    if (i < 0) continue;
    const q = block.slice(0, i).trim();
    const a = block.slice(i + 1).trim();
    if (!q || q.includes("\n") || q === "Event Name" || q.startsWith("Location")) continue;
    if (/whats\s*app/i.test(q)) {
      calWhatsapp = a.split("\n")[0].trim();
      continue;
    }
    if (/cancel|reschedule|powered by/i.test(q) || q.length > 160 || !a) continue;
    answers.push({ q, a });
  }
  return {
    id: `gcal:${ev.id}`,
    date: istDate(start),
    start: new Date(start).toISOString(),
    calName: title.replace(/^cancel+ed:\s*/i, "").replace(/\s+and\s+marish\s*$/i, "").trim(),
    calEmail: ev.attendees?.find((a) => !a.self && a.email)?.email ?? "",
    calWhatsapp,
    answers: answers.slice(0, 20),
    calCancelled: /^cancel+ed:/i.test(title),
    calNoShow: false,
    source: "calendly",
  };
}

/** Fold a fresh calendar read into a stored record — calendar half only. */
export function mergeFromCalendar(stored: Meeting | null, cal: CalendarPart): Meeting {
  const { calNoShow, source, ...part } = cal;
  void source;
  const base: Meeting = stored ?? {
    ...part,
    calNoShow,
    gone: false,
    manual: false,
    name: "",
    email: "",
    whatsapp: "",
    outcome: "",
    tags: [],
    note: "",
    updatedAt: "",
  };
  return { ...base, ...part, calNoShow, gone: false };
}

/* --------------------------------- numbers -------------------------------- */

export type Stats = {
  booked: number;
  showed: number;
  noshow: number;
  cancelled: number;
  /** Booked, not cancelled, not yet marked showed or no-show. */
  pending: number;
  closed: number;
  paid: number;
  /** showed ÷ (showed + no-shows) */
  showRate: number | null;
  /** cancelled ÷ booked */
  cancelRate: number | null;
  /** closed ÷ showed */
  closeRate: number | null;
  /** paid ÷ closed */
  paidRate: number | null;
  /** closed ÷ booked — the whole funnel in one number */
  bookToClose: number | null;
};

export function statsOf(meetings: Meeting[]): Stats {
  const live = meetings.filter((m) => !m.gone);
  const by = (o: Outcome) => live.filter((m) => effectiveOutcome(m) === o).length;
  const showed = by("showed");
  const noshow = by("noshow");
  const cancelled = by("cancelled");
  const closed = live.filter((m) => m.tags.includes("closed") || m.tags.includes("paid")).length;
  const paid = live.filter((m) => m.tags.includes("paid")).length;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
  return {
    booked: live.length,
    showed,
    noshow,
    cancelled,
    pending: live.length - showed - noshow - cancelled,
    closed,
    paid,
    showRate: pct(showed, showed + noshow),
    cancelRate: pct(cancelled, live.length),
    closeRate: pct(closed, showed),
    paidRate: pct(paid, closed),
    bookToClose: pct(closed, live.length),
  };
}
