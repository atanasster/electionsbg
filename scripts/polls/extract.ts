// `npm run polls:extract` — Tier 2, T2b (docs/plans/polls-agency-watchers-v1.md
// §6.2). For each capture directory under `raw_data/polls/<agency>/`
// (written by `polls:fetch`): run that agency's deterministic extractor
// and write the resulting `InboxDraft` (pretty-printed, decision 7) to
// `data/polls/_inbox/<pollId>.json`. Only agencies with a built
// extractor participate — TR, AR and GM (Tier 4 T4.1, presidential only
// — see `extractGlobalMetrics`'s own header) today; the rest of §6.2's
// table (ML's aligned-row rule, MY, SH's OCR+table rule, GIB, press) is
// not yet built and this file has no fallback for them.
//
//   npm run polls:extract                    # every capture, every built extractor
//   npm run polls:extract -- --agency TR      # just Trend
//   npm run polls:extract -- --agency TR --pub 212750
//   npm run polls:extract -- --agency GM      # just Global Metrics
//
// Walks the FILESYSTEM, not watch state — watch state's `meta.items`
// tracks only what is NEW since the last watcher run, but extraction is
// meant to be re-runnable against the whole backlog a capture directory
// already holds. A pubId captured more than once (`<pubId>.v2`, decision
// 7) is extracted from its LATEST version only, and the written draft
// carries that same version suffix in its own filename, so a re-fetch
// that changed content produces a distinct draft rather than silently
// overwriting the one for an earlier version.
//
// TR (Tier 4b) is the one agency publishing BOTH races, so its single
// `EXTRACTORS` slot is a small DISPATCHER (`extractTrendDispatch` below)
// rather than either race-specific function directly — it reads the
// title first (cheap, no OCR/PDF acquisition paid unless the title is
// genuinely ambiguous) and routes to `extractTrend` (parliamentary) or
// `extractTrendPresidential` (presidential), mirroring
// `extractTrend`'s/`extractGlobalMetrics`'s own title-then-body
// two-stage race check rather than inventing a third one.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extractAlphaResearch } from "./extractors/alpha_research";
import { extractGlobalMetrics } from "./extractors/global_metrics";
import { extractTrend } from "./extractors/trend";
import { extractTrendPresidential } from "./extractors/trend_presidential";
import { flagReader } from "./lib/argv";
import { dirSlugFor, latestVersionSuffix } from "./lib/capture";
import { classifyRace, classifyTitle } from "./lib/classify_race";
import type { InboxDraft } from "./lib/draft";
import { acquireText, extractPageTitle } from "./lib/text_acquisition";

const PROD_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
let REPO_ROOT = PROD_REPO_ROOT;

/** TEST-ONLY seam, matching fetch.ts's own `__setCaptureRootForTests`
 *  convention: redirects both the capture reads and the inbox write to
 *  a scratch directory. Pass no argument to restore the real repo root. */
export const __setExtractRootForTests = (root?: string): void => {
  REPO_ROOT = root ?? PROD_REPO_ROOT;
};

type Extractor = (captureDir: string, pubId: string) => Promise<InboxDraft>;

/** Reads `page.html` here to resolve the title cheaply, THEN resolves
 *  which race this capture is for before choosing an extractor.
 *  `classifyTitle` first — an explicit, unambiguous title needs no
 *  `acquireText` (OCR/PDF acquisition) at all, the same fast path both
 *  race-specific extractors' own guards already assume; only a genuinely
 *  title-ambiguous capture pays for full acquisition, mirroring
 *  `extractTrend`'s own body-text-informed backstop.
 *
 *  ⚠️ This does NOT make `page.html` a single-read file end to end:
 *  whichever extractor this delegates to (`extractTrend` /
 *  `extractTrendPresidential`) reads it again on its own via their own
 *  `readCaptureFile`, and the ambiguous-title branch reads it a THIRD
 *  time inside `acquireText`. Redundant, but harmless — it is a small,
 *  static, already-fetched file, and this dispatcher's own read is what
 *  keeps the common (unambiguous-title) case from paying for a full
 *  `acquireText` pass just to learn the title. */
