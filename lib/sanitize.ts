/**
 * Isomorphic HTML sanitiser for article content.
 *
 * Article bodies are authored in the admin rich-text editor and rendered with
 * `dangerouslySetInnerHTML`, so the markup has to be reduced to a known-safe
 * allowlist before it is ever trusted. This runs in the browser (pasted
 * markup, on the way into the editor) and on the server (React Server
 * Components, on the way out) — hence no DOM APIs, just a tokeniser.
 *
 * The backend applies the same allowlist in `src/utils/html_sanitizer.py`;
 * this copy is defence in depth, not the only line of it.
 */

/** Tag -> attributes kept on it. Anything not listed here is dropped. */
const ALLOWED: Record<string, readonly string[]> = {
  p: [],
  br: [],
  strong: [], b: [], em: [], i: [], u: [], s: [], strike: [], del: [], ins: [],
  mark: [], sub: [], sup: [], small: [],
  h2: [], h3: [], h4: [],
  ul: [], ol: ['start'], li: [],
  blockquote: ['cite'],
  pre: [], code: [], hr: [],
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'class'],
  figure: ['class'],
  figcaption: [],
  span: ['class'],
  table: [], thead: [], tbody: [], tfoot: [], tr: [],
  th: ['colspan', 'rowspan', 'scope'],
  td: ['colspan', 'rowspan'],
};

/** Tags that never take a closing tag. */
const VOID = new Set(['br', 'hr', 'img']);

/** Tags whose *contents* are discarded along with the tag itself. */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed',
  'applet', 'noscript', 'template', 'svg', 'math', 'form', 'input',
  'button', 'select', 'textarea', 'head', 'title', 'link', 'meta', 'base',
]);

/**
 * Tags a browser would auto-close when the key tag opens. Without this a
 * shorthand list (`<li>a<li>b`) would come back out nested inside itself.
 */
const IMPLICIT_CLOSE: Record<string, readonly string[]> = {
  p: ['p'], h2: ['p'], h3: ['p'], h4: ['p'], ul: ['p'], ol: ['p'],
  blockquote: ['p'], pre: ['p'], figure: ['p'], hr: ['p'], table: ['p'],
  li: ['li'],
  tr: ['tr', 'td', 'th'],
  td: ['td', 'th'],
  th: ['td', 'th'],
};

/**
 * Containers the implicit-close scan will not reach past: a `<li>` in a nested
 * list closes its sibling, not the item the sublist hangs off.
 */
const SCOPE_BARRIER = new Set([
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'blockquote', 'figure',
]);

/** Only editor-generated classes survive — anything else is styling injection. */
const CLASS_PATTERN = /^rte-[a-z0-9-]+$/;

const TOKEN =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)\/?>/g;

const ATTR =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', tab: '\t', newline: '\n',
};

/** Decode entities far enough to unmask things like `java&#115;cript:`. */
function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);?/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);
const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i;

/**
 * Return the URL when it is safe to emit, else null.
 * Relative URLs (`/media/...`, `#anchor`) pass; only known schemes are absolute.
 */
export function safeUrl(raw: string, allowDataImage = false): string | null {
  // Control characters and whitespace are stripped first: they are the classic
  // way of smuggling a scheme past a naive prefix check.
  const value = decodeEntities(raw).replace(/[\u0000-\u0020\u007f]/g, '');
  if (!value) return null;

  const scheme = SCHEME.exec(value)?.[1]?.toLowerCase();
  if (!scheme) return value; // relative — always fine
  if (SAFE_SCHEMES.has(scheme)) return value;
  if (allowDataImage && scheme === 'data' && DATA_IMAGE.test(value)) return value;
  return null;
}

