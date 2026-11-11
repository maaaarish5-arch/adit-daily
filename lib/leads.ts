// Leads logged from chat — Adit's Corner → Daily Flow → High leverage.
//
// Two kinds, both typed by hand the moment they happen:
//   · Vault sale on chat — who, how to reach them, how they paid, how much.
//   · Mentorship lead from DMs — reactivated or converted: who and how to reach them.
//
// Kept beside the sales calls (Sales Calendar → "From chat & DMs"), not mixed
// into them: these were never calls, so they must not move show-up or close
// rates. Append-only (a Redis list), so two people logging at once never
// overwrite each other.

export const LEAD_KINDS = [
  { id: "vault", label: "Vault sale on chat" },
  { id: "mentorship", label: "Mentorship lead from DMs" },
] as const;
export type LeadKind = (typeof LEAD_KINDS)[number]["id"];

export type Lead = {
  id: string;
  kind: LeadKind;
  /** ISO instant it was logged. */
  at: string;
  /** YYYY-MM-DD it was logged on (the device's day). */
  date: string;
  name: string;
  email: string;
  phone: string;
  /** Vault sales only. */
  payMode: string;
  /** Vault sales only — as typed, currency included ("$300", "₹25,000"). */
  amount: string;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function cleanLead(raw: unknown): Lead | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const kind = LEAD_KINDS.some((k) => k.id === r.kind) ? (r.kind as LeadKind) : null;
  const name = s(r.name, 120);
  if (!kind || !name) return null;
  const at = s(r.at, 40) || new Date().toISOString();
  return {
    id: s(r.id, 40) || `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    kind,
    at,
    date: DAY_RE.test(s(r.date, 10)) ? s(r.date, 10) : at.slice(0, 10),
    name,
    email: s(r.email, 160),
    phone: s(r.phone, 40),
    payMode: kind === "vault" ? s(r.payMode, 80) : "",
    amount: kind === "vault" ? s(r.amount, 40) : "",
  };
}

export const leadKindLabel = (k: LeadKind) => LEAD_KINDS.find((x) => x.id === k)?.label ?? k;
