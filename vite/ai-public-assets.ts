import fs from "node:fs";
import path from "node:path";

export const AI_PUBLIC_ASSETS = [
  "fonts",
  "favicon.svg",
  "favicon.ico",
  "favicon-16x16.png",
  "favicon-32x32.png",
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
  "icon-512-maskable.png",
  "site.webmanifest",
] as const;

export const AI_SEO_IMAGES = [
  "og.png",
  "evals-og.png",
  "tools-og.png",
] as const;

export const AI_EXPECTED_OUTPUT_ENTRIES = [
  "index.html",
  "assets",
  ...AI_PUBLIC_ASSETS,
  ...AI_SEO_IMAGES,
  "robots.txt",
  "sitemap.xml",
  "llms.txt",
  "evals.html",
  "tools.html",
  "legacy-export.html",
] as const;

export const isAiPublicAsset = (relative: string): boolean =>
  AI_PUBLIC_ASSETS.some(
    (allowed) => relative === allowed || relative.startsWith(`${allowed}/`),
  );

export const copyAiPublicAssets = (
  sourceDir: string,
  outputDir: string,
): void => {
  for (const relative of AI_PUBLIC_ASSETS) {
    const source = path.join(sourceDir, relative);
    if (!fs.existsSync(source))
      throw new Error(`Required AI public asset is missing: ${relative}`);
    fs.cpSync(source, path.join(outputDir, relative), { recursive: true });
  }
};

export const copyAiSeoImages = (sourceDir: string, outputDir: string): void => {
  for (const relative of AI_SEO_IMAGES) {
    const source = path.join(sourceDir, relative);
    if (!fs.existsSync(source))
      throw new Error(`Required AI SEO image is missing: ${relative}`);
    fs.copyFileSync(source, path.join(outputDir, relative));
  }
};

export const assertAiOutput = (outputDir: string): void => {
  const expected = new Set<string>(AI_EXPECTED_OUTPUT_ENTRIES);
  const actual = fs.readdirSync(outputDir);
  const missing = [...expected].filter((entry) => !actual.includes(entry));
  const unexpected = actual.filter((entry) => !expected.has(entry));
  if (missing.length || unexpected.length) {
    throw new Error(
      `Invalid AI build output (missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"})`,
    );
  }
  for (const htmlName of [
    "index.html",
    "evals.html",
    "tools.html",
    "legacy-export.html",
  ]) {
    const html = fs.readFileSync(path.join(outputDir, htmlName), "utf8");
    const referencedImages = [
      ...html.matchAll(/https:\/\/ai\.electionsbg\.com\/([^"'<>\s?]+\.png)/g),
    ].map((match) => match[1]);
    for (const image of referencedImages) {
      if (!fs.existsSync(path.join(outputDir, image)))
        throw new Error(
          `AI page ${htmlName} references a missing image: ${image}`,
        );
    }
  }
};
