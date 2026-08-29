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

  // Rebuild the target URL: /api/admin/proxy/categories → /api/v1/categories/
  let subPath = params.path.join('/');
  
  // FastAPI base collection endpoints expect a trailing slash to avoid 307 redirects
  const collectionRoutes = ['categories', 'articles', 'roles', 'users', 'newsletter'];
  if (collectionRoutes.includes(subPath)) {
    subPath += '/';
  }

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

  // Safely clone the ArrayBuffer so Node fetch doesn't encounter a detached ArrayBuffer
  let bodyBuffer: Buffer | undefined = undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const ab = await request.arrayBuffer();
    bodyBuffer = Buffer.from(ab.slice(0));
  }

  const upstream = await fetch(url.toString(), {
    method: request.method,
    headers,
    body: bodyBuffer,
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
