"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DateField from "./date-field";
import {
  CURRENCIES,
  MONTHS,
  PAYMENTS,
  STATUSES,
  blankInstallment,
  blankStudent,
  longDay,
  money,
  outstandingLabel,
  summarise,
  today,
  totals,
  type Currency,
  type Installment,
  type Status,
  type Student,
} from "@/lib/roster";

type SyncState = "idle" | "saving" | "saved" | "error";

const PASSCODE_KEY = "adit-daily:passcode";

export default function RosterView() {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [sync, setSync] = useState<SyncState>("idle");
  const [storeError, setStoreError] = useState<string | null>(null);

  const [monthFilter, setMonthFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [openPay, setOpenPay] = useState<string | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True from the moment a field is edited until that edit is safely saved. */
  const pending = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  /* --------------------------------- loading -------------------------------- */

  const load = useCallback((initial = false) => {
    fetch("/api/roster", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setStoreError(d.error ?? null);
        // Never overwrite what someone is mid-way through typing.
        if (!pending.current) setStudents(d.students ?? []);
        if (initial) setLoading(false);
      })
      .catch(() => {
        if (initial) setLoading(false);
      });
  }, []);

  useEffect(() => {
    load(true);
  }, [load]);

  // Poll so Dr. Marish sees Adit's edits without reloading — but hold off while
  // there are unsaved changes, or while a field in here has the cursor in it.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      if (pending.current) return;
      const active = document.activeElement;
      if (active && rootRef.current?.contains(active)) return;
      load();
    };
    const id = setInterval(refresh, 15_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  /* --------------------------------- saving --------------------------------- */

  const save = useCallback((next: Student[]) => {
    setSync("saving");
    fetch("/api/roster", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-passcode": localStorage.getItem(PASSCODE_KEY) ?? "",
      },
      body: JSON.stringify({ students: next }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("save failed");
        pending.current = false;
        setSync("saved");
      })
      .catch(() => setSync("error"));
  }, []);

  const commit = useCallback(
    (next: Student[]) => {
      pending.current = true;
      setStudents(next);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save(next), 600);
    },
    [save]
  );

  const update = useCallback(
    (id: string, patch: Partial<Student>) => {
      setStudents((prev) => {
        const next = prev.map((s) => (s.id === id ? { ...s, ...patch } : s));
        pending.current = true;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => save(next), 600);
        return next;
      });
    },
    [save]
  );

  /* ---------------------------- instalment edits ---------------------------- */

  const patchInstallment = useCallback(
    (studentId: string, instId: string, patch: Partial<Installment>) => {
      setStudents((prev) => {
        const next = prev.map((s) =>
          s.id !== studentId
            ? s
            : {
                ...s,
                installments: s.installments.map((i) =>
                  i.id === instId ? { ...i, ...patch } : i
                ),
              }
        );
        pending.current = true;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => save(next), 600);
        return next;
      });
    },
    [save]
  );

  const addInstallment = useCallback(
    (studentId: string) => {
      setStudents((prev) => {
        const next = prev.map((s) =>
          s.id !== studentId
            ? s
            : { ...s, installments: [...s.installments, blankInstallment()] }
        );
        pending.current = true;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => save(next), 600);
        return next;
      });
    },
    [save]
  );

  const removeInstallment = useCallback(
    (studentId: string, instId: string) => {
      setStudents((prev) => {
        const next = prev.map((s) =>
          s.id !== studentId
            ? s
            : { ...s, installments: s.installments.filter((i) => i.id !== instId) }
        );
        pending.current = true;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => save(next), 600);
        return next;
      });
    },
    [save]
  );

  const addStudent = () => {
    const fresh = blankStudent();
    if (monthFilter !== "all") fresh.month = monthFilter;
    commit([...students, fresh]);
    // Put the cursor straight in the new name field.
    setTimeout(() => {
      rootRef.current
        ?.querySelector<HTMLInputElement>(`[data-name-for="${fresh.id}"]`)
        ?.focus();
    }, 30);
  };

  const removeStudent = (id: string) => {
    const s = students.find((x) => x.id === id);
    const label = s?.name?.trim() || "this unnamed row";
    if (!confirm(`Remove ${label} from the tracker? This cannot be undone.`)) return;
    commit(students.filter((x) => x.id !== id));
  };

  /* --------------------------------- derived -------------------------------- */

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students.filter((s) => {
      if (monthFilter !== "all" && s.month !== monthFilter) return false;
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      const pay = summarise(s).status;
      if (paymentFilter === "owing") {
        // Everyone who still owes anything, whatever the label says.
        if (pay === "Paid") return false;
      } else if (paymentFilter !== "all" && pay !== paymentFilter) {
        return false;
      }
      if (q && !`${s.name} ${s.notes}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [students, monthFilter, statusFilter, paymentFilter, query]);

  const all = totals(students);
  const view = totals(shown);
  const filtered = shown.length !== students.length;

  /* --------------------------------- render --------------------------------- */

  return (
    <div className="roster" ref={rootRef}>
      <div className="roster-head">
        <div>
          <h2>Students</h2>
          <p className="hint">
            Adit edits, Dr. Marish sees the same rows. Saves as you type, refreshes
            on its own.
          </p>
        </div>
        <span className="roster-sync">
          <span className="sync-dot" data-state={sync} />
          {sync === "saving"
            ? "Saving"
            : sync === "error"
              ? "Not saved"
              : sync === "saved"
                ? "Saved"
                : "Synced"}
        </span>
      </div>

      {storeError && (
        <div className="lock">
          <span>Storage not connected — changes will not save</span>
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <b>{all.students}</b>
          <span>on the tracker</span>
        </div>
        <div className="stat">
          <b>{all.active}</b>
          <span>active</span>
        </div>
        <div className="stat">
          <b>{all.paid}</b>
          <span>paid up</span>
        </div>
        <div className="stat" data-flag={String(all.owedBy > 0)}>
          <b>{all.owedBy}</b>
          <span>still owing</span>
        </div>
        <div
          className="stat"
          data-flag={String(all.outstanding.USD + all.outstanding.INR > 0)}
        >
          <b className="stat-money">{outstandingLabel(all)}</b>
          <span>outstanding</span>
        </div>
      </div>

      <div className="filters">
        <input
          className="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or notes…"
        />
        <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
          <option value="all">All months</option>
          {MONTHS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          className="pay-filter"
          data-on={String(paymentFilter !== "all")}
          value={paymentFilter}
          onChange={(e) => setPaymentFilter(e.target.value)}
          aria-label="Filter by payment status"
        >
          <option value="all">All payments</option>
          <option value="owing">Owing — anyone not paid</option>
          {PAYMENTS.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <button className="btn" onClick={addStudent}>
          + Add student
        </button>
      </div>

      {loading ? (
        <p className="skeleton">Loading the tracker…</p>
      ) : students.length === 0 ? (
        <p className="empty">
          Nobody on the tracker yet. Hit <b>Add student</b> — every student you
          onboard goes in here the same day.
        </p>
      ) : shown.length === 0 ? (
        <p className="empty">No students match that filter.</p>
      ) : (
        <>
          <div className="table-scroll">
          <div className="grid-head">
            <span>Name</span>
            <span>Month</span>
            <span>Status</span>
            <span>Payment</span>
            <span>Remaining</span>
            <span>Notes</span>
            <span />
          </div>

          {shown.map((s) => {
            const sum = summarise(s);
            const payOpen = openPay === s.id;
            return (
            <div key={s.id} className="student">
            <div className="grid-row" data-payment={sum.status} data-open={String(payOpen)}>
              <input
                className="cell name"
                data-name-for={s.id}
                value={s.name}
                onChange={(e) => update(s.id, { name: e.target.value })}
                placeholder="Student name"
              />

              <select
                className="cell"
                value={s.month}
                onChange={(e) => update(s.id, { month: e.target.value })}
                aria-label="Month joined"
              >
                {MONTHS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>

              <select
                className="cell tag"
                data-status={s.status}
                value={s.status}
                onChange={(e) =>
                  update(s.id, { status: e.target.value as Status })
                }
                aria-label="Status"
              >
                {STATUSES.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>

              <button
                className="cell tag pay-chip"
                data-payment={sum.status}
                onClick={() => setOpenPay(openPay === s.id ? null : s.id)}
                aria-expanded={openPay === s.id}
                title="Open the payment plan"
              >
                {sum.status}
              </button>

              <button
                className="cell amount-read"
                data-zero={String(sum.remaining === 0)}
                onClick={() => setOpenPay(openPay === s.id ? null : s.id)}
                title="Open the payment plan"
              >
                {money(sum.remaining, s.currency)}
              </button>

              <input
                className="cell notes"
                value={s.notes}
                onChange={(e) => update(s.id, { notes: e.target.value })}
                placeholder="Instalment dates, exam target, anything worth remembering…"
              />

              <button
                className="remove"
                onClick={() => removeStudent(s.id)}
                aria-label={`Remove ${s.name || "student"}`}
                title="Remove from tracker"
              >
                ×
              </button>
            </div>

            {payOpen && (
              <div className="paypanel">
                <div className="paypanel-head">
                  <label className="pp-field">
                    <span>Currency</span>
                    <select
                      value={s.currency}
                      onChange={(e) =>
                        update(s.id, { currency: e.target.value as Currency })
                      }
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>

                  <label className="pp-field">
                    <span>Full fee</span>
                    <input
                      type="number"
                      min={0}
                      value={s.total || ""}
                      onChange={(e) =>
                        update(s.id, { total: Math.max(0, Number(e.target.value) || 0) })
                      }
                      placeholder="0"
                    />
                  </label>

                  <div className="pp-read">
                    <span>Paid</span>
                    <b>{money(sum.paid, s.currency)}</b>
                  </div>
                  <div className="pp-read">
                    <span>Remaining</span>
                    <b data-owed={String(sum.remaining > 0)}>
                      {money(sum.remaining, s.currency)}
                    </b>
                  </div>
                  <div className="pp-read">
                    <span>Status</span>
                    <b className="pp-status" data-payment={sum.status}>
                      {sum.status}
                    </b>
                  </div>
                </div>

                {(() => {
                  const scheduled = s.installments.reduce((a, i) => a + i.amount, 0);
                  const gap = s.total - scheduled;
                  if (!s.total || !s.installments.length || gap === 0) return null;
                  return (
                    <p className="pp-mismatch">
                      Instalments come to {money(scheduled, s.currency)}, but the full
                      fee is {money(s.total, s.currency)} —{" "}
                      {gap > 0
                        ? `${money(gap, s.currency)} of the fee is not scheduled yet.`
                        : `${money(-gap, s.currency)} more is scheduled than the fee.`}
                    </p>
                  );
                })()}

                {sum.nextDue && (
                  <p className="pp-next" data-late={String(sum.overdue.length > 0)}>
                    {sum.overdue.length > 0 ? "Overdue: " : "Next due: "}
                    <b>{money(sum.nextDue.amount, s.currency)}</b> on{" "}
                    <b>{longDay(sum.nextDue.due)}</b>
                    {sum.overdue.length > 1 &&
                      ` · ${sum.overdue.length} instalments past their date`}
                  </p>
                )}

                <div className="inst-head">
                  <span>#</span>
                  <span>Amount</span>
                  <span>Due date</span>
                  <span>Paid</span>
                  <span>Paid on</span>
                  <span />
                </div>

                {s.installments.length === 0 && (
                  <p className="pp-empty">
                    No instalments yet. Add one for each payment in their contract —
                    amount and the date it falls due.
                  </p>
                )}

                {s.installments.map((inst, idx) => {
                  const late = !inst.paid && inst.due && inst.due < today();
                  return (
                    <div className="inst-row" key={inst.id} data-late={String(Boolean(late))}>
                      <span className="inst-n">{idx + 1}</span>

                      <label className="inst-amount">
                        <span>{s.currency === "INR" ? "\u20B9" : "$"}</span>
                        <input
                          type="number"
                          min={0}
                          value={inst.amount || ""}
                          onChange={(e) =>
                            patchInstallment(s.id, inst.id, {
                              amount: Math.max(0, Number(e.target.value) || 0),
                            })
                          }
                          placeholder="0"
                          aria-label={`Instalment ${idx + 1} amount`}
                        />
                      </label>

                      <DateField
                        value={inst.due}
                        onCommit={(due) => patchInstallment(s.id, inst.id, { due })}
                        ariaLabel={`Instalment ${idx + 1} due date`}
                      />

                      <button
                        className="inst-paid"
                        data-on={String(inst.paid)}
                        aria-pressed={inst.paid}
                        onClick={() =>
                          patchInstallment(s.id, inst.id, {
                            paid: !inst.paid,
                            // Tick it and it is assumed to have landed today;
                            // the date stays editable for back-dated payments.
                            paidOn: !inst.paid ? inst.paidOn || today() : "",
                          })
                        }
                      >
                        {inst.paid ? "Paid" : "Mark paid"}
                      </button>

                      <DateField
                        value={inst.paidOn}
                        onCommit={(paidOn) =>
                          // Putting a date in is itself the statement that it
                          // landed — no need to press Mark paid as well.
                          patchInstallment(s.id, inst.id, {
                            paidOn,
                            paid: paidOn ? true : inst.paid,
                          })
                        }
                        ariaLabel={`Instalment ${idx + 1} paid on`}
                      />

                      <button
                        className="remove"
                        onClick={() => removeInstallment(s.id, inst.id)}
                        aria-label={`Remove instalment ${idx + 1}`}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}

                <div className="pp-actions">
                  <button className="btn" onClick={() => addInstallment(s.id)}>
                    + Add instalment
                  </button>
                  <button className="btn ghost" onClick={() => setOpenPay(null)}>
                    Close
                  </button>
                  {sum.legacy && (
                    <span className="pp-legacy">
                      Nothing structured yet — the status and balance above still
                      come from the old free-typed fields.
                    </span>
                  )}
                </div>
              </div>
            )}
            </div>
            );
          })}
          </div>

          {filtered && (
            <p className="filter-note">
              Showing {shown.length} of {students.length} ·{" "}
              <b>{outstandingLabel(view)}</b> outstanding across this view ·{" "}
              {view.owedBy} still owing
              <button
                className="clear-filters"
                onClick={() => {
                  setMonthFilter("all");
                  setStatusFilter("all");
                  setPaymentFilter("all");
                  setQuery("");
                }}
              >
                Clear filters
              </button>
            </p>
          )}
        </>
      )}
    </div>
  );
}
