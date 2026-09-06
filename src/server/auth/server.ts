import { createServerClient } from '@supabase/ssr';
import {
  AuthInvalidJwtError,
  isAuthApiError,
  isAuthSessionMissingError,
} from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { NextResponse } from 'next/server';
import { requiredEnv } from '../config';
import { AppError } from '../errors';

export const privateHeaders = {
  'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
  Expires: '0',
  Pragma: 'no-cache',
};
const invalidSessionCodes = new Set([
  'bad_jwt',
  'session_not_found',
  'session_expired',
  'refresh_token_not_found',
  'refresh_token_already_used',
  'user_not_found',
]);
function sessionError(error: unknown): AppError {
  // A provider outage is not evidence that the user signed out. Only documented
  // missing/invalid-session failures may trigger the caller's signed-out recovery.
  const missing =
    isAuthSessionMissingError(error) ||
    error instanceof AuthInvalidJwtError ||
    (isAuthApiError(error) &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 429 &&
      invalidSessionCodes.has(error.code ?? ''));
  return missing
    ? new AppError(
        401,
        'SIGN_IN_REQUIRED',
        'Please sign in again. Your unsaved input is still here.',
      )
    : new AppError(
        503,
        'AUTH_UNAVAILABLE',
        'Account verification is temporarily unavailable. Keep this page open and try again.',
      );
}
export async function createAuthClient(response?: NextResponse) {
  const store = await cookies();
  return createServerClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_PUBLISHABLE_KEY'), {
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.APP_ENV === 'production' || process.env.APP_ENV === 'staging',
      path: '/',
    },
    cookies: {
      getAll: () => store.getAll(),
      setAll(items, headers) {
        if (response) {
          for (const item of items) response.cookies.set(item.name, item.value, item.options);
          for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
        }
        // Server Components cannot write cookies; proxy.ts refreshes them first.
        if (!response) return;
      },
    },
  });
}
export async function getApiUser(authClient?: Awaited<ReturnType<typeof createAuthClient>>) {
  const auth = authClient ?? (await createAuthClient());
  let result: Awaited<ReturnType<typeof auth.auth.getUser>>;
  try {
    result = await auth.auth.getUser();
  } catch (error) {
    throw sessionError(error);
  }
  if (result?.error) throw sessionError(result.error);
  const user = result?.data?.user;
  if (!user || typeof user.id !== 'string' || !user.id) throw sessionError(undefined);
  return { id: user.id, email: user.email };
}
export async function getPageUser() {
  try {
    return await getApiUser();
  } catch (error) {
    if (error instanceof AppError && error.status === 401) redirect('/welcome');
    throw error;
  }
}
