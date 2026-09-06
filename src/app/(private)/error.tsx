'use client';
import styles from '@/styles/sanctuary.module.css';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className={styles.panel}>
      <h2>Your practice could not be loaded.</h2>
      <p className={styles.muted}>
        Check your connection and try again. Your saved records have not been changed.
      </p>
      <button className={styles.button} onClick={reset}>
        Try again
      </button>
    </section>
  );
}
