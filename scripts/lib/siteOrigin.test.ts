import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SITE_ORIGIN } from "@/lib/siteOrigin";
import { assertCommitted } from "./assert_committed";

/**
 * The domain-migration gate.
 *
 * `src/lib/siteOrigin.ts` is the one definition, and everything under
 * `scripts/`, `src/` and `ai/` imports it. Four things cannot:
 *
 *   - `functions/` is a separate deploy package and cannot import from `src/`
 *   - `index.html` is static and pre-dates the bundle
 *   - `public/robots.txt` is a static file
 *   - the two GCS CORS configs are JSON handed to `gsutil`
 *
 * So they keep their own copies, and this file fails when any of them disagrees.
 * Flip `SITE_ORIGIN`, run `npx vitest run scripts/lib/siteOrigin.test.ts`, and it
 * names every file still carrying the old origin. Without it the migration is a
 * memory exercise across four file formats.
 *
 * The CORS one is the reason this is a gate and not a checklist: miss the bucket
 * origin and the new domain serves a fully prerendered, fully indexed,
 * COMPLETELY BLANK site — every canonical correct, `tests/seo.spec.ts` green,
 * and not one number rendering, because every data fetch is refused by CORS.
 */

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf-8");

/** Origins this project has served or will serve. Used to catch stray literals. */
const KNOWN_ORIGINS = [
  "https://electionsbg.com",
  "https://naiasno.bg",
  "https://naiasno.com",
];

// The other half of the sitemap rule above: the back-compat copy has to EXIST at the
// conventional path for a crawler that probes it, while being announced nowhere. Stated
// as a presence assertion rather than an `existsSync` beside the robots check, because
// both files are committed — absence is a broken working copy, not a state to stand down
// for. See scripts/lib/assert_committed.ts.
assertCommitted("public/robots.txt", "public/sitemap.xml");

describe("SITE_ORIGIN shape", () => {
  it("is scheme + host with no trailing slash and no path", () => {
    // Every call site concatenates `${SITE_ORIGIN}${path}`, so a trailing slash
    // would produce `//about` — which resolves, and canonicalises wrong.
    expect(SITE_ORIGIN).toMatch(/^https:\/\/[a-z0-9.-]+$/);
    expect(SITE_ORIGIN.endsWith("/")).toBe(false);
  });
});

