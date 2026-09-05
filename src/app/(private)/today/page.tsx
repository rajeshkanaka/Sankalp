import { getPageUser } from '@/server/auth/server';
import { getRuntimeInfo } from '@/server/config';
import { getProgressDashboard } from '@/server/progress/service';
import { ProgressToday } from '@/features/progress/today';
export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ journey?: string }>;
}) {
  const user = await getPageUser();
  const [view, params] = await Promise.all([getProgressDashboard(user.id), searchParams]);
  const runtime = getRuntimeInfo();
  return <ProgressToday view={view} selectedId={params.journey} demo={runtime.demo} />;
}
