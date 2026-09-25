"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PRIORITIES,
  sortTasks,
  type DumpTask,
  type Priority,
} from "@/lib/dump";

type SyncState = "idle" | "saving" | "saved" | "error";
type Show = "open" | "all" | "done";

const PASSCODE_KEY = "adit-daily:passcode";

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

function PriorityPicker({
  value,
  onChange,
}: {
  value: Priority;
  onChange: (p: Priority) => void;
}) {
  return (
    <div className="prio-pick" role="radiogroup" aria-label="Priority">
      {PRIORITIES.map((p) => (
        <button
          key={p.id}
          type="button"
          className="pill"
          data-prio={p.id}
          data-on={String(value === p.id)}
          role="radio"
          aria-checked={value === p.id}
          title={p.hint}
          onClick={() => onChange(p.id)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

export default function DumpView() {
  const [tasks, setTasks] = useState<DumpTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [sync, setSync] = useState<SyncState>("idle");
  const [storeError, setStoreError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [passcode, setPasscode] = useState("");

  const [draft, setDraft] = useState("");
  const [draftPrio, setDraftPrio] = useState<Priority>("highest");
  const [prioFilter, setPrioFilter] = useState<"all" | Priority>("all");
  const [show, setShow] = useState<Show>("open");

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  /* -------------------------------- loading -------------------------------- */

  const load = useCallback((initial = false) => {
    fetch("/api/dump", { cache: "no-store" })
      .then((r) => r.json())
      .then((doc) => {
        setStoreError(doc.error ?? null);
        // Never clobber something being typed right now.
        if (!pending.current) setTasks(doc.tasks ?? []);
        if (initial) setLoading(false);
      })
      .catch(() => {
        if (initial) setLoading(false);
      });
  }, []);

  useEffect(() => {
    setPasscode(localStorage.getItem(PASSCODE_KEY) ?? "");
    load(true);
  }, [load]);

  // Pick up changes made on another device without a reload.
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

  /* -------------------------------- saving --------------------------------- */

  const save = useCallback((next: DumpTask[]) => {
    setSync("saving");
    fetch("/api/dump", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-passcode": localStorage.getItem(PASSCODE_KEY) ?? "",
      },
      body: JSON.stringify({ tasks: next }),
    })
      .then((r) => {
        if (r.status === 401) {
          setLocked(true);
          setSync("error");
          return;
        }
        if (!r.ok) throw new Error("save failed");
        pending.current = false;
        setLocked(false);
        setSync("saved");
      })
      .catch(() => setSync("error"));
  }, []);

  /** Every change funnels through here so saving stays in one place. */
  const mutate = useCallback(
    (fn: (prev: DumpTask[]) => DumpTask[]) => {
      setTasks((prev) => {
        const next = fn(prev);
        pending.current = true;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => save(next), 500);
        return next;
      });
    },
    [save]
  );

  const patch = (id: string, change: Partial<DumpTask>) =>
    mutate((prev) => prev.map((t) => (t.id === id ? { ...t, ...change } : t)));

  const toggleDone = (t: DumpTask) =>
    patch(
      t.id,
      t.done ? { done: false, doneAt: undefined } : { done: true, doneAt: new Date().toISOString() }
    );

  const remove = (id: string) => mutate((prev) => prev.filter((t) => t.id !== id));

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    mutate((prev) => [
      ...prev,
      { id: newId(), text, p: draftPrio, done: false, at: new Date().toISOString() },
    ]);
    setDraft("");
  };

  const unlock = () => {
    localStorage.setItem(PASSCODE_KEY, passcode);
    setLocked(false);
    save(tasks);
  };

  /* -------------------------------- derived -------------------------------- */

  const counts = useMemo(() => {
    const by = Object.fromEntries(
      PRIORITIES.map((p) => [p.id, { open: 0, done: 0 }])
    ) as Record<Priority, { open: number; done: number }>;
    for (const t of tasks) by[t.p][t.done ? "done" : "open"] += 1;
    const done = tasks.filter((t) => t.done).length;
    return { by, total: tasks.length, done, open: tasks.length - done };
  }, [tasks]);

  const pct = counts.total ? Math.round((counts.done / counts.total) * 100) : 0;

  const visible = useMemo(
    () =>
      sortTasks(tasks).filter((t) => {
        if (prioFilter !== "all" && t.p !== prioFilter) return false;
        if (show === "open" && t.done) return false;
        if (show === "done" && !t.done) return false;
        return true;
      }),
    [tasks, prioFilter, show]
  );

  /* --------------------------------- render -------------------------------- */

  return (
    <div className="dump" ref={rootRef}>
      <div className="roster-head">
        <div>
          <h2>Checklist</h2>
          <p className="hint">
            Brain-dump every task on your mind. Give each one a priority, tick it
            when it&rsquo;s done. The list carries over day to day.
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
          <span>Storage not connected — tasks will not save</span>
        </div>
      )}

      {/* ------------------------- the tracker overview ------------------------ */}
      <div className="stats">
        <div className="stat">
          <b>{counts.total}</b>
          <span>tasks added</span>
        </div>
        <div className="stat" data-flag={String(counts.open > 0)}>
          <b>{counts.open}</b>
          <span>still open</span>
        </div>
        <div className="stat">
          <b>{counts.done}</b>
          <span>done</span>
        </div>
        <div className="stat">
          <b>{pct}%</b>
          <span>complete</span>
        </div>
      </div>

      <div className="prio-board">
        {PRIORITIES.map((p) => {
          const c = counts.by[p.id];
          const all = c.open + c.done;
          return (
            <button
              key={p.id}
              type="button"
              className="prio-card"
              data-prio={p.id}
              data-on={String(prioFilter === p.id)}
              onClick={() => setPrioFilter((f) => (f === p.id ? "all" : p.id))}
              title={`Show only ${p.label} tasks`}
            >
              <div className="prio-card-top">
                <span className="prio-tag" data-prio={p.id}>
                  {p.label}
                </span>
                <span className="prio-hint">{p.hint}</span>
              </div>
              <div className="prio-card-read">
                <b>{c.open}</b> open
                <i>
                  {c.done}/{all} done
                </i>
              </div>
              <div className="meter">
                <div
                  className="meter-fill"
                  data-grade="A+"
                  style={{ width: `${all ? (c.done / all) * 100 : 0}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>

      {/* ------------------------------ add a task ----------------------------- */}
      <form
        className="dump-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What's on your mind? Type a task and press Enter…"
          aria-label="New task"
          maxLength={500}
        />
        <PriorityPicker value={draftPrio} onChange={setDraftPrio} />
        <button className="btn" type="submit" disabled={!draft.trim()}>
          Add
        </button>
      </form>

      {/* -------------------------------- filters ------------------------------ */}
      <div className="filters">
        <select
          value={prioFilter}
          onChange={(e) => setPrioFilter(e.target.value as "all" | Priority)}
          aria-label="Filter by priority"
        >
          <option value="all">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} only
            </option>
          ))}
        </select>
        <select
          value={show}
          onChange={(e) => setShow(e.target.value as Show)}
          aria-label="Filter by status"
        >
          <option value="open">Open tasks</option>
          <option value="all">Open and done</option>
          <option value="done">Done tasks</option>
        </select>
      </div>

      {loading ? (
        <p className="skeleton">Loading your tasks…</p>
      ) : visible.length === 0 ? (
        <p className="empty">
          {counts.total === 0 ? (
            <>
              Nothing here yet. <b>Start dumping</b> — one task per line above.
            </>
          ) : (
            "No tasks match this filter."
          )}
        </p>
      ) : (
        <div className="dump-list">
          {visible.map((t) => (
            <div className="dump-row" key={t.id} data-done={String(t.done)} data-prio={t.p}>
              <button
                className="box"
                data-on={String(t.done)}
                onClick={() => toggleDone(t)}
                aria-pressed={t.done}
                aria-label={`Mark "${t.text || "task"}" ${t.done ? "not done" : "done"}`}
              >
                <svg viewBox="0 0 24 24">
                  <polyline points="4,12 10,18 20,6" />
                </svg>
              </button>
              <input
                className="dump-text"
                value={t.text}
                onChange={(e) => patch(t.id, { text: e.target.value })}
                placeholder="Write the task…"
                aria-label="Task"
                maxLength={500}
              />
              <PriorityPicker value={t.p} onChange={(p) => patch(t.id, { p })} />
              <button
                className="remove"
                onClick={() => remove(t.id)}
                aria-label={`Remove "${t.text || "task"}"`}
                title="Remove task"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {locked && (
        <div className="lock">
          <span>Enter your 4-digit PIN to save</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            value={passcode}
            onChange={(e) => setPasscode(e.target.value.replace(/\D/g, "").slice(0, 4))}
            onKeyDown={(e) => e.key === "Enter" && unlock()}
            placeholder="0000"
            autoFocus
          />
          <button className="btn" onClick={unlock}>
            Unlock
          </button>
        </div>
      )}
    </div>
  );
}
