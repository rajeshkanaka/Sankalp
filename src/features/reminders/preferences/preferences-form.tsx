'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { RequestError } from '@/components/api';
import { RequestErrorMessage } from '@/components/request-error';
import type { MutationEnvelope, ReminderPreferences } from '@/domain/contracts';
import type { ReminderPreferenceView } from '@/domain/reminder-contracts';
import shared from '@/styles/sanctuary.module.css';
import {
  createReminderAttempt,
  fieldsFromPreferences,
  readPreferenceView,
  validateFields,
  type FieldIssue,
  type PreferenceFields,
} from './model';
import { ReminderPreview } from './preview';
import styles from './preferences.module.css';

interface Props {
  initial: ReminderPreferenceView;
  onSave(input: MutationEnvelope<ReminderPreferences>): Promise<ReminderPreferenceView>;
}

export function ReminderPreferencesForm(props: Props) {
  return <PreferencesEditor key={props.initial.journeyId} {...props} />;
}

function PreferencesEditor({ initial, onSave }: Props) {
  const id = useId();
  const [saved, setSaved] = useState(initial);
  const [fields, setFields] = useState(() => fieldsFromPreferences(initial.preferences));
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState<ReminderPreferenceView | null>(null);
  const submitting = useRef(false);
  const alive = useRef(true);
  const attempt = useRef<MutationEnvelope<ReminderPreferences> | null>(null);
  const summary = useRef<HTMLDivElement>(null);
  // Fresh props are a comparison, never permission to replace unfinished local input.
  const newerProps = initial.revision > saved.revision ? initial : null;
  const latest =
    newerProps && (!conflict || newerProps.revision > conflict.revision) ? newerProps : conflict;
  // Device registration can change without a preference revision. Refresh its visible state
  // independently of the raw form so registration never discards unfinished choices.
  const previewView = latest ?? (initial.revision === saved.revision ? initial : saved);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (issues.length) summary.current?.focus();
  }, [issues]);

  function edit(next: PreferenceFields) {
    if (submitting.current) return;
    setFields(next);
    setIssues([]);
    setError(null);
    setNotice('Unsaved choices. The preview still shows saved settings.');
    // Even editing away and back is a new intent; only an unchanged retry reuses an envelope.
    attempt.current = null;
  }

  function chooseLatest(keepEdits: boolean) {
    if (!latest || submitting.current) return;
    setSaved(latest);
    if (!keepEdits) setFields(fieldsFromPreferences(latest.preferences));
    setConflict(null);
    attempt.current = null;
    setError(null);
    setIssues([]);
    setNotice(
      keepEdits
        ? 'Your choices are still here. Review them and save to replace the latest saved settings.'
        : 'Latest saved settings loaded. Your previous unsaved choices were discarded.',
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || latest) return;
    const validated = validateFields(fields);
    setError(null);
    setNotice('');
    if (!validated.success) {
      setIssues(validated.issues);
      return;
    }
    setIssues([]);
    submitting.current = true;
    setPending(true);
    try {
      attempt.current ??= createReminderAttempt(
        validated.preferences,
        saved.revision,
        crypto.randomUUID(),
      );
      const sent = attempt.current;
      const response = await onSave(structuredClone(sent));
      if (!alive.current) return;
      const result = readPreferenceView(response, saved.journeyId);
      if (!result || result.revision <= sent.baseRevision)
        throw new RequestError(
          'The server response could not be verified. Your choices are still here. Retry to check the same save.',
          'RESPONSE_ERROR',
        );
      setSaved(result);
      setFields(fieldsFromPreferences(result.preferences));
      setConflict(null);
      attempt.current = null;
      setNotice('Reminder preferences saved.');
    } catch (cause) {
      if (!alive.current) return;
      const failure =
        cause instanceof Error
          ? cause
          : new Error('Could not save reminder preferences. Your choices are still here.');
      setError(failure);
      if (failure instanceof RequestError && failure.status === 409) {
        const current = readPreferenceView(failure.current, saved.journeyId);
        if (current && current.revision >= saved.revision) setConflict(current);
      }
    } finally {
      submitting.current = false;
      if (alive.current) setPending(false);
    }
  }

  const issueFor = (field: string) => issues.some((issue) => issue.field === field);
  const errorDescription = issues.length ? `${id}-validation` : undefined;

  return (
    <div className={styles.layout}>
      <form className={shared.panel} aria-label="Reminder preferences" onSubmit={submit} noValidate>
        <h2>Reminders for {saved.journeyTitle}</h2>
        <p className={shared.muted}>
          Choose timely prompts for your own routine. Reminders support your practice; they are not
          guaranteed wake-up alarms. Saving here does not request notification permission or
          register a device.
        </p>
        <fieldset className={shared.formSection} disabled={pending}>
          <legend>Your reminder choices</legend>
          <label className={shared.checkLabel}>
            <input
              type="checkbox"
              checked={fields.enabled}
              onChange={(event) => edit({ ...fields, enabled: event.target.checked })}
            />
            <span>Enable reminders</span>
          </label>
          <p id={`${id}-offset-help`} className={shared.small}>
            Choose up to eight different times, from 0 to 1440 minutes before practice. Zero means
            at practice time. Choices stay editable while reminders are disabled.
          </p>
          {fields.offsets.map((value, index) => (
            <div className={styles.offsetRow} key={index}>
              <div className={shared.field}>
                <label htmlFor={`${id}-offset-${index}`}>
                  Reminder {index + 1}: minutes before practice
                </label>
                <input
                  id={`${id}-offset-${index}`}
                  type="text"
                  inputMode="numeric"
                  maxLength={20}
                  value={value}
                  aria-invalid={issueFor(`offsets.${index}`) || issueFor('offsets') || undefined}
                  aria-describedby={[`${id}-offset-help`, errorDescription]
                    .filter(Boolean)
                    .join(' ')}
                  onChange={(event) =>
                    edit({
                      ...fields,
                      offsets: fields.offsets.map((item, offset) =>
                        offset === index ? event.target.value : item,
                      ),
                    })
                  }
                />
              </div>
              <button
                type="button"
                className={`${shared.button} ${shared.secondary}`}
                aria-label={`Remove reminder ${index + 1}`}
                onClick={() =>
                  edit({
                    ...fields,
                    offsets: fields.offsets.filter((_, offset) => offset !== index),
                  })
                }
              >
                Remove
              </button>
            </div>
          ))}
          <div className={shared.actions}>
            <button
              type="button"
              className={`${shared.button} ${shared.secondary}`}
              disabled={fields.offsets.length >= 8}
              onClick={() => edit({ ...fields, offsets: [...fields.offsets, ''] })}
            >
              Add reminder time
            </button>
            <button
              type="button"
              className={`${shared.button} ${shared.secondary}`}
              disabled={
                fields.offsets.length >= 8 ||
                fields.offsets.some((value) => /^\d+$/.test(value) && Number(value) === 15)
              }
              onClick={() => edit({ ...fields, offsets: [...fields.offsets, '15'] })}
            >
              Add 15-minute reminder
            </button>
          </div>
        </fieldset>

        <fieldset className={shared.formSection} disabled={pending}>
          <legend>Quiet hours</legend>
          <label className={shared.checkLabel}>
            <input
              type="checkbox"
              checked={fields.quietEnabled}
              onChange={(event) => edit({ ...fields, quietEnabled: event.target.checked })}
              aria-describedby={`${id}-quiet-help`}
            />
            <span>Use quiet hours</span>
          </label>
          <p id={`${id}-quiet-help`} className={shared.small}>
            Quiet hours use each session’s saved timezone. Reminders in this period are suppressed,
            not moved. The period can cross midnight; start and end must be different.
          </p>
          {fields.quietEnabled && (
            <div className={shared.fieldGrid}>
              {(['start', 'end'] as const).map((boundary) => (
                <div className={shared.field} key={boundary}>
                  <label htmlFor={`${id}-quiet-${boundary}`}>Quiet hours {boundary} (HH:mm)</label>
                  <input
                    id={`${id}-quiet-${boundary}`}
                    type="text"
                    placeholder="HH:mm"
                    maxLength={20}
                    value={boundary === 'start' ? fields.quietStart : fields.quietEnd}
                    aria-invalid={issueFor(`quietHours.${boundary}`) || undefined}
                    aria-describedby={errorDescription}
                    onChange={(event) =>
                      edit({
                        ...fields,
                        [boundary === 'start' ? 'quietStart' : 'quietEnd']: event.target.value,
                      })
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </fieldset>

        <fieldset className={shared.formSection} disabled={pending}>
          <legend>Notification privacy</legend>
          <label className={shared.checkLabel}>
            <input
              type="checkbox"
              checked={fields.detailed}
              onChange={(event) => edit({ ...fields, detailed: event.target.checked })}
              aria-describedby={`${id}-privacy-help`}
            />
            <span>Include practice details in notifications</span>
          </label>
          <p id={`${id}-privacy-help`} className={shared.small}>
            Generic notification text protects your privacy. Turn on details only if you are
            comfortable with practice information appearing on your lock screen. Private reflections
            are never included.
          </p>
        </fieldset>

        {issues.length > 0 && (
          <div
            id={`${id}-validation`}
            className={shared.error}
            role="alert"
            tabIndex={-1}
            ref={summary}
          >
            <p>Please check your reminder choices.</p>
            <ul>
              {issues.map((issue, index) => (
                <li key={`${issue.field}:${index}`}>{issue.message}</li>
              ))}
            </ul>
          </div>
        )}
        <RequestErrorMessage error={error} />
        {latest && (
          <section className={styles.comparison} aria-label="Reminder settings conflict">
            <h3>Saved settings changed elsewhere</h3>
            <p>
              Your edited values are still in the form. Review the latest saved settings before
              choosing what to keep.
            </p>
            <ul>
              <li>Reminders: {latest.preferences.enabled ? 'enabled' : 'disabled'}.</li>
              <li>
                Minutes before practice:{' '}
                {latest.preferences.offsets.length
                  ? latest.preferences.offsets.map((offset) => -offset).join(', ')
                  : 'none'}
                .
              </li>
              <li>
                Quiet hours:{' '}
                {latest.preferences.quietHours
                  ? `${latest.preferences.quietHours.start}–${latest.preferences.quietHours.end}, in each session’s saved timezone`
                  : 'off'}
                .
              </li>
              <li>
                Notification text:{' '}
                {latest.preferences.detailed ? 'practice details included' : 'generic'}.
              </li>
            </ul>
            <div className={shared.actions}>
              <button
                type="button"
                className={`${shared.button} ${shared.secondary}`}
                disabled={pending}
                onClick={() => chooseLatest(true)}
              >
                Keep my choices
              </button>
              <button
                type="button"
                className={`${shared.button} ${shared.secondary}`}
                disabled={pending}
                onClick={() => chooseLatest(false)}
              >
                Use latest saved settings
              </button>
            </div>
          </section>
        )}
        <p role="status" aria-live="polite">
          {pending ? 'Saving reminder preferences…' : notice}
        </p>
        <button type="submit" className={shared.button} disabled={pending || Boolean(latest)}>
          {pending ? 'Saving…' : 'Save reminder preferences'}
        </button>
      </form>
      <ReminderPreview view={previewView} />
    </div>
  );
}
