import { NextResponse } from "next/server";
import { addManualMeeting, editMeeting, getSalesSync, salesAll } from "@/lib/store";
import { cleanEdit, cleanMeeting, istDate } from "@/lib/sales";
import { salesAuthorized } from "@/lib/sales-auth";

export const dynamic = "force-dynamic";

const locked = () => NextResponse.json({ error: "locked" }, { status: 401 });

/** Every meeting plus when the calendar was last read. The page does the
 *  day filter, search and numbers itself. */
export async function GET(req: Request) {
  if (!salesAuthorized(req)) return locked();
  try {
    const [meetings, sync] = await Promise.all([salesAll(), getSalesSync()]);
    return NextResponse.json({ meetings, sync });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** { id, edit } changes one meeting. { add: { name, email, whatsapp, start } } logs one by hand. */
export async function POST(req: Request) {
  if (!salesAuthorized(req)) return locked();
  let body: { id?: unknown; edit?: unknown; add?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  try {
    if (body.add && typeof body.add === "object") {
      const a = body.add as Record<string, unknown>;
      const start = typeof a.start === "string" && !Number.isNaN(Date.parse(a.start)) ? new Date(a.start).toISOString() : "";
      if (!start) return NextResponse.json({ error: "a date and time are needed" }, { status: 400 });
      const m = cleanMeeting({
        id: `manual:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        date: istDate(start),
        start,
        manual: true,
        ...cleanEdit(a),
        updatedAt: new Date().toISOString(),
      });
      if (!m) return NextResponse.json({ error: "bad meeting" }, { status: 400 });
      return NextResponse.json({ meeting: await addManualMeeting(m) });
    }
    if (typeof body.id !== "string") return NextResponse.json({ error: "bad request" }, { status: 400 });
    const meeting = await editMeeting(body.id, cleanEdit(body.edit));
    if (!meeting) return NextResponse.json({ error: "meeting not found" }, { status: 404 });
    return NextResponse.json({ meeting });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
