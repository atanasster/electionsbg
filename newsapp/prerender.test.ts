// The per-route <head> and the generated sitemap.
//
// ⚠️ Both of these fail SILENTLY when they fail. A prerender that emits the
// homepage's title on every page still produces a working app — the defect is
// only visible to a crawler, which is the one reader who cannot complain. And
// a sitemap that omits a family makes those pages invisible with nothing to
// say so. So the assertions here are about the CONTRACT, not about markup.

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyHead,
  clamp,
  renderSitemap,
  safeSegment,
  urlFor,
  writeRoute,
  type PrerenderRoute,
} from "./prerender";
import { HUB_ROUTES, buildRoutes } from "./prerenderRoutes";

describe("about hub contract", () => {
  it("has its own indexable transparency-page metadata", () => {
    const about = HUB_ROUTES.find((route) => route.path === "about");
    expect(about).toMatchObject({
      title: "За редакцията | Наясно Новини",
    });
    expect(about?.description).toContain("редакционните принципи");
    expect(about?.noindex).not.toBe(true);
  });
});

// A template that carries every tag applyHead rewrites, in the shape
// newsapp/index.html actually uses.
const TEMPLATE = `<!doctype html>
<html lang="bg">
  <head>
    <title>Наясно Новини — всяка страна на всяка история</title>
    <meta
      name="description"
      content="Начално описание."
    />
    <link rel="canonical" href="https://news.electionsbg.com/" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://news.electionsbg.com/" />
    <meta property="og:title" content="Наясно Новини" />
    <meta
      property="og:description"
      content="Начално описание."
    />
    <meta property="og:image" content="https://news.electionsbg.com/icon-512.png" />
    <meta name="twitter:title" content="Наясно Новини" />
    <meta
      name="twitter:description"
      content="Начално описание."
    />
  </head>
  <body><div id="root"></div></body>
</html>`;

const route = (over: Partial<PrerenderRoute> = {}): PrerenderRoute => ({
  path: "story/abc",
  title: "Заглавие на историята",
  description: "Описание на историята.",
  ...over,
});

describe("urlFor", () => {
  it("never emits a trailing slash except at the root", () => {
    // ⚠️ hosting.news runs trailingSlash:false, so /<path>/ 301s back to
    // /<path>. A canonical or a <loc> written with a slash names a URL that
    // redirects — the defect that sat on ~248k main-site pages until
    // 2026-08-03.
    expect(urlFor("outlets")).toBe("https://news.electionsbg.com/outlets");
    expect(urlFor("/outlets/")).toBe("https://news.electionsbg.com/outlets");
    expect(urlFor("")).toBe("https://news.electionsbg.com/");
  });
});

