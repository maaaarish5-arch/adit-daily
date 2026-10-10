import { NextResponse } from "next/server";
import { getTracker, updateRoster, updateTrackerState } from "@/lib/store";
import {
  SPLITS,
  allTasks,
  makeSetup,
  pillValue,
  unitsOf,
  type ScoreLink,
  type TaskMark,
  type TrackerState,
} from "@/lib/trackers";
import { cleanPct } from "@/lib/progress";

export const dynamic = "force-dynamic";

// The student's own page. No passcode: the link is the key, and it can only
// change its own ticks, scores and splits. Never the plan, another tracker, or
// any roster field other than the progress pills its score tasks are tagged with.

type Ctx = { params: Promise<{ token: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { token } = await params;
  try {
    const found = await getTracker(token);
    if (!found) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(found);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * One change at a time:
 *   { taskId, done }                 tick or untick a whole task
 *   { taskId, score }                score a whole (unsplit) score task
 *   { taskId, setup: { a, b } }      split a task: the student's two answers
 *   { taskId, setup: null }          undo a split
 *   { taskId, skip: true | false }   close (or reopen) the optional "how many?"
 *                                    on a reading / flashcards / videos task
 *   { taskId, unit, done?, score? }  tick or score unit n of a split task
 * A score also ticks. `score: null` clears a score and keeps the tick.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { token } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const { taskId, done, unit } = body;
  if (typeof taskId !== "string" || (done !== undefined && typeof done !== "boolean")) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (unit !== undefined && !(Number.isInteger(unit) && (unit as number) > 0)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const hasScore = body.score !== undefined;
  const pct = body.score === null ? null : cleanPct(body.score);
  if (hasScore && body.score !== null && pct === null) {
    return NextResponse.json({ error: "Enter a % from 0 to 100" }, { status: 400 });
  }

  try {
    let problem: { status: number; error: string } | null = null;
    let link: ScoreLink | null = null;
    let studentId = "";
    let pill: number | null = null;
    const now = new Date().toISOString();

    const state = await updateTrackerState(token, (tracker, current) => {
      const fail = (status: number, error: string) => {
        problem = { status, error };
        return null;
      };
      const task = allTasks(tracker).find((t) => t.id === taskId);
      if (!task) return fail(404, "not found");
      studentId = tracker.studentId;
      const next: TrackerState = {
        done: { ...current.done },
        setup: { ...current.setup },
        skip: { ...current.skip },
        updatedAt: now,
      };
      const mark = (id: string) => {
        const prev = next.done[id];
        const m: TaskMark = { at: prev && !hasScore ? prev.at : now };
        const s = hasScore ? pct : prev?.score;
        if (s !== null && s !== undefined) m.score = s;
        next.done[id] = m;
      };

      if (body.skip !== undefined) {
        if (typeof body.skip !== "boolean") return fail(400, "bad request");
        if (!task.split || !SPLITS[task.split].info) return fail(400, "only a count can be skipped");
        if (body.skip) next.skip[task.id] = true;
        else delete next.skip[task.id];
      } else if (body.setup !== undefined) {
        // Split, re-split or un-split. Re-splitting with the same chunk size
        // keeps the ticks on blocks that still exist; a new chunk size means
        // the old blocks no longer match, so their ticks and scores go.
        if (!task.split) return fail(400, "this task can't be split");
        const before = unitsOf(task, current.setup[task.id]);
        if (body.setup === null) {
          delete next.setup[task.id];
          before.forEach((u) => delete next.done[u.id]);
        } else {
          const raw = body.setup as Record<string, unknown>;
          const made = makeSetup(task.split, raw?.a, raw?.b);
          if (typeof made === "string") return fail(400, made);
          const keep = current.setup[task.id]?.per === made.per;
          next.setup[task.id] = made;
          delete next.skip[task.id];
          const after = new Set(unitsOf(task, made).map((u) => u.id));
          before.forEach((u) => (!keep || !after.has(u.id)) && delete next.done[u.id]);
        }
        link = task.score;
      } else if (unit !== undefined) {
        const u = unitsOf(task, current.setup[task.id])[(unit as number) - 1];
        if (!u) return fail(404, "not found");
        if (hasScore && !task.score) return fail(400, "this task doesn't take scores");
        if (done === false) delete next.done[u.id];
        else mark(u.id);
        link = task.score;
      } else {
        if (unitsOf(task, current.setup[task.id]).length) {
          return fail(400, "tick this task's parts instead");
        }
        if (hasScore && !task.score) return fail(400, "this task doesn't take scores");
        if (done === false) delete next.done[task.id];
        else mark(task.id);
        link = task.score;
      }

      if (link) pill = pillValue(tracker, next, link);
      return next;
    });

    if (problem) {
      const p = problem as { status: number; error: string };
      return NextResponse.json({ error: p.error }, { status: p.status });
    }
    if (!state) return NextResponse.json({ error: "not found" }, { status: 404 });

    // The pill on Check-in follows the running average. When every score is
    // cleared the pill is left alone; it may have been typed on Check-in.
    const l = link as ScoreLink | null;
    const value = pill as number | null;
    if (l && value !== null && studentId) {
      await updateRoster((students) => {
        let found = false;
        const next = students.map((s) => {
          if (s.id !== studentId) return s;
          found = true;
          const bucket = { ...s.progress[l.kind] } as Record<string, number>;
          if (bucket[l.key] === value) return s;
          bucket[l.key] = value;
          return { ...s, progress: { ...s.progress, [l.kind]: bucket } };
        });
        return found ? next : null;
      });
    }

    return NextResponse.json({ state, pill: value });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
