"use client";

// Sales Calendar → From chat & DMs. The leads Adit logs from his Corner (Vault
// sales closed on chat, Mentorship leads from DMs), newest first. Read-only
// here; kept beside the calls rather than among them, so they never move the
// show-up or close numbers.

import { useEffect, useMemo, useState } from "react";
import { LEAD_KINDS, type Lead, type LeadKind } from "@/lib/leads";
import { longDate } from "@/lib/date";

export default function ChatLeads({ pass }: { pass: string }) {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [kind, setKind] = useState<LeadKind | "all">("all");

  useEffect(() => {
    fetch("/api/leads", { cache: "no-store", headers: { "x-sales-passcode": pass } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setLeads(Array.isArray(d?.leads) ? d.leads : []))
      .catch(() => setLeads([]));
  }, [pass]);

  const shown = useMemo(
    () =>
      (leads ?? [])
        .filter((l) => kind === "all" || l.kind === kind)
        .sort((a, b) => b.at.localeCompare(a.at)),
    [leads, kind]
  );

  return (
    <section className="fu chat-leads" aria-label="From chat and DMs">
      <div className="fu-head">
        <h3>From chat &amp; DMs</h3>
        <span className="fu-count">
          {leads === null ? "Loading…" : `${shown.length} logged`}
        </span>
        <div className="sales-period" role="radiogroup" aria-label="Kind">
          {([{ id: "all", label: "All" }, ...LEAD_KINDS] as { id: LeadKind | "all"; label: string }[]).map(
            (k) => (
              <button
                key={k.id}
                role="radio"
                aria-checked={kind === k.id}
                data-on={String(kind === k.id)}
                onClick={() => setKind(k.id)}
              >
                {k.id === "all" ? "All" : k.id === "vault" ? "Vault sales" : "Mentorship"}
              </button>
            )
          )}
        </div>
      </div>
      {leads !== null && shown.length === 0 ? (
        <p className="fu-missing">Nothing logged yet — Adit logs these from his Corner.</p>
      ) : (
        <ul>
          {shown.map((l) => (
            <li className="fu-row" key={l.id}>
              <div className="fu-main">
                <span className="fu-name">{l.name}</span>
                <span className="fu-when">
                  {l.kind === "vault" ? "Vault sale on chat" : "Mentorship lead from DMs"} ·{" "}
                  {longDate(l.date)}
                </span>
                {(l.payMode || l.amount) && (
                  <span className="fu-next">{[l.amount, l.payMode].filter(Boolean).join(" · ")}</span>
                )}
              </div>
              <div className="fu-contact">
                {l.email && <span>{l.email}</span>}
                {l.phone && <span>{l.phone}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
