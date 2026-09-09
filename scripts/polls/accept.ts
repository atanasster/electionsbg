// `npm run polls:accept` — Tier 2, T2d (docs/plans/polls-agency-watchers-v1.md
// decision 7). Promotes ONE reviewed inbox draft into the parliamentary
// corpus (`data/polls/polls.json` / `polls_details.json`): sets `locked`
// and `provenance`, merges the minified JSON, and deletes the inbox file.
// An EXISTING poll at the same id protected either by `locked` OR by the
// legacy `genre` marker (polls_corpus.test.ts's own "either signal
// protects it" rule) is refused unless `--replace`, which records the
// superseded poll+details under the new poll's `locked.supersedes` rather
// than discarding them.
//
//   npm run polls:accept -- tr-2026-04-16
//   npm run polls:accept -- tr-2026-04-16 --genre forecast
//   npm run polls:accept -- tr-2026-04-16 --election 2026-11-08
//   npm run polls:accept -- tr-2026-04-16 --locked-by agency_pdf
//   npm run polls:accept -- tr-2026-04-16 --replace
//
// Presidential drafts (decision 10's separate file family) and `--cycle`
// (presidential-only, decision 11) are NOT supported here yet — Tier 4
// has not shipped that family's exact schema. Passing a presidential
// draft's id is refused cleanly rather than attempted.
//
// `methodology` is never resolved by an extractor (decision 5 — an
// English translation of an agency's own methodology boilerplate cannot
// be verified against a Bulgarian source quote) and MUST be present in
// the draft file before accepting; the operator fills it in by hand,
// editing the draft JSON directly, which is also the natural place to
// fix anything else a human reading the source caught that the
// extractor didn't. Because the draft is hand-edited, `validateDraft`
// below checks more than bare presence — a stray `"respondents": "1004"`
// or a blank methodology string must be caught here rather than reaching
// the corpus.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { flagReader } from "./lib/argv";
import type { InboxDraft } from "./lib/draft";
import type { Poll, PollDetail } from "../../src/data/polls/pollsTypes";

const PROD_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
let REPO_ROOT = PROD_REPO_ROOT;

/** TEST-ONLY seam, matching fetch.ts's/extract.ts's own convention:
 *  redirects every corpus/inbox read and write to a scratch directory.
 *  Pass no argument to restore the real repo root. */
export const __setAcceptRootForTests = (root?: string): void => {
  REPO_ROOT = root ?? PROD_REPO_ROOT;
};

const POLLS_DIR = () => path.join(REPO_ROOT, "data/polls");
const INBOX_DIR = () => path.join(POLLS_DIR(), "_inbox");

/** Matches the PROVISIONAL id shape both extractors mint when no fieldwork
 *  end date resolves (`<agency-lowercase>-pub-<pubId>`, decision 7's
 *  disposable placeholder — see trend.ts's/alpha_research.ts's own header
 *  comments). `pubId` is either a site item's ascending numeric id or a
 *  `sha256Short` hex digest (16 lowercase hex chars, minted for a
 *  `--url`/`--archive` capture — scripts/watch/fingerprint.ts), so the id
 *  half must accept hex, not just digits. */
const PROVISIONAL_POLL_ID_RE = /-pub-[0-9a-f]+$/i;

const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every inbox draft file for `pollId` — the bare `<pollId>.json` (treated
 *  as version 1) plus every `.vN` variant — compared UNIFORMLY so a
 *  coexisting bare draft and a newer `.vN` (decision 7's re-fetch case)
 *  resolve to the higher version rather than the bare file winning simply
 *  because it happens to exist. */
const draftCandidates = (
  pollId: string,
): { file: string; version: number }[] => {
  if (!fs.existsSync(INBOX_DIR())) return [];
  const escaped = escapeRegExp(pollId);
  const bareRe = new RegExp(`^${escaped}\\.json$`);
  const versionedRe = new RegExp(`^${escaped}\\.v(\\d+)\\.json$`);
  const out: { file: string; version: number }[] = [];
  for (const f of fs.readdirSync(INBOX_DIR())) {
    if (bareRe.test(f)) out.push({ file: f, version: 1 });
    else {
      const m = versionedRe.exec(f);
      if (m) out.push({ file: f, version: Number(m[1]) });
    }
  }
  return out.sort((a, b) => b.version - a.version);
};

const findDraftFile = (pollId: string): string | null => {
  const candidates = draftCandidates(pollId);
  return candidates.length > 0
    ? path.join(INBOX_DIR(), candidates[0].file)
    : null;
};

const readJsonArray = <T>(file: string): T[] =>
  fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T[]) : [];

// Minified, no trailing newline — the corpus's own established writer
// convention (scrape_polls.ts), asserted by polls_corpus.test.ts. Written
// via a temp file + rename rather than a plain writeFileSync: rename is
// atomic on the same filesystem, so a crash mid-write can never leave a
// truncated corpus file. This narrows, but cannot close, the window
// between the two corpus files' writes below — a genuine two-file
// transaction would need a lock file or a journal this CLI does not have.
const writeJsonArray = (file: string, arr: unknown[]): void => {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(arr));
  fs.renameSync(tmp, file);
};

