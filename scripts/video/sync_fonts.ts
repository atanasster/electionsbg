/**
 * Copies the site's self-hosted Inter into the Remotion project.
 *
 * WHY THIS EXISTS rather than a one-time manual copy: Cyrillic is the whole
 * point. `scripts/posts/cardKit.ts` documents that a missing glyph renders as a
 * silent tofu box — nothing throws — and a video multiplies that across ~900
 * frames instead of one card. Remotion renders in headless Chromium, where
 * "system-ui" is whatever the render host happens to have, so the font cannot be
 * left to chance. The site already ships an Inter with a Cyrillic subset
 * (`public/fonts/`, produced by `scripts/fonts/fetch-fonts.mjs`); this mirrors
 * exactly those files so the two never drift.
 *
 *   npm run video:fonts
 *
 * Re-run after `scripts/fonts/fetch-fonts.mjs`.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SRC_DIR = resolve("public/fonts");
const OUT_DIR = resolve("video/public/fonts");

export const rewriteInterCss = (css: string): string => {
  // Keep only the Inter faces (Fraunces is a display face the videos do not use)
  // and repoint every url(/fonts/x.woff2) at the sibling copy.
  const blocks = css.split("@font-face").filter((b) => /'Inter'/.test(b));
  return blocks
    .map((b) => `@font-face${b.replace(/url\(\/fonts\//g, "url(./")}`)
    .join("")
    .trim();
};

const main = () => {
  if (!existsSync(SRC_DIR)) {
    console.error(
      `No ${SRC_DIR}. Run \`node scripts/fonts/fetch-fonts.mjs\` first.`,
    );
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });

  const files = readdirSync(SRC_DIR).filter(
    (f) => f.startsWith("inter-") && f.endsWith(".woff2"),
  );
  if (!files.length) {
    console.error(`No inter-*.woff2 in ${SRC_DIR}.`);
    process.exit(1);
  }
  for (const f of files) copyFileSync(resolve(SRC_DIR, f), resolve(OUT_DIR, f));

  const css = rewriteInterCss(
    readFileSync(resolve(SRC_DIR, "fonts.css"), "utf8"),
  );
  // A Cyrillic subset must survive the filter, or the copy is worse than useless:
  // the render would silently fall back and every Bulgarian glyph could tofu.
  if (!/U\+0400-045F/.test(css)) {
    console.error(
      "Refusing to write: no Cyrillic unicode-range in the Inter faces. " +
        "Check public/fonts/fonts.css.",
    );
    process.exit(1);
  }
  writeFileSync(resolve(OUT_DIR, "inter.css"), `${css}\n`, "utf8");

  console.log(`Inter → ${OUT_DIR}`);
  console.log(`  ${files.length} woff2 + inter.css (Cyrillic subset present)`);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
