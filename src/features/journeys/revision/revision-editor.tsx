'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { requestJson } from '@/components/api';
import { RequestErrorMessage } from '@/components/request-error';
import type {
  JourneyView,
  ScheduleRevisionCandidate,
  ScheduleRevisionPreview,
  ScheduleRevisionResult,
} from '@/domain/contracts';
import shared from '@/styles/sanctuary.module.css';
import { PracticeEditor } from '../setup/practice-editor';
import { ScheduleEditor } from '../setup/schedule-editor';
import { createJourneyDraft, type SetupValues } from '../setup/types';
import styles from './revision.module.css';

function effectiveDate(view: JourneyView) {
  return (
    view.sessions.find(
      (session) => !session.supersededAt && Date.parse(session.opensAt) > Date.parse(view.now),
    )?.practiceDate ?? view.journey.schedule.startDate
  );
}

function initialValues(view: JourneyView): SetupValues {
  return {
    title: view.journey.title,
    intention: view.journey.intention,
    practices: view.journey.practices.map((practice, index) => ({
      key: index + 1,
      label: practice.label,
      kind: practice.kind,
      target: practice.target?.toString() ?? '',
    })),
    startDate: effectiveDate(view),
    durationMode: view.journey.schedule.durationMode,
    duration: view.journey.schedule.durationValue.toString(),
    daily: view.journey.schedule.weekdays.length === 7,
    weekdays: view.journey.schedule.weekdays,
    localTime: view.journey.schedule.localTime,
    timeZone: view.journey.schedule.timeZone,
    attribution: view.journey.schedule.attribution,
    windowMinutes: view.journey.schedule.windowMinutes.toString(),
    reminderOffsets: view.journey.reminders.offsets,
  };
}

function toCandidate(values: SetupValues): ScheduleRevisionCandidate {
  const draft = createJourneyDraft(values);
  return {
    effectivePracticeDate: values.startDate,
    practices: draft.practices,
    schedule: {
      durationMode: draft.schedule.durationMode,
      durationValue: draft.schedule.durationValue,
      weekdays: draft.schedule.weekdays,
      localTime: draft.schedule.localTime,
      timeZone: draft.schedule.timeZone,
      attribution: draft.schedule.attribution,
      windowMinutes: draft.schedule.windowMinutes,
    },
  };
}

function candidateSignature(values: SetupValues) {
  return JSON.stringify({
    ...values,
    title: undefined,
    intention: undefined,
    practices: values.practices.map(({ label, kind, target }) => ({ label, kind, target })),
  });
}

