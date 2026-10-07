import { NextResponse } from "next/server";
import { updateRoster } from "@/lib/store";
import { NBMES, SYSTEMS, cleanPct } from "@/lib/progress";

export const dynamic = "force-dynamic";

/** Same gate as the roster route: open unless APP_PASSCODE is set. */
function authorized(req: Request): boolean {
  const expected = process.env.APP_PASSCODE;
  if (!expected) return true;
  return req.headers.get("x-passcode") === expected;
}

const KEYS = {
  sys: new Set<string>(SYSTEMS.map((s) => s.id)),
  nbme: new Set<string>(NBMES.map(String)),
};

/** Change one pill for one student: { id, kind: "sys" | "nbme", key, pct }.
 *  `pct` null clears it (not done). Touches nothing else on the roster. */
export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "wrong passcode" }, { status: 401 });
  }

  let body: { id?: unknown; kind?: unknown; key?: unknown; pct?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const { id, kind, key } = body;
  if (typeof id !== "string" || (kind !== "sys" && kind !== "nbme") || typeof key !== "string") {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (!KEYS[kind].has(key)) {
    return NextResponse.json({ error: "unknown pill" }, { status: 400 });
  }
  const pct = body.pct === null ? null : cleanPct(body.pct);
  if (body.pct !== null && pct === null) {
    return NextResponse.json({ error: "enter a number from 0 to 100" }, { status: 400 });
  }

  try {
    let found = false;
    const saved = await updateRoster((students) => {
      const next = students.map((s) => {
        if (s.id !== id) return s;
        found = true;
        const bucket = { ...s.progress[kind] } as Record<string, number>;
        if (pct === null) delete bucket[key];
        else bucket[key] = pct;
        return { ...s, progress: { ...s.progress, [kind]: bucket } };
      });
      return found ? next : null; // unknown student: write nothing
    });
    if (!found) return NextResponse.json({ error: "student not found" }, { status: 404 });
    const student = saved.students.find((s) => s.id === id);
    return NextResponse.json({ progress: student?.progress });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
