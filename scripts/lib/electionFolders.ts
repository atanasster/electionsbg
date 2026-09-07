// What KIND of election a `data/` or `raw_data/` directory name denotes — the ONE
// definition, so a sweep cannot decide it with a loose prefix test of its own.
//
// WHY IT EXISTS. Four cycles of election data share one flat namespace under both
// `data/` and `raw_data/`, distinguished only by a suffix on the date:
//
//   2026_04_19          parliamentary   (no suffix)
//   2023_10_29_mi       local, regular
//   2026_02_22_chmi     local, partial / new (`_chmi`, `_chmi_nov`)
//   2021_11_14_pvr      presidential    (added by docs/plans/presidential-elections-v1.md)
//
// and several sweeps recognised "an election folder" by a bare `"20"` prefix test, or
// by no test at all. Those were correct for as long as parliamentary was the only
// suffix-less kind AND every other kind was ignored by accident rather than on
// purpose.
//
// ⚠ THE TWO ROOTS ARE AT DIFFERENT STAGES, AND THE TENSE MATTERS PER ROOT.
// `raw_data/` ALREADY holds five presidential trees — 2001, 2006, 2011, 2016, 2021,
// all git-tracked — so every `raw_data/` sweep is unsafe TODAY, not in a future tier;
// `parse_elections.ts --all` has been reaching them. The `data/<date>_pvr/` OUTPUT
// side is what the plan's later tiers add, and it is what ends the accident on the
// `data/` side: `src/data/json/elections.json` holds zero `_mi` names right now only
// because the local trees happen not to carry a `region_votes.json`, and a
// presidential tree WILL carry one.
//
// ⚠ THIS IS A NAME-SHAPE PREDICATE, NOT A DATE VALIDATOR. `2026_13_45_pvr` classifies
// as presidential; no such directory exists and inventing one is not a threat model.
// What it must never do is classify a NON-election directory (`agri`, `budget`,
// `census_2021`, `procurement`) as anything but `null`.
//
// ⚠ AND `null` IS "NOT AN ELECTION FOLDER", NEVER "UNKNOWN KIND". Callers use it to
// SKIP; a future kind must be added here rather than left to fall through, or every
// sweep silently drops it.

import fs from "node:fs";

export type ElectionFolderKind =
  | "parliamentary"
  | "local"
  | "chmi"
  | "presidential";

// The four shapes, exported for the ~20 call sites that already carry an anchored
// literal of their own (see docs/plans/presidential-elections-v1.md T0.1 — converting
// them is deliberately out of scope). Prefer the predicates below; reach for a RE
// only where a regex object is genuinely needed, and never retype the literal.
//
// ⚠ Two VARIANT spellings of the parliamentary rule also exist and are invisible to a
// grep for the canonical literal: `/^20\d\d_\d\d_\d\d$/` and `/^2\d{3}_\d{2}_\d{2}$/`.
// Both were folded into this module; a future consolidation should search for the
// shape rather than the text.

/** `2026_04_19` — a National Assembly election. The suffix-less shape. */
export const PARLIAMENTARY_FOLDER_RE = /^\d{4}_\d{2}_\d{2}$/;
/** `2023_10_29_mi` — a regular local cycle. */
export const LOCAL_FOLDER_RE = /^\d{4}_\d{2}_\d{2}_mi$/;
/** `2026_02_22_chmi`, `2025_10_12_chmi_nov` — partial / new local elections. */
export const CHMI_FOLDER_RE = /^\d{4}_\d{2}_\d{2}_chmi(_nov)?$/;
/** `2021_11_14_pvr` — a presidential election, keyed on its ROUND-1 date. */
export const PRESIDENTIAL_FOLDER_RE = /^\d{4}_\d{2}_\d{2}_pvr$/;

/**
 * Classify a `data/` or `raw_data/` directory name by election kind.
 *
 * @param name - A single directory NAME, not a path (`"2021_11_14_pvr"`, never
 *   `"raw_data/2021_11_14_pvr"`).
 * @returns The kind, or `null` for anything that is not an election folder —
 *   including every non-election dataset directory sharing these roots (`agri`,
 *   `budget`, `procurement`, `census_2021`, `local_place_trends`, …).
 *   ⚠ `null` means "not an election folder", NEVER "unknown kind": callers use it to
 *   SKIP, so a future kind must be added here rather than left to fall through.
 * @example
 * electionFolderKind("2026_04_19");      // "parliamentary"
 * electionFolderKind("2021_11_14_pvr");  // "presidential"
 * electionFolderKind("census_2021");     // null
 */
export const electionFolderKind = (name: string): ElectionFolderKind | null => {
  if (PARLIAMENTARY_FOLDER_RE.test(name)) return "parliamentary";
  if (LOCAL_FOLDER_RE.test(name)) return "local";
  if (CHMI_FOLDER_RE.test(name)) return "chmi";
  if (PRESIDENTIAL_FOLDER_RE.test(name)) return "presidential";
  return null;
};

