"""
Allowlist HTML sanitiser for rich-text article bodies.

Article content is authored in the admin WYSIWYG editor and rendered on the
public site with ``dangerouslySetInnerHTML``, so anything stored here is
eventually trusted by a browser. The API is the last place that can guarantee
what lands in the database, hence this runs on every create and update.

The allowlist mirrors ``lib/sanitize.ts`` on the frontend; keep the two in step
when adding a tag. No third-party dependency is used — the standard library's
``HTMLParser`` is enough for a tokenise-and-re-emit sanitiser.
"""
from html import escape
from html.parser import HTMLParser
from typing import Optional
from urllib.parse import urlparse

# Tag -> attributes kept on it. Everything else is dropped.
ALLOWED_TAGS: dict[str, set[str]] = {
    "p": set(),
    "br": set(),
    "strong": set(), "b": set(), "em": set(), "i": set(), "u": set(),
    "s": set(), "strike": set(), "del": set(), "ins": set(),
    "mark": set(), "sub": set(), "sup": set(), "small": set(),
    "h2": set(), "h3": set(), "h4": set(),
    "ul": set(), "ol": {"start"}, "li": set(),
    "blockquote": {"cite"},
    "pre": set(), "code": set(), "hr": set(),
    "a": {"href", "title", "target", "rel"},
    "img": {"src", "alt", "title", "width", "height", "loading", "class"},
    "figure": {"class"},
    "figcaption": set(),
    "span": {"class"},
    "table": set(), "thead": set(), "tbody": set(), "tfoot": set(), "tr": set(),
    "th": {"colspan", "rowspan", "scope"},
    "td": {"colspan", "rowspan"},
}

VOID_TAGS = {"br", "hr", "img"}

# Tags removed together with everything inside them.
DROP_WITH_CONTENT = {
    "script", "style", "iframe", "frame", "frameset", "object", "embed",
    "applet", "noscript", "template", "svg", "math", "form", "input",
    "button", "select", "textarea", "head", "title", "link", "meta", "base",
}

# Tags a browser would auto-close when the key tag opens.
IMPLICIT_CLOSE: dict[str, set[str]] = {
    "p": {"p"}, "h2": {"p"}, "h3": {"p"}, "h4": {"p"}, "ul": {"p"}, "ol": {"p"},
    "blockquote": {"p"}, "pre": {"p"}, "figure": {"p"}, "hr": {"p"}, "table": {"p"},
    "li": {"li"},
    "tr": {"tr", "td", "th"},
    "td": {"td", "th"},
    "th": {"td", "th"},
}

# The implicit-close scan stops at these: a nested list's <li> closes its
# sibling, not the item the sublist hangs off.
SCOPE_BARRIER = {
    "ul", "ol", "li", "table", "thead", "tbody", "tfoot", "tr", "td", "th",
    "blockquote", "figure",
}

SAFE_SCHEMES = {"http", "https", "mailto", "tel"}
DATA_IMAGE_PREFIXES = tuple(
    f"data:image/{kind};base64," for kind in ("png", "jpeg", "jpg", "gif", "webp", "avif")
)

# Only classes the editor itself writes survive; anything else is styling
# injected into the newsroom's stylesheet.
_ALLOWED_CLASS_PREFIX = "rte-"

_NUMERIC_ATTRS = {"width", "height", "colspan", "rowspan", "start"}


def _safe_url(value: str, allow_data_image: bool = False) -> Optional[str]:
    """Return the URL when it is safe to emit, else ``None``."""
    # Control characters and whitespace are the classic way of smuggling a
    # scheme past a naive prefix check ("jav\tascript:").
    cleaned = "".join(ch for ch in value if ord(ch) > 0x20 and ord(ch) != 0x7F)
    if not cleaned:
        return None

    if allow_data_image and cleaned.lower().startswith(DATA_IMAGE_PREFIXES):
        return cleaned

    try:
        scheme = urlparse(cleaned).scheme.lower()
    except ValueError:
        return None

    if not scheme:
        return cleaned  # relative URL — always fine
    return cleaned if scheme in SAFE_SCHEMES else None


def _keep_classes(value: str) -> Optional[str]:
    kept = [name for name in value.split() if name.startswith(_ALLOWED_CLASS_PREFIX)]
    return " ".join(kept) if kept else None


