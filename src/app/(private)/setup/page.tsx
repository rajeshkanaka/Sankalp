import { PageHeader } from '@/components/presentation';
import { SetupForm } from '@/features/journeys/setup-form';
import { getPageUser } from '@/server/auth/server';
import { getPageJourneyView } from '@/server/journeys/pages';
import { notFound, redirect } from 'next/navigation';
import styles from '@/styles/sanctuary.module.css';
export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string | string[] }>;
}) {
  const user = await getPageUser();
  const { draft } = await searchParams;
  if (Array.isArray(draft)) notFound();
  const initialDraft = draft ? (await getPageJourneyView(user.id, draft)).journey : undefined;
  if (initialDraft && initialDraft.state !== 'draft') redirect(`/journeys/${initialDraft.id}`);
  return (
    <div className={styles.setupLayout}>
      <PageHeader
        title={initialDraft ? 'Resume your draft' : 'Begin a new journey'}
        description="Choose your own intention, practices and time. Nothing is prescribed."
      />
      <SetupForm key={initialDraft?.id ?? 'new'} initialDraft={initialDraft} />
    </div>
  );
}
