"use client";

// The Sales tab: every sales call, day by day, with the outcome buttons and the
// numbers that fall out of them. Calls arrive from Cal.com by themselves; the
// only job here is to tap what happened.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IST,
  OUTCOMES,
  TAGS,
  effectiveOutcome,
  istDate,
  shownEmail,
  shownName,
  shownWhatsapp,
  statsOf,
  type Edit,
  type Meeting,
  type Outcome,
  type Tag,
} from "@/lib/sales";
import { longDate, shiftDays, todayKey } from "@/lib/date";

const KEY = "adit-daily:sales-passcode";
type SyncInfo = { at: string; seen: number; error: string } | null;
type State = "idle" | "saving" | "saved" | "error";
type Period = "7" | "30" | "all";

const time = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit" }).format(new Date(iso));

const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

const waLink = (n: string) => {
  const digits = n.replace(/[^\d]/g, "");
  return digits.length >= 8 ? `https://wa.me/${digits}` : "";
};

const pct = (v: number | null) => (v === null ? "—" : `${v}%`);

export default function SalesView() {
  const [pass, setPass] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [typed, setTyped] = useState("");
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [sync, setSync] = useState<SyncInfo>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [state, setState] = useState<State>("idle");
  const [date, setDate] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState<Period>("30");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const noteTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    setDate(todayKey());
    try {
      setPass(localStorage.getItem(KEY) ?? "");
    } catch {
      setPass("");
    }
  }, []);

  const headers = useCallback(
    () => ({ "Content-Type": "application/json", "x-sales-passcode": pass ?? "" }),
    [pass]
  );

  const load = useCallback(async () => {
    const r = await fetch("/api/sales", { headers: headers(), cache: "no-store" });
    if (r.status === 401) {
      setLocked(true);
      setLoading(false);
      return false;
    }
    const d = await r.json();
    setLocked(false);
    setMeetings(d.meetings ?? []);
    setSync(d.sync ?? null);
    setLoading(false);
    return true;
  }, [headers]);

  const runSync = useCallback(
    async (force: boolean) => {
      setSyncing(true);
      try {
        const r = await fetch("/api/sales/sync", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ force }),
        });
        const d = await r.json().catch(() => ({}));
        if (d.sync) setSync(d.sync);
      } finally {
        setSyncing(false);
        await load();
      }
    },
    [headers, load]
  );

  // Show what's stored straight away, then read the calendar and refresh.
  useEffect(() => {
    if (pass === null) return;
    load().then((ok) => {
      if (ok) runSync(false);
    });
  }, [pass, load, runSync]);

  const unlock = () => {
    try {
      localStorage.setItem(KEY, typed.trim());
    } catch {
      /* private window: works for this visit only */
    }
    setLoading(true);
    setPass(typed.trim());
  };

  /* ------------------------------- saving -------------------------------- */

  const save = useCallback(
    async (id: string, edit: Edit) => {
      setMeetings((list) => list.map((m) => (m.id === id ? { ...m, ...edit } : m)));
      setState("saving");
      try {
        const r = await fetch("/api/sales", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ id, edit }),
        });
        const d = await r.json();
        if (!r.ok || !d.meeting) throw new Error();
        setMeetings((list) => list.map((m) => (m.id === id ? d.meeting : m)));
        setState("saved");
      } catch {
        setState("error");
        load();
      }
    },
    [headers, load]
  );

  const setOutcome = (m: Meeting, o: Outcome) => save(m.id, { outcome: m.outcome === o ? "" : o });

  const toggleTag = (m: Meeting, t: Tag) => {
    const on = m.tags.includes(t);
    let tags = on ? m.tags.filter((x) => x !== t) : [...m.tags, t];
    // Paid means closed; un-closing un-pays.
    if (!on && t === "paid" && !tags.includes("closed")) tags = [...tags, "closed"];
    if (on && t === "closed") tags = tags.filter((x) => x !== "paid");
    save(m.id, { tags });
  };

  const setNote = (m: Meeting, note: string) => {
    setMeetings((list) => list.map((x) => (x.id === m.id ? { ...x, note } : x)));
    clearTimeout(noteTimers.current[m.id]);
    noteTimers.current[m.id] = setTimeout(() => save(m.id, { note }), 600);
  };

  const addMeeting = async (form: HTMLFormElement) => {
    const f = new FormData(form);
    const when = String(f.get("when") ?? "");
    if (!when) return;
    // datetime-local is wall-clock time; read it as IST.
    const start = new Date(`${when}:00+05:30`).toISOString();
    setState("saving");
    const r = await fetch("/api/sales", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        add: { name: f.get("name"), email: f.get("email"), whatsapp: f.get("whatsapp"), start },
      }),
    });
    if (r.ok) {
      setState("saved");
      setAdding(false);
      setDate(istDate(start));
      load();
    } else setState("error");
  };

  /* ------------------------------- derived ------------------------------- */

  const today = todayKey();
  const periodMeetings = useMemo(() => {
    if (period === "all") return meetings.filter((m) => m.date <= today);
    const from = shiftDays(today, -(Number(period) - 1));
    return meetings.filter((m) => m.date >= from && m.date <= today);
  }, [meetings, period, today]);
  const stats = useMemo(() => statsOf(periodMeetings), [periodMeetings]);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    if (q) {
      return meetings
        .filter((m) =>
          [shownName(m), shownEmail(m), shownWhatsapp(m), m.note].join(" ").toLowerCase().includes(q)
        )
        .sort((a, b) => b.start.localeCompare(a.start))
        .slice(0, 60);
    }
    return meetings
      .filter((m) => m.date === date && (showHidden || !m.notSales))
      .sort((a, b) => a.start.localeCompare(b.start));
  }, [meetings, q, date, showHidden]);
  const hiddenToday = meetings.filter((m) => m.date === date && m.notSales).length;

  /* -------------------------------- render -------------------------------- */

  if (!date || pass === null) return <p className="skeleton">Reading the clock…</p>;

  if (locked) {
    return (
      <div className="sales">
        <div className="roster-head">
          <h2>Sales</h2>
        </div>
        <form
          className="sales-lock"
          onSubmit={(e) => {
            e.preventDefault();
            unlock();
          }}
        >
          <p>This page holds prospects&rsquo; contact details. Enter the sales passcode.</p>
          <input
            type="password"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Sales passcode"
            autoFocus
          />
          <button className="btn" disabled={!typed.trim()}>
            Open
          </button>
          {pass && <span className="prog-err">That passcode didn&rsquo;t work.</span>}
        </form>
      </div>
    );
  }

  return (
    <div className="sales">
      <div className="roster-head">
        <div>
          <h2>Sales</h2>
          <p className="hint">
            Every sales call from the calendar, by day. Tap what happened after each call — the
            numbers below work themselves out.
          </p>
        </div>
        <span className="roster-sync">
          <span className="sync-dot" data-state={state} />
          {state === "saving" ? "Saving" : state === "error" ? "Not saved" : state === "saved" ? "Saved" : "Synced"}
        </span>
      </div>

      <div className="sales-sync" data-error={String(Boolean(sync?.error))}>
        {syncing ? (
          <span>Reading Cal.com…</span>
        ) : sync?.error ? (
          <span>Calendar not read: {sync.error}</span>
        ) : sync ? (
          <span>
            Calendar read {ago(sync.at)} · {sync.seen} booking{sync.seen === 1 ? "" : "s"} in range
          </span>
        ) : (
          <span>Calendar not read yet</span>
        )}
        <button className="btn ghost" disabled={syncing} onClick={() => runSync(true)}>
          Sync now
        </button>
      </div>

      {/* ------------------------------ the numbers ------------------------------ */}
      <div className="sales-stats">
        <div className="sales-period" role="radiogroup" aria-label="Period">
          {(["7", "30", "all"] as Period[]).map((p) => (
            <button key={p} role="radio" aria-checked={period === p} data-on={String(period === p)} onClick={() => setPeriod(p)}>
              {p === "all" ? "All time" : `Last ${p} days`}
            </button>
          ))}
        </div>
        <div className="sales-tiles">
          <Tile label="Booked" value={String(stats.booked)} sub={`${stats.pending} not marked yet`} />
          <Tile label="Show-up rate" value={pct(stats.showRate)} sub={`${stats.showed} showed · ${stats.noshow} didn't`} />
          <Tile label="Close rate" value={pct(stats.closeRate)} sub={`${stats.closed} closed of ${stats.showed} who showed`} />
          <Tile label="Paid" value={pct(stats.paidRate)} sub={`${stats.paid} paid of ${stats.closed} closed`} />
          <Tile label="Booked → closed" value={pct(stats.bookToClose)} sub="the whole funnel" />
          <Tile label="Cancelled" value={pct(stats.cancelRate)} sub={`${stats.cancelled} of ${stats.booked} booked`} />
        </div>
      </div>

      {/* ------------------------------ day + search ------------------------------ */}
      <div className="checkin-bar">
        <button className="btn ghost" onClick={() => setDate(shiftDays(date, -1))}>
          ← Prev
        </button>
        <input
          type="date"
          defaultValue={date}
          key={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          aria-label="Sales day"
        />
        <button className="btn ghost" onClick={() => setDate(shiftDays(date, 1))}>
          Next →
        </button>
        {date !== today && (
          <button className="btn ghost" onClick={() => setDate(today)}>
            Today
          </button>
        )}
        <span className="checkin-date">{longDate(date)}</span>
      </div>

      <div className="filters">
        <input
          className="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search every call — name, email, WhatsApp or note…"
        />
        <button className="btn ghost" data-on={String(adding)} onClick={() => setAdding((v) => !v)}>
          {adding ? "Close" : "Add a call by hand"}
        </button>
      </div>

      {adding && (
        <form
          className="sales-add"
          onSubmit={(e) => {
            e.preventDefault();
            addMeeting(e.currentTarget);
          }}
        >
          <input name="name" placeholder="First and last name" required />
          <input name="email" type="email" placeholder="Email" />
          <input name="whatsapp" placeholder="WhatsApp" />
          <input name="when" type="datetime-local" required aria-label="Date and time (IST)" />
          <button className="btn">Add</button>
        </form>
      )}

      {loading ? (
        <p className="skeleton">Loading sales calls…</p>
      ) : shown.length === 0 ? (
        <p className="empty">
          {q ? "No call matches that." : `No sales calls on ${longDate(date)}.`}
        </p>
      ) : (
        <>
          <p className="sales-count">
            {q ? `${shown.length} match${shown.length === 1 ? "" : "es"}` : `${shown.length} call${shown.length === 1 ? "" : "s"}`}
            {!q && hiddenToday > 0 && (
              <button className="sale-link" onClick={() => setShowHidden((v) => !v)}>
                {showHidden ? "hide" : "show"} {hiddenToday} marked not a sales call
              </button>
            )}
          </p>
          {shown.map((m) => {
            const outcome = effectiveOutcome(m);
            const wa = shownWhatsapp(m);
            const link = waLink(wa);
            return (
              <article className="sale" key={m.id} data-outcome={outcome || "none"} data-hidden={String(m.notSales)}>
                <div className="sale-head">
                  <span className="sale-time">
                    {q && <b>{longDate(m.date)} · </b>}
                    {time(m.start)} IST
                  </span>
                  {editing === m.id ? (
                    <form
                      className="sale-edit"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        save(m.id, {
                          name: String(f.get("name") ?? ""),
                          email: String(f.get("email") ?? ""),
                          whatsapp: String(f.get("whatsapp") ?? ""),
                        });
                        setEditing(null);
                      }}
                    >
                      <input name="name" defaultValue={shownName(m)} placeholder="Name" />
                      <input name="email" defaultValue={shownEmail(m)} placeholder="Email" />
                      <input name="whatsapp" defaultValue={wa} placeholder="WhatsApp" />
                      <button className="btn">Save</button>
                      <button type="button" className="btn ghost" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <>
                      <span className="sale-name">{shownName(m)}</span>
                      <span className="sale-contact">
                        {shownEmail(m) && <a href={`mailto:${shownEmail(m)}`}>{shownEmail(m)}</a>}
                        {wa && (link ? <a href={link} target="_blank" rel="noopener noreferrer">WhatsApp {wa}</a> : <span>{wa}</span>)}
                        <button className="sale-link" onClick={() => setEditing(m.id)}>
                          edit
                        </button>
                      </span>
                    </>
                  )}
                  <span className="sale-flags">
                    {m.manual ? "added by hand" : m.id.startsWith("gcal:") ? "Google Calendar" : "Cal.com"}
                    {m.calCancelled && " · cancelled in calendar"}
                    {m.calNoShow && " · marked absent in Cal"}
                    {m.gone && " · removed from calendar"}
                    <button className="sale-link sale-notsales" onClick={() => save(m.id, { notSales: !m.notSales })}>
                      {m.notSales ? "Restore as a sales call" : "Not a sales call"}
                    </button>
                  </span>
                </div>

                <div className="sale-row">
                  <div className="sale-group" role="radiogroup" aria-label="Outcome">
                    {OUTCOMES.map((o) => (
                      <button
                        key={o.id}
                        role="radio"
                        aria-checked={outcome === o.id}
                        data-kind={o.id}
                        data-on={String(outcome === o.id)}
                        data-suggested={String(!m.outcome && outcome === o.id)}
                        onClick={() => setOutcome(m, o.id)}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="sale-row">
                  {(["follow", "signal", "deal"] as const).map((g) => (
                    <div className="sale-group" key={g} data-group={g}>
                      {TAGS.filter((t) => t.group === g).map((t) => (
                        <button
                          key={t.id}
                          aria-pressed={m.tags.includes(t.id)}
                          data-tag={t.id}
                          data-on={String(m.tags.includes(t.id))}
                          onClick={() => toggleTag(m, t.id)}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>

                <input
                  className="sale-note"
                  value={m.note}
                  onChange={(e) => setNote(m, e.target.value)}
                  placeholder="Note — what they said, what's next…"
                  aria-label={`Note for ${shownName(m)}`}
                />

                {m.answers.length > 0 && (
                  <div className="sale-intake">
                    <button onClick={() => setOpen((o) => ({ ...o, [m.id]: !o[m.id] }))} aria-expanded={Boolean(open[m.id])}>
                      {open[m.id] ? "▾" : "▸"} Intake answers ({m.answers.length})
                    </button>
                    {open[m.id] && (
                      <dl>
                        {m.answers.map((a, i) => (
                          <div key={i}>
                            <dt>{a.q}</dt>
                            <dd>{a.a}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </>
      )}

      <p className="hint sales-defs">
        <b>How the numbers work.</b> Show-up rate = showed ÷ (showed + didn&rsquo;t show). Close rate = closed ÷
        showed. Paid = paid ÷ closed. Cancelled = cancelled ÷ booked. A call cancelled or marked absent in Cal.com
        counts that way until you tap something else. Future calls are left out of the numbers.
      </p>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      <span className="tile-sub">{sub}</span>
    </div>
  );
}
