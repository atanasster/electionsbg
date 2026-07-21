// /procurement/project/{slug} — the CURATED flagship project files (§4.4 /
// Phase 3). Read from the committed data/procurement/projects/index.json; each is
// an editorial dossier that must be indexable + carry route-specific <meta>.
// Kept in its own module (no heavy deps) so the prerender↔sitemap sync invariant
// is unit-testable.
import fs from "fs";
import path from "path";
import { PrerenderRoute, SITE_URL } from "./routes";
import { escapeHtml } from "./html";
import { buildWebPageLd, buildBreadcrumbLd } from "./jsonLd";

export type CuratedIndexEntry = {
  slug?: string;
  title?: { bg?: string; en?: string };
  summary?: { bg?: string; en?: string };
};

/** Only entries with a `slug` AND a `title.bg` get a prerendered route. The
 *  sitemap enumerator (`enumerateCuratedProjects`) MUST apply the identical
 *  guard, or a <loc> would point at a non-existent file. */
export const isPrerenderableCuratedEntry = (
  f: CuratedIndexEntry | undefined,
): f is CuratedIndexEntry & { slug: string; title: { bg: string } } =>
  !!f && typeof f.slug === "string" && f.slug.length > 0 && !!f.title?.bg;

export const buildCuratedProjectRoutes = (
  projectRoot: string,
): PrerenderRoute[] => {
  const file = path.join(
    projectRoot,
    "data",
    "procurement",
    "projects",
    "index.json",
  );
  if (!fs.existsSync(file)) return [];
  let payload: { files?: CuratedIndexEntry[] };
  try {
    payload = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
  const result: PrerenderRoute[] = [];
  for (const f of payload.files ?? []) {
    if (!isPrerenderableCuratedEntry(f)) continue;
    const url = `${SITE_URL}/procurement/project/${f.slug}`;
    const enUrl = `${SITE_URL}/en/procurement/project/${f.slug}`;
    const nameBg = f.title.bg;
    const nameEn = f.title.en || nameBg;
    const summaryBg =
      f.summary?.bg ||
      `Проектно досие: ${nameBg} — обявено срещу договорено, как е възложено и къде спира следата на парите.`;
    const summaryEn =
      f.summary?.en ||
      `Project file: ${nameEn} — announced vs contracted, how it was awarded, and where the money trail stops.`;
    const title = `${nameBg} — проектно досие | electionsbg.com`;
    const titleEn = `${nameEn} — project file | electionsbg.com`;
    result.push({
      path: `procurement/project/${f.slug}`,
      title,
      description: summaryBg,
      bodyHtml: `<h1>${escapeHtml(nameBg)}</h1><p>${escapeHtml(summaryBg)}</p>`,
      jsonLd: [
        buildWebPageLd({ title, description: summaryBg, url }),
        buildBreadcrumbLd([
          { name: "Начало", url: `${SITE_URL}/` },
          { name: "Обществени поръчки", url: `${SITE_URL}/procurement` },
          { name: nameBg, url },
        ]),
      ],
      english: {
        title: titleEn,
        description: summaryEn,
        bodyHtml: `<h1>${escapeHtml(nameEn)}</h1><p>${escapeHtml(summaryEn)}</p>`,
        jsonLd: [
          buildWebPageLd({
            title: titleEn,
            description: summaryEn,
            url: enUrl,
            inLanguage: "en",
          }),
          buildBreadcrumbLd([
            { name: "Home", url: `${SITE_URL}/en/` },
            { name: "Public procurement", url: `${SITE_URL}/en/procurement` },
            { name: nameEn, url: enUrl },
          ]),
        ],
      },
    });
  }
  return result;
};
