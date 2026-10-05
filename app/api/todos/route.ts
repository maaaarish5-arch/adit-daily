import { NextResponse } from "next/server";
import { getDump, getTodos, putTodos, usingRedis } from "@/lib/store";
import { cleanTodos, mergeDump } from "@/lib/todos";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const expected = process.env.APP_PASSCODE;
  if (!expected) return true;
  return req.headers.get("x-passcode") === expected;
}

export async function GET() {
  try {
    let doc = await getTodos();
    // The Checklist tab was retired into this list. Fold its tasks in once.
    if (!doc.dumpMerged) {
      const dump = await getDump();
      doc = await putTodos(mergeDump(doc.todos, dump.tasks), true);
    }
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
    const { dumpMerged } = await getTodos();
    return NextResponse.json(await putTodos(cleanTodos(body.todos), dumpMerged));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
