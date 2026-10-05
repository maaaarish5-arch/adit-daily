import { NextResponse } from "next/server";
import { isValidKey } from "@/lib/date";
import { CORNER_IDS } from "@/lib/corners";
import { getCornerDay, putCornerDay, usingRedis } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Same passcode gate as /api/day. */
function authorized(req: Request): boolean {
  const expected = process.env.APP_PASSCODE;
  if (!expected) return true;
  return req.headers.get("x-passcode") === expected;
}

const validPerson = (p: string) => (CORNER_IDS as string[]).includes(p);

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const person = params.get("person") ?? "";
  const date = params.get("date") ?? "";
  if (!validPerson(person) || !isValidKey(date)) {
    return NextResponse.json({ error: "bad person or date" }, { status: 400 });
  }
  try {
    const doc = await getCornerDay(person, date);
    return NextResponse.json({ person, date, ...doc, shared: usingRedis });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "wrong passcode" }, { status: 401 });
  }
  let body: {
    person?: string;
    date?: string;
    ticks?: Record<string, boolean | number | string>;
    notes?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const person = body.person ?? "";
  const date = body.date ?? "";
  if (!validPerson(person) || !isValidKey(date)) {
    return NextResponse.json({ error: "bad person or date" }, { status: 400 });
  }

  // Same three value kinds as /api/day: true, a positive count, an ISO stamp.
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
    const saved = await putCornerDay(person, date, {
      ticks,
      notes: (body.notes ?? "").slice(0, 4000),
    });
    return NextResponse.json({ person, date, ...saved });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
