import type { SessionRecord } from '@/domain/contracts';
import type { LocalView, QueueOperation } from '../core';
import shared from '@/styles/sanctuary.module.css';
import styles from './offline.module.css';
import { formatInstant } from './format';

function practiceSummary(session: SessionRecord | null, operation: QueueOperation): string {
  if (operation.intent.kind !== 'practices') return '';
  return Object.entries(operation.intent.payload.values)
    .map(([id, value]) => {
      const label = session?.practices.find((practice) => practice.id === id)?.label ?? 'Practice';
      return `${label}: ${typeof value === 'boolean' ? (value ? 'complete' : 'not complete') : value}`;
    })
    .join('; ');
}

function serverSummary(view: LocalView, operation: QueueOperation): string {
  const conflict = operation.conflict;
  if (!conflict?.currentAvailable) return 'Reconnect to load the current saved version.';
  if (operation.stream === 'reflection') {
    const reflection = conflict.currentReflection;
    return reflection
      ? `${reflection.text || 'No written note.'}${reflection.moods.length ? ` Mood: ${reflection.moods.join(', ')}.` : ''}`
      : 'No reflection is saved on the server.';
  }
  const session = conflict.currentSession;
  if (!session) return 'This practice is no longer available on the server.';
  if (operation.intent.kind === 'practices') return practiceSummary(session, operation);
  if (operation.intent.kind === 'completion')
    return session.confirmed && session.performedAt
      ? `Completion recorded for ${formatInstant(session.performedAt, session.timeZone)}.`
      : 'No completion is recorded on the server.';
  return session.confirmed
    ? 'The completion remains recorded on the server.'
    : 'No completion is recorded on the server.';
}

function localSummary(view: LocalView, operation: QueueOperation): string {
  if (operation.intent.kind === 'reflection') {
    const payload = operation.intent.payload;
    return `${payload.text || 'No written note.'}${payload.moods.length ? ` Mood: ${payload.moods.join(', ')}.` : ''}`;
  }
  if (operation.intent.kind === 'practices')
    return practiceSummary(view.projectedSession, operation);
  if (operation.intent.kind === 'completion')
    return `Record completion for ${formatInstant(operation.intent.payload.performedAt, view.snapshot.session.timeZone)}.`;
  return 'Remove the completion record while retaining saved practice values.';
}

export function OfflineConflict({
  view,
  operation,
  pending,
  onRefresh,
  onUseServer,
  onKeepLocal,
}: {
  view: LocalView;
  operation: QueueOperation;
  pending: boolean;
  onRefresh(): void;
  onUseServer(): void;
  onKeepLocal(): void;
}) {
  return (
    <section className={styles.conflict} role="alert" aria-labelledby="offline-conflict-title">
      <h2 id="offline-conflict-title">This saved practice changed elsewhere</h2>
      <p>
        Your device kept its version. Review both versions and choose deliberately; Sankalpa will
        not merge or move it to another session.
      </p>
      <div className={styles.versions}>
        <section className={styles.version} aria-label="Your unsynced version">
          <h3>Your unsynced version</h3>
          <p>{localSummary(view, operation)}</p>
        </section>
        <section className={styles.version} aria-label="Current saved version">
          <h3>Current saved version</h3>
          <p>{serverSummary(view, operation)}</p>
        </section>
      </div>
      <div className={shared.actions}>
        <button
          type="button"
          className={`${shared.button} ${shared.secondary}`}
          disabled={pending}
          onClick={onRefresh}
        >
          Refresh saved version
        </button>
        <button
          type="button"
          className={shared.button}
          disabled={pending || !operation.conflict?.currentAvailable}
          onClick={onKeepLocal}
        >
          Keep my reviewed version
        </button>
        <button
          type="button"
          className={`${shared.button} ${shared.secondary}`}
          disabled={pending || !operation.conflict?.currentAvailable}
          onClick={onUseServer}
        >
          Use saved version
        </button>
      </div>
    </section>
  );
}
