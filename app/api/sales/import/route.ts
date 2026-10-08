import { NextResponse } from "next/server";
import { syncMeetings } from "@/lib/store";
import { meetingFromCalendly } from "@/lib/sales";
import { salesAuthorized } from "@/lib/sales-auth";

export const dynamic = "force-dynamic";

/** One-time history import: Google Calendar events (Calendly bookings) → meetings.
 *  Safe to repeat — it merges like a sync and never touches what was tapped. */
export async function POST(req: Request) {
  if (!salesAuthorized(req)) return NextResponse.json({ error: "locked" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { events?: unknown[] } | null;
  if (!body || !Array.isArray(body.events)) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const parts = body.events
    .slice(0, 2000)
    .map((e) => meetingFromCalendly(e as Parameters<typeof meetingFromCalendly>[0]))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
  const result = await syncMeetings(parts);
  return NextResponse.json({ imported: parts.length, ...result });
}
