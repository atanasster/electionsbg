// The money-map article's static images, drawn in Node by the SAME engine the browser runs.
// `docs/plans/home-flyover-v1.md` §8.3.
//
//   npm run home:flyover-posters                          # the article's share card + chapter stills
//   npm run home:flyover-posters -- --chapter goes --out /tmp/f.png   # one chapter, uncommitted
//
// ⚠️ A MANUAL, OPERATOR-RUN TOOL — it is in no chain. What it renders is one dated article's
// share card (`public/og/money-map.png`) and its six chapter stills. They are COMMITTED and FROZEN:
// nothing requires them to track the daily `data/home/flyover.json`, and re-rendering them on
// every watcher run only put a pending hosting deploy on every day. Re-run this by hand when
// the article's pictures should change, then commit and deploy hosting.
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
// The single-frame mode (`--chapter`) is the camera-tuning harness: it draws one chapter
// exactly as the committed still would be drawn, wherever it is told, and touches nothing
// committed.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { registerFonts } from "../brand/lib/brandMark";
import { render, type Ctx2D } from "../../src/lib/flyover/render";
import {
  ARTICLE_BACKGROUND,
  ARTICLE_PALETTE,
  articlePresentationState,
} from "../../src/lib/flyover/articlePresentation";
import {
  ARTICLE_CHAPTERS,
  resolveArticleChapters,
} from "../../src/lib/flyover/programmes/tour";
import type { FlyoverState } from "../../src/lib/flyover/state";
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

/** The frame the artifact is projected into, and therefore the poster's aspect ratio. */
export const POSTER_W = 1000;
export const POSTER_H = 625;

/** The OG clip is 1200×630; the card is a 2× render of it, like `public/og/home.png`. */
export const OG_W = 2400;
export const OG_H = 1260;

export const loadWorld = (): FlyoverWorld => {
  return JSON.parse(artifactBytes().toString("utf8")) as FlyoverWorld;
};

/**
 * A chapter's state as the article sees it: accreted onto every chapter before it, because a
 * state drawn from one chapter's patch alone would be missing every field the earlier ones set.
 */
export const chapterState = (id: string): FlyoverState => {
  const i = ARTICLE_CHAPTERS.findIndex((c) => c.id === id);
  const state = i === -1 ? undefined : resolveArticleChapters()[i];
  if (!state) {
    throw new Error(
      `flyover_posters: no chapter \`${id}\` — one of ${ARTICLE_CHAPTERS.map((c) => c.id).join(", ")}`,
    );
  }
  return state;
};

export interface FrameSpec {
  world: FlyoverWorld;
  state: FlyoverState;
  width: number;
  height: number;
  lang?: "bg" | "en";
  maxFlows?: number;
  palette?: FlyoverPalette;
  background?: string;
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
  render(ctx as unknown as Ctx2D, spec.world, spec.state, {
    viewport: { w: spec.width, h: spec.height },
    palette: spec.palette ?? ARTICLE_PALETTE,
    clock: 0,
    lang: spec.lang ?? "bg",
    maxFlows: spec.maxFlows,
  });
  // ⚠️ BEHIND, AFTER THE FACT. `render` opens with `clearRect`, so a backdrop painted first is
  // erased — and the poster then ships with a transparent sea, through which the page's own
  // theme shows. `destination-over` is what puts it under the scene instead.
  ctx.save();
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = spec.background ?? ARTICLE_BACKGROUND;
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

/** One rendered file. */
export interface WrittenFile {
  rel: string;
  bytes: number;
}

/**
 * The article's share card, composed from the tour's chapter 2 — „where the money goes", the
 * arcs, which is the picture the article is about.
 *
 * ⚠️ Article OG images are COMMITTED FILES named by `ogImage` in `public/articles/index.json`,
 * not captures: `scripts/og/capture-screens.ts` has no entry for any article.
 */
export const renderOgCard = (world: FlyoverWorld): WrittenFile => {
  const state = chapterState("goes");
  const rel = "public/og/money-map.png";
  return {
    rel,
    bytes: writeImage(
      drawFrame({
        world,
        state: articlePresentationState(state),
        width: OG_W,
        height: OG_H,
      }),
      rel,
    ),
  };
};

/** One still per article chapter, from the same table the article's sections are built on. */
export const renderChapterStills = (world: FlyoverWorld): WrittenFile[] => {
  return ARTICLE_CHAPTERS.map((chapter) => {
    const rel = `public/articles/money-map/${chapter.id}.webp`;
    return {
      rel,
      bytes: writeImage(
        drawFrame({
          world,
          state: articlePresentationState(chapterState(chapter.id)),
          width: POSTER_W,
          height: POSTER_H,
        }),
        rel,
      ),
    };
  });
};

export interface PosterArgs {
  chapter?: string;
  out?: string;
}

export const parseArgs = (argv: readonly string[]): PosterArgs => {
  const valueFlags = new Set(["--chapter", "--out"]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
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
  const chapter = flag("chapter");
  const ids = ARTICLE_CHAPTERS.map((c) => c.id);
  if (chapter && !ids.includes(chapter)) {
    throw new Error(
      `flyover_posters: --chapter ${chapter} is not one of ${ids.join(", ")}`,
    );
  }
  const out = flag("out");
  return {
    ...(chapter ? { chapter } : {}),
    ...(out ? { out } : {}),
  };
};

const run = (argv: readonly string[]): void => {
  const args = parseArgs(argv);
  registerFonts();
  const world = loadWorld();

  // Single-frame mode: the camera-tuning harness. It writes ONE file wherever it is told and
  // touches nothing committed.
  if (args.chapter !== undefined || args.out) {
    const chapter = args.chapter ?? "buys";
    const rel = args.out ?? path.join(os.tmpdir(), "flyover_frame.png");
    const bytes = writeImage(
      drawFrame({
        world,
        state: articlePresentationState(chapterState(chapter)),
        width: POSTER_W,
        height: POSTER_H,
      }),
      rel,
    );
    console.log(`flyover_posters: ${chapter} → ${rel} (${bytes} B)`);
    return;
  }

  const written: WrittenFile[] = [
    renderOgCard(world),
    ...renderChapterStills(world),
  ];
  console.log(
    `flyover_posters: computedAt=${world.computedAt}\n  ` +
      written.map((w) => `${w.rel} (${w.bytes} B)`).join("\n  "),
  );
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  run(process.argv.slice(2));
}
