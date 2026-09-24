import { NextResponse } from "next/server";
import { isValidKey } from "@/lib/date";
import { getCheckin, putCheckin, usingRedis } from "@/lib/store";
import { cleanEntries } from "@/lib/checkin";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const expected = process.env.APP_PASSCODE;
  if (!expected) return true;
  return req.headers.get("x-passcode") === expected;
}

export async function GET(req: Request) {
  const date = new URL(req.url).searchParams.get("date") ?? "";
  if (!isValidKey(date)) {
    return NextResponse.json({ error: "bad date" }, { status: 400 });
  }
  try {
    const doc = await getCheckin(date);
    return NextResponse.json({ date, ...doc, shared: usingRedis });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "wrong passcode" }, { status: 401 });
  }

  let body: { date?: string; entries?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const date = body.date ?? "";
  if (!isValidKey(date)) {
    return NextResponse.json({ error: "bad date" }, { status: 400 });
  }

  try {
    const saved = await putCheckin(date, cleanEntries(body.entries));
    return NextResponse.json({ date, ...saved });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
