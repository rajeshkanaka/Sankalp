import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { privateHeaders } from './server/auth/server';
import { randomBytes } from 'node:crypto';

export async function proxy(request: NextRequest) {
  const nonce = randomBytes(24).toString('base64');
  const development = process.env.NODE_ENV === 'development';
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' ${development ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${development ? ' ws:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', policy);
  let response = NextResponse.next({ request: { headers: requestHeaders } });
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
          requestHeaders.set('cookie', request.cookies.toString());
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const { name, value, options } of items) response.cookies.set(name, value, options);
          for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
        },
      },
    },
  );
  await auth.auth.getUser();
  for (const [key, value] of Object.entries(privateHeaders)) response.headers.set(key, value);
  response.headers.set('Content-Security-Policy', policy);
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts/|audio/).*)'] };
