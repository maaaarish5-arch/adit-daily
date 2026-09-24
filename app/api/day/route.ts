import { NextResponse } from "next/server";
import { isValidKey } from "@/lib/date";
import { getDay, putDay, usingRedis } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Writes are gated by a shared passcode so a stray visitor cannot tick Adit's boxes. */
function authorized(req: Request): boolean {
  const expected = process.env.APP_PASSCODE;
  if (!expected) return true; // unset (local dev) — open
  return req.headers.get("x-passcode") === expected;
}

export async function GET(req: Request) {
  const date = new URL(req.url).searchParams.get("date") ?? "";
  if (!isValidKey(date)) {
    return NextResponse.json({ error: "bad date" }, { status: 400 });
  }
  try {
    const doc = await getDay(date);
    return NextResponse.json({ date, ...doc, shared: usingRedis });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "wrong passcode" }, { status: 401 });
  }

  let body: {
    date?: string;
    ticks?: Record<string, boolean | number | string>;
    notes?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const date = body.date ?? "";
  if (!isValidKey(date)) {
    return NextResponse.json({ error: "bad date" }, { status: 400 });
  }

  // Three kinds of value live in here: `true` for boxes and pills, a positive
  // number for sweep counters, an ISO timestamp for follow-up slots. Anything
  // else — false, 0, "" — means "cleared", and is dropped rather than stored.
  const ticks: Record<string, boolean | number | string> = {};
  for (const [key, value] of Object.entries(body.ticks ?? {})) {
    if (key.length > 80) continue;
    if (value === true) ticks[key] = true;
    else if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      ticks[key] = Math.min(Math.round(value), 999);
    } else if (typeof value === "string" && value) {
      ticks[key] = value.slice(0, 40);
    }
  }

  try {
    const saved = await putDay(date, {
      ticks,
      notes: (body.notes ?? "").slice(0, 4000),
    });
    return NextResponse.json({ date, ...saved });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
