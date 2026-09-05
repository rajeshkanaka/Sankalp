'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type {
  JourneyDraft,
  JourneyDraftPreview,
  JourneyRecord,
  JourneyView,
} from '@/domain/contracts';
import { requestJson } from '@/components/api';
import { RequestErrorMessage } from '@/components/request-error';
import shared from '@/styles/sanctuary.module.css';
import { PracticeEditor } from './setup/practice-editor';
import { ScheduleEditor } from './setup/schedule-editor';
import { ScheduleReview } from './setup/schedule-review';
import styles from './setup/setup.module.css';
import { blankSetupValues, twentyOneNightTemplate } from './setup/templates';
import {
  createJourneyDraft,
  draftSignature,
  setupValuesFromDraft,
  type SetupValues,
} from './setup/types';

export function SetupForm({ initialDraft }: { initialDraft?: JourneyRecord }) {
  const router = useRouter();
  const [values, setValues] = useState<SetupValues>(() =>
    initialDraft ? setupValuesFromDraft(initialDraft) : blankSetupValues,
  );
  const [zoneConfirmed, setZoneConfirmed] = useState(false);
  const [weekdaysError, setWeekdaysError] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [preview, setPreview] = useState<JourneyDraftPreview | null>(null);
  const [savedDraft, setSavedDraft] = useState(() =>
    initialDraft ? { id: initialDraft.id, revision: initialDraft.revision } : null,
  );
  const nextKey = useRef(initialDraft ? initialDraft.practices.length + 1 : 2);
  const activationId = useRef<string | null>(null);
  const previewAttempt = useRef<{
    signature: string;
    operationId: string;
    draft: JourneyDraft;
    target: { id: string; baseRevision: number } | null;
  } | null>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    setValues((current) => ({
      ...current,
      timeZone: current.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    }));
  }, []);

  useEffect(() => {
    if (preview) previewHeading.current?.focus();
  }, [preview]);

  function selectTemplate() {
    setValues(twentyOneNightTemplate());
    nextKey.current = 3;
    setZoneConfirmed(false);
    setWeekdaysError(false);
    setError(null);
    setPreview(null);
    previewAttempt.current = null;
  }

  async function previewJourney(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!values.daily && values.weekdays.length === 0) {
      setWeekdaysError(true);
      return;
    }
    setWeekdaysError(false);
    setPending(true);
    setError(null);
    const draft = createJourneyDraft(values);
    const signature = JSON.stringify({ savedDraft, draft: draftSignature(draft) });
    if (!previewAttempt.current || previewAttempt.current.signature !== signature) {
      previewAttempt.current = {
        signature,
        operationId: crypto.randomUUID(),
        draft,
        target: savedDraft && { id: savedDraft.id, baseRevision: savedDraft.revision },
      };
    }
    try {
      const attempt = previewAttempt.current;
      const result = attempt.target
        ? await requestJson<JourneyDraftPreview>(
            `/api/journeys/${attempt.target.id}/draft`,
            'PUT',
            {
              operationId: attempt.operationId,
              baseRevision: attempt.target.baseRevision,
              payload: attempt.draft,
            },
          )
        : await requestJson<JourneyDraftPreview>(
            '/api/journeys',
            'POST',
            attempt.draft,
            attempt.operationId,
          );
      setSavedDraft({ id: result.journey.id, revision: result.journey.revision });
      setValues(setupValuesFromDraft(result.journey));
      nextKey.current = result.journey.practices.length + 1;
      previewAttempt.current = null;
      activationId.current = crypto.randomUUID();
      setPreview(result);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause
          : new Error('Could not preview this journey. Your entries are still here.'),
      );
    } finally {
      setPending(false);
    }
  }

  async function activate() {
    if (!preview) return;
    setPending(true);
    setError(null);
    try {
      const view = await requestJson<JourneyView>(
        `/api/journeys/${preview.journey.id}/activate`,
        'POST',
        {
          operationId: activationId.current,
          baseRevision: preview.journey.revision,
          payload: { fingerprint: preview.fingerprint },
        },
      );
      router.push(`/today?journey=${view.journey.id}`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause : new Error('Could not activate this journey. Try again.'),
      );
      setPending(false);
    }
  }

  if (preview) {
    return (
      <ScheduleReview
        ref={previewHeading}
        result={preview}
        pending={pending}
        error={error}
        onActivate={() => void activate()}
        onEdit={() => {
          setPreview(null);
          setError(null);
          activationId.current = null;
        }}
      />
    );
  }

  return (
    <form onSubmit={previewJourney} className={shared.panel}>
      <div className={styles.templateBar}>
        <p>Start blank, or load an editable example. Nothing is selected automatically.</p>
        <button
          type="button"
          className={`${shared.button} ${shared.secondary}`}
          disabled={pending}
          onClick={selectTemplate}
        >
          Use 21-night example
        </button>
      </div>
      <fieldset className={shared.formSection} disabled={pending}>
        <legend>Your intention</legend>
        <div className={shared.field}>
          <label htmlFor="journey-title">Journey title</label>
          <input
            id="journey-title"
            required
            maxLength={120}
            value={values.title}
            onChange={(event) =>
              setValues((current) => ({ ...current, title: event.target.value }))
            }
          />
        </div>
        <div className={shared.field}>
          <label htmlFor="intention">
            Personal intention <span className={shared.muted}>(optional)</span>
          </label>
          <textarea
            id="intention"
            maxLength={4000}
            value={values.intention}
            onChange={(event) =>
              setValues((current) => ({ ...current, intention: event.target.value }))
            }
            aria-describedby="intention-help"
          />
          <small id="intention-help">A few words about what brings you to this practice.</small>
        </div>
      </fieldset>
      <div aria-busy={pending}>
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
        />
      </div>
      <p className={shared.quietNote}>
        Your preview keeps every scheduled date, including earlier dates when the journey still has
        an unopened session. It will show any adjusted local time or overlap warning before you
        activate.
      </p>
      <RequestErrorMessage error={error} />
      <button type="submit" className={shared.button} disabled={pending}>
        {pending ? 'Preparing preview…' : 'Preview journey'}
      </button>
    </form>
  );
}
