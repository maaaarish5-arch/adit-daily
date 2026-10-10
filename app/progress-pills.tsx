"use client";

// The tappable pills under a student's note on Check-in.
//   Phase 1 — Micro, Pharm, Renal, Respi
//   Phase 2 — all 16 First Aid systems
//   Phase 3 and 4 — NBME 26 to 33, each pill a bar filled to the score
// Tapping one opens a small box asking for the % — a system is only marked
// done once its average is in.

import { useState } from "react";
import {
  NBMES,
  NBME_TARGET,
  P1_SYSTEMS,
  SYSTEMS,
  cleanPct,
  type Progress,
} from "@/lib/progress";

type Kind = "sys" | "nbme";
type Mode = "p1" | "p2" | "nbme";

const HELP: Record<Mode, string> = {
  p1: "Phase 1 is the foundation: Micro, Pharm, Renal and Respi. When the student finishes one, tap it and type their average for that system (%). Tap a done system to change the number or mark it not done.",
  p2: "Tap a system when the student has finished it, then type their average for that system (%). Systems ticked in Phase 1 are already here. Tap a done system to change the number or mark it not done.",
  nbme: `Tap each NBME the student has taken and type their score (%). The bar fills to the score; the line marks ${NBME_TARGET}%. Tap a taken NBME to change the score or clear it.`,
};

export default function ProgressPills({
  name,
  mode,
  progress,
  onSave,
}: {
  name: string;
  mode: Mode;
  progress: Progress;
  /** pct null clears the pill. Resolves false if the save failed. */
  onSave: (kind: Kind, key: string, pct: number | null) => Promise<boolean>;
}) {
  const [help, setHelp] = useState(false);
  const [open, setOpen] = useState<{ kind: Kind; key: string; label: string } | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const items =
    mode === "nbme"
      ? NBMES.map((n) => ({ kind: "nbme" as Kind, key: String(n), label: `NBME ${n}`, short: String(n) }))
      : SYSTEMS.filter((s) => mode === "p2" || P1_SYSTEMS.includes(s.id)).map((s) => ({
          kind: "sys" as Kind,
          key: s.id,
          label: s.name,
          short: s.label,
        }));

  const valueOf = (kind: Kind, key: string) =>
    (progress[kind] as Record<string, number | undefined>)[key];
  const done = items.filter((i) => valueOf(i.kind, i.key) !== undefined).length;

  const start = (kind: Kind, key: string, label: string) => {
    if (open?.key === key) return setOpen(null);
    const v = valueOf(kind, key);
    setOpen({ kind, key, label });
    setValue(v === undefined ? "" : String(v));
    setError("");
  };

  const commit = async (pct: number | null) => {
    if (!open) return;
    setBusy(true);
    const ok = await onSave(open.kind, open.key, pct);
    setBusy(false);
    if (ok) setOpen(null);
    else setError("Not saved — try again");
  };

  const typed = cleanPct(value);
  const current = open ? valueOf(open.kind, open.key) : undefined;

  return (
    <div className="prog" data-mode={mode}>
      <div className="prog-head">
        <span>
          {mode === "nbme" ? "NBMEs" : mode === "p1" ? "Foundation" : "Systems"} done{" "}
          <b>
            {done}/{items.length}
          </b>
        </span>
        <button
          className="prog-q"
          aria-expanded={help}
          aria-label="What do I do here?"
          onClick={() => setHelp((v) => !v)}
        >
          ?
        </button>
      </div>
      {help && <p className="prog-help">{HELP[mode]}</p>}

      <div className="prog-pills">
        {items.map((i) => {
          const v = valueOf(i.kind, i.key);
          const on = v !== undefined;
          return (
            <button
              key={i.key}
              className="pill"
              data-kind={i.kind}
              data-on={String(on)}
              data-open={String(open?.key === i.key)}
              data-pass={String(on && v >= NBME_TARGET)}
              aria-label={`${i.label}${on ? ` — ${v}%` : " — not done"}`}
              title={`${i.label}${on ? ` · ${v}%` : ""}`}
              onClick={() => start(i.kind, i.key, i.label)}
            >
              {i.kind === "nbme" && (
                <>
                  <i className="pill-fill" style={{ width: `${on ? v : 0}%` }} />
                  <i className="pill-target" style={{ left: `${NBME_TARGET}%` }} />
                </>
              )}
              <span className="pill-txt">
                {i.short}
                {on && <em>{v}%</em>}
              </span>
            </button>
          );
        })}
      </div>

      {open && (
        <div className="prog-edit">
          <span>
            {open.kind === "nbme" ? `${open.label} score` : `${open.label} average`} for {name || "this student"}
          </span>
          <span className="prog-input">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="any"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && typed !== null) commit(typed);
                if (e.key === "Escape") setOpen(null);
              }}
              placeholder="__"
              aria-label={`${open.label} percentage`}
            />
            %
          </span>
          <button disabled={busy || typed === null} onClick={() => typed !== null && commit(typed)}>
            {current === undefined ? "Mark done" : "Save"}
          </button>
          {current !== undefined && (
            <button disabled={busy} onClick={() => commit(null)}>
              {open.kind === "nbme" ? "Not taken" : "Not done"}
            </button>
          )}
          <button className="prog-cancel" disabled={busy} onClick={() => setOpen(null)}>
            Cancel
          </button>
          {value !== "" && typed === null && <span className="prog-err">0 to 100</span>}
          {error && <span className="prog-err">{error}</span>}
        </div>
      )}
    </div>
  );
}
