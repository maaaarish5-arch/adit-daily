import { NextResponse } from "next/server";
import { getRoster, updateRoster, usingRedis } from "@/lib/store";
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
    // Progress is written only by /api/progress, notes only by /api/memo. Whatever a tab sends for it is
    // ignored and the stored value kept — so a tab opened before progress
    // existed, or one holding a stale copy, can never wipe a tick.
    const incoming = cleanRoster(body.students);
    let refused = false;
    const saved = await updateRoster((stored) => {
      // A tab whose load failed would send an empty list. Never let that wipe
      // the roster — removing students happens one at a time, never all at once.
      if (incoming.length === 0 && stored.length > 1) {
        refused = true;
        return null;
      }
      // Notes are written only by /api/memo, kept the same way.
      const kept = new Map(
        stored.map((s) => [
          s.id,
          {
            progress: s.progress,
            memo: s.memo,
            memoEditedAt: s.memoEditedAt,
            memoSeenAt: s.memoSeenAt,
          },
        ])
      );
      return incoming.map((s) => ({ ...s, ...kept.get(s.id) }));
    });
    if (refused) {
      return NextResponse.json(
        { error: "refused: that save would have removed every student" },
        { status: 409 }
      );
    }
    return NextResponse.json(saved);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
