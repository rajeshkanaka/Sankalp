import { PageHeader } from '@/components/presentation';
import { Journal, ReflectionPreferencesEditor } from '@/features/journal';
import { getPageUser } from '@/server/auth/server';
import { getReflectionPreferences, queryJournal } from '@/server/journal';
import { listJourneyViews } from '@/server/journeys/service';

export default async function JournalPage() {
  const user = await getPageUser();
  const [initialPage, journeys, preferences] = await Promise.all([
    queryJournal(user.id, {}),
    listJourneyViews(user.id),
    getReflectionPreferences(user.id),
  ]);
  return (
    <>
      <PageHeader
        title="Your private journal"
        description="A space to reflect on your own practice, in your own words."
      />
      <Journal
        initialPage={initialPage}
        journeys={journeys
          .filter(({ journey }) => journey.state !== 'draft')
          .map(({ journey }) => ({ id: journey.id, title: journey.title }))}
      />
      <ReflectionPreferencesEditor initialPreferences={preferences} />
    </>
  );
}
