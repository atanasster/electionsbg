import type { Plugin } from "vite";

/**
 * Injects a tiny inline script that preloads the visitor's translation chunk.
 *
 * Why a hint at all: `src/i18n.ts` loads exactly one language's bundle via a
 * dynamic import, which cut ~150 KB brotli of dead translations out of the
 * entry chunk. But a dynamic import is only discovered once the entry has
 * downloaded and executed, and `main.tsx` awaits it before the first render —
 * so with no hint the largest single asset on the critical path arrives a full
 * round-trip late, trading bytes for latency. The hint makes first paint gate
 * on max(entry, locale) instead of entry-then-locale.
 *
 * Why a script rather than a static `<link>`: the language is only knowable at
 * runtime. `detectLanguage()` resolves English from the `/en/*` path OR from
 * `localStorage.language`, and internal links are not language-prefixed — so an
 * English-preference visitor browses unprefixed URLs. A static Bulgarian hint
 * would make that cohort download ~168 KB br they never use AND still pay the
 * serial hop for English: worse than before the split. A prerender-time swap
 * can only fix the `/en/*` half.
 *
 * The script is parser-blocking and runs before the entry's `<script type=
 * "module">` executes, so the fetch starts at effectively the same moment a
 * static tag would have. It creates the link itself rather than fixing up an
 * existing one, so no wrong-language fetch can be started by the preload
 * scanner first.
 *
 * The language expression must stay in sync with `detectLanguage()` in
 * src/i18n.ts. Both are asserted by tests/perf.spec.ts.
 */
export const preloadLocale = (defaultLanguage: "bg" | "en" = "bg"): Plugin => ({
  name: "preload-locale",
  apply: "build",
  transformIndexHtml: {
    order: "post",
    handler(html, ctx) {
      // ctx.bundle is only populated for builds; in `serve` nothing is chunked
      // and the dynamic import is served unbundled anyway.
      if (!ctx.bundle) return html;

      const chunkFor = (lang: string) =>
        Object.values(ctx.bundle!).find(
          (c) =>
            c.type === "chunk" &&
            c.fileName.includes("translation-") &&
            c.facadeModuleId?.includes(`/locales/${lang}/`),
        );
      const other = defaultLanguage === "bg" ? "en" : "bg";
      const dflt = chunkFor(defaultLanguage);
      const alt = chunkFor(other);
      // Fail loudly rather than silently shipping the regression this plugin
      // exists to prevent: a rename of the locale files or a chunking change
      // would otherwise just remove the hint with a green build.
      if (!dflt || !alt) {
        throw new Error(
          `[preload-locale] expected a translation chunk for both "${defaultLanguage}" and "${other}" ` +
            `(found ${dflt ? "" : `no ${defaultLanguage}`}${!dflt && !alt ? " and " : ""}${alt ? "" : `no ${other}`}). ` +
            `If the locale files moved, update this plugin — dropping the hint silently costs a ` +
            `round-trip on the largest asset in the shell.`,
        );
      }

      const enHref = `/${(defaultLanguage === "en" ? dflt : alt).fileName}`;
      const bgHref = `/${(defaultLanguage === "bg" ? dflt : alt).fileName}`;
      const script =
        `(function(){try{` +
        `var e=/^\\/en(\\/|$)/.test(location.pathname)||localStorage.getItem("language")==="en";` +
        `var l=document.createElement("link");l.rel="modulepreload";l.crossOrigin="";` +
        `l.href=e?${JSON.stringify(enHref)}:${JSON.stringify(bgHref)};` +
        `document.head.appendChild(l);` +
        `}catch(_){}})()`;

      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: { "data-locale-preload": "" },
            children: script,
            injectTo: "head",
          },
        ],
      };
    },
  },
});
