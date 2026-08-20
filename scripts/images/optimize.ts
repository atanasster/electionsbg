// Postbuild step: convert dist/ image assets to webp, delete the originals,
// rewrite every reference to them, and then PROVE no reference survived.
// Saves ~70% on the article image set, and shrinks the social-card set
// substantially.
//
// Scope is intentionally narrow:
//   - dist/articles/images/**     — body images embedded in long-form posts
//   - dist/og/**                   — social / Open Graph cards. Modern crawlers
//                                    (Facebook, Twitter, Telegram, Google) all
//                                    handle webp. The candidate-page cards are
//                                    already emitted as webp by og/generate.ts,
//                                    so this pass only catches the rendered
//                                    PNG cards + Playwright-captured screens.
// Skipped:
//   - dist/images/**               — favicons / brand glyphs (multiple sizes)
//   - dist/assets/**               — Vite-built hashed assets (renaming would
//                                    desync the bundler's import graph). Note
//                                    this is about renaming the ASSETS; their
//                                    CONTENT is rewritten like everything else,
//                                    see "the rewrite set" below.
//   - dist/parliament/**           — MP photos referenced via external URL
//                                    (https://www.parliament.bg/...) so no
//                                    local files to convert anyway.
//
// ── The rewrite set, and why it is a denylist ────────────────────────────────
// Until 2026-08-20 the rewrite ran over an ALLOWLIST of text extensions
// (.html .htm .json .xml .md .txt .webmanifest). `dist/assets/*.js` was not in
// it, so an image path hard-coded in a React component pointed at a file this
// pass had just deleted — a broken image on prod, served at a 200, and
// invisible in dev where the PNG still exists. It never fired only because the
// two components that embed such images sidestep it by hand (one emits webp,
// which is not a convert candidate; the other lives outside CONVERT_ROOTS).
//
// The allowlist is now a BINARY denylist plus a NUL-byte sniff, so a new text
// format (.js, .css, .svg, .mjs, .csv, whatever ships next) is covered the day
// it appears rather than the day someone remembers to add it. Rewriting a
// hashed `.js` is safe: Vite computes the content hash BEFORE this pass runs,
// so filenames stay stable and consistent across builds — the hash simply
// stops being a digest of the final bytes, which nothing here relies on (no
// SRI, no sourcemaps).
//
// ── The gate ─────────────────────────────────────────────────────────────────
// A wider rewrite set is not a proof. Pass 3 re-scans every file the rewrite
// could see and FAILS THE BUILD on any surviving reference to a file this pass
// deleted, or to any missing file under a convert root. That is the part that
// closes the class rather than the instance: a reference the rewrite cannot
// reach (a path assembled at runtime from fragments, a format the sniff calls
// binary) becomes a loud build failure instead of a silent 404 on prod.

import { readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const DIST = path.join(PROJECT_ROOT, "dist");

// Directory roots (relative to dist/) that are ELIGIBLE for webp conversion.
// Anything outside this list is left untouched.
export const CONVERT_ROOTS = ["articles/images", "og"];

// Globs (matched against paths relative to dist/) excluded from conversion
// even when they sit under a CONVERT_ROOT — currently empty, kept for
// future allowlist-with-exceptions.
const EXCLUDE_PATHS: RegExp[] = [];

// The convertible extensions, LOWERCASE ONLY, shared by `isConvertCandidate`
// and `REFERENCE_RE` so the two cannot drift. Case matters: a case-insensitive
// candidate test paired with a case-sensitive reference scan would convert
// `FOO.PNG`, delete it, and then neither rewrite nor flag the reference — the
// exact silent hole this file exists to close. `assertLowercaseExt` refuses
// such a file instead (there are none in dist today).
export const CONVERT_EXTS = ["png", "jpg", "jpeg"] as const;

// Extensions never scanned for references. Everything else is read and, unless
// it sniffs as binary, rewritten + verified.
export const BINARY_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".avif",
  ".gif",
  ".ico",
  ".bmp",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp4",
  ".webm",
  ".mp3",
  ".wav",
  ".zip",
  ".gz",
  ".br",
  ".pdf",
]);

