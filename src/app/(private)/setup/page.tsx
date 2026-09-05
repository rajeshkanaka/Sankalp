import { PageHeader } from '@/components/presentation';
import { SetupForm } from '@/features/journeys/setup-form';
import { getPageUser } from '@/server/auth/server';
import styles from '@/styles/sanctuary.module.css';
export default async function SetupPage() {
  await getPageUser();
  return (
    <div className={styles.setupLayout}>
      <PageHeader
        title="Begin a new journey"
        description="Choose your own intention, practices and time. Nothing is prescribed."
      />
      <SetupForm />
    </div>
  );
}
