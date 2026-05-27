// Types for the contract-level ИСУН dataset (data/funds/projects/).
//
// Source: the public "Проекти" report of ИСУН 2020 (2020.eufunds.bg) — one row
// per signed contract / договор за БФП. Distinct from the beneficiary rollup
// in ./types.ts: that file is one row per organisation with all-time totals;
// this file is one row per contract with a single implementation location.
// Amounts are in EUR.

// One contract row parsed from the Projects XLSX. Values normalize the
// XLSX columns one-to-one — the resolver downstream maps `location` to one
// of the LocationBucket shapes below.
export interface FundsProject {
  // Programme code as it appears in column "Програма", e.g. "2014BG16RFOP002".
  programCode: string;
  // Programme display name (Bulgarian).
  programName: string;
  // 9-digit canonical EIK of the beneficiary, or null if the leading token
  // is absent / not a 9- or 13-digit company id (see ./eik.ts). Joins to
  // data/funds/beneficiaries-by-eik/{eik}.json.
  beneficiaryEik: string | null;
  // Beneficiary name with the leading EIK token stripped.
  beneficiaryName: string;
  // Тип / Вид / Форма на организацията — categorical, same vocabulary as the
  // beneficiary rollup uses.
  orgType: string;
  orgKind: string;
  orgForm: string;
  // Седалище — full HQ address as printed by ИСУН (oblast inside the text,
  // used as a tiebreaker when the implementation location is ambiguous).
  hqAddress: string;
  // Местонахождение — implementation location, raw. Mostly "гр.<name>" or
  // "с.<name>"; sometimes a comma-separated muni list, a NUTS-region label,
  // or "България". The resolver classifies it into `location` below.
  locationRaw: string;
  // Номер на проектно предложение, e.g. "BG16RFOP002-2.002-0393". Stable
  // identifier — used as the per-contract primary key.
  contractNumber: string;
  // Наименование на проекта.
  title: string;
  // Обща стойност / БФП / Собствено съфинансиране / Реално изплатени суми.
  totalEur: number;
  grantEur: number;
  ownCofinanceEur: number;
  paidEur: number;
  // Продължителност (месеци).
  durationMonths: number;
  // Статус на изпълнение, e.g. "Приключен (към датата на приключване)",
  // "Прекратен (към дата на прекратяване)", "В изпълнение".
  status: string;
}

// Result of resolving `FundsProject.locationRaw` against `data/settlements.json`.
// The kind partitions the corpus into shards we can actually surface on a page:
//   - "settlement": maps cleanly to one EKATTE (the muni & oblast are derived)
//   - "muni": muni-level only — no settlement granularity, but one or more
//             municipalities can be named; replicated across each per the
//             policy chosen at scoping
//   - "region": NUTS-2 / NUTS-3 / planning-region label — no muni granularity
//   - "national": "България" / multi-country / "Територията на ЕС"
//   - "unresolved": text not parseable into any of the above (e.g. Natura-2000
//                   site code, free-form description) — preserved verbatim so
//                   a future resolver iteration can pick them up
export type ProjectLocationKind =
  | "settlement"
  | "muni"
  | "region"
  | "national"
  | "unresolved";

export interface ProjectLocation {
  kind: ProjectLocationKind;
  raw: string;
  // Filled for "settlement" — exactly one EKATTE, plus the derived muni/oblast.
  ekatte?: string;
  // Filled for "settlement" and "muni" — one or more муни codes (e.g. ["BGS01"]).
  // For "settlement" this is the single муни owning the EKATTE; for "muni" it
  // can be a list when the raw text named multiple ("Поморие,Несебър,Руен").
  munis?: string[];
  // Filled for "settlement" — single oblast (e.g. "BLG"). For "muni" it's the
  // union of oblasts spanned by `munis`.
  oblasts?: string[];
  // Filled for "region" — NUTS code(s) parsed out of the raw label.
  nutsCodes?: string[];
  // Filled when the resolver had >1 candidate and the HQ-oblast tiebreaker
  // could not narrow to one. Surfaced in the resolver report only — these
  // rows land in `unresolved`.
  ambiguousCandidates?: string[];
}

// A FundsProject paired with its resolved location. This is the shape that
// lands in the per-EKATTE / per-muni / per-EIK / per-program shards. Most
// rows carry the same FundsProject; the per-shard files duplicate the
// payload across shards rather than carrying a normalized join table so
// the frontend can fetch one file per page (same pattern as the rest of
// data/funds/).
export interface ResolvedFundsProject extends FundsProject {
  location: ProjectLocation;
}

// Aggregated rollup over a slice of the corpus — used in the per-EKATTE /
// per-muni / per-EIK / per-program index summaries.
export interface ProjectsRollup {
  contractCount: number;
  beneficiaryCount: number;
  totalEur: number;
  grantEur: number;
  paidEur: number;
}

// Top-level index. Mirrors the shape of FundsIndex in ./types.ts but covers
// the contract-level corpus instead of the beneficiary rollup.
export interface FundsProjectsIndex {
  generatedAt: string;
  lastIngest: string;
  source: { label: string; url: string };
  totals: ProjectsRollup & {
    // Histogram of resolved location kinds.
    byLocationKind: Record<ProjectLocationKind, number>;
    // Rows that had a parseable EIK — the join surface to the beneficiary
    // rollup and the MP-companies graph.
    withEik: number;
  };
  // Rollup per programme.
  byProgram: Array<{
    programCode: string;
    programName: string;
    rollup: ProjectsRollup;
  }>;
  // Rollup per status — useful as a freshness/health signal.
  byStatus: Array<{ status: string; rollup: ProjectsRollup }>;
  // Shard listings so the frontend can validate a fetch URL without a 404.
  ekatteShards: string[]; // EKATTEs with at least one project
  muniShards: string[]; // муни codes with at least one project
  programShards: string[]; // programme codes with at least one project
  // Beneficiaries with at least one contract under this corpus.
  eikShardCount: number;
  // Multi-location rows (region / national / unresolved) — kept in one file.
  multiLocationCount: number;
}
