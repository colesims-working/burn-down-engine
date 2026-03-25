import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getIronSession } from 'iron-session';

interface SessionData {
  authenticated: boolean;
  loginAt?: string;
}

const sessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: 'burn-down-session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 30,
  },
};

export async function middleware(request: NextRequest) {
  const isLoginPage = request.nextUrl.pathname === '/login';
  const isApiAuth = request.nextUrl.pathname === '/api/auth';

  // Allow login page and auth API without session
  if (isLoginPage || isApiAuth) {
    return NextResponse.next();
  }

  // Validate session by decrypting the iron-session cookie
  const response = NextResponse.next();
  try {
    const session = await getIronSession<SessionData>(request, response, sessionOptions);
    if (!session.authenticated) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  } catch {
    // Cookie tampered, expired, or missing — redirect to login
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
