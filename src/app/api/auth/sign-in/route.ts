import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAuthClient, privateHeaders } from '@/server/auth/server';
import { getOrigin } from '@/server/config';
import { AppError } from '@/server/errors';
import { assertSameOrigin, handleApi, readJson } from '@/server/http';
import { limitSignIn } from '@/server/rate-limit';

export async function POST(request: Request) {
  let authResponse: NextResponse | undefined;
  const result = await handleApi(async () => {
    assertSameOrigin(request);
    const { email } = await readJson(request, z.strictObject({ email: z.email().max(254) }));
    await limitSignIn(email);
    authResponse = NextResponse.json({ ok: true }, { headers: privateHeaders });
    const auth = await createAuthClient(authResponse);
    const { error } = await auth.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${getOrigin()}/auth/confirm` },
    });
    if (error)
      throw new AppError(
        error.status === 429 ? 429 : 503,
        'SIGN_IN_UNAVAILABLE',
        error.status === 429
          ? 'Please wait a little before requesting another link.'
          : 'Sign-in email is temporarily unavailable. Please try again.',
      );
    return { ok: true };
  });
  return result.ok && authResponse ? authResponse : result;
}
