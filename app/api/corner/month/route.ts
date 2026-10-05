import { NextResponse } from "next/server";
import { daysInMonth, isValidMonth } from "@/lib/date";
import { cornerById, cornerScore } from "@/lib/corners";
import { getCornerDays } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Per-day score for one person's month calendar. Only saved days appear. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const corner = cornerById(params.get("person") ?? "");
  const month = params.get("month") ?? "";
  if (!corner || !isValidMonth(month)) {
    return NextResponse.json({ error: "bad person or month" }, { status: 400 });
  }
  try {
    const docs = await getCornerDays(corner.id, daysInMonth(month));
    const days: Record<string, { done: number; percent: number }> = {};
    for (const [date, doc] of Object.entries(docs)) {
      const s = cornerScore(corner, doc.ticks);
      days[date] = { done: s.done, percent: s.percent };
    }
    return NextResponse.json({ person: corner.id, month, days });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
