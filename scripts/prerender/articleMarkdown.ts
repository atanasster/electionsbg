// Minimal frontmatter + Markdown → HTML utility used by the prerender step
// to inline article bodies into the static HTML shell. Kept dependency-free
// (no `gray-matter` / `marked`) since the article corpus is small and the
// markdown subset we author is well-contained: headings, paragraphs, lists,
// tables, links, images, inline emphasis, blockquotes, horizontal rules and
// fenced code blocks. Anything fancier (footnotes, custom directives) is
// deliberately out of scope — the runtime renderer (react-markdown +
// remark-gfm) handles the same set, so output diverges only in styling.

export type Frontmatter = Record<string, unknown>;

export type ArticleImageDimensions = Map<
  string,
  { width: number; height: number }
>;

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

// Strip optional surrounding quotes and trim a YAML scalar.
const unquote = (s: string): string => {
  const t = s.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
};

// Parse a single YAML scalar / list / inline value.
const parseScalar = (raw: string): unknown => {
  const v = raw.trim();
  if (v === "") return "";
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null" || v === "~") return null;
  // Inline list: [a, b, "c d"]
  if (v.startsWith("[") && v.endsWith("]")) {
    const body = v.slice(1, -1).trim();
    if (!body) return [];
    return splitCommaRespectingQuotes(body).map((x) => unquote(x));
  }
  // Plain number
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return unquote(v);
};

const splitCommaRespectingQuotes = (s: string): string[] => {
  const out: string[] = [];
  let cur = "";
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      cur += ch;
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
      cur += ch;
      continue;
    }
    if (ch === ",") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
};

// Parse YAML frontmatter delimited by --- on its own lines. Supports flat
// scalars, inline lists ([a, b]), and block lists indented under a key:
//
//   keywords:
//     - foo
//     - bar
//
// Anything more nested is intentionally unsupported — keep authoring simple.
export const parseFrontmatter = (
  src: string,
): { data: Frontmatter; content: string } => {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { data: {}, content: src };
  const yaml = m[1];
  const content = src.slice(m[0].length);
  const data: Frontmatter = {};
  const lines = yaml.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }
    const km = /^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/.exec(line);
    if (!km) {
      i++;
      continue;
    }
    const key = km[1];
    const rest = km[2].trim();
    if (rest === "") {
      // Block list following on subsequent indented lines.
      const list: unknown[] = [];
      i++;
      while (i < lines.length && /^\s+-\s+/.test(lines[i])) {
        const item = lines[i].replace(/^\s+-\s+/, "");
        list.push(parseScalar(item));
        i++;
      }
      data[key] = list;
      continue;
    }
    data[key] = parseScalar(rest);
    i++;
  }
  return { data, content };
};

// Render inline markdown emphasis, links, code spans and images. Output is
// safe-by-construction: every text fragment passes through escapeHtml; only
// http(s) and root-relative URLs become anchors / image sources.
const renderInline = (text: string): string => {
  // Process in passes: images → links → bold → italic → code. Images come
  // first because they share the [text](url) syntax with links but with a
  // leading `!`.
  let s = text;
  s = s.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_, alt, url, titleAttr) => renderImage(alt, url, titleAttr),
  );
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, txt, url) =>
    renderLink(txt, url),
  );
  // Code spans first so emphasis inside them stays literal.
  s = renderWithCodeSpans(s, (chunk) => {
    // chunk is plain text outside code spans — apply emphasis here.
    return renderEmphasis(escapeHtmlExceptTags(chunk));
  });
  return s;
};

// Per-image intrinsic dimensions. When set on the renderer's options the
// emitted <img> gains explicit width/height attributes, which the browser
// uses to reserve layout space and prevent CLS. Keys are the absolute path
// from the markdown's image URL (e.g. `/articles/images/connections/x.png`).
type ImageDimensions = Map<string, { width: number; height: number }>;

let activeDimensions: ImageDimensions | null = null;

const renderImage = (alt: string, url: string, title?: string): string => {
  const safeUrl = sanitizeImageUrl(url);
  if (!safeUrl) return escapeHtml(alt);
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
  const dim = activeDimensions?.get(safeUrl);
  const sizeAttrs = dim ? ` width="${dim.width}" height="${dim.height}"` : "";
  return `<img src="${escapeHtml(safeUrl)}" alt="${escapeHtml(alt)}"${titleAttr}${sizeAttrs} loading="lazy" decoding="async" />`;
};

