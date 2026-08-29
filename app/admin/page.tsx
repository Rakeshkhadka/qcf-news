"use client";
import { useEffect, useState } from "react";
import { roles, permissions, categories, articles } from "../../lib/admin-api";

interface Stats {
  roles: number;
  permissions: number;
  categories: number;
  articles: number;
  published: number;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [rolesData, permsData, catsData, artsData] = await Promise.allSettled([
          roles.list(),
          permissions.list(),
          categories.list({ limit: 1, offset: 0 }),
          articles.list({ limit: 1, offset: 0 }),
        ]);

        const rolesCount = rolesData.status === "fulfilled" ? (rolesData.value as any[]).length : 0;
        const permsCount = permsData.status === "fulfilled" ? (permsData.value as any[]).length : 0;
        const catsCount = catsData.status === "fulfilled" ? (catsData.value as any).total_count ?? 0 : 0;
        const artsCount = artsData.status === "fulfilled" ? (artsData.value as any).total_count ?? 0 : 0;

        setStats({ roles: rolesCount, permissions: permsCount, categories: catsCount, articles: artsCount, published: 0 });
      } catch {}
      setLoading(false);
    })();
  }, []);

  const CARDS = [
    { label: "Roles", value: stats?.roles, icon: "🛡️", color: "#6366f1" },
    { label: "Permissions", value: stats?.permissions, icon: "🔑", color: "#8b5cf6" },
    { label: "Categories", value: stats?.categories, icon: "🏷️", color: "#10b981" },
    { label: "Articles", value: stats?.articles, icon: "📰", color: "#f59e0b" },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">Welcome to QCF News Admin Portal</p>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "60px", color: "var(--text2)" }}>
          <div className="loader-ring" style={{ margin: "0 auto" }} />
        </div>
      ) : (
        <>
          <div className="card-grid">
            {CARDS.map((c) => (
              <div className="stat-card" key={c.label} style={{ borderTop: `3px solid ${c.color}` }}>
                <div className="stat-icon">{c.icon}</div>
                <div className="stat-label">{c.label}</div>
                <div className="stat-value" style={{ color: c.color }}>{c.value ?? "—"}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 12 }}>Quick Links</h2>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {[
                { href: "/admin/articles", label: "📰 Manage Articles" },
                { href: "/admin/categories", label: "🏷️ Manage Categories" },
                { href: "/admin/users", label: "👥 Manage Users" },
                { href: "/admin/roles", label: "🛡️ Manage Roles" },
                { href: "/admin/permissions", label: "🔑 View Permissions" },
              ].map((l) => (
                <a key={l.href} href={l.href} className="btn btn-ghost btn-sm">{l.label}</a>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
