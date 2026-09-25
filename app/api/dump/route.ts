import { NextResponse } from "next/server";
import { getDump, putDump, usingRedis } from "@/lib/store";
import { cleanTasks } from "@/lib/dump";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const expected = process.env.APP_PASSCODE;
  if (!expected) return true;
  return req.headers.get("x-passcode") === expected;
}

export async function GET() {
  try {
    const doc = await getDump();
    return NextResponse.json({ ...doc, shared: usingRedis });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "wrong passcode" }, { status: 401 });
  }

  let body: { tasks?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  try {
    const saved = await putDump(cleanTasks(body.tasks));
    return NextResponse.json(saved);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
