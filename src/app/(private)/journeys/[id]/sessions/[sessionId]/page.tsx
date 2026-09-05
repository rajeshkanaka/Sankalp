import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPageUser } from '@/server/auth/server';
import { getPageJourneyView as getJourneyView } from '@/server/journeys/pages';
import { getRuntimeInfo } from '@/server/config';
import { PageHeader, formatPracticeDate } from '@/components/presentation';
import { Icon } from '@/components/icons';
import { PracticePanel } from '@/features/practice/practice-panel';
import { ReflectionEditor } from '@/features/journal';
import { getReflection, getReflectionPreferences } from '@/server/journal';
import { getSessionHistory } from '@/server/sessions/service';
import styles from '@/styles/sanctuary.module.css';

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const user = await getPageUser();
  const { id, sessionId } = await params;
  const view = await getJourneyView(user.id, id);
  if (!view) notFound();
  const session = view.sessions.find(
    (record) => record.id === sessionId && record.journeyId === id && !record.supersededAt,
  );
  if (!session) notFound();
  const [reflection, preferences, history] = await Promise.all([
    getReflection(user.id, sessionId),
    getReflectionPreferences(user.id),
    getSessionHistory(user.id, sessionId),
  ]);
  const runtime = getRuntimeInfo();
  return (
    <div className={styles.practicePage}>
      <Link prefetch={false} href={`/journeys/${id}`} className={styles.back}>
        <Icon name="back" />
        Your journey
      </Link>
      <PageHeader
        title={view.journey.title}
        description={`${session.attribution === 'previous_evening' ? 'Night' : 'Session'} ${session.ordinal} of ${view.metrics.total} · ${formatPracticeDate(session.practiceDate)} · ${session.timeZone}`}
      />
      {view.journey.intention && <p className={styles.intention}>{view.journey.intention}</p>}
      <PracticePanel
        key={`practice-${session.id}`}
        initialSession={session}
        initialNow={view.now}
        demo={runtime.demo}
        initialHistory={history}
      />
      <ReflectionEditor
        key={`reflection-${session.id}`}
        session={session}
        initialReflection={reflection}
        preferences={preferences}
        now={view.now}
      />
    </div>
  );
}
