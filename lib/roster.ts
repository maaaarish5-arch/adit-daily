// The student roster — the monthly tracker, made live.
//
// Adit edits it, Dr. Marish opens the same URL and sees the same rows. It lives
// in Redis under one key, next to the daily ticks.

export const STATUSES = [
  "Active",
  "Paused",
  "Completed",
  "Left",
  "Pending",
] as const;
export type Status = (typeof STATUSES)[number];

export const PAYMENTS = ["Paid", "Partial", "Pending", "Overdue"] as const;
export type Payment = (typeof PAYMENTS)[number];

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export const CURRENCIES = ["USD", "INR"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** One scheduled payment: what is owed, when, and whether it has landed. */
export type Installment = {
  id: string;
  amount: number;
  /** YYYY-MM-DD. Empty when no date has been set yet. */
  due: string;
  paid: boolean;
  /** YYYY-MM-DD — when it actually landed, which is not always the due date. */
  paidOn: string;
};

export type Student = {
  id: string;
  name: string;
  /** Month they joined. */
  month: string;
  status: Status;
  currency: Currency;
  /** The full fee agreed in the contract. */
  total: number;
  installments: Installment[];
  /** Legacy free-typed fields, kept so nothing entered before the rebuild is
   *  lost. Used only when a student has no total and no instalments yet. */
  payment: Payment;
  remaining: number;
  notes: string;
};

export type Roster = { students: Student[]; updatedAt: string | null };

export const EMPTY_ROSTER: Roster = { students: [], updatedAt: null };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanDate(v: unknown): string {
  return typeof v === "string" && DATE_RE.test(v) ? v : "";
}

function cleanMoney(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 100_000_000) : 0;
}

function cleanInstallment(raw: unknown, i: number): Installment | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    id: typeof r.id === "string" && r.id ? r.id.slice(0, 40) : `i${i}`,
    amount: cleanMoney(r.amount),
    due: cleanDate(r.due),
    paid: r.paid === true,
    paidOn: cleanDate(r.paidOn),
  };
}

/** Sanitise one row coming off the wire or out of the store. */
export function cleanStudent(raw: unknown, index: number): Student | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id =
    typeof r.id === "string" && r.id ? r.id.slice(0, 40) : `s${index}-${Date.now()}`;
  const status = STATUSES.includes(r.status as Status)
    ? (r.status as Status)
    : "Active";
  const payment = PAYMENTS.includes(r.payment as Payment)
    ? (r.payment as Payment)
    : "Pending";
  const installments = Array.isArray(r.installments)
    ? (r.installments
        .slice(0, 24)
        .map((x, i) => cleanInstallment(x, i))
        .filter(Boolean) as Installment[])
    : [];
  return {
    id,
    name: typeof r.name === "string" ? r.name.slice(0, 120) : "",
    month: MONTHS.includes(r.month as (typeof MONTHS)[number])
      ? (r.month as string)
      : MONTHS[new Date().getMonth()],
    status,
    currency: CURRENCIES.includes(r.currency as Currency)
      ? (r.currency as Currency)
      : "USD",
    total: cleanMoney(r.total),
    installments,
    payment,
    remaining: cleanMoney(r.remaining),
    notes: typeof r.notes === "string" ? r.notes.slice(0, 2000) : "",
  };
}

export function cleanRoster(raw: unknown): Student[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 500)
    .map((s, i) => cleanStudent(s, i))
    .filter(Boolean) as Student[];
}

export function blankStudent(): Student {
  return {
    // Random enough for a roster; the store is last-write-wins either way.
    id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    name: "",
    month: MONTHS[new Date().getMonth()],
    status: "Active",
    currency: "USD",
    total: 0,
    installments: [],
    payment: "Pending",
    remaining: 0,
    notes: "",
  };
}

export function blankInstallment(): Installment {
  return {
    id: `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    amount: 0,
    due: "",
    paid: false,
    paidOn: "",
  };
}

export function money(n: number, currency: Currency = "USD"): string {
  // INR groups in lakhs, which is how the amounts actually arrive from students.
  if (currency === "INR") return `\u20B9${n.toLocaleString("en-IN")}`;
  return `$${n.toLocaleString("en-US")}`;
}

export function today(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** "18 September 2026" — readable, unambiguous about which number is the day. */
export function longDay(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/* ------------------------------ derived money ----------------------------- */

export type PaymentSummary = {
  /** The agreed fee. */
  total: number;
  /** Sum of instalments marked paid. */
  paid: number;
  /** What is still owed. */
  remaining: number;
  status: Payment;
  /** Next unpaid instalment with a date, soonest first. */
  nextDue: Installment | null;
  /** Unpaid instalments whose date has passed. */
  overdue: Installment[];
  /** True when nothing has been structured yet and we are reading legacy fields. */
  legacy: boolean;
};

/**
 * Status and balance are DERIVED, never typed by hand. That is the whole point
 * of the rebuild: it was previously possible to mark someone Paid while leaving
 * a balance sitting next to their name, and several rows did exactly that.
 */
export function summarise(s: Student): PaymentSummary {
  const structured = s.total > 0 || s.installments.length > 0;

  if (!structured) {
    return {
      total: 0,
      paid: 0,
      remaining: s.remaining,
      status: s.payment,
      nextDue: null,
      overdue: [],
      legacy: true,
    };
  }

  const paid = s.installments
    .filter((i) => i.paid)
    .reduce((sum, i) => sum + i.amount, 0);

  // The fee is whatever was agreed; if no total was set, the instalments are it.
  const scheduled = s.installments.reduce((sum, i) => sum + i.amount, 0);
  const total = s.total > 0 ? s.total : scheduled;
  const remaining = Math.max(0, total - paid);

  const t = today();
  const unpaid = s.installments.filter((i) => !i.paid);
  const overdue = unpaid.filter((i) => i.due && i.due < t);
  const nextDue =
    unpaid
      .filter((i) => i.due)
      .sort((a, b) => a.due.localeCompare(b.due))[0] ?? null;

  let status: Payment;
  if (remaining <= 0 && total > 0) status = "Paid";
  else if (overdue.length) status = "Overdue";
  else if (paid > 0) status = "Partial";
  else status = "Pending";

  return { total, paid, remaining, status, nextDue, overdue, legacy: false };
}

export type Totals = {
  students: number;
  active: number;
  owedBy: number;
  paid: number;
  /** Outstanding is kept per currency — summing dollars and rupees would be a lie. */
  outstanding: Record<Currency, number>;
};

export function totals(students: Student[]): Totals {
  const outstanding: Record<Currency, number> = { USD: 0, INR: 0 };
  let owedBy = 0;
  let paidUp = 0;

  for (const s of students) {
    const sum = summarise(s);
    outstanding[s.currency] += sum.remaining;
    if (sum.status === "Paid") paidUp += 1;
    else owedBy += 1;
  }

  return {
    students: students.length,
    active: students.filter((s) => s.status === "Active").length,
    owedBy,
    paid: paidUp,
    outstanding,
  };
}

/** "$7,265 · ₹2,07,000" — only the currencies actually in play. */
export function outstandingLabel(t: Totals): string {
  const parts = CURRENCIES.filter((c) => t.outstanding[c] > 0).map((c) =>
    money(t.outstanding[c], c)
  );
  return parts.length ? parts.join(" · ") : "$0";
}
