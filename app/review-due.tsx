"use client";

// Check-in's "written reviews" panel: from the day after a student's exam
// until the review is marked received. The dashboard never messages anyone —
// someone asks on WhatsApp, then marks it here.
//
// A review nobody has asked for by REVIEW_MISSED_DAYS after the exam moves out
// of the panel into the rust "missed" alert at the top of Check-in, and stays
// there until it is marked asked.
//
// Once it is asked for, the row only asks "Have you gotten the review?" —
// a plain question, never a warning, until it is marked received.

import { useState } from "react";
import {
  REVIEW_MAX,
  daysBetween,
  longDay,
  reviewState,
  type Student,
} from "@/lib/roster";

export type ReviewChange = { asked: boolean } | { done: boolean; text?: string };

function shortStamp(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function firstName(s: Student): string {
  return s.name.trim().split(" ")[0] || "them";
}

export function ReviewMissed({
  missed,
  today,
  onChange,
}: {
  missed: Student[];
  today: string;
  onChange: (id: string, change: ReviewChange) => Promise<boolean>;
}) {
  if (!missed.length) return null;
  return (
    <section className="review-missed" role="alert" aria-label="Written reviews missed">
      <div className="review-missed-head">
        <span className="review-missed-tag">Missed</span>
        <h3>
          {missed.length === 1
            ? "A written review was never asked for"
            : `${missed.length} written reviews were never asked for`}
        </h3>
      </div>
      {missed.map((s) => (
        <ReviewRow key={s.id} s={s} today={today} onChange={onChange} missed />
      ))}
    </section>
  );
}

export default function ReviewDue({
  due,
  today,
  onChange,
}: {
  due: Student[];
  today: string;
  onChange: (id: string, change: ReviewChange) => Promise<boolean>;
}) {
  if (!due.length) return null;
  const waiting = due.filter((s) => reviewState(s) === "asked").length;
  return (
    <section className="due reviews" aria-label="Written reviews to ask for">
      <div className="due-head">
        <h3>Written reviews</h3>
        <span className="hair" />
        <span className="reviews-count">
          <b>{due.length - waiting}</b> to ask for
          {waiting > 0 && <> · <b>{waiting}</b> waiting</>}
        </span>
      </div>
      {due.map((s) => (
        <ReviewRow key={s.id} s={s} today={today} onChange={onChange} />
      ))}
    </section>
  );
}

function ReviewRow({
  s,
  today,
  onChange,
  missed = false,
}: {
  s: Student;
  today: string;
  onChange: (id: string, change: ReviewChange) => Promise<boolean>;
  missed?: boolean;
}) {
  const state = reviewState(s);
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const ago = daysBetween(s.examDate, today);

  const send = async (change: ReviewChange) => {
    setBusy(true);
    setFailed(false);
    const ok = await onChange(s.id, change);
    setBusy(false);
    if (!ok) setFailed(true);
    return ok;
  };

  return (
    <div className="review-row" data-state={state}>
      <div className="review-who">
        <b>{s.name || "(unnamed)"}</b>
        <span>
          Exam {longDay(s.examDate)} · {ago === 1 ? "yesterday" : `${ago} days ago`}
        </span>
      </div>

      <div className="review-step">
        {state === "asked" ? (
          <>
            ✓ Asked {shortStamp(s.reviewAskedAt)} · Have you gotten the review?
            <button
              className="review-undo"
              disabled={busy}
              onClick={() => send({ asked: false })}
              title="Mark as not asked yet"
            >
              Undo
            </button>
          </>
        ) : missed ? (
          <>Ask {firstName(s)} for a written review today</>
        ) : (
          <>Ask {firstName(s)} for a written review</>
        )}
      </div>

      <div className="review-actions">
        {state === "todo" && (
          <button className="btn" disabled={busy} onClick={() => send({ asked: true })}>
            Review asked
          </button>
        )}
        {state === "asked" && !pasting && (
          <button className="btn" disabled={busy} onClick={() => setPasting(true)}>
            Yes, got it
          </button>
        )}
      </div>

      {pasting && (
        <div className="review-paste">
          <textarea
            value={text}
            maxLength={REVIEW_MAX}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the review here (optional)…"
            rows={4}
            autoFocus
          />
          <div className="review-paste-actions">
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                if (await send({ done: true, text: text.trim() })) setPasting(false);
              }}
            >
              {text.trim() ? "Save review" : "Mark received"}
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => setPasting(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {failed && <span className="prog-err">Not saved. Try again.</span>}
    </div>
  );
}
