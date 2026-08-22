// Every prerendered page must carry exactly ONE <h1>, and it must be its own.
//
// Read from the BUILT ARTIFACT, because that is the only place the property is
// observable. The prerender composes each page from three independent parts —
// the dist/index.html template, the route's own `bodyHtml` (routes.ts /
// dynamicRoutes.ts), and the shared site nav appended to every page
// (bodyBuilders.buildSiteNav) — and a heading emitted twice, or emitted by the
// template rather than the route, is visible in none of them individually. A
// SOURCE scan cannot see it either: src/ux/infographic/hubHead.gates.test.ts
// already gates "no screen renders both HubHead and Title", and it is
// structurally blind to anything the prerender contributes.
//
// ⚠️ THE TRAILING SLASH INVERTS UNDER `vite preview`, AND THAT IS WHY THIS GATE
// READS FILES RATHER THAN A SERVER. Hosting runs `trailingSlash: false`, so
// `/procurement` serves dist/procurement/index.html and `/procurement/` 301s to
// it. `vite preview` is the OPPOSITE: it runs the SPA fallback, so the no-slash
// URL falls through to dist/index.html — the HOMEPAGE prerender, complete with
// the homepage's <h1> — while only the WITH-slash URL serves the real file.
// Measured 2026-08-22 on localhost:4173: `/procurement` → „Парламентарни избори
// в България — последен вот: 19 април 2026", `/procurement/` → „Обществени
// поръчки — договори и народни представители", and the live site serves the
// latter at the no-slash URL. Probing a preview server therefore reports the
// site-wide homepage heading on ~90k routes that do not have it — a finding
// that is entirely an artifact of the harness, and one that this gate makes
// impossible to reach.
//
// Measured over the full dist/ (150,857 pages): 150,845 carry exactly one,
// 12 carry none (the six routes below × two languages), NONE carries two.
//
// Auto-skips on a checkout that has not built. Run it AFTER `npm run build` —
// same contract as scripts/sitemap/families.data.test.ts, and for the same
// reason: dist/ is not committed, so a gate that failed on its absence would
// fail on every clone.
//
//   npm run build && npx vitest run scripts/prerender/distHeadings.data.test.ts

import { test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const DIST = path.join(PROJECT_ROOT, "dist");

// Route paths whose prerendered body carries NO <h1>, each because the
// staticPage() entry declares head tags and no `bodyHtml` at all — so the
// crawlable body is the shared site nav and nothing else. They are listed, not
// tolerated: each is a real (small) gap, and an entry that stops being true
// fails the staleness arm below rather than sitting here for ever.
//
// All six are pickers or dashboards whose content is client-rendered; none is a
// prose page that lost its heading. Adding a `bodyHtml` with an <h1> to any of
// them is the fix, and removing its line here is how that lands.
const NO_H1_ROUTES = new Map<string, string>([
  [
    "governance/overview",
    "staticPage with no bodyHtml — client-rendered dashboard",
  ],
  [
    "governance/declarations",
    "staticPage with no bodyHtml — client-rendered dashboard",
  ],
  [
    "parliament/similarity",
    "staticPage with no bodyHtml — MP picker, per-MP pages are SPA-only",
  ],
  [
    "parliament/correlation",
    "staticPage with no bodyHtml — client-rendered matrix",
  ],
  [
    "parliament/attendance",
    "staticPage with no bodyHtml — client-rendered table",
  ],
  [
    "votes/between",
    "staticPage with no bodyHtml — group-pair picker, pairs are SPA-only",
  ],
]);

const H1_OPEN_RE = /<h1[\s>]/g;
const H1_TEXT_RE = /<h1[^>]*>([\s\S]*?)<\/h1>/;

type Page = { file: string; route: string; count: number; text: string | null };

/** Every dist/**\/index.html, with its <h1> count and first heading text. */
const scanDist = (): Page[] => {
  const out: Page[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "index.html") {
        const html = fs.readFileSync(p, "utf-8");
        // The route path both language variants share: dist/en/foo/index.html
        // and dist/foo/index.html are both "foo", so one allowlist entry covers
        // the pair (they are emitted from one staticPage).
        const rel = path
          .relative(DIST, p)
          .replace(/\/index\.html$/, "")
          .replace(/^index\.html$/, "");
        out.push({
          file: path.relative(PROJECT_ROOT, p),
          route: rel.replace(/^en(\/|$)/, ""),
          count: (html.match(H1_OPEN_RE) ?? []).length,
          text: H1_TEXT_RE.exec(html)?.[1].trim() ?? null,
        });
      }
    }
  };
  walk(DIST);
  return out;
};

