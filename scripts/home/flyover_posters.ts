// The flyover's static posters, drawn in Node by the SAME engine the browser runs.
// `docs/plans/home-flyover-v1.md` §8.3.
//
//   npm run home:flyover-posters                       # every committed poster and share card
//   npm run home:flyover-posters -- --home-only        # only the three home posters
//   npm run home:flyover-posters -- --programme columns --t 12 --out /tmp/f.png
//
// ⚠️⚠️ THE POSTER IS NOT DECORATIVE AND NOT OPTIONAL. It is the reserved box that holds CLS at
// zero on the site's entry page, the reduced-motion state, the Save-Data state, the Suspense
// fallback and the image in the prerendered body — five contracts, one file each (plan §14).
// „The canvas loads fast enough" breaks all five at once.
//
// ⚠️ COMMITTED, AND GENERATED BEFORE `npm run build`. Vite copies `public/` into `dist/`
// during the build, so a `postbuild` step would write files the deploy never ships — the same
// reason the OG capture and the sitemap run before the build rather than after it.
//
// ⚠️ CYRILLIC NEEDS A REGISTERED FONT. Node canvas has no system fallback for it, so without
// `registerFonts()` the city labels — the only text the canvas draws — come out as boxes, in
// an image nobody reviews pixel by pixel. The brand art has the same requirement and the same
// call.
//
// The single-frame mode is the camera-tuning harness (plan §4 and §13): there is no
// `/dev/flyover` route, because `ogAndSitemapCoverage.test.ts` requires every routed page to
// be declared or exempt ON MERIT and a tuning page has no merit to claim.

import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { registerFonts } from "../brand/lib/brandMark";
import { render, type Ctx2D } from "../../src/lib/flyover/render";
import {
  PROGRAMMES,
  PROGRAMME_IDS,
  stateAt,
} from "../../src/lib/flyover/programmes";
import {
  ARTICLE_CHAPTERS,
  TOUR_CHAPTERS,
} from "../../src/lib/flyover/programmes/tour";
import { applyPartial, STATE_ZERO } from "../../src/lib/flyover/state";
import type { ProgrammeId } from "../../src/lib/flyover/programmes";
import type { FlyoverWorld } from "../../src/lib/flyover/types";
import type { FlyoverPalette } from "../../src/lib/flyover/layers";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const ARTIFACT_REL = "data/home/flyover.json";

const artifactBytes = (): Buffer => {
  const p = path.join(ROOT, ARTIFACT_REL);
  if (!fs.existsSync(p)) {
    throw new Error(
      `flyover_posters: ${ARTIFACT_REL} is missing — run npm run db:gen-home-flyover`,
    );
  }
  return fs.readFileSync(p);
};

/** SHA-256 of the exact served artifact bytes: the poster freshness correctness key. */
export const artifactSha256 = (): string =>
  createHash("sha256").update(artifactBytes()).digest("hex");

/** The frame the artifact is projected into, and therefore the poster's aspect ratio. */
export const POSTER_W = 1000;
export const POSTER_H = 625;

/** The OG clip is 1200×630; the card is a 2× render of it, like `public/og/home.png`. */
export const OG_W = 2400;
export const OG_H = 1260;

/**
 * The brand palette, in HEX.
 *
 * ⚠️ HEX IS A CONTRACT, not a style choice — `mixHex` parses nothing else and silently
 * collapses to an endpoint otherwise, which flattens the column shading, posterises the price
 * ramp and turns the election cross-fade into a hard cut, all at once. `FlyoverPalette`'s own
 * doc says so; this is the Node/Remotion side of it, where the values are ours rather than a
 * theme's.
 */
export const BRAND_PALETTE: FlyoverPalette = {
  land: "#132038",
  landEdge: "#25344f",
  landHighlight: "#df6b43",
  column: { proc: "#4ea3d8", funds: "#9b7fd4", agri: "#5fbf78" },
  arcIn: "#df6b43",
  arcOut: "#5fbf78",
  arcNeutral: "#7d8ba4",
  label: "#f2f5f8",
  labelHalo: "#0b1224",
  priceDown: "#5fbf78",
  priceUp: "#df6b43",
};

/** The ground the scene sits on. The engine clears to transparent; posters are opaque. */
const BACKDROP = BRAND_PALETTE.labelHalo;

export const loadWorld = (): FlyoverWorld => {
  return JSON.parse(artifactBytes().toString("utf8")) as FlyoverWorld;
};

export interface FrameSpec {
  world: FlyoverWorld;
  programme?: ProgrammeId;
  /** Seconds into the programme's loop. */
  t?: number;
  /** A state to draw directly, instead of a programme at `t`. */
  state?: Parameters<typeof render>[2];
  width: number;
  height: number;
  lang?: "bg" | "en";
  maxFlows?: number;
}

