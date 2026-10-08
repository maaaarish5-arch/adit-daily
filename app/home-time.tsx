"use client";

// A student's live local time, shown next to their name: "PK 3:12 PM · IST −30m".
// Nothing for students in India or with no country set — IST is already the
// clock on the wall.

import { useEffect, useState } from "react";
import { IST, homeClock, offsetLabel, placeFor, placeLabel } from "@/lib/timezones";

/** The current time, flipping exactly as each minute turns over. Null until
 *  mounted, so the server render and the first client render agree. Browsers
 *  slow timers in background tabs, so it also catches up the moment the tab is
 *  looked at again. */
export function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const d = new Date();
      setNow(d);
      clearTimeout(timer);
      // 50ms past the turn of the minute, so it never lands just short of it.
      timer = setTimeout(tick, 60_000 - (d.getTime() % 60_000) + 50);
    };
    const onShow = () => document.visibilityState === "visible" && tick();
    tick();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, []);
  return now;
}

export default function HomeTime({ tz }: { tz: string | undefined }) {
  const now = useNow();
  const place = tz ? placeFor(tz) : undefined;
  if (!now || !place || place.tz === IST) return null;
  const c = homeClock(place.tz, now);
  return (
    <span
      className="home-time"
      data-night={String(c.night)}
      title={`${placeLabel(place)} — ${c.time}${c.day ? ` ${c.day}` : ""} there, ${offsetLabel(c.vsIst)}${c.night ? ". Late night there." : ""}`}
    >
      <b>{place.code}</b>
      {c.time}
      {c.day && <i>{c.day}</i>}
      <span className="vs">{offsetLabel(c.vsIst)}</span>
    </span>
  );
}
