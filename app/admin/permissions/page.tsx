"use client";
import { useEffect, useState } from "react";
import { permissions, Permission } from "../../../lib/admin-api";

export default function PermissionsPage() {
  const [permList, setPermList] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    permissions.list()
      .then(p => setPermList(p as Permission[]))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = permList.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.code.toLowerCase().includes(search.toLowerCase())
  );

  // Group by module
  const byModule: Record<string, Permission[]> = {};
  filtered.forEach(p => { (byModule[p.module] = byModule[p.module] ?? []).push(p); });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Permissions</h1>
          <p className="page-sub">All system permissions (read-only, seeded by the backend)</p>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="search-bar">
        <input
          placeholder="Search permissions…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 320 }}
        />
        <span style={{ color: "var(--text2)", fontSize: "0.85rem" }}>{filtered.length} permissions</span>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 48 }}><div className="loader-ring" style={{ margin: "0 auto" }} /></div>
      ) : (
        <div className="perm-grid">
          {Object.entries(byModule).map(([mod, perms]) => (
            <div className="perm-module" key={mod}>
              <div className="perm-module-title">{mod}</div>
              <div className="perm-list">
                {perms.map(p => (
                  <div className="perm-row" key={p.id}>
                    <span style={{ fontSize: "0.875rem" }}>{p.name}</span>
                    <span className="perm-code">{p.code}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="empty-state"><div className="empty-icon">🔑</div><p>No permissions found.</p></div>
      )}
    </div>
  );
}
