'use client';

import { useState, type FormEvent } from 'react';

import { requestJson } from '@/components/api';
import { RequestErrorMessage } from '@/components/request-error';
import type { ReflectionPreferences, ReflectionPromptId } from '@/domain/contracts';
import shared from '@/styles/sanctuary.module.css';

const prompts: { id: ReflectionPromptId; label: string }[] = [
  { id: 'noticed', label: 'What did you notice?' },
  { id: 'carry_tomorrow', label: 'What would you like to carry into tomorrow?' },
];

export function ReflectionPreferencesEditor({
  initialPreferences,
}: {
  initialPreferences: ReflectionPreferences;
}) {
  const [selected, setSelected] = useState(initialPreferences.prompts);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setSaved(false);
    setError(null);
    try {
      const result = await requestJson<ReflectionPreferences>(
        '/api/profile/reflection-preferences',
        'PUT',
        { prompts: selected },
      );
      setSelected(result.prompts);
      setSaved(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause
          : new Error('Could not save reflection prompts. Your choices are still here.'),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form className={shared.panel} onSubmit={submit}>
      <h2>Optional reflection prompts</h2>
      <p className={shared.muted}>
        Choose either prompt, both, or neither. They never prescribe an answer.
      </p>
      <fieldset className={shared.formSection} disabled={pending}>
        <legend>Prompts shown with a private reflection</legend>
        {prompts.map((prompt) => (
          <label className={shared.checkLabel} key={prompt.id}>
            <input
              type="checkbox"
              checked={selected.includes(prompt.id)}
              onChange={(event) => {
                setSaved(false);
                setSelected((current) =>
                  event.target.checked
                    ? [...current, prompt.id]
                    : current.filter((item) => item !== prompt.id),
                );
              }}
            />
            <span>{prompt.label}</span>
          </label>
        ))}
      </fieldset>
      <RequestErrorMessage error={error} />
      {saved && <p role="status">Prompt choices saved.</p>}
      <button type="submit" className={shared.button} disabled={pending}>
        {pending ? 'Saving…' : 'Save prompt choices'}
      </button>
    </form>
  );
}
