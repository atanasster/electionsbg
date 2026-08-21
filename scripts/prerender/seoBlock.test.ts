import { describe, expect, it } from "vitest";
import {
  RenderVariant,
  renderSeoBlock,
  resolveOgImage,
  safeJsonLd,
} from "./seoBlock";
import { DEFAULT_OG_IMAGE, PrerenderRoute, prerenderRoutes } from "./routes";
import { PreloadPathError } from "./dataPreload";
import { findResidualRefs } from "../images/optimize";

const GCS = "https://storage.googleapis.com/data-electionsbg-com";

const variant = (over: Partial<RenderVariant> = {}): RenderVariant => ({
  lang: "bg",
  title: "T",
  description: "D",
  selfUrl: "https://electionsbg.com/x",
  ...over,
});

const route = (over: Partial<PrerenderRoute> = {}): PrerenderRoute =>
  ({ path: "x", title: "T", description: "D", ...over }) as PrerenderRoute;

describe("renderSeoBlock", () => {
  it("wraps its output in the SEO markers the template splices on", () => {
    const out = renderSeoBlock(route(), variant(), GCS);
    expect(out.startsWith("<!-- SEO -->")).toBe(true);
    expect(out.trimEnd().endsWith("<!-- /SEO -->")).toBe(true);
  });

  // The whole point of putting the hints in this block is that it is the only
  // per-route seam in the head. Landing outside the markers means the template
  // replace drops them silently.
  it.each([["bg"], ["en"]] as const)(
    "emits the preload INSIDE the SEO block for the %s variant",
    (lang) => {
      const out = renderSeoBlock(
        route({ preloadData: ["/macro.json"] }),
        variant({ lang }),
        GCS,
      );
      const at = out.indexOf('rel="preload"');
      expect(at).toBeGreaterThan(out.indexOf("<!-- SEO -->"));
      expect(at).toBeLessThan(out.indexOf("<!-- /SEO -->"));
      expect(out).toContain(`href="${GCS}/macro.json"`);
    },
  );

  it("emits no preload line when the route declares none", () => {
    expect(renderSeoBlock(route(), variant(), GCS)).not.toContain(
      'rel="preload"',
    );
  });

  it("threads the injected base rather than reading the environment", () => {
    const out = renderSeoBlock(
      route({ preloadData: ["/macro.json"] }),
      variant(),
      "",
    );
    expect(out).toContain('href="/macro.json"');
    expect(out).not.toContain(GCS);
  });

  it("fails the build on a malformed declared path", () => {
    expect(() =>
      renderSeoBlock(
        route({ preloadData: [`${GCS}/macro.json`] }),
        variant(),
        GCS,
      ),
    ).toThrow(PreloadPathError);
  });

  it("keeps the canonical and hreflang contract intact", () => {
    const out = renderSeoBlock(
      route(),
      variant({ altUrl: "https://electionsbg.com/en/x" }),
      GCS,
    );
    expect(out).toContain(
      '<link rel="canonical" href="https://electionsbg.com/x" />',
    );
    expect(out).toContain('hreflang="x-default"');
  });

  it("suppresses hreflang alternates when the page canonicalizes elsewhere", () => {
    const out = renderSeoBlock(
      route(),
      variant({ canonicalUrl: "https://electionsbg.com/parent" }),
      GCS,
    );
    expect(out).toContain('href="https://electionsbg.com/parent"');
    expect(out).not.toContain("hreflang");
  });

  it("swaps in the default card when the declared one is not in dist/", () => {
    const declared = renderSeoBlock(
      route({ ogImage: "/og/region/RSE.png" }),
      variant(),
      GCS,
      () => true,
    );
    expect(declared).toContain(
      'content="https://electionsbg.com/og/region/RSE.png"',
    );
    const fallen = renderSeoBlock(
      route({ ogImage: "/og/region/RSE.png" }),
      variant(),
      GCS,
      () => false,
    );
    expect(fallen).toContain(`content="${DEFAULT_OG_IMAGE}"`);
    expect(fallen).not.toContain("og/region/RSE.png");
    // twitter:image reads the same resolved value, so both tags move together.
    expect(fallen.split(DEFAULT_OG_IMAGE).length - 1).toBe(2);
  });

  it("renders the real economy route's four hints", () => {
    const economy = prerenderRoutes.find(
      (r) => r.path === "indicators/economy",
    );
    expect(economy).toBeDefined();
    const out = renderSeoBlock(economy!, variant(), GCS);
    expect(out.match(/rel="preload" as="fetch"/g)).toHaveLength(4);
  });
});