describe("applyHead", () => {
  it("marks a linked personal utility page noindex,follow", () => {
    const { html, missing } = applyHead(TEMPLATE, route({ noindex: true }));
    expect(missing).toEqual([]);
    expect(html).toContain('<meta name="robots" content="noindex,follow" />');
  });

  it("gives the page its OWN title and canonical", () => {
    const { html, missing } = applyHead(TEMPLATE, route());
    expect(missing).toEqual([]);
    expect(html).toContain("<title>Заглавие на историята</title>");
    expect(html).toContain(
      '<link rel="canonical" href="https://news.electionsbg.com/story/abc" />',
    );
    expect(html).not.toContain("<title>Наясно Новини — всяка страна");
  });

  it("rewrites every social tag, not just the title", () => {
    // A share card carrying the homepage's description is the same
    // duplicate-content problem one layer out.
    const { html } = applyHead(TEMPLATE, route());
    for (const tag of [
      '<meta property="og:url" content="https://news.electionsbg.com/story/abc" />',
      '<meta property="og:title" content="Заглавие на историята" />',
      '<meta property="og:description" content="Описание на историята." />',
      '<meta name="twitter:title" content="Заглавие на историята" />',
      '<meta name="twitter:description" content="Описание на историята." />',
    ]) {
      expect(html).toContain(tag);
    }
    expect(html).not.toContain('content="Начално описание."');
  });

  it("REPORTS a tag it could not find instead of failing open", () => {
    // ⚠️ The whole point. A prerender that silently skips a tag emits a page
    // with the homepage's title while looking like it worked, and nothing
    // downstream can tell.
    const withoutCanonical = TEMPLATE.replace(
      /<link rel="canonical"[^>]*\/>/,
      "",
    );
    const { missing } = applyHead(withoutCanonical, route());
    expect(missing).toContain("canonical");
  });

  it("keeps the site icon when a route has no image of its own", () => {
    // ⚠️ Roughly a quarter of outlets refuse a cross-origin request for their
    // photos, and a social scraper makes exactly the request we do — so a
    // broken outlet URL here is a missing image on every share card.
    const { html } = applyHead(TEMPLATE, route({ image: null }));
    expect(html).toContain(
      '<meta property="og:image" content="https://news.electionsbg.com/icon-512.png" />',
    );
  });

  it("uses a route image when there is one", () => {
    const { html } = applyHead(
      TEMPLATE,
      route({ image: "https://cdn.ex.bg/a.jpg" }),
    );
    expect(html).toContain(
      '<meta property="og:image" content="https://cdn.ex.bg/a.jpg" />',
    );
  });

  it("escapes markup in a title rather than injecting it", () => {
    // Headlines are somebody else's text and reach this unmodified.
    const { html } = applyHead(
      TEMPLATE,
      route({ title: 'Заглавие с "кавички" & <script>' }),
    );
    expect(html).toContain("&quot;кавички&quot;");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
  });

  it("marks a story as an article, not a website", () => {
    const { html } = applyHead(TEMPLATE, route({ ogType: "article" }));
    expect(html).toContain('<meta property="og:type" content="article" />');
  });
});

describe("replacement safety", () => {
  it("treats $ in a headline as text, not as a directive", () => {
    // ⚠️ String.replace interprets `$&`, `$\``, `$'` and `$$` INSIDE the
    // replacement — and the replacement is built from somebody else's
    // headline. Reproduced: `$&` produced a nested <title>, and `$'` injected
    // the rest of the document into a content attribute. Four story fields in
    // the corpus already carry `$`.
    const nasty = "Цена $& и $` и $' и $$ край";
    const { html } = applyHead(TEMPLATE, route({ title: nasty }));
    // `&` is HTML-escaped (correctly); the point is that NONE of the four
    // sequences was INTERPRETED as a replacement directive.
    expect(html).toContain("<title>Цена $&amp; и $` и $' и $$ край</title>");
    expect(html.match(/<title>/g)!.length).toBe(1);
    expect(html.match(/<\/title>/g)!.length).toBe(1);
  });

  it("keeps a $-bearing description contained in its attribute", () => {
    const { html } = applyHead(
      TEMPLATE,
      route({ description: "Отстъпка $' от цената" }),
    );
    // `$'` means "everything after the match" to String.replace — unfixed,
    // this injected the tail of the document into the attribute.
    expect(html).toContain("Отстъпка $' от цената");
    expect(html).toContain("<body>");
    expect(html.match(/<\/head>/g)!.length).toBe(1);
    expect(html.length).toBeLessThan(TEMPLATE.length + 400);
  });
});

describe("head patterns", () => {
  it("does not span across tags when a meta is not self-closed", () => {
    // ⚠️ `[\s\S]*?/>` runs to the NEXT `/>` anywhere in the document. With a
    // non-self-closed <meta name="twitter:description"> — valid HTML5 — the
    // match swallowed everything up to the following tag, silently deleting
    // the fonts stylesheet from all 161 pages while `missing` stayed empty.
    const html5 = TEMPLATE.replace(
      /<meta\s+name="twitter:description"[\s\S]*?\/>/,
      '<meta name="twitter:description" content="Начално описание.">\n' +
        '    <link rel="stylesheet" href="/fonts/fonts.css" />',
    );
    const { html, missing } = applyHead(html5, route());
    expect(missing).toEqual([]);
    expect(html).toContain('href="/fonts/fonts.css"');
    expect(html).toContain(
      '<meta name="twitter:description" content="Описание на историята." />',
    );
  });

  it("still rewrites a self-closed tag", () => {
    const { html, missing } = applyHead(TEMPLATE, route());
    expect(missing).toEqual([]);
    expect(html).toContain('content="Описание на историята."');
  });
});