/**
 * Draw one frame to a canvas.
 *
 * ⚠️ `clock: 0`, ALWAYS. The clock drives the arcs' dash offset and nothing else, so pinning
 * it is what makes two runs of one artifact produce identical bytes — a poster that jittered
 * would put a meaningless diff in `public/` on every regeneration, on files whose diff is how
 * a reviewer sees that the map changed.
 */
export const drawFrame = (spec: FrameSpec): Canvas => {
  // ⚠️ HERE, not only in `run()`. Node canvas has no Cyrillic fallback, so an unregistered
  // font draws the city labels — the only text the canvas draws — as boxes, in an image
  // nobody reviews pixel by pixel. Registering inside the draw (it is idempotent) is what
  // makes every test measure the path that writes the committed posters rather than a
  // font-less one that happens to be deterministic for a different reason.
  registerFonts();
  const canvas = createCanvas(spec.width, spec.height) as Canvas;
  const ctx = canvas.getContext("2d") as SKRSContext2D;
  const state =
    spec.state ?? stateAt(PROGRAMMES[spec.programme ?? "columns"], spec.t ?? 0);
  render(ctx as unknown as Ctx2D, spec.world, state, {
    viewport: { w: spec.width, h: spec.height },
    palette: BRAND_PALETTE,
    clock: 0,
    lang: spec.lang ?? "bg",
    maxFlows: spec.maxFlows,
  });
  // ⚠️ BEHIND, AFTER THE FACT. `render` opens with `clearRect`, so a backdrop painted first is
  // erased — and the poster then ships with a transparent sea, through which the page's own
  // theme shows. `destination-over` is what puts it under the scene instead.
  ctx.save();
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, spec.width, spec.height);
  ctx.restore();
  return canvas;
};

const writeImage = (canvas: Canvas, rel: string): number => {
  // ⚠️ `resolve`, NOT `join`. `path.join(ROOT, "/tmp/f.png")` is `<repo>/tmp/f.png` — join
  // concatenates rather than honouring a leading slash — so the documented tuning invocation
  // wrote into the repo instead of where it was told, and an operator inspecting /tmp/f.png
  // tuned the camera against a stale file or concluded the harness was broken.
  const dest = path.resolve(ROOT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // Committed poster paths are WebP and therefore require @napi-rs/canvas WebP support. The
  // tuning harness may use PNG when its explicit --out path ends in .png.
  const buf = dest.endsWith(".webp")
    ? canvas.toBuffer("image/webp")
    : canvas.toBuffer("image/png");
  fs.writeFileSync(dest, buf);
  return buf.length;
};

/**
 * What was rendered, and from which vintage of the artifact.
 *
 * ⚠️ A MANIFEST RATHER THAN AN MTIME COMPARISON, which is what the plan's §8.3 asks for and
 * cannot have: git does not preserve modification times, so on a fresh clone or in CI both the
 * posters and the artifact carry the checkout time and „is the poster newer" has no answer.
 * `artifactSha256` pins the exact bytes. `computedAt` is retained only as useful operator
 * metadata: it is the latest contract date and does not change when another layer changes.
 */
export interface PosterManifest {
  artifactSha256: string;
  computedAt: string;
  posters: string[];
}

export const MANIFEST_REL = "public/flyover/manifest.json";

const writeManifest = (world: FlyoverWorld, posters: string[]): string => {
  const body: PosterManifest = {
    artifactSha256: artifactSha256(),
    computedAt: world.computedAt,
    posters: [...posters].sort(),
  };
  const dest = path.join(ROOT, MANIFEST_REL);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(body, null, 2) + "\n");
  return MANIFEST_REL;
};
/** One rendered file. Structured, so the manifest is never recovered by parsing a log line. */
export interface WrittenFile {
  rel: string;
  bytes: number;
}

/** The three home posters: each programme at the state it opens on. */
export const renderHomePosters = (world: FlyoverWorld): WrittenFile[] =>
  PROGRAMME_IDS.map((id) => {
    const rel = `public/flyover/${id}.webp`;
    return {
      rel,
      bytes: writeImage(
        drawFrame({
          world,
          // The home view is a small preview beside search; preserve full labels in the
          // article stills, but avoid microscopic names on the three home thumbnails.
          state: { ...stateAt(PROGRAMMES[id], 0), labels: 0 },
          maxFlows: 12,
          width: POSTER_W,
          height: POSTER_H,
        }),
        rel,
      ),
    };
  });

