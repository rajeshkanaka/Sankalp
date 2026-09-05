import { z } from 'zod';
import { getApiUser } from '@/server/auth/server';
import { withUser } from '@/server/db/client';
import { assertExpectedAccount, handleApi } from '@/server/http';
import { ensureClosureEvent } from '@/server/sessions/history';
import { lockSessionSnapshot } from '@/server/sessions/locking';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    const user = await getApiUser();
    assertExpectedAccount(request, user.id);
    const id = z.uuid().parse((await context.params).id);
    return withUser(user.id, async (client) => {
      const { session, now } = await lockSessionSnapshot(client, id);
      await ensureClosureEvent(client, user.id, session, now);
      return { session, now };
    });
  });
}