const VALID_LOCK_TIERS = [
  "agency_spreadsheet",
  "agency_pdf",
  "agency_website",
  "third_party_consensus",
] as const;
type LockTier = (typeof VALID_LOCK_TIERS)[number];
const isLockTier = (v: string): v is LockTier =>
  (VALID_LOCK_TIERS as readonly string[]).includes(v);

export interface Opts {
  pollId?: string;
  election?: string;
  genre?: string;
  lockedBy?: string;
  replace: boolean;
  allowEmpty: boolean;
}

export const parseArgv = (argv: string[]): Opts => {
  const flag = flagReader(argv);
  const positional = argv.find((a) => !a.startsWith("--"));
  return {
    pollId: positional,
    election: flag("election"),
    genre: flag("genre"),
    lockedBy: flag("locked-by"),
    replace: argv.includes("--replace"),
    allowEmpty: argv.includes("--allow-empty"),
  };
};

const VALID_GENRES = new Set([
  "raw_attitudes",
  "forecast",
  "both_published",
  "unclear",
]);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

/** Runtime validation of the hand-edited draft beyond bare presence — see
 *  this module's own header for why that matters. Returns every problem
 *  found rather than just the first, since a failing draft is handed back
 *  to the operator to fix by hand in one pass. */
const validateDraft = (draft: InboxDraft): string[] => {
  const errors: string[] = [];
  if (!isNonEmptyString(draft.poll.fieldwork))
    errors.push("poll.fieldwork is missing or blank");
  if (
    !isNonEmptyString(draft.poll.methodology?.bg) ||
    !isNonEmptyString(draft.poll.methodology?.en)
  )
    errors.push(
      "poll.methodology.bg/.en is missing, blank, or whitespace-only",
    );
  if (!isNonEmptyString(draft.poll.source))
    errors.push("poll.source is missing or blank");
  if (
    draft.poll.respondents != null &&
    typeof draft.poll.respondents !== "number"
  )
    errors.push(
      `poll.respondents must be a number or null, got ${JSON.stringify(draft.poll.respondents)}`,
    );
  if (
    draft.poll.electionDate != null &&
    typeof draft.poll.electionDate !== "string"
  )
    errors.push(
      `poll.electionDate must be a string or null, got ${JSON.stringify(draft.poll.electionDate)}`,
    );
  if (!Array.isArray(draft.details)) {
    errors.push("details must be an array");
  } else {
    draft.details.forEach((d, i) => {
      if (typeof d.support !== "number" || !Number.isFinite(d.support))
        errors.push(
          `details[${i}].support must be a finite number, got ${JSON.stringify(d.support)}`,
        );
      if (!isNonEmptyString(d.nickName_bg))
        errors.push(`details[${i}].nickName_bg is missing or blank`);
      if (typeof d.nickName_en !== "string")
        errors.push(`details[${i}].nickName_en must be a string`);
    });
  }
  return errors;
};

/** Either signal protects a poll from an automated overwrite — the corpus's
 *  own documented rule (polls_corpus.test.ts: "a poll carries either a
 *  `locked` provenance OR the legacy `genre` marker. Both signals protect
 *  it."). Checking `locked` alone let a genre-only-protected poll be
 *  silently clobbered with no `--replace` and no `supersedes` backup. */
const isProtected = (p: Poll): boolean =>
  p.locked !== undefined || p.genre !== undefined;

