// `npm run polls:accept` — Tier 2, T2d (docs/plans/polls-agency-watchers-v1.md
// decision 7), extended by Tier 4 to also accept presidential drafts.
// Promotes ONE reviewed inbox draft into the matching corpus: sets
// `locked` and `provenance`, merges the minified JSON, and deletes the
// inbox file. `draft.race` alone decides which corpus a draft goes to —
// no `--race` flag; the draft file already carries it — parliamentary
// into `data/polls/polls.json` / `polls_details.json`, presidential into
// `data/polls/presidential/polls.json` / `polls_details.json` /
// `runoffs.json` (decision 10's separate file family; `Poll`/`PollLock`
// are shared, so locking/`--replace`/supersedes work identically on
// both). An EXISTING poll at the same id protected either by `locked` OR
// by the legacy `genre` marker (polls_corpus.test.ts's own "either
// signal protects it" rule) is refused unless `--replace`, which records
// the superseded poll+details under the new poll's `locked.supersedes`
// rather than discarding them.
//
//   npm run polls:accept -- tr-2026-04-16
//   npm run polls:accept -- tr-2026-04-16 --genre forecast
//   npm run polls:accept -- tr-2026-04-16 --election 2026-11-08
//   npm run polls:accept -- tr-2026-04-16 --locked-by agency_pdf
//   npm run polls:accept -- tr-2026-04-16 --replace
//   npm run polls:accept -- gm-2026-07-11
//   npm run polls:accept -- gm-2026-07-11 --cycle 2026_11_08_pvr
//
// `--cycle` is presidential-only (decision 11) and OPTIONAL: a 2026
// draft's own `poll.cycle` is `null` at extraction time (no round-1
// decree yet, per `UPCOMING_ELECTIONS`'s "estimated" entry), and stays
// `null` through accept unless `--cycle` names the real `<date>_pvr`
// folder id — the same override relationship `--election` already has
// with `draft.poll.electionDate`. It exists mainly for Tier 4b's
// historical backfill, where a draft's own capture predates the cycle
// folder that will eventually hold its scoring fixture.
//
// `methodology` is never resolved by an extractor (decision 5 — an
// English translation of an agency's own methodology boilerplate cannot
// be verified against a Bulgarian source quote) and MUST be present in
// the draft file before accepting; the operator fills it in by hand,
// editing the draft JSON directly, which is also the natural place to
// fix anything else a human reading the source caught that the
// extractor didn't. Because the draft is hand-edited, `validateDraft`/
// `validatePresidentialDraft` below check more than bare presence — a
// stray `"respondents": "1004"` or a blank methodology string must be
// caught here rather than reaching the corpus.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { flagReader } from "./lib/argv";
import type {
  InboxDraft,
  ParliamentaryInboxDraft,
  PresidentialInboxDraft,
} from "./lib/draft";
import type {
  Poll,
  PollDetail,
  PresidentialPollDetail,
  Runoff,
} from "../../src/data/polls/pollsTypes";

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
// Decision 10's separate presidential file family — never mixed with the
// parliamentary corpus above.
const PRESIDENTIAL_DIR = () => path.join(POLLS_DIR(), "presidential");

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
// between a family's corpus files' writes below (two for parliamentary,
// three for presidential) — a genuine multi-file transaction would need
// a lock file or a journal this CLI does not have.
//
// Creates the PARENT directory first — `data/polls/` always exists
// (long-lived committed files live there already), but
// `data/polls/presidential/` does not until the first presidential poll
// is ever accepted, and `fs.writeFileSync` does not create missing
// directories. `mkdirSync(..., { recursive: true })` is idempotent, so
// this costs nothing on every later call once the directory exists.
const writeJsonArray = (file: string, arr: unknown[]): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
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
  cycle?: string;
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
    cycle: flag("cycle"),
  };
};

const VALID_GENRES = new Set([
  "raw_attitudes",
  "forecast",
  "both_published",
  "unclear",
]);

