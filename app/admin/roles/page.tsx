"use client";
import { useEffect, useState } from "react";
import { roles, permissions, Role, Permission } from "../../../lib/admin-api";
import ConfirmModal from "../components/ConfirmModal";

type ModalMode = "create" | "edit" | null;
type DeleteTarget = { id: number; name: string } | null;

export default function RolesPage() {
  const [roleList, setRoleList] = useState<Role[]>([]);
  const [permList, setPermList] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<ModalMode>(null);
  const [editing, setEditing] = useState<Role | null>(null);
  const [form, setForm] = useState({ name: "", description: "", permission_ids: [] as number[] });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [viewPermsRole, setViewPermsRole] = useState<Role | null>(null);
  const [permSearch, setPermSearch] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      // The list endpoint already embeds each role's permissions, so this is
      // two requests total rather than one per role.
      const [rawRoles, perms] = await Promise.all([
        roles.list(),
        permissions.list(),
      ]);

      setRoleList(rawRoles as Role[]);
      setPermList(perms as Permission[]);
    } catch (e: any) {
      setError(e.message ?? "Failed to load roles");
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", description: "", permission_ids: [] });
    setFormError("");
    setModal("create");
  };

  const openEdit = async (r: Role) => {
    setFormError("");
    setModal("edit");
    setEditLoading(true);
    try {
      // Always re-fetch to get the full permissions list
      const full = await roles.get(r.id) as Role;
      setEditing(full);
      setForm({
        name: full.name,
        description: full.description ?? "",
        permission_ids: (full.permissions ?? []).map(p => p.id),
      });
    } catch (e: any) {
      setFormError(e.message);
    }
    setEditLoading(false);
  };

  const togglePerm = (id: number) => {
    setForm(f => ({
      ...f,
      permission_ids: f.permission_ids.includes(id)
        ? f.permission_ids.filter(x => x !== id)
        : [...f.permission_ids, id],
    }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setFormError("Name is required"); return; }
    setSaving(true);
    setFormError("");
    try {
      if (modal === "create") {
        await roles.create({
          name: form.name,
          description: form.description || undefined,
          permission_ids: form.permission_ids,
        });
      } else if (editing) {
        await roles.update(editing.id, {
          name: form.name,
          description: form.description || undefined,
          permission_ids: form.permission_ids,
        });
      }
      setModal(null);
      load();
    } catch (e: any) {
      setFormError(e.message);
    }
    setSaving(false);
  };

  const handleDelete = async (id: number) => {
    try { await roles.delete(id); load(); } catch (e: any) { setError(e.message); }
    setDeleteTarget(null);
  };

  // Group permissions by module for the checkbox UI
  const permByModule: Record<string, Permission[]> = {};
  permList.forEach(p => {
    (permByModule[p.module] = permByModule[p.module] ?? []).push(p);
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Roles</h1>
          <p className="page-sub">Manage roles and their permissions</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ New Role</button>
      </div>

      {error && <div className="error-box">{error}</div>}

      {loading ? (
        <div style={{ textAlign: "center", padding: 48 }}>
          <div className="loader-ring" style={{ margin: "0 auto" }} />
          <p style={{ color: "var(--text2)", marginTop: 12, fontSize: "0.85rem" }}>Loading roles…</p>
        </div>
      ) : roleList.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🛡️</div>
          <p>No roles yet. Create one!</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <colgroup>
              <col style={{ width: 56 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 160 }} />
              <col />{/* permissions — takes remaining space */}
              <col style={{ width: 140 }} />
            </colgroup>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Description</th>
                <th>Permissions</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {roleList.map(r => {
                const perms = r.permissions ?? [];
                return (
                  <tr key={r.id}>
                    <td><span className="perm-code">{r.id}</span></td>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td style={{ color: "var(--text2)" }}>{r.description ?? "—"}</td>
                    <td>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                        {perms.slice(0, 3).map(p => (
                          <span key={p.id} className="badge badge-blue">{p.name}</span>
                        ))}
                        {perms.length > 3 && (
                          <button
                            onClick={() => { setViewPermsRole(r); setPermSearch(""); }}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              padding: "3px 10px", borderRadius: 99,
                              fontSize: "0.72rem", fontWeight: 600,
                              background: "rgba(245,158,11,0.15)",
                              color: "var(--yellow)",
                              border: "1px solid rgba(245,158,11,0.4)",
                              cursor: "pointer", fontFamily: "inherit",
                              transition: "all 0.15s",
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = "rgba(245,158,11,0.28)")}
                            onMouseLeave={e => (e.currentTarget.style.background = "rgba(245,158,11,0.15)")}
                          >
                            +{perms.length - 3} more
                          </button>
                        )}
                        {perms.length === 0 && (
                          <span className="badge badge-red">No permissions</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="td-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(r)}>Edit</button>
                        <button className="btn btn-danger btn-sm" onClick={() => setDeleteTarget({ id: r.id, name: r.name })}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">
              {modal === "create" ? "Create Role" : `Edit Role${editing ? ` — ${editing.name}` : ""}`}
            </div>

            {formError && <div className="error-box">{formError}</div>}

            {editLoading ? (
              <div style={{ textAlign: "center", padding: 32 }}>
                <div className="loader-ring" style={{ margin: "0 auto" }} />
              </div>
            ) : (
              <>
                <div className="form-group">
                  <label>Role Name</label>
                  <input
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Editor"
                    autoFocus
                  />
                </div>
                <div className="form-group">
                  <label>Description</label>
                  <input
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Optional description"
                  />
                </div>
                <div className="form-group">
                  <label>
                    Permissions
                    <span style={{ fontWeight: 400, marginLeft: 8, color: "var(--text2)" }}>
                      ({form.permission_ids.length} selected)
                    </span>
                  </label>
                  <div className="checkbox-group">
                    {Object.entries(permByModule).map(([mod, perms]) => {
                      const modIds = perms.map(p => p.id);
                      const selectedCount = modIds.filter(id => form.permission_ids.includes(id)).length;
                      const allSelected = selectedCount === modIds.length;
                      const someSelected = selectedCount > 0 && !allSelected;

                      const toggleModule = () => {
                        if (allSelected) {
                          // deselect all in module
                          setForm(f => ({ ...f, permission_ids: f.permission_ids.filter(id => !modIds.includes(id)) }));
                        } else {
                          // select all in module
                          setForm(f => ({ ...f, permission_ids: Array.from(new Set([...f.permission_ids, ...modIds])) }));
                        }
                      };

                      return (
                        <div key={mod} style={{ marginBottom: 4 }}>
                          {/* Module header row with Select All */}
                          <div style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            padding: "6px 0", margin: "4px 0 2px",
                            borderBottom: "1px solid var(--border)",
                          }}>
                            <span style={{
                              fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase",
                              color: "var(--accent)", letterSpacing: "0.08em",
                            }}>
                              {mod}
                            </span>
                            <label style={{
                              display: "flex", alignItems: "center", gap: 6,
                              cursor: "pointer", textTransform: "none", letterSpacing: 0,
                              fontWeight: 500, fontSize: "0.75rem",
                              color: allSelected ? "var(--accent)" : someSelected ? "var(--yellow)" : "var(--text2)",
                              marginBottom: 0,
                            }}>
                              <input
                                type="checkbox"
                                checked={allSelected}
                                ref={el => { if (el) el.indeterminate = someSelected; }}
                                onChange={toggleModule}
                                style={{ width: "auto", cursor: "pointer" }}
                              />
                              {allSelected ? "Deselect all" : someSelected ? `${selectedCount}/${modIds.length} selected` : "Select all"}
                            </label>
                          </div>

                          {/* Individual permission checkboxes */}
                          {perms.map(p => (
                            <div className="checkbox-item" key={p.id} style={{ paddingLeft: 4 }}>
                              <input
                                type="checkbox"
                                id={`perm-${p.id}`}
                                checked={form.permission_ids.includes(p.id)}
                                onChange={() => togglePerm(p.id)}
                              />
                              <label
                                htmlFor={`perm-${p.id}`}
                                style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400, color: "var(--text)", marginBottom: 0 }}
                              >
                                {p.name}&nbsp;<span className="perm-code">{p.code}</span>
                              </label>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="modal-footer">
                  <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                    {saving ? "Saving…" : "Save Role"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {deleteTarget && (
        <ConfirmModal
          title="Delete Role"
          message={`Are you sure you want to delete the role "${deleteTarget.name}"? This cannot be undone.`}
          confirmLabel="Delete Role"
          onConfirm={() => handleDelete(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      {/* ── Permissions Viewer Modal ── */}
      {viewPermsRole && (() => {
        const allPerms = viewPermsRole.permissions ?? [];
        const filtered = permSearch
          ? allPerms.filter(p =>
              p.name.toLowerCase().includes(permSearch.toLowerCase()) ||
              p.code.toLowerCase().includes(permSearch.toLowerCase()) ||
              p.module.toLowerCase().includes(permSearch.toLowerCase())
            )
          : allPerms;
        const byModule: Record<string, typeof allPerms> = {};
        filtered.forEach(p => { (byModule[p.module] = byModule[p.module] ?? []).push(p); });

        return (
          <div className="modal-backdrop" onClick={() => setViewPermsRole(null)}>
            <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, gap: 12 }}>
                <div>
                  <div className="modal-title" style={{ marginBottom: 4 }}>
                    🛡️ {viewPermsRole.name}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="badge badge-blue">{allPerms.length} permissions</span>
                    {viewPermsRole.description && (
                      <span style={{ fontSize: "0.8rem", color: "var(--text2)" }}>{viewPermsRole.description}</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setViewPermsRole(null)}
                  style={{ background: "none", border: "none", color: "var(--text2)", cursor: "pointer", fontSize: "1.2rem", lineHeight: 1, padding: 4, flexShrink: 0 }}
                >✕</button>
              </div>

              {/* Search */}
              <div style={{ marginBottom: 16 }}>
                <input
                  placeholder="Search permissions…"
                  value={permSearch}
                  onChange={e => setPermSearch(e.target.value)}
                  autoFocus
                />
              </div>

              {/* Grouped list */}
              {filtered.length === 0 ? (
                <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text2)" }}>No matching permissions</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 16, maxHeight: 400, overflowY: "auto" }}>
                  {Object.entries(byModule).map(([mod, perms]) => (
                    <div key={mod}>
                      <div style={{
                        fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase",
                        letterSpacing: "0.08em", color: "var(--accent)", marginBottom: 8,
                        display: "flex", alignItems: "center", gap: 8,
                      }}>
                        {mod}
                        <span style={{
                          background: "rgba(99,102,241,0.15)", color: "var(--accent)",
                          border: "1px solid rgba(99,102,241,0.3)",
                          borderRadius: 99, padding: "1px 7px", fontSize: "0.68rem", fontWeight: 600,
                        }}>{perms.length}</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {perms.map(p => (
                          <div key={p.id} style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            padding: "8px 12px", background: "var(--bg3)",
                            borderRadius: 8, border: "1px solid var(--border)", gap: 12,
                          }}>
                            <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>{p.name}</span>
                            <span className="perm-code">{p.code}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="modal-footer">
                <button className="btn btn-ghost" onClick={() => setViewPermsRole(null)}>Close</button>
                <button className="btn btn-primary" onClick={() => { setViewPermsRole(null); openEdit(viewPermsRole); }}>Edit Role</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
