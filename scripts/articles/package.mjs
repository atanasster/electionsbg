import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const publication = JSON.parse(
  fs.readFileSync(
    path.join(root, "src/lib/chatLaunchPublication.json"),
    "utf8",
  ),
);

const safeSlug = (slug) =>
  typeof slug === "string" && /^[a-z0-9][a-z0-9-]*$/.test(slug);

export function packageArticles(publicDir, distDir, preview = false) {
  const all = JSON.parse(
    fs.readFileSync(path.join(publicDir, "articles/index.json"), "utf8"),
  );
  const launch = all.find((a) => a.slug === publication.slug);
  if (launch && publication.published === !!launch.draft)
    throw new Error(
      "Chat invitation publication flag and article draft status disagree",
    );
  const selected = preview ? publication.slug : null;
  const visible = all.filter((a) => !a.draft || a.slug === selected);
  const excluded = all.filter((a) => a.draft && a.slug !== selected);
  for (const article of excluded) {
    if (!safeSlug(article.slug)) throw new Error("Invalid draft slug");
    for (const lang of ["bg", "en"]) {
      fs.rmSync(path.join(distDir, "articles", `${article.slug}-${lang}.md`), {
        force: true,
      });
      // Remove stale static draft routes too, if packaging an existing artifact.
      fs.rmSync(
        path.join(
          distDir,
          lang === "en" ? "en/articles" : "articles",
          article.slug,
        ),
        { recursive: true, force: true },
      );
    }
    const directory = article.draftAssetDirectory;
    if (directory) {
      if (!/^\/articles\/images\/[a-z0-9][a-z0-9-]*$/.test(directory))
        throw new Error("Invalid draft asset directory");
      // A dedicated draft directory may never contain a published article's images.
      for (const kept of visible) {
        const bodies = ["bg", "en"].map((lang) => {
          const file = path.join(
            publicDir,
            "articles",
            `${kept.slug}-${lang}.md`,
          );
          return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
        });
        if (
          kept.ogImage?.startsWith(directory + "/") ||
          bodies.some((body) => body.includes(directory + "/"))
        )
          throw new Error(
            `Draft assets shared with visible article ${kept.slug}`,
          );
      }
      fs.rmSync(path.join(distDir, directory.slice(1)), {
        recursive: true,
        force: true,
      });
    }
  }
  fs.writeFileSync(
    path.join(distDir, "articles/index.json"),
    JSON.stringify(visible, null, 2) + "\n",
  );
  const manifest = {
    version: 1,
    previewSlug: selected,
    excludedDrafts: excluded.map((a) => a.slug),
  };
  fs.writeFileSync(
    path.join(distDir, ".article-build.json"),
    JSON.stringify(manifest) + "\n",
  );
  return manifest;
}

export function assertProductionArticles(distDir) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(distDir, ".article-build.json"), "utf8"),
  );
  if (manifest.version !== 1 || manifest.previewSlug !== null)
    throw new Error(
      "This is an editorial preview build. Rebuild without VITE_CHAT_LAUNCH_PREVIEW before production deployment.",
    );
  const index = JSON.parse(
    fs.readFileSync(path.join(distDir, "articles/index.json"), "utf8"),
  );
  if (index.some((article) => article.draft))
    throw new Error("Production artifact contains draft metadata");
  for (const slug of manifest.excludedDrafts) {
    if (!safeSlug(slug)) throw new Error("Invalid excluded draft slug");
    for (const lang of ["bg", "en"])
      if (fs.existsSync(path.join(distDir, "articles", `${slug}-${lang}.md`)))
        throw new Error(`Production artifact contains draft body: ${slug}`);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const distDir = path.join(root, "dist");
  if (process.argv[2] === "--check-production")
    assertProductionArticles(distDir);
  else
    packageArticles(
      path.join(root, "public"),
      distDir,
      process.env.VITE_CHAT_LAUNCH_PREVIEW === "true",
    );
}
