"use client";

// Adit's Corner → Trial Checkin. A daily tick-and-note list for the students
// whose phase is T (Trial) and nobody else. Kept apart from the Check-in tab:
// its ticks live under their own key (/api/trial-checkin), so a tick here never
// shows on Check-in and the other way round.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { currentPhase, onCheckin, onDnd, longDay, type Student } from "@/lib/roster";
import { entryFor, type Entries } from "@/lib/checkin";
import { longDate, parseKey, shiftDays, todayKey } from "@/lib/date";
import { messageOrder } from "@/lib/timezones";
import HomeTime from "./home-time";
import type { TrackerSummary } from "@/lib/trackers";

type SyncState = "idle" | "saving" | "saved" | "error";

const PASSCODE_KEY = "adit-daily:passcode";

/** Whole days from `since` to `day`, both YYYY-MM-DD. */
function daysBetween(since: string, day: string): number {
  return Math.round((parseKey(day).getTime() - parseKey(since).getTime()) / 86_400_000);
}

export default function TrialCheckinView() {
  const [date, setDate] = useState<string | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [entries, setEntries] = useState<Entries>({});
  const [loading, setLoading] = useState(true);
  const [sync, setSync] = useState<SyncState>("idle");
  const [storeError, setStoreError] = useState<string | null>(null);
  /** Each student's newest live tracker, for the ring beside the name. */
  const [trackers, setTrackers] = useState<Record<string, TrackerSummary>>({});

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDate(todayKey()), []);

  /* -------------------------------- loading -------------------------------- */

  const loadRoster = useCallback(() => {
    fetch("/api/roster", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setStudents(d.students ?? []))
      .catch(() => undefined);
    fetch("/api/trackers", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!Array.isArray(d.trackers)) return;
        const latest: Record<string, TrackerSummary> = {};
        for (const t of d.trackers as TrackerSummary[]) {
          if (!t.archived && !latest[t.studentId]) latest[t.studentId] = t;
        }
        setTrackers(latest);
      })
      .catch(() => undefined);
  }, []);

  const loadDay = useCallback((d: string, initial = false) => {
    fetch(`/api/trial-checkin?date=${d}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((doc) => {
        setStoreError(doc.error ?? null);
        // Never clobber something being typed right now.
        if (!pending.current) setEntries(doc.entries ?? {});
        if (initial) setLoading(false);
      })
      .catch(() => {
        if (initial) setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadRoster();
  }, [loadRoster]);

  useEffect(() => {
    if (!date) return;
    setLoading(true);
    pending.current = false;
    loadDay(date, true);
  }, [date, loadDay]);

  // Two-way: pick up the other person's ticks without a reload.
  useEffect(() => {
    if (!date) return;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      if (pending.current) return;
      const active = document.activeElement;
      if (active && rootRef.current?.contains(active)) return;
      loadDay(date);
      loadRoster();
    };
    const id = setInterval(refresh, 15_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [date, loadDay, loadRoster]);

  /* -------------------------------- saving --------------------------------- */

  const save = useCallback((d: string, next: Entries) => {
    setSync("saving");
    fetch("/api/trial-checkin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-passcode": localStorage.getItem(PASSCODE_KEY) ?? "",
      },
      body: JSON.stringify({ date: d, entries: next }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("save failed");
        pending.current = false;
        setSync("saved");
      })
      .catch(() => setSync("error"));
  }, []);

  const patch = useCallback(
    (id: string, next: Partial<{ c: boolean; n: string }>) => {
      if (!date) return;
      setEntries((prev) => {
        const current = prev[id] ?? { c: false, n: "" };
        const merged = { ...prev, [id]: { ...current, ...next } };
        pending.current = true;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => save(date, merged), 500);
        return merged;
      });
    },
    [date, save]
  );

  /* -------------------------------- derived -------------------------------- */

  // Phase T only, and only students still on Check-in (Active or Trial). Whoever
  // is 6 AM at home comes first, the same order Check-in uses.
  const rows = useMemo(() => {
    const at = new Date();
    return students
      .filter((s) => onCheckin(s) && currentPhase(s) === 6)
      .sort((a, b) => messageOrder(a.tz, at) - messageOrder(b.tz, at));
  }, [students]);

  const owed = rows.filter((s) => !onDnd(s, date ?? ""));
  const taken = owed.filter((s) => entryFor(entries, s.id).c).length;
  const pct = owed.length ? Math.round((taken / owed.length) * 100) : 0;

  if (!date) return null;
  const isToday = date === todayKey();

  return (
    <div className="checkin" ref={rootRef}>
      <div className="roster-head">
        <div>
          <h2>Trial Checkin</h2>
          <p className="hint">
            Daily check on every student whose phase is T. Tick the student once you have
            checked in, and note what came out of it. Separate from the Check-in tab.
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
          <span>Storage not connected — trial check-ins will not save</span>
        </div>
      )}

      <div className="checkin-bar">
        <button className="btn ghost" onClick={() => setDate(shiftDays(date, -1))}>
          ← Prev
        </button>
        <input
          type="date"
          defaultValue={date}
          key={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          aria-label="Trial check-in date"
        />
        <button className="btn ghost" onClick={() => setDate(shiftDays(date, 1))}>
          Next →
        </button>
        {!isToday && (
          <button className="btn ghost" onClick={() => setDate(todayKey())}>
            Today
          </button>
        )}
        <span className="checkin-date">{longDate(date)}</span>
      </div>

      <div className="pulse">
        <div className="pulse-strip">
          {owed.map((s) => (
            <i
              key={s.id}
              className="tick"
              data-on={entryFor(entries, s.id).c ? "1" : "0"}
              title={s.name}
            />
          ))}
        </div>
        <div className="pulse-read">
          <span>
            <b>{taken}</b> of {owed.length} trial students checked
          </span>
          <span>{pct}%</span>
        </div>
      </div>

      {loading ? (
        <p className="filter-note">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="filter-note">
          No student is on phase T right now. Set a student to T on Check-in or the Students
          tab and they appear here.
        </p>
      ) : (
        rows.map((s) => {
          const e = entryFor(entries, s.id);
          const dnd = onDnd(s, date);
          const t = trackers[s.id];
          const tPct = t && t.total ? Math.round((t.done / t.total) * 100) : 0;
          // Trial day 1 is the day the phase was set to T.
          const day = s.phaseSince ? daysBetween(s.phaseSince, date) + 1 : 0;
          return (
            <div
              key={s.id}
              className="checkin-row"
              data-on={String(e.c)}
              data-dnd={String(dnd)}
            >
              <button
                className="box"
                data-on={String(e.c)}
                aria-pressed={e.c}
                aria-label={`Mark ${s.name} as checked`}
                onClick={() => patch(s.id, { c: !e.c })}
              >
                <svg viewBox="0 0 24 24">
                  <polyline points="4,12 10,18 20,6" />
                </svg>
              </button>

              <div className="who">
                <div className="nm">
                  {s.name}
                  {t && (
                    <a
                      className="trk-dot"
                      href={`/t/${t.token}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ ["--p" as string]: `${tPct}%` }}
                      title={`${t.title} · ${t.done} of ${t.total} tasks done · opens their tracker`}
                      aria-label={`Open ${s.name}'s tracker, ${t.done} of ${t.total} tasks done`}
                    >
                      <i />
                    </a>
                  )}
                  <HomeTime tz={s.tz} />
                </div>
                <div className="meta">
                  T · Trial
                  {day > 0 && ` · day ${day}`}
                </div>
                {dnd && (
                  <div className="dnd" data-on="true">
                    <span className="dnd-tag">DND</span>
                    <span>Don&rsquo;t message · back {longDay(s.dndUntil)}</span>
                  </div>
                )}
              </div>

              <div className="note-col">
                <input
                  className="note"
                  value={e.n}
                  onChange={(ev) => patch(s.id, { n: ev.target.value })}
                  placeholder="What came out of the check-in…"
                  aria-label={`Note for ${s.name}`}
                />
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