// The round-1 folder id shape (`data/<date>_pvr/`), decision 11 —
// e.g. "2026_11_08_pvr".
const CYCLE_ID_RE = /^\d{4}_\d{2}_\d{2}_pvr$/;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

/** Runtime validation of the hand-edited draft beyond bare presence — see
 *  this module's own header for why that matters. Returns every problem
 *  found rather than just the first, since a failing draft is handed back
 *  to the operator to fix by hand in one pass. */
/** The passport fields both file families share (same `Poll` type) —
 *  factored out so the parliamentary and presidential validators below
 *  cannot silently drift apart on a rule that has no per-race variation
 *  at all. */
const validatePollPassport = (poll: {
  fieldwork?: string;
  methodology?: { bg?: string; en?: string };
  source?: string;
  respondents?: number | null;
  electionDate?: string | null;
}): string[] => {
  const errors: string[] = [];
  if (!isNonEmptyString(poll.fieldwork))
    errors.push("poll.fieldwork is missing or blank");
  if (
    !isNonEmptyString(poll.methodology?.bg) ||
    !isNonEmptyString(poll.methodology?.en)
  )
    errors.push(
      "poll.methodology.bg/.en is missing, blank, or whitespace-only",
    );
  if (!isNonEmptyString(poll.source))
    errors.push("poll.source is missing or blank");
  if (poll.respondents != null && typeof poll.respondents !== "number")
    errors.push(
      `poll.respondents must be a number or null, got ${JSON.stringify(poll.respondents)}`,
    );
  if (poll.electionDate != null && typeof poll.electionDate !== "string")
    errors.push(
      `poll.electionDate must be a string or null, got ${JSON.stringify(poll.electionDate)}`,
    );
  return errors;
};

