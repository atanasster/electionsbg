/**
 * Наясно post tool — duplicate check + card render + save to the drafts
 * registry. Driven by the `naiasno-post` skill.
 *
 *   tsx scripts/posts/post_tool.ts check "<keywords...>"
 *   tsx scripts/posts/post_tool.ts save <spec.json> [--force]
 *   tsx scripts/posts/post_tool.ts pins [YYYY-MM-DD]
 *   tsx scripts/posts/post_tool.ts rm <slug>
 *
 * Post kinds: data (grounded stat) · feature (new feature/launch) · dataset (new data).
 * Feature/dataset posts default to pinned for 14 days; `pins` shows what to unpin.
 *
 * Registry:  brand/posts/index.json   (append-only log; powers dup-check + pins)
 * Drafts:    brand/posts/drafts/<slug>.md
 * Images:    brand/posts/<slug>.png
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderStatCard,
  renderAnnounceCard,
  type StatCardSpec,
  type AnnounceCardSpec,
} from "./cardKit";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "../..");
const REGISTRY = resolve(ROOT, "brand/posts/index.json");
const DRAFTS = resolve(ROOT, "brand/posts/drafts");
const IMAGES = resolve(ROOT, "brand/posts");

export type PostKind = "data" | "feature" | "dataset";

export type PostEntry = {
  slug: string;
  date: string; // YYYY-MM-DD (caller supplies)
  kind: PostKind; // data=grounded stat · feature=new feature/launch · dataset=new data
  title: string;
  tags: string[];
  entities: string[]; // parties/people/municipalities/institutions referenced
  keyFact: string; // the single headline claim
  link: string; // on-site deep link (electionsbg.com now, naiasno.bg later)
  sources: string[]; // our-data source + public confirmation source(s)
  image: string | null; // rendered card path, a referenced path, or null (link auto-preview)
  pin: boolean; // keep featured/pinned after launch
  pinUntil: string | null; // YYYY-MM-DD the pin window ends (null = no end date)
};

type PostSpec = Omit<
  PostEntry,
  "kind" | "image" | "tags" | "entities" | "sources" | "pin" | "pinUntil"
> & {
  kind?: PostKind; // default "data"
  tags?: string[];
  entities?: string[];
  sources?: string[];
  pin?: boolean; // default: false for data, true for feature/dataset
  pinUntil?: string | null; // default = date + 14 days for pinned posts
  image?: string | null; // reference an existing image (e.g. ai/assets/og.png) or null for link auto-preview
  bg: string; // BG post body
  en?: string; // optional EN body
  card?: StatCardSpec | AnnounceCardSpec; // omit to rely on the link's og:image preview
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

  const kind: PostKind = spec.kind ?? "data";
  mkdirSync(DRAFTS, { recursive: true });
  mkdirSync(IMAGES, { recursive: true });

  // Image: (1) referenced existing file, (2) rendered card, or (3) none —
  // a post with no card relies on the link's og:image preview.
  let image: string | null;
  if (spec.image !== undefined) {
    image = spec.image; // existing path or explicit null
  } else if (spec.card) {
    image = `brand/posts/${spec.slug}.png`;
    const buf =
      kind === "data"
        ? renderStatCard(spec.card as StatCardSpec)
        : renderAnnounceCard(spec.card as AnnounceCardSpec);
    writeFileSync(resolve(ROOT, image), buf);
  } else {
    image = null;
  }

  // Pin lifecycle: features/datasets default to pinned for 14 days.
  const pin = spec.pin ?? kind !== "data";
  const addDays = (d: string, n: number): string => {
    const t = new Date(`${d}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
  };
  const pinUntil = pin ? (spec.pinUntil ?? addDays(spec.date, 14)) : null;

  const publishNote: string[] =
    image && kind === "data"
      ? [
          `- Качи изображението като нативен пост (НЕ като линк).`,
          `- Сложи линка в ПЪРВИЯ коментар: ${spec.link}`,
        ]
      : image
        ? [
            `- Качи изображението като нативен пост.`,
            `- Сложи линка в текста или в първия коментар: ${spec.link}`,
          ]
        : [
            `- Постни линка в текста — Facebook ще издърпа og:image автоматично: ${spec.link}`,
          ];
  if (pin)
    publishNote.push(
      `- Закачи поста (Група: ⋯ → Pin to Featured; Страница: ⋯ → Feature). Откачи след ${pinUntil}.`,
    );

  const md = [
    `# ${spec.title}`,
    ``,
    `- kind: ${kind}`,
    `- date: ${spec.date}`,
    `- link: ${spec.link}`,
    `- image: ${image ?? "(none — link auto-preview)"}`,
    `- pin: ${pin ? `until ${pinUntil}` : "no"}`,
    `- sources:`,
    ...(spec.sources ?? []).map((s) => `  - ${s}`),
    ``,
    `## BG`,
    ``,
    spec.bg.trim(),
    ``,
    ...(spec.en ? [`## EN`, ``, spec.en.trim(), ``] : []),
    `## Публикуване`,
    ...publishNote,
  ].join("\n");
  writeFileSync(resolve(DRAFTS, `${spec.slug}.md`), md + "\n");

  const entry: PostEntry = {
    slug: spec.slug,
    date: spec.date,
    kind,
    title: spec.title,
    tags: spec.tags ?? [],
    entities: spec.entities ?? [],
    keyFact: spec.keyFact,
    link: spec.link,
    sources: spec.sources ?? [],
    image,
    pin,
    pinUntil,
  };
  const next = reg
    .filter((e) => e.slug !== spec.slug)
    .concat(entry)
    .sort((a, b) => a.date.localeCompare(b.date));
  writeFileSync(REGISTRY, JSON.stringify(next, null, 2) + "\n");
  console.log(
    `saved draft: brand/posts/drafts/${spec.slug}.md (${kind}${pin ? `, pinned until ${pinUntil}` : ""})`,
  );
  console.log(`image: ${image ?? "(none — link auto-preview)"}`);
  console.log(`registry now has ${next.length} posts`);
};

// List posts that should be pinned, and flag any whose pin window has expired.
const cmdPins = (todayArg?: string): void => {
  const today = todayArg ?? new Date().toISOString().slice(0, 10);
  const pinned = loadRegistry().filter((e) => e.pin);
  if (pinned.length === 0) {
    console.log("No pinned posts in the registry.");
    return;
  }
  console.log(`Pin status (today = ${today}):`);
  for (const e of pinned.sort((a, b) =>
    (a.pinUntil ?? "9999").localeCompare(b.pinUntil ?? "9999"),
  )) {
    const status = !e.pinUntil
      ? "PINNED (no end date)"
      : e.pinUntil >= today
        ? `PINNED until ${e.pinUntil}`
        : `EXPIRED ${e.pinUntil} — UNPIN now`;
    console.log(`  [${e.kind}] ${e.slug} — ${status}`);
  }
};

// Remove a draft from the registry + delete its rendered card and draft file.
const cmdRemove = (slug: string): void => {
  const reg = loadRegistry();
  const entry = reg.find((e) => e.slug === slug);
  if (!entry) throw new Error(`slug "${slug}" not in registry`);
  if (entry.image === `brand/posts/${slug}.png`) {
    const img = resolve(ROOT, entry.image);
    if (existsSync(img)) rmSync(img);
  }
  const draft = resolve(DRAFTS, `${slug}.md`);
  if (existsSync(draft)) rmSync(draft);
  const next = reg.filter((e) => e.slug !== slug);
  writeFileSync(REGISTRY, JSON.stringify(next, null, 2) + "\n");
  console.log(`removed ${slug} (registry now has ${next.length} posts)`);
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
  if (cmd === "pins") {
    cmdPins(arg && arg !== "--force" ? arg : undefined);
    return;
  }
  if (cmd === "rm" && arg) {
    cmdRemove(arg);
    return;
  }
  console.error(
    'usage:\n  post_tool.ts check "<keywords>"\n  post_tool.ts save <spec.json> [--force]\n  post_tool.ts pins [YYYY-MM-DD]\n  post_tool.ts rm <slug>',
  );
  process.exit(1);
};

main();