describe("copies that cannot import the constant", () => {
  it("functions/site_origin.js matches", () => {
    const src = read("functions/site_origin.js");
    const m = src.match(/const SITE_ORIGIN = "([^"]+)"/);
    expect(m, "functions/site_origin.js must define SITE_ORIGIN").toBeTruthy();
    expect(m?.[1]).toBe(SITE_ORIGIN);
  });

  it("index.html canonical, og:url and image URLs match", () => {
    const html = read("index.html");
    const urls = [
      ...html.matchAll(/(?:href|content)="(https:\/\/[^"]+)"/g),
    ].map((m) => m[1]);
    const siteUrls = urls.filter((u) =>
      KNOWN_ORIGINS.some((o) => u.startsWith(o)),
    );
    // The head carries canonical + og:url + og:image + twitter:image.
    expect(siteUrls.length).toBeGreaterThanOrEqual(4);
    for (const u of siteUrls)
      expect(u, `index.html declares ${u}`).toContain(SITE_ORIGIN);
  });

  it("robots.txt announces exactly one sitemap, and it is the index", () => {
    // ⚠️ THE FLOOR HERE USED TO BE `>= 2`, AND THAT ENCODED THE DEFECT RATHER THAN
    // THE RULE. `public/sitemap.xml` is a byte-identical back-compat copy of
    // `sitemap_index.xml`, so announcing both handed every crawler the same 16-shard
    // index under two URLs with no way to tell they are one document — every shard
    // discovered twice. 779b06e4a3 dropped the second line and left this gate demanding
    // it back, which is why CI went red on a correct robots.txt. The copy has to EXIST
    // for a crawler that probes the conventional path; it must not be advertised.
    const lines = read("public/robots.txt")
      .split("\n")
      .filter((l) => l.toLowerCase().startsWith("sitemap:"));
    expect(lines).toEqual([`Sitemap: ${SITE_ORIGIN}/sitemap_index.xml`]);
  });

  it("the LLM proxy's CORS allowlist covers the site origin", () => {
    // ⚠️ A SECOND allowlist, and the gate was blind to it until 2026-09-10.
    // `functions/llm_origins.js` is what the AI chat's LLM proxy checks; the
    // bucket CORS above governs data fetches. Miss THIS one and the site
    // renders every number correctly and the chat refuses every question —
    // a different failure from the blank page, and an easier one to ship,
    // because nothing about the page looks wrong.
    //
    // It stores HOSTS, not origins, so the scheme is stripped before compare.
    const host = SITE_ORIGIN.replace(/^https:\/\//, "");
    const src = read("functions/llm_origins.js");
    expect(src, `functions/llm_origins.js must allow ${host}`).toContain(
      `"${host}"`,
    );
  });

  it("every CORS allowlist in functions/index.js admits the site origin", () => {
    // ⚠️ A THIRD allowlist family, and the one that hid best: these are REGEX
    // literals (/^https:\/\/electionsbg\.com$/), so the string sweep below
    // — which looks for a quoted or backticked origin — never saw them, and
    // neither did three separate hand greps. At the naiasno.bg flip
    // DB_ALLOWED_ORIGINS had been updated and SCENARIO_ALLOWED_ORIGINS had
    // not, which would have CORS-refused every budget-simulator submission
    // from the new domain while the rest of the site worked.
    //
    // So this EVALUATES the patterns rather than grepping for them: a gate that
    // matched text would have passed on the half-updated file.
    const src = read("functions/index.js");
    const blocks = [
      ...src.matchAll(/const (\w*ALLOWED_ORIGINS) = \[([\s\S]*?)\n\];/g),
    ];
    expect(blocks.length, "no *_ALLOWED_ORIGINS arrays found").toBeGreaterThan(
      1,
    );
    for (const [, name, body] of blocks) {
      const patterns = [...body.matchAll(/\/\^(.+?)\$\//g)].map(
        (m) => new RegExp(`^${m[1]}$`),
      );
      expect(
        patterns.some((re) => re.test(SITE_ORIGIN)),
        `${name} does not admit ${SITE_ORIGIN}`,
      ).toBe(true);
    }
  });

  it("the GCS CORS config allows the site origin", () => {
    // Miss this and the new domain serves a perfectly indexed blank page.
    //
    // `scripts/bucket_cors.json` is the ONE config, applied by `npm run
    // bucket:cors`. A second copy, `gcs-cors.json`, existed until 2026-08-14
    // with no applier and a stale origin list missing both AI origins — so
    // anyone who reached for it (the README pointed at it) would have removed
    // two live origins and broken the AI chat's data fetches. Deleted. If a
    // second config ever reappears, add it here too.
    const f = "scripts/bucket_cors.json";
    const cfg = JSON.parse(read(f)) as { origin?: string[] }[];
    const origins = cfg.flatMap((c) => c.origin ?? []);
    expect(origins, `${f} must allow ${SITE_ORIGIN}`).toContain(SITE_ORIGIN);
  });

  it("the GCS CORS config allows the production news app", () => {
    const f = "scripts/bucket_cors.json";
    const cfg = JSON.parse(read(f)) as { origin?: string[] }[];
    const origins = cfg.flatMap((c) => c.origin ?? []);
    expect(origins, `${f} must allow the hot-data news origin`).toContain(
      "https://news.electionsbg.com",
    );
  });
});

describe("no hardcoded canonical anywhere in src/", () => {
  // A `canonical={\`https://…\`}` literal is the SEO-critical class the FILES
  // list below cannot see: it lives in a screen component, not in the prerender.
  // Four existed at the naiasno.bg flip — three pinned to the OLD domain and one
  // to the NEW, which had been declaring a canonical on a host that 301s away
  // for as long as it shipped. Both directions are the same defect: a canonical
  // naming anything but the live origin points every crawler at a redirect.
  it("every canonical is built from SITE_ORIGIN", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(resolve(ROOT, dir), {
        withFileTypes: true,
      })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) {
          const src = readFileSync(resolve(ROOT, rel), "utf-8");
          if (/canonical=\{`https:\/\//.test(src)) offenders.push(rel);
        }
      }
    };
    walk("src");
    expect(offenders, "use `${SITE_ORIGIN}/…` instead").toEqual([]);
  });
});

describe("no stray origin literals in the SEO-critical paths", () => {
  // These are the files that decide what a crawler is told. A hardcoded origin
  // here survives a flip of the constant and silently declares the old domain.
  // Non-test sources only: a test fixture SHOULD spell the URL out, since an
  // expectation built from SITE_ORIGIN would be tautological.
  const FILES = [
    "scripts/prerender/routes.ts",
    "scripts/prerender/jsonLd.ts",
    "scripts/prerender/institutions.ts",
    "scripts/prerender/fundsTables.ts",
    "scripts/llms/buildIndex.ts",
    "scripts/llms/buildFull.ts",
    "scripts/sitemap/index.ts",
    "src/ux/SEO.tsx",
    "functions/spa_page.js",
    "functions/index.js",
  ];

  it.each(FILES)("%s carries no origin literal", (f) => {
    const src = read(f);
    for (const origin of KNOWN_ORIGINS)
      expect(
        src.includes(`"${origin}`) || src.includes(`\`${origin}`),
        `${f} hardcodes ${origin} — import SITE_ORIGIN instead`,
      ).toBe(false);
  });
});
