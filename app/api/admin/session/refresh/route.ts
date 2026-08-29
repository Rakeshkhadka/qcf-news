import { NextRequest, NextResponse } from 'next/server';
import { API_INTERNAL_BASE } from '../../../../../lib/server-config';

/**
 * BFF refresh — reads the refresh token from the HttpOnly cookie, exchanges
 * it with the backend for a new token pair, and overwrites the cookies.
 *
 * POST /api/admin/session/refresh
 * (no body required — tokens come from cookies)
 */

const SECURE = process.env.NODE_ENV === 'production';

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
    const refreshToken = request.cookies.get('admin_refresh_token')?.value;

    if (!refreshToken) {
      return NextResponse.json(
        { success: false, message: 'No refresh token' },
        { status: 401 },
      );
    }

    const upstream = await fetch(`${API_INTERNAL_BASE}/users/refresh-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!upstream.ok) {
      // Refresh failed — wipe the cookies so the client knows to re-login
      const fail = NextResponse.json(
        { success: false, message: 'Refresh failed' },
        { status: 401 },
      );
      fail.cookies.set('admin_access_token', '', { ...cookieOpts(0), maxAge: 0 });
      fail.cookies.set('admin_refresh_token', '', { ...cookieOpts(0), maxAge: 0 });
      fail.cookies.set('admin_session', '', { ...cookieOpts(0), maxAge: 0, httpOnly: false });
      return fail;
    }

    const body = await upstream.json();
    const data = body.data ?? body;
    const { access_token, refresh_token: newRefresh, user_id } = data as {
      access_token: string;
      refresh_token: string;
      user_id: number;
    };

    const res = NextResponse.json({
      success: true,
      data: { user_id },
    });

    res.cookies.set('admin_access_token', access_token, cookieOpts(30 * 60));
    res.cookies.set('admin_refresh_token', newRefresh, cookieOpts(7 * 24 * 60 * 60));
    res.cookies.set('admin_session', '1', {
      ...cookieOpts(7 * 24 * 60 * 60),
      httpOnly: false,
    });

    return res;
  } catch {
    return NextResponse.json(
      { success: false, message: 'Internal error' },
      { status: 500 },
    );
  }
}
