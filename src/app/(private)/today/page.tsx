import { getPageUser } from '@/server/auth/server';
import { getRuntimeInfo } from '@/server/config';
import { listJourneyViews } from '@/server/journeys/service';
import { TodayView } from '@/features/journeys/today-view';
export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ journey?: string }>;
}) {
  const user = await getPageUser();
  const [journeys, params] = await Promise.all([listJourneyViews(user.id), searchParams]);
  const runtime = getRuntimeInfo();
  return (
    <TodayView
      journeys={journeys}
      selectedId={params.journey}
      demo={runtime.demo}
      initialNow={runtime.now}
    />
  );
}
