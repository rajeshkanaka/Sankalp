import Link from 'next/link';
import styles from '@/styles/sanctuary.module.css';
export default function NotFound() {
  return (
    <section className={styles.panel}>
      <h2>This practice is unavailable.</h2>
      <p className={styles.muted}>
        It may have been removed, or it may belong to a different account.
      </p>
      <Link prefetch={false} className={styles.button} href="/today">
        Return to Today
      </Link>
    </section>
  );
}
