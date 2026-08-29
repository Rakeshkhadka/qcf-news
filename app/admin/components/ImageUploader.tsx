"use client";
import { useEffect, useRef, useState } from "react";
import { mediaUrl, uploads } from "../../../lib/admin-api";

export interface GalleryImage {
  image_url: string;
  caption: string;
  alt_text: string;
}

/** A file being uploaded: previewed from the local blob until the URL comes back. */
interface Pending {
  id: number;
  file: File;
  previewUrl: string;
  status: "uploading" | "error";
  error?: string;
}

interface Props {
  images: GalleryImage[];
  onChange: (images: GalleryImage[]) => void;
  /** URL of the image used as the cover; empty means "first in the gallery". */
  coverUrl: string;
  onCoverChange: (url: string) => void;
  /** Lets the parent block saving while uploads are still in flight. */
  onBusyChange?: (busy: boolean) => void;
  max?: number;
}

const ACCEPT = "image/jpeg,image/png,image/gif,image/webp,image/avif";

let pendingId = 0;

export default function ImageUploader({
  images,
  onChange,
  coverUrl,
  onCoverChange,
  onBusyChange,
  max = 20,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [urlDraft, setUrlDraft] = useState("");

  // The parent holds `images`, so read the latest value inside async loops.
  const imagesRef = useRef(images);
  imagesRef.current = images;

  // Mirrored for the unmount cleanup below, which must not close over a
  // stale render's queue.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const uploading = pending.some((item) => item.status === "uploading");
  useEffect(() => { onBusyChange?.(uploading); }, [onBusyChange, uploading]);

  // Blob previews stay in memory until revoked — release any still-queued
  // ones when the modal closes.
  useEffect(
    () => () => pendingRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl)),
    []
  );

  const effectiveCover = coverUrl || images[0]?.image_url || "";
  const total = images.length + pending.length;

  const appendImage = (image: GalleryImage) => {
    const current = imagesRef.current;
    if (current.some((existing) => existing.image_url === image.image_url)) return;
    const next = [...current, image];
    imagesRef.current = next;
    onChange(next);
  };

  /**
   * Upload files one at a time. Each request carries a single file, so one bad
   * image fails on its own tile instead of taking the whole batch down with it.
   */
  const uploadOne = async (item: Pending) => {
    try {
      const [uploaded] = await uploads.images([item.file]);
      if (!uploaded) throw new Error("Upload returned no file");
      appendImage({ image_url: uploaded.url, caption: "", alt_text: "" });
      URL.revokeObjectURL(item.previewUrl);
      setPending((queue) => queue.filter((entry) => entry.id !== item.id));
    } catch (e: any) {
      setPending((queue) =>
        queue.map((entry) =>
          entry.id === item.id
            ? { ...entry, status: "error", error: e.message ?? "Upload failed" }
            : entry
        )
      );
    }
  };

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;

    const room = max - total;
    if (room <= 0) {
      setError(`You can attach at most ${max} images.`);
      return;
    }
    setError(
      list.length > room ? `Only the first ${room} image(s) were queued (limit ${max}).` : ""
    );

    const queued: Pending[] = list.slice(0, room).map((file) => ({
      id: (pendingId += 1),
      file,
      previewUrl: URL.createObjectURL(file),
      status: "uploading",
    }));
    setPending((queue) => [...queue, ...queued]);
    if (inputRef.current) inputRef.current.value = "";

    for (const item of queued) {
      // Sequential: uploads land in the order they were chosen.
      await uploadOne(item);
    }
  };

  const retry = (item: Pending) => {
    setPending((queue) =>
      queue.map((entry) =>
        entry.id === item.id ? { ...entry, status: "uploading", error: undefined } : entry
      )
    );
    uploadOne({ ...item, status: "uploading" });
  };

  const discardPending = (item: Pending) => {
    URL.revokeObjectURL(item.previewUrl);
    setPending((queue) => queue.filter((entry) => entry.id !== item.id));
  };

  const removeAt = (idx: number) => {
    const removed = images[idx];
    const next = images.filter((_, i) => i !== idx);
    imagesRef.current = next;
    onChange(next);
    // Don't leave the cover pointing at an image that is no longer attached.
    if (coverUrl && coverUrl === removed.image_url) onCoverChange("");
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= images.length || from === to) return;
    const next = [...images];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    imagesRef.current = next;
    onChange(next);
  };

  const patchAt = (idx: number, patch: Partial<GalleryImage>) =>
    onChange(images.map((img, i) => (i === idx ? { ...img, ...patch } : img)));

  const addUrl = () => {
    const url = urlDraft.trim();
    if (!url) return;
    if (total >= max) {
      setError(`You can attach at most ${max} images.`);
      return;
    }
    appendImage({ image_url: url, caption: "", alt_text: "" });
    setUrlDraft("");
  };

  return (
    <div className="uploader">
      <div
        className={`dropzone ${dragOver ? "over" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
        <div className="dropzone-icon">🖼️</div>
        <p>
          <b>Click to choose images</b> or drag &amp; drop them here
        </p>
        <span>
          JPG, PNG, GIF, WebP or AVIF · up to {max} images · {images.length} attached
          {pending.length > 0 && ` · ${pending.length} in progress`}
        </span>
      </div>

      <div className="url-add">
        <input
          value={urlDraft}
          placeholder="…or paste an image URL"
          onChange={(e) => setUrlDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); addUrl(); }
          }}
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={addUrl}>
          Add URL
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      {(images.length > 0 || pending.length > 0) && (
        <>
          <div className="thumb-grid">
            {images.map((img, idx) => {
              const isCover = img.image_url === effectiveCover;
              return (
                <div
                  key={`${img.image_url}-${idx}`}
                  className={`thumb ${isCover ? "is-cover" : ""} ${dragIndex === idx ? "dragging" : ""}`}
                  draggable
                  onDragStart={() => setDragIndex(idx)}
                  onDragEnd={() => setDragIndex(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex !== null) move(dragIndex, idx);
                    setDragIndex(null);
                  }}
                >
                  <div className="thumb-media">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={mediaUrl(img.image_url)} alt={img.alt_text || img.caption || ""} />
                    <span className="thumb-order">{idx + 1}</span>
                    {isCover && <span className="thumb-cover-flag">Cover</span>}
                    <button
                      type="button"
                      className="thumb-remove"
                      title="Remove image"
                      onClick={() => removeAt(idx)}
                    >
                      ×
                    </button>
                  </div>
                  <input
                    className="thumb-caption"
                    value={img.caption}
                    placeholder="Caption (optional)"
                    onChange={(e) => patchAt(idx, { caption: e.target.value })}
                  />
                  <input
                    className="thumb-caption"
                    value={img.alt_text}
                    placeholder="Alt text (optional)"
                    onChange={(e) => patchAt(idx, { alt_text: e.target.value })}
                  />
                  <div className="thumb-actions">
                    <button type="button" title="Move left" disabled={idx === 0} onClick={() => move(idx, idx - 1)}>
                      ←
                    </button>
                    <button
                      type="button"
                      className={isCover ? "active" : ""}
                      title="Use as cover image"
                      onClick={() => onCoverChange(img.image_url)}
                    >
                      ★ Cover
                    </button>
                    <button
                      type="button"
                      title="Move right"
                      disabled={idx === images.length - 1}
                      onClick={() => move(idx, idx + 1)}
                    >
                      →
                    </button>
                  </div>
                </div>
              );
            })}

            {pending.map((item) => (
              <div className={`thumb is-pending ${item.status}`} key={`pending-${item.id}`}>
                <div className="thumb-media">
                  {/* Local blob preview — visible the instant the file is picked. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.previewUrl} alt={item.file.name} />
                  <div className="thumb-overlay">
                    {item.status === "uploading" ? (
                      <>
                        <div className="loader-ring" />
                        <span>Uploading…</span>
                      </>
                    ) : (
                      <span className="thumb-failed">Upload failed</span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="thumb-remove"
                    title="Cancel"
                    onClick={() => discardPending(item)}
                  >
                    ×
                  </button>
                </div>
                <p className="thumb-filename" title={item.file.name}>
                  {item.file.name}
                </p>
                {item.status === "error" && (
                  <>
                    <p className="thumb-error">{item.error}</p>
                    <div className="thumb-actions">
                      <button type="button" onClick={() => retry(item)}>
                        Retry
                      </button>
                      <button type="button" onClick={() => discardPending(item)}>
                        Discard
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
          <p className="uploader-hint">
            Images upload one at a time — a failure only affects its own tile. Drag
            thumbnails to reorder; that is the order the carousel plays in. The cover is
            the first image unless you star another one.
          </p>
        </>
      )}
    </div>
  );
}
