import { describe, expect, it } from "vitest";
import { transformSync } from "esbuild";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  PreloadPathError,
  dataUrlFor,
  isPreloadablePath,
  renderPreloadLinks,
} from "./dataPreload";
import { prerenderRoutes } from "./routes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");

const GCS = "https://storage.googleapis.com/data-electionsbg-com";
const esc = (s: string) => s;

describe("dataUrlFor", () => {
  it("prefixes the base, matching dataUrl() in src/", () => {
    expect(dataUrlFor(GCS, "/macro.json")).toBe(`${GCS}/macro.json`);
  });

  it("passes through unchanged when the base is empty (dev / same-origin)", () => {
    expect(dataUrlFor("", "/macro.json")).toBe("/macro.json");
  });

  it("inserts the missing separator like dataUrl() does", () => {
    expect(dataUrlFor(GCS, "macro.json")).toBe(`${GCS}/macro.json`);
  });

  // The whole point of the preload is defeated if the href differs from the
  // fetch URL by even one byte, so pin this helper to the real implementation
  // rather than to a copy of its behaviour. src/data/dataUrl.ts reads
  // import.meta.env and so cannot be imported here — read its source and run
  // the same branch table through both.
  it("agrees with src/data/dataUrl.ts, which it deliberately duplicates", () => {
    const src = fs.readFileSync(
      path.join(PROJECT_ROOT, "src/data/dataUrl.ts"),
      "utf-8",
    );
    // Rebuild the exported function with BASE injected, so we execute the
    // shipped body instead of trusting that it still reads the way we assume.
    const patched = src.replace(
      /const BASE = [^;]+;/,
      "const BASE = __BASE__;",
    );
    expect(patched).toContain("const BASE = __BASE__;");
    // Transpile rather than hand-strip the types: a regex-based stripper would
    // be a third implementation to keep correct.
    const body = transformSync(patched, { loader: "ts", format: "cjs" }).code;

    for (const base of [GCS, ""]) {
      const real = new Function(
        "__BASE__",
        `const module = { exports: {} }; const exports = module.exports;
         ${body}
         return module.exports.dataUrl;`,
      )(base) as (p: string) => string;
      expect(typeof real).toBe("function");
      for (const p of ["/macro.json", "/macro_peers.json", "macro.json"]) {
        expect(dataUrlFor(base, p)).toBe(real(p));
      }
    }
  });
});

describe("isPreloadablePath", () => {
  it("accepts a site-absolute data path", () => {
    expect(isPreloadablePath("/macro.json")).toBe(true);
  });

  it.each([
    ["https://storage.googleapis.com/data-electionsbg-com/macro.json"],
    ["macro.json"],
    ["//storage.googleapis.com/macro.json"],
    // First segment ending in a colon — the \w+: clause.
    ["/c:/macro.json"],
    // A query or fragment makes the href differ from the fetch URL, which is
    // the single property this module exists to protect.
    ["/macro.json?v=2"],
    ["/macro.json#frag"],
  ])("rejects %s", (p) => {
    expect(isPreloadablePath(p)).toBe(false);
  });
});

describe("renderPreloadLinks", () => {
  it("emits a crossorigin fetch preload per path", () => {
    expect(renderPreloadLinks(["/macro.json"], GCS, esc)).toEqual([
      `    <link rel="preload" as="fetch" crossorigin fetchpriority="low" href="${GCS}/macro.json" />`,
    ]);
  });

  // A preload fetched in a different CORS mode than the eventual request is
  // discarded and re-downloaded — the exact double-download this exists to
  // avoid — so the attribute is load-bearing, not cosmetic.
  it("always carries crossorigin, since the fetches are CORS-mode", () => {
    for (const line of renderPreloadLinks(["/a.json", "/b.json"], GCS, esc)) {
      expect(line).toContain("crossorigin");
      expect(line).toContain('as="fetch"');
    }
  });

  // as="fetch" defaults to HIGH priority, which makes the data compete with the
  // render-blocking JS the page needs in order to paint at all. Measured: high
  // priority is a net LCP loss at both 1.6Mbps and 10Mbps versus low. Dropping
  // this attribute silently regresses LCP by ~200ms with nothing else changing.
  it("marks the data low priority so it yields to the render-blocking JS", () => {
    for (const line of renderPreloadLinks(["/a.json"], GCS, esc)) {
      expect(line).toContain('fetchpriority="low"');
    }
  });

  it("returns nothing when the route declares no data", () => {
    expect(renderPreloadLinks(undefined, GCS, esc)).toEqual([]);
    expect(renderPreloadLinks([], GCS, esc)).toEqual([]);
  });

  it("throws on a duplicate, the same way it throws on a bad path", () => {
    expect(() => renderPreloadLinks(["/a.json", "/a.json"], GCS, esc)).toThrow(
      PreloadPathError,
    );
  });

  it("throws on a path that would be double-prefixed", () => {
    expect(() => renderPreloadLinks([`${GCS}/macro.json`], GCS, esc)).toThrow(
      PreloadPathError,
    );
  });

  it("escapes the href", () => {
    const out = renderPreloadLinks(["/a.json"], GCS, () => "ESCAPED");
    expect(out[0]).toContain('href="ESCAPED"');
  });
});

describe("prerenderRoutes preloadData wiring", () => {
  const withPreload = prerenderRoutes.filter((r) => r.preloadData?.length);

  it("declares preloads on /indicators/economy", () => {
    const economy = prerenderRoutes.find(
      (r) => r.path === "indicators/economy",
    );
    expect(economy?.preloadData).toContain("/macro.json");
    expect(economy?.preloadData).toContain("/macro_peers.json");
  });

  // Guards the failure mode the type cannot: a well-typed string that is not
  // the shape dataUrl() receives still builds and still ships.
  it("every declared path is renderable", () => {
    expect(withPreload.length).toBeGreaterThan(0);
    for (const r of withPreload) {
      expect(() => renderPreloadLinks(r.preloadData, GCS, esc)).not.toThrow();
    }
  });

  it("declares no duplicates within a route", () => {
    for (const r of withPreload) {
      const paths = r.preloadData ?? [];
      expect(new Set(paths).size).toBe(paths.length);
    }
  });

  // A well-shaped path that names no file is the failure the type cannot catch
  // and isPreloadablePath will not either: "/macro_peer.json" is a perfectly
  // valid site-absolute path. The browser downloads a 404 — or, on the hosting
  // origin, the SPA shell at 200 — and warns the preload went unused.
  it("every declared path names a file that will be served", () => {
    for (const r of withPreload) {
      for (const p of r.preloadData ?? []) {
        const onDisk = ["data", "public"].some((d) =>
          fs.existsSync(path.join(PROJECT_ROOT, d, p)),
        );
        expect(
          onDisk,
          `${r.path} preloads ${p}, which is in neither data/ nor public/`,
        ).toBe(true);
      }
    }
  });
});
