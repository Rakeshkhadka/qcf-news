import { NextRequest, NextResponse } from 'next/server';
import { API_INTERNAL_BASE } from '../../../../../lib/server-config';

/**
 * BFF proxy for authenticated admin API calls.
 *
 * Reads the access token from the HttpOnly cookie and forwards the request to
 * the FastAPI backend.  If the backend returns 401 the client should call the
 * /api/admin/session/refresh endpoint and retry — that logic lives in the
 * client-side `adminFetch` wrapper in admin-api.ts.
 *
 * GET /api/admin/session/me
 */

export async function GET(request: NextRequest) {
  const accessToken = request.cookies.get('admin_access_token')?.value;

  if (!accessToken) {
    return NextResponse.json(
      { success: false, message: 'Not authenticated' },
      { status: 401 },
    );
  }

  const upstream = await fetch(`${API_INTERNAL_BASE}/users/me`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!upstream.ok) {
    return NextResponse.json(
      { success: false, message: 'Unauthorized' },
      { status: upstream.status },
    );
  }

  const body = await upstream.json();
  return NextResponse.json(body);
}
