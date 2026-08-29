"use client";
import { useEffect, useState, useCallback } from "react";
import { categories, Category } from "../../../lib/admin-api";
import ConfirmModal from "../components/ConfirmModal";

const ITEMS_PER_PAGE = 10;

type ModalMode = "create" | "edit" | null;
type DeleteTarget = { id: number; name: string } | null;

export default function CategoriesPage() {
  const [list, setList] = useState<Category[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<ModalMode>(null);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form, setForm] = useState({ name: "", slug: "", description: "", is_active: true });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [search, setSearch] = useState("");
  // What the API is actually filtering on: the box, settled after a keystroke pause.
  const [appliedSearch, setAppliedSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const totalPages = Math.max(1, Math.ceil(totalCount / ITEMS_PER_PAGE));

  const load = useCallback(async (targetPage = page, searchTerm = appliedSearch) => {
    setLoading(true);
    try {
      const offset = (targetPage - 1) * ITEMS_PER_PAGE;
      const res = await categories.list({ limit: ITEMS_PER_PAGE, offset, search: searchTerm || undefined });
      setList(res.data);
      setTotalCount(res.total_count);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, [page, appliedSearch]);

  useEffect(() => { load(page, appliedSearch); }, [page, appliedSearch]);

  // Searching happens on the server across every page of results, so hold the
  // request back until typing pauses and start again from the first page.
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const goToPage = (p: number) => {
    if (p < 1 || p > totalPages) return;
    setPage(p);
  };

  const getPageNumbers = (): (number | "...")[] => {
    const pages: (number | "...")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push("...");
      const start = Math.max(2, page - 1);
      const end = Math.min(totalPages - 1, page + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (page < totalPages - 2) pages.push("...");
      pages.push(totalPages);
    }
    return pages;
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", slug: "", description: "", is_active: true });
    setFormError(""); setModal("create");
  };

  const openEdit = (c: Category) => {
    setEditing(c);
    setForm({ name: c.name, slug: c.slug, description: c.description ?? "", is_active: c.is_active });
    setFormError(""); setModal("edit");
  };

  const toSlug = (s: string) => s.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  const handleSave = async () => {
    if (!form.name.trim()) { setFormError("Name is required"); return; }
    if (!form.slug.trim()) { setFormError("Slug is required"); return; }
    setSaving(true); setFormError("");
    try {
      if (modal === "create") {
        await categories.create({ name: form.name, slug: form.slug, description: form.description || undefined });
      } else if (editing) {
        await categories.update(editing.id, { name: form.name, slug: form.slug, description: form.description || undefined, is_active: form.is_active });
      }
      setModal(null); load(page);
    } catch (e: any) { setFormError(e.message); }
    setSaving(false);
  };

  const handleDelete = async (id: number) => {
    try { await categories.delete(id); load(page); } catch (e: any) { setError(e.message); }
    setDeleteTarget(null);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Categories</h1>
          <p className="page-sub">Manage news categories</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ New Category</button>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="search-bar">
        <input placeholder="Search name, slug or description…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 48 }}><div className="loader-ring" style={{ margin: "0 auto" }} /></div>
      ) : list.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">🏷️</div><p>{appliedSearch ? `No categories match “${appliedSearch}”.` : "No categories found."}</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>Name</th><th>Slug</th><th>Description</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {list.map(c => (
                <tr key={c.id}>
                  <td><span className="perm-code">{c.id}</span></td>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td><span className="perm-code">{c.slug}</span></td>
                  <td style={{ color: "var(--text2)" }}>{c.description ?? "—"}</td>
                  <td><span className={`badge ${c.is_active ? "badge-green" : "badge-red"}`}>{c.is_active ? "Active" : "Inactive"}</span></td>
                  <td>
                    <div className="td-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(c)}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => setDeleteTarget({ id: c.id, name: c.name })}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination bar ── */}
      {!loading && totalCount > 0 && (
        <div className="pagination-bar">
          <div className="pagination-info">
            Showing {Math.min((page - 1) * ITEMS_PER_PAGE + 1, totalCount)}–{Math.min(page * ITEMS_PER_PAGE, totalCount)} of {totalCount}
          </div>
          <div className="pagination-controls">
            <button
              className="pagination-btn"
              disabled={page <= 1}
              onClick={() => goToPage(page - 1)}
            >
              ‹ Prev
            </button>
            {getPageNumbers().map((p, i) =>
              p === "..." ? (
                <span key={`e${i}`} className="pagination-ellipsis">…</span>
              ) : (
                <button
                  key={p}
                  className={`pagination-btn${p === page ? " active" : ""}`}
                  onClick={() => goToPage(p)}
                >
                  {p}
                </button>
              )
            )}
            <button
              className="pagination-btn"
              disabled={page >= totalPages}
              onClick={() => goToPage(page + 1)}
            >
              Next ›
            </button>
          </div>
        </div>
      )}

      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">{modal === "create" ? "Create Category" : "Edit Category"}</div>
            {formError && <div className="error-box">{formError}</div>}
            <div className="form-group">
              <label>Name</label>
              <input value={form.name} onChange={e => {
                const name = e.target.value;
                setForm(f => ({ ...f, name, slug: modal === "create" ? toSlug(name) : f.slug }));
              }} placeholder="Technology" />
            </div>
            <div className="form-group">
              <label>Slug</label>
              <input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} placeholder="technology" />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional description" />
            </div>
            {modal === "edit" && (
              <div className="form-group">
                <div className="checkbox-item">
                  <input type="checkbox" id="is_active" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} style={{ width: "auto" }} />
                  <label htmlFor="is_active" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400, color: "var(--text)", marginBottom: 0 }}>Active</label>
                </div>
              </div>
            )}
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
      {deleteTarget && (
        <ConfirmModal
          title="Delete Category"
          message={`Are you sure you want to delete "${deleteTarget.name}"? This cannot be undone.`}
          confirmLabel="Delete Category"
          onConfirm={() => handleDelete(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
