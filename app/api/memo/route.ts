import { NextResponse } from "next/server";
import { updateRoster } from "@/lib/store";
import { MEMO_MAX } from "@/lib/memo";

export const dynamic = "force-dynamic";

/** Same gate as the roster route: open unless APP_PASSCODE is set. */
function authorized(req: Request): boolean {
  const expected = process.env.APP_PASSCODE;
  if (!expected) return true;
  return req.headers.get("x-passcode") === expected;
}

/** One student's Notes box. Touches nothing else on the roster.
 *    { id, seen: true }  — the box was opened: clears the red dot.
 *    { id, text }        — the notes changed: saves them and stamps the time. */
export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "wrong passcode" }, { status: 401 });
  }

  let body: { id?: unknown; text?: unknown; seen?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const { id, text, seen } = body;
  if (typeof id !== "string" || (typeof text !== "string" && seen !== true)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const now = new Date().toISOString();
  try {
    let found = false;
    const saved = await updateRoster((students) => {
      const next = students.map((s) => {
        if (s.id !== id) return s;
        found = true;
        // Writing in the box counts as having opened it.
        if (typeof text !== "string") return { ...s, memoSeenAt: now };
        const memo = text.slice(0, MEMO_MAX);
        if (memo === s.memo) return { ...s, memoSeenAt: now };
        return { ...s, memo, memoEditedAt: now, memoSeenAt: now };
      });
      return found ? next : null; // unknown student: write nothing
    });
    if (!found) return NextResponse.json({ error: "student not found" }, { status: 404 });
    const s = saved.students.find((x) => x.id === id);
    return NextResponse.json({
      memo: s?.memo ?? "",
      memoEditedAt: s?.memoEditedAt ?? "",
      memoSeenAt: s?.memoSeenAt ?? "",
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
