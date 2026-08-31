// Which URLs get their own <head>, and what it says.
//
// Read straight from the built bundles in news/app-data, so a story added
// tonight is prerendered and in the sitemap tomorrow with no list to maintain.
// A hard-coded route list is how a family becomes invisible to a crawler by
// omission — which is what the four-URL sitemap this replaces actually did.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { clamp, safeSegment, type PrerenderRoute } from "./prerender";

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
      "Сравнете как българските медии отразяват една и съща история: политическо рамкиране, позиция спрямо Русия, сигнали за ИИ-генерирано съдържание, източници и теми.",
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
  {
    path: "saved",
    title: "Запазени истории и статии | Наясно Новини",
    description:
      "Личният ви списък със запазени истории и статии. Данните остават само в браузъра и не се синхронизират.",
    sitemap: false,
    noindex: true,
  },
  {
    path: "about",
    title: "За редакцията | Наясно Новини",
    description:
      "Мисията, редакционните принципи и отговорността зад Наясно Новини — проект за сравнение на българското медийно отразяване.",
  },
  {
    path: "corrections",
    title: "Поправки и право на отговор | Наясно Новини",
    description:
      "Как се подават и разглеждат сигнали, как отбелязваме поправки и оттегляния и публичният регистър на редакционните промени.",
  },
  {
    path: "evals",
    title: "Публично оценяване на анализи | Наясно Новини",
    description:
      "Експериментално публично оценяване на политическото рамкиране, позицията спрямо Русия и отношението към партии в избрани статии — без регистрация.",
    sitemap: false,
    noindex: true,
  },
];

/**
 * Hosting rewrites an unqueued /evals/article/** URL to this file. Exact
 * generated task files win before rewrites, while unknown/stale task URLs
 * still receive a non-homepage noindex head before React renders the route.
 */
export const EVAL_ARTICLE_FALLBACK_ROUTE: PrerenderRoute = {
  path: "evals/article",
  title: "Оценяване на статия | Наясно Новини",
  description:
    "Публично експериментално оценяване на анализ на статия. Формулярът е достъпен само за материали в текущата публична опашка.",
  sitemap: false,
  noindex: true,
};

export const BASE_ROUTES: PrerenderRoute[] = [
  ...HUB_ROUTES,
  EVAL_ARTICLE_FALLBACK_ROUTE,
];

const EVAL_RUBRIC = "news-article-evaluation-v1";
const MAX_EVAL_TASKS = 200;
const SHA256 = /^sha256:[0-9a-f]{64}$/;

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const fields = Object.entries(value as Bundle)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`);
    return `{${fields.join(",")}}`;
  }
  throw new Error("prerender: eval queue contains a non-canonical JSON value");
};

const canonicalSha256 = (value: unknown): string =>
  `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;

const normalizedTimestamp = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : null;
};

const evalQueueTasks = (queue: Bundle, publicRevision: unknown): Bundle[] => {
  if (queue.schema_version !== 1 || queue.rubric_version !== EVAL_RUBRIC) {
    throw new Error("prerender: eval queue has an unsupported contract");
  }
  const queueRevision = normalizedTimestamp(queue.public_data_revision);
  const generatedAt = normalizedTimestamp(queue.generated_at);
  const appDataRevision = normalizedTimestamp(publicRevision);
  if (
    !queueRevision ||
    queueRevision !== appDataRevision ||
    generatedAt !== queueRevision
  ) {
    throw new Error(
      "prerender: eval queue does not match the current public app-data revision",
    );
  }
  if (
    !Array.isArray(queue.tasks) ||
    queue.tasks.length > MAX_EVAL_TASKS ||
    queue.task_count !== queue.tasks.length ||
    !SHA256.test(String(queue.tasks_sha256 ?? "")) ||
    queue.tasks_sha256 !== canonicalSha256(queue.tasks)
  ) {
    throw new Error("prerender: eval queue task inventory is invalid");
  }

  const seen = new Set<string>();
  return queue.tasks.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`prerender: eval queue task ${index} is not an object`);
    }
    const task = raw as Bundle;
    const domain = String(task.domain ?? "").trim();
    const id = String(task.article_id ?? "").trim();
    const title = String(task.title ?? "").trim();
    const key = `${domain}/${id}`;
    let taskUrl: URL;
    try {
      taskUrl = new URL(String(task.url ?? ""));
    } catch {
      throw new Error(`prerender: eval queue task ${index} has an invalid URL`);
    }
    if (
      !domain ||
      !id ||
      !title ||
      title.length > 500 ||
      safeSegment(domain) !== domain ||
      safeSegment(id) !== id ||
      task.article_key !== key ||
      taskUrl.protocol !== "https:" ||
      !SHA256.test(String(task.content_sha256 ?? "")) ||
      !SHA256.test(String(task.analysis_sha256 ?? "")) ||
      !Number.isSafeInteger(task.task_revision) ||
      Number(task.task_revision) <= 0 ||
      !task.model_labels ||
      typeof task.model_labels !== "object" ||
      Array.isArray(task.model_labels) ||
      !Array.isArray(task.review_fields) ||
      !Array.isArray(task.dataset_ids)
    ) {
      throw new Error(`prerender: eval queue task ${index} is invalid`);
    }
    if (seen.has(key)) {
      throw new Error(`prerender: duplicate eval queue task ${key}`);
    }
    seen.add(key);
    return task;
  });
};

const outletTitle = (name: string): string =>
  `${name} — профил на изданието | Наясно Новини`;

export const buildRoutes = (dataDir: string): PrerenderRoute[] => {
  const routes: PrerenderRoute[] = [...BASE_ROUTES];

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
          `Как ${outletCount} издания отразяват тази история: заглавия, политическо рамкиране и позиция спрямо Русия.`,
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

  // Evaluation pages are public utilities, not editorial content. Only the
  // exact tasks in the public queue get a direct-load shell; each shell is
  // noindex and absent from the sitemap so it can never inherit the homepage
  // SEO head through Hosting's SPA fallback.
  const evalQueue = read(dataDir, "evals/queue.json");
  for (const task of evalQueue
    ? evalQueueTasks(evalQueue, outlets?.generated_at)
    : []) {
    const domain = String(task.domain ?? "").trim();
    const id = String(task.article_id ?? "").trim();
    const title = String(task.title ?? "").trim();
    routes.push({
      path: `evals/article/${domain}/${id}`,
      title: `Оценяване: ${clamp(title, 64)} | Наясно Новини`,
      description:
        "Публично експериментално оценяване на анализ на статия. Не е необходим профил; изпратената оценка не променя автоматично публикувания анализ.",
      sitemap: false,
      noindex: true,
    });
  }

  return routes;
};
