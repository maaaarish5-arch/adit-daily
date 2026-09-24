import { NextResponse } from "next/server";
import { daysInMonth, isValidMonth } from "@/lib/date";
import { getCheckins, getDays, getRoster } from "@/lib/store";
import { countDone, TOTAL_TASKS } from "@/lib/tasks";
import { coverageOf } from "@/lib/checkin";

export const dynamic = "force-dynamic";

/** Per-day score for the month strip. Only days with saved data appear. */
export async function GET(req: Request) {
  const month = new URL(req.url).searchParams.get("month") ?? "";
  if (!isValidMonth(month)) {
    return NextResponse.json({ error: "bad month" }, { status: 400 });
  }

  try {
    // The student sweep is scored off the check-in documents, not the ticks, so
    // the month strip has to read both — and the roster to know who was owed.
    const dates = daysInMonth(month);
    const [docs, checkins, roster] = await Promise.all([
      getDays(dates),
      getCheckins(dates),
      getRoster(),
    ]);

    const days: Record<
      string,
      { done: number; percent: number; taken: number; students: number }
    > = {};
    const seen = new Set([...Object.keys(docs), ...Object.keys(checkins)]);
    for (const date of seen) {
      const ticks = docs[date]?.ticks ?? {};
      const cov = coverageOf(roster.students, checkins[date]?.entries ?? {});
      const done = countDone(ticks, cov);
      days[date] = {
        done,
        percent: Math.round((done / TOTAL_TASKS) * 100),
        taken: cov.taken,
        students: cov.total,
      };
    }
    return NextResponse.json({ month, total: TOTAL_TASKS, days });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
