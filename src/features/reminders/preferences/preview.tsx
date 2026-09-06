import type { ReminderPreferenceView, ReminderPreviewItem } from '@/domain/reminder-contracts';
import shared from '@/styles/sanctuary.module.css';
import { formatPreviewTime } from './model';
import styles from './preferences.module.css';

const skipped: Record<NonNullable<ReminderPreviewItem['suppressionReason']>, string> = {
  disabled: 'Skipped: reminders are disabled.',
  completed: 'Skipped: this practice is complete.',
  superseded: 'Skipped: this session was replaced by a schedule change.',
  past: 'Skipped: the intended time has passed. No catch-up alert will be sent.',
  quiet_hours: 'Suppressed by quiet hours. This reminder is not moved to another time.',
};

export function ReminderPreview({ view }: { view: ReminderPreferenceView }) {
  return (
    <section className={shared.panel} aria-label="Saved reminder preview">
      <h2>Saved reminder preview</h2>
      <p>
        This server preview covers up to eight upcoming sessions and the most recently opened
        session. Save your choices to update it.
      </p>
      {view.simulated && (
        <p className={shared.quietNote}>
          Local demo: reminder delivery is simulated. No real device notification is sent.
        </p>
      )}
      {!view.preferences.enabled && <p>Reminders are disabled in your saved settings.</p>}
      {view.activeDeviceCount === 0 ? (
        <p>No registered devices. No device can receive these reminders.</p>
      ) : (
        <p>
          {view.activeDeviceCount} registered device{view.activeDeviceCount === 1 ? '' : 's'}.
          Delivery also depends on browser permission and availability.
        </p>
      )}
      {!view.preview.length && (
        <p>
          No reminder times are included in this preview. Choose times and save to review eligible
          sessions.
        </p>
      )}
      <ul className={styles.previewList}>
        {view.preview.map((item) => {
          const scheduled = formatPreviewTime(item.scheduledAt, item.timeZone);
          const expiry = formatPreviewTime(item.expiresAt, item.timeZone);
          return (
            <li key={`${item.sessionId}:${item.offsetMinutes}`}>
              <h3>Practice date {item.practiceDate}</h3>
              <p>
                {item.offsetMinutes === 0
                  ? 'At practice time'
                  : `${-item.offsetMinutes} minutes before practice`}
                {' · '}
                {item.timeZone}
              </p>
              {scheduled && expiry ? (
                <>
                  <p>
                    Reminder: <time dateTime={item.scheduledAt}>{scheduled}</time>
                  </p>
                  <p className={shared.small}>
                    Delivery expires: <time dateTime={item.expiresAt}>{expiry}</time>
                  </p>
                </>
              ) : (
                <p>
                  Time could not be displayed in this session’s timezone. Refresh the preview to
                  verify it.
                </p>
              )}
              <p className={shared.small}>
                {item.suppressionReason
                  ? skipped[item.suppressionReason]
                  : view.activeDeviceCount === 0
                    ? 'Planned time only: no device is registered.'
                    : view.simulated
                      ? 'Planned time for simulated delivery.'
                      : 'Planned reminder. Delivery is not guaranteed.'}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
