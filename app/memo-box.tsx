"use client";

// The Notes box that opens under a student on Check-in. A running scratchpad
// that stays until cleared — see lib/memo.ts. Saves as you type. Scores written
// in it ("NBME 28 - 72%", "renal 81") are offered for the progress pills, and
// added only when "Add to progress" is tapped.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Progress } from "@/lib/progress";
import { BULLET, MEMO_MAX, newScores, stampLabel } from "@/lib/memo";

const DOT = BULLET.trim();

export default function MemoBox({
  name,
  memo,
  editedAt,
  progress,
  closing,
  onSave,
  onAddScore,
}: {
  name: string;
  memo: string;
  editedAt: string;
  progress: Progress;
  /** Folding away — plays the close animation. */
  closing: boolean;
  /** Resolves false if the save failed. */
  onSave: (text: string) => Promise<boolean>;
  onAddScore: (kind: "sys" | "nbme", key: string, pct: number) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(memo);
  // The text as of the last pause in typing — scores are read from this, so a
  // half-typed "NBME 28 - 7" never flashes up as 7%.
  const [settled, setSettled] = useState(memo);
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [confirmClear, setConfirmClear] = useState(false);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(0);

  const area = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(memo);
  const dirty = useRef(false);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  /** Where the caret goes once a bullet edit has rendered. */
  const caretAt = useRef<number | null>(null);

  // Put the caret back in the same paint as the edit, before the next keystroke.
  useLayoutEffect(() => {
    const el = area.current;
    if (el && caretAt.current !== null) {
      el.setSelectionRange(caretAt.current, caretAt.current);
      caretAt.current = null;
    }
  }, [draft]);

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current) return;
    dirty.current = false;
    const text = latest.current;
    setSettled(text);
    setState("saving");
    saveRef.current(text).then((ok) => {
      // Failed: try again on the next pause or on close.
      if (!ok && latest.current === text) dirty.current = true;
      setState(ok ? "idle" : "error");
    });
  };

  // Closing the box (or switching student) never loses the last few keystrokes.
  useEffect(() => {
    area.current?.focus({ preventScroll: true });
    const el = area.current;
    if (el) el.setSelectionRange(el.value.length, el.value.length);
    return () => flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const write = (text: string, caret?: number) => {
    const next = text.slice(0, MEMO_MAX);
    setDraft(next);
    latest.current = next;
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
    if (caret !== undefined) caretAt.current = caret;
  };

  // "- " or "* " at the start of a line becomes a bullet (same length, so the
  // caret stays put).
  const onChange = (value: string) => write(value.replace(/^([ \t]*)[-*] /gm, `$1${BULLET}`));

  // Enter on a bullet line starts the next bullet; Enter on an empty bullet
  // ends the list.
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    const { selectionStart: a, selectionEnd: b, value } = el;
    if (a !== b) return;
    const start = value.lastIndexOf("\n", a - 1) + 1;
    const line = value.slice(start, a);
    if (!line.trimStart().startsWith(DOT)) return;
    e.preventDefault();
    if (line.trim() === DOT) {
      write(value.slice(0, start) + value.slice(a), start);
    } else {
      write(value.slice(0, a) + "\n" + BULLET + value.slice(a), a + 1 + BULLET.length);
    }
  };

  // The Bullet button: put a bullet on the line the caret is on, or take it off.
  const toggleBullet = () => {
    const el = area.current;
    if (!el) return;
    const value = el.value;
    const a = el.selectionStart;
    const start = value.lastIndexOf("\n", a - 1) + 1;
    if (value.startsWith(BULLET, start)) {
      write(value.slice(0, start) + value.slice(start + BULLET.length), Math.max(start, a - BULLET.length));
    } else {
      write(value.slice(0, start) + BULLET + value.slice(start), a + BULLET.length);
    }
  };

  const clearAll = () => {
    setConfirmClear(false);
    write("", 0);
    flush();
  };

  const found = useMemo(
    () =>
      newScores(settled, progress).filter((f) => !skipped.has(`${f.kind}:${f.key}:${f.pct}`)),
    [settled, progress, skipped]
  );

  const addAll = async () => {
    setAdding(true);
    let n = 0;
    for (const f of found) if (await onAddScore(f.kind, f.key, f.pct)) n += 1;
    setAdding(false);
    setAdded(n);
    setTimeout(() => setAdded(0), 2600);
  };

  const stamp = stampLabel(editedAt);

  return (
    <div className="memo" data-closing={String(closing)}>
      <div className="memo-inner">
        <div className="memo-card">
          <textarea
            ref={area}
            className="memo-text"
            value={draft}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={flush}
            placeholder={`Anything to remember for ${name} — “cover Repro tomorrow”, “NBME 28 - 72%”…`}
            aria-label={`Notes for ${name}`}
            spellCheck
          />

          {(found.length > 0 || added > 0) && (
            <div className="memo-found">
              {found.length > 0 && <span className="memo-found-head">Found in notes</span>}
              {found.map((f) => {
                const id = `${f.kind}:${f.key}:${f.pct}`;
                return (
                  <span className="memo-chip" key={id}>
                    {f.label} {f.was !== undefined && <><s>{f.was}%</s> </>}→ <b>{f.pct}%</b>
                    <button
                      aria-label={`Don't add ${f.label}`}
                      title="Don't add this one"
                      onClick={() => setSkipped((prev) => new Set(prev).add(id))}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
              {found.length > 0 ? (
                <button className="memo-add" disabled={adding} onClick={addAll}>
                  {adding ? "Adding…" : "Add to progress"}
                </button>
              ) : (
                <span className="memo-added">
                  Added {added} to progress ✓
                </span>
              )}
            </div>
          )}

          <div className="memo-foot">
            <div className="memo-tools">
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={toggleBullet}
                title="Bullet point — or type “- ” at the start of a line"
              >
                {DOT} Bullet
              </button>
              {draft.trim() &&
                (confirmClear ? (
                  <span className="memo-confirm">
                    Clear all of {name}&rsquo;s notes?
                    <button className="danger" onClick={clearAll}>
                      Yes, clear
                    </button>
                    <button onClick={() => setConfirmClear(false)}>Keep</button>
                  </span>
                ) : (
                  <button className="quiet" onClick={() => setConfirmClear(true)}>
                    Clear all
                  </button>
                ))}
            </div>
            <span className="memo-stamp" data-state={state}>
              {state === "saving"
                ? "Saving…"
                : state === "error"
                  ? "Not saved — check the connection"
                  : stamp
                    ? `Last updated on ${stamp}`
                    : "Nothing written yet"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
