import { RequestError } from './api';
import styles from '@/styles/sanctuary.module.css';

export function RequestErrorMessage({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <div className={styles.error} role="alert">
      <p>{error.message}</p>
      {error instanceof RequestError && error.correlationId && (
        <small>Reference: {error.correlationId}</small>
      )}
    </div>
  );
}
