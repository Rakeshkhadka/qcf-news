"""
Local filesystem storage for uploaded media.

Files are written under ``settings.MEDIA_ROOT`` in ``YYYY/MM`` folders and are
served back by the ``/media`` StaticFiles mount registered in ``main.py``.
The public URL is what gets persisted on the model, so swapping this class for
an S3-backed one later only changes what ``save()`` returns.
"""
import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO

from src.config.settings import settings
from src.utils.exceptions import InvalidDataException
from src.utils.image_variants import delete_variants, generate_variants

logger = logging.getLogger(__name__)

# Magic-number signatures for the image types we accept. Extension alone is
# trivially spoofable, so the bytes have to agree with it.
_IMAGE_SIGNATURES: list[tuple[bytes, str]] = [
    (b"\xff\xd8\xff", "jpg"),
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"GIF87a", "gif"),
    (b"GIF89a", "gif"),
]

_SAFE_STEM = re.compile(r"[^a-z0-9]+")


def _sniff_extension(head: bytes) -> str | None:
    """Return the image type implied by the leading bytes, if recognised."""
    for signature, ext in _IMAGE_SIGNATURES:
        if head.startswith(signature):
            return ext
    # RIFF-based containers: "RIFF....WEBP"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    # ISO-BMFF brands used by AVIF/HEIF: "....ftypavif"
    if head[4:8] == b"ftyp" and head[8:12] in (b"avif", b"avis"):
        return "avif"
    return None


def _slugify_stem(stem: str) -> str:
    slug = _SAFE_STEM.sub("-", stem.lower()).strip("-")
    return slug[:48] or "image"


class LocalImageStorage:
    """Validates and persists uploaded images on the local filesystem."""

    def __init__(
        self,
        media_root: str | None = None,
        media_url: str | None = None,
        public_base_url: str | None = None,
    ):
        self.media_root = Path(media_root or settings.MEDIA_ROOT)
        self.media_url = (media_url or settings.MEDIA_URL).rstrip("/")
        self.public_base_url = (
            public_base_url
            if public_base_url is not None
            else settings.PUBLIC_BASE_URL
        ).rstrip("/")

    # ── Public API ────────────────────────────────────────────────────────

    def save(self, fileobj: BinaryIO, filename: str | None) -> dict:
        """
        Persist one uploaded image and generate responsive variants.

        Returns ``{"url", "path", "filename", "size", "content_type",
        "width", "height", "variants"}``.
        Raises ``InvalidDataException`` when the file is empty, too large,
        or is not one of the allowed image types.
        """
        original = Path(filename or "image").name
        declared_ext = original.rsplit(".", 1)[-1].lower() if "." in original else ""

        data = self._read_limited(fileobj, original)
        sniffed_ext = _sniff_extension(data[:16])
        if sniffed_ext is None:
            raise InvalidDataException(
                detail=f"'{original}' is not a supported image file"
            )

        allowed = settings.allowed_image_extensions
        # jpg/jpeg are the same format under two names; keep whichever the
        # uploader used when it is allowed, else fall back to the sniffed one.
        ext = sniffed_ext
        if declared_ext in allowed and _same_format(declared_ext, sniffed_ext):
            ext = declared_ext
        if ext not in allowed:
            raise InvalidDataException(
                detail=(
                    f"Image type '{ext}' is not allowed. "
                    f"Allowed: {', '.join(sorted(allowed))}"
                )
            )

        now = datetime.now(timezone.utc)
        rel_dir = Path(f"{now:%Y}") / f"{now:%m}"
        target_dir = self.media_root / rel_dir
        target_dir.mkdir(parents=True, exist_ok=True)

        stem = _slugify_stem(original.rsplit(".", 1)[0])
        name = f"{stem}-{uuid.uuid4().hex[:12]}.{ext}"
        (target_dir / name).write_bytes(data)

        rel_path = (rel_dir / name).as_posix()

        # Generate AVIF/WebP variants at 400w, 800w, 1200w and read
        # intrinsic dimensions so the frontend can prevent layout shift.
        try:
            variant_meta = generate_variants(data, rel_path, self.media_root)
        except Exception:
            logger.warning(
                "Variant generation failed for %s; serving original only",
                rel_path,
                exc_info=True,
            )
            variant_meta = {"width": 0, "height": 0, "variants": {}}

        # Resolve every variant's relative path to a public URL.
        public_variants: dict[str, dict[str, str]] = {}
        for bucket_key, formats in variant_meta.get("variants", {}).items():
            public_variants[bucket_key] = {
                fmt: self.public_url(path)
                for fmt, path in formats.items()
            }

        return {
            "url": self.public_url(rel_path),
            "path": rel_path,
            "filename": original,
            "size": len(data),
            "content_type": f"image/{'jpeg' if ext in ('jpg', 'jpeg') else ext}",
            "width": variant_meta.get("width", 0),
            "height": variant_meta.get("height", 0),
            "variants": public_variants,
        }

    def public_url(self, rel_path: str) -> str:
        return f"{self.public_base_url}{self.media_url}/{rel_path.lstrip('/')}"

    def delete(self, rel_path: str) -> bool:
        """Remove a previously stored file and its variants. Returns True when a file was removed."""
        target = (self.media_root / rel_path.lstrip("/")).resolve()
        root = self.media_root.resolve()
        # Never let a crafted path escape MEDIA_ROOT.
        if not target.is_relative_to(root) or not target.is_file():
            return False
        target.unlink()
        # Clean up AVIF/WebP variants generated at upload time.
        delete_variants(rel_path, self.media_root)
        return True

    # ── Internals ─────────────────────────────────────────────────────────

    def _read_limited(self, fileobj: BinaryIO, original: str) -> bytes:
        """Read at most max_image_size_bytes + 1 so oversized files fail fast."""
        limit = settings.max_image_size_bytes
        fileobj.seek(0)
        data = fileobj.read(limit + 1)
        if not data:
            raise InvalidDataException(detail=f"'{original}' is empty")
        if len(data) > limit:
            raise InvalidDataException(
                detail=(
                    f"'{original}' exceeds the maximum size of "
                    f"{settings.MAX_IMAGE_SIZE_MB} MB"
                )
            )
        return data


def _same_format(declared: str, sniffed: str) -> bool:
    jpeg = {"jpg", "jpeg"}
    if declared in jpeg and sniffed in jpeg:
        return True
    return declared == sniffed
