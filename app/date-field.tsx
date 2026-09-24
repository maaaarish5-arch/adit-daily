"use client";

import { useEffect, useState } from "react";

/**
 * Day / month / year, as three dropdowns that remember what you picked.
 *
 * The subtle failure this exists to avoid: a date is only storable once all
 * three parts are chosen, so an earlier version simply discarded any pick that
 * left the date incomplete. Because the dropdowns rendered from the STORED
 * value, each selection sprang back to its placeholder the instant it was made
 * — you could never get to the second part, let alone the third.
 *
 * So the three parts live here, as local state. They hold whatever has been
 * chosen so far, and the date is pushed outward only once it is complete.
 */

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const pad = (n: number) => String(n).padStart(2, "0");

function daysIn(year: number, month: number): number {
  if (!year || !month) return 31;
  return new Date(year, month, 0).getDate();
}

function parse(value: string): { y: number; m: number; d: number } {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return parts
    ? { y: Number(parts[1]), m: Number(parts[2]), d: Number(parts[3]) }
    : { y: 0, m: 0, d: 0 };
}

export default function DateField({
  value,
  onCommit,
  ariaLabel,
}: {
  value: string;
  onCommit: (next: string) => void;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
}) {
  const [part, setPart] = useState(() => parse(value));

  // Re-sync only when the stored value genuinely differs from what is shown —
  // an edit from the other person, or a background refresh. Our own commits
  // round-trip to the same thing and leave the dropdowns alone.
  useEffect(() => {
    const next = parse(value);
    setPart((prev) =>
      prev.y === next.y && prev.m === next.m && prev.d === next.d ? prev : next
    );
  }, [value]);

  const pick = (next: { y: number; m: number; d: number }) => {
    // Never let a stored day survive into a month too short for it.
    const capped = { ...next, d: Math.min(next.d, daysIn(next.y, next.m)) };
    setPart(capped);

    if (capped.y && capped.m && capped.d) {
      onCommit(`${capped.y}-${pad(capped.m)}-${pad(capped.d)}`);
    } else if (value) {
      // A part was blanked out deliberately — that is a cleared date.
      onCommit("");
    }
  };

  const years = (() => {
    const now = new Date().getFullYear();
    const list: number[] = [];
    for (let i = now - 1; i <= now + 4; i++) list.push(i);
    if (part.y && !list.includes(part.y)) list.push(part.y);
    return list.sort((a, b) => a - b);
  })();

  return (
    <div className="dmy" role="group" aria-label={ariaLabel}>
      <select
        value={part.d || ""}
        data-set={String(Boolean(part.d))}
        aria-label={`${ariaLabel} — day`}
        onChange={(e) => pick({ ...part, d: Number(e.target.value) })}
      >
        <option value="">Day</option>
        {Array.from({ length: daysIn(part.y, part.m) }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>

      <select
        value={part.m || ""}
        data-set={String(Boolean(part.m))}
        aria-label={`${ariaLabel} — month`}
        onChange={(e) => pick({ ...part, m: Number(e.target.value) })}
      >
        <option value="">Month</option>
        {MONTH_NAMES.map((name, i) => (
          <option key={name} value={i + 1}>
            {name}
          </option>
        ))}
      </select>

      <select
        value={part.y || ""}
        data-set={String(Boolean(part.y))}
        aria-label={`${ariaLabel} — year`}
        onChange={(e) => pick({ ...part, y: Number(e.target.value) })}
      >
        <option value="">Year</option>
        {years.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </div>
  );
}
