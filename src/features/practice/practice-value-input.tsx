import type { SessionPractice } from '@/domain/contracts';
import shared from '@/styles/sanctuary.module.css';
import styles from './practice.module.css';

export function PracticeValueInput({
  practice,
  value,
  numericDraft,
  disabled,
  dirty,
  onCheckboxChange,
  onNumericChange,
  onNumericSave,
}: {
  practice: SessionPractice;
  value: boolean | number;
  numericDraft: string;
  disabled: boolean;
  dirty: boolean;
  onCheckboxChange: (checked: boolean) => void;
  onNumericChange: (value: string) => void;
  onNumericSave: () => void;
}) {
  if (practice.kind === 'checkbox') {
    return (
      <label className={shared.practiceCheck}>
        <input
          type="checkbox"
          aria-label={practice.label}
          checked={value === true}
          disabled={disabled}
          onChange={(event) => onCheckboxChange(event.target.checked)}
        />
        <span>
          {practice.label}
          <small>{practice.value === true ? 'Recorded complete' : 'Mark when complete'}</small>
        </span>
      </label>
    );
  }

  const unit = practice.kind === 'minutes' ? 'minutes' : 'repetitions';
  const recorded = typeof practice.value === 'number' ? practice.value : 0;
  return (
    <div className={styles.valueRow}>
      <div className={styles.valueInfo}>
        <strong>{practice.label}</strong>
        <small>
          Recorded {recorded.toLocaleString('en')} of {practice.target?.toLocaleString('en')} {unit}
        </small>
      </div>
      <div className={styles.numericForm}>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={1_000_000}
          step={1}
          aria-label={practice.label}
          aria-describedby={`practice-unit-${practice.id}`}
          value={numericDraft}
          disabled={disabled}
          onChange={(event) => onNumericChange(event.target.value)}
        />
        <button
          type="button"
          className={styles.saveButton}
          disabled={disabled || !dirty}
          onClick={onNumericSave}
        >
          Save {practice.label}
        </button>
        <span id={`practice-unit-${practice.id}`} className={styles.unit}>
          Whole {unit}; target {practice.target?.toLocaleString('en')}.
        </span>
      </div>
    </div>
  );
}
