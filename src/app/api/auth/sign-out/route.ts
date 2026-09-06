import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAuthClient, getApiUser, privateHeaders } from '@/server/auth/server';
import { AppError } from '@/server/errors';
import { assertSameOrigin, handleApi, readJson } from '@/server/http';

export async function POST(request: Request) {
  let authResponse: NextResponse | undefined;
  const result = await handleApi(async () => {
    assertSameOrigin(request);
    const { accountId } = await readJson(request, z.strictObject({ accountId: z.uuid() }));
    authResponse = NextResponse.json({ ok: true }, { headers: privateHeaders });
    const auth = await createAuthClient(authResponse);
    const user = await getApiUser(auth);
    if (user.id !== accountId)
      throw new AppError(
        409,
        'ACCOUNT_CHANGED',
        'The signed-in account changed. Review the current account before signing out.',
      );
    const { error } = await auth.auth.signOut({ scope: 'local' });
    if (error) throw error;
    return { ok: true };
  });
  return result.ok && authResponse ? authResponse : result;
}
