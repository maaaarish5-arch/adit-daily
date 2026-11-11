"use client";

// Adit's Corner → Trial clients check-in. Every student whose phase is T
// (Trial), checked on three times a day: a box each for 11 AM, 4 PM and 9 PM,
// then what came out of the update. Kept apart from the Check-in tab: its ticks
// live under their own key (/api/trial-checkin), so a tick here never shows on
// Check-in and the other way round.
//
// Sits inside the corner page and follows its date. It reports how many trial
// clients have all three rounds, which closes the Daily Flow row.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onDnd, longDay, type Student } from "@/lib/roster";
import type { Coverage } from "@/lib/checkin";
import {
  TRIAL_ROUNDS,
  trialCoverage,
  trialEntryFor,
  trialStudents,
  type TrialEntries,
  type TrialEntry,
} from "@/lib/trial";
import { parseKey } from "@/lib/date";
import { messageOrder } from "@/lib/timezones";
import HomeTime from "./home-time";
import type { TrackerSummary } from "@/lib/trackers";

type SyncState = "idle" | "saving" | "saved" | "error";

const PASSCODE_KEY = "adit-daily:passcode";

/** Whole days from `since` to `day`, both YYYY-MM-DD. */
function daysBetween(since: string, day: string): number {
  return Math.round((parseKey(day).getTime() - parseKey(since).getTime()) / 86_400_000);
}

export default function TrialCheckinView({
  date,
  onCoverage,
}: {
  /** The corner's day — the list follows it. */
  date: string;
  onCoverage?: (c: Coverage) => void;
}) {
  const [students, setStudents] = useState<Student[]>([]);
  const [entries, setEntries] = useState<TrialEntries>({});
  const [loading, setLoading] = useState(true);
  const [sync, setSync] = useState<SyncState>("idle");
  const [storeError, setStoreError] = useState<string | null>(null);
  /** Each student's newest live tracker, for the ring beside the name. */
  const [trackers, setTrackers] = useState<Record<string, TrackerSummary>>({});

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  const save = useCallback((d: string, next: TrialEntries) => {
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
    (id: string, next: Partial<TrialEntry>) => {
      setEntries((prev) => {
        const current = trialEntryFor(prev, id);
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

  // Whoever is 6 AM at home comes first, the same order Check-in uses.
  const rows = useMemo(() => {
    const at = new Date();
    return trialStudents(students).sort((a, b) => messageOrder(a.tz, at) - messageOrder(b.tz, at));
  }, [students]);

  const coverage = useMemo(() => trialCoverage(students, entries, date), [students, entries, date]);
  const ready = !loading && students.length > 0;
  useEffect(() => {
    if (ready) onCoverage?.(coverage);
  }, [ready, coverage, onCoverage]);

  const owed = rows.filter((s) => !onDnd(s, date));
  const roundsDone = owed.reduce((n, s) => n + trialEntryFor(entries, s.id).r.filter(Boolean).length, 0);
  const pct = owed.length ? Math.round((roundsDone / (owed.length * 3)) * 100) : 0;

  const toggleRound = (s: Student, i: number) => {
    const r = [...trialEntryFor(entries, s.id).r] as TrialEntry["r"];
    r[i] = !r[i];
    patch(s.id, { r });
  };

  return (
    <section className="section trial-section" ref={rootRef}>
      <div className="section-head">
        <h2>Trial clients check-in</h2>
        <span className="hair" />
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
        <span className="tally" data-complete={String(coverage.complete && owed.length > 0)}>
          {coverage.taken}/{coverage.total}
        </span>
      </div>

      {storeError && (
        <div className="lock">
          <span>Storage not connected — trial check-ins will not save</span>
        </div>
      )}

      <div className="pulse">
        <div className="pulse-strip">
          {owed.flatMap((s) =>
            trialEntryFor(entries, s.id).r.map((on, i) => (
              <i key={`${s.id}-${i}`} className="tick" data-on={on ? "1" : "0"} title={`${s.name} · ${TRIAL_ROUNDS[i].label}`} />
            ))
          )}
        </div>
        <div className="pulse-read">
          <span>
            <b>{roundsDone}</b> of {owed.length * 3} rounds done · {coverage.taken} of {owed.length}{" "}
            trial clients on all three
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
          const e = trialEntryFor(entries, s.id);
          const dnd = onDnd(s, date);
          const t = trackers[s.id];
          const tPct = t && t.total ? Math.round((t.done / t.total) * 100) : 0;
          // Trial day 1 is the day the phase was set to T.
          const day = s.phaseSince ? daysBetween(s.phaseSince, date) + 1 : 0;
          const all = e.r.every(Boolean);
          return (
            <div key={s.id} className="trial-row" data-on={String(all)} data-dnd={String(dnd)}>
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

              <div className="rounds">
                {TRIAL_ROUNDS.map((round, i) => (
                  <button
                    key={round.id}
                    className="round"
                    data-on={String(e.r[i])}
                    aria-pressed={e.r[i]}
                    aria-label={`${s.name} checked at ${round.label}`}
                    onClick={() => toggleRound(s, i)}
                  >
                    <span className="box" data-on={String(e.r[i])}>
                      <svg viewBox="0 0 24 24">
                        <polyline points="4,12 10,18 20,6" />
                      </svg>
                    </span>
                    <small>{round.label}</small>
                  </button>
                ))}
              </div>

              <div className="note-col">
                <input
                  className="note"
                  value={e.n}
                  onChange={(ev) => patch(s.id, { n: ev.target.value })}
                  placeholder="What came out of the update…"
                  aria-label={`Note for ${s.name}`}
                />
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}