const built = fs.existsSync(path.join(DIST, "index.html"));
const PAGES = built ? scanDist() : [];

const list = (pages: Page[], n = 10) =>
  pages
    .slice(0, n)
    .map((p) => `      ${p.file} (${p.count})`)
    .join("\n") +
  (pages.length > n ? `\n      … and ${pages.length - n} more` : "");

test.skipIf(!built)("no prerendered page carries two <h1> elements", () => {
  const twice = PAGES.filter((p) => p.count > 1);
  assert.equal(
    twice.length,
    0,
    `${twice.length} prerendered page(s) carry more than one <h1>. A crawler ` +
      `gets two competing headings for one URL.\n${list(twice)}`,
  );
});

test.skipIf(!built)("every prerendered page carries an <h1>", () => {
  const none = PAGES.filter((p) => p.count === 0 && !NO_H1_ROUTES.has(p.route));
  assert.equal(
    none.length,
    0,
    `${none.length} prerendered page(s) carry no <h1> and are not in ` +
      `NO_H1_ROUTES. Give the route a bodyHtml with a heading, or list it ` +
      `there with a reason.\n${list(none)}`,
  );
});

test.skipIf(!built)("NO_H1_ROUTES holds no stale entry", () => {
  const stale = [...NO_H1_ROUTES.keys()].filter((route) => {
    const pages = PAGES.filter((p) => p.route === route);
    // A route that no longer builds at all is stale too — a listed path with no
    // page behind it documents a gap that cannot exist.
    return pages.length === 0 || pages.every((p) => p.count > 0);
  });
  assert.deepEqual(
    stale,
    [],
    `NO_H1_ROUTES lists ${stale.length} route(s) that now emit an <h1> (or no ` +
      `longer build). Remove them — a stale exception hides the next one.`,
  );
});

test.skipIf(!built)("only the two homepages carry the homepage <h1>", () => {
  // The defect class the trailing-slash trap above imitates: a page served, or
  // written, from the site-wide template rather than from its own route would
  // lead with „Парламентарни избори в България — последен вот: …" on a page
  // about something else. Currently 0 pages of 150,855 do.
  const homes = new Set(
    PAGES.filter((p) => p.route === "" && p.text).map((p) => p.text as string),
  );
  assert.ok(
    homes.size > 0,
    "no homepage <h1> found in dist/ — the scan or the prerender is broken",
  );
  const leaked = PAGES.filter(
    (p) => p.route !== "" && p.text && homes.has(p.text),
  );
  assert.equal(
    leaked.length,
    0,
    `${leaked.length} non-home page(s) lead with the homepage's <h1>.\n${list(leaked)}`,
  );
});

test.skipIf(!built)("the scan reached the whole prerendered tree", () => {
  // Non-vacuity: a walk that silently found nothing would pass every assertion
  // above. The prerender emits ~150k pages; anything under four figures means
  // the build was partial or the walk broke, and the gate is not measuring what
  // it claims to.
  assert.ok(
    PAGES.length > 1000,
    `only ${PAGES.length} prerendered page(s) found under dist/ — expected the ` +
      `full tree (~150k). A partial build makes every assertion here vacuous.`,
  );
  assert.ok(
    PAGES.some((p) => p.route === ""),
    "dist/index.html was not reached by the scan",
  );
});
