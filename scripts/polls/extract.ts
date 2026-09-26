// Extract captured agency releases into reviewable drafts, preserving each race.
import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { presidentialDraftId } from "./lib/draft_identity";
import { isExitPollTitle } from "./agencies/wp_lister";
import { extractAgencyPresidential } from "./extractors/agency_presidential";
import { extractAlphaResearch } from "./extractors/alpha_research";
import { extractGlobalMetrics } from "./extractors/global_metrics";
import { extractTrend } from "./extractors/trend";
import { extractTrendPresidential } from "./extractors/trend_presidential";
import { flagReader } from "./lib/argv";
import {
  recordCapture,
  readPublicationLedger,
  recordExtraction,
  recordPublicationFailure,
  type PublicationDiscovery,
} from "./lib/publication_ledger";
import { dirSlugFor, latestVersionSuffix } from "./lib/capture";
import { classifyRaces } from "./lib/classify_race";
import type { InboxDraft } from "./lib/draft";
import {
  acquireText,
  acquiredSourceText,
  extractPageTitle,
} from "./lib/text_acquisition";

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

type Extractor = (
  captureDir: string,
  pubId: string,
) => Promise<InboxDraft | InboxDraft[]>;

/** The capture is one publication; a joint release yields one draft per race. */
const extractJoint =
  (agencyId: "TR" | "AR"): Extractor =>
  async (captureDir, pubId) => {
    const html = fs.readFileSync(path.join(captureDir, "page.html"), "utf8");
    if (isExitPollTitle(extractPageTitle(html)))
      throw new Error(
        "Exit-poll publication excluded from pre-election corpus",
      );
    const acquired = await acquireText(captureDir, agencyId);
    const races = classifyRaces(
      extractPageTitle(html),
      acquiredSourceText(acquired),
    );
    const drafts: InboxDraft[] = [];
    if (races.includes("parliamentary"))
      drafts.push(
        await (agencyId === "TR" ? extractTrend : extractAlphaResearch)(
          captureDir,
          pubId,
          acquired,
        ),
      );
    if (races.includes("presidential"))
      drafts.push(
        await (agencyId === "TR"
          ? extractTrendPresidential(captureDir, pubId, acquired)
          : extractAgencyPresidential(agencyId, captureDir, pubId, acquired)),
      );
    // Both corpora may use the fieldwork-keyed ID, but the shared inbox cannot.
    if (drafts.length > 1)
      for (const draft of drafts.filter((d) => d.race === "presidential")) {
        draft.poll.id = presidentialDraftId(draft.poll.id);
        draft.details.forEach((row) => (row.pollId = draft.poll.id));
        if (draft.race === "presidential")
          draft.runoffs.forEach((row) => (row.pollId = draft.poll.id));
      }
    return drafts;
  };

