import { describe, expect, it } from "vitest";
import { RenderVariant, renderSeoBlock, safeJsonLd } from "./seoBlock";
import { PrerenderRoute, prerenderRoutes } from "./routes";
import { PreloadPathError } from "./dataPreload";

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

  it("renders the real economy route's four hints", () => {
    const economy = prerenderRoutes.find(
      (r) => r.path === "indicators/economy",
    );
    expect(economy).toBeDefined();
    const out = renderSeoBlock(economy!, variant(), GCS);
    expect(out.match(/rel="preload" as="fetch"/g)).toHaveLength(4);
  });
});

describe("safeJsonLd", () => {
  it("escapes a closing script tag so a payload cannot break out", () => {
    expect(safeJsonLd({ a: "</script><script>x()</script>" })).not.toContain(
      "</script>",
    );
  });
});
