"use client";

// Adit's Corner → Daily Flow → High leverage. Two note-style forms: a Vault
// sale closed on chat, and a Mentorship lead reactivated or converted from DMs.
// Each "Save" appends one record to the leads list (/api/leads), which the
// Sales Calendar shows under "From chat & DMs".
//
// Reading the list back needs the sales passcode (emails and phone numbers);
// without it, only what was saved from this page today is shown.

import { useCallback, useEffect, useState } from "react";
import { LEAD_KINDS, type Lead, type LeadKind } from "@/lib/leads";

const PASSCODE_KEY = "adit-daily:passcode";
const SALES_KEY = "adit-daily:sales-passcode";

const readKey = (k: string) => {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
};

type Draft = { name: string; email: string; phone: string; payMode: string; amount: string };
const EMPTY: Draft = { name: "", email: "", phone: "", payMode: "", amount: "" };

/** The fields each form asks for, in order. */
const FIELDS: Record<LeadKind, { key: keyof Draft; label: string; placeholder: string }[]> = {
  vault: [
    { key: "name", label: "Lead name", placeholder: "Who bought" },
    { key: "email", label: "Email / phone number", placeholder: "How to reach them" },
    { key: "payMode", label: "Mode of payment", placeholder: "UPI, card, PayPal…" },
    { key: "amount", label: "Amount", placeholder: "With currency — $300, ₹25,000" },
  ],
  mentorship: [
    { key: "name", label: "Lead name", placeholder: "Who it is" },
    { key: "email", label: "Email", placeholder: "Their email" },
    { key: "phone", label: "Phone number", placeholder: "Their phone number" },
  ],
};

export default function LeadForms({
  date,
  onLeads,
}: {
  date: string;
  /** Today's leads, for the close-out report. */
  onLeads?: (leads: Lead[]) => void;
}) {
  const [drafts, setDrafts] = useState<Record<LeadKind, Draft>>({ vault: EMPTY, mentorship: EMPTY });
  const [saved, setSaved] = useState<Lead[]>([]);
  const [busy, setBusy] = useState<LeadKind | null>(null);
  const [error, setError] = useState<Record<LeadKind, string>>({ vault: "", mentorship: "" });

  // With the sales passcode on this device, read back what is already logged.
  const load = useCallback(() => {
    const key = readKey(SALES_KEY);
    if (!key) return;
    fetch("/api/leads", { cache: "no-store", headers: { "x-sales-passcode": key } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (Array.isArray(d?.leads)) setSaved(d.leads as Lead[]);
      })
      .catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  const today = saved.filter((l) => l.date === date);
  useEffect(() => onLeads?.(today), [today.length, date]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (kind: LeadKind, key: keyof Draft, value: string) =>
    setDrafts((d) => ({ ...d, [kind]: { ...d[kind], [key]: value } }));

  const submit = (kind: LeadKind) => {
    const d = drafts[kind];
    if (!d.name.trim()) {
      setError((e) => ({ ...e, [kind]: "A lead name is needed." }));
      return;
    }
    setBusy(kind);
    setError((e) => ({ ...e, [kind]: "" }));
    fetch("/api/leads", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-passcode": readKey(PASSCODE_KEY),
        "x-sales-passcode": readKey(SALES_KEY),
      },
      body: JSON.stringify({ lead: { kind, date, ...d } }),
    })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok || !body.lead) throw new Error(body.error || "Not saved");
        setSaved((s) => [...s, body.lead as Lead]);
        setDrafts((x) => ({ ...x, [kind]: EMPTY }));
      })
      .catch((err: Error) =>
        setError((e) => ({
          ...e,
          [kind]: err.message === "wrong passcode" ? "Not saved — the app passcode is missing on this device." : `Not saved — ${err.message}.`,
        }))
      )
      .finally(() => setBusy(null));
  };

  return (
    <section className="section leads">
      <div className="section-head">
        <h2>High leverage</h2>
        <span className="hair" />
        <span className="tally" data-complete={String(today.length > 0)}>
          {today.length} logged
        </span>
      </div>
      <p className="hint leads-hint">
        Rewarding work on top of the bare minimum. Each save goes into the sales database
        (Sales Calendar → From chat &amp; DMs). Not part of the score.
      </p>

      {LEAD_KINDS.map((k) => {
        const mine = today.filter((l) => l.kind === k.id);
        return (
          <div className="lead-form" key={k.id}>
            <h3>{k.id === "vault" ? "Vault sales on chat" : "Mentorship reactivation and conversion from DMs"}</h3>
            <div className="lead-fields">
              {FIELDS[k.id].map((f) => (
                <label key={f.key}>
                  <span>{f.label}</span>
                  <input
                    value={drafts[k.id][f.key]}
                    placeholder={f.placeholder}
                    onChange={(e) => set(k.id, f.key, e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submit(k.id)}
                  />
                </label>
              ))}
            </div>
            <div className="lead-actions">
              <button className="btn" onClick={() => submit(k.id)} disabled={busy === k.id}>
                {busy === k.id ? "Saving…" : "Save to sales"}
              </button>
              {error[k.id] && <span className="lead-error">{error[k.id]}</span>}
            </div>
            {mine.length > 0 && (
              <ul className="lead-list">
                {mine.map((l) => (
                  <li key={l.id}>
                    <b>{l.name}</b>
                    {[l.email, l.phone, l.payMode, l.amount].filter(Boolean).map((v, i) => (
                      <span key={i}> · {v}</span>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