class _Sanitiser(HTMLParser):
    """Re-emits a document containing only allowlisted tags and attributes."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.stack: list[str] = []
        self._skip_tag: Optional[str] = None
        self._skip_depth = 0

    # ── Output helpers ────────────────────────────────────────────────────

    def _close_down_to(self, index: int) -> None:
        while len(self.stack) > index:
            self.out.append(f"</{self.stack.pop()}>")

    def _apply_implicit_close(self, tag: str) -> None:
        closes = IMPLICIT_CLOSE.get(tag)
        if not closes:
            return
        open_at = -1
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i] in closes:
                open_at = i
            elif open_at != -1 or self.stack[i] in SCOPE_BARRIER:
                break
        if open_at != -1:
            self._close_down_to(open_at)

    def _clean_attrs(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> Optional[str]:
        """Serialised attribute string, or ``None`` when the tag must be dropped."""
        allowed = ALLOWED_TAGS[tag]
        if not allowed:
            return ""

        parts: list[str] = []
        seen: set[str] = set()
        for raw_name, raw_value in attrs:
            name = raw_name.lower()
            if name not in allowed or name in seen:
                continue
            value = raw_value or ""

            if name in ("href", "src"):
                url = _safe_url(value, allow_data_image=(tag == "img"))
                if url is None:
                    # An image with an unusable source is noise; a link just
                    # loses its href and stays as text.
                    if tag == "img":
                        return None
                    continue
                value = url
            elif name == "class":
                classes = _keep_classes(value)
                if classes is None:
                    continue
                value = classes
            elif name == "target":
                if value != "_blank":
                    continue
            elif name in _NUMERIC_ATTRS:
                if not (value.isdigit() and len(value) <= 5):
                    continue
            elif name == "loading":
                if value not in ("lazy", "eager"):
                    continue

            seen.add(name)
            parts.append(f'{name}="{escape(value, quote=True)}"')

        # A link opened in a new tab must not hand the opener over with it.
        if tag == "a" and "target" in seen and "rel" not in seen:
            parts.append('rel="noopener noreferrer"')

        return f" {' '.join(parts)}" if parts else ""

    # ── HTMLParser hooks ──────────────────────────────────────────────────

    def handle_starttag(self, tag: str, attrs) -> None:  # type: ignore[override]
        tag = tag.lower()

        if self._skip_tag:
            if tag == self._skip_tag:
                self._skip_depth += 1
            return

        if tag in DROP_WITH_CONTENT:
            self._skip_tag = tag
            self._skip_depth = 1
            return

        if tag not in ALLOWED_TAGS:
            return  # unknown tag: unwrap it, keep the text inside

        self._apply_implicit_close(tag)

        rendered = self._clean_attrs(tag, attrs)
        if rendered is None:
            return

        self.out.append(f"<{tag}{rendered}>")
        if tag not in VOID_TAGS:
            self.stack.append(tag)

    def handle_startendtag(self, tag: str, attrs) -> None:  # type: ignore[override]
        tag = tag.lower()
        if self._skip_tag or tag in DROP_WITH_CONTENT or tag not in ALLOWED_TAGS:
            return
        rendered = self._clean_attrs(tag, attrs)
        if rendered is None:
            return
        self.out.append(f"<{tag}{rendered}>")
        if tag not in VOID_TAGS:
            self.out.append(f"</{tag}>")

    def handle_endtag(self, tag: str) -> None:  # type: ignore[override]
        tag = tag.lower()

        if self._skip_tag:
            if tag == self._skip_tag:
                self._skip_depth -= 1
                if self._skip_depth == 0:
                    self._skip_tag = None
            return

        if tag not in ALLOWED_TAGS or tag in VOID_TAGS:
            return
        if tag not in self.stack:
            return  # stray closing tag
        self._close_down_to(len(self.stack) - 1 - self.stack[::-1].index(tag))

    def handle_data(self, data: str) -> None:  # type: ignore[override]
        if self._skip_tag or not data:
            return
        self.out.append(escape(data, quote=False))

    def result(self) -> str:
        self.close()
        self._close_down_to(0)
        return "".join(self.out)


def sanitize_html(html: Optional[str]) -> str:
    """
    Reduce arbitrary HTML to the article allowlist.

    Unknown tags are unwrapped so their text survives; scripts, styles, embeds
    and form controls are removed wholesale; every URL is scheme-checked.
    """
    if not html:
        return ""
    parser = _Sanitiser()
    parser.feed(html)
    return parser.result()


def strip_html(html: Optional[str]) -> str:
    """Plain text behind the markup — for excerpts and emptiness checks."""
    if not html:
        return ""

    class _Text(HTMLParser):
        def __init__(self) -> None:
            super().__init__(convert_charrefs=True)
            self.chunks: list[str] = []
            self._skip = False

        def handle_starttag(self, tag, attrs):  # type: ignore[override]
            if tag.lower() in DROP_WITH_CONTENT:
                self._skip = True
            else:
                self.chunks.append(" ")

        def handle_endtag(self, tag):  # type: ignore[override]
            if tag.lower() in DROP_WITH_CONTENT:
                self._skip = False
            else:
                self.chunks.append(" ")

        def handle_data(self, data):  # type: ignore[override]
            if not self._skip:
                self.chunks.append(data)

    parser = _Text()
    parser.feed(html)
    parser.close()
    return " ".join("".join(parser.chunks).split())
