import { getPageUser } from '@/server/auth/server';
import { getPageJourneyView } from '@/server/journeys/pages';
import { getProgressPreferences } from '@/server/progress/service';
import { getRuntimeInfo } from '@/server/config';
import { JourneyProgress } from '@/features/progress/journey';
import { MetadataEditor, RevisionEditor } from '@/features/journeys/revision';

export default async function JourneyPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getPageUser();
  const { id } = await params;
  const [view, preferences] = await Promise.all([
    getPageJourneyView(user.id, id),
    getProgressPreferences(user.id),
  ]);
  return (
    <>
      <JourneyProgress view={view} preferences={preferences} demo={getRuntimeInfo().demo} />
      <MetadataEditor view={view} />
      {view.journey.state === 'active' && <RevisionEditor view={view} />}
    </>
  );
}
