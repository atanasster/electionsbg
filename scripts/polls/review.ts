// polls:review — docs/plans/polls-ai-review-v1.md. Auto-accept an inbox draft
// ONLY when the deterministic extractor and an independent reading of the same
// capture agree on every figure; otherwise annotate the draft with exactly what
// disagreed and leave it for a human.
//
// The reading is NOT produced here. It is written by a subagent inside the
// Claude Code session (the update-polls skill, on the operator's subscription —
// this script calls no model and needs no API key), from the capture directory
// alone, to the path `--prepare` hands out.
//
//   npm run polls:review -- --prepare           # list drafts needing a reading
//   npm run polls:review                        # compare + accept on agreement
//   npm run polls:review -- --dry-run           # report only, write nothing
//   npm run polls:review -- --agency MY --pub 1918
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isGroundedIn, normalise } from "../opencalls/enrich_gate";
import { __setAcceptRootForTests, main as acceptMain } from "./accept";
import { flagReader } from "./lib/argv";
import {
  compareDraftToReading,
  validateReading,
  type Fill,
  type AiReading,
  type ReadingPoll,
} from "./lib/ai_reading";
import { reviewDraftHash } from "./lib/ai_review";
import type { InboxDraft } from "./lib/draft";
import type { Poll } from "../../src/data/polls/pollsTypes";
import { isProvisionalPollId } from "./lib/draft_identity";
import { loadPartyAliases } from "./lib/party_aliases";
import { isBilingualLabel } from "./lib/question_validation";
import { readPublicationLedger } from "./lib/publication_ledger";
import { acquireText, acquiredSourceText } from "./lib/text_acquisition";

const PROD_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
let REPO_ROOT = PROD_REPO_ROOT;

/** TEST-ONLY seam — redirects this script AND the accept it calls. */
export const __setReviewRootForTests = (root?: string): void => {
  REPO_ROOT = root ?? PROD_REPO_ROOT;
  __setAcceptRootForTests(root);
};

const INBOX = () => path.join(REPO_ROOT, "data/polls/_inbox");
const READINGS = () => path.join(REPO_ROOT, "state/polls/readings");

export interface ReviewTask {
  pollId: string;
  draftFile: string;
  agencyId: string;
  pubId: string;
  captureDir: string;
  captureSha256: string;
  readingPath: string;
}

/** Where the reading for one capture version lives. Keyed by the capture
 *  hash so a re-captured `.vN` publication needs (and gets) a new reading. */
export const readingPathFor = (
  agencyId: string,
  pubId: string,
  sha256: string,
): string =>
  path.join(READINGS(), `${agencyId}-${pubId}-${sha256.slice(0, 12)}.json`);

/** The newest version of every inbox draft (a `.v2` supersedes the bare file). */
const latestDrafts = (): string[] => {
  if (!fs.existsSync(INBOX())) return [];
  const best = new Map<string, { file: string; v: number }>();
  for (const f of fs.readdirSync(INBOX())) {
    const m = /^(.+?)(?:\.v(\d+))?\.json$/.exec(f);
    if (!m) continue;
    const v = m[2] ? Number(m[2]) : 1;
    const cur = best.get(m[1]);
    if (!cur || v > cur.v) best.set(m[1], { file: f, v });
  }
  return [...best.values()].map((b) => path.join(INBOX(), b.file)).sort();
};

const taskFor = (draftFile: string, draft: InboxDraft): ReviewTask | null => {
  const sha = draft.poll.provenance?.sha256;
  const pubId = draft.poll.publicationId?.split(":")[1];
  if (!sha || !pubId) return null;
  const record = readPublicationLedger(REPO_ROOT, draft.poll.agencyId).find(
    (r) => r.pubIds.includes(pubId) || r.pubId === pubId,
  );
  const version = record?.versions.find((v) => v.sha256 === sha);
  if (!version) return null;
  return {
    pollId: draft.poll.id,
    draftFile,
    agencyId: draft.poll.agencyId,
    pubId,
    captureDir: path.join(REPO_ROOT, version.capturePath),
    captureSha256: sha,
    readingPath: readingPathFor(draft.poll.agencyId, pubId, sha),
  };
};

const readDraft = (file: string): InboxDraft =>
  JSON.parse(fs.readFileSync(file, "utf8")) as InboxDraft;

const readReading = (
  file: string,
): { reading: AiReading | null; errors: string[] } => {
  if (!fs.existsSync(file)) return { reading: null, errors: ["no reading"] };
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { reading: null, errors: ["reading is not valid JSON"] };
  }
  const errors = validateReading(value);
  return errors.length
    ? { reading: null, errors }
    : { reading: value as AiReading, errors };
};

/** Apply the open classifications the reader supplied (genre, round, base).
 *  Scoring is left exactly as the extractor set it: a classification only one
 *  reader made never makes a poll count toward accuracy on its own. */
