import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  describeSkippedElectionFolders,
  electionFolderIsoDate,
  electionFolderKind,
  isElectionFolder,
  isParliamentaryFolder,
} from "./electionFolders";
import { stripComments } from "./strip_comments";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");

describe("electionFolderKind", () => {
  it("classifies one real folder name of every kind", () => {
    expect(electionFolderKind("2026_04_19")).toBe("parliamentary");
    expect(electionFolderKind("2005_06_25")).toBe("parliamentary");
    expect(electionFolderKind("2023_10_29_mi")).toBe("local");
    expect(electionFolderKind("2026_02_22_chmi")).toBe("chmi");
    expect(electionFolderKind("2025_10_12_chmi_nov")).toBe("chmi");
    expect(electionFolderKind("2021_11_14_pvr")).toBe("presidential");
    expect(electionFolderKind("2001_11_11_pvr")).toBe("presidential");
  });

  // The whole point of the predicate: a non-election dataset directory sharing the
  // same root must never be handed to an election reader. `census_2021` is the
  // adversarial one — it carries a year and an underscore.
  it("returns null for every non-election directory in the two roots", () => {
    for (const name of [
      "agri",
      "budget",
      "census_2021",
      "procurement",
      "local_taxes",
      "person",
      "local_place_trends",
      "chmi_history",
      "transitions_prevote",
      "settlements_loc.csv",
    ]) {
      expect(electionFolderKind(name), name).toBeNull();
    }
  });

  // A presidential folder is suffix-bearing, so the danger is the OTHER direction:
  // a parliamentary-only filter written as a prefix test accepts it.
  it("does not classify a suffixed folder as parliamentary", () => {
    expect(isParliamentaryFolder("2021_11_14_pvr")).toBe(false);
    expect(isParliamentaryFolder("2023_10_29_mi")).toBe(false);
    expect(isParliamentaryFolder("2021_11_14")).toBe(true);
    expect(isElectionFolder("2021_11_14_pvr")).toBe(true);
    expect(isElectionFolder("agri")).toBe(false);
  });

  it("reads the round-1 date back out of the id", () => {
    expect(electionFolderIsoDate("2021_11_14_pvr")).toBe("2021-11-14");
    expect(electionFolderIsoDate("2026_04_19")).toBe("2026-04-19");
    expect(electionFolderIsoDate("agri")).toBeNull();
  });
});

describe("describeSkippedElectionFolders", () => {
  // The counter exists because the obvious one — every directory that is not
  // parliamentary — is dominated by unrelated datasets and so reports a number
  // nobody can act on.
  it("counts other ELECTION kinds only, never unrelated datasets", () => {
    const listing = [
      "2026_04_19",
      "2024_10_27",
      "2023_10_29_mi",
      "2026_02_22_chmi",
      "2025_10_12_chmi_nov",
      "2021_11_14_pvr",
      "agri",
      "budget",
      "procurement",
    ];
    const summary = describeSkippedElectionFolders(listing);
    expect(summary).toContain("4 other election folder(s)");
    expect(summary).toContain("1 local");
    expect(summary).toContain("2 chmi");
    expect(summary).toContain("1 presidential");
    // 3 non-election dirs are present and must NOT be in the count.
    expect(summary).not.toContain("7 other");
  });

  it("returns null when nothing was skipped", () => {
    expect(describeSkippedElectionFolders(["2026_04_19", "agri"])).toBeNull();
    expect(describeSkippedElectionFolders([])).toBeNull();
  });
});