const validateDraft = (draft: ParliamentaryInboxDraft): string[] => {
  const errors = validatePollPassport(draft.poll);
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

/** Mirrors `validateDraft` for the presidential shape (candidate rows +
 *  runoff pairings instead of party shares) — same "hand-edited, so check
 *  more than bare presence" rationale from this module's own header. */
const validatePresidentialDraft = (draft: PresidentialInboxDraft): string[] => {
  const errors = validatePollPassport(draft.poll);
  if (!Array.isArray(draft.details)) {
    errors.push("details must be an array");
  } else {
    draft.details.forEach((d, i) => {
      if (typeof d.support !== "number" || !Number.isFinite(d.support))
        errors.push(
          `details[${i}].support must be a finite number, got ${JSON.stringify(d.support)}`,
        );
      if (!isNonEmptyString(d.candidateKey))
        errors.push(`details[${i}].candidateKey is missing or blank`);
      if (!isNonEmptyString(d.candidateName_bg))
        errors.push(`details[${i}].candidateName_bg is missing or blank`);
      if (typeof d.candidateName_en !== "string")
        errors.push(`details[${i}].candidateName_en must be a string`);
      if (d.nominator != null && typeof d.nominator !== "string")
        errors.push(`details[${i}].nominator must be a string or null`);
      if (d.placeholderFor != null && typeof d.placeholderFor !== "string")
        errors.push(`details[${i}].placeholderFor must be a string or null`);
    });
  }
  if (!Array.isArray(draft.runoffs)) {
    errors.push("runoffs must be an array");
  } else {
    draft.runoffs.forEach((r, i) => {
      if (!isNonEmptyString(r.a))
        errors.push(`runoffs[${i}].a is missing or blank`);
      if (!isNonEmptyString(r.b))
        errors.push(`runoffs[${i}].b is missing or blank`);
      if (typeof r.supportA !== "number" || !Number.isFinite(r.supportA))
        errors.push(
          `runoffs[${i}].supportA must be a finite number, got ${JSON.stringify(r.supportA)}`,
        );
      if (typeof r.supportB !== "number" || !Number.isFinite(r.supportB))
        errors.push(
          `runoffs[${i}].supportB must be a finite number, got ${JSON.stringify(r.supportB)}`,
        );
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

/** Refuses an existing protected poll without `--replace`; otherwise
 *  returns the `locked` block to stamp on the new one (carrying a
 *  `supersedes` backup when an existing protected entry is being
 *  overwritten). `null` return means "already refused and reported" —
 *  the caller must stop. Shared verbatim by both file families: locking
 *  is a property of `Poll`/`PollLock`, neither of which varies by race. */
const buildLockOrRefuse = (
  pollId: string,
  existing: Poll | undefined,
  existingDetails: PollDetail[] | PresidentialPollDetail[],
  opts: Opts,
  lockedBy: LockTier,
): NonNullable<Poll["locked"]> | null => {
  if (existing && isProtected(existing) && !opts.replace) {
    const reason = existing.locked
      ? `already locked (by ${existing.locked.by}, ${existing.locked.lockedAt})`
      : `already protected by its legacy genre marker (genre: ${existing.genre})`;
    console.error(`${pollId} is ${reason} — pass --replace to overwrite it`);
    return null;
  }
  return {
    by: lockedBy,
    lockedAt: new Date().toISOString().slice(0, 10),
    note: "auto-extracted; evidence in provenance",
    ...(existing && isProtected(existing) && opts.replace
      ? {
          supersedes: {
            pollId: existing.id,
            poll: existing,
            details: existingDetails,
          },
        }
      : {}),
  };
};

const replacedNoteFor = (existing: Poll | undefined): string =>
  !existing
    ? ""
    : existing.locked
      ? " (replaced a locked entry)"
      : existing.genre !== undefined
        ? " (replaced a legacy genre-protected entry)"
        : " (updated an existing unprotected entry)";

/** A `polls_details.json` row whose `pollId` matches no entry in
 *  `polls.json` is orphaned — usually a poll deleted by hand without also
 *  cleaning up its detail rows. Not fatal (the corpus still loads), but
 *  worth surfacing rather than carrying forward silently. Shared by both
 *  file families; only the two file labels in the message differ. */
const warnOrphanedDetails = (
  details: { pollId: string }[],
  polls: Poll[],
  currentPollId: string,
  detailsLabel: string,
  pollsLabel: string,
): void => {
  const orphanedPollIds = [
    ...new Set(
      details
        .filter(
          (d) =>
            d.pollId !== currentPollId && !polls.some((p) => p.id === d.pollId),
        )
        .map((d) => d.pollId),
    ),
  ];
  if (orphanedPollIds.length > 0) {
    console.warn(
      `warning: ${detailsLabel} carries ${orphanedPollIds.length} pollId(s) with no matching entry in ${pollsLabel}: ${orphanedPollIds.join(", ")}`,
    );
  }
};

const acceptParliamentary = (
  draft: ParliamentaryInboxDraft,
  opts: Opts,
  draftFile: string,
  lockedBy: LockTier,
): void => {
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

  warnOrphanedDetails(
    details,
    polls,
    draft.poll.id,
    "polls_details.json",
    "polls.json",
  );

  const existing = polls.find((p) => p.id === draft.poll.id);
  const locked = buildLockOrRefuse(
    draft.poll.id,
    existing,
    details.filter((d) => d.pollId === existing?.id),
    opts,
    lockedBy,
  );
  if (!locked) {
    process.exitCode = 1;
    return;
  }
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

  console.log(
    `accepted ${poll.id} — ${draft.details.length} share(s), locked ${locked.by} ${locked.lockedAt}${replacedNoteFor(existing)}`,
  );
  if (poll.electionDate) {
    console.log(
      // analyze_accuracy.ts's own CLI takes no --race flag (it reads the
      // one parliamentary polls.json unconditionally — Tier 4's separate
      // presidential file family has its own analyzer, T4.2), so the
      // command named here must match what that CLI actually accepts.
      `  electionDate is set — run \`npm run polls:analyze\` to rescore it`,
    );
  }
};

const acceptPresidential = (
  draft: PresidentialInboxDraft,
  opts: Opts,
  draftFile: string,
  lockedBy: LockTier,
): void => {
  const validationErrors = validatePresidentialDraft(draft);
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
      `${opts.pollId}: zero accepted candidate/placeholder rows — nothing to publish (see the draft's own refused entries). Pass --allow-empty to accept anyway.`,
    );
    process.exitCode = 1;
    return;
  }

  const pollsFile = path.join(PRESIDENTIAL_DIR(), "polls.json");
  const detailsFile = path.join(PRESIDENTIAL_DIR(), "polls_details.json");
  const runoffsFile = path.join(PRESIDENTIAL_DIR(), "runoffs.json");
  const polls = readJsonArray<Poll>(pollsFile);
  const details = readJsonArray<PresidentialPollDetail>(detailsFile);
  const runoffs = readJsonArray<Runoff>(runoffsFile);

  warnOrphanedDetails(
    details,
    polls,
    draft.poll.id,
    "presidential/polls_details.json",
    "presidential/polls.json",
  );

  const existing = polls.find((p) => p.id === draft.poll.id);
  const locked = buildLockOrRefuse(
    draft.poll.id,
    existing,
    details.filter((d) => d.pollId === existing?.id),
    opts,
    lockedBy,
  );
  if (!locked) {
    process.exitCode = 1;
    return;
  }
  // Non-null: validatePresidentialDraft above already confirmed each of
  // these — see validateDraft's identical comment above.
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
    // decision 11: stays whatever the draft carried (usually `null`,
    // pre-decree) unless `--cycle` names the real round-1 folder id. Like
    // `electionDate` just above, this does NOT fall back to the EXISTING
    // corpus entry's own `cycle` — re-accepting a corrected draft (a new
    // `.vN` version, `--replace`) without repeating `--cycle` resets it
    // to whatever the fresh draft carries. Re-pass the flag if the
    // previously-stamped cycle should persist.
    cycle: opts.cycle ?? draft.poll.cycle ?? null,
    ...(draft.poll.provenance ? { provenance: draft.poll.provenance } : {}),
    locked,
  };

  const nextPolls = [...polls.filter((p) => p.id !== poll.id), poll];
  const nextDetails = [
    ...details.filter((d) => d.pollId !== poll.id),
    ...draft.details,
  ];
  const nextRunoffs = [
    ...runoffs.filter((r) => r.pollId !== poll.id),
    ...draft.runoffs,
  ];
  writeJsonArray(pollsFile, nextPolls);
  writeJsonArray(detailsFile, nextDetails);
  writeJsonArray(runoffsFile, nextRunoffs);
  fs.rmSync(draftFile);

  console.log(
    `accepted ${poll.id} — ${draft.details.length} candidate/placeholder row(s), ${draft.runoffs.length} runoff(s), locked ${locked.by} ${locked.lockedAt}${replacedNoteFor(existing)}${poll.cycle ? `, cycle ${poll.cycle}` : ""}`,
  );
};

export const main = (argv: string[]): void => {
  const opts = parseArgv(argv);
  if (!opts.pollId) {
    console.error(
      "usage: polls:accept -- <pollId> [--election <iso>] [--genre <g>] [--locked-by <tier>] [--replace] [--cycle <date>_pvr]",
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
  if (opts.cycle !== undefined && !CYCLE_ID_RE.test(opts.cycle)) {
    console.error(
      `--cycle "${opts.cycle}" must be a round-1 folder id (e.g. "2026_11_08_pvr")`,
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

  if (PROVISIONAL_POLL_ID_RE.test(draft.poll.id)) {
    console.error(
      `${opts.pollId}: this is a PROVISIONAL id — no fieldwork date ever resolved for it. Fix the extraction (or hand-edit the draft) and re-run polls:extract before accepting.`,
    );
    process.exitCode = 1;
    return;
  }

  if (draft.race === "parliamentary") {
    if (opts.cycle !== undefined) {
      console.error(
        `${opts.pollId}: --cycle is presidential-only (decision 11) — this draft's race is "parliamentary"`,
      );
      process.exitCode = 1;
      return;
    }
    acceptParliamentary(draft, opts, draftFile, lockedBy);
    return;
  }
  acceptPresidential(draft, opts, draftFile, lockedBy);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2));
}
