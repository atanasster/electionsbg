// Incremental OG-image cache. A rendered card is a deterministic function of
// its input data, so we hash those inputs and skip re-encoding any card whose
// inputs haven't changed since the last build. Without this, every build
// re-renders ~7k candidate cards even when nothing changed.
//
// The cache survives `vite build` (which only wipes dist/) because it lives
// under node_modules/.cache/ — the conventional spot for build-tool caches
// (babel, eslint, ...), and already covered by the node_modules .gitignore.
//
// On a cache hit the cached file is copied into dist/og/. On a miss the
// renderFn runs, its bytes are written to BOTH dist/og/ and the cache, and
// the manifest entry is updated. Bump RENDERER_VERSION whenever the visual
// output of any renderer changes — that invalidates the whole cache.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Bump when cardRenderer.ts / candidateCard.ts visual output changes so a
// layout tweak doesn't silently serve stale cards from the cache.
export const RENDERER_VERSION = 1;

type Manifest = { rendererVersion: number; entries: Record<string, string> };

const sha1 = (s: string | Buffer): string =>
  crypto.createHash("sha1").update(s).digest("hex");

// Content hash of a file, or "" if it's missing. Include in a card's
// fingerprint when the card composites an external asset (e.g. an MP photo)
// so the card re-renders if the asset changes. mtime is unreliable here — a
// fresh `git clone` resets it — so we hash the bytes.
export const hashFile = (filePath: string): string => {
  try {
    return sha1(fs.readFileSync(filePath));
  } catch {
    return "";
  }
};

export type OgCache = {
  // relPath is relative to dist/og/ (e.g. "home.png", "candidate/Иван.webp").
  // fingerprint is any JSON-serialisable description of the render inputs.
  // renderFn may be async — it only runs on a cache miss, so the (common)
  // hit path never pays for image decoding or encoding.
  render: (
    relPath: string,
    fingerprint: unknown,
    renderFn: () => Buffer | Promise<Buffer>,
  ) => Promise<"hit" | "miss">;
  save: () => { hits: number; misses: number };
};

export const createOgCache = (projectRoot: string): OgCache => {
  const distOgDir = path.join(projectRoot, "dist", "og");
  const cacheDir = path.join(projectRoot, "node_modules", ".cache", "og");
  const manifestPath = path.join(cacheDir, "manifest.json");
  fs.mkdirSync(cacheDir, { recursive: true });

  let manifest: Manifest = { rendererVersion: RENDERER_VERSION, entries: {} };
  if (fs.existsSync(manifestPath)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      // A renderer-version bump invalidates every entry — start fresh.
      if (loaded?.rendererVersion === RENDERER_VERSION && loaded.entries) {
        manifest = loaded;
      }
    } catch {
      // corrupt manifest — start fresh
    }
  }

  // Only entries touched this run are carried forward, so a removed card
  // (e.g. a party that dropped off the ballot) drops out of the manifest.
  const next: Manifest = { rendererVersion: RENDERER_VERSION, entries: {} };
  let hits = 0;
  let misses = 0;

  const render = async (
    relPath: string,
    fingerprint: unknown,
    renderFn: () => Buffer | Promise<Buffer>,
  ): Promise<"hit" | "miss"> => {
    const hash = sha1(JSON.stringify(fingerprint));
    const distPath = path.join(distOgDir, relPath);
    const cachePath = path.join(cacheDir, relPath);
    fs.mkdirSync(path.dirname(distPath), { recursive: true });

    if (manifest.entries[relPath] === hash && fs.existsSync(cachePath)) {
      fs.copyFileSync(cachePath, distPath);
      next.entries[relPath] = hash;
      hits++;
      return "hit";
    }
    const buf = await renderFn();
    fs.writeFileSync(distPath, buf);
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, buf);
    next.entries[relPath] = hash;
    misses++;
    return "miss";
  };

  const save = () => {
    fs.writeFileSync(manifestPath, JSON.stringify(next));
    return { hits, misses };
  };

  return { render, save };
};
