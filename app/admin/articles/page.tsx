"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { articles, categories, ArticleListItem, Category } from "../../../lib/admin-api";
import ConfirmModal from "../components/ConfirmModal";

const ITEMS_PER_PAGE = 10;

type DeleteTarget = { id: number; title: string } | null;

export default function ArticlesPage() {
  const [list, setList] = useState<ArticleListItem[]>([]);
  const [catList, setCatList] = useState<Category[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  // What the API is actually filtering on: the box, settled after a keystroke pause.
  const [appliedSearch, setAppliedSearch] = useState("");
  const [filterPublished, setFilterPublished] = useState<"all" | "published" | "draft">("all");
  const [filterCategory, setFilterCategory] = useState<number | "all">("all");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  // ── Bulk selection state ──
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState<"publish" | "unpublish" | null>(null);

  const totalPages = Math.max(1, Math.ceil(totalCount / ITEMS_PER_PAGE));

  const load = useCallback(async (targetPage = page, publishedFilter = filterPublished, categoryFilter = filterCategory, searchTerm = appliedSearch) => {
    setLoading(true);
    try {
      const offset = (targetPage - 1) * ITEMS_PER_PAGE;
      const params: { limit: number; offset: number; is_published?: boolean; category_id?: number; search?: string } = {
        limit: ITEMS_PER_PAGE,
        offset,
      };
      if (publishedFilter === "published") params.is_published = true;
      else if (publishedFilter === "draft") params.is_published = false;
      if (categoryFilter !== "all") params.category_id = categoryFilter;
      if (searchTerm) params.search = searchTerm;
      const [arts, cats] = await Promise.all([
        articles.list(params),
        categories.list({ limit: 20, offset: 0 }),
      ]);
      setList(arts.data);
      setTotalCount(arts.total_count);
      setCatList(cats.data);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, [page, filterPublished, filterCategory, appliedSearch]);

  useEffect(() => { load(page, filterPublished, filterCategory, appliedSearch); }, [page, filterPublished, filterCategory, appliedSearch]);

  // Searching happens on the server across every page of results, so hold the
  // request back until typing pauses and start again from the first page.
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedSearch(search.trim());
      setPage(1);
      setSelected(new Set());
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const goToPage = (p: number) => {
    if (p < 1 || p > totalPages) return;
    setSelected(new Set());
    setPage(p);
  };

  /** Build an array of page numbers with ellipses for the pagination bar. */
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

  const handleDelete = async (id: number) => {
    try { await articles.delete(id); setSelected(s => { const n = new Set(s); n.delete(id); return n; }); load(page); } catch (e: any) { setError(e.message); }
    setDeleteTarget(null);
  };

  // ── Bulk actions ──
  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === list.length && list.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(list.map(a => a.id)));
    }
  };

  const handleBulkPublish = async (isPublished: boolean) => {
    setBulkBusy(true);
    try {
      await articles.bulkPublish(Array.from(selected), isPublished);
      setSelected(new Set());
      load(page);
    } catch (e: any) { setError(e.message); }
    setBulkBusy(false);
    setBulkConfirm(null);
  };

  const catName = (id: number) => catList.find(c => c.id === id)?.name ?? id;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Articles</h1>
          <p className="page-sub">Manage news articles</p>
        </div>
        <Link href="/admin/articles/new" className="btn btn-primary">+ New Article</Link>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="search-bar">
        <input placeholder="Search title, summary or content…" value={search} onChange={e => setSearch(e.target.value)} />
        <select
          value={filterCategory === "all" ? "" : String(filterCategory)}
          onChange={e => { setFilterCategory(e.target.value === "" ? "all" : Number(e.target.value)); setPage(1); }}
          style={{ width: "auto", minWidth: 160, maxWidth: 200 }}
        >
          <option value="">All Categories</option>
          {catList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="tabs" style={{ marginBottom: 0 }}>
          {(["all", "published", "draft"] as const).map(f => (
            <button key={f} className={`tab ${filterPublished === f ? "active" : ""}`} onClick={() => { setFilterPublished(f); setPage(1); }}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 48 }}><div className="loader-ring" style={{ margin: "0 auto" }} /></div>
      ) : list.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">📰</div><p>{appliedSearch ? `No articles match “${appliedSearch}”.` : "No articles found."}</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 40, textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={list.length > 0 && selected.size === list.length}
                    ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < list.length; }}
                    onChange={toggleSelectAll}
                    style={{ width: "auto", cursor: "pointer" }}
                    title="Select all"
                  />
                </th>
                <th>ID</th><th>Title</th><th>Category</th><th>Images</th><th>Status</th><th>Featured</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map(a => (
                <tr key={a.id} className={selected.has(a.id) ? "row-selected" : ""}>
                  <td style={{ textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={selected.has(a.id)}
                      onChange={() => toggleSelect(a.id)}
                      style={{ width: "auto", cursor: "pointer" }}
                    />
                  </td>
                  <td><span className="perm-code">{a.id}</span></td>
                  <td style={{ maxWidth: 280, fontWeight: 500 }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</div>
                    {a.summary && <div style={{ fontSize: "0.75rem", color: "var(--text2)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.summary}</div>}
                  </td>
                  <td><span className="badge badge-blue">{catName(a.category_id)}</span></td>
                  <td>
                    <div className="row-media">
                      {a.cover_image_url
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img className="row-thumb" src={a.cover_image_url} alt="" />
                        : <span className="row-thumb row-thumb-empty">—</span>}
                      {(a.images?.length ?? 0) > 1 && (
                        <span className="badge badge-blue">+{a.images.length - 1}</span>
                      )}
                    </div>
                  </td>
                  <td><span className={`badge ${a.is_published ? "badge-green" : "badge-yellow"}`}>{a.is_published ? "Published" : "Draft"}</span></td>
                  <td>{a.is_featured ? <span className="badge badge-yellow">⭐ Featured</span> : <span style={{ color: "var(--text2)" }}>—</span>}</td>
                  <td>
                    <div className="td-actions">
                      <Link href={`/admin/articles/${a.id}/edit`} className="btn btn-ghost btn-sm">Edit</Link>
                      <button className="btn btn-danger btn-sm" onClick={() => setDeleteTarget({ id: a.id, title: a.title })}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination bar ── */}
      {!loading && totalCount > 0 && list.length > 0 && (
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

      {deleteTarget && (
        <ConfirmModal
          title="Delete Article"
          message={`Are you sure you want to delete "${deleteTarget.title}"? This cannot be undone.`}
          confirmLabel="Delete Article"
          onConfirm={() => handleDelete(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* ── Bulk action bar ── */}
      {selected.size > 0 && (
        <div className="bulk-bar">
          <div className="bulk-bar-inner">
            <span className="bulk-count">{selected.size} selected</span>
            <div className="bulk-actions">
              <button
                className="btn btn-sm"
                style={{ background: "var(--green)", color: "#fff", border: "none" }}
                onClick={() => setBulkConfirm("publish")}
                disabled={bulkBusy}
              >
                ✓ Publish
              </button>
              <button
                className="btn btn-sm"
                style={{ background: "var(--yellow)", color: "#000", border: "none" }}
                onClick={() => setBulkConfirm("unpublish")}
                disabled={bulkBusy}
              >
                ✗ Unpublish
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setSelected(new Set())}
                disabled={bulkBusy}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk confirm modal ── */}
      {bulkConfirm && (
        <ConfirmModal
          title={bulkConfirm === "publish" ? "Publish Articles" : "Unpublish Articles"}
          message={`Are you sure you want to ${bulkConfirm} ${selected.size} article(s)?`}
          confirmLabel={bulkConfirm === "publish" ? "Publish All" : "Unpublish All"}
          onConfirm={() => handleBulkPublish(bulkConfirm === "publish")}
          onCancel={() => setBulkConfirm(null)}
        />
      )}
    </div>
  );
}
