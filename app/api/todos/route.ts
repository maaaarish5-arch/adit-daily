import { NextResponse } from "next/server";
import { getTodos, putTodos, usingRedis } from "@/lib/store";
import { cleanTodos } from "@/lib/todos";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const expected = process.env.APP_PASSCODE;
  if (!expected) return true;
  return req.headers.get("x-passcode") === expected;
}

export async function GET() {
  try {
    const doc = await getTodos();
    return NextResponse.json({ ...doc, shared: usingRedis });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "wrong passcode" }, { status: 401 });
  }
  let body: { todos?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  try {
    return NextResponse.json(await putTodos(cleanTodos(body.todos)));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