const extractTrendDispatch: Extractor = async (captureDir, pubId) => {
  let html: string;
  try {
    html = fs.readFileSync(path.join(captureDir, "page.html"), "utf8");
  } catch (e) {
    // Same "clear, capture-scoped" shape both race-specific extractors'
    // own `readCaptureFile` produces — this read happens BEFORE either of
    // them runs, so a missing capture must not surface a bare Node ENOENT
    // instead.
    throw new Error(
      `extractTrendDispatch(${pubId}): missing or unreadable page.html in ${captureDir} ` +
        `(a partial polls:fetch run?): ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const title = extractPageTitle(html);
  const titleRace = classifyTitle(title);
  if (titleRace === "presidential")
    return extractTrendPresidential(captureDir, pubId);
  if (titleRace === "parliamentary") return extractTrend(captureDir, pubId);
  const acquired = await acquireText(captureDir, "TR");
  const race = classifyRace(title, acquired.articleText);
  return race === "presidential"
    ? extractTrendPresidential(captureDir, pubId)
    : extractTrend(captureDir, pubId);
};

/** Every agency with a built deterministic extractor. */
const EXTRACTORS: Record<string, Extractor> = {
  TR: extractTrendDispatch,
  AR: extractAlphaResearch,
  GM: extractGlobalMetrics,
};

/** Every distinct pubId with at least one capture directory for
 *  `agencyId` — version suffixes (`.v2`) collapsed to their base pubId. */
const capturedPubIds = (agencyId: string): string[] => {
  const dir = path.join(REPO_ROOT, "raw_data/polls", dirSlugFor(agencyId));
  if (!fs.existsSync(dir)) return [];
  const bases = new Set<string>();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    bases.add(entry.name.replace(/\.v\d+$/, ""));
  }
  return [...bases].sort();
};

/** The latest version suffix ("" or ".vN") a `pubId`'s capture exists
 *  under, or `null` if it has no capture at all. Probes `SOURCE.json`
 *  specifically, matching `fetch.ts`'s own definition of "this version
 *  exists" — that file is written LAST (page.html and attachments
 *  first), so a crashed `--force` re-fetch can leave a `.vN` directory
 *  with a `page.html` but no `SOURCE.json`. Probing the bare directory
 *  would resolve THAT incomplete version as latest and block
 *  re-extraction of the otherwise-good version before it, exactly the
 *  partial-write shape both extractors' own header comments call
 *  predictable rather than exotic. */
const latestSuffixFor = (agencyId: string, pubId: string): string | null => {
  const base = path.join(
    REPO_ROOT,
    "raw_data/polls",
    dirSlugFor(agencyId),
    pubId,
  );
  return latestVersionSuffix((suffix) =>
    fs.existsSync(path.join(`${base}${suffix}`, "SOURCE.json")),
  );
};

const INBOX_DIR = () => path.join(REPO_ROOT, "data/polls/_inbox");

/** `<pollId>.json`, or `<pollId>.v2.json` when the source capture itself
 *  was a `.v2` (decision 7 — the draft's version tracks the capture's,
 *  not some independently-incremented counter of its own). */
const inboxFilename = (draft: InboxDraft, versionSuffix: string): string =>
  `${draft.poll.id}${versionSuffix}.json`;

/** The PROVISIONAL filename `extractTrend`/`extractAlphaResearch` mint
 *  when no fieldwork end date resolves (`<agency>-pub-<pubId>`) — fully
 *  reconstructable from `agencyId`/`pubId`/`versionSuffix` alone, with
 *  no need to parse any file's contents. */
const provisionalFilename = (
  agencyId: string,
  pubId: string,
  versionSuffix: string,
): string => `${agencyId.toLowerCase()}-pub-${pubId}${versionSuffix}.json`;

const writeDraft = (draft: InboxDraft, versionSuffix: string): string => {
  fs.mkdirSync(INBOX_DIR(), { recursive: true });
  const file = path.join(INBOX_DIR(), inboxFilename(draft, versionSuffix));
  if (fs.existsSync(file))
    console.log(
      `  overwriting existing draft ${path.relative(REPO_ROOT, file)}`,
    );
  fs.writeFileSync(file, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
  return file;
};

/**
 * Both extractors' own header comments assign this cleanup to
 * `polls:extract` by name: "once a later re-extraction resolves a real
 * fieldwork date for the same pubId, whatever writes drafts to disk ...
 * must treat the old `<agency>-pub-<pubId>` file as superseded and
 * remove it, rather than leaving two drafts describing one publication."
 * A provisional draft is DISPOSABLE, never a permanent alternate
 * identity — this is the one place that promise is kept.
 */
const removeStaleProvisionalDraft = (
  writtenFile: string,
  agencyId: string,
  pubId: string,
  versionSuffix: string,
): void => {
  const stale = path.join(
    INBOX_DIR(),
    provisionalFilename(agencyId, pubId, versionSuffix),
  );
  if (stale === writtenFile || !fs.existsSync(stale)) return;
  fs.rmSync(stale);
  console.log(
    `  removed superseded provisional draft ${path.relative(REPO_ROOT, stale)}`,
  );
};

// `agencyId` is always one `main` already validated against `EXTRACTORS`'
// own keys (see `main`'s `agencies` list below), so `extractor` is never
// looked up fresh here — there is no caller path that reaches this with
// an agency lacking one.
const extractOne = async (
  agencyId: string,
  pubId: string,
  extractor: Extractor,
): Promise<void> => {
  const versionSuffix = latestSuffixFor(agencyId, pubId);
  if (versionSuffix === null) {
    console.error(`  no capture found for ${agencyId} ${pubId}`);
    process.exitCode = 1;
    return;
  }
  const captureDir = path.join(
    REPO_ROOT,
    "raw_data/polls",
    dirSlugFor(agencyId),
    `${pubId}${versionSuffix}`,
  );
  try {
    const draft = await extractor(captureDir, pubId);
    const file = writeDraft(draft, versionSuffix);
    removeStaleProvisionalDraft(file, agencyId, pubId, versionSuffix);
    const acceptedShares = draft.details.length;
    console.log(
      `extracted ${agencyId} ${pubId}${versionSuffix} → ${path.relative(REPO_ROOT, file)} ` +
        `(${draft.race}/${draft.genre}, ${acceptedShares} share(s), ${draft.refused.length} refused)`,
    );
  } catch (e) {
    console.error(
      `FAILED ${agencyId} ${pubId}${versionSuffix}: ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exitCode = 1;
  }
};

export interface Opts {
  agency?: string;
  pub?: string;
}

export const parseArgv = (argv: string[]): Opts => {
  const flag = flagReader(argv);
  return { agency: flag("agency"), pub: flag("pub") };
};

export const main = async (argv: string[]): Promise<void> => {
  const opts = parseArgv(argv);

  if (opts.agency && !(opts.agency in EXTRACTORS)) {
    console.error(
      `unknown or unbuilt --agency "${opts.agency}" — extractors exist for: ${Object.keys(EXTRACTORS).join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }
  if (opts.pub && !opts.agency) {
    console.error("--pub needs --agency <ID>");
    process.exitCode = 1;
    return;
  }

  const agencies = opts.agency ? [opts.agency] : Object.keys(EXTRACTORS);
  for (const agencyId of agencies) {
    const extractor = EXTRACTORS[agencyId];
    const pubIds = opts.pub ? [opts.pub] : capturedPubIds(agencyId);
    for (const pubId of pubIds) await extractOne(agencyId, pubId, extractor);
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2));
}
