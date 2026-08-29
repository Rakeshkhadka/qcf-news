import { NextRequest, NextResponse } from 'next/server';
import { API_INTERNAL_BASE } from '../../../../../lib/server-config';

/**
 * BFF logout — revokes the session on the backend, then clears all session
 * cookies regardless of whether the upstream call succeeded.
 *
 * POST /api/admin/session/logout
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
  const accessToken = request.cookies.get('admin_access_token')?.value;

  // Best-effort: tell the backend to revoke the refresh session
  if (accessToken) {
    fetch(`${API_INTERNAL_BASE}/users/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    }).catch(() => {
      // Swallowed — the cookies are being cleared either way
    });
  }

  const res = NextResponse.json({ success: true });

  res.cookies.set('admin_access_token', '', { ...cookieOpts(0), maxAge: 0 });
  res.cookies.set('admin_refresh_token', '', { ...cookieOpts(0), maxAge: 0 });
  res.cookies.set('admin_session', '', { ...cookieOpts(0), maxAge: 0, httpOnly: false });

  return res;
}
