"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { mediaUrl, uploads } from "../../../lib/admin-api";
import { sanitizeHtml, stripHtml } from "../../../lib/sanitize";

/**
 * WYSIWYG editor for article bodies.
 *
 * Built on `contentEditable` + `document.execCommand` rather than a third-party
 * editor so the admin keeps its zero-dependency footprint. The value handed to
 * the parent is always sanitised HTML (see `lib/sanitize.ts`), which is the
 * same allowlist the backend enforces on save and the public article page
 * applies on render.
 *
 * Images are uploaded to `/uploads/images` the moment they are dropped, pasted
 * or picked; a local blob preview stands in until the URL comes back, so the
 * writer never waits on a round trip to keep typing.
 */

interface Props {
  value: string;
  onChange: (html: string) => void;
  /** Lets the parent block saving while inline images are still uploading. */
  onBusyChange?: (busy: boolean) => void;
  placeholder?: string;
  minHeight?: number;
  /** Show a fullscreen toggle button in the toolbar. */
  allowFullscreen?: boolean;
}

type Align = "left" | "center" | "right" | "wide";

const BLOCKS: { label: string; tag: string }[] = [
  { label: "Paragraph", tag: "p" },
  { label: "Heading", tag: "h2" },
  { label: "Subheading", tag: "h3" },
  { label: "Small heading", tag: "h4" },
  { label: "Quote", tag: "blockquote" },
  { label: "Code block", tag: "pre" },
];

const INLINE: { command: string; label: string; title: string }[] = [
  { command: "bold", label: "B", title: "Bold (Ctrl+B)" },
  { command: "italic", label: "I", title: "Italic (Ctrl+I)" },
  { command: "underline", label: "U", title: "Underline (Ctrl+U)" },
  { command: "strikeThrough", label: "S", title: "Strikethrough" },
];

const ALIGNMENTS: { value: Align; label: string; title: string }[] = [
  { value: "left", label: "◧", title: "Float left" },
  { value: "center", label: "▣", title: "Centred" },
  { value: "right", label: "◨", title: "Float right" },
  { value: "wide", label: "▭", title: "Full width" },
];

const ACCEPT = "image/jpeg,image/png,image/gif,image/webp,image/avif";
const EMPTY_PARAGRAPH = "<p><br></p>";

let uploadId = 0;

