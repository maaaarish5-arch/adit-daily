"use client";


import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BUCKETS_PER_DAY,
  BUCKET_MIN,
  KIND_LABEL,
  bucketOf,
  coverage,
  coverageBetween,
  type LogEvent,
} from "@/lib/activity";
import {
  SHIFTS,
  istDayKey,
  istMinutes,
  istTime,
  duration,
} from "@/lib/shifts";
import { longDate, shiftDays } from "@/lib/date";

type Activity = { events: LogEvent[]; buckets: number[] };

const EMPTY: Activity = { events: [], buckets: [] };

/** Minutes past IST midnight, as HH:MM. */
function clock(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export default function LogsView() {
  const [date, setDate] = useState<string | null>(null);
  const [data, setData] = useState<Activity>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => setDate(istDayKey()), []);

  const load = useCallback((d: string, initial = false) => {
    if (initial) setLoading(true);
    fetch(`/api/log?date=${d}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((r) => {
        setData({ events: r.events ?? [], buckets: r.buckets ?? [] });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (date) load(date, true);
  }, [date, load]);

  // Keep it live while it's being watched.
  useEffect(() => {
    if (!date) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load(date);
    }, 30_000);
    return () => clearInterval(id);
  }, [date, load]);

  /* -------------------------------- derived -------------------------------- */

  const bucketSet = useMemo(() => new Set(data.buckets), [data.buckets]);

  /** Clocked span per shift, read off the log rather than the day document —
   *  the log is the record that cannot be edited. */
  const spans = useMemo(() => {
    return SHIFTS.map((sh) => {
      const mine = data.events.filter((e) => e.shift === sh.id);
      const lastIn = [...mine].reverse().find((e) => e.kind === "in");
      const lastOut = [...mine].reverse().find((e) => e.kind === "out");
      const inMin = lastIn ? istMinutes(new Date(lastIn.t)) : null;
      const outMin = lastOut ? istMinutes(new Date(lastOut.t)) : null;
      const scheduled = coverage(data.buckets, sh.startMin, sh.endMin);
      const claimed =
        inMin !== null && outMin !== null && outMin > inMin
          ? coverageBetween(data.buckets, inMin, outMin)
          : null;
      const corrections = mine.filter((e) => e.kind.startsWith("cleared")).length;
      return { shift: sh, inMin, outMin, scheduled, claimed, corrections };
    });
  }, [data]);

  const totalMinutes = data.buckets.length * BUCKET_MIN;
  const firstSeen = data.buckets.length ? Math.min(...data.buckets) : null;
  const lastSeen = data.buckets.length ? Math.max(...data.buckets) : null;

  if (!date) return <p className="skeleton">Reading the clock…</p>;

  const isToday = date === istDayKey();
  const nowBucket = isToday ? bucketOf(istMinutes(new Date())) : -1;

  return (
    <div className="logs">
      <div className="roster-head">
        <div>
          <h2>Adit&rsquo;s time logs</h2>
          <p className="hint">
            Every clock event, and every five minutes the page was actually open.
            Written by the server, append-only — nothing here can be edited or
            deleted from the app.
          </p>
        </div>
        <span className="roster-sync">All times IST</span>
      </div>

      <div className="checkin-bar">
        <button className="btn ghost" onClick={() => setDate(shiftDays(date, -1))}>
          ← Prev
        </button>
        <input
          type="date"
          defaultValue={date}
          key={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          aria-label="Log date"
        />
        <button
          className="btn ghost"
          onClick={() => setDate(shiftDays(date, 1))}
          disabled={isToday}
        >
          Next →
        </button>
        {!isToday && (
          <button className="btn ghost" onClick={() => setDate(istDayKey())}>
            Today
          </button>
        )}
        <span className="checkin-date">{longDate(date)}</span>
      </div>

      {loading ? (
        <p className="skeleton">Loading the log…</p>
      ) : (
        <>
          <div className="stats">
            <div className="stat">
              <b>{duration(totalMinutes)}</b>
              <span>on the page</span>
            </div>
            <div className="stat">
              <b>{firstSeen !== null ? clock(firstSeen * BUCKET_MIN) : "—"}</b>
              <span>first seen</span>
            </div>
            <div className="stat">
              <b>{lastSeen !== null ? clock(lastSeen * BUCKET_MIN) : "—"}</b>
              <span>last seen</span>
            </div>
            <div className="stat">
              <b>{data.events.length}</b>
              <span>logged events</span>
            </div>
          </div>

          {/* the whole day, five minutes per notch, shifts shaded */}
          <div className="daystrip-wrap">
            <div className="daystrip">
              {Array.from({ length: BUCKETS_PER_DAY }).map((_, b) => {
                const min = b * BUCKET_MIN;
                const inShift = SHIFTS.some(
                  (sh) => min >= sh.startMin && min < sh.endMin
                );
                return (
                  <i
                    key={b}
                    className="notch"
                    data-on={bucketSet.has(b) ? "1" : "0"}
                    data-shift={String(inShift)}
                    data-now={String(b === nowBucket)}
                    title={`${clock(min)} — ${bucketSet.has(b) ? "on the page" : "no activity"}`}
                  />
                );
              })}
            </div>
            <div className="daystrip-scale">
              <span>00:00</span>
              <span>06:00</span>
              <span>12:00</span>
              <span>18:00</span>
              <span>24:00</span>
            </div>
          </div>

          <div className="shifts">
            {spans.map((sp) => (
              <div className="shift" key={sp.shift.id} data-done={String(sp.outMin !== null)}>
                <div className="shift-top">
                  <b>{sp.shift.label}</b>
                  <span className="shift-window">{sp.shift.window}</span>
                </div>

                <div className="shift-stamps">
                  <span data-set={String(sp.inMin !== null)}>
                    In {sp.inMin !== null ? clock(sp.inMin) : "—"}
                  </span>
                  <span data-set={String(sp.outMin !== null)}>
                    Out {sp.outMin !== null ? clock(sp.outMin) : "—"}
                  </span>
                </div>

                <div className="cov">
                  <div className="cov-row">
                    <span>Present during the window</span>
                    <b data-low={String(sp.scheduled.percent < 50)}>
                      {sp.scheduled.percent}%
                    </b>
                  </div>
                  <div className="meter">
                    <div
                      className="meter-fill"
                      data-grade={sp.scheduled.percent >= 50 ? "A+" : "C-"}
                      style={{ width: `${sp.scheduled.percent}%` }}
                    />
                  </div>
                  <div className="cov-note">
                    {duration(sp.scheduled.minutes)} of{" "}
                    {duration(sp.scheduled.total * BUCKET_MIN)} scheduled
                  </div>

                  {sp.claimed && (
                    <div className="cov-note claimed">
                      Within the hours he clocked: {sp.claimed.percent}% present (
                      {duration(sp.claimed.minutes)})
                    </div>
                  )}
                  {sp.corrections > 0 && (
                    <div className="cov-note corrections">
                      {sp.corrections} stamp
                      {sp.corrections > 1 ? "s" : ""} removed after the fact
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="section-head" style={{ marginTop: "1.8rem" }}>
            <h2>Event log</h2>
            <span className="hair" />
            <span className="tally">{data.events.length}</span>
          </div>

          {data.events.length === 0 ? (
            <p className="empty">Nothing logged on this day.</p>
          ) : (
            <div className="events">
              {[...data.events]
                .sort((a, b) => b.t.localeCompare(a.t))
                .map((e, i) => (
                  <div
                    className="event"
                    key={`${e.t}-${i}`}
                    data-kind={e.kind}
                  >
                    <span className="event-time">{istTime(new Date(e.t))}</span>
                    <span className="event-kind">{KIND_LABEL[e.kind]}</span>
                    <span className="event-shift">
                      {e.shift
                        ? SHIFTS.find((s) => s.id === e.shift)?.label ?? e.shift
                        : ""}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
