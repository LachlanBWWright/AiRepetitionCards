"use client";
import { useEffect, useState } from "react";
export function useActivityClock(clock: () => number): number {
  const [now, setNow] = useState(clock);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(clock());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, [clock]);
  return now;
}