export const applyFills = (draft: InboxDraft, fills: Fill[]): void => {
  for (const fill of fills) {
    if (fill.field === "genre") {
      draft.genre = fill.value;
      draft.poll.genre = fill.value;
      for (const q of draft.poll.questions ?? [])
        if (q.genre === "unclear") q.genre = fill.value;
      continue;
    }
    const q = draft.poll.questions?.find((x) => x.id === fill.questionId);
    if (!q) continue;
    if (fill.field === "round") q.round = fill.value;
    else q.base = { ...q.base, kind: fill.kind, label: fill.label };
  }
};

/** Every reader-only classification must be supported by the capture: a
 *  base by its verbatim phrase, a genre by the agency's own wording. Round
 *  carries no textual marker and stays as the reader stated it. */
export const groundFills = (fills: Fill[], sourceText: string): string[] => {
  const doc = normalise(sourceText);
  const diffs: string[] = [];
  const disclaims = /не\s+(?:са|е)\s+прогноза/u.test(doc);
  const forecasts = /прогноз/u.test(
    doc.replace(/не\s+(?:са|е)\s+прогноза/gu, ""),
  );
  for (const fill of fills) {
    if (
      fill.field === "base" &&
      !(fill.phrase && isGroundedIn(fill.phrase, doc))
    )
      diffs.push(`base: reader's phrase is not in the captured text`);
    if (fill.field === "genre") {
      const supported =
        fill.value === "raw_attitudes"
          ? disclaims && !forecasts
          : fill.value === "forecast"
            ? forecasts && !disclaims
            : fill.value === "both_published" && disclaims && forecasts;
      if (!supported)
        diffs.push(`genre: the text does not state „${fill.value}"`);
    }
  }
  return diffs;
};

/** The publication date the capture itself states (SOURCE.json, else the
 *  page's article:published_time), or null. */
export const capturedPublishedAt = (captureDir: string): string | null => {
  try {
    const stamp = JSON.parse(
      fs.readFileSync(path.join(captureDir, "SOURCE.json"), "utf8"),
    ) as { publishedAt?: string | null };
    if (stamp.publishedAt) return stamp.publishedAt.slice(0, 10);
    const html = fs.readFileSync(path.join(captureDir, "page.html"), "utf8");
    return (
      /article:published_time"\s+content="(\d{4}-\d{2}-\d{2})/.exec(
        html,
      )?.[1] ?? null
    );
  } catch {
    return null;
  }
};

/** Fill what the extractor never resolves (methodology, sponsor, publication
 *  date) from the reading — methodology/sponsor only when their Bulgarian
 *  quote actually occurs in the captured text. Returns a reason when the
 *  draft still has no grounded methodology (accept requires one). */
export const fillFromReading = (
  draft: InboxDraft,
  read: ReadingPoll,
  sourceText: string,
  publishedAt: string | null,
): string | null => {
  const doc = normalise(sourceText);
  const grounded = (q: string | null): boolean => !!q && isGroundedIn(q, doc);
  if (!draft.poll.methodology?.bg) {
    if (!read.methodology || !grounded(read.methodologyQuote))
      return "methodology: reader's quote is not in the captured text";
    draft.poll.methodology = read.methodology;
    draft.evidence.methodology = read.methodologyQuote!;
    if (draft.poll.provenance)
      draft.poll.provenance.quotes = {
        ...draft.poll.provenance.quotes,
        methodology: read.methodologyQuote!,
      };
  }
  if (draft.poll.sponsor === undefined && read.sponsor !== null) {
    // A sponsor the reader names but in the wrong shape is reported, never
    // silently dropped — the source states it, so a human should see it.
    if (!isBilingualLabel(read.sponsor))
      return "sponsor: reader's value is not a {bg, en} label";
    if (grounded(read.sponsorQuote)) {
      draft.poll.sponsor = read.sponsor;
      draft.evidence.sponsor = read.sponsorQuote!;
    }
  }
  // Only a date the capture itself states — never the reader's alone.
  if (
    !draft.poll.publishedAt &&
    publishedAt &&
    read.publishedAt === publishedAt
  )
    draft.poll.publishedAt = publishedAt;
  return null;
};

const writeDraft = (file: string, draft: InboxDraft): void =>
  fs.writeFileSync(file, `${JSON.stringify(draft, null, 2)}\n`);

export type Outcome =
  | { pollId: string; result: "accepted" }
  | { pollId: string; result: "needs_human"; diffs: string[] }
  | { pollId: string; result: "no_reading"; reason: string };

