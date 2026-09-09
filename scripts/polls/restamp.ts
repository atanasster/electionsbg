// `npm run polls:restamp` — decision 11 (docs/plans/polls-agency-watchers-v1.md).
// When a parliamentary vote becomes `scheduled`, this stamps every
// null-dated poll whose fieldwork end falls after the previous held
// election and before the new one — "every poll between two elections
// belongs to the later one", the corpus's own existing convention (the
// 2017-2019 ML waves carry `2021-04-04`) — then ALWAYS runs
// `polls:analyze`, so nobody has to remember that step by hand.
//
//   npm run polls:restamp -- --race parliamentary --to 2027-03-14
//   npm run polls:restamp -- --race presidential --cycle 2026_11_08_pvr
//
// Decision 11's parenthetical "(or a previously-estimated date moves)" IS
// presidential's case: `UPCOMING_ELECTIONS` (src/data/myarea/upcomingElections.ts)
// carries an "estimated" `electionDate` from the day a presidential poll
// is first accepted (`accept.ts`'s own `electionDate: draft.poll.electionDate`),
// so unlike the parliamentary side there is no `electionDate === null`
// window to fill — every presidential poll already carries the ESTIMATE.
// What changes when the decree lands is that the estimate becomes a
// DECREED date, and every presidential poll gets its `cycle` (still
// `null` pre-decree, decision 11) stamped to the real round-1 folder id
// — `<cycle>`'s own name (`YYYY_MM_DD_pvr`) IS that date, so this needs
// no separate `--to`. `polls:presidential:rekey` is a SEPARATE, later
// step (once `tickets.json` exists, months after the decree) — this file
// never touches `candidateKey`.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  isRealIsoDate,
  parseFieldworkEnd,
} from "../../src/data/polls/fieldwork";
import { flagReader } from "./lib/argv";
import type { Poll } from "../../src/data/polls/pollsTypes";

const PROD_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
let REPO_ROOT = PROD_REPO_ROOT;

/** TEST-ONLY seam, matching accept.ts's/extract.ts's own convention:
 *  redirects every corpus/elections-list read to a scratch directory.
 *  Pass no argument to restore the real repo root. */
export const __setRestampRootForTests = (root?: string): void => {
  REPO_ROOT = root ?? PROD_REPO_ROOT;
};

const POLLS_DIR = () => path.join(REPO_ROOT, "data/polls");
const PRESIDENTIAL_DIR = () => path.join(POLLS_DIR(), "presidential");
const ELECTIONS_JSON = () =>
  path.join(REPO_ROOT, "src/data/json/elections.json");

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Every HELD parliamentary election date, ascending — read from
 *  `src/data/json/elections.json`'s own folder-name convention
 *  (`"2026_04_19"`, no suffix — the local/presidential families carry a
 *  suffix and never appear in this file). This is the corpus's actual
 *  list of past votes, not a hand-maintained duplicate of it. */
const heldParliamentaryElectionDates = (): string[] => {
  const file = ELECTIONS_JSON();
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { name: string }[];
  return raw
    .map((e) => e.name.replace(/_/g, "-"))
    .filter((iso) => ISO_DATE_RE.test(iso))
    .sort();
};

/** The single most recent held election overall, or `null` when the
 *  corpus has none. Deliberately NOT filtered by `--to` first — filtering
 *  by `d < toIso` before taking the max excludes a held election that
 *  equals `toIso` exactly, which is precisely the "restamping onto an
 *  already-held date" mistake the caller below must refuse. `--to` is
 *  validated as strictly after this value, so once past that guard it
 *  IS "the previous election of the race" the window is measured from. */
const latestHeldElection = (): string | null => {
  const dates = heldParliamentaryElectionDates();
  return dates.length > 0 ? dates[dates.length - 1] : null;
};

const readJsonArray = <T>(file: string): T[] =>
  fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T[]) : [];

// Minified, no trailing newline — matches accept.ts's own writer, written
// via a temp file + rename so a crash mid-write can never leave a
// truncated corpus file (rename is atomic on the same filesystem).
const writeJsonArray = (file: string, arr: unknown[]): void => {
  // `data/polls/presidential/` may not exist yet on a fresh checkout that
  // has never accepted a presidential poll — accept.ts's own
  // `writeJsonArray` learned this the hard way (an ENOENT review finding);
  // mirrored here rather than assumed away.
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(arr));
  fs.renameSync(tmp, file);
};

type RunAnalyze = (race?: "presidential") => boolean;

const defaultRunAnalyze = (race?: "presidential"): boolean => {
  const scriptPath = path.join(REPO_ROOT, "scripts/polls/analyze_accuracy.ts");
  const args = race ? ["tsx", scriptPath, "--race", race] : ["tsx", scriptPath];
  const res = spawnSync("npx", args, {
    stdio: "inherit",
    cwd: REPO_ROOT,
  });
  // `res.status` is null both when the child ran and exited non-zero AND
  // when it could never be spawned at all (e.g. `npx` missing from PATH)
  // — the second case has no "see its output above" to point at, since
  // `stdio: "inherit"` never had a child to inherit from.
  if (res.error) {
    console.error(`polls:analyze could not be launched: ${res.error.message}`);
  }
  return res.status === 0;
};
let runAnalyze: RunAnalyze = defaultRunAnalyze;

/** TEST-ONLY seam — swap out the real `polls:analyze` subprocess spawn.
 *  `analyze_accuracy.ts` has no root-override seam of its own (it
 *  resolves its data directory from its own `__dirname`, always the real
 *  repo), so a test asserting "restamp ran analyze" must intercept the
 *  call rather than let it actually execute against the real corpus. Pass
 *  no argument to restore the real spawn. */
