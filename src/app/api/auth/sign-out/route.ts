import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAuthClient, privateHeaders } from '@/server/auth/server';
import { assertSameOrigin, handleApi, readJson } from '@/server/http';

export async function POST(request: Request) {
  let authResponse: NextResponse | undefined;
  const result = await handleApi(async () => {
    assertSameOrigin(request);
    await readJson(request, z.strictObject({}));
    authResponse = NextResponse.json({ ok: true }, { headers: privateHeaders });
    const auth = await createAuthClient(authResponse);
    const { error } = await auth.auth.signOut();
    if (error) throw error;
    return { ok: true };
  });
  return result.ok && authResponse ? authResponse : result;
}
