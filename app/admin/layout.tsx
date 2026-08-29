"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { isAuthenticated, auth, clearSession, UserMe } from "../../lib/admin-api";
// Inter is the admin UI's typeface and nothing on the public site uses it,
// so it is loaded here rather than in the root layout. Next code-splits CSS
// per route segment, which keeps the font off the reader-facing critical path.
import "@fontsource-variable/inter/wght.css";
import "./admin.css";

const NAV_ITEMS = [
  { href: "/admin", label: "Dashboard", icon: "⊞" },
  { href: "/admin/articles", label: "Articles", icon: "📰" },
  { href: "/admin/categories", label: "Categories", icon: "🏷️" },
  { href: "/admin/users", label: "Users", icon: "👥" },
  { href: "/admin/roles", label: "Roles", icon: "🛡️" },
  { href: "/admin/permissions", label: "Permissions", icon: "🔑" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<UserMe | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);   // desktop collapsed state
  const [mobileOpen, setMobileOpen] = useState(false);    // mobile drawer state
  const [loading, setLoading] = useState(true);

  // Close mobile drawer on route change
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Auth guard
  useEffect(() => {
    if (pathname === "/admin/login") { setLoading(false); return; }
    if (!isAuthenticated()) { router.replace("/admin/login"); return; }
    auth.me()
      .then((user) => { setMe(user); setLoading(false); })
      .catch(() => { clearSession(); router.replace("/admin/login"); });
  }, [pathname, router]);

  const handleLogout = async () => {
    try { await auth.logout(); } catch {}
    clearSession();
    router.replace("/admin/login");
  };

  if (pathname === "/admin/login") return <>{children}</>;

  if (loading) {
    return (
      <div className="admin-loader">
        <div className="loader-ring" />
      </div>
    );
  }

  const shellClass = [
    "admin-shell",
    sidebarOpen ? "sidebar-open" : "sidebar-closed",
    mobileOpen ? "mobile-open" : "",
  ].filter(Boolean).join(" ");

  const currentPage = NAV_ITEMS.find((n) =>
    n.href === "/admin" ? pathname === "/admin" : pathname.startsWith(n.href)
  );

  return (
    <div className={shellClass}>
      {/* Mobile overlay — closes drawer on tap */}
      <div
        className="sidebar-overlay"
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      {/* ── Sidebar ── */}
      <aside className="admin-sidebar">
        <div className="sidebar-brand">
          <span className="brand-icon">📡</span>
          <span className="brand-name">QCF Admin</span>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item ${
                (item.href === "/admin"
                  ? pathname === "/admin"
                  : pathname.startsWith(item.href))
                  ? "active"
                  : ""
              }`}
              title={item.label}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </Link>
          ))}
        </nav>

        <button
          className="sidebar-toggle"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          title={sidebarOpen ? "Collapse" : "Expand"}
        >
          <span className="toggle-icon">{sidebarOpen ? "◀" : "▶"}</span>
          <span className="toggle-label">{sidebarOpen ? "Collapse" : "Expand"}</span>
        </button>
      </aside>

      {/* ── Main area ── */}
      <div className="admin-main">
        {/* Topbar */}
        <header className="admin-topbar">
          <div className="topbar-left">
            {/* Hamburger — mobile only */}
            <button
              className="hamburger"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle menu"
            >
              {mobileOpen ? "✕" : "☰"}
            </button>
            <div className="breadcrumb">{currentPage?.label ?? "Admin"}</div>
          </div>

          <div className="topbar-right">
            {me && (
              <div className="user-chip">
                <span className="user-avatar">
                  {(me.first_name ?? me.email)[0].toUpperCase()}
                </span>
                <span className="user-name">
                  {me.first_name
                    ? `${me.first_name} ${me.last_name ?? ""}`.trim()
                    : me.email}
                </span>
                {me.is_superuser && <span className="badge-super">Super</span>}
              </div>
            )}
            <button className="btn-logout" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="admin-content">{children}</main>
      </div>
    </div>
  );
}