export default function RichTextEditor({
  value,
  onChange,
  onBusyChange,
  placeholder = "Write the story…",
  minHeight = 280,
  allowFullscreen = false,
}: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Last value this component produced — guards against caret-resetting syncs. */
  const emitted = useRef(value);
  /** False until the surface has been seeded with `value`. */
  const loaded = useRef(false);
  const savedRange = useRef<Range | null>(null);

  const [showSource, setShowSource] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const [error, setError] = useState("");
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const [figure, setFigure] = useState<HTMLElement | null>(null);
  /** Bumped after mutating the selected figure — its identity does not change,
   *  so nothing else would tell React the image toolbar needs redrawing. */
  const [figureRevision, setFigureRevision] = useState(0);
  const [altDraft, setAltDraft] = useState("");
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [block, setBlock] = useState("p");
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Exit fullscreen on Escape
  useEffect(() => {
    if (!isFullscreen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isFullscreen]);

  // Lock body scroll when fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [isFullscreen]);

  useEffect(() => { onBusyChange?.(uploadCount > 0); }, [onBusyChange, uploadCount]);

  // ── Value plumbing ──────────────────────────────────────────────────────

  /**
   * The editor's current content, cleaned up for storage: `<div>` line breaks
   * (what Safari inserts on Enter) become paragraphs, in-flight upload
   * placeholders are left out, and the whole thing goes through the allowlist.
   */
  const currentHtml = useCallback((): string => {
    const el = editorRef.current;
    if (!el) return "";
    const clone = el.cloneNode(true) as HTMLElement;

    clone.querySelectorAll("div").forEach((div) => {
      const paragraph = document.createElement("p");
      while (div.firstChild) paragraph.appendChild(div.firstChild);
      div.replaceWith(paragraph);
    });
    clone.querySelectorAll("[data-rte-upload]").forEach((node) => node.remove());
    clone.querySelectorAll(".rte-selected").forEach((node) => node.classList.remove("rte-selected"));

    const html = sanitizeHtml(clone.innerHTML);
    // An "empty" editor still holds a bare paragraph; don't save that as content.
    return stripHtml(html) === "" && !/<img\b/i.test(html) ? "" : html;
  }, []);

  const emit = useCallback(() => {
    const html = currentHtml();
    emitted.current = html;
    onChange(html);
  }, [currentHtml, onChange]);

  // Push the parent's value in only when it did not come from us, so typing
  // never rewrites the DOM under the caret.
  useEffect(() => {
    const el = editorRef.current;
    if (showSource) {
      loaded.current = false; // the surface unmounts; reload it on the way back
      return;
    }
    if (!el) return;
    if (loaded.current && value === emitted.current) return;
    el.innerHTML = value || EMPTY_PARAGRAPH;
    emitted.current = value;
    loaded.current = true;
  }, [value, showSource]);

  // Semantic tags (<b>, <i>) instead of inline styles, and <p> on Enter.
  const applyEditingDefaults = useCallback(() => {
    try {
      document.execCommand("styleWithCSS", false, "false");
      document.execCommand("defaultParagraphSeparator", false, "p");
    } catch {
      // Not supported everywhere; the sanitiser cleans up either way.
    }
  }, []);

  // ── Selection ───────────────────────────────────────────────────────────

  const saveSelection = useCallback(() => {
    const selection = window.getSelection();
    const el = editorRef.current;
    if (!el || !selection || selection.rangeCount === 0) return;
    if (!el.contains(selection.anchorNode)) return;
    savedRange.current = selection.getRangeAt(0).cloneRange();
  }, []);

  const restoreSelection = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const range = savedRange.current;
    if (!range || !el.contains(range.commonAncestorContainer)) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, []);

  const refreshState = useCallback(() => {
    if (typeof document === "undefined") return;
    const state: Record<string, boolean> = {};
    for (const { command } of INLINE) {
      try { state[command] = document.queryCommandState(command); } catch { /* ignore */ }
    }
    try {
      state.insertUnorderedList = document.queryCommandState("insertUnorderedList");
      state.insertOrderedList = document.queryCommandState("insertOrderedList");
      const current = document.queryCommandValue("formatBlock").toLowerCase();
      setBlock(BLOCKS.some((b) => b.tag === current) ? current : "p");
    } catch {
      /* queryCommand* is unavailable in some engines — the toolbar just won't light up. */
    }
    setActive(state);
  }, []);

  const exec = useCallback(
    (command: string, commandValue?: string) => {
      restoreSelection();
      applyEditingDefaults();
      document.execCommand(command, false, commandValue);
      saveSelection();
      emit();
      refreshState();
    },
    [applyEditingDefaults, emit, refreshState, restoreSelection, saveSelection]
  );

  const insertHtml = useCallback(
    (html: string) => {
      const el = editorRef.current;
      if (!el) return;
      restoreSelection();
      const inserted = document.execCommand("insertHTML", false, html);
      if (!inserted) el.insertAdjacentHTML("beforeend", html);
      saveSelection();
    },
    [restoreSelection, saveSelection]
  );

  // ── Images ──────────────────────────────────────────────────────────────

  const insertImages = useCallback(
    async (files: File[]) => {
      const images = files.filter((file) => file.type.startsWith("image/"));
      if (images.length === 0) return;
      setError("");

      for (const file of images) {
        const id = String((uploadId += 1));
        const preview = URL.createObjectURL(file);
        // The placeholder is real DOM so the writer keeps their place in the
        // text; it carries `data-rte-upload` and is therefore excluded from
        // the emitted value until the upload lands.
        insertHtml(
          `<figure class="rte-figure rte-align-center" data-rte-upload="${id}">` +
            `<img src="${preview}" alt="">` +
            `<figcaption class="rte-uploading">Uploading ${escapeHtml(file.name)}…</figcaption>` +
            `</figure><p><br></p>`
        );
        setUploadCount((count) => count + 1);

        try {
          const [uploaded] = await uploads.images([file]);
          if (!uploaded) throw new Error("Upload returned no file");
          const node = editorRef.current?.querySelector<HTMLElement>(
            `[data-rte-upload="${id}"]`
          );
          if (node) {
            const img = node.querySelector("img");
            if (img) {
              img.src = mediaUrl(uploaded.url);
              img.setAttribute("loading", "lazy");
            }
            node.removeAttribute("data-rte-upload");
            node.querySelector("figcaption")?.remove();
          }
          emit();
        } catch (e: any) {
          editorRef.current?.querySelector(`[data-rte-upload="${id}"]`)?.remove();
          setError(`${file.name}: ${e.message ?? "Upload failed"}`);
          emit();
        } finally {
          URL.revokeObjectURL(preview);
          setUploadCount((count) => count - 1);
        }
      }
    },
    [emit, insertHtml]
  );

  const selectFigure = useCallback((node: HTMLElement | null) => {
    editorRef.current
      ?.querySelectorAll(".rte-selected")
      .forEach((el) => el.classList.remove("rte-selected"));
    node?.classList.add("rte-selected");
    setFigure(node);
    setAltDraft(node?.querySelector("img")?.getAttribute("alt") ?? "");
  }, []);

  const setAlign = (align: Align) => {
    if (!figure) return;
    figure.className = `rte-figure rte-align-${align} rte-selected`;
    emit();
    setFigureRevision((revision) => revision + 1);
  };

  const alignOf = (node: HTMLElement | null): Align => {
    const match = node?.className.match(/rte-align-(left|center|right|wide)/);
    return (match?.[1] as Align) ?? "center";
  };

  const toggleCaption = () => {
    if (!figure) return;
    const caption = figure.querySelector("figcaption");
    if (caption) {
      caption.remove();
    } else {
      const node = document.createElement("figcaption");
      node.textContent = "Add a caption";
      figure.appendChild(node);
    }
    emit();
    setFigureRevision((revision) => revision + 1);
  };

  const removeFigure = () => {
    if (!figure) return;
    figure.remove();
    selectFigure(null);
    emit();
  };

  const applyAlt = (text: string) => {
    setAltDraft(text);
    figure?.querySelector("img")?.setAttribute("alt", text);
    emit();
  };

  // ── Links ───────────────────────────────────────────────────────────────

  const openLinkEditor = () => {
    saveSelection();
    const anchor = anchorInSelection();
    setLinkDraft(anchor?.getAttribute("href") ?? "https://");
  };

  const applyLink = () => {
    const url = (linkDraft ?? "").trim();
    setLinkDraft(null);
    if (!url || url === "https://") return;
    exec("createLink", url);
    // execCommand cannot set attributes; do it on the anchor it just made.
    const anchor = anchorInSelection();
    if (anchor && /^https?:/i.test(url)) {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
      emit();
    }
  };

  // ── Events ──────────────────────────────────────────────────────────────

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.files ?? []);
    if (files.some((file) => file.type.startsWith("image/"))) {
      event.preventDefault();
      insertImages(files);
      return;
    }
    // Pasted markup goes through the allowlist before it reaches the document,
    // so Word/Google-Docs styling and stray scripts never get in.
    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");
    if (!html && !text) return;
    event.preventDefault();
    insertHtml(
      html
        ? sanitizeHtml(html)
        : text
            .split(/\n{2,}/)
            .map((line) => `<p>${escapeHtml(line.trim())}</p>`)
            .join("")
    );
    emit();
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    const files = Array.from(event.dataTransfer.files ?? []);
    setDragOver(false);
    if (files.length === 0) return;
    event.preventDefault();
    // Drop lands wherever the pointer is, not where the caret was.
    const range = caretFromPoint(event.clientX, event.clientY);
    if (range) {
      savedRange.current = range;
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    insertImages(files);
  };

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    selectFigure(target.closest("figure"));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openLinkEditor();
    }
    if (figure && (event.key === "Delete" || event.key === "Backspace")) {
      const selection = window.getSelection();
      if (selection?.isCollapsed && figure.contains(selection.anchorNode) === false) {
        event.preventDefault();
        removeFigure();
      }
    }
  };

  const words = stripHtml(value).split(/\s+/).filter(Boolean).length;
  const isEmpty = !value || (stripHtml(value) === "" && !/<img\b/i.test(value));

  const fullscreenMinHeight = isFullscreen ? undefined : minHeight;

  return (
    <div className={`rte ${dragOver ? "over" : ""}${isFullscreen ? " rte-fullscreen" : ""}`}>
      <div className="rte-toolbar">
        <select
          value={block}
          title="Paragraph style"
          onChange={(e) => exec("formatBlock", `<${e.target.value}>`)}
          disabled={showSource}
        >
          {BLOCKS.map((option) => (
            <option key={option.tag} value={option.tag}>{option.label}</option>
          ))}
        </select>

        <span className="rte-sep" />

        {INLINE.map((button) => (
          <button
            key={button.command}
            type="button"
            title={button.title}
            className={`rte-btn rte-${button.command} ${active[button.command] ? "active" : ""}`}
            disabled={showSource}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec(button.command)}
          >
            {button.label}
          </button>
        ))}

        <span className="rte-sep" />

        <button type="button" title="Bulleted list" disabled={showSource}
          className={`rte-btn ${active.insertUnorderedList ? "active" : ""}`}
          onMouseDown={(e) => e.preventDefault()} onClick={() => exec("insertUnorderedList")}>
          • List
        </button>
        <button type="button" title="Numbered list" disabled={showSource}
          className={`rte-btn ${active.insertOrderedList ? "active" : ""}`}
          onMouseDown={(e) => e.preventDefault()} onClick={() => exec("insertOrderedList")}>
          1. List
        </button>

        <span className="rte-sep" />

        <button type="button" className="rte-btn" title="Insert link (Ctrl+K)" disabled={showSource}
          onMouseDown={(e) => e.preventDefault()} onClick={openLinkEditor}>
          🔗
        </button>
        <button type="button" className="rte-btn" title="Remove link" disabled={showSource}
          onMouseDown={(e) => e.preventDefault()} onClick={() => exec("unlink")}>
          ⛓️‍💥
        </button>
        <button type="button" className="rte-btn rte-btn-accent" title="Insert image" disabled={showSource}
          onMouseDown={(e) => e.preventDefault()} onClick={() => fileRef.current?.click()}>
          🖼️ Image
        </button>
        <button type="button" className="rte-btn" title="Horizontal rule" disabled={showSource}
          onMouseDown={(e) => e.preventDefault()} onClick={() => exec("insertHorizontalRule")}>
          —
        </button>

        <span className="rte-sep" />

        <button type="button" className="rte-btn" title="Clear formatting" disabled={showSource}
          onMouseDown={(e) => e.preventDefault()} onClick={() => exec("removeFormat")}>
          ✕ Format
        </button>
        <button type="button" className="rte-btn" title="Undo" disabled={showSource}
          onMouseDown={(e) => e.preventDefault()} onClick={() => exec("undo")}>
          ↶
        </button>
        <button type="button" className="rte-btn" title="Redo" disabled={showSource}
          onMouseDown={(e) => e.preventDefault()} onClick={() => exec("redo")}>
          ↷
        </button>

        <button
          type="button"
          className={`rte-btn rte-source ${showSource ? "active" : ""}`}
          title="Edit HTML source"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (!showSource) emit();
            setShowSource((on) => !on);
            selectFigure(null);
          }}
        >
          {"</>"}
        </button>

        {allowFullscreen && (
          <button
            type="button"
            className={`rte-btn rte-fullscreen-btn ${isFullscreen ? "active" : ""}`}
            title={isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setIsFullscreen((on) => !on)}
          >
            {isFullscreen ? "⊗" : "⛶"}
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) insertImages(Array.from(e.target.files));
          e.target.value = "";
        }}
      />

      {linkDraft !== null && (
        <div className="rte-link-bar">
          <input
            autoFocus
            value={linkDraft}
            placeholder="https://example.com"
            onChange={(e) => setLinkDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); applyLink(); }
              if (e.key === "Escape") setLinkDraft(null);
            }}
          />
          <button type="button" className="btn btn-primary btn-sm" onClick={applyLink}>Apply</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLinkDraft(null)}>Cancel</button>
        </div>
      )}

      {figure && !showSource && (
        // Keyed on the revision so a mutated figure redraws its controls.
        <div className="rte-image-bar" key={`figure-${figureRevision}`}>
          <span className="rte-image-label">Image</span>
          {ALIGNMENTS.map((option) => (
            <button
              key={option.value}
              type="button"
              title={option.title}
              className={`rte-btn ${alignOf(figure) === option.value ? "active" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setAlign(option.value)}
            >
              {option.label}
            </button>
          ))}
          <button type="button" className="rte-btn" onMouseDown={(e) => e.preventDefault()} onClick={toggleCaption}>
            {figure.querySelector("figcaption") ? "Remove caption" : "Add caption"}
          </button>
          <input
            className="rte-alt"
            value={altDraft}
            placeholder="Alt text (for screen readers)"
            onChange={(e) => applyAlt(e.target.value)}
          />
          <button type="button" className="rte-btn rte-btn-danger" onMouseDown={(e) => e.preventDefault()} onClick={removeFigure}>
            Delete
          </button>
        </div>
      )}

      {error && <div className="error-box rte-error">{error}</div>}

      {showSource ? (
        <textarea
          className="rte-source-area"
          style={{ minHeight: fullscreenMinHeight }}
          value={value}
          spellCheck={false}
          onChange={(e) => {
            emitted.current = e.target.value;
            onChange(e.target.value);
          }}
          onBlur={(e) => {
            const cleaned = sanitizeHtml(e.target.value);
            emitted.current = cleaned;
            onChange(cleaned);
          }}
        />
      ) : (
        <div className="rte-surface">
          <div
            ref={editorRef}
            className="rte-content"
            style={{ minHeight: fullscreenMinHeight }}
            contentEditable
            suppressContentEditableWarning
            spellCheck
            role="textbox"
            aria-multiline="true"
            aria-label="Article content"
            onInput={emit}
            onBlur={emit}
            onFocus={applyEditingDefaults}
            onKeyUp={() => { saveSelection(); refreshState(); }}
            onMouseUp={() => { saveSelection(); refreshState(); }}
            onKeyDown={handleKeyDown}
            onClick={handleClick}
            onPaste={handlePaste}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          />
          {isEmpty && <div className="rte-placeholder">{placeholder}</div>}
        </div>
      )}

      <div className="rte-status">
        <span>
          {showSource
            ? "Editing raw HTML — it is filtered against the allowlist when you leave this box."
            : "Drop, paste or pick images to place them in the story. Click one to align it or add a caption."}
        </span>
        <span className="rte-count">
          {uploadCount > 0 && <b>{uploadCount} uploading… </b>}
          {words} word{words === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The `<a>` the caret currently sits in, if any. */
function anchorInSelection(): HTMLAnchorElement | null {
  const selection = window.getSelection();
  const node = selection?.anchorNode;
  if (!node) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  return element?.closest("a") ?? null;
}

/** A caret range at viewport coordinates — used to place dropped images. */
function caretFromPoint(x: number, y: number): Range | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (doc.caretRangeFromPoint) return doc.caretRangeFromPoint(x, y);
  const position = doc.caretPositionFromPoint?.(x, y);
  if (!position) return null;
  const range = document.createRange();
  range.setStart(position.offsetNode, position.offset);
  range.collapse(true);
  return range;
}
