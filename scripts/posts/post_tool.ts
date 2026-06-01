/**
 * Наясно post tool — duplicate check + card render + save to the drafts
 * registry. Driven by the `naiasno-post` skill.
 *
 *   tsx scripts/posts/post_tool.ts check "<keywords...>"
 *   tsx scripts/posts/post_tool.ts save <spec.json> [--force]
 *
 * Registry:  brand/posts/index.json   (append-only log; powers dup-check)
 * Drafts:    brand/posts/drafts/<slug>.md
 * Images:    brand/posts/<slug>.png
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderStatCard, type StatCardSpec } from "./cardKit";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "../..");
const REGISTRY = resolve(ROOT, "brand/posts/index.json");
const DRAFTS = resolve(ROOT, "brand/posts/drafts");
const IMAGES = resolve(ROOT, "brand/posts");

export type PostEntry = {
  slug: string;
  date: string; // YYYY-MM-DD (caller supplies)
  title: string;
  tags: string[];
  entities: string[]; // parties/people/municipalities/institutions referenced
  keyFact: string; // the single headline claim
  link: string; // on-site deep link (electionsbg.com now, naiasno.bg later)
  sources: string[]; // our-data source + public confirmation source(s)
  image: string; // brand/posts/<slug>.png
};

type PostSpec = Omit<PostEntry, "image" | "tags" | "entities" | "sources"> & {
  tags?: string[];
  entities?: string[];
  sources?: string[];
  bg: string; // BG post body
  en?: string; // optional EN body
  card: StatCardSpec; // card render spec
};

const loadRegistry = (): PostEntry[] => {
  if (!existsSync(REGISTRY)) return [];
  try {
    return JSON.parse(readFileSync(REGISTRY, "utf-8")) as PostEntry[];
  } catch {
    return [];
  }
};

const STOP = new Set([
  "на",
  "за",
  "в",
  "и",
  "с",
  "по",
  "от",
  "до",
  "през",
  "е",
  "са",
  "г",
  "лв",
  "бг",
  "наясно",
  "през",
  "няма",
  "има",
]);
const tokens = (s: string): string[] =>
  (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (t) => t.length > 2 && !STOP.has(t),
  );

const dupScore = (input: string[], e: PostEntry): number => {
  const hay = new Set(
    tokens(
      [e.title, e.keyFact, e.tags.join(" "), e.entities.join(" ")].join(" "),
    ),
  );
  if (hay.size === 0 || input.length === 0) return 0;
  const hits = input.filter((t) => hay.has(t)).length;
  return hits / input.length;
};

const cmdCheck = (kw: string): void => {
  const input = tokens(kw);
  const scored = loadRegistry()
    .map((e) => ({ e, score: dupScore(input, e) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  if (scored.length === 0) {
    console.log("NO_OVERLAP — no similar posts found. Safe to proceed.");
    return;
  }
  console.log("Potential overlaps (review before posting):");
  for (const { e, score } of scored)
    console.log(
      `  ${(score * 100).toFixed(0)}%  ${e.date}  ${e.slug} — ${e.title}`,
    );
  if (scored[0].score >= 0.6)
    console.log(
      "\nWARNING: high overlap — likely a DUPLICATE. Pick a fresh angle or update the existing post.",
    );
};

const cmdSave = (specPath: string, force: boolean): void => {
  const spec = JSON.parse(readFileSync(resolve(specPath), "utf-8")) as PostSpec;
  for (const f of ["slug", "date", "title", "keyFact", "link", "bg"] as const)
    if (!spec[f]) throw new Error(`spec missing required field: ${f}`);

  const reg = loadRegistry();
  const input = tokens(
    [
      spec.title,
      spec.keyFact,
      (spec.tags ?? []).join(" "),
      (spec.entities ?? []).join(" "),
    ].join(" "),
  );
  const worst = reg
    .filter((e) => e.slug !== spec.slug)
    .map((e) => dupScore(input, e))
    .sort((a, b) => b - a)[0];
  if ((worst ?? 0) >= 0.6 && !force)
    throw new Error(
      `high duplicate overlap (${((worst ?? 0) * 100).toFixed(0)}%) with an existing post — use --force only if it is genuinely new`,
    );
  if (reg.some((e) => e.slug === spec.slug) && !force)
    throw new Error(
      `slug "${spec.slug}" already exists (use --force to overwrite)`,
    );

  mkdirSync(DRAFTS, { recursive: true });
  mkdirSync(IMAGES, { recursive: true });
  const imgRel = `brand/posts/${spec.slug}.png`;
  writeFileSync(resolve(ROOT, imgRel), renderStatCard(spec.card));

  const md = [
    `# ${spec.title}`,
    ``,
    `- date: ${spec.date}`,
    `- link: ${spec.link}`,
    `- image: ${imgRel}`,
    `- sources:`,
    ...(spec.sources ?? []).map((s) => `  - ${s}`),
    ``,
    `## BG`,
    ``,
    spec.bg.trim(),
    ``,
    ...(spec.en ? [`## EN`, ``, spec.en.trim(), ``] : []),
    `## Публикуване`,
    `- Качи изображението като нативен пост (НЕ като линк).`,
    `- Сложи линка в ПЪРВИЯ коментар: ${spec.link}`,
  ].join("\n");
  writeFileSync(resolve(DRAFTS, `${spec.slug}.md`), md + "\n");

  const entry: PostEntry = {
    slug: spec.slug,
    date: spec.date,
    title: spec.title,
    tags: spec.tags ?? [],
    entities: spec.entities ?? [],
    keyFact: spec.keyFact,
    link: spec.link,
    sources: spec.sources ?? [],
    image: imgRel,
  };
  const next = reg
    .filter((e) => e.slug !== spec.slug)
    .concat(entry)
    .sort((a, b) => a.date.localeCompare(b.date));
  writeFileSync(REGISTRY, JSON.stringify(next, null, 2) + "\n");
  console.log(`saved draft: brand/posts/drafts/${spec.slug}.md`);
  console.log(`saved image: ${imgRel}`);
  console.log(`registry now has ${next.length} posts`);
};

const main = (): void => {
  const cmd = process.argv[2];
  const arg = process.argv[3];
  const force = process.argv.includes("--force");
  if (cmd === "check" && arg) {
    cmdCheck(
      process.argv
        .slice(3)
        .filter((a) => a !== "--force")
        .join(" "),
    );
    return;
  }
  if (cmd === "save" && arg) {
    cmdSave(arg, force);
    return;
  }
  console.error(
    'usage:\n  post_tool.ts check "<keywords>"\n  post_tool.ts save <spec.json> [--force]',
  );
  process.exit(1);
};

main();