export const __setRunAnalyzeForTests = (fn?: RunAnalyze): void => {
  runAnalyze = fn ?? defaultRunAnalyze;
};

export interface Opts {
  race?: string;
  to?: string;
  cycle?: string;
}

export const parseArgv = (argv: string[]): Opts => {
  const flag = flagReader(argv);
  return { race: flag("race"), to: flag("to"), cycle: flag("cycle") };
};

// The round-1 folder id shape (`data/<date>_pvr/`) — same rule as
// accept.ts's own `CYCLE_ID_RE`, restated here rather than imported
// since neither file exports it and duplicating one regex literal is
// cheaper than a cross-file dependency for it.
const CYCLE_ID_RE = /^(\d{4})_(\d{2})_(\d{2})_pvr$/;

/** `"2026_11_08_pvr"` → `"2026-11-08"` — the cycle folder's own name IS
 *  its round-1 date, so no separate `--to` is needed for presidential. */
const round1DateFromCycleId = (cycleId: string): string | null => {
  const m = CYCLE_ID_RE.exec(cycleId);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

const restampParliamentary = (toIso: string): void => {
  const previousElection = latestHeldElection();
  if (previousElection !== null && toIso <= previousElection) {
    console.error(
      `--to "${toIso}" is not after the most recent held election (${previousElection})`,
    );
    process.exitCode = 1;
    return;
  }

  const pollsFile = path.join(POLLS_DIR(), "polls.json");
  const polls = readJsonArray<Poll>(pollsFile);

  let stamped = 0;
  const nextPolls = polls.map((p) => {
    if ((p.race ?? "parliamentary") !== "parliamentary") return p;
    if (p.electionDate !== null) return p;
    const end = parseFieldworkEnd(p.fieldwork);
    if (end === null) return p;
    if (previousElection !== null && end <= previousElection) return p;
    if (end >= toIso) return p;
    stamped++;
    return { ...p, electionDate: toIso };
  });

  const windowStart = previousElection ?? "the start of the corpus";
  if (stamped > 0) {
    writeJsonArray(pollsFile, nextPolls);
    console.log(
      `stamped ${stamped} poll(s) with electionDate ${toIso} (fieldwork after ${windowStart}, before ${toIso})`,
    );
  } else {
    console.log(
      `no null-dated parliamentary poll's fieldwork falls after ${windowStart} and before ${toIso} — nothing to stamp`,
    );
  }

  // Always — decision 11's point is that nobody has to remember this step.
  if (!runAnalyze()) {
    console.error("polls:analyze failed — see its output above");
    process.exitCode = 1;
  }
};

/** Decision 11's presidential arm: every presidential poll with `cycle
 *  === null` (decision 11 — nothing is stamped to a real cycle before
 *  the decree) gets BOTH `cycle` and `electionDate` set from the
 *  decreed `--cycle` id. Unlike the parliamentary side there is no
 *  fieldwork WINDOW to compute — a presidential poll's `electionDate`
 *  already carries the pre-decree estimate (`accept.ts` sets it from the
 *  draft, ultimately `UPCOMING_ELECTIONS`), so every null-cycle poll
 *  belongs to whichever decree just landed, unconditionally. */
const restampPresidential = (cycleId: string): void => {
  const round1Date = round1DateFromCycleId(cycleId);
  if (!round1Date) {
    console.error(
      `--cycle "${cycleId}" must be a round-1 folder id (e.g. "2026_11_08_pvr")`,
    );
    process.exitCode = 1;
    return;
  }

  const pollsFile = path.join(PRESIDENTIAL_DIR(), "polls.json");
  const polls = readJsonArray<Poll>(pollsFile);

  let stamped = 0;
  const nextPolls = polls.map((p) => {
    if (p.race !== "presidential") return p;
    if (p.cycle !== null && p.cycle !== undefined) return p;
    stamped++;
    return { ...p, cycle: cycleId, electionDate: round1Date };
  });

  if (stamped > 0) {
    writeJsonArray(pollsFile, nextPolls);
    console.log(
      `stamped ${stamped} presidential poll(s) with cycle ${cycleId} (electionDate ${round1Date})`,
    );
  } else {
    console.log(
      `no presidential poll has an un-stamped (null) cycle — nothing to stamp`,
    );
  }

  // Always — decision 11's point is that nobody has to remember this
  // step. Presidential runs the PRESIDENTIAL analyzer, not the
  // parliamentary one — the two are separate corpora, separate outputs.
  if (!runAnalyze("presidential")) {
    console.error(
      "polls:analyze --race presidential failed — see its output above",
    );
    process.exitCode = 1;
  }
};

export const main = (argv: string[]): void => {
  const opts = parseArgv(argv);
  if (!opts.race) {
    console.error(
      "usage: polls:restamp -- --race <parliamentary|presidential> --to <iso> | --cycle <cycle-id>",
    );
    process.exitCode = 1;
    return;
  }
  if (opts.race === "presidential") {
    if (!opts.cycle) {
      console.error(
        "usage: polls:restamp -- --race presidential --cycle <cycle-id>",
      );
      process.exitCode = 1;
      return;
    }
    restampPresidential(opts.cycle);
    return;
  }
  if (opts.race !== "parliamentary") {
    console.error(
      `--race "${opts.race}" must be "parliamentary" or "presidential"`,
    );
    process.exitCode = 1;
    return;
  }
  if (!opts.to) {
    console.error("usage: polls:restamp -- --race parliamentary --to <iso>");
    process.exitCode = 1;
    return;
  }
  if (!ISO_DATE_RE.test(opts.to) || !isRealIsoDate(opts.to)) {
    console.error(`--to "${opts.to}" must be a real ISO date (YYYY-MM-DD)`);
    process.exitCode = 1;
    return;
  }
  restampParliamentary(opts.to);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2));
}