describe("safeSegment", () => {
  it("accepts an ordinary route", () => {
    expect(safeSegment("outlet/ex.bg")).toBe("outlet/ex.bg");
    expect(safeSegment("/outlets/")).toBe("outlets");
    expect(safeSegment("")).toBe("");
  });

  it("REFUSES anything that could escape the output directory", () => {
    // ⚠️ path.join NORMALISES `..`, so `outlet/../../escaped` wrote a file
    // outside dist-news. Reproduced. Route paths are built from corpus data —
    // a domain and a story id — which is one bad registry row from hostile.
    for (const bad of [
      "outlet/../../escaped",
      "../escaped",
      "outlet/..",
      "a/./b",
      "a//b",
      "outlet/%2e%2e%2fescaped",
      "C:/windows",
      "a\\..\\b",
    ]) {
      expect(safeSegment(bad)).toBeNull();
    }
  });
});

describe("writeRoute", () => {
  it("writes the page where the route says", () => {
    // ⚠️ writeRoute had ZERO coverage: replacing it with a no-op passed every
    // test, and it is the function carrying the traversal check.
    const dir = mkdtempSync(join(tmpdir(), "news-write-"));
    const missing = writeRoute(dir, TEMPLATE, route({ path: "outlet/ex.bg" }));
    expect(missing).toEqual([]);
    const written = readFileSync(
      join(dir, "outlet", "ex.bg", "index.html"),
      "utf-8",
    );
    expect(written).toContain(
      '<link rel="canonical" href="https://news.electionsbg.com/outlet/ex.bg" />',
    );
  });

  it("writes the root at the top level", () => {
    const dir = mkdtempSync(join(tmpdir(), "news-write-root-"));
    writeRoute(dir, TEMPLATE, route({ path: "" }));
    expect(existsSync(join(dir, "index.html"))).toBe(true);
  });

  it("THROWS rather than writing outside the output directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "news-write-esc-"));
    expect(() =>
      writeRoute(dir, TEMPLATE, route({ path: "outlet/../../escaped" })),
    ).toThrow(/outside|refusing/);
    expect(existsSync(join(dir, "..", "escaped"))).toBe(false);
  });
});

describe("clamp", () => {
  it("collapses whitespace and cuts on a word boundary", () => {
    expect(clamp("едно   две\nтри")).toBe("едно две три");
    const long = "дума ".repeat(60);
    const got = clamp(long, 40);
    expect(got.length).toBeLessThanOrEqual(41);
    expect(got.endsWith("…")).toBe(true);
    expect(got).not.toMatch(/\s…$/);
  });
});

describe("renderSitemap", () => {
  it("emits one <loc> per route", () => {
    const xml = renderSitemap([route({ path: "a" }), route({ path: "b" })]);
    expect(xml).toContain("<loc>https://news.electionsbg.com/a</loc>");
    expect(xml).toContain("<loc>https://news.electionsbg.com/b</loc>");
  });

  it("omits a route marked out of the sitemap", () => {
    // ⚠️ Prerendered but NOT submitted is a real state: a page whose entire
    // content is one headline earns a thin-content penalty rather than
    // traffic. Same rule the main site applies to /council/resolution/**.
    const xml = renderSitemap([
      route({ path: "a" }),
      route({ path: "thin", sitemap: false }),
    ]);
    expect(xml).toContain("/a</loc>");
    expect(xml).not.toContain("/thin</loc>");
  });

  it("escapes a URL rather than breaking the XML", () => {
    const xml = renderSitemap([route({ path: "outlet/a&b.bg" })]);
    expect(xml).toContain("a&amp;b.bg");
  });

  it("carries lastmod as a date when there is one", () => {
    const xml = renderSitemap([
      route({ path: "a", lastmod: "2026-08-22T09:00:00+00:00" }),
    ]);
    expect(xml).toContain("<lastmod>2026-08-22</lastmod>");
    expect(renderSitemap([route({ path: "b" })])).not.toContain("<lastmod>");
  });
});

