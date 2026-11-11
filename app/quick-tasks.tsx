"use client";

// The task list on the left of Adit's Corner: type a task, press Enter, tick it
// off. It is the same list as the To-do tab (his items, owner "Adit"), so
// nothing is kept twice — anything added here shows there, and the other way
// round. Not part of the daily score.

import { useCallback, useEffect, useRef, useState } from "react";
import { blankTodo, type Owner, type Todo } from "@/lib/todos";

const PASSCODE_KEY = "adit-daily:passcode";

export default function QuickTasks({ owner }: { owner: Owner }) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const busy = useRef(false);

  const load = useCallback(() => {
    if (busy.current) return;
    fetch("/api/todos", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!busy.current && Array.isArray(d.todos)) setTodos(d.todos);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);

  /** Re-read the whole list, change it, write it back — the list is saved as
   *  one document, so starting from the latest keeps others' edits. */
  const write = (change: (latest: Todo[]) => Todo[]) => {
    busy.current = true;
    setError(false);
    fetch("/api/todos", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const next = change(Array.isArray(d.todos) ? d.todos : []);
        setTodos(next);
        return fetch("/api/todos", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-passcode": localStorage.getItem(PASSCODE_KEY) ?? "",
          },
          body: JSON.stringify({ todos: next }),
        });
      })
      .then((r) => {
        if (!r.ok) throw new Error("save failed");
      })
      .catch(() => setError(true))
      .finally(() => {
        busy.current = false;
      });
  };

  const add = () => {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    write((latest) => [...latest, { ...blankTodo(owner), title }]);
  };

  const toggle = (id: string) =>
    write((latest) =>
      latest.map((t) =>
        t.id === id
          ? { ...t, done: !t.done, doneAt: t.done ? "" : new Date().toISOString() }
          : t
      )
    );

  // Open items, plus anything ticked today so a mis-tap can be undone.
  const today = new Date().toDateString();
  const mine = todos.filter(
    (t) => t.owner === owner && (!t.done || new Date(t.doneAt).toDateString() === today)
  );
  const openCount = mine.filter((t) => !t.done).length;
  const shown = onlyOpen ? mine.filter((t) => !t.done) : mine;

  return (
    <section className="quick-tasks">
      <div className="quick-head">
        <h3>Tasks</h3>
        <button
          className="pill"
          data-on={String(onlyOpen)}
          aria-pressed={onlyOpen}
          onClick={() => setOnlyOpen((v) => !v)}
        >
          {onlyOpen ? `Outstanding · ${openCount}` : `Show outstanding · ${openCount}`}
        </button>
      </div>
      <input
        className="quick-add"
        value={draft}
        placeholder="Add a task, press Enter"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
        aria-label="New task"
      />
      {error && <p className="quick-error">Not saved — check the passcode.</p>}
      {loading ? (
        <p className="quick-empty">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="quick-empty">Nothing outstanding.</p>
      ) : (
        <ul>
          {shown.map((t) => (
            <li key={t.id} data-done={String(t.done)}>
              <button
                className="box"
                data-on={String(t.done)}
                aria-pressed={t.done}
                aria-label={`Mark "${t.title}" ${t.done ? "not done" : "done"}`}
                onClick={() => toggle(t.id)}
              >
                <svg viewBox="0 0 24 24">
                  <polyline points="4,12 10,18 20,6" />
                </svg>
              </button>
              <span>{t.title}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
