import { NextResponse } from 'next/server';
import { createAuthClient, privateHeaders } from '@/server/auth/server';
import { getOrigin } from '@/server/config';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const hash = url.searchParams.get('token_hash');
  const response = NextResponse.redirect(new URL('/today', getOrigin()));
  for (const [key, value] of Object.entries(privateHeaders)) response.headers.set(key, value);
  if (!hash || !/^[a-f0-9]{32,128}$/i.test(hash) || url.searchParams.get('type') !== 'email')
    return NextResponse.redirect(new URL('/welcome?error=invalid-link', getOrigin()), {
      headers: privateHeaders,
    });
  const auth = await createAuthClient(response);
  const { error } = await auth.auth.verifyOtp({ token_hash: hash, type: 'email' });
  if (error)
    return NextResponse.redirect(new URL('/welcome?error=invalid-link', getOrigin()), {
      headers: privateHeaders,
    });
  return response;
}
