// Which URLs get their own <head>, and what it says.
//
// Read straight from the built bundles in news/app-data, so a story added
// tonight is prerendered and in the sitemap tomorrow with no list to maintain.
// A hard-coded route list is how a family becomes invisible to a crawler by
// omission — which is what the four-URL sitemap this replaces actually did.

import fs from "node:fs";
import path from "node:path";
import { clamp, type PrerenderRoute } from "./prerender";

type Bundle = Record<string, unknown>;

/**
 * One bundle, or null when it is ABSENT.
 *
 * ⚠️ Absent and CORRUPT are different. A checkout with no `news/app-data` must
 * still build a site with its hubs — but a malformed bundle silently fell back
 * to the same empty result, so a broken build emitted a four-URL sitemap and
 * exited 0, which is indistinguishable from a healthy build of an empty
 * corpus.
 */
const read = (dir: string, name: string): Bundle | null => {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as Bundle;
  } catch (err) {
    throw new Error(
      `prerender: ${file} exists but is not readable JSON — refusing to ` +
        `build a sitemap that silently omits every page it describes ` +
        `(${(err as Error).message})`,
    );
  }
};

/**
 * The hubs. Always present, even on an empty corpus — they are the app's own
 * pages and their copy does not depend on data.
 */
export const HUB_ROUTES: PrerenderRoute[] = [
  {
    path: "",
    title: "Наясно Новини — всяка страна на всяка история",
    description:
      "Сравнете как българските медии отразяват една и съща история: спектър на пристрастията, позиция спрямо Русия, сигнали за ИИ-генерирано съдържание, източници и теми.",
  },
  {
    path: "outlets",
    title: "Източници — българските медии в корпуса | Наясно Новини",
    description:
      "Всички издания в корпуса: вид, обхват, посещаемост, брой събрани и анализирани материали и разпределението на техните собствени статии по двете оси.",
  },
  {
    path: "topics",
    title: "Теми — по какво се разминават медиите | Наясно Новини",
    description:
      "Темите в корпуса по таксономия, и къде отразяването се разминава най-силно между изданията.",
  },
  {
    path: "methodology",
    title: "Методология — как се правят оценките | Наясно Новини",
    description:
      "Какво измерваме, как, и какво този корпус не покрива. Всяка статия се оценява поотделно, с цитат от самия материал.",
  },
];

const outletTitle = (name: string): string =>
  `${name} — профил на изданието | Наясно Новини`;

export const buildRoutes = (dataDir: string): PrerenderRoute[] => {
  const routes: PrerenderRoute[] = [...HUB_ROUTES];

  const outlets = read(dataDir, "outlets.json");
  for (const o of (outlets?.outlets as Bundle[] | undefined) ?? []) {
    const domain = String(o.domain ?? "");
    if (!domain) continue;
    const name = String(o.outlet ?? domain);
    const analysed = Number(o.analyzed_count ?? 0);
    const total = Number(o.article_count ?? 0);
    const retired = Boolean(o.retired);
    routes.push({
      path: `outlet/${domain}`,
      title: outletTitle(name),
      description: clamp(
        retired
          ? `${name} е извадено от обхождането. ${total} събрани материала остават в корпуса, ${analysed} от тях анализирани.`
          : `${total} събрани материала от ${name}, ${analysed} анализирани. Разпределение по политическата ос и по отношението към Русия, и последни статии.`,
      ),
      // ⚠️ A retired outlet keeps its page — its articles are still in the
      // corpus and still linked from stories — but it is NOT submitted. We
      // are not asking a crawler to index a source we no longer collect, and
      // two of them asked not to be crawled at all.
      sitemap: !retired,
      lastmod: (outlets?.generated_at as string) ?? null,
    });
  }

  const stories = read(dataDir, "stories.json");
  for (const st of (stories?.stories as Bundle[] | undefined) ?? []) {
    const id = String(st.id ?? "");
    if (!id) continue;
    const title = String(st.title_bg ?? st.title_en ?? "").trim();
    if (!title) continue;
    const agg = (st.aggregates ?? {}) as Bundle;
    const outletCount = Number(agg.outlet_count ?? 0);
    const summary = String(st.summary_bg ?? "").trim();
    routes.push({
      path: `story/${id}`,
      title: `${clamp(title, 70)} — сравнение на отразяването | Наясно Новини`,
      description: clamp(
        summary ||
          `Как ${outletCount} издания отразяват тази история: заглавия, спектър на пристрастията и позиция спрямо Русия.`,
      ),
      ogType: "article",
      lastmod: (st.last_published as string) ?? null,
      // ⚠️ A story with ONE outlet is not a comparison, and comparison is the
      // whole proposition. Prerendered (so the head is right if somebody
      // links to it) but not submitted — a page whose entire content is one
      // headline earns a thin-content penalty rather than traffic.
      sitemap: outletCount >= 2,
    });
  }

  // ⚠️ THE LARGEST FAMILY, and the one that was entirely unprerendered:
  // 4,366 internally-linked /article/:domain/:id URLs all serving the
  // homepage's head.
  //
  // Capped at the ANALYSED subset (365 today). Two reasons, and the second is
  // the one that matters: an unanalysed article's page carries a title, an
  // excerpt and a link out — a thin page that earns a penalty rather than
  // traffic — while an analysed one carries the judgment, the evidence and
  // the comparison, which is the thing worth indexing. The file-count ceiling
  // is the lesser reason; `dist-news` is nowhere near it.
  //
  // Unanalysed articles keep working; they are simply not prerendered and not
  // submitted, exactly as they were before.
  const outletNames = new Map<string, string>();
  for (const o of (outlets?.outlets as Bundle[] | undefined) ?? []) {
    outletNames.set(String(o.domain ?? ""), String(o.outlet ?? o.domain ?? ""));
  }
  const latest = read(dataDir, "latest.json");
  for (const a of (latest?.articles as Bundle[] | undefined) ?? []) {
    const domain = String(a.domain ?? "");
    const id = String(a.id ?? "");
    if (!domain || !id || !a.analysis) continue;
    const title = String(a.title ?? "").trim();
    if (!title) continue;
    const name = outletNames.get(domain) ?? domain;
    const excerpt = String(a.excerpt ?? "").trim();
    routes.push({
      path: `article/${domain}/${id}`,
      title: `${clamp(title, 70)} — ${name} | Наясно Новини`,
      description: clamp(
        excerpt ||
          `Анализ на материал от ${name}: позиция по двете оси, с цитат от самия текст.`,
      ),
      ogType: "article",
      image: (a.image as string) ?? null,
      lastmod: (a.published as string) ?? null,
    });
  }

  return routes;
};