describe("buildRoutes", () => {
  it("always yields the hubs, even with no corpus", () => {
    // ⚠️ A build on a checkout with no app-data must still produce a site
    // with a homepage. Failing to an EMPTY sitemap would be the silent shape.
    const routes = buildRoutes("/nonexistent");
    expect(routes.map((r) => r.path)).toEqual(HUB_ROUTES.map((r) => r.path));
    expect(routes.some((r) => r.path === "")).toBe(true);
  });

  it("gives every route a distinct path", () => {
    const routes = buildRoutes("/nonexistent");
    expect(new Set(routes.map((r) => r.path)).size).toBe(routes.length);
  });

  it("gives every route a non-empty title and description", () => {
    for (const r of buildRoutes("/nonexistent")) {
      expect(r.title.trim().length).toBeGreaterThan(10);
      expect(r.description.trim().length).toBeGreaterThan(20);
    }
  });
});

describe("buildRoutes against a corpus", () => {
  // ⚠️ A FIXTURE, not the built dist. Testing only the empty case left both
  // "drop every story route" and "drop every outlet route" passing: the
  // dist-reading gate checks an artifact from a PREVIOUS build, so a source
  // change cannot move it.
  const dir = mkdtempSync(join(tmpdir(), "news-prerender-"));
  writeFileSync(
    join(dir, "outlets.json"),
    JSON.stringify({
      generated_at: "2026-08-26T00:00:00+00:00",
      outlets: [
        {
          domain: "ex.bg",
          outlet: "Примерен вестник",
          article_count: 12,
          analyzed_count: 5,
          retired: false,
        },
        {
          domain: "gone.bg",
          outlet: "Изчезнал",
          article_count: 3,
          analyzed_count: 0,
          retired: true,
        },
      ],
    }),
  );
  writeFileSync(
    join(dir, "stories.json"),
    JSON.stringify({
      stories: [
        {
          id: "s-multi",
          title_bg: "История с няколко медии",
          summary_bg: "Резюме на историята.",
          last_published: "2026-08-22T09:00:00+00:00",
          aggregates: { outlet_count: 4, article_count: 6 },
        },
        {
          id: "s-single",
          title_bg: "История само с една медия",
          aggregates: { outlet_count: 1, article_count: 1 },
        },
        { id: "s-untitled", aggregates: { outlet_count: 3 } },
      ],
    }),
  );

  const longSummaryDir = mkdtempSync(join(tmpdir(), "news-long-"));
  writeFileSync(
    join(longSummaryDir, "stories.json"),
    JSON.stringify({
      stories: [
        {
          id: "s-long",
          title_bg: "Дълга история",
          summary_bg: "дума ".repeat(80),
          aggregates: { outlet_count: 3 },
        },
      ],
    }),
  );

  const routes = buildRoutes(dir);
  const byPath = new Map(routes.map((r) => [r.path, r]));

  it("emits an outlet route per outlet", () => {
    expect(byPath.has("outlet/ex.bg")).toBe(true);
    expect(byPath.get("outlet/ex.bg")!.title).toContain("Примерен вестник");
    expect(byPath.get("outlet/ex.bg")!.description).toContain("12");
  });

  it("emits a story route per story", () => {
    expect(byPath.has("story/s-multi")).toBe(true);
    expect(byPath.get("story/s-multi")!.title).toContain(
      "История с няколко медии",
    );
    expect(byPath.get("story/s-multi")!.ogType).toBe("article");
    expect(byPath.get("story/s-multi")!.description).toBe(
      "Резюме на историята.",
    );
  });

  it("keeps a retired outlet's page but out of the sitemap", () => {
    // Its articles are still in the corpus and still linked from stories, so
    // the page stays — but we do not ask a crawler to index a source we no
    // longer collect, and two of them asked not to be crawled at all.
    expect(byPath.get("outlet/gone.bg")!.sitemap).toBe(false);
    expect(byPath.get("outlet/ex.bg")!.sitemap).not.toBe(false);
  });

  it("keeps a single-outlet story out of the sitemap", () => {
    // One outlet is not a comparison, and comparison is the proposition.
    expect(byPath.get("story/s-single")!.sitemap).toBe(false);
    expect(byPath.get("story/s-multi")!.sitemap).not.toBe(false);
  });

  it("skips a story with no title rather than emitting an empty one", () => {
    expect(byPath.has("story/s-untitled")).toBe(false);
  });

  it("still yields every hub alongside the corpus routes", () => {
    for (const hub of HUB_ROUTES) expect(byPath.has(hub.path)).toBe(true);
  });

  it("does not clamp the hand-written hub copy", () => {
    // ⚠️ Asserted on the RENDERED HTML, not on the route object. The clamping
    // happened in applyHead, so comparing buildRoutes' output to HUB_ROUTES
    // checked the wrong layer entirely and passed against the bug: the
    // homepage's description went 164 -> 147 characters and gained an
    // ellipsis, on every build.
    const home = byPath.get("")!;
    expect(home.description.length).toBeGreaterThan(160);
    const { html } = applyHead(TEMPLATE, home);
    const rendered = /<meta name="description" content="([^"]*)"/.exec(
      html,
    )![1];
    expect(rendered).toBe(home.description);
    expect(rendered).not.toMatch(/…/);
    expect(rendered.length).toBe(home.description.length);
  });

  it("clamps a generated description", () => {
    const long = buildRoutes(longSummaryDir);
    const story = long.find((r) => r.path === "story/s-long")!;
    expect(story.description.length).toBeLessThanOrEqual(156);
    expect(story.description.endsWith("…")).toBe(true);
  });
});

