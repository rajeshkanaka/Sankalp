import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { PracticeInput } from './types';
import shared from '@/styles/sanctuary.module.css';
import styles from './setup.module.css';

export function PracticeEditor({
  practices,
  setPractices,
  nextKey,
  disabled,
}: {
  practices: PracticeInput[];
  setPractices: Dispatch<SetStateAction<PracticeInput[]>>;
  nextKey: MutableRefObject<number>;
  disabled: boolean;
}) {
  function update(key: number, changes: Partial<PracticeInput>) {
    setPractices((current) =>
      current.map((practice) => (practice.key === key ? { ...practice, ...changes } : practice)),
    );
  }

  return (
    <fieldset className={shared.formSection} disabled={disabled}>
      <legend>Your practices</legend>
      <p className={shared.muted}>
        Add the practices that belong together. Choose a completion checkbox, a repetition target,
        or a number of minutes for each one.
      </p>
      {practices.map((practice, index) => {
        const numeric = practice.kind !== 'checkbox';
        const max = practice.kind === 'minutes' ? 1439 : 1_000_000;
        return (
          <section className={styles.practiceCard} key={practice.key}>
            <div className={styles.practiceHeader}>
              <label htmlFor={`practice-${practice.key}`}>Practice {index + 1}</label>
              <button
                type="button"
                className={shared.removeButton}
                disabled={practices.length === 1}
                aria-label={`Remove practice ${index + 1}`}
                onClick={() =>
                  setPractices((current) => current.filter((item) => item.key !== practice.key))
                }
              >
                ×
              </button>
            </div>
            <div className={`${styles.practiceGrid} ${numeric ? styles.targetGrid : ''}`}>
              <div className={shared.field}>
                <span className={shared.muted}>Name</span>
                <input
                  id={`practice-${practice.key}`}
                  required
                  maxLength={120}
                  value={practice.label}
                  onChange={(event) => update(practice.key, { label: event.target.value })}
                />
              </div>
              <div className={shared.field}>
                <label htmlFor={`practice-kind-${practice.key}`}>How it is measured</label>
                <select
                  id={`practice-kind-${practice.key}`}
                  aria-label={`Target type for Practice ${index + 1}`}
                  value={practice.kind}
                  onChange={(event) =>
                    update(practice.key, {
                      kind: event.target.value as PracticeInput['kind'],
                      target: '',
                    })
                  }
                >
                  <option value="checkbox">Completion checkbox</option>
                  <option value="repetitions">Repetitions</option>
                  <option value="minutes">Minutes</option>
                </select>
              </div>
              {numeric && (
                <div className={shared.field}>
                  <label htmlFor={`practice-target-${practice.key}`}>
                    Target for Practice {index + 1}
                  </label>
                  <input
                    id={`practice-target-${practice.key}`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={max}
                    step={1}
                    required
                    value={practice.target}
                    onChange={(event) => update(practice.key, { target: event.target.value })}
                  />
                  <small>
                    {practice.kind === 'minutes'
                      ? 'Whole minutes, from 1 to 1,439.'
                      : 'A whole-number count, up to 1,000,000.'}
                  </small>
                </div>
              )}
            </div>
          </section>
        );
      })}
      <button
        type="button"
        className={`${shared.button} ${shared.secondary}`}
        disabled={practices.length >= 20}
        onClick={() => {
          const key = nextKey.current++;
          setPractices((current) => [...current, { key, label: '', kind: 'checkbox', target: '' }]);
        }}
      >
        Add practice
      </button>
    </fieldset>
  );
}