const renderLink = (txt: string, url: string): string => {
  const safeUrl = sanitizeLinkUrl(url);
  const inner = renderEmphasis(escapeHtmlExceptTags(txt));
  if (!safeUrl) return inner;
  return `<a href="${escapeHtml(safeUrl)}">${inner}</a>`;
};

const sanitizeLinkUrl = (raw: string): string | null => {
  const t = raw.trim();
  if (/^https?:\/\//i.test(t)) return t;
  if (t.startsWith("/")) return t;
  if (t.startsWith("#")) return t;
  if (/^mailto:/i.test(t)) return t;
  return null;
};

const sanitizeImageUrl = (raw: string): string | null => {
  const t = raw.trim();
  if (/^https?:\/\//i.test(t)) return t;
  if (t.startsWith("/")) return t;
  if (t.startsWith("data:image/")) return t;
  return null;
};

// Replace text segments outside of `code` spans using `transform`, preserving
// the code-span content verbatim (escaped).
const renderWithCodeSpans = (
  s: string,
  transform: (chunk: string) => string,
): string => {
  const out: string[] = [];
  let i = 0;
  const re = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index > i) out.push(transform(s.slice(i, m.index)));
    out.push(`<code>${escapeHtml(m[1])}</code>`);
    i = m.index + m[0].length;
  }
  if (i < s.length) out.push(transform(s.slice(i)));
  return out.join("");
};

// Apply `**bold**` and `*italic*` to a chunk that has already had escapes
// applied to its text content (so HTML tags from earlier passes — links,
// images — are preserved).
const renderEmphasis = (s: string): string => {
  let out = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Italic: avoid matching inside already-emitted tags. The negative
  // look-arounds keep `*` adjacent to alphanumerics from being treated as
  // emphasis — good enough for prose.
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>");
  return out;
};

// Escape characters that would otherwise be interpreted as HTML, but leave
// existing tags (already-emitted <a>, <img>) untouched. We do this by
// splitting on tag boundaries and escaping only the text portions.
const escapeHtmlExceptTags = (s: string): string => {
  const parts: string[] = [];
  let i = 0;
  const re = /<[^>]+>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index > i) parts.push(escapeHtml(s.slice(i, m.index)));
    parts.push(m[0]);
    i = m.index + m[0].length;
  }
  if (i < s.length) parts.push(escapeHtml(s.slice(i)));
  return parts.join("");
};

type RenderOpts = {
  // When true, drops the first H1 heading (since the prerender shell already
  // renders an <h1> from the route title).
  stripFirstH1?: boolean;
  // When set, root-relative image URLs are rewritten to absolute. Useful for
  // og:image / structured-data extraction, less useful for inline body HTML.
  imageBaseUrl?: string;
  // Pre-computed intrinsic image dimensions, keyed by the URL as it appears
  // in the markdown (e.g. `/articles/images/foo.png`). When available,
  // emitted <img> tags get explicit width/height to prevent CLS.
  imageDimensions?: ImageDimensions;
};

const rewriteImageBase = (html: string, base: string): string =>
  html.replace(
    /<img\s+src="(\/[^"]*)"/g,
    (_, p1) => `<img src="${escapeHtml(base + p1)}"`,
  );

// Render markdown to a sanitized HTML string. The output is stripped of
// scripts/styles, leaves only safe inline markup, and is suitable for
// inlining into a hidden #ssg-content block — content that crawlers can read
// without React mounting.
export const renderMarkdownToHtml = (
  md: string,
  opts: RenderOpts = {},
): string => {
  // Stash the dimensions map so renderImage (called via the inline pipeline)
  // can read it without threading the option through every helper. Cleared
  // in `finally` so a thrown render doesn't leak state to the next call.
  activeDimensions = opts.imageDimensions ?? null;
  try {
    return renderMarkdownToHtmlInner(md, opts);
  } finally {
    activeDimensions = null;
  }
};