// ─── the static gate ────────────────────────────────────────────────────────
//
// ⚠ THE UNIT TESTS ABOVE CANNOT CATCH THE DEFECT THIS MODULE EXISTS FOR. A sweep
// that never calls `electionFolderKind` is invisible to them — it just keeps its own
// loose test and keeps swallowing the new kind. So the gate scans the sources for
// the THREE loose shapes that were actually in the tree before this module landed:
//
//   a bare year-prefix test          — 3 sites (collect_stats, findSection, preferences)
//   an unanchored date regex         — 1 site (bucket_gzip), which matched `_pvr` by
//                                      accident rather than by decision
//   NO FILTER AT ALL                 — 1 site (parse_elections), the worst of the
//                                      five and the one no text pattern can see
//
// The third has no text to match, so it gets its own structural check below.
//
// An ANCHORED regex (`/^\d{4}_\d{2}_\d{2}$/`, `…_mi$/`) is deliberately NOT flagged:
// ~20 call sites use one, they are already exact about the kind they want, and
// rewriting all of them would be a large unrelated refactor with its own risk. What
// the gate forbids is the loose form, which is the one that changes meaning when a
// kind is added.
const LOOSE_FILTERS: { pattern: RegExp; why: string }[] = [
  {
    pattern: /\.startsWith\(\s*["'](?:19|20)["']\s*\)/,
    why: "a bare year-prefix test — matches every election kind, and `census_2021`",
  },
  {
    pattern: /\/\^\\d\{4\}_\\d\{2\}_\\d\{2\}\//,
    why: "an unanchored date regex — matches _mi, _chmi and _pvr too",
  },
];

/** Files allowed to contain a loose filter, each with the reason. Empty by design:
 *  every site the inventory found was converted. An entry here is a decision. */
const LOOSE_FILTER_ALLOWLIST: Record<string, string> = {};

/** A sweep of one of the two ROOTS, which is the no-filter shape's only signature —
 *  `parse_elections.ts` carried exactly this and no text pattern could see it.
 *  Scoped to root-ish identifiers so the many legitimate walks of a SUBdirectory
 *  (one election's output, a shard tree) are not caught. */
const ROOT_SWEEP =
  /readdirSync\(\s*(?:inFolder|outFolder|dataFolder|rawFolder|rawDataFolder|dataRoot|rawDataRoot|DATA_ROOT|RAW_ROOT)\b/;

/** Evidence that a sweep decides which folders are its own, in ANY of the spellings
 *  the tree actually uses. The predicate is the canonical one, but an anchored regex
 *  or a suffix test classifies just as deliberately — flagging those would report ~12
 *  correct files and train everyone to ignore this gate. What survives is the shape
 *  with NO classification at all, which is what `parse_elections.ts` carried. */
const CLASSIFIES_BY_KIND: RegExp[] = [
  /electionFolderKind|isParliamentaryFolder|isElectionFolder|describeSkippedElectionFolders/,
  /isCycleFolder/,
  // the canonical date regex, anchored or not (LOOSE_FILTERS forbids the unanchored
  // form separately — here it still counts as "this sweep classifies")
  /\/\^\\d\{4\}_\\d\{2\}_\\d\{2\}/,
  // the two variant spellings, invisible to a grep for the canonical literal
  /\/\^20\\d\\d_\\d\\d_\\d\\d|\/\^2\\d\{3\}_\\d\{2\}_\\d\{2\}/,
  // suffix tests: /_(mi|chmi|chmi_nov)$/, /_(chmi|chmi_nov)$/, endsWith("_mi")
  /_\((?:mi|chmi)|endsWith\(\s*["']_(?:mi|chmi|pvr)/,
];

/** Root sweeps that legitimately do not classify by election kind, with the reason.
 *  Each entry is a decision: the file walks a root-NAMED variable for something other
 *  than the election-folder list, so the predicate would be noise. */
const ROOT_SWEEP_ALLOWLIST: Record<string, string> = {
  "scripts/parsers_local/csv_files.ts":
    "`inFolder` is ONE race folder, not a root — it lists that folder's .txt files",
  "scripts/party_stats/index.ts":
    "`dataFolder` is `parties/by_<x>`, an output subfolder being cleared before a rewrite",
  "scripts/elections/source_links.test.ts":
    "kind-blind on purpose — walks `<cycle>/surface` for every cycle, and a presidential surface SHOULD be checked once it exists",
};

const walk = (dir: string, out: string[] = []): string[] => {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
};

/** Every source file except this module and its own test — which necessarily carry
 *  the patterns as data. ⚠ Test files ARE included: a data test that enumerates
 *  election folders loosely produces a false-GREEN gate, which is the worse
 *  direction, and several such tests exist. */
const sourceFiles = (): string[] =>
  [
    ...walk(path.join(PROJECT_ROOT, "scripts")),
    ...walk(path.join(PROJECT_ROOT, "src")),
  ].filter(
    (f) =>
      !f.endsWith(path.join("lib", "electionFolders.ts")) &&
      !f.endsWith(path.join("lib", "electionFolders.test.ts")),
  );

describe("no sweep keeps a loose election-folder filter", () => {
  // ⚠ THE POSITIVE CONTROL, and it is not optional. The scan below asserts an EMPTY
  // offender list, which is exactly what a broken pattern also produces — and these
  // patterns are nine escaped metacharacters each. Without this, an escaping slip
  // makes the gate pass green for ever with the module's whole purpose gone and
  // nothing red. Same reason `aop_experts` / `tr_owner_share` carry mutation checks.
  it("the loose-filter patterns still discriminate", () => {
    // The exact text each converted call site carried BEFORE this module landed.
    const BAD = [
      `.filter((file) => file.name.startsWith("20") && file.name !== yearMonth)`,
      `.filter((file) => file.name.startsWith("20") || file.name.startsWith("19"))`,
      `const isElectionDir = (n: string): boolean => /^\\d{4}_\\d{2}_\\d{2}/.test(n);`,
    ];
    for (const sample of BAD) {
      expect(
        LOOSE_FILTERS.some(({ pattern }) => pattern.test(sample)),
        `should be flagged: ${sample}`,
      ).toBe(true);
    }
    // The negative half pins the deliberate "anchored is allowed" policy, so a future
    // tightening that starts flagging the ~20 sanctioned sites fails HERE rather than
    // in twenty unrelated files.
    for (const good of [
      `.filter((d) => /^\\d{4}_\\d{2}_\\d{2}$/.test(d.name))`,
      `.filter((d) => /^\\d{4}_\\d{2}_\\d{2}_mi$/.test(d.name))`,
    ]) {
      expect(
        LOOSE_FILTERS.some(({ pattern }) => pattern.test(good)),
        `should NOT be flagged: ${good}`,
      ).toBe(false);
    }
  });

  it("scans scripts/ and src/", () => {
    const files = sourceFiles();
    // Non-vacuity: the scan must actually be reading the tree.
    expect(files.length).toBeGreaterThan(200);

    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(PROJECT_ROOT, file);
      if (rel in LOOSE_FILTER_ALLOWLIST) continue;
      // Prose that MENTIONS the pattern is not an occurrence of it — the whole
      // reason `stripComments` exists. `trailing: true` is safe for THESE two
      // patterns: neither a year-prefix test nor a date regex can be produced by the
      // `//` inside a URL literal that the default mode guards against.
      const code = stripComments(fs.readFileSync(file, "utf-8"), {
        trailing: true,
      });
      for (const { pattern, why } of LOOSE_FILTERS) {
        if (pattern.test(code)) offenders.push(`${rel} :: ${why}`);
      }
    }

    expect(
      offenders,
      `Use electionFolderKind() / isParliamentaryFolder() from scripts/lib/electionFolders.ts.\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });

  // The no-filter shape. `parse_elections.ts` mapped EVERY directory under
  // `raw_data/` and handed each to a parliamentary reader; there is no text to match,
  // so the check is structural — a file that enumerates a root must name the
  // predicate somewhere, or be listed with a reason.
  it("a root sweep names the predicate", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const rel = path.relative(PROJECT_ROOT, file);
      if (rel in ROOT_SWEEP_ALLOWLIST) continue;
      const code = stripComments(fs.readFileSync(file, "utf-8"), {
        trailing: true,
      });
      if (
        ROOT_SWEEP.test(code) &&
        !CLASSIFIES_BY_KIND.some((re) => re.test(code))
      ) {
        offenders.push(rel);
      }
    }
    expect(
      offenders,
      "These enumerate a data root without classifying by election kind — the shape " +
        "parse_elections.ts carried. Route through electionFolderKind(), or add an " +
        "entry to ROOT_SWEEP_ALLOWLIST saying what the sweep is really for.\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  // …and that check must be able to fire, for the same reason as the one above.
  it("the root-sweep check still discriminates", () => {
    // fires on a root sweep …
    expect(
      ROOT_SWEEP.test(`fs.readdirSync(rawFolder, { withFileTypes: true })`),
    ).toBe(true);
    // … and not on a subdirectory walk
    expect(ROOT_SWEEP.test(`fs.readdirSync(byOblastDir)`)).toBe(false);

    // The exact no-filter text `parse_elections.ts` carried must count as
    // unclassified, and each spelling actually in the tree must count as classified —
    // otherwise the gate either misses the defect or cries wolf on correct files.
    const NO_FILTER = `const dataFolders = fs.readdirSync(inFolder, { withFileTypes: true });
  const folders = dataFolders.filter((file) => file.isDirectory()).map((f) => f.name);`;
    expect(CLASSIFIES_BY_KIND.some((re) => re.test(NO_FILTER))).toBe(false);
    for (const classified of [
      `.filter((name) => isParliamentaryFolder(name))`,
      `.filter((d) => /^\\d{4}_\\d{2}_\\d{2}$/.test(d))`,
      `.filter((f) => /^20\\d\\d_\\d\\d_\\d\\d$/.test(f.name))`,
      `.filter((d) => /_(mi|chmi|chmi_nov)$/.test(d.name))`,
      `.filter((d) => d.endsWith("_mi"))`,
      `.filter((d) => isCycleFolder(d.name))`,
    ]) {
      expect(
        CLASSIFIES_BY_KIND.some((re) => re.test(classified)),
        `should count as classified: ${classified}`,
      ).toBe(true);
    }
  });
});

describe("every directory on disk classifies", () => {
  for (const root of ["data", "raw_data"]) {
    it(`${root}/`, (ctx) => {
      const dir = path.join(PROJECT_ROOT, root);
      // A real skip, not a bare `return`: Vitest renders a green tick for the
      // latter, so "the root is absent" would read as "every folder classified".
      if (!fs.existsSync(dir)) {
        return ctx.skip(`${root}/ absent — inventory not checked`);
      }
      const names = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
      expect(names.length).toBeGreaterThan(0);

      // An election-shaped name that classifies as null is the failure: it means a
      // suffix exists on disk that this module does not know about. The date is
      // matched ANYWHERE in the name, not only as a prefix, so a future
      // `ep_2024_06_09`-style convention is inspected rather than ignored.
      const unclassified = names.filter(
        (n) => /\d{4}_\d{2}_\d{2}/.test(n) && electionFolderKind(n) === null,
      );
      expect(
        unclassified,
        `unknown election-folder suffix in ${root}/`,
      ).toEqual([]);
    });
  }
});
