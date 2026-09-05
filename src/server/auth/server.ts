import { createServerClient } from '@supabase/ssr';
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
export async function getApiUser() {
  const auth = await createAuthClient();
  const { data, error } = await auth.auth.getUser();
  if (error || !data.user)
    throw new AppError(
      401,
      'SIGN_IN_REQUIRED',
      'Please sign in again. Your unsaved input is still here.',
    );
  return { id: data.user.id, email: data.user.email };
}
export async function getPageUser() {
  try {
    return await getApiUser();
  } catch (error) {
    if (error instanceof AppError && error.status === 401) redirect('/welcome');
    throw error;
  }
}
