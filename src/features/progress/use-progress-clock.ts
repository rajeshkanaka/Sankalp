'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePracticeClock } from '@/features/practice/use-practice-clock';

export function useProgressClock(initialNow: string, demo: boolean, boundaries: string[]) {
  const router = useRouter();
  const now = usePracticeClock(initialNow, demo);
  const nextBoundary = Math.min(
    ...boundaries.map(Date.parse).filter((value) => value > Date.parse(initialNow)),
  );
  useEffect(() => {
    let hidden = document.visibilityState === 'hidden';
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && hidden) router.refresh();
      hidden = document.visibilityState === 'hidden';
    };
    document.addEventListener('visibilitychange', onVisibility);
    // Refresh the canonical server snapshot when a status can change, not on every countdown tick.
    const timer =
      !demo && Number.isFinite(nextBoundary)
        ? window.setTimeout(
            () => router.refresh(),
            Math.min(2_147_483_647, Math.max(0, nextBoundary - Date.parse(initialNow)) + 100),
          )
        : undefined;
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [initialNow, nextBoundary, demo, router]);
  return now;
}
