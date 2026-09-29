"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DateField from "./date-field";
import {
  OWNERS,
  OWNER_BLURB,
  blankTodo,
  isLate,
  progress,
  type Owner,
  type Todo,
} from "@/lib/todos";
import { longDay, today } from "@/lib/roster";

type SyncState = "idle" | "saving" | "saved" | "error";

const PASSCODE_KEY = "adit-daily:passcode";

export default function TodosView() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [sync, setSync] = useState<SyncState>("idle");
  const [storeError, setStoreError] = useState<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [showDone, setShowDone] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  /* -------------------------------- loading -------------------------------- */

  const load = useCallback((initial = false) => {
    fetch("/api/todos", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setStoreError(d.error ?? null);
        if (!pending.current) setTodos(d.todos ?? []);
        if (initial) setLoading(false);
      })
      .catch(() => {
        if (initial) setLoading(false);
      });
  }, []);

  useEffect(() => {
    load(true);
  }, [load]);

  // Both of you may be ticking these; pick up the other side without a reload.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      if (pending.current) return;
      const active = document.activeElement;
      if (active && rootRef.current?.contains(active)) return;
      load();
    };
    const id = setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  /* -------------------------------- saving --------------------------------- */

  const save = useCallback((next: Todo[]) => {
    setSync("saving");
    fetch("/api/todos", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-passcode": localStorage.getItem(PASSCODE_KEY) ?? "",
      },
      body: JSON.stringify({ todos: next }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("save failed");
        pending.current = false;
        setSync("saved");
      })
      .catch(() => setSync("error"));
  }, []);

  const commit = useCallback(
    (next: Todo[]) => {
      pending.current = true;
      setTodos(next);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save(next), 600);
    },
    [save]
  );

  const patch = useCallback(
    (id: string, p: Partial<Todo>) => {
      setTodos((prev) => {
        const next = prev.map((t) => (t.id === id ? { ...t, ...p } : t));
        pending.current = true;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => save(next), 600);
        return next;
      });
    },
    [save]
  );

  const toggle = (t: Todo) =>
    patch(t.id, { done: !t.done, doneAt: !t.done ? new Date().toISOString() : "" });

  const addTodo = () => {
    const owner: Owner =
      ownerFilter !== "all" && OWNERS.includes(ownerFilter as Owner)
        ? (ownerFilter as Owner)
        : "Adit";
    const fresh = blankTodo(owner);
    commit([...todos, fresh]);
    setTimeout(() => {
      rootRef.current
        ?.querySelector<HTMLInputElement>(`[data-title-for="${fresh.id}"]`)
        ?.focus();
    }, 30);
  };

  const removeTodo = (t: Todo) => {
    if (!confirm(`Remove "${t.title || "this item"}" from the to-do list?`)) return;
    commit(todos.filter((x) => x.id !== t.id));
  };

  /* -------------------------------- derived -------------------------------- */

  const t = today();
  const stats = useMemo(() => progress(todos), [todos]);
  const openCount = todos.filter((x) => !x.done).length;
  const lateCount = todos.filter((x) => isLate(x, t)).length;

  const shownOwners = useMemo(
    () => (ownerFilter === "all" ? OWNERS : OWNERS.filter((o) => o === ownerFilter)),
    [ownerFilter]
  );

  if (loading) return <p className="skeleton">Loading the to-do list…</p>;

  return (
    <div className="todos" ref={rootRef}>
      <div className="roster-head">
        <div>
          <h2>To-do</h2>
          <p className="hint">
            One-off work from the 29 September planning meeting — the ops handover
            and everything that follows it. Separate from the daily checklist, and
            deliberately not scored.
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
          <b>{openCount}</b>
          <span>still open</span>
        </div>
        {stats.map((s) => (
          <div className="stat" key={s.owner}>
            <b>
              {s.done}
              <i className="stat-of">/{s.total}</i>
            </b>
            <span>{s.owner}</span>
          </div>
        ))}
        <div className="stat" data-flag={String(lateCount > 0)}>
          <b>{lateCount}</b>
          <span>past their date</span>
        </div>
      </div>

      <div className="filters">
        <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
          <option value="all">Everyone</option>
          {OWNERS.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
        <button
          className="btn ghost"
          data-on={String(showDone)}
          onClick={() => setShowDone((v) => !v)}
        >
          {showDone ? "Hiding nothing" : "Hide finished"}
        </button>
        <button className="btn" onClick={addTodo}>
          + Add item
        </button>
      </div>

      {shownOwners.map((owner) => {
        const mine = todos
          .filter((x) => x.owner === owner)
          .filter((x) => (showDone ? !x.done : true));
        const all = todos.filter((x) => x.owner === owner);
        const done = all.filter((x) => x.done).length;

        return (
          <section className="section" key={owner}>
            <div className="section-head">
              <h2>{owner}</h2>
              <span className="hair" />
              <span className="tally" data-complete={String(done === all.length && all.length > 0)}>
                {done}/{all.length}
              </span>
            </div>
            <p className="playbook-blurb todo-blurb">{OWNER_BLURB[owner]}</p>

            {mine.length === 0 ? (
              <p className="empty todo-empty">
                {all.length ? "All done here." : "Nothing assigned yet."}
              </p>
            ) : (
              mine.map((item) => (
                <div
                  className="todo"
                  key={item.id}
                  data-done={String(item.done)}
                  data-late={String(isLate(item, t))}
                >
                  <button
                    className="box"
                    data-on={String(item.done)}
                    aria-pressed={item.done}
                    aria-label={`Mark "${item.title}" ${item.done ? "not done" : "done"}`}
                    onClick={() => toggle(item)}
                  >
                    <svg viewBox="0 0 24 24">
                      <polyline points="4,12 10,18 20,6" />
                    </svg>
                  </button>

                  <div className="todo-body">
                    <input
                      className="todo-title"
                      data-title-for={item.id}
                      value={item.title}
                      onChange={(e) => patch(item.id, { title: e.target.value })}
                      placeholder="What needs doing"
                    />
                    <input
                      className="todo-detail"
                      value={item.detail}
                      onChange={(e) => patch(item.id, { detail: e.target.value })}
                      placeholder="Any detail worth keeping…"
                    />
                  </div>

                  <div className="todo-meta">
                    <select
                      className="todo-owner"
                      value={item.owner}
                      onChange={(e) => patch(item.id, { owner: e.target.value as Owner })}
                      aria-label="Owner"
                    >
                      {OWNERS.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                    <DateField
                      value={item.due}
                      onCommit={(due) => patch(item.id, { due })}
                      ariaLabel={`Due date for ${item.title || "item"}`}
                    />
                    {item.due && (
                      <span className="todo-due" data-late={String(isLate(item, t))}>
                        {longDay(item.due)}
                      </span>
                    )}
                  </div>

                  <button
                    className="remove"
                    onClick={() => removeTodo(item)}
                    aria-label={`Remove ${item.title || "item"}`}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </section>
        );
      })}
    </div>
  );
}
