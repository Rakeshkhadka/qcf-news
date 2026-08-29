"""
Responsive image variant generator.

At upload time, creates resized copies of every image in AVIF and WebP at
three breakpoints so the frontend can serve the smallest file the viewport
needs.  The original is always kept (JPEG/PNG/GIF fallback for legacy
browsers).

Variant filenames sit alongside the original::

    media/2026/08/hero-abc123def456.jpg          ← original
    media/2026/08/hero-abc123def456-400w.avif
    media/2026/08/hero-abc123def456-400w.webp
    media/2026/08/hero-abc123def456-800w.avif
    media/2026/08/hero-abc123def456-800w.webp
    media/2026/08/hero-abc123def456-1200w.avif
    media/2026/08/hero-abc123def456-1200w.webp
"""
from __future__ import annotations

import logging
from io import BytesIO
from pathlib import Path

from PIL import Image

logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────

#: Pixel widths for the responsive variants.  Anything wider than the
#: original is silently skipped so a 600 px photo never gets up-scaled.
VARIANT_WIDTHS: tuple[int, ...] = (400, 800, 1200)

#: Encoder settings per format.  `quality` trades file size against
#: fidelity — AVIF compresses much better than WebP at the same perceptual
#: quality, so it can use a lower number.
_ENCODERS: dict[str, dict] = {
    "avif": {"quality": 55},
    "webp": {"quality": 75, "method": 4},
}


# ── Public API ────────────────────────────────────────────────────────────────


def get_image_dimensions(data: bytes) -> tuple[int, int]:
    """Return ``(width, height)`` from the raw bytes of an image file."""
    with Image.open(BytesIO(data)) as img:
        return img.size


def generate_variants(
    data: bytes,
    original_path: str,
    media_root: Path,
) -> dict:
    """
    Write responsive variants to disk and return metadata.

    Parameters
    ----------
    data:
        The original image bytes (already validated by ``LocalImageStorage``).
    original_path:
        Relative path of the original inside *media_root*
        (e.g. ``"2026/08/hero-abc123def456.jpg"``).
    media_root:
        Absolute path to the media directory.

    Returns
    -------
    dict
        ``{ "width": int, "height": int, "variants": { "400w": {"avif": relpath, "webp": relpath}, … } }``
    """
    try:
        img = Image.open(BytesIO(data))
    except Exception:
        logger.warning("Could not open image for variant generation: %s", original_path)
        return {"width": 0, "height": 0, "variants": {}}

    original_width, original_height = img.size

    # Ensure we have an RGB(A) image — Pillow's AVIF/WebP encoders don't
    # handle palette or CMYK modes gracefully.
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA" if _has_transparency(img) else "RGB")

    stem = Path(original_path).stem          # e.g. "hero-abc123def456"
    parent = Path(original_path).parent      # e.g. "2026/08"

    variants: dict[str, dict[str, str]] = {}

    for width in VARIANT_WIDTHS:
        if width >= original_width:
            # Don't upscale — the original is already small enough.
            continue

        ratio = width / original_width
        height = round(original_height * ratio)
        resized = img.resize((width, height), Image.LANCZOS)

        bucket: dict[str, str] = {}
        for fmt, params in _ENCODERS.items():
            variant_name = f"{stem}-{width}w.{fmt}"
            variant_rel = (parent / variant_name).as_posix()
            variant_abs = media_root / variant_rel

            try:
                buf = BytesIO()
                resized.save(buf, format=fmt.upper(), **params)
                variant_abs.write_bytes(buf.getvalue())
                bucket[fmt] = variant_rel
            except Exception:
                # AVIF encoding can fail on very old Pillow builds or if the
                # platform library is missing. Log and skip — the other format
                # or the original will still work.
                logger.warning(
                    "Failed to encode %s variant for %s",
                    fmt,
                    original_path,
                    exc_info=True,
                )

        if bucket:
            variants[f"{width}w"] = bucket

    img.close()

    return {
        "width": original_width,
        "height": original_height,
        "variants": variants,
    }


def delete_variants(original_path: str, media_root: Path) -> None:
    """Remove every variant file that was generated for *original_path*."""
    stem = Path(original_path).stem
    parent = media_root / Path(original_path).parent

    if not parent.is_dir():
        return

    for width in VARIANT_WIDTHS:
        for fmt in _ENCODERS:
            variant = parent / f"{stem}-{width}w.{fmt}"
            if variant.is_file():
                variant.unlink(missing_ok=True)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _has_transparency(img: Image.Image) -> bool:
    """Check whether the image uses an alpha channel."""
    return img.mode in ("RGBA", "LA", "PA") or "transparency" in img.info
