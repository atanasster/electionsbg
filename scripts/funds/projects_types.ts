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
  // муни and programme shard catalogues — small and useful (the frontend
  // can validate URLs without hitting a 404). The per-EKATTE catalogue is
  // deliberately omitted: ~3.3k entries would add ~25 KB to every dashboard
  // fetch for no real benefit (a 404 on a missing settlement shard is cheap).
  muniShards: string[];
  programShards: string[];
  // Counts only — useful as health-check signals, but the enumeration of
  // EKATTE / EIK shards is not embedded in the index.
  ekatteShardCount: number;
  eikShardCount: number;
  // Multi-location rows (region / national / unresolved) — kept in one file.
  multiLocationCount: number;
}

// Slim "drill-down-ready" snapshot for a single programme. Emitted alongside
// the full by-program/{code}.json (which can be 5-45 MB) so the per-programme
// detail page renders without loading the full contract list — same
// summary-shard pattern as ./FundsProjectsSummary below.
//
// File: data/funds/projects/by-program/{code}-summary.json
export interface FundsProjectsProgramSummary {
  programCode: string;
  programName: string;
  rollup: ProjectsRollup;
  // 4-bucket status mix collapsed from raw ИСУН status strings — same
  // taxonomy as the /funds tile.
  statusBreakdown: Array<{
    status: string;
    rollup: ProjectsRollup;
  }>;
  // Location-kind histogram restricted to this programme.
  byLocationKind: Record<ProjectLocationKind, number>;
  // Top-N contracts within the programme.
  topContracts: Array<{
    contractNumber: string;
    title: string;
    totalEur: number;
    paidEur: number;
    status: string;
    beneficiaryEik: string | null;
    beneficiaryName: string;
    locationRaw: string;
    locationMunis: string[] | null;
  }>;
  // Top-N beneficiaries within the programme, by funds contracted.
  topBeneficiaries: Array<{
    beneficiaryEik: string | null;
    beneficiaryName: string;
    orgType: string;
    contractCount: number;
    totalEur: number;
    paidEur: number;
  }>;
  // Top-N муни within the programme, by funds contracted.
  topMunis: Array<{
    muni: string;
    oblast: string | null;
    contractCount: number;
    totalEur: number;
    paidEur: number;
  }>;
}

// Slim "tile-ready" snapshot for a single place (EKATTE or муни). Emitted
// alongside the full by-ekatte/{ekatte}.json + by-muni/{id}.json so a
// settlement / muni dashboard can render the EU-funds tile without pulling
// the full per-place contract list — critical for Sofia, where the full
// per-EKATTE file is ~19 MB and the per-муни file is ~20 MB.
//
// Files: data/funds/projects/by-ekatte/{ekatte}-summary.json
//      data/funds/projects/by-muni/{obshtina}-summary.json
export interface FundsProjectsSummary {
  kind: "ekatte" | "muni";
  placeId: string;
  // Cheap rollup of the place's whole contract corpus.
  rollup: ProjectsRollup;
  // Top-3 contracts by total value — enough to feature on the tile. Slim
  // shape (no hqAddress, no location echo — the place context is implicit).
  topContracts: Array<{
    contractNumber: string;
    title: string;
    // The contract's FULL value, not the place's share of it — see
    // toTopContract in ./projects_ingest.ts.
    totalEur: number;
    paidEur: number;
    status: string;
    programCode: string;
    programName: string;
    beneficiaryEik: string | null;
    beneficiaryName: string;
    // Present only when the row names more than one муни: the number it names,
    // so the tile can caption why totalEur can exceed a муни's own rollup.
    // Absent on every EKATTE summary (a settlement row names exactly one).
    muniCount?: number;
  }>;
  // Top-3 programmes by total value — programme mix at a glance.
  topPrograms: Array<{
    programCode: string;
    programName: string;
    rollup: ProjectsRollup;
  }>;
  // Per-capita € contracted using the place's ГРАО permanent-address
  // population (settlements: own population; муни: sum across constituent
  // settlements). Null when GRAO has no data for the place (foreign
  // pseudo-codes, Sofia synthetic S22 muni when ГРАО lookup misses).
  perCapitaEur: number | null;
  population: number | null;
  // Rank by perCapitaEur within the same oblast (1 = highest). Only
  // populated when perCapitaEur is non-null and the oblast has at least
  // 5 ranked places. Cohort size = `cohortSize`.
  perCapitaRank: number | null;
  cohortSize: number | null;
  oblastCode: string | null;
}