describe("a corrupt bundle", () => {
  it("REFUSES rather than silently emitting a four-URL sitemap", () => {
    // ⚠️ Absent and corrupt are different. Both used to produce the same
    // empty result, so a broken build emitted a hubs-only sitemap and exited
    // 0 — indistinguishable from a healthy build of an empty corpus.
    const dir = mkdtempSync(join(tmpdir(), "news-corrupt-"));
    writeFileSync(join(dir, "outlets.json"), "{ not json");
    expect(() => buildRoutes(dir)).toThrow(/not readable JSON/);
  });

  it("still builds the hubs when the bundles are simply ABSENT", () => {
    const dir = mkdtempSync(join(tmpdir(), "news-empty-"));
    expect(buildRoutes(dir).map((r) => r.path)).toEqual(
      HUB_ROUTES.map((r) => r.path),
    );
  });
});

describe("the article family", () => {
  // ⚠️ The largest family, and the one that was entirely unprerendered: 4,366
  // internally-linked URLs all serving the homepage's head.
  const dir = mkdtempSync(join(tmpdir(), "news-articles-"));
  writeFileSync(
    join(dir, "outlets.json"),
    JSON.stringify({
      outlets: [{ domain: "ex.bg", outlet: "Примерен вестник" }],
    }),
  );
  writeFileSync(
    join(dir, "latest.json"),
    JSON.stringify({
      articles: [
        {
          domain: "ex.bg",
          id: "a1",
          title: "Анализирана статия",
          excerpt: "Кратко описание.",
          image: "https://cdn.ex.bg/a.jpg",
          published: "2026-08-22T09:00:00+00:00",
          analysis: { summary_bg: "х" },
        },
        { domain: "ex.bg", id: "a2", title: "Неанализирана статия" },
        { domain: "ex.bg", id: "a3", analysis: { summary_bg: "х" } },
      ],
    }),
  );
  const byPath = new Map(buildRoutes(dir).map((r) => [r.path, r]));

  it("prerenders an ANALYSED article", () => {
    const r = byPath.get("article/ex.bg/a1")!;
    expect(r).toBeTruthy();
    expect(r.title).toContain("Анализирана статия");
    expect(r.title).toContain("Примерен вестник");
    expect(r.description).toBe("Кратко описание.");
    expect(r.ogType).toBe("article");
    expect(r.image).toBe("https://cdn.ex.bg/a.jpg");
  });

  it("skips an UNANALYSED one", () => {
    // A title, an excerpt and a link out is a thin page; it earns a penalty
    // rather than traffic. It keeps working, it is just not prerendered.
    expect(byPath.has("article/ex.bg/a2")).toBe(false);
  });

  it("skips an article with no title rather than emitting an empty one", () => {
    expect(byPath.has("article/ex.bg/a3")).toBe(false);
  });
});
