import styles from '@/styles/sanctuary.module.css';
export default function Loading() {
  return (
    <div className={styles.loading} role="status">
      Opening your practice space…
    </div>
  );
}
