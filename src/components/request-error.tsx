import { RequestError } from './api';
import styles from '@/styles/sanctuary.module.css';

const fieldLabels: Record<string, string> = {
  email: 'Email address',
  title: 'Journey title',
  intention: 'Personal intention',
  practices: 'Practices',
  schedule: 'Schedule',
  timeZone: 'Practice timezone',
};

export function RequestErrorMessage({ error, id }: { error: Error | null; id?: string }) {
  if (!error) return null;
  const fields = error instanceof RequestError ? Object.entries(error.fields ?? {}) : [];
  return (
    <div id={id} className={styles.error} role="alert">
      <p>{fields.length ? 'Please check these fields.' : error.message}</p>
      {fields.length > 0 && (
        <ul>
          {fields.map(([field, messages]) => (
            <li key={field}>
              <strong>{fieldLabels[field] ?? field}:</strong> {messages.join(' ')}
            </li>
          ))}
        </ul>
      )}
      {error instanceof RequestError && error.code === 'SIGN_IN_REQUIRED' && (
        <p className={styles.small}>
          <a href="/welcome" target="_blank" rel="noopener noreferrer">
            Sign in again in a new tab
          </a>
          , then return here and retry. Your entries can stay open on this page.
        </p>
      )}
      {error instanceof RequestError && error.correlationId && (
        <small>Reference: {error.correlationId}</small>
      )}
    </div>
  );
}
