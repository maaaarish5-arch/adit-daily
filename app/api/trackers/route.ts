import { NextResponse } from "next/server";
import {
  getRoster,
  getTracker,
  putTrackerPlan,
  setTrackerArchived,
  trackerSummaries,
} from "@/lib/store";
import {
  TrackerError,
  allTasks,
  cleanPlan,
  newToken,
  spanDays,
  type Tracker,
} from "@/lib/trackers";

export const dynamic = "force-dynamic";

/** Same gate as the roster route: open unless APP_PASSCODE is set. */
function authorized(req: Request): boolean {
  const expected = process.env.APP_PASSCODE;
  if (!expected) return true;
  return req.headers.get("x-passcode") === expected;
}

/** Every tracker, newest first, with progress — for the Trackers tab and Check-in. */
export async function GET() {
  try {
    return NextResponse.json({ trackers: await trackerSummaries() });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * Written by the /checklist skill and the Trackers tab.
 *   { action: "publish", studentId, plan, token?, dryRun? }
 *       New tracker, or — with `token` — replace that tracker's plan, keeping
 *       its ticks. `dryRun` checks the plan and saves nothing.
 *   { action: "archive", token, archived }
 */
export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "wrong passcode" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  try {
    if (body.action === "archive") {
      if (typeof body.token !== "string" || typeof body.archived !== "boolean") {
        return NextResponse.json({ error: "bad request" }, { status: 400 });
      }
      const ok = await setTrackerArchived(body.token, body.archived);
      return ok
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: "tracker not found" }, { status: 404 });
    }

    if (body.action !== "publish") {
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }

    const roster = await getRoster();
    const student = roster.students.find((s) => s.id === body.studentId);
    if (!student) {
      return NextResponse.json({ error: "student not found — use the id from /api/roster" }, { status: 404 });
    }

    const plan = cleanPlan(body.plan);
    const now = new Date().toISOString();

    let previous: Tracker | null = null;
    if (body.token !== undefined) {
      const found = typeof body.token === "string" ? await getTracker(body.token) : null;
      if (!found) return NextResponse.json({ error: "tracker not found" }, { status: 404 });
      if (found.tracker.studentId !== student.id) {
        return NextResponse.json({ error: "that tracker belongs to another student" }, { status: 409 });
      }
      previous = found.tracker;
    }

    const tracker: Tracker = {
      ...plan,
      token: previous?.token ?? newToken(),
      studentId: student.id,
      studentName: student.name.trim(),
      createdAt: previous?.createdAt ?? now,
      editedAt: previous ? now : "",
      archived: previous?.archived ?? false,
    };

    const tasks = allTasks(tracker);
    const check = {
      token: body.dryRun === true ? null : tracker.token,
      path: body.dryRun === true ? null : `/t/${tracker.token}`,
      student: tracker.studentName,
      title: tracker.title,
      start: tracker.start,
      end: tracker.end,
      days: spanDays(tracker.start, tracker.end),
      tasks: tasks.length,
      scoreTasks: tasks
        .filter((t) => t.score)
        .map((t) => `${t.text} → ${t.score!.kind === "sys" ? `${t.score!.key} UWorld avg` : `NBME ${t.score!.key}`}`),
      splitTasks: tasks.filter((t) => t.split).map((t) => `${t.text} → ${t.split}`),
      replaced: Boolean(previous),
    };
    if (body.dryRun === true) return NextResponse.json({ dryRun: true, ...check });

    await putTrackerPlan(tracker);
    return NextResponse.json(check);
  } catch (err) {
    if (err instanceof TrackerError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
