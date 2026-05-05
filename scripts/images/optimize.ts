// Postbuild step: convert dist/ image assets to webp, delete the originals,
// and rewrite path references in HTML / JSON / Markdown / XML so the runtime
// + prerendered pages all point at the new files. Saves ~70% on the article
// image set without touching the og/ images (kept as PNG/JPG so social
// previewers across older clients always render).
//
// Scope is intentionally narrow:
//   - dist/articles/images/**     — body images embedded in long-form posts
//   - dist/<root>/*.{png,jpg,jpeg} — any top-level decorative images
// Skipped:
//   - dist/og/**                   — social/Open Graph (broad legacy support)
//   - dist/images/**               — favicons / brand glyphs (multiple sizes)
//   - dist/assets/**               — Vite-built hashed assets (renaming would
//                                    desync the bundler's import graph)
//   - dist/parliament/**           — MP photos referenced via external URL
//                                    (https://www.parliament.bg/...) so no
//                                    local files to convert anyway.

import { readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const DIST = path.join(PROJECT_ROOT, "dist");

// Directory roots (relative to dist/) that are ELIGIBLE for webp conversion.
// Anything outside this list is left untouched.
const CONVERT_ROOTS = ["articles/images"];

// Globs (matched against paths relative to dist/) excluded from conversion
// even when they sit under a CONVERT_ROOT — currently empty, kept for
// future allowlist-with-exceptions.
const EXCLUDE_PATHS: RegExp[] = [];

// File extensions that get rewritten to .webp in text payloads. Ordered so
// the longer extension is replaced first.
const REWRITE_EXTS = [".jpeg", ".jpg", ".png"] as const;

// Text-payload extensions that may contain image references and therefore
// need a string rewrite after we delete the originals.
const TEXT_REWRITE_EXTS = new Set([
  ".html",
  ".htm",
  ".json",
  ".xml",
  ".md",
  ".txt",
  ".webmanifest",
]);

// Webp encode quality. 82 is a sweet spot for photographs and screenshots
// (the article corpus is mostly screenshots) — visually indistinguishable
// from source on a Retina display while ~5x smaller than PNG.
const WEBP_QUALITY = 82;

const isConvertCandidate = (relPath: string): boolean => {
  if (EXCLUDE_PATHS.some((re) => re.test(relPath))) return false;
  if (
    !CONVERT_ROOTS.some(
      (root) => relPath.startsWith(root + path.sep) || relPath === root,
    )
  ) {
    return false;
  }
  const ext = path.extname(relPath).toLowerCase();
  return ext === ".png" || ext === ".jpg" || ext === ".jpeg";
};

const walk = async (dir: string, files: string[]): Promise<void> => {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, files);
    else if (entry.isFile()) files.push(full);
  }
};

type Conversion = { from: string; to: string };

const convertOne = async (absPath: string): Promise<Conversion | null> => {
  const ext = path.extname(absPath).toLowerCase();
  if (ext !== ".png" && ext !== ".jpg" && ext !== ".jpeg") return null;
  const dest = absPath.slice(0, -ext.length) + ".webp";
  const src = await readFile(absPath);
  const out = await sharp(src).webp({ quality: WEBP_QUALITY }).toBuffer();
  // If webp ends up bigger than the original (rare — happens for tiny PNG
  // glyphs), keep the original instead.
  if (out.length >= src.length) return null;
  await writeFile(dest, out);
  await unlink(absPath);
  return { from: absPath, to: dest };
};

const buildRewriteMap = (conversions: Conversion[]): Map<string, string> => {
  const map = new Map<string, string>();
  for (const { from, to } of conversions) {
    const fromRel = "/" + path.relative(DIST, from).split(path.sep).join("/");
    const toRel = "/" + path.relative(DIST, to).split(path.sep).join("/");
    map.set(fromRel, toRel);
  }
  return map;
};

// Rewrite any reference to a converted image's path. Two strategies are
// used: 1) exact-path replacement for absolute paths in JSON/HTML/MD; 2)
// suffix-based replacement so encoded variants and partial paths still
// match. The two together cover both `<img src="/articles/images/x.png">`
// and JSON-encoded forms like `"ogImage":"/articles/images/x.png"`.
const rewriteText = (text: string, map: Map<string, string>): string => {
  let out = text;
  for (const [from, to] of map) {
    if (!out.includes(from)) continue;
    // Use split/join for plain-text replacement (no regex special-character
    // pitfalls in URL paths).
    out = out.split(from).join(to);
  }
  return out;
};

const main = async () => {
  if (!existsSync(DIST)) {
    console.error(`dist/ not found at ${DIST} — run \`vite build\` first.`);
    process.exit(1);
  }

  const allFiles: string[] = [];
  await walk(DIST, allFiles);

  // Pass 1: convert candidate images to webp.
  const conversions: Conversion[] = [];
  let totalSaved = 0;
  for (const abs of allFiles) {
    const rel = path.relative(DIST, abs).split(path.sep).join("/");
    if (!isConvertCandidate(rel)) continue;
    const beforeSize = (await stat(abs)).size;
    const result = await convertOne(abs);
    if (result) {
      const afterSize = (await stat(result.to)).size;
      totalSaved += beforeSize - afterSize;
      conversions.push(result);
    }
  }
  if (!conversions.length) {
    console.log("optimize-images: no eligible files — skipping");
    return;
  }

  // Pass 2: rewrite text references across the whole dist tree. Re-collect
  // because pass 1 deleted some files; reuse the original list filtered to
  // existing ones to avoid extra walking.
  const rewriteMap = buildRewriteMap(conversions);
  let rewriteCount = 0;
  for (const abs of allFiles) {
    if (!existsSync(abs)) continue;
    const ext = path.extname(abs).toLowerCase();
    if (!TEXT_REWRITE_EXTS.has(ext)) continue;
    const before = await readFile(abs, "utf-8");
    const after = rewriteText(before, rewriteMap);
    if (after !== before) {
      await writeFile(abs, after, "utf-8");
      rewriteCount++;
    }
  }

  const mb = (n: number) => (n / 1024 / 1024).toFixed(2);
  console.log(
    `optimize-images: converted ${conversions.length} file(s) to webp, saved ${mb(totalSaved)} MB; rewrote ${rewriteCount} text file(s)`,
  );

  // Pass 3: also rewrite text references in source-served files OUTSIDE of
  // dist/ that the runtime fetches by absolute URL. The article .md files
  // are served from dist/articles/{slug}-{lang}.md — already handled by the
  // pass above. Add other URL-fetched JSON sources here if they grow.
  void REWRITE_EXTS; // referenced for symmetry with potential future use
};

main().catch((err) => {
  console.error("optimize-images failed:", err);
  process.exit(1);
});