// Webp encode quality. 82 is a sweet spot for photographs and screenshots
// (the article corpus is mostly screenshots) — visually indistinguishable
// from source on a Retina display while ~5x smaller than PNG.
const WEBP_QUALITY = 82;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// What a reference to a convertible image LOOKS LIKE in a text payload. One
// definition, used by both the rewrite and the gate, so the gate can never be
// satisfied by a shape the rewrite silently skipped.
//
// Two details are load-bearing:
//   - the lookbehind. Without it the `og` root matches inside an unrelated
//     path that merely ENDS in those letters — `/catalog/x.png` contains
//     `og/x.png` — and the rewrite would mangle it. `/` is deliberately NOT in
//     the class, because the ordinary absolute form `/og/x.png` must match.
//   - `%` in the path body. The og/party cards are percent-encoded Cyrillic on
//     disk (`og/party/%D0%9F%D0%9F-%D0%94%D0%91.png`), so a body class without
//     it truncates the match and the map lookup misses.
export const REFERENCE_RE = new RegExp(
  `(?<![A-Za-z0-9._%-])(?:${CONVERT_ROOTS.map(escapeRe).join("|")})/` +
    `[A-Za-z0-9._%/-]+\\.(?:${CONVERT_EXTS.join("|")})`,
  "g",
);

export const isConvertCandidate = (relPath: string): boolean => {
  if (EXCLUDE_PATHS.some((re) => re.test(relPath))) return false;
  if (
    !CONVERT_ROOTS.some(
      (root) => relPath.startsWith(root + "/") || relPath === root,
    )
  ) {
    return false;
  }
  const ext = path.extname(relPath).slice(1);
  return (CONVERT_EXTS as readonly string[]).includes(ext);
};

// A candidate whose extension differs only in case would be converted by a
// case-insensitive test and then left dangling by the case-sensitive scan.
// Refuse it rather than half-handle it.
export const assertLowercaseExt = (relPath: string): void => {
  const ext = path.extname(relPath).slice(1);
  if (
    !(CONVERT_EXTS as readonly string[]).includes(ext) &&
    (CONVERT_EXTS as readonly string[]).includes(ext.toLowerCase())
  ) {
    throw new Error(
      `optimize-images: ${relPath} has a non-lowercase image extension. ` +
        `Rename it to .${ext.toLowerCase()} — the reference scan is ` +
        `case-sensitive, so converting it would leave every reference dangling.`,
    );
  }
};

const toPosix = (p: string) => p.split(path.sep).join("/");

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

export type Conversion = { from: string; to: string };

const convertOne = async (absPath: string): Promise<Conversion | null> => {
  const ext = path.extname(absPath).slice(1);
  if (!(CONVERT_EXTS as readonly string[]).includes(ext)) return null;
  const dest = absPath.slice(0, -(ext.length + 1)) + ".webp";
  const src = await readFile(absPath);
  const out = await sharp(src).webp({ quality: WEBP_QUALITY }).toBuffer();
  // If webp ends up bigger than the original (rare — happens for tiny PNG
  // glyphs), keep the original instead.
  if (out.length >= src.length) return null;
  await writeFile(dest, out);
  await unlink(absPath);
  return { from: absPath, to: dest };
};

// dist-relative, slash-separated, no leading slash: `og/party/x.png`. That is
// the shape REFERENCE_RE yields, so map lookups are direct.
export const buildRewriteMap = (
  conversions: Conversion[],
  distRoot: string,
): Map<string, string> => {
  const map = new Map<string, string>();
  for (const { from, to } of conversions) {
    map.set(
      toPosix(path.relative(distRoot, from)),
      toPosix(path.relative(distRoot, to)),
    );
  }
  return map;
};

// Cheap reject so the regex never runs on the ~250k shards that mention no
// image root at all. Derived from CONVERT_ROOTS so it cannot drift.
const ROOT_HINTS = CONVERT_ROOTS.map((r) => r + "/");
export const mayReference = (text: string): boolean =>
  ROOT_HINTS.some((hint) => text.includes(hint));

// Rewrite every reference to a converted image. A match that is NOT in the map
// is left exactly as it was: it is a file under a convert root that was never
// converted (webp came out bigger, so the original was kept).
export const rewriteText = (text: string, map: Map<string, string>): string => {
  if (!mayReference(text)) return text;
  return text.replace(REFERENCE_RE, (m) => map.get(m) ?? m);
};

export type Residual = { ref: string; reason: "deleted" | "missing" };

