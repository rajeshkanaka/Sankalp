'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { RequestError, requestJson } from '@/components/api';
import { RequestErrorMessage } from '@/components/request-error';
import type { JourneyView } from '@/domain/contracts';
import shared from '@/styles/sanctuary.module.css';

export function MetadataEditor({ view }: { view: JourneyView }) {
  const router = useRouter();
  const [title, setTitle] = useState(view.journey.title);
  const [intention, setIntention] = useState(view.journey.intention);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [saved, setSaved] = useState(false);
  const attempt = useRef<{ signature: string; operationId: string } | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setSaved(false);
    setError(null);
    const payload = { title: title.trim(), intention: intention.trim() };
    const signature = JSON.stringify({ baseRevision: view.journey.revision, payload });
    if (!attempt.current || attempt.current.signature !== signature) {
      attempt.current = { signature, operationId: crypto.randomUUID() };
    }
    try {
      const updated = await requestJson<JourneyView>(
        `/api/journeys/${view.journey.id}/metadata`,
        'PUT',
        {
          operationId: attempt.current.operationId,
          baseRevision: view.journey.revision,
          payload,
        },
      );
      setTitle(updated.journey.title);
      setIntention(updated.journey.intention);
      setSaved(true);
      attempt.current = null;
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause
          : new Error('Could not save these details. Your entries are still here.'),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form className={shared.panel} onSubmit={save}>
      <h2>Edit journey details</h2>
      <fieldset className={shared.formSection} disabled={pending}>
        <div className={shared.field}>
          <label htmlFor={`metadata-title-${view.journey.id}`}>Journey title</label>
          <input
            id={`metadata-title-${view.journey.id}`}
            required
            maxLength={120}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className={shared.field}>
          <label htmlFor={`metadata-intention-${view.journey.id}`}>Personal intention</label>
          <textarea
            id={`metadata-intention-${view.journey.id}`}
            maxLength={4000}
            value={intention}
            onChange={(event) => setIntention(event.target.value)}
          />
        </div>
      </fieldset>
      <p className={shared.muted}>
        Editing these details does not change session times or historical practice labels.
      </p>
      {saved && <p className={shared.success}>Journey details saved.</p>}
      <RequestErrorMessage error={error} />
      {error instanceof RequestError && error.code === 'REVISION_CONFLICT' && (
        <button
          type="button"
          className={`${shared.button} ${shared.secondary}`}
          onClick={() => {
            setError(null);
            router.refresh();
          }}
        >
          Reload latest journey
        </button>
      )}
      <button type="submit" className={shared.button} disabled={pending}>
        {pending ? 'Saving details…' : 'Save journey details'}
      </button>
    </form>
  );
}
