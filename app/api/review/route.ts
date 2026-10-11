import { NextResponse } from "next/server";
import { updateRoster } from "@/lib/store";
import { REVIEW_MAX } from "@/lib/roster";

export const dynamic = "force-dynamic";

/** Same gate as the roster route: open unless APP_PASSCODE is set. */
function authorized(req: Request): boolean {
  const expected = process.env.APP_PASSCODE;
  if (!expected) return true;
  return req.headers.get("x-passcode") === expected;
}

/** One student's written review after the exam. Touches nothing else.
 *    { id, asked: true | false }        — the review was (or wasn't) asked for
 *    { id, done: true, text? }          — the review came in, optionally pasted
 *    { id, done: false }                — undo "received"
 *  Everything is stamped against the student's current exam date. */
export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "wrong passcode" }, { status: 401 });
  }

  let body: { id?: unknown; asked?: unknown; done?: unknown; text?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const { id, asked, done, text } = body;
  if (
    typeof id !== "string" ||
    (typeof asked !== "boolean" && typeof done !== "boolean") ||
    (text !== undefined && typeof text !== "string")
  ) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const now = new Date().toISOString();
  try {
    let found = false;
    let noExam = false;
    const saved = await updateRoster((students) => {
      const next = students.map((s) => {
        if (s.id !== id) return s;
        found = true;
        if (!s.examDate) {
          noExam = true;
          return s;
        }
        // A new exam date starts the review over.
        const same = s.reviewFor === s.examDate;
        const r = {
          reviewFor: s.examDate,
          reviewAskedAt: same ? s.reviewAskedAt : "",
          reviewDoneAt: same ? s.reviewDoneAt : "",
          review: same ? s.review : "",
        };
        if (typeof asked === "boolean") r.reviewAskedAt = asked ? r.reviewAskedAt || now : "";
        if (done === true) {
          r.reviewDoneAt = now;
          r.reviewAskedAt ||= now;
          if (typeof text === "string") r.review = text.slice(0, REVIEW_MAX);
        } else if (done === false) {
          r.reviewDoneAt = "";
        }
        return { ...s, ...r };
      });
      return found && !noExam ? next : null;
    });
    if (!found) return NextResponse.json({ error: "student not found" }, { status: 404 });
    if (noExam) return NextResponse.json({ error: "no exam date set" }, { status: 400 });
    const s = saved.students.find((x) => x.id === id)!;
    return NextResponse.json({
      reviewFor: s.reviewFor,
      reviewAskedAt: s.reviewAskedAt,
      reviewDoneAt: s.reviewDoneAt,
      review: s.review,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