// A declared og:image that was never built shipped as a 404 for ~208 pages —
// the og/region, og/party, og/local and og/cabinet families are rendered from
// data/<election>/*.json, which is gitignored, so a CI or fresh-clone build
// writes none of them. Since 2026-08-20 the dangling reference fails the build
// at scripts/images/optimize.ts instead of shipping, which is what surfaced it.
describe("resolveOgImage", () => {
  const none = () => false;
  const all = () => true;

  it("keeps a card that is on disk", () => {
    expect(resolveOgImage("/og/region/RSE.png", all)).toBe(
      "https://electionsbg.com/og/region/RSE.png",
    );
  });

  it("falls back to the site-wide card when the card was never built", () => {
    expect(resolveOgImage("/og/region/RSE.png", none)).toBe(DEFAULT_OG_IMAGE);
  });

  // optimize.ts converts dist/og to webp and DELETES the png, so a prerender
  // re-run over an already-optimized dist must not read "card gone".
  it("accepts an already-optimized webp sibling and names it", () => {
    expect(
      resolveOgImage("/og/culture.png", (rel) => rel.endsWith(".webp")),
    ).toBe("https://electionsbg.com/og/culture.webp");
  });

  it("does not invent a sibling for a card declared as webp", () => {
    const probed: string[] = [];
    expect(
      resolveOgImage("/og/candidate/%D0%98.webp", (rel) => {
        probed.push(rel);
        return false;
      }),
    ).toBe(DEFAULT_OG_IMAGE);
    expect(probed).toEqual(["og/candidate/%D0%98.webp"]);
  });

  it("falls back when the route declares no card at all", () => {
    expect(resolveOgImage(undefined, all)).toBe(DEFAULT_OG_IMAGE);
  });

  it("never checks an off-site card — it is somebody else's file", () => {
    const url = "https://example.com/x.png";
    expect(resolveOgImage(url, none)).toBe(url);
  });

  // The probe is dist-relative with no leading slash, and NOT decoded: the
  // og/party cards are percent-encoded on disk (generate.ts writes
  // `encodeURIComponent(nickName) + ".png"`), so decoding here would miss
  // every one of them and swap a card that exists for the default.
  it("probes the dist-relative path verbatim, percent-escapes included", () => {
    const seen: string[] = [];
    resolveOgImage("/og/party/%D0%9F%D0%9F-%D0%94%D0%91.png", (rel) => {
      seen.push(rel);
      return true;
    });
    expect(seen).toEqual(["og/party/%D0%9F%D0%9F-%D0%94%D0%91.png"]);
  });

  // Callers with no dist/ to look at (every other test in this file, and the
  // coverage gate) must keep reading the route as their only input.
  it("assumes the card exists when no probe is supplied", () => {
    expect(resolveOgImage("/og/region/RSE.png")).toBe(
      "https://electionsbg.com/og/region/RSE.png",
    );
  });
});

// The two halves that disagreed: the prerender emits the og:image, and
// scripts/images/optimize.ts fails the build on any reference under a convert
// root that has no file behind it. Asserted together, because each side passed
// its own tests while the pair shipped ~208 dangling references to CI.
describe("what the prerender emits survives the dangling-reference gate", () => {
  const nothingOnDisk = () => false;

  it("emits no reference the gate would reject when the card is missing", () => {
    const html = renderSeoBlock(
      route({ ogImage: "/og/region/RSE.png" }),
      variant(),
      GCS,
      nothingOnDisk,
    );
    expect(findResidualRefs(html, new Map(), nothingOnDisk)).toEqual([]);
  });

  it("the gate is not vacuous — it rejects the pre-fix output", () => {
    // What renderSeoBlock emitted before the existence probe: the declared
    // card, named unconditionally.
    const html = renderSeoBlock(
      route({ ogImage: "/og/region/RSE.png" }),
      variant(),
      GCS,
      () => true,
    );
    expect(findResidualRefs(html, new Map(), nothingOnDisk)).toEqual([
      { ref: "og/region/RSE.png", reason: "missing" },
    ]);
  });
});

describe("safeJsonLd", () => {
  it("escapes a closing script tag so a payload cannot break out", () => {
    expect(safeJsonLd({ a: "</script><script>x()</script>" })).not.toContain(
      "</script>",
    );
  });
});
