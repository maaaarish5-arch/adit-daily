import { NextResponse } from "next/server";
import { appendLog, getActivity, markPresence, usingRedis } from "@/lib/store";
import { bucketOf, isLogKind, type LogEvent } from "@/lib/activity";
import { istDayKey, istMinutes } from "@/lib/shifts";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const date = new URL(req.url).searchParams.get("date") ?? istDayKey();
  if (!ISO_DATE.test(date)) {
    return NextResponse.json({ error: "bad date" }, { status: 400 });
  }
  try {
    const activity = await getActivity(date);
    return NextResponse.json({ date, ...activity, shared: usingRedis });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * Append only. The timestamp and the date key are both taken from the server
 * clock, never from the client — so an entry cannot be backdated or filed
 * against a different day. There is no route that edits or deletes.
 */
export async function POST(req: Request) {
  let body: { kind?: unknown; shift?: unknown; ping?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const now = new Date();
  const date = istDayKey(now);
  const bucket = bucketOf(istMinutes(now));

  try {
    // Every request is evidence he had the page open, heartbeat or not.
    await markPresence(date, bucket);

    if (body.ping === true) {
      return NextResponse.json({ ok: true, date, bucket });
    }

    if (!isLogKind(body.kind)) {
      return NextResponse.json({ error: "bad kind" }, { status: 400 });
    }

    const event: LogEvent = {
      t: now.toISOString(),
      kind: body.kind,
      shift: typeof body.shift === "string" ? body.shift.slice(0, 20) : undefined,
    };
    await appendLog(date, event);
    return NextResponse.json({ ok: true, date, event });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
