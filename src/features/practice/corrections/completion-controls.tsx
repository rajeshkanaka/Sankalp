'use client';

import { Temporal } from '@js-temporal/polyfill';
import { useState, type FormEvent } from 'react';

import type { SessionRecord } from '@/domain/contracts';
import { deriveCompletionTiming } from '@/domain/status';
import { useOnlineEditorCheckpoint } from '../use-online-editor-checkpoint';
import { formatInstant } from '@/components/presentation';
import styles from '@/styles/sanctuary.module.css';

function localInputValue(instant: string, timeZone: string) {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(timeZone)
    .toPlainDateTime()
    .toString({ smallestUnit: 'minute' });
}

function instantFromLocalInput(value: string, timeZone: string) {
  const local = Temporal.PlainDateTime.from(value);
  const zoned = local.toZonedDateTime(timeZone, { disambiguation: 'earlier' });
  if (!zoned.toPlainDateTime().equals(local)) {
    throw new RangeError('That local time does not exist in this practice timezone.');
  }
  return zoned.toInstant().toString();
}

export function CompletionControls({
  session,
  now,
  pending,
  onRecord,
  onRemove,
}: {
  session: SessionRecord;
  now: string;
  pending: boolean;
  onRecord: (performedAt: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(!session.confirmed);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [localTime, setLocalTime] = useState(() =>
    localInputValue(session.performedAt ?? session.opensAt, session.timeZone),
  );
  const { frozen, isFrozen } = useOnlineEditorCheckpoint(
    editing &&
      localTime !== localInputValue(session.performedAt ?? session.opensAt, session.timeZone),
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const timing = deriveCompletionTiming(session);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isFrozen()) return;
    try {
      const performedAt = instantFromLocalInput(localTime, session.timeZone);
      const instant = Date.parse(performedAt);
      if (instant < Date.parse(session.opensAt) || instant > Date.parse(now)) {
        setLocalError('Choose a time between this session opening and the current time.');
        return;
      }
      if (session.performedAt && instant === Date.parse(session.performedAt)) {
        setLocalError('Choose a different practice time before saving a correction.');
        return;
      }
      setLocalError(null);
      onRecord(performedAt);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Enter a valid practice time.');
    }
  }

  return (
    <section className={styles.formSection} aria-label="Completion record">
      <h2>Completion record</h2>
      {session.confirmed && (
        <div>
          <p>
            Practiced {formatInstant(session.performedAt!, session.timeZone)} in {session.timeZone}.
          </p>
          {timing.practiceTiming === 'practiced_late' ? (
            <p className={styles.quietNote}>
              <strong>Practiced late.</strong> This counts as recorded completion without extending
              the on-schedule streak.
            </p>
          ) : timing.recordedLater ? (
            <p className={styles.quietNote}>
              <strong>Recorded later.</strong> The reported practice time was inside the original
              window and counts toward the on-schedule streak.
            </p>
          ) : (
            <p className={styles.quietNote}>Recorded during the original practice window.</p>
          )}
        </div>
      )}

      {editing && (
        <form onSubmit={submit}>
          <div className={styles.field}>
            <label htmlFor={`performed-at-${session.id}`}>
              Actual practice time in {session.timeZone}
            </label>
            <input
              id={`performed-at-${session.id}`}
              type="datetime-local"
              step={60}
              required
              value={localTime}
              disabled={pending || frozen}
              onChange={(event) => {
                setLocalTime(event.target.value);
                setLocalError(null);
              }}
              aria-describedby={`performed-at-help-${session.id}`}
            />
            <small id={`performed-at-help-${session.id}`}>
              Enter when you practiced. A time before the window closed is Recorded later; a time at
              or after closing is Practiced late.
            </small>
          </div>
          {localError && (
            <p className={styles.error} role="alert">
              {localError}
            </p>
          )}
          <div className={styles.actions}>
            <button type="submit" className={styles.button} disabled={pending || frozen}>
              {pending
                ? 'Saving completion…'
                : session.confirmed
                  ? 'Save corrected practice time'
                  : 'Record historical completion'}
            </button>
            {session.confirmed && (
              <button
                type="button"
                className={`${styles.button} ${styles.secondary}`}
                disabled={pending || frozen}
                onClick={() => {
                  setEditing(false);
                  setLocalError(null);
                }}
              >
                Cancel time correction
              </button>
            )}
          </div>
        </form>
      )}

      {session.confirmed && !editing && !confirmingRemoval && (
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.button} ${styles.secondary}`}
            disabled={pending || frozen}
            onClick={() => setEditing(true)}
          >
            Correct practice time
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.secondary}`}
            disabled={pending || frozen}
            onClick={() => setConfirmingRemoval(true)}
          >
            Remove completion
          </button>
        </div>
      )}

      {session.confirmed && confirmingRemoval && (
        <div>
          <p className={styles.quietNote}>
            Remove the completion record? Saved practice values and history will remain.
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.button}
              disabled={pending || frozen}
              onClick={onRemove}
            >
              {pending ? 'Removing completion…' : 'Confirm remove completion'}
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.secondary}`}
              disabled={pending || frozen}
              onClick={() => setConfirmingRemoval(false)}
            >
              Keep completion
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
