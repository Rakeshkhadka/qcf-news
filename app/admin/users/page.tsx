"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Permission,
  Role,
  User,
  UserOverride,
  permissions,
  roles,
  userLabel,
} from "../../../lib/admin-api";
import ConfirmModal from "../components/ConfirmModal";
import { UserAvatar, UserMultiSelect, UserPicker } from "../components/UserPicker";

type Tab = "assignments" | "overrides";

/** Effective state of one permission for the selected user. */
type PermState = "allow-override" | "deny-override" | "role" | "none";

export default function UsersPage() {
  const [roleList, setRoleList] = useState<Role[]>([]);
  const [permList, setPermList] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("assignments");

  // Role → users view
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [roleUsers, setRoleUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  // Assign users modal
  const [assignModal, setAssignModal] = useState(false);
  const [assignPick, setAssignPick] = useState<User[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState("");
  const [removeTarget, setRemoveTarget] = useState<User | null>(null);

  // Overrides tab
  const [overrideUser, setOverrideUser] = useState<User | null>(null);
  const [overrides, setOverrides] = useState<UserOverride[]>([]);
  const [loadingOverrides, setLoadingOverrides] = useState(false);
  const [overrideError, setOverrideError] = useState("");
  const [permFilter, setPermFilter] = useState("");
  const [savingPermId, setSavingPermId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [r, p] = await Promise.all([roles.list(), permissions.list()]);
      setRoleList(r as Role[]);
      setPermList(p as Permission[]);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // ── Role assignments ───────────────────────────────────────────────────────

  const viewRoleUsers = async (role: Role) => {
    setSelectedRole(role);
    setLoadingUsers(true);
    try {
      const users = await roles.listUsers(role.id);
      setRoleUsers(users as User[]);
    } catch (e: any) { setRoleUsers([]); }
    setLoadingUsers(false);
  };

  const handleAssignUsers = async () => {
    if (!selectedRole) return;
    if (!assignPick.length) { setAssignError("Pick at least one user"); return; }
    setAssigning(true); setAssignError("");
    try {
      await roles.assignUsers(selectedRole.id, assignPick.map(u => u.id));
      setAssignModal(false); setAssignPick([]);
      viewRoleUsers(selectedRole);
    } catch (e: any) { setAssignError(e.message); }
    setAssigning(false);
  };

  const handleRemoveUser = async () => {
    if (!selectedRole || !removeTarget) return;
    const target = removeTarget;
    setRemoveTarget(null);
    try { await roles.removeUsers(selectedRole.id, [target.id]); viewRoleUsers(selectedRole); }
    catch (e: any) { alert(e.message); }
  };

  // ── Overrides ──────────────────────────────────────────────────────────────

  const fetchOverrides = async (user: User) => {
    setLoadingOverrides(true); setOverrideError("");
    try {
      const data = await roles.listUserOverrides(user.id);
      setOverrides(data as UserOverride[]);
    } catch (e: any) { setOverrideError(e.message); setOverrides([]); }
    setLoadingOverrides(false);
  };

  const selectOverrideUser = (user: User | null) => {
    setOverrideUser(user);
    setOverrides([]);
    setOverrideError("");
    setPermFilter("");
    if (user) fetchOverrides(user);
  };

  /** Permission codes the selected user inherits from their roles. */
  const rolePermCodes = useMemo(() => {
    if (!overrideUser) return new Set<string>();
    const userRoleIds = new Set((overrideUser.roles ?? []).map(r => r.id));
    const codes = new Set<string>();
    roleList
      .filter(r => userRoleIds.has(r.id))
      .forEach(r => (r.permissions ?? []).forEach(p => codes.add(p.code)));
    return codes;
  }, [overrideUser, roleList]);

  const overrideMap = useMemo(
    () => new Map(overrides.map(o => [o.permission_id, o.is_allowed])),
    [overrides]
  );

  const permStateOf = (p: Permission): PermState => {
    const ov = overrideMap.get(p.id);
    if (ov === true) return "allow-override";
    if (ov === false) return "deny-override";
    return rolePermCodes.has(p.code) ? "role" : "none";
  };

  /** Set or clear one override, then refresh from the server. */
  const applyOverride = async (p: Permission, next: PermState) => {
    if (!overrideUser) return;
    setSavingPermId(p.id); setOverrideError("");
    try {
      if (next === "allow-override" || next === "deny-override") {
        await roles.setOverride({
          user_id: overrideUser.id,
          permission_id: p.id,
          is_allowed: next === "allow-override",
        });
      } else {
        await roles.deleteOverride(overrideUser.id, p.id);
      }
      await fetchOverrides(overrideUser);
    } catch (e: any) { setOverrideError(e.message); }
    setSavingPermId(null);
  };

  /** Permission list for the matrix, grouped by module and filtered by the box. */
  const permModules = useMemo(() => {
    const term = permFilter.trim().toLowerCase();
    const matches = permList.filter(p =>
      !term ||
      p.name.toLowerCase().includes(term) ||
      p.code.toLowerCase().includes(term) ||
      p.module.toLowerCase().includes(term)
    );
    const grouped = new Map<string, Permission[]>();
    matches.forEach(p => {
      const bucket = grouped.get(p.module) ?? [];
      bucket.push(p);
      grouped.set(p.module, bucket);
    });
    return Array.from(grouped.entries());
  }, [permList, permFilter]);

  const moduleLabel = (m: string) => m.replace(/_/g, " ");

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="page-sub">Manage user role assignments and permission overrides</p>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="tabs">
        <button className={`tab ${tab === "assignments" ? "active" : ""}`} onClick={() => setTab("assignments")}>Role Assignments</button>
        <button className={`tab ${tab === "overrides" ? "active" : ""}`} onClick={() => setTab("overrides")}>Permission Overrides (ABAC)</button>
      </div>

      {/* ── Role Assignments Tab ── */}
      {tab === "assignments" && (
        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16 }}>
          {/* Role list panel */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: "0.85rem" }}>Select a Role</div>
            {loading ? (
              <div style={{ padding: 24, textAlign: "center" }}><div className="loader-ring" style={{ margin: "0 auto" }} /></div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {roleList.map(r => (
                  <button key={r.id} onClick={() => viewRoleUsers(r)}
                    style={{
                      padding: "12px 16px", textAlign: "left", background: selectedRole?.id === r.id ? "rgba(99,102,241,0.15)" : "transparent",
                      border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer",
                      color: selectedRole?.id === r.id ? "var(--accent)" : "var(--text)", fontFamily: "inherit", fontSize: "0.875rem", fontWeight: 500,
                    }}>
                    {r.name}
                    <span style={{ float: "right", fontSize: "0.75rem", color: "var(--text2)" }}>{(r.permissions ?? []).length} perms</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Users in role panel */}
          <div className="card">
            {!selectedRole ? (
              <div className="empty-state" style={{ padding: "40px 24px" }}><div className="empty-icon">👈</div><p>Select a role to see its users</p></div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "1rem" }}>{selectedRole.name}</div>
                    <div style={{ fontSize: "0.8rem", color: "var(--text2)" }}>{selectedRole.description ?? "No description"}</div>
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={() => { setAssignPick([]); setAssignError(""); setAssignModal(true); }}>+ Assign Users</button>
                </div>

                {loadingUsers ? (
                  <div style={{ textAlign: "center", padding: 32 }}><div className="loader-ring" style={{ margin: "0 auto" }} /></div>
                ) : roleUsers.length === 0 ? (
                  <div className="empty-state"><div className="empty-icon">👥</div><p>No users assigned to this role</p></div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>User</th><th>Email</th><th>Superuser</th><th>Actions</th></tr></thead>
                      <tbody>
                        {roleUsers.map(u => (
                          <tr key={u.id}>
                            <td>
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <UserAvatar user={u} size={28} />
                                <span style={{ fontWeight: 500 }}>{userLabel(u)}</span>
                              </div>
                            </td>
                            <td style={{ color: "var(--text2)" }}>{u.email}</td>
                            <td>{u.is_superuser ? <span className="badge badge-blue">Super</span> : "—"}</td>
                            <td>
                              <div className="td-actions">
                                <button className="btn btn-ghost btn-sm" onClick={() => { setTab("overrides"); selectOverrideUser(u); }}>Overrides</button>
                                <button className="btn btn-danger btn-sm" onClick={() => setRemoveTarget(u)}>Remove</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Overrides Tab ── */}
      {tab === "overrides" && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Find a user</div>
            <div style={{ fontSize: "0.8rem", color: "var(--text2)", marginBottom: 12 }}>
              Search by name or email — no need to know their ID.
            </div>
            <div style={{ maxWidth: 460 }}>
              <UserPicker value={overrideUser} onChange={selectOverrideUser} />
            </div>
            {overrideError && <div className="error-box" style={{ marginTop: 12, marginBottom: 0 }}>{overrideError}</div>}
          </div>

          {!overrideUser ? (
            <div className="empty-state">
              <div className="empty-icon">🔑</div>
              <p>Pick a user to review and adjust their permissions</p>
            </div>
          ) : (
            <>
              {/* User summary */}
              <div className="card" style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                  <UserAvatar user={overrideUser} size={44} />
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontWeight: 700, fontSize: "1rem" }}>
                      {userLabel(overrideUser)}
                      {overrideUser.is_superuser && <span className="badge badge-blue" style={{ marginLeft: 8 }}>Super</span>}
                    </div>
                    <div style={{ fontSize: "0.82rem", color: "var(--text2)" }}>
                      {overrideUser.email} · <span className="perm-code">ID {overrideUser.id}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(overrideUser.roles ?? []).length === 0 ? (
                      <span className="badge badge-yellow">No roles</span>
                    ) : (
                      (overrideUser.roles ?? []).map(r => (
                        <span key={r.id} className="badge badge-blue">{r.name}</span>
                      ))
                    )}
                  </div>
                </div>

                {overrideUser.is_superuser && (
                  <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 8, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", color: "var(--yellow)", fontSize: "0.82rem" }}>
                    This user is a superuser — every permission check passes regardless of the overrides below.
                  </div>
                )}
              </div>

              {/* Permission matrix */}
              <div className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 600 }}>Permissions</div>
                  <input
                    value={permFilter}
                    onChange={e => setPermFilter(e.target.value)}
                    placeholder="Filter permissions…"
                    style={{ maxWidth: 240 }}
                  />
                </div>
                <div style={{ fontSize: "0.8rem", color: "var(--text2)", marginBottom: 16 }}>
                  <b style={{ color: "var(--green)" }}>Allow</b> and <b style={{ color: "var(--red)" }}>Deny</b> set a
                  user-level override that beats the role. <b>Inherit</b> clears the override and falls back to
                  whatever the user&apos;s roles grant.
                </div>

                {loadingOverrides ? (
                  <div style={{ textAlign: "center", padding: 32 }}><div className="loader-ring" style={{ margin: "0 auto" }} /></div>
                ) : permModules.length === 0 ? (
                  <div className="empty-state"><p>No permissions match “{permFilter}”</p></div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                    {permModules.map(([module, perms]) => (
                      <div key={module}>
                        <div className="perm-module-title">{moduleLabel(module)}</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {perms.map(p => {
                            const state = permStateOf(p);
                            const busy = savingPermId === p.id;
                            return (
                              <div key={p.id} style={{
                                display: "flex", alignItems: "center", justifyContent: "space-between",
                                gap: 12, flexWrap: "wrap",
                                padding: "10px 12px", borderRadius: 8,
                                background: "var(--bg3)", border: "1px solid var(--border)",
                                opacity: busy ? 0.6 : 1,
                              }}>
                                <div style={{ minWidth: 200 }}>
                                  <div style={{ fontSize: "0.875rem", fontWeight: 500 }}>{p.name}</div>
                                  <div style={{ marginTop: 3, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                    <span className="perm-code">{p.code}</span>
                                    <span style={{ fontSize: "0.75rem", color: "var(--text2)" }}>
                                      {state === "allow-override" && "Granted by override"}
                                      {state === "deny-override" && "Blocked by override"}
                                      {state === "role" && "Granted by role"}
                                      {state === "none" && "Not granted"}
                                    </span>
                                  </div>
                                </div>
                                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                                  <button
                                    className={`btn btn-sm ${state === "allow-override" ? "btn-primary" : "btn-ghost"}`}
                                    disabled={busy || state === "allow-override"}
                                    onClick={() => applyOverride(p, "allow-override")}
                                  >✓ Allow</button>
                                  <button
                                    className={`btn btn-sm ${state === "deny-override" ? "btn-danger" : "btn-ghost"}`}
                                    disabled={busy || state === "deny-override"}
                                    onClick={() => applyOverride(p, "deny-override")}
                                  >✗ Deny</button>
                                  <button
                                    className="btn btn-ghost btn-sm"
                                    disabled={busy || (state !== "allow-override" && state !== "deny-override")}
                                    onClick={() => applyOverride(p, "none")}
                                  >Inherit</button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Assign Users Modal */}
      {assignModal && (
        <div className="modal-backdrop" onClick={() => setAssignModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Assign Users to {selectedRole?.name}</div>
            {assignError && <div className="error-box">{assignError}</div>}
            <UserMultiSelect
              selected={assignPick}
              onChange={setAssignPick}
              lockedIds={roleUsers.map(u => u.id)}
              lockedNote="Already in role"
            />
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setAssignModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAssignUsers} disabled={assigning || assignPick.length === 0}>
                {assigning ? "Assigning…" : `Assign${assignPick.length ? ` ${assignPick.length}` : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove-from-role confirmation */}
      {removeTarget && selectedRole && (
        <ConfirmModal
          title="Remove from role"
          message={`Remove ${userLabel(removeTarget)} (${removeTarget.email}) from the ${selectedRole.name} role?`}
          confirmLabel="Remove"
          onConfirm={handleRemoveUser}
          onCancel={() => setRemoveTarget(null)}
        />
      )}
    </div>
  );
}