export const reviewOne = async (
  task: ReviewTask,
  dryRun: boolean,
): Promise<Outcome> => {
  const { reading, errors } = readReading(task.readingPath);
  if (!reading)
    return {
      pollId: task.pollId,
      result: "no_reading",
      reason: errors.join("; "),
    };

  const draft = readDraft(task.draftFile);
  const diffs: string[] = [];
  if (isProvisionalPollId(draft.poll.id)) diffs.push("provisional poll id");
  if (/\.v\d+\.json$/.test(task.draftFile))
    diffs.push("re-issued publication (.vN) — a correction needs a human");
  if (reading.agencyId !== draft.poll.agencyId || reading.pubId !== task.pubId)
    diffs.push("reading names a different publication");
  const cmp = compareDraftToReading(
    draft,
    reading,
    loadPartyAliases(REPO_ROOT),
  );
  diffs.push(...cmp.diffs);

  if (diffs.length === 0 && cmp.matched) {
    const text = acquiredSourceText(
      await acquireText(task.captureDir, task.agencyId),
    );
    diffs.push(...groundFills(cmp.fills, text));
    applyFills(draft, cmp.fills);
    const missing = fillFromReading(
      draft,
      cmp.matched,
      text,
      capturedPublishedAt(task.captureDir),
    );
    if (missing) diffs.push(missing);
  }

  const reviewedAt = new Date().toISOString();
  if (diffs.length) {
    if (!dryRun) {
      const fresh = readDraft(task.draftFile);
      fresh.aiReview = {
        verdict: "needs_human",
        model: reading.model,
        reviewedAt,
        draftHash: reviewDraftHash(fresh),
        diffs,
      };
      writeDraft(task.draftFile, fresh);
    }
    return { pollId: task.pollId, result: "needs_human", diffs };
  }
  if (dryRun) return { pollId: task.pollId, result: "accepted" };

  const before = fs.readFileSync(task.draftFile, "utf8");
  draft.aiReview = {
    verdict: "agree",
    model: reading.model,
    reviewedAt,
    draftHash: reviewDraftHash(draft),
    diffs: [],
  };
  writeDraft(task.draftFile, draft);

  // accept signals refusal through process.exitCode; isolate this call's.
  const prevExit = process.exitCode;
  process.exitCode = undefined;
  let failure: string | null = null;
  try {
    acceptMain([draft.poll.id]);
    if (process.exitCode !== undefined && process.exitCode !== 0)
      failure = "polls:accept refused the merged draft (see log above)";
  } catch (e) {
    failure = `polls:accept threw: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    process.exitCode = prevExit;
  }

  if (failure) {
    // Accept did not complete — restore the extractor draft and record why.
    const restored = JSON.parse(before) as InboxDraft;
    const why = [failure];
    restored.aiReview = {
      verdict: "needs_human",
      model: reading.model,
      reviewedAt,
      draftHash: reviewDraftHash(restored),
      diffs: why,
    };
    writeDraft(task.draftFile, restored);
    return { pollId: task.pollId, result: "needs_human", diffs: why };
  }

  // An unattended accept must carry its AI stamp: an absent `locked.review`
  // reads as "a human reviewed this", which here would be false.
  const corpus = path.join(
    REPO_ROOT,
    draft.race === "presidential"
      ? "data/polls/presidential/polls.json"
      : "data/polls/polls.json",
  );
  const accepted = (JSON.parse(fs.readFileSync(corpus, "utf8")) as Poll[]).find(
    (p) => p.id === draft.poll.id,
  );
  if (accepted?.locked?.review?.draftHash !== draft.aiReview.draftHash) {
    console.error(
      `${draft.poll.id}: accepted WITHOUT its AI-review stamp — it now reads as human-reviewed; inspect it`,
    );
    process.exitCode = 1;
  }
  return { pollId: task.pollId, result: "accepted" };
};

export const collectTasks = (agency?: string, pub?: string): ReviewTask[] =>
  latestDrafts()
    .map((file) => taskFor(file, readDraft(file)))
    .filter((t): t is ReviewTask => t !== null)
    .filter(
      (t) => (!agency || t.agencyId === agency) && (!pub || t.pubId === pub),
    );

export const main = async (argv: string[]): Promise<void> => {
  const flag = flagReader(argv);
  const tasks = collectTasks(flag("agency"), flag("pub"));

  if (argv.includes("--prepare")) {
    const pending = tasks.filter(
      (t) => readReading(t.readingPath).reading === null,
    );
    const rel = (p: string) => path.relative(REPO_ROOT, p);
    console.log(
      JSON.stringify(
        pending.map((t) => ({
          pollId: t.pollId,
          agencyId: t.agencyId,
          pubId: t.pubId,
          captureDir: rel(t.captureDir),
          captureSha256: t.captureSha256,
          readingPath: rel(t.readingPath),
        })),
        null,
        2,
      ),
    );
    return;
  }

  const dryRun = argv.includes("--dry-run");
  const outcomes: Outcome[] = [];
  for (const task of tasks) outcomes.push(await reviewOne(task, dryRun));

  for (const o of outcomes) {
    if (o.result === "accepted")
      console.log(`${dryRun ? "WOULD ACCEPT" : "ACCEPTED"}  ${o.pollId}`);
    else if (o.result === "needs_human") {
      console.log(`NEEDS HUMAN  ${o.pollId}`);
      for (const d of o.diffs) console.log(`    - ${d}`);
    } else console.log(`NO READING   ${o.pollId} (${o.reason})`);
  }
  const n = (r: Outcome["result"]) =>
    outcomes.filter((o) => o.result === r).length;
  console.log(
    `\n${n("accepted")} accepted, ${n("needs_human")} need a human, ${n("no_reading")} without a reading`,
  );
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
