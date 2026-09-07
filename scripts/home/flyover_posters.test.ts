import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { GlobalFonts, createCanvas, type Canvas } from "@napi-rs/canvas";
import {
  BRAND_PALETTE,
  MANIFEST_REL,
  OG_H,
  OG_W,
  POSTER_H,
  POSTER_W,
  artifactSha256,
  drawFrame,
  loadWorld,
  parseArgs,
  type PosterManifest,
} from "./flyover_posters";
import {
  PROGRAMMES,
  PROGRAMME_IDS,
  stateAt,
} from "../../src/lib/flyover/programmes";
import { ARTICLE_CHAPTERS } from "../../src/lib/flyover/programmes/tour";
import { assertCommitted } from "../lib/assert_committed";
import {
  articlePresentationState,
  ARTICLE_PALETTE,
} from "../../src/lib/flyover/articlePresentation";
import { createRecorder } from "../../src/lib/flyover/recorder";
import { render } from "../../src/lib/flyover/render";
import { applyPartial, STATE_ZERO } from "../../src/lib/flyover/state";

// ⚠️ COMMITTED, so absence is a broken working copy and not something to skip past: the OG
// card is rendered by `home:flyover-posters` and tracked, and every check below that reads it
// would otherwise stand down quietly. Outside any gated suite, deliberately.
assertCommitted("public/og/money-map.png");

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel));

/**
 * Read lazily, and name the fix. At module scope a missing manifest fails COLLECTION with a
 * bare ENOENT and all fourteen tests vanish — on a fresh clone that is a crash where the
 * operator wanted the „was it rendered" assertion telling them what to run.
 */
const readManifest = (): PosterManifest => {
  const p = path.join(ROOT, MANIFEST_REL);
  if (!fs.existsSync(p)) {
    throw new Error(
      `${MANIFEST_REL} is missing — run \`npm run home:flyover-posters\``,
    );
  }
  return JSON.parse(fs.readFileSync(p, "utf8")) as PosterManifest;
};

/** Decode with the same encoder that wrote them — the only decoder this repo has in Node. */
const decode = async (rel: string): Promise<{ w: number; h: number }> => {
  const { loadImage } = await import("@napi-rs/canvas");
  const img = await loadImage(read(rel));
  return { w: img.width, h: img.height };
};