export const main = (argv: string[]): void => {
  const opts = parseArgv(argv);
  if (!opts.pollId) {
    console.error(
      "usage: polls:accept -- <pollId> [--election <iso>] [--genre <g>] [--locked-by <tier>] [--replace]",
    );
    process.exitCode = 1;
    return;
  }
  if (opts.genre && !VALID_GENRES.has(opts.genre)) {
    console.error(
      `--genre "${opts.genre}" is not one of: ${[...VALID_GENRES].join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }
  if (opts.election !== undefined && !ISO_DATE_RE.test(opts.election)) {
    console.error(
      `--election "${opts.election}" must be an ISO date (YYYY-MM-DD)`,
    );
    process.exitCode = 1;
    return;
  }
  const lockedBy = opts.lockedBy ?? "agency_website";
  if (!isLockTier(lockedBy)) {
    console.error(
      `--locked-by "${lockedBy}" is not one of: ${VALID_LOCK_TIERS.join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }

  const draftFile = findDraftFile(opts.pollId);
  if (!draftFile) {
    console.error(
      `no inbox draft found for "${opts.pollId}" in ${path.relative(REPO_ROOT, INBOX_DIR())}`,
    );
    process.exitCode = 1;
    return;
  }
  const draft = JSON.parse(fs.readFileSync(draftFile, "utf8")) as InboxDraft;

  if (draft.race !== "parliamentary") {
    console.error(
      `${opts.pollId}: race is "${draft.race}" — polls:accept only supports parliamentary drafts today (decision 10's presidential family is a separate, not-yet-built schema)`,
    );
    process.exitCode = 1;
    return;
  }
  if (PROVISIONAL_POLL_ID_RE.test(draft.poll.id)) {
    console.error(
      `${opts.pollId}: this is a PROVISIONAL id — no fieldwork date ever resolved for it. Fix the extraction (or hand-edit the draft) and re-run polls:extract before accepting.`,
    );
    process.exitCode = 1;
    return;
  }
  const validationErrors = validateDraft(draft);
  if (validationErrors.length > 0) {
    for (const err of validationErrors) console.error(`${opts.pollId}: ${err}`);
    console.error(
      `${opts.pollId}: edit ${path.relative(REPO_ROOT, draftFile)} by hand and fix the above before accepting`,
    );
    process.exitCode = 1;
    return;
  }
  if (draft.details.length === 0 && !opts.allowEmpty) {
    console.error(
      `${opts.pollId}: zero accepted shares — nothing to publish (likely a chart-only post whose Vision fallback isn't built yet; see the draft's own refused entries). Pass --allow-empty to accept anyway.`,
    );
    process.exitCode = 1;
    return;
  }

  const pollsFile = path.join(POLLS_DIR(), "polls.json");
  const detailsFile = path.join(POLLS_DIR(), "polls_details.json");
  const polls = readJsonArray<Poll>(pollsFile);
  const details = readJsonArray<PollDetail>(detailsFile);

  const orphanedPollIds = [
    ...new Set(
      details
        .filter(
          (d) =>
            d.pollId !== draft.poll.id && !polls.some((p) => p.id === d.pollId),
        )
        .map((d) => d.pollId),
    ),
  ];
  if (orphanedPollIds.length > 0) {
    console.warn(
      `warning: polls_details.json carries ${orphanedPollIds.length} pollId(s) with no matching entry in polls.json: ${orphanedPollIds.join(", ")}`,
    );
  }

  const existing = polls.find((p) => p.id === draft.poll.id);
  if (existing && isProtected(existing) && !opts.replace) {
    const reason = existing.locked
      ? `already locked (by ${existing.locked.by}, ${existing.locked.lockedAt})`
      : `already protected by its legacy genre marker (genre: ${existing.genre})`;
    console.error(
      `${draft.poll.id} is ${reason} — pass --replace to overwrite it`,
    );
    process.exitCode = 1;
    return;
  }

  const locked: NonNullable<Poll["locked"]> = {
    by: lockedBy,
    lockedAt: new Date().toISOString().slice(0, 10),
    note: "auto-extracted; evidence in provenance",
    ...(existing && isProtected(existing) && opts.replace
      ? {
          supersedes: {
            pollId: existing.id,
            poll: existing,
            details: details.filter((d) => d.pollId === existing.id),
          },
        }
      : {}),
  };
  // Non-null: validateDraft above already confirmed each of these is a
  // non-empty string/object — TS cannot see across that call, since
  // DraftPoll (lib/draft.ts) marks every one of them optional.
  const poll: Poll = {
    id: draft.poll.id,
    agencyId: draft.poll.agencyId,
    fieldwork: draft.poll.fieldwork!,
    electionDate: opts.election ?? draft.poll.electionDate ?? null,
    respondents: draft.poll.respondents ?? null,
    methodology: draft.poll.methodology!,
    source: draft.poll.source!,
    genre: (opts.genre as Poll["genre"]) ?? draft.genre,
    residual: draft.residual,
    race: draft.race,
    ...(draft.poll.provenance ? { provenance: draft.poll.provenance } : {}),
    locked,
  };

  const nextPolls = [...polls.filter((p) => p.id !== poll.id), poll];
  const nextDetails = [
    ...details.filter((d) => d.pollId !== poll.id),
    ...draft.details,
  ];
  writeJsonArray(pollsFile, nextPolls);
  writeJsonArray(detailsFile, nextDetails);
  fs.rmSync(draftFile);

  const replacedNote = !existing
    ? ""
    : existing.locked
      ? " (replaced a locked entry)"
      : existing.genre !== undefined
        ? " (replaced a legacy genre-protected entry)"
        : " (updated an existing unprotected entry)";
  console.log(
    `accepted ${poll.id} — ${draft.details.length} share(s), locked ${locked.by} ${locked.lockedAt}${replacedNote}`,
  );
  if (poll.electionDate) {
    console.log(
      // analyze_accuracy.ts's own CLI takes no --race flag (it reads the
      // one parliamentary polls.json unconditionally — Tier 4's separate
      // presidential file family isn't wired into it yet), so the command
      // named here must match what that CLI actually accepts.
      `  electionDate is set — run \`npm run polls:analyze\` to rescore it`,
    );
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2));
}
