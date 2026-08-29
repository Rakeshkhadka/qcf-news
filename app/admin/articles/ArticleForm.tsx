"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { articles, categories, Category } from "../../../lib/admin-api";
import ImageUploader, { GalleryImage } from "../components/ImageUploader";
import RichTextEditor from "../components/RichTextEditor";
import { stripHtml } from "../../../lib/sanitize";

interface FormState {
  title: string; slug: string; summary: string; content: string;
  cover_image_url: string; images: GalleryImage[];
  is_published: boolean; is_featured: boolean; category_id: string;
}

const EMPTY_FORM: FormState = {
  title: "", slug: "", summary: "", content: "",
  cover_image_url: "", images: [], is_published: false, is_featured: false, category_id: "",
};

const toSlug = (s: string) => s.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

type EditorTab = "details" | "content";

interface Props {
  mode: "create" | "edit";
  /** Required in edit mode — the article being changed. */
  articleId?: number;
}

export default function ArticleForm({ mode, articleId }: Props) {
  const router = useRouter();
  const [catList, setCatList] = useState<Category[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [contentBusy, setContentBusy] = useState(false);
  // Set on the first edit so leaving the page can warn about unsaved work.
  const [dirty, setDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<EditorTab>("details");

  // Either uploader having work in flight is enough to hold back the save.
  const uploading = galleryBusy || contentBusy;

  const update = useCallback((patch: Partial<FormState> | ((f: FormState) => FormState)) => {
    setDirty(true);
    setForm(f => (typeof patch === "function" ? patch(f) : { ...f, ...patch }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [cats, art] = await Promise.all([
          categories.list({ limit: 20, offset: 0 }),
          mode === "edit" && articleId ? articles.get(articleId) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setCatList(cats.data);
        if (art) {
          const gallery: GalleryImage[] = (art.images ?? [])
            .slice()
            .sort((a, b) => a.sort_order - b.sort_order)
            .map(img => ({
              image_url: img.image_url,
              caption: img.caption ?? "",
              alt_text: img.alt_text ?? "",
            }));
          // An older article may have a cover that predates the gallery — keep
          // it visible by folding it in as the first slide.
          if (art.cover_image_url && !gallery.some(g => g.image_url === art.cover_image_url)) {
            gallery.unshift({ image_url: art.cover_image_url, caption: "", alt_text: "" });
          }
          setForm({
            title: art.title, slug: art.slug, summary: art.summary ?? "",
            content: art.content, cover_image_url: art.cover_image_url ?? "",
            images: gallery,
            is_published: art.is_published, is_featured: art.is_featured,
            category_id: String(art.category_id),
          });
        } else if (cats.data.length > 0) {
          setForm({ ...EMPTY_FORM, category_id: String(cats.data[0].id) });
        }
        setDirty(false);
      } catch (e: any) {
        if (!cancelled) setLoadError(e.message);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [mode, articleId]);

  // A full page can be navigated away from by the browser itself, which the
  // modal never had to worry about.
  useEffect(() => {
    if (!dirty || saving) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saving]);

  const handleSave = async () => {
    if (!form.title.trim()) { setFormError("Title is required"); setActiveTab("details"); return; }
    if (!form.slug.trim()) { setFormError("Slug is required"); setActiveTab("details"); return; }
    const hasBody = stripHtml(form.content) !== "" || /<img\b/i.test(form.content);
    if (!hasBody) { setFormError("Content is required"); setActiveTab("content"); return; }
    if (!form.category_id) { setFormError("Category is required"); setActiveTab("details"); return; }
    setSaving(true); setFormError("");
    // The cover defaults to the first slide when none was starred explicitly.
    const cover = form.cover_image_url || form.images[0]?.image_url || "";
    const payload = {
      title: form.title, slug: form.slug, summary: form.summary || undefined,
      content: form.content, cover_image_url: cover || undefined,
      images: form.images.map((img, i) => ({
        image_url: img.image_url,
        caption: img.caption || undefined,
        alt_text: img.alt_text || undefined,
        sort_order: i,
      })),
      is_published: form.is_published, is_featured: form.is_featured,
      category_id: Number(form.category_id),
    };
    try {
      if (mode === "create") await articles.create(payload);
      else if (articleId) await articles.update(articleId, payload);
      setDirty(false);
      router.push("/admin/articles");
    } catch (e: any) {
      setFormError(e.message);
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: "center", padding: 48 }}><div className="loader-ring" style={{ margin: "0 auto" }} /></div>;
  }

  if (loadError) {
    return (
      <div>
        <div className="error-box">{loadError}</div>
        <Link href="/admin/articles" className="btn btn-ghost">← Back to Articles</Link>
      </div>
    );
  }

  const saveLabel = saving ? "Saving…" : uploading ? "Uploading images…" : mode === "create" ? "Create Article" : "Save Changes";

  const contentHasText = stripHtml(form.content) !== "" || /<img\b/i.test(form.content);

  return (
    <div>
      <div className="page-header">
        <div>
          <Link href="/admin/articles" className="back-link">← Articles</Link>
          <h1 className="page-title">{mode === "create" ? "New Article" : "Edit Article"}</h1>
          <p className="page-sub">{mode === "create" ? "Write and publish a new story" : form.title || "Update this story"}</p>
        </div>
        <div className="td-actions">
          <Link href="/admin/articles" className="btn btn-ghost">Cancel</Link>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || uploading} title={uploading ? "Waiting for images to finish uploading" : undefined}>{saveLabel}</button>
        </div>
      </div>

      {formError && <div className="error-box">{formError}</div>}

      {/* ── Tab bar ── */}
      <div className="editor-tabs">
        <button
          className={`editor-tab ${activeTab === "details" ? "active" : ""}`}
          onClick={() => setActiveTab("details")}
        >
          <span className="editor-tab-icon">📝</span>
          Details
        </button>
        <button
          className={`editor-tab ${activeTab === "content" ? "active" : ""}`}
          onClick={() => setActiveTab("content")}
        >
          <span className="editor-tab-icon">✍️</span>
          Content
          {contentHasText && <span className="editor-tab-dot" title="Has content" />}
        </button>
      </div>

      {/* ── Details tab ── */}
      {activeTab === "details" && (
        <div className="editor-layout">
          {/* ── Main column ── */}
          <div className="editor-main">
            <div className="card">
              <div className="form-group">
                <label>Title</label>
                <input value={form.title} onChange={e => {
                  const title = e.target.value;
                  update(f => ({ ...f, title, slug: mode === "create" ? toSlug(title) : f.slug }));
                }} placeholder="Article title" />
              </div>
              <div className="form-group">
                <label>Slug</label>
                <input value={form.slug} onChange={e => update({ slug: e.target.value })} placeholder="article-slug" />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Summary</label>
                <input value={form.summary} onChange={e => update({ summary: e.target.value })} placeholder="Short description" />
              </div>
            </div>

            <div className="card">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Images</label>
                <ImageUploader
                  images={form.images}
                  onChange={imgs => update({ images: imgs })}
                  coverUrl={form.cover_image_url}
                  onCoverChange={url => update({ cover_image_url: url })}
                  onBusyChange={setGalleryBusy}
                />
              </div>
            </div>
          </div>

          {/* ── Side column ── */}
          <aside className="editor-side">
            <div className="card">
              <div className="form-group">
                <label>Category</label>
                <select value={form.category_id} onChange={e => update({ category_id: e.target.value })}>
                  <option value="">Select category</option>
                  {catList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Visibility</label>
                <div className="checkbox-item" style={{ marginBottom: 8 }}>
                  <input type="checkbox" id="is_published" checked={form.is_published} onChange={e => update({ is_published: e.target.checked })} style={{ width: "auto" }} />
                  <label htmlFor="is_published" className="checkbox-label">Published</label>
                </div>
                <div className="checkbox-item">
                  <input type="checkbox" id="is_featured" checked={form.is_featured} onChange={e => update({ is_featured: e.target.checked })} style={{ width: "auto" }} />
                  <label htmlFor="is_featured" className="checkbox-label">Featured</label>
                </div>
              </div>
            </div>

            <div className="card editor-save-card">
              <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={handleSave} disabled={saving || uploading} title={uploading ? "Waiting for images to finish uploading" : undefined}>{saveLabel}</button>
              <Link href="/admin/articles" className="btn btn-ghost" style={{ width: "100%", justifyContent: "center" }}>Cancel</Link>
            </div>
          </aside>
        </div>
      )}

      {/* ── Content tab ── */}
      {activeTab === "content" && (
        <div className="editor-content-tab">
          <RichTextEditor
            value={form.content}
            onChange={content => update({ content })}
            onBusyChange={setContentBusy}
            placeholder="Write the story… drop an image straight into the text to place it."
            minHeight={460}
            allowFullscreen
          />
        </div>
      )}
    </div>
  );
}
