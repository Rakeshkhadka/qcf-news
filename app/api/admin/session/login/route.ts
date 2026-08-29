import { NextRequest, NextResponse } from 'next/server';
import { API_INTERNAL_BASE } from '../../../../../lib/server-config';

/**
 * BFF login — proxies credentials to the backend and stores the resulting
 * JWT pair in HttpOnly cookies.  The client never sees the raw tokens.
 *
 * POST /api/admin/session/login
 * Body: { email, password }
 */

const SECURE = process.env.NODE_ENV === 'production';

/** Shared cookie defaults.  `Secure` is only set in production so `http://localhost` works. */
function cookieOpts(maxAgeSeconds: number): {
  httpOnly: boolean; secure: boolean; sameSite: 'strict'; path: string; maxAge: number;
} {
  return {
    httpOnly: true,
    secure: SECURE,
    sameSite: 'strict',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { email, password } = (await request.json()) as {
      email?: string;
      password?: string;
    };

    if (!email || !password) {
      return NextResponse.json(
        { success: false, message: 'Email and password are required' },
        { status: 400 },
      );
    }

    const upstream = await fetch(`${API_INTERNAL_BASE}/users/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({ detail: 'Login failed' }));
      const retryAfter = upstream.headers.get('Retry-After');
      const response = NextResponse.json(
        {
          success: false,
          message: err.detail ?? err.message ?? `HTTP ${upstream.status}`,
          data: err.data,
        },
        { status: upstream.status },
      );

      // Preserve the backend's cooldown so the browser can avoid immediately
      // re-submitting a login that is already rate-limited.
      if (retryAfter) response.headers.set('Retry-After', retryAfter);
      return response;
    }

    const body = await upstream.json();
    // The backend wraps tokens in { success, data: { access_token, refresh_token, user_id } }
    const data = body.data ?? body;
    const { access_token, refresh_token, user_id } = data as {
      access_token: string;
      refresh_token: string;
      user_id: number;
    };

    const res = NextResponse.json({
      success: true,
      data: { user_id },
    });

    // 30-minute access token
    res.cookies.set('admin_access_token', access_token, cookieOpts(30 * 60));
    // 7-day refresh token
    res.cookies.set('admin_refresh_token', refresh_token, cookieOpts(7 * 24 * 60 * 60));
    // Non-sensitive flag the client can read to know "a session exists"
    res.cookies.set('admin_session', '1', {
      ...cookieOpts(7 * 24 * 60 * 60),
      httpOnly: false,       // readable by JS for fast auth checks
    });

    return res;
  } catch {
    return NextResponse.json(
      { success: false, message: 'Internal error' },
      { status: 500 },
    );
  }
}
