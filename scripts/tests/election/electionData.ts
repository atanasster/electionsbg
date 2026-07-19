// Shared loaders + constants for the election data-shard and report regression
// suites (shards.data.test.ts, reports.data.test.ts).
//
// The generated parliamentary election corpus lives under `<repo>/data/YYYY_MM_DD/`
// (gitignored; rebuilt from raw_data by `npm run data`, shipped via GCS). These
// tests are DATA-VERSION-INDEPENDENT: every expectation is computed FROM the data
// on disk (rollup reconciliation, arithmetic identities, structural shape), so
// they stay valid across every re-ingest and act as a standing net that fails the
// moment a shard is regenerated damaged or incorrect — before it can deploy.
//
// Like the other *.data.test.ts gates they AUTO-SKIP when no election data is on
// disk (a fresh CI checkout that hasn't restored the corpus), so a plain
// `npm run test:unit` stays green without the built data tree.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ElectionRegion,
  SectionInfo,
  Votes,
  SectionProtocol,
} from "@/data/dataTypes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo-root `data/` folder — the same tree `generateReports` resolves. */
export const DATA_DIR = path.resolve(__dirname, "../../../data");

/** Oblast code for out-of-country ("чужбина") sections. */
export const ABROAD_OBLAST = "32";
/** The three Sofia-city МИР districts (as keyed in region_votes.json). */
export const SOFIA_REGIONS = ["S23", "S24", "S25"];

/** A parliamentary election folder is `YYYY_MM_DD` (no `_mi`/`_chmi` suffix). */
const PARLIAMENTARY_RE = /^\d{4}_\d{2}_\d{2}$/;

export const readJson = <T>(file: string): T =>
  JSON.parse(fs.readFileSync(file, "utf-8")) as T;

/**
 * Every parliamentary election folder that has been built on disk (has a
 * `region_votes.json`). Empty when the corpus hasn't been restored — callers
 * skip in that case.
 */
export const listParliamentaryElections = (): string[] => {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs
    .readdirSync(DATA_DIR)
    .filter(
      (d) =>
        PARLIAMENTARY_RE.test(d) &&
        fs.existsSync(path.join(DATA_DIR, d, "region_votes.json")) &&
        fs.existsSync(path.join(DATA_DIR, d, "sections", "by-oblast")),
    )
    .sort();
};

export type LoadedSection = SectionInfo;

/** Every section of an election, read from the per-oblast bundles. */
export const loadSections = (election: string): LoadedSection[] => {
  const dir = path.join(DATA_DIR, election, "sections", "by-oblast");
  const out: LoadedSection[] = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const bundle = readJson<Record<string, LoadedSection>>(path.join(dir, f));
    for (const id of Object.keys(bundle)) out.push(bundle[id]);
  }
  return out;
};

export const loadRegions = (election: string): ElectionRegion[] =>
  readJson<ElectionRegion[]>(
    path.join(DATA_DIR, election, "region_votes.json"),
  );

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const loadNationalSummary = (election: string): any =>
  readJson(path.join(DATA_DIR, election, "national_summary.json"));

/**
 * Authoritative set of party numbers that legitimately appear in a section's
 * votes: the union of cik_parties.json and the national_summary parties. (The
 * two can differ — e.g. in 2024_10_27 party 29 receives votes and is in the
 * national summary but is absent from cik_parties.json — so a section carrying
 * party 29 is correct, not damaged.)
 */
export const partyUniverse = (election: string): Set<number> => {
  const cik = readJson<{ number: number }[]>(
    path.join(DATA_DIR, election, "cik_parties.json"),
  );
  const universe = new Set<number>(cik.map((p) => p.number));
  const ns = loadNationalSummary(election) as {
    parties?: { partyNum: number }[];
  };
  for (const p of ns.parties ?? []) universe.add(p.partyNum);
  return universe;
};

/** JSON shard files directly inside `data/<election>/<sub>/` (skips subdirs). */
export const listShardFiles = (election: string, sub: string): string[] => {
  const dir = path.join(DATA_DIR, election, sub);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(
      (f) => f.endsWith(".json") && fs.statSync(path.join(dir, f)).isFile(),
    );
};

export const readShard = <T>(election: string, sub: string, file: string): T =>
  readJson<T>(path.join(DATA_DIR, election, sub, file));

export const reportPath = (election: string, ...parts: string[]): string =>
  path.join(DATA_DIR, election, "reports", ...parts);

export const reportExists = (election: string, ...parts: string[]): boolean =>
  fs.existsSync(reportPath(election, ...parts));

export const readReport = <T>(election: string, ...parts: string[]): T =>
  readJson<T>(reportPath(election, ...parts));

export const dashboardPath = (election: string, file: string): string =>
  path.join(DATA_DIR, election, "dashboard", file);

/** Absolute path to a file/dir under the top-level (non-dated) data tree. */
export const dataPath = (...parts: string[]): string =>
  path.join(DATA_DIR, ...parts);

/** Files in a top-level data subfolder matching an optional suffix. */
export const listDataFiles = (sub: string, suffix = ".json"): string[] => {
  const dir = path.join(DATA_DIR, sub);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(
      (f) => f.endsWith(suffix) && fs.statSync(path.join(dir, f)).isFile(),
    );
};

/**
 * A cross-election `*_stats.json` / time-series entry: one election's rolled-up
 * result, tagged by its date in `name`.
 */
export interface StatsEntry {
  name: string;
  results: {
    votes: { partyNum: number; totalVotes: number; [k: string]: unknown }[];
    protocol?: Record<string, number>;
  };
}

/** partyNum → totalVotes map for one election's region_votes entry. */
export const regionVotesMap = (
  election: string,
  regionKey: string,
): Record<number, number> | null => {
  const region = loadRegions(election).find((r) => r.key === regionKey);
  if (!region) return null;
  const map: Record<number, number> = {};
  addPartyVotes(map, region.results.votes);
  return map;
};

/**
 * Deterministic sample of an array: keeps the first `n` by a fixed stride so the
 * same rows are checked on every run (no Math.random, which is banned in this
 * repo's tooling and would make failures unreproducible).
 */
export const sample = <T>(arr: T[], n: number): T[] => {
  if (arr.length <= n) return arr;
  const stride = Math.floor(arr.length / n);
  const out: T[] = [];
  for (let i = 0; i < arr.length && out.length < n; i += stride)
    out.push(arr[i]);
  return out;
};

/** Sum party `totalVotes` into an accumulator keyed by partyNum. */
export const addPartyVotes = (
  acc: Record<number, number>,
  votes: Votes[],
): void => {
  for (const v of votes)
    acc[v.partyNum] = (acc[v.partyNum] ?? 0) + (v.totalVotes ?? 0);
};

/** Sum every numeric protocol field into an accumulator keyed by field name. */
export const addProtocol = (
  acc: Record<string, number>,
  p: SectionProtocol | undefined,
): void => {
  if (!p) return;
  for (const [k, val] of Object.entries(p)) {
    if (typeof val === "number") acc[k] = (acc[k] ?? 0) + val;
  }
};
