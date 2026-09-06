import type { ReflectionPayload, ReflectionPreferences } from '@/domain/contracts';
import shared from '@/styles/sanctuary.module.css';
import styles from './offline.module.css';

const MAX_TEXT = 20_000;
const MAX_MOOD = 40;

export function reflectionError(payload: ReflectionPayload): string | null {
  if (Array.from(payload.text).length > MAX_TEXT) return 'Use no more than 20,000 characters.';
  if (payload.text.includes('\0')) return 'Remove unsupported characters from the note.';
  for (let index = 0; index < payload.text.length; index += 1) {
    const code = payload.text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = payload.text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        return 'Remove unsupported characters from the note.';
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return 'Remove unsupported characters from the note.';
    }
  }
  if (payload.moods.length > 5) return 'Choose up to five mood tags.';
  if (new Set(payload.moods).size !== payload.moods.length) return 'Mood tags must be unique.';
  if (payload.moods.some((mood) => !mood || Array.from(mood).length > MAX_MOOD))
    return 'Each mood must use 1 to 40 characters.';
  return null;
}

function promptLabel(prompt: ReflectionPreferences['prompts'][number]): string {
  return prompt === 'noticed'
    ? 'What did you notice?'
    : 'What would you like to carry into tomorrow?';
}

export function OfflineReflectionEditor({
  sessionId,
  value,
  preferences,
  disabled,
  deviceSaving,
  message,
  onChange,
  onSave,
}: {
  sessionId: string;
  value: ReflectionPayload;
  preferences: ReflectionPreferences;
  disabled: boolean;
  deviceSaving: boolean;
  message: string;
  onChange(value: ReflectionPayload): void;
  onSave(): void;
}) {
  const validation = reflectionError(value);

  function addMood(form: FormData) {
    const mood = String(form.get('mood') ?? '').trim();
    if (!mood || Array.from(mood).length > MAX_MOOD || value.moods.includes(mood)) return;
    onChange({ ...value, moods: [...value.moods, mood] });
  }

  return (
    <section className={shared.panel} aria-label="Private reflection">
      <h2>Private reflection</h2>
      <p className={shared.muted}>
        This plain-text note is visible only in your account. Local drafts are not encrypted.
      </p>
      {preferences.prompts.length > 0 && (
        <ul className={styles.prompts} aria-label="Optional reflection prompts">
          {preferences.prompts.map((prompt) => (
            <li key={prompt}>{promptLabel(prompt)}</li>
          ))}
        </ul>
      )}
      <div className={shared.field}>
        <label htmlFor={`offline-reflection-${sessionId}`}>Your reflection</label>
        <textarea
          id={`offline-reflection-${sessionId}`}
          className={styles.reflectionEditor}
          value={value.text}
          disabled={disabled}
          aria-describedby={`offline-reflection-count-${sessionId}`}
          onChange={(event) => onChange({ ...value, text: event.target.value })}
        />
        <small id={`offline-reflection-count-${sessionId}`}>
          {Array.from(value.text).length.toLocaleString('en')} of 20,000 characters
        </small>
      </div>
      <form
        className={styles.moodEntry}
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          addMood(new FormData(form));
          form.reset();
        }}
      >
        <div className={shared.field}>
          <label htmlFor={`offline-mood-${sessionId}`}>Mood tag (optional)</label>
          <input
            id={`offline-mood-${sessionId}`}
            name="mood"
            disabled={disabled || value.moods.length >= 5}
          />
        </div>
        <button
          type="submit"
          className={`${shared.button} ${shared.secondary}`}
          disabled={disabled || value.moods.length >= 5}
        >
          Add mood
        </button>
      </form>
      {value.moods.length > 0 && (
        <ul className={styles.moods} aria-label="Selected moods">
          {value.moods.map((mood) => (
            <li key={mood}>
              <span>{mood}</span>
              <button
                type="button"
                aria-label={`Remove mood ${mood}`}
                disabled={disabled}
                onClick={() =>
                  onChange({ ...value, moods: value.moods.filter((item) => item !== mood) })
                }
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.saveState} role="status" aria-live="polite">
        {validation ?? (deviceSaving ? 'Saving draft on this device…' : message)}
      </p>
      <button
        type="button"
        className={shared.button}
        disabled={disabled || deviceSaving || Boolean(validation)}
        onClick={onSave}
      >
        Save reflection
      </button>
    </section>
  );
}
