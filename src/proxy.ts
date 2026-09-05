import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { privateHeaders } from './server/auth/server';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const auth = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: {
        httpOnly: true,
        sameSite: 'lax',
        secure: ['production', 'staging'].includes(process.env.APP_ENV || ''),
        path: '/',
      },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(items, headers) {
          for (const { name, value } of items) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of items) response.cookies.set(name, value, options);
          for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
        },
      },
    },
  );
  await auth.auth.getUser();
  for (const [key, value] of Object.entries(privateHeaders)) response.headers.set(key, value);
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts/|audio/).*)'] };