describe("the committed posters", () => {
  it("frames every article chapter with room for the whole country and raised geometry", () => {
    const world = loadWorld();
    let state = STATE_ZERO;
    for (const chapter of ARTICLE_CHAPTERS) {
      state = applyPartial(state, chapter.state);
      const ctx = createRecorder();
      render(ctx, world, articlePresentationState(state), {
        viewport: { w: 1000, h: 625 },
        palette: ARTICLE_PALETTE,
        clock: 0,
      });
      const points = ctx.calls.filter(({ op }) =>
        ["moveTo", "lineTo", "quadraticCurveTo"].includes(op),
      );
      expect(points.length).toBeGreaterThan(100);
      for (const point of points) {
        for (let i = 0; i < point.args.length; i += 2) {
          const x = Number(point.args[i]);
          const y = Number(point.args[i + 1]);
          expect(x, `${chapter.id}: x`).toBeGreaterThanOrEqual(8);
          expect(x, `${chapter.id}: x`).toBeLessThanOrEqual(992);
          expect(y, `${chapter.id}: y`).toBeGreaterThanOrEqual(8);
          expect(y, `${chapter.id}: y`).toBeLessThanOrEqual(617);
        }
      }
    }
  });

  it("exist for all three programmes, in the reserved aspect ratio", async () => {
    // ⚠️ The poster is the reserved box that holds CLS at zero on the entry page, the
    // reduced-motion state, the Save-Data state, the Suspense fallback AND the image in the
    // prerendered body. A wrong aspect ratio moves the layout in all five.
    for (const id of PROGRAMME_IDS) {
      const rel = `public/flyover/${id}.webp`;
      expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(true);
      expect(await decode(rel), rel).toEqual({ w: POSTER_W, h: POSTER_H });
    }
  });

  it("carries the article's share card at the OG clip's 2x", async () => {
    expect(await decode("public/og/money-map.png")).toEqual({
      w: OG_W,
      h: OG_H,
    });
  });

  it("carries one still per article chapter", async () => {
    for (const c of ARTICLE_CHAPTERS) {
      const rel = `public/articles/money-map/${c.id}.webp`;
      expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(true);
      expect(await decode(rel), rel).toEqual({ w: POSTER_W, h: POSTER_H });
    }
  });

  it("was rendered from the artifact that is on disk now", () => {
    // ⚠️ CONTENT, NOT MTIME. Git does not preserve modification times, so „is the poster newer
    // than the artifact" has no answer on a fresh clone or in CI — both carry the checkout
    // time. The digest sees every layer and same-date corrections; `computedAt` is merely the
    // latest CONTRACT date, so it is human-readable metadata rather than the correctness key.
    expect(readManifest().artifactSha256).toBe(artifactSha256());
    expect(readManifest().computedAt).toBe(loadWorld().computedAt);
  });

  it("lists exactly the files it wrote, and every one is TRACKED", () => {
    const expected = [
      ...PROGRAMME_IDS.map((id) => `public/flyover/${id}.webp`),
      "public/og/money-map.png",
      ...ARTICLE_CHAPTERS.map((c) => `public/articles/money-map/${c.id}.webp`),
    ].sort();
    expect(
      readManifest().posters,
      "the manifest is short — re-run `npm run home:flyover-posters` WITHOUT --home-only",
    ).toEqual(expected);
    for (const rel of readManifest().posters) {
      expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(true);
      // ⚠️ EXISTENCE IS NOT TRACKING, and only tracking ships. These reach production solely
      // by Vite copying `public/` into `dist/`, so a poster that was rendered and never
      // `git add`ed is a 404 in production — taking the CLS reserved box, the reduced-motion
      // state, the Save-Data state, the Suspense fallback and the prerendered body's image
      // with it — and is invisible on the machine that generated it. Same check
      // `refresh_coverage.test.ts` runs on every committed generator artifact.
      expect(
        () =>
          execFileSync("git", ["ls-files", "--error-unmatch", rel], {
            cwd: ROOT,
            stdio: "pipe",
          }),
        `${rel} is not tracked by git — it will not reach dist/`,
      ).not.toThrow();
    }
  });

  it("is not a blank frame", () => {
    // A poster that failed to draw is still a valid image of the right size, so „it decodes"
    // proves nothing. The scene is a lot of dark blue with land, columns and labels on it; a
    // backdrop-only render compresses to a small fraction of this.
    for (const rel of readManifest().posters) {
      expect(read(rel).length, rel).toBeGreaterThan(8_000);
    }
  });
});

