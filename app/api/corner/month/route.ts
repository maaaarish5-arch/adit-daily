import { NextResponse } from "next/server";
import { daysInMonth, isValidMonth } from "@/lib/date";
import { cornerById, cornerScore } from "@/lib/corners";
import { getCheckins, getCornerDays, getRoster, getTrialCheckins } from "@/lib/store";
import { coverageOf } from "@/lib/checkin";
import { trialCoverage } from "@/lib/trial";

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
    // A check-in row is scored off the day's Check-in register and the roster.
    const dates = daysInMonth(month);
    // Adit's reads his own Trial clients check-in instead (three rounds a day).
    const usesCoverage = corner.sections.some((s) => s.tasks.some((t) => t.coverage));
    const fromTrial = corner.coverageFrom === "trial";
    const [docs, checkins, trials, roster] = await Promise.all([
      getCornerDays(corner.id, dates),
      usesCoverage && !fromTrial ? getCheckins(dates) : Promise.resolve(null),
      usesCoverage && fromTrial ? getTrialCheckins(dates) : Promise.resolve(null),
      usesCoverage ? getRoster() : Promise.resolve(null),
    ]);
    const days: Record<string, { done: number; percent: number }> = {};
    for (const [date, doc] of Object.entries(docs)) {
      const cov = !roster
        ? undefined
        : fromTrial
          ? trialCoverage(roster.students, trials?.[date]?.entries ?? {}, date)
          : coverageOf(roster.students, checkins?.[date]?.entries ?? {}, date);
      const s = cornerScore(corner, doc.ticks, cov);
      days[date] = { done: s.done, percent: s.percent };
    }
    return NextResponse.json({ person: corner.id, month, days });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