/**
 * True for an election folder of ANY kind.
 *
 * @param name - A directory name.
 * @returns Whether it is an election folder. Use this where the operation is
 *   kind-blind ON PURPOSE — gzipping every election tree for the bucket — so that
 *   intent is recorded rather than left to a regex that happens to match.
 */
export const isElectionFolder = (name: string): boolean =>
  electionFolderKind(name) !== null;

/**
 * True only for the National Assembly folders.
 *
 * @param name - A directory name.
 * @returns Whether it is a parliamentary election folder — the filter nearly every
 *   caller in `scripts/parsers/`, `scripts/stats/` and `scripts/preferences/`
 *   actually wants, and the one a `startsWith("20")` test silently widened.
 */
export const isParliamentaryFolder = (name: string): boolean =>
  electionFolderKind(name) === "parliamentary";

/**
 * Read the election date back out of a folder id.
 *
 * @param name - A directory name.
 * @returns `2021_11_14_pvr` → `"2021-11-14"`, or `null` when the name is not an
 *   election folder. For a two-round cycle this is the ROUND-1 date, which is what
 *   the id is keyed on.
 *
 *   ⚠ It inherits the module's name-SHAPE looseness: the string is well-FORMED, not
 *   necessarily a real date (`2026_13_45_pvr` → `"2026-13-45"`, which `new Date()`
 *   renders `Invalid Date`). No such folder exists, so this is a note rather than a
 *   guard — but do not feed the result to `new Date()` without checking.
 *
 *   ⚠ THE ID IS A KEY AND NEVER A LABEL — callers format the ISO date this returns,
 *   they do not render the folder name with its underscores swapped. That mistake put
 *   „Този парламент · 2026-04-19" on 31 surfaces once (see `electionsHubCycle.ts`).
 */
export const electionFolderIsoDate = (name: string): string | null => {
  const kind = electionFolderKind(name);
  if (!kind) return null;
  const [y, m, d] = name.split("_");
  return `${y}-${m}-${d}`;
};

/**
 * Summarise the non-parliamentary ELECTION folders in a listing, for a log line.
 *
 * @param names - Directory names from one root.
 * @returns e.g. `"67 other election folder(s): 5 local, 62 chmi"`, or `null` when
 *   there are none.
 *
 *   ⚠ It deliberately counts only OTHER ELECTION kinds, never every skipped
 *   directory. A raw `allFolders.length - parliamentary.length` on these roots is
 *   dominated by unrelated datasets (`agri`, `budget`, `procurement`, `council`,
 *   `_cache`, …): 120 of 133 in `data/`, of which only 67 are elections. The
 *   actionable number is "how many ELECTION folders did I decline to treat as
 *   parliamentary", and burying it in a total nobody can act on is how a line that
 *   prints on every run gets scrolled past.
 */
export const describeSkippedElectionFolders = (
  names: readonly string[],
): string | null => {
  const skipped = names.filter(
    (n) => !isParliamentaryFolder(n) && electionFolderKind(n) !== null,
  );
  if (!skipped.length) return null;
  const byKind = new Map<ElectionFolderKind, number>();
  for (const n of skipped) {
    const kind = electionFolderKind(n) as ElectionFolderKind;
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
  }
  const parts = [...byKind.entries()].map(([k, n]) => `${n} ${k}`);
  return `${skipped.length} other election folder(s): ${parts.join(", ")}`;
};

/**
 * Every ingested presidential cycle directly under `root`, oldest first.
 *
 * @param root - The directory to list — `data/` or a test's temp root. NOT a project root:
 *   the caller joins `"data"` itself, because two of the three callers already hold the data
 *   root and only the prerender holds a project root.
 * @returns The `_pvr` folder NAMES, sorted, or `[]` when `root` does not exist.
 *
 *   ⚠ THE ONE LISTER. Three copies of this seven-line function existed — in
 *   `build_runoff_transfer.ts`, in `build_split_ticket.ts` (byte-identical) and in
 *   `scripts/prerender/presidentialRoutes.ts` — all three reading the shared
 *   `PRESIDENTIAL_FOLDER_RE` and none of them reading each other, so `scripts/og/generate.ts`
 *   and `scripts/main.ts` already called two DIFFERENT functions to answer one question. The
 *   constant was shared; the function around it was not, which is the half that matters when
 *   the answer has to be stable across a build.
 */
export const presidentialCyclesIn = (root: string): string[] =>
  fs.existsSync(root)
    ? fs
        .readdirSync(root)
        .filter((d) => PRESIDENTIAL_FOLDER_RE.test(d))
        .sort()
    : [];
