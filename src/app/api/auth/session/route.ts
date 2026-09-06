import { getApiUser } from '@/server/auth/server';
import { getRuntimeInfo } from '@/server/config';
import { withUser } from '@/server/db/client';
import { handleApi } from '@/server/http';

export async function GET() {
  return handleApi(async () => {
    const user = await getApiUser();
    return withUser(user.id, async () => ({ accountId: user.id, now: getRuntimeInfo().now }));
  });
}
