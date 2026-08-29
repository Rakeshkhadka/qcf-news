import { NextRequest, NextResponse } from 'next/server';
import { API_INTERNAL_BASE } from '../../../../../lib/server-config';

/**
 * BFF catch-all proxy for admin API calls.
 *
 * Every request to `/api/admin/proxy/…` is forwarded to the FastAPI backend
 * at `/api/v1/…` with the access token injected from the HttpOnly cookie.
 *
 * This is the single place where tokens leave the cookie jar and enter an
 * Authorization header — the client-side code never touches them.
 *
 * Route: /api/admin/proxy/[...path]
 * Matches: GET, POST, PUT, PATCH, DELETE
 */

async function proxyRequest(request: NextRequest, params: { path: string[] }) {
  const accessToken = request.cookies.get('admin_access_token')?.value;

  if (!accessToken) {
    return NextResponse.json(
      { success: false, message: 'Not authenticated' },
      { status: 401 },
    );
  }

  // Rebuild the target URL: /api/admin/proxy/articles/42 → /api/v1/articles/42
  const subPath = params.path.join('/');
  const url = new URL(`${API_INTERNAL_BASE}/${subPath}`);

  // Preserve the original query string
  const incomingUrl = new URL(request.url);
  incomingUrl.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };

  // Forward Content-Type for requests with a body.  For multipart uploads
  // the full header (including the boundary parameter) must be forwarded
  // so the upstream server can parse the form data correctly.
  const contentType = request.headers.get('content-type');
  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  // For multipart, forward the raw body; for JSON, same.
  const body =
    request.method !== 'GET' && request.method !== 'HEAD'
      ? await request.arrayBuffer()
      : undefined;

  const upstream = await fetch(url.toString(), {
    method: request.method,
    headers,
    body: body ? Buffer.from(body) : undefined,
  });

  // Stream the upstream response back to the client
  const responseBody = await upstream.arrayBuffer();
  const responseHeaders = new Headers();

  // Forward content-type from the upstream
  const upstreamCT = upstream.headers.get('content-type');
  if (upstreamCT) responseHeaders.set('content-type', upstreamCT);

  return new NextResponse(Buffer.from(responseBody), {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return proxyRequest(request, await context.params);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return proxyRequest(request, await context.params);
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return proxyRequest(request, await context.params);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return proxyRequest(request, await context.params);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return proxyRequest(request, await context.params);
}
