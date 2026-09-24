import { NextResponse } from "next/server";
import { getRoster, putRoster, usingRedis } from "@/lib/store";
import { cleanRoster } from "@/lib/roster";

export const dynamic = "force-dynamic";

/** Same gate as the day route: open unless APP_PASSCODE is set. */
function authorized(req: Request): boolean {
  const expected = process.env.APP_PASSCODE;
  if (!expected) return true;
  return req.headers.get("x-passcode") === expected;
}

export async function GET() {
  try {
    const roster = await getRoster();
    return NextResponse.json({ ...roster, shared: usingRedis });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "wrong passcode" }, { status: 401 });
  }

  let body: { students?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  try {
    const saved = await putRoster(cleanRoster(body.students));
    return NextResponse.json(saved);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
