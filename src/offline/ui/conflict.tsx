import type { SessionRecord } from '@/domain/contracts';
import type { Intent, LocalView, QueueOperation, RawDraft } from '../core';
import shared from '@/styles/sanctuary.module.css';
import styles from './offline.module.css';
import { formatInstant } from './format';

const valueLabel = (value: boolean | number | string) =>
  typeof value === 'boolean' ? (value ? 'complete' : 'not complete') : String(value);
export function IntentSummary({ session, intent }: { session: SessionRecord; intent: Intent }) {
  if (intent.kind === 'reflection')
    return (
      <>
        <p className={styles.reflectionText}>{intent.payload.text || 'No written note.'}</p>
        <p>Mood: {intent.payload.moods.join(', ') || 'None'}</p>
      </>
    );
  if (intent.kind === 'practices')
    return (
      <ul>
        {Object.entries(intent.payload.values).map(([id, value]) => (
          <li key={id}>
            {session.practices.find((practice) => practice.id === id)?.label ?? 'Practice'}:{' '}
            {valueLabel(value)}
          </li>
        ))}
      </ul>
    );
  if (intent.kind === 'completion')
    return (
      <p>Record completion for {formatInstant(intent.payload.performedAt, session.timeZone)}.</p>
    );
  return <p>Remove the completion record while retaining saved practice values.</p>;
}
export function DraftSummary({
  session,
  draft,
}: {
  session: SessionRecord;
  draft: RawDraft | null;
}) {
  if (!draft || (!draft.reflection && !Object.keys(draft.numericValues ?? {}).length))
    return <p>No unqueued draft.</p>;
  return (
    <>
      {draft.numericValues && (
        <ul>
          {Object.entries(draft.numericValues).map(([id, value]) => (
            <li key={id}>
              {session.practices.find((practice) => practice.id === id)?.label ?? 'Practice'}:{' '}
              {value || '(empty)'}
            </li>
          ))}
        </ul>
      )}
      {draft.reflection && (
        <IntentSummary
          session={session}
          intent={{ kind: 'reflection', payload: draft.reflection }}
        />
      )}
    </>
  );
}
export function SavedSummary({ session }: { session: SessionRecord }) {
  return (
    <>
      <ul>
        {session.practices.map((practice) => (
          <li key={practice.id}>
            {practice.label}: {valueLabel(practice.value)}
          </li>
        ))}
      </ul>
      <p>
        {session.confirmed && session.performedAt
          ? `Completion recorded for ${formatInstant(session.performedAt, session.timeZone)}.`
          : 'No completion is recorded.'}
      </p>
    </>
  );
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
  const comparison = operation.conflict;
  const affected = view.operations.filter((item) => item.stream === operation.stream);
  const draft =
    operation.stream === 'reflection'
      ? view.draft?.reflection
        ? { reflection: view.draft.reflection }
        : null
      : view.draft?.numericValues
        ? { numericValues: view.draft.numericValues }
        : null;
  return (
    <section className={styles.conflict} role="alert" aria-labelledby="offline-conflict-title">
      <h2 id="offline-conflict-title">This saved practice changed elsewhere</h2>
      <p>
        Review every queued change and the unqueued draft below. Other practice or reflection
        changes are kept separately.
      </p>
      <div className={styles.versions}>
        <section className={styles.version} aria-label="Your unsynced version">
          <h3>Your unsynced version</h3>
          <ol aria-label="Changes in order">
            {affected.map((item) => (
              <li key={item.operationId}>
                <IntentSummary session={view.snapshot.session} intent={item.intent} />
              </li>
            ))}
          </ol>
          <h4>Unqueued draft</h4>
          <DraftSummary session={view.snapshot.session} draft={draft} />
        </section>
        <section className={styles.version} aria-label="Current saved version">
          <h3>Current saved version</h3>
          {!comparison?.currentAvailable ? (
            <p>Reconnect to load the current saved version.</p>
          ) : operation.stream === 'reflection' ? (
            comparison.currentReflection ? (
              <IntentSummary
                session={view.snapshot.session}
                intent={{ kind: 'reflection', payload: comparison.currentReflection }}
              />
            ) : (
              <p>No reflection is saved on the server.</p>
            )
          ) : comparison.currentSession ? (
            <SavedSummary session={comparison.currentSession} />
          ) : (
            <p>This practice is no longer available on the server.</p>
          )}
        </section>
      </div>
      <p>
        Keeping your version queues all {affected.length} reviewed change(s) in order and keeps the
        unqueued draft. Using the saved version discards these listed changes and this draft.
      </p>
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
          disabled={
            pending ||
            !comparison?.currentAvailable ||
            !comparison.currentSession ||
            Boolean(comparison.currentSession.supersededAt)
          }
          onClick={onKeepLocal}
        >
          Keep my reviewed version
        </button>
        <button
          type="button"
          className={`${shared.button} ${shared.secondary}`}
          disabled={pending || !comparison?.currentAvailable}
          onClick={onUseServer}
        >
          Use saved version and discard these local changes
        </button>
      </div>
    </section>
  );
}
