"use client";

// The Trackers tab: every study plan sent to a student, grouped by student,
// newest first, with how far they've got. New trackers come from the
// /checklist skill in Claude Code — this tab only shows and archives them.

import { useCallback, useEffect, useMemo, useState } from "react";
import { shortDate, type TrackerSummary } from "@/lib/trackers";
import type { Student } from "@/lib/roster";

const PASSCODE_KEY = "adit-daily:passcode";

const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

const createdOn = (iso: string) => shortDate(iso.slice(0, 10));

export default function TrackersView() {
  const [trackers, setTrackers] = useState<TrackerSummary[] | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [copied, setCopied] = useState("");

  const load = useCallback(() => {
    fetch("/api/trackers", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!Array.isArray(d.trackers)) throw new Error(d.error ?? "unavailable");
        setTrackers(d.trackers);
        setError("");
      })
      .catch((e) => setError(String(e.message ?? e)));
    fetch("/api/roster", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setStudents(d.students ?? []))
      .catch(() => undefined);
  }, []);

  // Live, like Check-in: ticks show up without a reload.
  useEffect(() => {
    load();
    const id = setInterval(() => document.visibilityState === "visible" && load(), 20_000);
    return () => clearInterval(id);
  }, [load]);

  const archive = async (token: string, archived: boolean) => {
    setTrackers((list) => list?.map((t) => (t.token === token ? { ...t, archived } : t)) ?? null);
    const r = await fetch("/api/trackers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-passcode": localStorage.getItem(PASSCODE_KEY) ?? "",
      },
      body: JSON.stringify({ action: "archive", token, archived }),
    }).catch(() => null);
    if (!r?.ok) load();
  };

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/t/${token}`);
      setCopied(token);
      setTimeout(() => setCopied((c) => (c === token ? "" : c)), 2000);
    } catch {
      setCopied("");
    }
  };

  // One group per student, the student with the newest tracker first.
  const groups = useMemo(() => {
    const names = new Map(students.map((s) => [s.id, s]));
    const q = query.trim().toLowerCase();
    const byStudent = new Map<string, TrackerSummary[]>();
    for (const t of trackers ?? []) {
      if (t.archived && !showArchived) continue;
      const name = names.get(t.studentId)?.name.trim() || t.studentName;
      if (q && !`${name} ${t.title}`.toLowerCase().includes(q)) continue;
      byStudent.set(t.studentId, [...(byStudent.get(t.studentId) ?? []), t]);
    }
    return [...byStudent.entries()].map(([id, list]) => ({
      id,
      student: names.get(id),
      name: names.get(id)?.name.trim() || list[0].studentName,
      list,
    }));
  }, [trackers, students, query, showArchived]);

  const live = (trackers ?? []).filter((t) => !t.archived);
  const archivedCount = (trackers ?? []).length - live.length;

  return (
    <div className="trackers">
      <div className="roster-head">
        <div>
          <h2>Student trackers</h2>
          <p className="hint">
            Every plan sent to a student, newest first. Ticks and scores show up
            here live. Make a new one in Claude Code with{" "}
            <code>/checklist &lt;student&gt;</code> and paste Dr. Marish&rsquo;s task list.
          </p>
        </div>
        <span className="roster-sync">
          {live.length} live · {new Set(live.map((t) => t.studentId)).size} students
        </span>
      </div>

      <div className="filters">
        <input
          className="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a student or a plan…"
        />
        {archivedCount > 0 && (
          <button
            className="btn ghost"
            data-on={String(showArchived)}
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
          </button>
        )}
      </div>

      {error && !trackers ? (
        <div className="lock">
          <span>Trackers could not load — {error}</span>
        </div>
      ) : trackers === null ? (
        <p className="skeleton">Loading trackers…</p>
      ) : groups.length === 0 ? (
        <p className="empty">
          {query.trim()
            ? "No tracker matches that."
            : "No trackers yet. In Claude Code, run /checklist with a student's name and paste the task list — it appears here the moment it's published."}
        </p>
      ) : (
        groups.map((g) => {
          const latest = g.list.find((t) => !t.archived)?.token;
          return (
            <section className="tg" key={g.id}>
              <div className="tg-head">
                <span className="tg-name">{g.name}</span>
                {g.student && g.student.status !== "Active" && (
                  <span className="flag">{g.student.status}</span>
                )}
                {!g.student && <span className="flag">no longer on the roster</span>}
                <span className="tg-count">
                  {g.list.length} tracker{g.list.length === 1 ? "" : "s"}
                </span>
              </div>
              {g.list.map((t) => {
                const pct = t.total ? Math.round((t.done / t.total) * 100) : 0;
                return (
                  <div className="tr" key={t.token} data-archived={String(t.archived)}>
                    <div className="tr-main">
                      <a className="tr-title" href={`/t/${t.token}`} target="_blank" rel="noreferrer">
                        {t.title}
                      </a>
                      {t.token === latest && <span className="tr-latest">Latest</span>}
                      {t.archived && <span className="tr-arch">Archived</span>}
                      <div className="tr-meta">
                        Created {createdOn(t.createdAt)} ·{" "}
                        {t.start && t.end
                          ? `${t.days} day${t.days === 1 ? "" : "s"} · ${shortDate(t.start)} – ${shortDate(t.end)}`
                          : t.start
                            ? `from ${shortDate(t.start)} · no end date`
                            : t.end
                              ? `due ${shortDate(t.end)}`
                              : "time-budget plan, no dates"}
                      </div>
                    </div>
                    <div className="tr-prog">
                      <div className="tr-bar">
                        <i style={{ width: `${pct}%` }} />
                      </div>
                      <span>
                        <b>{t.done}</b>/{t.total} · {pct}%
                      </span>
                      <span className="tr-last">
                        {t.lastActivity ? `Last tick ${ago(t.lastActivity)}` : "No ticks yet"}
                      </span>
                    </div>
                    <div className="tr-actions">
                      <a href={`/t/${t.token}`} target="_blank" rel="noreferrer">
                        Open ↗
                      </a>
                      <button onClick={() => copy(t.token)}>
                        {copied === t.token ? "Copied ✓" : "Copy link"}
                      </button>
                      <button onClick={() => archive(t.token, !t.archived)}>
                        {t.archived ? "Unarchive" : "Archive"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })
      )}
    </div>
  );
}
