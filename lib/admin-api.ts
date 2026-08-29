/**
 * QCF News Admin API Client
 *
 * All authentication state lives in Secure, HttpOnly, SameSite=Strict cookies
 * managed by the BFF session endpoints under `/api/admin/session/*`.
 *
 * Authenticated API calls are proxied through `/api/admin/proxy/*` — the Next
 * API route reads the token from the cookie and attaches an Authorization
 * header before forwarding to the FastAPI backend.  The client-side code never
 * touches a raw JWT.
 *
 * Automatic refresh:
 * If a request receives a 401, the client calls `/api/admin/session/refresh`
 * (which rotates the cookie pair server-side) and retries the original request
 * **exactly once**.  A deduplication lock ensures that concurrent 401s produce
 * only a single refresh call.
 */

import { mediaUrl } from "./media";

export { mediaUrl };

// ── Cache revalidation ────────────────────────────────────────────────────────

/**
 * Tell the Next.js app to invalidate the given cache tags so ISR-cached pages
 * are rebuilt on the next request.  Fire-and-forget: the admin UI should not
 * block on this, and a failure here is never worth surfacing to the editor.
 *
 * No credential travels with the body.  `/api/revalidate` authenticates the
 * caller from the HttpOnly admin session cookie, which is exactly what the
 * browser already has and what the client-side code is not allowed to read.
 */
function revalidateCache(tags: string[]): void {
  fetch('/api/revalidate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags }),
    credentials: 'same-origin',
  }).catch(() => {
    // Swallowed — revalidation is best-effort.
  });
}

// ── Session helpers ───────────────────────────────────────────────────────────

/**
 * Quick synchronous check — reads the non-HttpOnly `admin_session` cookie that
 * the BFF login endpoint sets.  This is *not* a security boundary (the real
 * token is HttpOnly), just a UX shortcut so the admin layout can decide
 * whether to show the login page without a round-trip.
 */
export function isAuthenticated(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split(";").some((c) => c.trim().startsWith("admin_session="));
}

/**
 * Clear the client-visible session cookie.  The HttpOnly cookies are cleared
 * by the BFF logout endpoint; this is a belt-and-suspenders fallback for the
 * error-path where we skip the server call.
 */
export function clearSession(): void {
  if (typeof document === "undefined") return;
  document.cookie = "admin_session=; path=/; max-age=0";
}

// ── Refresh deduplication ─────────────────────────────────────────────────────

/**
 * At most one refresh request can be in-flight at a time.  If a second 401
 * arrives while a refresh is already running, the second caller awaits the
 * same promise instead of firing a duplicate request.
 */
let _refreshPromise: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async () => {
    try {
      const res = await fetch("/api/admin/session/refresh", { method: "POST" });
      return res.ok;
    } catch {
      return false;
    } finally {
      _refreshPromise = null;
    }
  })();

  return _refreshPromise;
}

// ── Error extraction ──────────────────────────────────────────────────────────

/**
 * Safely extract a human-readable error message from a backend error response.
 *
 * FastAPI may return `detail` as:
 *   - a plain string:  "Not found"
 *   - a validation array: [{loc: [...], msg: "...", type: "..."}]
 *   - a nested object: {code: "...", message: "..."}
 *
 * Passing any non-string directly to `new Error()` produces "[object Object]".
 */
function extractErrorMessage(err: Record<string, unknown>, status: number): string {
  const detail = err.detail;
  if (typeof detail === "string" && detail) return detail;
  if (Array.isArray(detail)) {
    // FastAPI 422 validation errors — show the first message with its field.
    const messages = detail.map((d: Record<string, unknown>) => {
      const loc = Array.isArray(d.loc) ? d.loc.slice(1).join(".") : "";
      const msg = typeof d.msg === "string" ? d.msg : String(d.msg ?? "");
      return loc ? `${loc}: ${msg}` : msg;
    });
    return messages.join("; ") || `Validation error (HTTP ${status})`;
  }
  if (detail && typeof detail === "object") {
    // Nested object — try common keys, fall back to JSON.
    const obj = detail as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.msg === "string") return obj.msg;
    try { return JSON.stringify(detail); } catch { /* fall through */ }
  }

  // Fall back to top-level message key (used by some envelope responses)
  if (typeof err.message === "string" && err.message) return err.message;

  return `HTTP ${status}`;
}

// ── Core fetch wrapper ────────────────────────────────────────────────────────

/**
 * Every authenticated admin call goes through the BFF proxy.  Tokens are
 * injected server-side from HttpOnly cookies — the client just sends a
 * same-origin request.
 */
