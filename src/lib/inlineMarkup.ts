// A tiny `[label](href)` inline syntax for long-form copy that is rendered TWICE — once by React
// and once as prerendered HTML (scripts/prerender/routes.ts). Keeping the copy in one data module
// and rendering it through these helpers is what stops the two copies drifting: /about's
// right-of-reply section existed only in the prerender for months, so it vanished as soon as the
// app rendered. Used by /privacy and the /about#accumulation-gap section.

export type Inline = { text: string; href?: string };

/** Split `text` into plain runs and `[label](href)` links. */
export const parseInline = (text: string): Inline[] => {
  const out: Inline[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[1], href: m[2] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
};

export const escHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** The prerender half: escaped HTML with the links as <a>. */
export const inlineHtml = (text: string) =>
  parseInline(text)
    .map((r) =>
      r.href
        ? `<a href="${escHtml(r.href)}"${r.href.startsWith("http") ? ' rel="noopener"' : ""}>${escHtml(r.text)}</a>`
        : escHtml(r.text),
    )
    .join("");