// The gate. Anything REFERENCE_RE can see that points at a file which is no
// longer on disk is a dangling reference — whether this pass deleted it
// (`deleted`, i.e. the rewrite failed to reach this file) or it was never
// there (`missing`, a pre-existing broken link under a convert root).
export const findResidualRefs = (
  text: string,
  map: Map<string, string>,
  exists: (rel: string) => boolean,
): Residual[] => {
  if (!mayReference(text)) return [];
  const out: Residual[] = [];
  const seen = new Set<string>();
  for (const m of text.match(REFERENCE_RE) ?? []) {
    if (seen.has(m)) continue;
    seen.add(m);
    if (map.has(m)) out.push({ ref: m, reason: "deleted" });
    else if (!exists(m)) out.push({ ref: m, reason: "missing" });
  }
  return out;
};

const isScannable = (abs: string): boolean =>
  !BINARY_EXTS.has(path.extname(abs).toLowerCase());

// Read as text, or null when the bytes sniff as binary. The extension denylist
// is the fast path; the NUL sniff is what makes the denylist safe to be
// incomplete.
const readTextOrNull = async (abs: string): Promise<string | null> => {
  const buf = await readFile(abs);
  if (buf.includes(0)) return null;
  return buf.toString("utf-8");
};

export type OptimizeResult = {
  conversions: Conversion[];
  rewrittenFiles: number;
  savedBytes: number;
  residuals: { file: string; refs: Residual[] }[];
};

export const optimizeDist = async (
  distRoot: string,
): Promise<OptimizeResult> => {
  const allFiles: string[] = [];
  await walk(distRoot, allFiles);

  // Pass 1: convert candidate images to webp.
  const conversions: Conversion[] = [];
  let savedBytes = 0;
  for (const abs of allFiles) {
    const rel = toPosix(path.relative(distRoot, abs));
    assertLowercaseExt(rel);
    if (!isConvertCandidate(rel)) continue;
    const beforeSize = (await stat(abs)).size;
    const result = await convertOne(abs);
    if (result) {
      savedBytes += beforeSize - (await stat(result.to)).size;
      conversions.push(result);
    }
  }

  const map = buildRewriteMap(conversions, distRoot);
  const exists = (rel: string) => existsSync(path.join(distRoot, rel));

  // Pass 2 + 3 in one read: rewrite, then verify what is left. Re-walking for
  // the gate would double the I/O over a ~250k-file tree for no extra safety —
  // the rewrite is in-memory, so the post-rewrite text is already in hand.
  let rewrittenFiles = 0;
  const residuals: { file: string; refs: Residual[] }[] = [];
  for (const abs of allFiles) {
    if (!existsSync(abs)) continue; // deleted by pass 1
    if (!isScannable(abs)) continue;
    const before = await readTextOrNull(abs);
    if (before === null) continue;
    const after = map.size ? rewriteText(before, map) : before;
    if (after !== before) {
      await writeFile(abs, after, "utf-8");
      rewrittenFiles++;
    }
    const refs = findResidualRefs(after, map, exists);
    if (refs.length)
      residuals.push({ file: toPosix(path.relative(distRoot, abs)), refs });
  }

  return { conversions, rewrittenFiles, savedBytes, residuals };
};

const main = async () => {
  if (!existsSync(DIST)) {
    console.error(`dist/ not found at ${DIST} — run \`vite build\` first.`);
    process.exit(1);
  }

  const { conversions, rewrittenFiles, savedBytes, residuals } =
    await optimizeDist(DIST);

  if (!conversions.length) {
    console.log("optimize-images: no eligible files — skipping");
  } else {
    const mb = (n: number) => (n / 1024 / 1024).toFixed(2);
    console.log(
      `optimize-images: converted ${conversions.length} file(s) to webp, saved ${mb(savedBytes)} MB; rewrote ${rewrittenFiles} text file(s)`,
    );
  }

  if (residuals.length) {
    const total = residuals.reduce((n, r) => n + r.refs.length, 0);
    console.error(
      `\noptimize-images: ${total} dangling image reference(s) in ${residuals.length} file(s) AFTER the rewrite pass.\n` +
        `Each one is a 200-served broken image on prod. A "deleted" ref means this pass removed the file and could\n` +
        `not rewrite the reference — the path is probably assembled at runtime from fragments, so name it in full\n` +
        `at the call site (or emit the asset as .webp, which is never a convert candidate).\n`,
    );
    for (const { file, refs } of residuals.slice(0, 40)) {
      for (const { ref, reason } of refs) {
        console.error(`  ${reason.padEnd(7)} ${ref}  ←  ${file}`);
      }
    }
    if (residuals.length > 40) {
      console.error(`  … and ${residuals.length - 40} more file(s)`);
    }
    process.exit(1);
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error("optimize-images failed:", err);
    process.exit(1);
  });
}