async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  const doFetch = () =>
    fetch(`/api/admin/proxy${path}`, { ...options, headers, credentials: "same-origin" });

  let res = await doFetch();

  // ── Auto-refresh on 401 ──────────────────────────────────────────────────
  if (res.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed) {
      res = await doFetch();
    } else {
      // Refresh failed — force re-login
      clearSession();
      if (typeof window !== "undefined") {
        window.location.href = "/admin/login";
      }
      throw new Error("Session expired");
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(extractErrorMessage(err, res.status));
  }

  // 204 No Content
  if (res.status === 204) return undefined as unknown as T;

  const json = await res.json();

  // Unwrap the standard { success, message, data } envelope used by this backend
  if (
    json !== null &&
    typeof json === "object" &&
    "success" in json &&
    "data" in json
  ) {
    return json.data as T;
  }

  return json as T;
}

/** Response shape for list endpoints that return paginated data with a total count. */
export interface PaginatedResponse<T> {
  data: T[];
  total_count: number;
}

/** Like apiFetch, but preserves total_count from the API envelope. */
async function apiFetchPaginated<T>(
  path: string,
  options: RequestInit = {},
): Promise<PaginatedResponse<T>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  const doFetch = () =>
    fetch(`/api/admin/proxy${path}`, { ...options, headers, credentials: "same-origin" });

  let res = await doFetch();

  // ── Auto-refresh on 401 ──────────────────────────────────────────────────
  if (res.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed) {
      res = await doFetch();
    } else {
      clearSession();
      if (typeof window !== "undefined") {
        window.location.href = "/admin/login";
      }
      throw new Error("Session expired");
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(extractErrorMessage(err, res.status));
  }

  const json = await res.json();

  if (
    json !== null &&
    typeof json === "object" &&
    "success" in json &&
    "data" in json
  ) {
    return {
      data: json.data as T[],
      total_count: json.total_count ?? 0,
    };
  }

  // Fallback for non-envelope responses
  return { data: Array.isArray(json) ? json : [], total_count: 0 };
}

/**
 * Serialise list params into a query string, dropping empty ones so a cleared
 * search box sends no `search` at all.
 */
function queryString(params?: Record<string, unknown>): string {
  if (!params) return "";
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    qs.set(key, String(value));
  });
  const serialised = qs.toString();
  return serialised ? `?${serialised}` : "";
}

// ── Multipart upload wrapper ──────────────────────────────────────────────────

/**
 * Like `apiFetch`, but sends FormData.  The Content-Type header is deliberately
 * omitted so the browser can set the multipart boundary itself.
 */
async function apiUpload<T>(path: string, body: FormData): Promise<T> {
  const doFetch = () =>
    fetch(`/api/admin/proxy${path}`, {
      method: "POST",
      body,
      credentials: "same-origin",
    });

  let res = await doFetch();

  if (res.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed) {
      res = await doFetch();
    } else {
      clearSession();
      if (typeof window !== "undefined") {
        window.location.href = "/admin/login";
      }
      throw new Error("Session expired");
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error(extractErrorMessage(err, res.status));
  }

  const json = await res.json();
  if (json !== null && typeof json === "object" && "success" in json && "data" in json) {
    return json.data as T;
  }
  return json as T;
}

// ── Uploads ───────────────────────────────────────────────────────────────────

export interface UploadedImage {
  url: string;
  path: string;
  filename: string;
  size: number;
  content_type: string;
  width: number;
  height: number;
  variants: Record<string, Record<string, string>>;
}

export const uploads = {
  /** Upload one or more images in a single request; URLs come back in order. */
  images: (files: File[] | FileList) => {
    const fd = new FormData();
    Array.from(files).forEach((file) => fd.append("files", file));
    return apiUpload<UploadedImage[]>("/uploads/images", fd);
  },

  deleteImage: (path: string) =>
    apiFetch<{ path: string; deleted: boolean }>(
      `/uploads/images?path=${encodeURIComponent(path)}`,
      { method: "DELETE" }
    ),
};

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface LoginResponse {
  user_id: number;
}

export class LoginError extends Error {
  constructor(message: string, readonly retryAfter?: number) {
    super(message);
    this.name = "LoginError";
  }
}

export interface UserMe {
  id: number;
  email: string;
  first_name?: string;
  last_name?: string;
  is_superuser: boolean;
  is_email_verified: boolean;
}

