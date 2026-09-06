import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPageUser } from '@/server/auth/server';
import { AppError } from '@/server/errors';
import { getReminderPreferences } from '@/server/reminders/preferences';
import { ReminderPreferencesClient } from '@/features/reminders/preferences-client';

export default async function ReminderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getPageUser();
  const { id } = await params;
  const view = await getReminderPreferences(user.id, id).catch((error) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  return (
    <>
      <Link className="button secondary" href={`/journeys/${id}`}>
        Back to journey
      </Link>
      <ReminderPreferencesClient initial={view} />
    </>
  );
}
