import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';

/**
 * Everything is behind the password except the login page itself and Next's static assets.
 * Matching by exclusion means a page added later is protected by default rather than
 * needing to be remembered.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|login).*)'],
};

export async function middleware(request: NextRequest) {
  if (await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';

  const wanted = request.nextUrl.pathname + request.nextUrl.search;
  if (wanted !== '/') url.searchParams.set('next', wanted);

  return NextResponse.redirect(url);
}
