import { NextResponse } from "next/server";
import { addLead, getLeads } from "@/lib/store";
import { cleanLead } from "@/lib/leads";
import { salesAuthorized } from "@/lib/sales-auth";

export const dynamic = "force-dynamic";

/** Logging a lead needs the app passcode (Adit's Corner) or the sales one. */
function canWrite(req: Request): boolean {
  if (salesAuthorized(req)) return true;
  const expected = process.env.APP_PASSCODE;
  if (!expected) return true;
  return req.headers.get("x-passcode") === expected;
}

/** Leads hold emails and phone numbers, so reading them needs the sales passcode. */
export async function GET(req: Request) {
  if (!salesAuthorized(req)) return NextResponse.json({ error: "locked" }, { status: 401 });
  try {
    return NextResponse.json({ leads: await getLeads() });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** { lead: { kind, name, email, phone, payMode, amount, date } } appends one. */
export async function POST(req: Request) {
  if (!canWrite(req)) return NextResponse.json({ error: "wrong passcode" }, { status: 401 });
  let body: { lead?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const raw = (body.lead && typeof body.lead === "object" ? body.lead : {}) as Record<string, unknown>;
  // The server stamps id and time; the page only says what and which day.
  const lead = cleanLead({ ...raw, id: "", at: new Date().toISOString() });
  if (!lead) return NextResponse.json({ error: "a name is needed" }, { status: 400 });
  try {
    return NextResponse.json({ lead: await addLead(lead) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