export const auth = {
  /**
   * Login via the BFF endpoint.  Credentials are posted to the Next.js API
   * route which handles the backend call and sets HttpOnly cookies.
   */
  login: async (email: string, password: string): Promise<LoginResponse> => {
    const res = await fetch("/api/admin/session/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      credentials: "same-origin",
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: "Login failed" }));
      const headerRetryAfter = Number.parseInt(res.headers.get("Retry-After") ?? "", 10);
      const bodyRetryAfter = Number(err.data?.retry_after);
      const retryAfter = Number.isFinite(headerRetryAfter) && headerRetryAfter > 0
        ? headerRetryAfter
        : Number.isFinite(bodyRetryAfter) && bodyRetryAfter > 0
          ? bodyRetryAfter
          : undefined;
      throw new LoginError(err.message ?? `HTTP ${res.status}`, retryAfter);
    }

    const body = await res.json();
    return body.data as LoginResponse;
  },

  /** Fetch the authenticated user via the BFF /me proxy. */
  me: async (): Promise<UserMe> => {
    const res = await fetch("/api/admin/session/me", {
      credentials: "same-origin",
    });

    // Try refresh once on 401
    if (res.status === 401) {
      const refreshed = await refreshSession();
      if (refreshed) {
        const retry = await fetch("/api/admin/session/me", {
          credentials: "same-origin",
        });
        if (retry.ok) {
          const body = await retry.json();
          const data = body.data ?? body;
          return data as UserMe;
        }
      }
      throw new Error("Not authenticated");
    }

    if (!res.ok) throw new Error("Failed to fetch user");

    const body = await res.json();
    const data = body.data ?? body;
    return data as UserMe;
  },

  /** Logout via the BFF — clears HttpOnly cookies server-side. */
  logout: async (): Promise<void> => {
    await fetch("/api/admin/session/logout", {
      method: "POST",
      credentials: "same-origin",
    }).catch(() => {});
    clearSession();
  },
};

// ── Users ─────────────────────────────────────────────────────────────────────

/** Slim role reference attached to a user in directory listings. */
export interface UserRoleRef {
  id: number;
  name: string;
}

export interface User {
  id: number;
  email: string;
  first_name?: string;
  last_name?: string;
  is_superuser: boolean;
  is_email_verified: boolean;
  is_active?: boolean;
  /** Present on directory listings (`users.list`), absent on nested payloads. */
  roles?: UserRoleRef[];
}

export const users = {
  /**
   * Searchable user directory.  `search` matches email, first and last name at
   * once, so the admin UI can offer people by name instead of numeric ID.
   */
  list: (params?: {
    search?: string;
    page?: number;
    page_size?: number;
    ordering?: string;
  }) => apiFetchPaginated<User>(`/users/${queryString(params)}`),

  me: () => apiFetch<User>("/users/me"),
};