const renderMarkdownToHtmlInner = (md: string, opts: RenderOpts): string => {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  let firstH1Stripped = !opts.stripFirstH1;

  const flushParagraph = (buf: string[]) => {
    if (!buf.length) return;
    const text = buf.join(" ").trim();
    if (text) out.push(`<p>${renderInline(text)}</p>`);
    buf.length = 0;
  };

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.replace(/\s+$/, "");

    // Blank line — paragraph break.
    if (!line.trim()) {
      i++;
      continue;
    }

    // Horizontal rule.
    if (/^---+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) {
      out.push("<hr />");
      i++;
      continue;
    }

    // Fenced code block.
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1];
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // consume closing fence
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      out.push(`<pre><code${cls}>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }

    // Heading.
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      if (level === 1 && !firstH1Stripped) {
        firstH1Stripped = true;
        i++;
        continue;
      }
      out.push(`<h${level}>${renderInline(h[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    // Blockquote — collapse contiguous `>` lines into one block.
    if (line.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${renderInline(buf.join(" "))}</blockquote>`);
      continue;
    }

    // Table (GFM) — pipe-delimited rows with a `|---|---|` separator on the
    // second line. The first line is the header, the third line onward is
    // the body. Each cell is rendered with inline markdown.
    if (line.trim().startsWith("|") && i + 1 < lines.length) {
      const sep = lines[i + 1].trim();
      if (/^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/.test(sep)) {
        const header = parseTableRow(line);
        const rows: string[][] = [];
        i += 2;
        while (
          i < lines.length &&
          lines[i].trim().startsWith("|") &&
          lines[i].trim() !== ""
        ) {
          rows.push(parseTableRow(lines[i]));
          i++;
        }
        const thead = header.map((c) => `<th>${renderInline(c)}</th>`).join("");
        const tbody = rows
          .map(
            (r) =>
              `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join("")}</tr>`,
          )
          .join("");
        out.push(
          `<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`,
        );
        continue;
      }
    }

    // Unordered list.
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      out.push(
        `<ul>${items.map((it) => `<li>${renderInline(it)}</li>`).join("")}</ul>`,
      );
      continue;
    }

    // Ordered list.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      out.push(
        `<ol>${items.map((it) => `<li>${renderInline(it)}</li>`).join("")}</ol>`,
      );
      continue;
    }

    // Paragraph — accumulate consecutive non-blank, non-block lines.
    const paraBuf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|---+\s*$|>|```|\s*[-*]\s+|\s*\d+\.\s+|\|)/.test(lines[i])
    ) {
      paraBuf.push(lines[i]);
      i++;
    }
    flushParagraph(paraBuf);
  }

  let html = out.join("\n");
  if (opts.imageBaseUrl) {
    html = rewriteImageBase(html, opts.imageBaseUrl);
  }
  return html;
};

const parseTableRow = (line: string): string[] => {
  const trimmed = line.trim().replace(/^\||\|$/g, "");
  return trimmed.split("|").map((c) => c.trim());
};

// Walk a directory of static images and collect intrinsic dimensions for
// each, keyed by the URL path that the markdown body references (the
// relative path under `publicFolder` with a leading slash). Used by the
// prerender step to inject width/height into <img> tags so the browser
// reserves layout space and avoids CLS.
//
// Importing sharp lazily keeps this module dependency-free at the type
// level — callers that don't need dimensions don't pay the import cost.
export const collectImageDimensions = async (
  publicFolder: string,
  subdir: string,
): Promise<ArticleImageDimensions> => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const sharpMod = await import("sharp");
  const sharp = sharpMod.default;
  const root = path.join(publicFolder, subdir);
  const result: ArticleImageDimensions = new Map();
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return result;
  }
  const walk = async (dir: string): Promise<void> => {
    const list = await fs.readdir(dir, { withFileTypes: true });
    for (const e of list) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!/\.(png|jpe?g|webp|gif|avif|svg)$/i.test(e.name)) continue;
      try {
        const meta = await sharp(full).metadata();
        if (meta.width && meta.height) {
          const rel =
            "/" + path.relative(publicFolder, full).split(path.sep).join("/");
          result.set(rel, { width: meta.width, height: meta.height });
        }
      } catch {
        // Skip unreadable images — non-fatal.
      }
    }
  };
  // Avoid scanning if the entry-level readdir already failed.
  if (entries.length) await walk(root);
  return result;
};
