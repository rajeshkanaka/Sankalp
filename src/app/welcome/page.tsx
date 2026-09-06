import { SignInForm } from '@/features/auth/sign-in-form';
import { Icon } from '@/components/icons';
import { getRuntimeInfo } from '@/server/config';
import styles from '@/styles/sanctuary.module.css';

export const dynamic = 'force-dynamic';
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const runtime = getRuntimeInfo();
  return (
    <main className={styles.welcome}>
      <section className={styles.welcomeStory}>
        <div className={styles.brand}>
          <Icon name="light" width="34" height="34" />
          Sankalpa
        </div>
        <h1>A quiet space for your daily practice.</h1>
        <p>
          Give a sincere intention a place in your day. Arrive, practice, and see your journey
          unfold in your own way.
        </p>
        <div className={styles.welcomeMotif}>
          <Icon name="light" width="94" height="94" strokeWidth=".6" />
        </div>
        {runtime.demo && <span className={styles.demo}>Demo data · simulated clock</span>}
      </section>
      <section className={styles.welcomeForm} aria-label="Sign in">
        <SignInForm
          localMail={runtime.appEnv === 'local' || runtime.appEnv === 'ci'}
          invalidLink={Boolean(error)}
        />
      </section>
    </main>
  );
}