/** Human label for a user: full name when known, else the email. */
export function userLabel(u: Pick<User, "first_name" | "last_name" | "email">): string {
  const name = `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim();
  return name || u.email;
}

// ── Roles & Permissions ───────────────────────────────────────────────────────

export interface Permission {
  id: number;
  name: string;
  code: string;
  module: string;
}

export interface Role {
  id: number;
  name: string;
  description?: string;
  permissions: Permission[];
}

export interface UserOverride {
  permission_id: number;
  permission_code: string;
  permission_name: string;
  is_allowed: boolean;
}

export const roles = {
  list: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return apiFetch<Role[]>(`/roles/${qs}`);
  },

  get: (roleId: number) =>
    apiFetch<Role>(`/roles/${roleId}`),

  create: (data: { name: string; description?: string; permission_ids: number[] }) =>
    apiFetch<Role>("/roles/", { method: "POST", body: JSON.stringify(data) }),

  update: (
    roleId: number,
    data: { name: string; description?: string; permission_ids: number[] }
  ) =>
    apiFetch<Role>(`/roles/${roleId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  delete: (roleId: number) =>
    apiFetch<void>(`/roles/${roleId}`, { method: "DELETE" }),

  assignUsers: (roleId: number, userIds: number[]) =>
    apiFetch<void>(`/roles/${roleId}/assign-users`, {
      method: "POST",
      body: JSON.stringify({ user_ids: userIds }),
    }),

  removeUsers: (roleId: number, userIds: number[]) =>
    apiFetch<void>(`/roles/${roleId}/remove-users`, {
      method: "POST",
      body: JSON.stringify({ user_ids: userIds }),
    }),

  listUsers: (roleId: number) =>
    apiFetch<User[]>(`/roles/${roleId}/users`),

  listUserOverrides: (userId: number) =>
    apiFetch<UserOverride[]>(`/roles/user-overrides/${userId}`),

  setOverride: (data: {
    user_id: number;
    permission_id: number;
    is_allowed: boolean;
  }) =>
    apiFetch<void>("/roles/user-overrides", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  deleteOverride: (userId: number, permissionId: number) =>
    apiFetch<void>(
      `/roles/user-overrides/${userId}/permission/${permissionId}`,
      { method: "DELETE" }
    ),
};

export const permissions = {
  list: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return apiFetch<Permission[]>(`/roles/permissions/all${qs}`);
  },
};

// ── Categories ────────────────────────────────────────────────────────────────

export interface Category {
  id: number;
  name: string;
  slug: string;
  description?: string;
  is_active: boolean;
}

export const categories = {
  list: (params?: { search?: string; limit?: number; offset?: number }) =>
    apiFetchPaginated<Category>(`/categories/${queryString(params)}`),

  get: (id: number) => apiFetch<Category>(`/categories/${id}`),

  create: (data: { name: string; slug: string; description?: string }) =>
    apiFetch<Category>("/categories/", {
      method: "POST",
      body: JSON.stringify(data),
    }).then((cat) => {
      revalidateCache(['categories']);
      return cat;
    }),

  update: (
    id: number,
    data: {
      name?: string;
      slug?: string;
      description?: string;
      is_active?: boolean;
    }
  ) =>
    apiFetch<Category>(`/categories/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }).then((cat) => {
      revalidateCache(['categories', 'articles']);
      return cat;
    }),

  delete: (id: number) =>
    apiFetch<void>(`/categories/${id}`, { method: "DELETE" }).then((res) => {
      revalidateCache(['categories', 'articles']);
      return res;
    }),
};

// ── Articles ──────────────────────────────────────────────────────────────────

export interface ArticleImage {
  id: number;
  image_url: string;
  caption?: string;
  alt_text?: string;
  sort_order: number;
}

/** Gallery image as sent to the API (no id yet for freshly uploaded files). */
export interface ArticleImageInput {
  image_url: string;
  caption?: string;
  alt_text?: string;
  sort_order: number;
}

export interface Article {
  id: number;
  title: string;
  slug: string;
  summary?: string;
  content: string;
  cover_image_url?: string;
  images: ArticleImage[];
  is_published: boolean;
  is_featured: boolean;
  category_id: number;
  author_id: number;
}

export interface ArticleListItem {
  id: number;
  title: string;
  slug: string;
  summary?: string;
  cover_image_url?: string;
  images: ArticleImage[];
  is_published: boolean;
  is_featured: boolean;
  category_id: number;
  author_id: number;
}

export interface PaginatedArticles {
  items: ArticleListItem[];
  total: number;
  limit: number;
  offset: number;
}

export const articles = {
  list: (params?: {
    category_id?: number;
    is_published?: boolean;
    /** Free-text match on title, summary and body — applied by the API. */
    search?: string;
    limit?: number;
    offset?: number;
  }) => apiFetchPaginated<ArticleListItem>(`/articles/${queryString(params)}`),

  get: (id: number) => apiFetch<Article>(`/articles/${id}`),

  create: (data: {
    title: string;
    slug: string;
    summary?: string;
    content: string;
    cover_image_url?: string;
    images?: ArticleImageInput[];
    is_published?: boolean;
    is_featured?: boolean;
    category_id: number;
  }) =>
    apiFetch<Article>("/articles/", {
      method: "POST",
      body: JSON.stringify(data),
    }).then((art) => {
      revalidateCache(['articles', `article-${art.slug}`, `category-${art.category_id}`]);
      return art;
    }),

  update: (
    id: number,
    data: {
      title?: string;
      slug?: string;
      summary?: string;
      content?: string;
      cover_image_url?: string;
      images?: ArticleImageInput[];
      is_published?: boolean;
      is_featured?: boolean;
      category_id?: number;
    }
  ) =>
    apiFetch<Article>(`/articles/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }).then((art) => {
      const tags = ['articles', `article-${art.slug}`];
      if (art.category_id) tags.push(`category-${art.category_id}`);
      // If the slug was changed, also invalidate the old slug tag.
      if (data.slug && data.slug !== art.slug) tags.push(`article-${data.slug}`);
      revalidateCache(tags);
      return art;
    }),

  delete: (id: number) =>
    apiFetch<void>(`/articles/${id}`, { method: "DELETE" }).then((res) => {
      // We don't know the slug after deletion, so invalidate the broad tag.
      revalidateCache(['articles']);
      return res;
    }),

  bulkPublish: (articleIds: number[], isPublished: boolean) =>
    apiFetch<{ updated_count: number }>("/articles/bulk-publish", {
      method: "POST",
      body: JSON.stringify({ article_ids: articleIds, is_published: isPublished }),
    }).then((result) => {
      revalidateCache(['articles']);
      return result;
    }),
};