describe("drawFrame", () => {
  const world = loadWorld();

  it("is deterministic — two renders of one state are byte-identical", () => {
    // The clock is pinned to 0, so nothing in a poster may depend on when it was drawn.
    const a = drawFrame({
      world,
      programme: "arcs",
      t: 3,
      width: 320,
      height: 200,
    });
    const b = drawFrame({
      world,
      programme: "arcs",
      t: 3,
      width: 320,
      height: 200,
    });
    expect(a.toBuffer("image/png").equals(b.toBuffer("image/png"))).toBe(true);
  });

  it("draws something different for each programme", () => {
    const png = (id: (typeof PROGRAMME_IDS)[number]) =>
      drawFrame({ world, programme: id, t: 0, width: 320, height: 200 })
        .toBuffer("image/png")
        .toString("base64");
    const seen = new Set(PROGRAMME_IDS.map(png));
    expect(seen.size).toBe(PROGRAMME_IDS.length);
  });

  it("paints an opaque backdrop, because the engine clears to transparent", () => {
    // A poster is an `<img>` over the page's own background; a transparent one would show the
    // theme through the sea and stop being the reserved box it exists to be.
    const canvas = drawFrame({
      world,
      programme: "tour",
      t: 0,
      width: 40,
      height: 25,
    });
    const ctx = (canvas as Canvas).getContext("2d");
    const { data } = ctx.getImageData(0, 0, 40, 25);
    for (let i = 3; i < data.length; i += 4) expect(data[i]).toBe(255);
  });

  it("draws its Cyrillic labels with a registered font, not tofu", () => {
    // ⚠️ Node canvas has no Cyrillic fallback, so an unregistered font draws boxes — in an
    // image nobody reviews pixel by pixel, at the right size, over the byte floor, past every
    // other assertion in this file. `drawFrame` registers, so this asserts the registration
    // actually took AND that the labels are drawn at all.
    drawFrame({ world, programme: "tour", t: 0, width: 200, height: 125 });
    expect(GlobalFonts.families.map((f) => f.family)).toContain("Inter");
    const withLabels = drawFrame({
      world,
      state: { ...stateAt(PROGRAMMES.tour, 0), labels: 1 },
      width: 400,
      height: 250,
    }).toBuffer("image/png");
    const without = drawFrame({
      world,
      state: { ...stateAt(PROGRAMMES.tour, 0), labels: 0 },
      width: 400,
      height: 250,
    }).toBuffer("image/png");
    expect(withLabels.equals(without)).toBe(false);
  });

  it("uses a hex palette, which `mixHex` is the reason for", () => {
    for (const [key, value] of Object.entries(BRAND_PALETTE)) {
      const values = typeof value === "string" ? [value] : Object.values(value);
      for (const v of values) {
        expect(v, `${key}: ${v}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});

describe("parseArgs", () => {
  it("defaults to EVERY committed still, which is what the gate expects", () => {
    // ⚠️ The default renders the full set and `--home-only` narrows it, not the other way
    // round: with the flags inverted, the command this file documents and the bare npm script
    // rewrote the manifest down to three entries and red-failed the gate above — while
    // re-stamping `computedAt` onto a share card and five stills it had not re-rendered.
    expect(parseArgs([])).toEqual({ homeOnly: false });
    expect(parseArgs(["--home-only"])).toEqual({ homeOnly: true });
    expect(
      PROGRAMME_IDS.length + 1 + ARTICLE_CHAPTERS.length,
      "the gate's expected set must equal what the default invocation renders",
    ).toBe(10);
  });

  it("reads the single-frame tuning flags", () => {
    expect(parseArgs(["--programme", "arcs", "--t", "12"])).toEqual({
      homeOnly: false,
      programme: "arcs",
      t: 12,
    });
  });

  it("keeps an absolute --out absolute", () => {
    // `path.join(ROOT, "/tmp/f.png")` is `<repo>/tmp/f.png`; the harness's whole point is that
    // it touches nothing committed, and the bug is invisible on every relative poster path.
    expect(parseArgs(["--out", "/tmp/f.png"]).out).toBe("/tmp/f.png");
    expect(path.resolve(ROOT, "/tmp/f.png")).toBe("/tmp/f.png");
    expect(path.join(ROOT, "/tmp/f.png")).not.toBe("/tmp/f.png");
  });

  it("refuses a flag with no value or an unknown programme", () => {
    expect(() => parseArgs(["--programme"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--programme", "map"])).toThrow(/not one of/);
    expect(() => parseArgs(["--t", "soon"])).toThrow(/not a number/);
    expect(() => parseArgs(["--chapters"])).toThrow(/unknown argument/);
    expect(() => parseArgs(["--out", "/tmp/f.png", "typo"])).toThrow(
      /unknown argument/,
    );
  });
});

describe("createCanvas sanity", () => {
  it("encodes webp, which every committed poster path requires", () => {
    // This is a build dependency, not a format fallback: the manifest and article paths are
    // fixed `.webp` URLs, so silently writing PNG under another name would ship bad media.
    const c = createCanvas(4, 4) as Canvas;
    expect(c.toBuffer("image/webp").length).toBeGreaterThan(0);
  });
});
