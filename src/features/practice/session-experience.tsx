'use client';

import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type {
  ReflectionPreferences,
  ReflectionRecord,
  SessionHistory,
  SessionRecord,
} from '@/domain/contracts';
import type { Snapshot } from '@/offline/core';
import { OfflineSession, useOfflineAccount } from '@/offline/ui';
import { ReflectionEditor } from '@/features/journal';
import { PracticePanel } from './practice-panel';
import { HistoryTimeline } from './corrections/history-timeline';

export function SessionExperience({
  session,
  journeyTitle,
  reflection,
  preferences,
  history,
  now,
  demo,
}: {
  session: SessionRecord;
  journeyTitle: string;
  reflection: ReflectionRecord | null;
  preferences: ReflectionPreferences;
  history: SessionHistory;
  now: string;
  demo: boolean;
}) {
  const { status } = useOfflineAccount();
  const router = useRouter();
  const snapshot = useMemo<Snapshot>(
    () => ({
      session,
      journeyTitle,
      reflection,
      preferences,
      lastSyncedAt: now,
      clock: { serverNow: now, capturedAt: new Date().toISOString(), simulated: demo },
    }),
    [session, journeyTitle, reflection, preferences, now, demo],
  );
  const canonicalChanged = useCallback(() => router.refresh(), [router]);
  if (status === 'online_only')
    return (
      <>
        <PracticePanel
          key={`practice-${session.id}`}
          initialSession={session}
          initialNow={now}
          demo={demo}
          initialHistory={history}
        />
        <ReflectionEditor
          key={`reflection-${session.id}`}
          session={session}
          initialReflection={reflection}
          preferences={preferences}
          now={now}
        />
      </>
    );
  if (status !== 'ready') return <p role="status">Verifying this practice space…</p>;
  return (
    <>
      <OfflineSession
        snapshot={snapshot}
        now={now}
        demo={demo}
        onCanonicalChange={canonicalChanged}
      />
      <HistoryTimeline history={history} timeZone={session.timeZone} />
    </>
  );
}