export function RevisionEditor({ view }: { view: JourneyView }) {
  const router = useRouter();
  const [values, setValues] = useState(() => initialValues(view));
  const [zoneConfirmed, setZoneConfirmed] = useState(true);
  const [weekdaysError, setWeekdaysError] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [preview, setPreview] = useState<ScheduleRevisionPreview | null>(null);
  const [saved, setSaved] = useState(false);
  const nextKey = useRef(values.practices.length + 1);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const applyOperationId = useRef<string | null>(null);
  const previewAttempt = useRef<{
    signature: string;
    candidate: ScheduleRevisionCandidate;
  } | null>(null);

  useEffect(() => {
    if (preview) previewHeading.current?.focus();
  }, [preview]);

  async function requestPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!values.daily && values.weekdays.length === 0) {
      setWeekdaysError(true);
      return;
    }
    setWeekdaysError(false);
    setPending(true);
    setSaved(false);
    setError(null);
    const signature = candidateSignature(values);
    if (!previewAttempt.current || previewAttempt.current.signature !== signature) {
      previewAttempt.current = { signature, candidate: toCandidate(values) };
    }
    try {
      const result = await requestJson<ScheduleRevisionPreview>(
        `/api/journeys/${view.journey.id}/schedule-revisions`,
        'POST',
        {
          mode: 'preview',
          baseRevision: view.journey.revision,
          payload: previewAttempt.current.candidate,
        },
      );
      applyOperationId.current = crypto.randomUUID();
      setPreview(result);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause
          : new Error('Could not preview this change. Your entries are still here.'),
      );
    } finally {
      setPending(false);
    }
  }

  async function applyRevision() {
    if (!preview || !previewAttempt.current || !applyOperationId.current) return;
    setPending(true);
    setError(null);
    try {
      await requestJson<ScheduleRevisionResult>(
        `/api/journeys/${view.journey.id}/schedule-revisions`,
        'POST',
        {
          mode: 'apply',
          operationId: applyOperationId.current,
          baseRevision: preview.currentRevision,
          payload: {
            candidate: previewAttempt.current.candidate,
            fingerprint: preview.fingerprint,
          },
        },
      );
      setPreview(null);
      setSaved(true);
      applyOperationId.current = null;
      previewAttempt.current = null;
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause
          : new Error('Could not apply this change. Review the latest schedule and try again.'),
      );
    } finally {
      setPending(false);
    }
  }

  if (preview) {
    return (
      <section className={shared.panel} aria-busy={pending}>
        <h2 ref={previewHeading} tabIndex={-1}>
          Review future changes
        </h2>
        <p>
          {preview.retained.length} existing session{preview.retained.length === 1 ? '' : 's'} will
          stay unchanged. {preview.supersededSessionIds.length} unopened session
          {preview.supersededSessionIds.length === 1 ? '' : 's'} will be replaced with{' '}
          {preview.proposed.length} new session{preview.proposed.length === 1 ? '' : 's'}.
        </p>
        <p className={shared.quietNote}>
          The original start remains {preview.originalStartDate}. This change takes effect from{' '}
          {preview.effectivePracticeDate}.
        </p>
        {preview.timestampChanges.length > 0 && (
          <ul className={styles.changeList} aria-label="Changed future sessions">
            {preview.timestampChanges.map((change) => (
              <li key={change.practiceDate}>
                <strong>{change.practiceDate}</strong> —{' '}
                {change.previous && change.proposed
                  ? `${change.previous.opensAt} becomes ${change.proposed.opensAt}`
                  : change.proposed
                    ? `added at ${change.proposed.opensAt}`
                    : 'removed from the future schedule'}
              </li>
            ))}
          </ul>
        )}
        {preview.warnings.map((warning) => (
          <p className={shared.quietNote} key={warning}>
            {warning}
          </p>
        ))}
        <RequestErrorMessage error={error} />
        <div className={shared.actions}>
          <button
            type="button"
            className={shared.button}
            disabled={pending}
            onClick={() => void applyRevision()}
          >
            {pending ? 'Applying change…' : 'Apply future change'}
          </button>
          <button
            type="button"
            className={`${shared.button} ${shared.secondary}`}
            disabled={pending}
            onClick={() => {
              setPreview(null);
              setError(null);
            }}
          >
            Edit future schedule
          </button>
        </div>
      </section>
    );
  }

  return (
    <form className={shared.panel} onSubmit={requestPreview}>
      <h2>Change future sessions</h2>
      <p className={shared.muted}>
        Opened sessions and sessions before the effective practice date keep their original time,
        label and recorded values.
      </p>
      <p className={shared.quietNote}>
        The original start date remains {view.journey.schedule.startDate}. Existing opened and
        earlier sessions stay unchanged.
      </p>
      <div aria-busy={pending} className={styles.editorFields}>
        <PracticeEditor
          practices={values.practices}
          setPractices={(next) =>
            setValues((current) => ({
              ...current,
              practices: typeof next === 'function' ? next(current.practices) : next,
            }))
          }
          nextKey={nextKey}
          disabled={pending}
        />
        <ScheduleEditor
          values={values}
          setValues={setValues}
          zoneConfirmed={zoneConfirmed}
          setZoneConfirmed={setZoneConfirmed}
          weekdaysError={weekdaysError}
          disabled={pending}
          startDateLabel="Change from practice date"
        />
      </div>
      {saved && <p className={shared.success}>Future schedule updated.</p>}
      <RequestErrorMessage error={error} />
      <button className={shared.button} type="submit" disabled={pending}>
        {pending ? 'Preparing changes…' : 'Preview future changes'}
      </button>
    </form>
  );
}
