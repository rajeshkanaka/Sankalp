import type { Dispatch, SetStateAction } from 'react';
import type { SetupValues } from './types';
import { WEEKDAYS } from './types';
import shared from '@/styles/sanctuary.module.css';
import styles from './setup.module.css';

export function ScheduleEditor({
  values,
  setValues,
  zoneConfirmed,
  setZoneConfirmed,
  weekdaysError,
  disabled,
}: {
  values: SetupValues;
  setValues: Dispatch<SetStateAction<SetupValues>>;
  zoneConfirmed: boolean;
  setZoneConfirmed: Dispatch<SetStateAction<boolean>>;
  weekdaysError: boolean;
  disabled: boolean;
}) {
  function update(changes: Partial<SetupValues>) {
    setValues((current) => ({ ...current, ...changes }));
  }

  function toggleWeekday(day: number, checked: boolean) {
    update({
      weekdays: checked
        ? [...new Set([...values.weekdays, day])].sort((left, right) => left - right)
        : values.weekdays.filter((value) => value !== day),
    });
  }

  return (
    <fieldset className={shared.formSection} disabled={disabled}>
      <legend>A place in your day</legend>
      <div className={shared.fieldGrid}>
        <div className={shared.field}>
          <label htmlFor="start-date">Start date</label>
          <input
            id="start-date"
            type="date"
            required
            value={values.startDate}
            onChange={(event) => update({ startDate: event.target.value })}
          />
        </div>
        <div className={shared.field}>
          <label htmlFor="duration-mode">Duration counts</label>
          <select
            id="duration-mode"
            value={values.durationMode}
            onChange={(event) =>
              update({ durationMode: event.target.value as SetupValues['durationMode'] })
            }
          >
            <option value="occurrences">Scheduled sessions</option>
            <option value="calendar_days">Calendar days from the start</option>
          </select>
        </div>
      </div>
      <div className={shared.field}>
        <label htmlFor="duration">
          {values.durationMode === 'occurrences' ? 'Number of sessions' : 'Number of calendar days'}
        </label>
        <input
          id="duration"
          type="number"
          inputMode="numeric"
          min={1}
          max={365}
          step={1}
          required
          value={values.duration}
          onChange={(event) => update({ duration: event.target.value })}
        />
        <small>
          {values.durationMode === 'occurrences'
            ? 'The journey continues until this many selected days are scheduled.'
            : 'Only selected weekdays inside this calendar span become sessions.'}
        </small>
      </div>

      <span className={shared.fieldLabel} id="recurrence-label">
        Practice days
      </span>
      <div className={styles.choiceGroup} role="radiogroup" aria-labelledby="recurrence-label">
        <label className={styles.choice}>
          <input
            type="radio"
            name="recurrence"
            value="daily"
            checked={values.daily}
            onChange={() => update({ daily: true })}
          />
          <span>
            Every day
            <small>A session is scheduled on all seven days.</small>
          </span>
        </label>
        <label className={styles.choice}>
          <input
            type="radio"
            name="recurrence"
            value="selected"
            checked={!values.daily}
            onChange={() => update({ daily: false })}
          />
          <span>
            Selected weekdays
            <small>Choose one or more days below.</small>
          </span>
        </label>
      </div>
      {!values.daily && (
        <>
          <div className={styles.weekdays} aria-label="Selected weekdays">
            {WEEKDAYS.map((day) => (
              <label className={styles.weekday} key={day.value} title={day.long}>
                <input
                  type="checkbox"
                  aria-label={day.long}
                  checked={values.weekdays.includes(day.value)}
                  onChange={(event) => toggleWeekday(day.value, event.target.checked)}
                />
                <span>{day.short}</span>
              </label>
            ))}
          </div>
          {weekdaysError && (
            <p className={styles.fieldError} role="alert">
              Choose at least one practice day. Your other entries are still here.
            </p>
          )}
        </>
      )}

      <div className={shared.fieldGrid}>
        <div className={shared.field}>
          <label htmlFor="practice-time">Practice time</label>
          <input
            id="practice-time"
            type="time"
            required
            value={values.localTime}
            onChange={(event) => update({ localTime: event.target.value })}
          />
        </div>
        <div className={shared.field}>
          <label htmlFor="window">Completion window (minutes)</label>
          <input
            id="window"
            type="number"
            inputMode="numeric"
            min={1}
            max={1439}
            step={1}
            required
            value={values.windowMinutes}
            onChange={(event) => update({ windowMinutes: event.target.value })}
          />
        </div>
      </div>
      <div className={shared.field}>
        <label htmlFor="timezone">Practice timezone</label>
        <input
          id="timezone"
          required
          value={values.timeZone}
          onChange={(event) => {
            update({ timeZone: event.target.value });
            setZoneConfirmed(false);
          }}
          aria-describedby="timezone-help"
        />
        <small id="timezone-help">
          Suggested from your device. Use an IANA name, such as Asia/Kolkata. The journey keeps this
          timezone when you travel.
        </small>
      </div>
      <label className={shared.checkLabel}>
        <input
          type="checkbox"
          checked={zoneConfirmed}
          onChange={(event) => setZoneConfirmed(event.target.checked)}
          required
        />
        <span>I confirm this practice timezone.</span>
      </label>

      <span className={shared.fieldLabel} id="attribution-label">
        Practice date
      </span>
      <div className={styles.choiceGroup} role="radiogroup" aria-labelledby="attribution-label">
        <label className={styles.choice}>
          <input
            type="radio"
            name="attribution"
            value="civil"
            checked={values.attribution === 'civil'}
            onChange={() => update({ attribution: 'civil' })}
          />
          <span>
            Same civil date
            <small>The practice date is the date the session opens.</small>
          </span>
        </label>
        <label className={styles.choice}>
          <input
            type="radio"
            name="attribution"
            value="previous_evening"
            checked={values.attribution === 'previous_evening'}
            onChange={() => update({ attribution: 'previous_evening' })}
          />
          <span>
            Previous evening / overnight
            <small>
              The practice belongs to the previous calendar night and opens on the following civil
              date.
            </small>
          </span>
        </label>
      </div>
    </fieldset>
  );
}
