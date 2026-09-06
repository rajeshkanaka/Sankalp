'use client';
import { useEffect, useState } from 'react';

export function usePracticeClock(initialNow: string, demo: boolean) {
  const [now, setNow] = useState(initialNow);
  useEffect(() => {
    if (demo) return;
    setNow(initialNow);
    const startedAt = Date.now();
    const initial = Date.parse(initialNow);
    const interval = window.setInterval(
      () => setNow(new Date(initial + Date.now() - startedAt).toISOString()),
      1000,
    );
    return () => window.clearInterval(interval);
  }, [initialNow, demo]);
  return demo ? initialNow : now;
}

export function countdownLabel(opensAt: string, now: string) {
  const minutes = Math.max(0, Math.ceil((Date.parse(opensAt) - Date.parse(now)) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainder = minutes % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${remainder}m`;
  return `${remainder}m`;
}