const EXTRACTORS: Record<string, Extractor> = {
  TR: extractJoint("TR"),
  AR: extractJoint("AR"),
  GM: extractGlobalMetrics,
  ...Object.fromEntries(
    ["ML", "SH", "MY", "GIB"].map((agency) => [
      agency,
      (dir: string, pub: string) => extractAgencyPresidential(agency, dir, pub),
    ]),
  ),
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

const preserveDraft = (file: string): void => {
  const contents = fs.readFileSync(file, "utf8");
  const hash = createHash("sha256").update(contents).digest("hex");
  const directory = path.join(REPO_ROOT, "state/polls/review-history");
  fs.mkdirSync(directory, { recursive: true });
  const archive = path.join(directory, `${hash}.json`);
  if (!fs.existsSync(archive))
    fs.writeFileSync(archive, contents, { flag: "wx" });
};

const writeDraft = (draft: InboxDraft, versionSuffix: string): string => {
  fs.mkdirSync(INBOX_DIR(), { recursive: true });
  const file = path.join(INBOX_DIR(), inboxFilename(draft, versionSuffix));
  if (fs.existsSync(file)) {
    const prior = JSON.parse(fs.readFileSync(file, "utf8")) as InboxDraft;
    if (prior.poll.source !== draft.poll.source || prior.race !== draft.race)
      throw new Error(
        `Draft ID collision: ${draft.poll.id}; preserve both publications for review`,
      );
    preserveDraft(file);
  }
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
  draft: InboxDraft,
  agencyId: string,
  pubId: string,
  versionSuffix: string,
): void => {
  const base = provisionalFilename(agencyId, pubId, versionSuffix);
  for (const filename of [
    base,
    `${agencyId.toLowerCase()}-pub-${pubId}-presidential${versionSuffix}.json`,
  ]) {
    const stale = path.join(INBOX_DIR(), filename);
    if (stale === writtenFile || !fs.existsSync(stale)) continue;
    const previous = JSON.parse(fs.readFileSync(stale, "utf8")) as InboxDraft;
    if (
      previous.race !== draft.race ||
      previous.poll.source !== draft.poll.source
    )
      continue;
    preserveDraft(stale);
    fs.rmSync(stale);
    console.log(
      `  removed superseded provisional draft ${path.relative(REPO_ROOT, stale)}`,
    );
  }
};

// `agencyId` is always one `main` already validated against `EXTRACTORS`'
// own keys (see `main`'s `agencies` list below), so `extractor` is never
// looked up fresh here — there is no caller path that reaches this with
// an agency lacking one.
const extractOne = async (
  agencyId: string,
  pubId: string,
  extractor: Extractor,
  regenerate: boolean,
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
  let discovery: PublicationDiscovery | null = null;
  try {
    const stamp: {
      url: string;
      sha256: string;
      fetchedAt: string;
      title?: string;
      publishedAt?: string;
      attachmentFailures?: string[];
    } = JSON.parse(
      fs.readFileSync(path.join(captureDir, "SOURCE.json"), "utf8"),
    );
    if (
      typeof stamp.url !== "string" ||
      typeof stamp.sha256 !== "string" ||
      typeof stamp.fetchedAt !== "string"
    )
      throw new Error("Capture stamp is missing URL, hash or fetch date");
    discovery = {
      pubId,
      url: stamp.url,
      title: stamp.title ?? null,
      publishedAt: stamp.publishedAt ?? null,
    };
    recordCapture(
      REPO_ROOT,
      agencyId,
      discovery,
      {
        sha256: stamp.sha256,
        capturedAt: stamp.fetchedAt,
        capturePath: path.relative(REPO_ROOT, captureDir),
        attachmentFailures: stamp.attachmentFailures ?? [],
      },
      true,
    );
    const publication = readPublicationLedger(REPO_ROOT, agencyId).find(
      (entry) => entry.pubIds.includes(pubId),
    );
    if (publication?.latestHash !== stamp.sha256) {
      console.log(
        `skip ${agencyId} ${pubId}${versionSuffix} — superseded source capture`,
      );
      return;
    }
    const version = publication?.versions.find(
      (v) => v.sha256 === stamp.sha256,
    );
    if (
      ["parliamentary", "presidential"].every((race) =>
        version?.exclusions?.some((e) => e.race === race),
      )
    ) {
      console.log(`skip ${agencyId} ${pubId} — reviewed exclusions preserved`);
      return;
    }
    if (stamp.attachmentFailures?.length)
      throw new Error(
        "Capture has unavailable attachments; retry capture before extraction",
      );
    const extracted = await extractor(captureDir, pubId);
    for (const draft of Array.isArray(extracted) ? extracted : [extracted]) {
      if (version?.exclusions?.some((e) => e.race === draft.race)) {
        console.log(
          `skip ${agencyId} ${pubId}/${draft.race} — reviewed exclusion preserved`,
        );
        continue;
      }
      draft.poll.publicationId = `${agencyId}:${pubId}`;
      draft.poll.publishedAt =
        stamp.publishedAt ?? draft.poll.publishedAt ?? null;
      const prior = publication?.versions
        .find((v) => v.sha256 === stamp.sha256)
        ?.drafts.find((d) => d.race === draft.race);
      const existing = fs.existsSync(INBOX_DIR())
        ? fs
            .readdirSync(INBOX_DIR())
            .filter((f) => f.endsWith(".json"))
            .find((f) => {
              let saved: InboxDraft;
              try {
                saved = JSON.parse(
                  fs.readFileSync(path.join(INBOX_DIR(), f), "utf8"),
                ) as InboxDraft;
              } catch {
                // A reviewer's half-finished edit must not abort every other extraction.
                console.warn(`  unreadable inbox draft ${f} — left untouched`);
                return false;
              }
              return (
                saved.race === draft.race &&
                saved.poll.source === draft.poll.source &&
                saved.poll.provenance?.sha256 === stamp.sha256
              );
            })
        : undefined;
      if (!regenerate && (existing || prior?.acceptedAt)) {
        console.log(
          `skip ${agencyId} ${pubId}/${draft.race} — existing review or acceptance preserved`,
        );
        continue;
      }
      // A restamped draft can have a different name from the extractor output.
      if (existing) {
        const previous = path.join(INBOX_DIR(), existing);
        if (
          previous !==
          path.join(INBOX_DIR(), inboxFilename(draft, versionSuffix))
        ) {
          preserveDraft(previous);
          fs.rmSync(previous);
        }
      }
      const file = writeDraft(draft, versionSuffix);
      recordExtraction(
        REPO_ROOT,
        agencyId,
        pubId,
        stamp.sha256,
        draft,
        new Date().toISOString(),
      );
      removeStaleProvisionalDraft(file, draft, agencyId, pubId, versionSuffix);
      const acceptedShares = draft.details.length;
      console.log(
        `extracted ${agencyId} ${pubId}${versionSuffix} → ${path.relative(REPO_ROOT, file)} ` +
          `(${draft.race}/${draft.genre}, ${acceptedShares} share(s), ${draft.refused.length} refused)`,
      );
    }
  } catch (e) {
    if (discovery)
      recordPublicationFailure(
        REPO_ROOT,
        agencyId,
        discovery,
        "extraction",
        e instanceof Error ? e.message : String(e),
        new Date().toISOString(),
      );
    console.error(
      `FAILED ${agencyId} ${pubId}${versionSuffix}: ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exitCode = 1;
  }
};

export interface Opts {
  agency?: string;
  pub?: string;
  regenerate: boolean;
}

export const parseArgv = (argv: string[]): Opts => {
  const flag = flagReader(argv);
  return {
    agency: flag("agency"),
    pub: flag("pub"),
    regenerate: argv.includes("--regenerate"),
  };
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

  if (opts.regenerate && (!opts.agency || !opts.pub)) {
    console.error(
      "--regenerate needs --agency and --pub to select one reviewed publication",
    );
    process.exitCode = 1;
    return;
  }
  const agencies = opts.agency ? [opts.agency] : Object.keys(EXTRACTORS);
  for (const agencyId of agencies) {
    const extractor = EXTRACTORS[agencyId];
    const pubIds = opts.pub ? [opts.pub] : capturedPubIds(agencyId);
    for (const pubId of pubIds)
      await extractOne(agencyId, pubId, extractor, opts.regenerate);
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2));
}