/**
 * The article's share card, composed from the tour's chapter 2 — „where the money goes", the
 * arcs, which is the picture the article is about.
 *
 * ⚠️ Article OG images are COMMITTED FILES named by `ogImage` in `public/articles/index.json`,
 * not captures: `scripts/og/capture-screens.ts` has no entry for any article.
 */
export const renderOgCard = (world: FlyoverWorld): WrittenFile => {
  const chapter = TOUR_CHAPTERS.find((c) => c.id === "goes");
  if (!chapter) {
    throw new Error("flyover_posters: the tour has no `goes` chapter");
  }
  const state = applyPartial(STATE_ZERO, chapter.state);
  const rel = "public/og/money-map.png";
  return {
    rel,
    bytes: writeImage(
      drawFrame({ world, state, width: OG_W, height: OG_H }),
      rel,
    ),
  };
};

/** One still per article chapter, from the same table the article's sections are built on. */
export const renderChapterStills = (world: FlyoverWorld): WrittenFile[] => {
  const out: WrittenFile[] = [];
  let running = STATE_ZERO;
  for (const chapter of ARTICLE_CHAPTERS) {
    // The chapters ACCRETE, exactly as the loop does — a still drawn from one chapter's patch
    // alone would be missing every field the chapters before it set.
    // The article keeps its labels and full flow detail; home posters use a simpler preview.
    running = applyPartial(running, chapter.state);
    const rel = `public/articles/money-map/${chapter.id}.webp`;
    out.push({
      rel,
      bytes: writeImage(
        drawFrame({ world, state: running, width: POSTER_W, height: POSTER_H }),
        rel,
      ),
    });
  }
  return out;
};

export interface PosterArgs {
  /**
   * Render only the three home posters. The DEFAULT is everything the gate expects — see the
   * header for why the flag points this way round.
   */
  homeOnly: boolean;
  programme?: ProgrammeId;
  t?: number;
  out?: string;
}

export const parseArgs = (argv: readonly string[]): PosterArgs => {
  const valueFlags = new Set(["--programme", "--t", "--out"]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--home-only") continue;
    if (!valueFlags.has(arg)) {
      throw new Error(`flyover_posters: unknown argument ${arg}`);
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`flyover_posters: ${arg} needs a value`);
    }
    i++;
  }
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    if (i === -1) return undefined;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) {
      throw new Error(`flyover_posters: --${name} needs a value`);
    }
    return v;
  };
  const programme = flag("programme");
  if (programme && !(PROGRAMME_IDS as readonly string[]).includes(programme)) {
    throw new Error(
      `flyover_posters: --programme ${programme} is not one of ${PROGRAMME_IDS.join(", ")}`,
    );
  }
  const rawT = flag("t");
  const t = rawT === undefined ? undefined : Number(rawT);
  if (t !== undefined && !Number.isFinite(t)) {
    throw new Error(`flyover_posters: --t ${rawT} is not a number`);
  }
  const out = flag("out");
  return {
    homeOnly: argv.includes("--home-only"),
    ...(programme ? { programme: programme as ProgrammeId } : {}),
    ...(t === undefined ? {} : { t }),
    ...(out ? { out } : {}),
  };
};

const run = (argv: readonly string[]): void => {
  const args = parseArgs(argv);
  registerFonts();
  const world = loadWorld();

  // Single-frame mode: the camera-tuning harness. It writes ONE file wherever it is told and
  // touches nothing committed.
  if (args.programme !== undefined || args.t !== undefined || args.out) {
    const rel = args.out ?? "public/flyover/_frame.png";
    const bytes = writeImage(
      drawFrame({
        world,
        programme: args.programme ?? "columns",
        t: args.t ?? 0,
        width: POSTER_W,
        height: POSTER_H,
      }),
      rel,
    );
    console.log(
      `flyover_posters: ${args.programme ?? "columns"} @ t=${args.t ?? 0} → ${rel} (${bytes} B)`,
    );
    return;
  }

  const written: WrittenFile[] = [
    ...renderHomePosters(world),
    ...(args.homeOnly
      ? []
      : [renderOgCard(world), ...renderChapterStills(world)]),
  ];
  // The manifest records only what THIS run produced, so `--home-only` does not claim a card
  // it did not draw — and the gate then names the missing entries rather than passing.
  const manifest = writeManifest(
    world,
    written.map((w) => w.rel),
  );
  console.log(
    `flyover_posters: computedAt=${world.computedAt}\n  ` +
      written.map((w) => `${w.rel} (${w.bytes} B)`).join("\n  ") +
      `\n  ${manifest}`,
  );
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  run(process.argv.slice(2));
}
