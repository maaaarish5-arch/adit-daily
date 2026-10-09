import { NextResponse } from "next/server";
import { applyClaudeLog, type ClaudeEntry } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Claude's nightly sync posts here: the day's Google Meets, matched to their
// transcripts, with what happened on each call. Bearer CLAUDE_SYNC_SECRET.
export async function POST(req: Request) {
  const secret = process.env.CLAUDE_SYNC_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { meetings?: ClaudeEntry[] } | null;
  const list = Array.isArray(body?.meetings) ? body!.meetings.slice(0, 200) : null;
  if (!list) return NextResponse.json({ ok: false, error: "meetings[] required" }, { status: 400 });
  const result = await applyClaudeLog(list);
  return NextResponse.json({ ok: true, ...result });
}