function escapeText(value: string): string {
  return value
    .replace(/&(?!#?[a-z0-9]+;)/gi, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return value
    .replace(/&(?!#?[a-z0-9]+;)/gi, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function keepClasses(value: string): string | null {
  const kept = value.split(/\s+/).filter((name) => CLASS_PATTERN.test(name));
  return kept.length > 0 ? kept.join(' ') : null;
}

/** Sentinel returned by `cleanAttributes` when the whole tag must go. */
const DROP_TAG = '\u0000';

function cleanAttributes(tag: string, raw: string): string {
  const allowed = ALLOWED[tag];
  if (!allowed || allowed.length === 0) return '';

  const parts: string[] = [];
  const seen = new Set<string>();
  ATTR.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = ATTR.exec(raw)) !== null) {
    const name = match[1].toLowerCase();
    if (!allowed.includes(name) || seen.has(name)) continue;
    let value = match[2] ?? match[3] ?? match[4] ?? '';

    if (name === 'href' || name === 'src') {
      const url = safeUrl(value, tag === 'img');
      // An image with an unusable source is noise; a link just loses its href.
      if (url === null) {
        if (tag === 'img') return DROP_TAG;
        continue;
      }
      value = url;
    } else if (name === 'class') {
      const classes = keepClasses(value);
      if (classes === null) continue;
      value = classes;
    } else if (name === 'target') {
      if (value !== '_blank') continue;
    } else if (['width', 'height', 'colspan', 'rowspan', 'start'].includes(name)) {
      if (!/^\d{1,5}$/.test(value)) continue;
    } else if (name === 'loading') {
      if (value !== 'lazy' && value !== 'eager') continue;
    }

    seen.add(name);
    parts.push(`${name}="${escapeAttr(decodeEntities(value))}"`);
  }

  // A link opened in a new tab must not hand the opener over with it.
  if (tag === 'a' && seen.has('target') && !seen.has('rel')) {
    parts.push('rel="noopener noreferrer"');
  }
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

/**
 * Reduce arbitrary HTML to the article allowlist.
 *
 * Unknown tags are unwrapped (their text survives); scripts, styles, embeds
 * and form controls are removed wholesale; every URL is scheme-checked.
 */
export function sanitizeHtml(html: string): string {
  if (!html) return '';

  const out: string[] = [];
  const stack: string[] = [];
  let skipUntil: string | null = null;
  let skipDepth = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;

  const pushText = (text: string) => {
    if (skipUntil || !text) return;
    out.push(escapeText(text));
  };

  TOKEN.lastIndex = 0;
  while ((match = TOKEN.exec(html)) !== null) {
    pushText(html.slice(cursor, match.index));
    cursor = TOKEN.lastIndex;

    const tag = match[1]?.toLowerCase();
    if (!tag) continue; // comment, doctype or CDATA — dropped entirely

    const isClosing = match[0][1] === '/';
    const selfClosing = match[0].endsWith('/>');

    // Inside a dropped subtree: swallow everything up to its closing tag.
    if (skipUntil) {
      if (tag === skipUntil) {
        if (isClosing) {
          skipDepth -= 1;
          if (skipDepth === 0) skipUntil = null;
        } else if (!selfClosing) {
          skipDepth += 1;
        }
      }
      continue;
    }

    if (DROP_WITH_CONTENT.has(tag)) {
      if (!isClosing && !selfClosing) {
        skipUntil = tag;
        skipDepth = 1;
      }
      continue;
    }

    if (!(tag in ALLOWED)) continue; // unknown tag: unwrap, keep its text

    if (isClosing) {
      const depth = stack.lastIndexOf(tag);
      if (depth === -1) continue; // stray closer
      while (stack.length > depth) out.push(`</${stack.pop()}>`);
      continue;
    }

    // `<p><h2>` and `<li>a<li>b`: close the open block rather than nesting it.
    const closes = IMPLICIT_CLOSE[tag];
    if (closes) {
      // Nearest open block this tag supersedes, then out through any enclosing
      // ones it also supersedes — `<tr>` inside `<tr><td>` closes both.
      let open = -1;
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (closes.includes(stack[i])) open = i;
        else if (open !== -1 || SCOPE_BARRIER.has(stack[i])) break;
      }
      while (open !== -1 && stack.length > open) out.push(`</${stack.pop()}>`);
    }

    const attrs = cleanAttributes(tag, match[2] ?? '');
    if (attrs === DROP_TAG) continue;

    out.push(`<${tag}${attrs}>`);
    if (!VOID.has(tag)) stack.push(tag);
  }

  pushText(html.slice(cursor));
  while (stack.length > 0) out.push(`</${stack.pop()}>`);

  return out.join('');
}

/** Plain text behind the markup — for word counts, previews and validation. */
export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/?(p|div|br|li|h[1-6]|blockquote|figure|figcaption|tr)[^>]*>/gi, ' ')
      .replace(/<[^>]*>/g, '')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the stored content is markup rather than legacy plain text. */
export function looksLikeHtml(content: string): boolean {
  return /<(p|div|h[2-6]|ul|ol|li|figure|img|blockquote|br|strong|em|a)\b[^>]*>/i.test(content);
}

/**
 * Content as renderable HTML.
 *
 * Articles written before the rich-text editor are stored as plain text with
 * blank-line paragraph breaks, so those are converted rather than dumped into
 * the DOM as one run-on block.
 */
export function contentToHtml(content: string): string {
  if (!content) return '';
  if (looksLikeHtml(content)) return sanitizeHtml(content);
  return content
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeText(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}
