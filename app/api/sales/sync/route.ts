import { NextResponse } from "next/server";
import { getSalesSync, putSalesSync, syncMeetings } from "@/lib/store";
import { meetingFromCal, type CalendarPart } from "@/lib/sales";
import { cronAuthorized, salesAuthorized } from "@/lib/sales-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CAL = "https://api.cal.com/v2/bookings";
const DAY = 86_400_000;
/** How far either side of today each sync reads. Older meetings keep their record. */
const BACK_DAYS = 45;
const AHEAD_DAYS = 60;
/** A page open within this long of the last sync reuses it. */
const FRESH_MS = 2 * 60_000;

async function readCal(): Promise<CalendarPart[]> {
  const key = process.env.CAL_API_KEY;
  if (!key) throw new Error("CAL_API_KEY is not set on Vercel");
  const own = (process.env.SALES_OWN_EMAILS ?? "marish@usmlevault.com").split(",").map((e) => e.trim());
  const now = Date.now();
  const params = new URLSearchParams({
    afterStart: new Date(now - BACK_DAYS * DAY).toISOString(),
    beforeEnd: new Date(now + AHEAD_DAYS * DAY).toISOString(),
    take: "100",
    sortStart: "asc",
  });
  const parts: CalendarPart[] = [];
  for (let skip = 0, page = 0; page < 20; page++, skip += 100) {
    params.set("skip", String(skip));
    const res = await fetch(`${CAL}?${params}`, {
      headers: { Authorization: `Bearer ${key}`, "cal-api-version": "2024-08-13" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Cal.com ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { data?: unknown[]; pagination?: { hasNextPage?: boolean } };
    for (const b of json.data ?? []) {
      const part = meetingFromCal(b as Parameters<typeof meetingFromCal>[0], own);
      if (part) parts.push(part);
    }
    if (!json.pagination?.hasNextPage) break;
  }
  return parts;
}

async function run(force: boolean) {
  const last = await getSalesSync();
  if (!force && last && !last.error && Date.now() - Date.parse(last.at) < FRESH_MS) {
    return NextResponse.json({ sync: last, skipped: true });
  }
  try {
    const parts = await readCal();
    const result = await syncMeetings(parts);
    const sync = { at: new Date().toISOString(), seen: parts.length, error: "" };
    await putSalesSync(sync);
    return NextResponse.json({ sync, ...result });
  } catch (err) {
    // Record the failure so the page can say so — but keep every stored meeting.
    const sync = { at: new Date().toISOString(), seen: 0, error: String(err).slice(0, 300) };
    await putSalesSync(sync).catch(() => undefined);
    return NextResponse.json({ sync }, { status: 502 });
  }
}

/** Vercel Cron, once a day. */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "locked" }, { status: 401 });
  return run(true);
}

/** The Sales page, on open and on "Sync now" ({ force: true }). */
export async function POST(req: Request) {
  if (!salesAuthorized(req)) return NextResponse.json({ error: "locked" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { force?: boolean };
  return run(body.force === true);
}
