// useProjectFile — the React fetch-hook that wires the pure resolver core
// (projectFile.ts) to the /api/db/table engine (whose unp/key `in`-filters step 1
// enabled). See docs/plans/procurement-project-lifecycle-v1.md §2/§4.1.
//
// Flow: for each search thread, fetch matched contracts + tenders (recall) →
// score with the confidence core → seed = (autoIn ∪ includes) − excludes →
// fetch the УНП-lineage (every contract of the seed procedures = sibling lots) →
// dedup + fold. CRITICAL: an `in`-filter on an EMPTY array returns the whole
// corpus, so every by-unp / by-key fetch is guarded on a non-empty set.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchTablePage,
  fetchTablePageWithTotal,
  type TablePageRequest,
  type TablePageResult,
} from "./fetchTablePage";
import { fetchJsonSoft } from "@/data/fetchJson";
import { dataUrl } from "@/data/dataUrl";
import {
  resolveBudgetLine,
  safeFiscalYear,
  type InvestmentProgram,
  type ResolvedBudgetLine,
} from "./projectBudgetLine";
import type { ProcurementContract } from "@/data/dataTypes";
import {
  rankBroaderCandidates,
  resolveSeedIds,
  dedupContracts,
  dedupTenders,
  dedupFunds,
  foldMembers,
  guardLineageContracts,
  lotNumberOf,
  matchedContractTotal,
  pickCollision,
  seedContractFilter,
  seedTenderFilter,
  usesCorpusTotal,
  isAnchored,
  threadSeedsTenders,
  seedCapOf,
  seedScore,
  pageWalk,
  SEED_PAGE,
  LINEAGE_PAGE,
  type SearchThread,
  type MemberIds,
  type ProjectFold,
  type FoldInput,
} from "./projectFile";

/** The tender-row subset the timeline needs (a slice of the tenders resource). */
export interface ProjectTenderRow {
  unp: string;
  subject: string;
  publicationDate?: string;
  buyerName?: string;
  estimatedValueEur?: number;
  lotsCount?: number;
  isCancelled?: boolean;
}

export interface LocalizedText {
  bg?: string;
  en?: string;
}

export interface AnnouncedBudget {
  amountEur: number;
  basis?: string;
  sourceUrl?: string;
  asOf?: string;
  note?: LocalizedText;
  /** OPTIONAL budget-law line linkage (§10 P3, Tier C) — resolves the announced
   *  figure to a real Приложение III capital line in
   *  data/budget/investment_program/<fiscalYear>.json (by `projectId`), so the
   *  announced number is *sourced against the budget law*, not merely curated.
   *  Absent / unmatched → the sourced-line caption is simply hidden. */
  budgetLine?: {
    fiscalYear: number;
    projectId?: string;
  };
}

export interface Benchmark {
  unit: string;
  low?: number;
  high?: number;
  impliedLow?: number;
  impliedHigh?: number;
  note?: LocalizedText;
}

/** OPTIONAL curated advance-vs-progress axis (§0g.3) — Tier B, same status as
 *  announcedBudget. The corpus has no advance data (no ЗОП payments table), so
 *  this is always curated+sourced, never joined. `amountEur` OR `pctDeclared`
 *  (of the contracted total) drives the «авансово изплатено» figure; the
 *  `physicalProgressNote` renders as the pull-quote ("35% платено, нищо построено"
 *  — the most citizen-legible number in the story). */
export interface Advance {
  pctDeclared?: number;
  amountEur?: number;
  physicalProgressNote?: LocalizedText;
  source?: string;
  sourceUrl?: string;
  asOf?: string;
}

/** The stored/URL-encoded project-file artifact (the resolution-relevant subset
 *  plus the optional curated honesty fields — §2). */
export interface ProjectFileSpec {
  title?: LocalizedText;
  thesis?: LocalizedText;
  authority?: string;
  status?: string;
  search: SearchThread[];
  includes?: MemberIds;
  excludes?: MemberIds;
  /** OPTIONAL sector tag. `"roads"` unlocks the corpus-derived €/km cross-check
   *  (§10 P3) — the guarded unit cost computed from the file's own road member
   *  contracts, shown next to any curated `benchmark` range. Closed union so a
   *  typo (`"road"`) is a compile error, not a silently-disabled cross-check;
   *  extend as future sectors gain benchmarks. */
  sector?: "roads";
  /** OPTIONAL headline-total basis. Default (`"members"`) sums the top-N member
   *  fold — right for a bounded project. `"corpus"` makes "Договорено (ЗОП)" the
   *  WHOLE-corpus contracted sum for a distributed PROGRAM whose top-60 seed
   *  under-counts by an order of magnitude (see `usesCorpusTotal` — honoured only
   *  for a single single-token thread, so the sum stays confidence-consistent). */
  totalBasis?: "members" | "corpus";
  announcedBudget?: AnnouncedBudget;
  benchmark?: Benchmark;
  /** Curated advance-vs-progress honesty axis (§0g.3). */
  advance?: Advance;
  /** OPTIONAL curated EU-vs-national funding split per ИСУН fund member, keyed
   *  by contract_number → { euEur, nationalEur, source?, sourceUrl? }. The bulk
   *  ИСУН feed carries only обща стойност / БФП / собствено съфинансиране, so the
   *  европейско/национално share of the grant is curated+sourced (§4.2.3b). */
  euFinancing?: Record<string, EuFinancingSplit>;
  /** OPTIONAL per-member role label (member contract key or УНП → e.g.
   *  "проектиране"/"строителство"/"надзор"/"печат"/…), for the money-by-role
   *  split (§4.2.4). Absent members fall back to a CPV-division role. */
  nature?: Record<string, string>;
  /** Curated «празнина» — an expected-but-absent stage rendered as a gap node at
   *  the end of the timeline (§0f.5). Optional authority/source explain WHY it's
   *  absent (e.g. "still no construction tender", or "done off-tender by X"). */
  gap?: {
    note?: LocalizedText;
    authority?: string;
    sourceUrl?: string;
  };
  /** OPTIONAL — marks a RECURRING project (elections per cycle, annual
   *  maintenance). Present → the screen renders a per-period rollup above the
   *  timeline (§4.2.2b). `by` buckets by calendar year in v1; `label` overrides
   *  the column header. */
  recurrence?: {
    by: "cycle" | "year";
    label?: LocalizedText;
  };
  /** OPTIONAL curator verification date (ISO), shown in the provenance footer
   *  (§4.2.7). */
  verifiedAt?: string;
  /** OPTIONAL fact-check ledger (§4.2.6b / §0g.4) — public statements checked
   *  against the file's own numbers. Rendered above the provenance footer and
   *  printed (it IS the report), but ONLY when the file also carries `verifiedAt`
   *  — the curator signal that keeps the authoritative verdict pills off a casual
   *  DIY ?q= (§11). That gate is a v1 proxy, not a cryptographic curated/DIY
   *  boundary (which waits for auth, P3). */
  claims?: Claim[];
  /** OPTIONAL — EIKs of state in-house companies whose onward awards escape ЦАИС;
   *  a member contracted to one gets a «подизпълнители» blind-spot node (§0g.2). */
  inhouseAwarderEiks?: string[];
  /** OPTIONAL curated, sourced subcontractor list surfaced in that node. */
  knownSubcontractors?: KnownSubcontractor[];
  /** OPTIONAL route geometry (§10 P3, Tier D) — a polyline of [lat, lng] points.
   *  Present (≥2 points) → a small Leaflet route map renders above the timeline,
   *  showing WHERE a linear object runs. Curated + sourced (an approximate
   *  corridor is labelled as such); never auto-derived from contract text. */
  geo?: { line: [number, number][] };
}

/** OPTIONAL blind-spot config (§0g.2). `inhouseAwarderEiks` = EIKs of state
 *  in-house companies (e.g. Автомагистрали ЕАД, 831646048) whose ONWARD awards to
 *  private firms escape ЦАИС; when a member contractor is one of these the money
 *  trail stops at the head contract. `knownSubcontractors` is the curated, sourced
 *  list of who's underneath (Сметна палата / news) — a *known* blind spot, which
 *  is itself the finding. */
export interface KnownSubcontractor {
  name: string;
  eik?: string;
  amountEur?: number;
  source?: string;
  sourceUrl?: string;
}

/** A public statement checked against the dossier's grounded numbers (§4.2.6b). */
export interface Claim {
  /** The quote, verbatim (not translated). */
  text: string;
  byWhom?: string;
  saidAt?: string;
  sourceUrl?: string;
  verdict?: "confirms" | "refutes" | "partial";
  /** The grounded counter-number pulled from the file's own totals, curator-
   *  written (e.g. "договор €461M, метод «вътрешен избор»"). */
  ourNumber?: string;
  note?: LocalizedText;
}

/** A curated ИСУН fund-project member (§4.2.3b) — manual-add only (no ЗОП
 *  lineage), pulled by contract_number. договорено/изплатено, no payment dates. */
export interface FundProjectMember {
  contractNumber: string;
  title: string;
  beneficiaryEik?: string;
  beneficiaryName?: string;
  programName?: string;
  totalEur?: number;
  paidEur?: number;
  status?: string;
  /** ИСУН bulk-feed funding stack: обща стойност = БФП (grant) + собствено
   *  съфинансиране (own). Present for any fund member; the own-share is 0 for a
   *  100%-grant project. */
  grantEur?: number;
  ownCofinanceEur?: number;
  /** Curated EU-vs-national split of the grant (§4.2.3b) — merged from the
   *  spec's `euFinancing` by contract_number. The bulk ИСУН feed does NOT carry
   *  this split (only total/БФП/собствено), so it is curated+sourced, never
   *  joined. Absent → the EU/national breakdown simply doesn't render. */
  euEur?: number;
  nationalEur?: number;
  financingSource?: string;
  financingSourceUrl?: string;
}

/** Curated EU-vs-national split of one ИСУН grant (БФП), keyed by its
 *  contract_number in `ProjectFileSpec.euFinancing`. Sourced, because the bulk
 *  ИСУН open-data feed exposes only обща стойност / БФП / собствено съфинансиране
 *  — not the европейско/национално share, which lives on the project-detail page. */
export interface EuFinancingSplit {
  euEur: number;
  nationalEur: number;
  source?: string;
  sourceUrl?: string;
}

export interface ProjectFileModel {
  contracts: ProcurementContract[];
  tenders: ProjectTenderRow[];
  funds: FundProjectMember[];
  fold: ProjectFold;
  /** A seed thread hit the recall cap → the search is over-broad, results are a
   *  top-N slice, not the whole set. The screen should prompt to narrow (§4.1). */
  truncated: boolean;
  /** Approximate total contracts matching the search term(s) — the engine's count
   *  aggregate, summed across (possibly-overlapping) threads. Lets the truncation
   *  notice state "N examined of ~M". Null when unavailable. */
  matchedTotal: number | null;
  /** Contractor-name collision (§4.1b) — set when an UNSCOPED thread's term also
   *  names ≥ COLLISION_MIN winning firms, so the screen can nudge "add a buyer".
   *  Null when every thread is buyer-scoped or no term collides. */
  collision: { term: string; count: number } | null;
  /** WHOLE-corpus contracted sum + count over the seed WHERE (the engine `sum`
   *  aggregate), independent of the top-N fold. The screen shows these as the
   *  headline total only for a program dossier (`usesCorpusTotal`); otherwise it
   *  keeps the member fold. `null` when the engine reported no aggregate/count. */
  corpusContractedEur: number | null;
  corpusContractCount: number | null;
}

// Broader-match recall budget: fetch this many per thread, then rank by
// confidence and show BROADER_SHOWN (§0f.3).
const BROADER_PAGE = 40;
/** Hard cap on URL-provided include/exclude id-lists before they reach an
 *  `in`-filter — the DIY breadth guard (§4.1). The server also caps at 1000. */
const MAX_IDS = 500;

const clampIds = (a: string[] | undefined): string[] | undefined =>
  a ? a.filter((x) => typeof x === "string").slice(0, MAX_IDS) : undefined;

const clampMembers = (m: MemberIds | undefined): MemberIds | undefined =>
  m
    ? {
        contractKeys: clampIds(m.contractKeys),
        tenderUnps: clampIds(m.tenderUnps),
        fundContractNumbers: clampIds(m.fundContractNumbers),
      }
    : undefined;

const VERDICTS = new Set(["confirms", "refutes", "partial"]);
const str = (x: unknown): string | undefined =>
  typeof x === "string" && x.length > 0 ? x : undefined;
// Like str() but tolerates a numeric id (a curator writing eik: 831646048 as a
// JSON number keeps its /company/:eik link instead of silently losing it).
const strOrNum = (x: unknown): string | undefined =>
  typeof x === "number" ? String(x) : str(x);
const clampNote = (n: unknown): LocalizedText | undefined => {
  if (!n || typeof n !== "object") return undefined;
  const bg = str((n as LocalizedText).bg);
  const en = str((n as LocalizedText).en);
  return bg || en ? { bg, en } : undefined;
};
/** Bound + FULLY shape-check the untrusted `claims[]` from ?q=: keep only entries
 *  with a non-empty string `text`, cap the array, drop an invalid verdict, and
 *  coerce EVERY rendered field to a string / valid note — a non-string here would
 *  otherwise throw "Objects are not valid as a React child" and crash the screen
 *  (render also scheme-validates sourceUrl). */
const clampClaims = (c: Claim[] | undefined): Claim[] | undefined => {
  if (!Array.isArray(c)) return undefined;
  const out: Claim[] = c
    .filter((x) => x && typeof x.text === "string" && x.text.length > 0)
    .slice(0, 20)
    .map((x) => ({
      text: x.text,
      byWhom: str(x.byWhom),
      saidAt: str(x.saidAt),
      sourceUrl: str(x.sourceUrl),
      ourNumber: str(x.ourNumber),
      note: clampNote(x.note),
      verdict: VERDICTS.has(x.verdict as string) ? x.verdict : undefined,
    }));
  return out.length ? out : undefined;
};

const num = (x: unknown): number | undefined =>
  typeof x === "number" && Number.isFinite(x) ? x : undefined;
/** Shape-check the untrusted `advance` (§0g.3): numbers stay numbers, the
 *  rendered strings/note are coerced (a non-string would crash the render). */
const clampAdvance = (a: Advance | undefined): Advance | undefined => {
  if (!a || typeof a !== "object") return undefined;
  const pct = num(a.pctDeclared);
  const eur = num(a.amountEur);
  const out: Advance = {
    // Drop out-of-band figures — the honesty axis is about credible numbers.
    pctDeclared: pct != null && pct >= 0 && pct <= 100 ? pct : undefined,
    amountEur: eur != null && eur >= 0 ? eur : undefined,
    physicalProgressNote: clampNote(a.physicalProgressNote),
    source: str(a.source),
    sourceUrl: str(a.sourceUrl),
    asOf: str(a.asOf),
  };
  // Keep only if it carries a real figure or a progress note.
  return out.amountEur != null ||
    out.pctDeclared != null ||
    out.physicalProgressNote
    ? out
    : undefined;
};

/** Shape-check the untrusted `euFinancing` map from ?q=: keep only entries whose
 *  EU + national shares are both finite and non-negative (a curated split needs
 *  at least one real figure), coerce the source strings. Keyed by ИСУН
 *  contract_number; capped so a hostile ?q= can't balloon the object. */
const clampEuFinancing = (
  m: Record<string, EuFinancingSplit> | undefined,
): Record<string, EuFinancingSplit> | undefined => {
  if (!m || typeof m !== "object") return undefined;
  const out: Record<string, EuFinancingSplit> = {};
  for (const [k, v] of Object.entries(m).slice(0, 50)) {
    if (!v || typeof v !== "object") continue;
    const eu = num(v.euEur);
    const national = num(v.nationalEur);
    const euOk = eu != null && eu >= 0 ? eu : undefined;
    const natOk = national != null && national >= 0 ? national : undefined;
    if (euOk == null && natOk == null) continue;
    out[k] = {
      euEur: euOk ?? 0,
      nationalEur: natOk ?? 0,
      source: str(v.source),
      sourceUrl: str(v.sourceUrl),
    };
  }
  return Object.keys(out).length ? out : undefined;
};

/** Shape-check the untrusted knownSubcontractors[]: every rendered field coerced
 *  to a string/number, entries without a name dropped, array bounded. */
const clampSubs = (
  s: KnownSubcontractor[] | undefined,
): KnownSubcontractor[] | undefined => {
  if (!Array.isArray(s)) return undefined;
  const out: KnownSubcontractor[] = s
    .filter((x) => x && typeof x.name === "string" && x.name.length > 0)
    .slice(0, 50)
    .map((x) => ({
      name: x.name,
      eik: strOrNum(x.eik),
      amountEur: typeof x.amountEur === "number" ? x.amountEur : undefined,
      source: str(x.source),
      sourceUrl: str(x.sourceUrl),
    }));
  return out.length ? out : undefined;
};

/** Shape-check the untrusted `geo.line` (§10 P3, Tier D): keep only well-formed
 *  [lat, lng] pairs within world ranges, bound the point count so a huge ?q= can't
 *  blow up the map, and drop the field unless ≥2 valid points remain (a polyline
 *  needs two). Coordinates are Leaflet-native [lat, lng]. */
const clampGeo = (
  geo: { line?: unknown } | undefined,
): { line: [number, number][] } | undefined => {
  if (!geo || typeof geo !== "object" || !Array.isArray(geo.line))
    return undefined;
  const line: [number, number][] = [];
  // Cap the INPUT walk too (not just the output) so a hostile ?q= with a huge
  // all-invalid array can't force a full-length iteration.
  for (const p of geo.line.slice(0, 8000)) {
    if (line.length >= 4000) break;
    if (
      Array.isArray(p) &&
      typeof p[0] === "number" &&
      typeof p[1] === "number" &&
      Number.isFinite(p[0]) &&
      Number.isFinite(p[1]) &&
      p[0] >= -90 &&
      p[0] <= 90 &&
      p[1] >= -180 &&
      p[1] <= 180
    ) {
      line.push([p[0], p[1]]);
    }
  }
  return line.length >= 2 ? { line } : undefined;
};

/**
 * Parse + validate an untrusted URL-encoded ProjectFileSpec (§4.1). Returns null
 * on bad JSON, a missing/empty search, or a thread with a non-string `terms`;
 * bounds the include/exclude id-lists so a huge `?q=` can't blow up the `in`
 * filters. The one place ?q= becomes trusted data.
 */
export const parseProjectSpec = (
  raw: string | null,
): ProjectFileSpec | null => {
  if (!raw) return null;
  let s: unknown;
  try {
    s = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!s || typeof s !== "object") return null;
  const spec = s as ProjectFileSpec;
  const search = spec.search;
  if (
    !Array.isArray(search) ||
    search.length === 0 ||
    // A thread is valid with recall `terms` OR a buyer/contractor scope (an
    // anchored thread has no terms — the DB scope is the predicate; see
    // isBuyerAnchored / isContractorAnchored). The scope must be ≥1 NON-EMPTY EIK
    // string (an empty/blank one would make seedContractFilter emit a bare
    // tag-only seed = the whole corpus).
    !search.every(
      (t) =>
        t &&
        ((typeof t.terms === "string" && t.terms.length > 0) ||
          (Array.isArray(t.buyerEik) &&
            t.buyerEik.some(
              (e) => typeof e === "string" && e.trim().length > 0,
            )) ||
          (Array.isArray(t.contractorEik) &&
            t.contractorEik.some(
              (e) => typeof e === "string" && e.trim().length > 0,
            ))),
    )
  ) {
    return null;
  }
  return {
    ...spec,
    search: search.slice(0, 20),
    // Clamp the untrusted ?q= value to the known union (never an arbitrary string).
    totalBasis: spec.totalBasis === "corpus" ? "corpus" : undefined,
    includes: clampMembers(spec.includes),
    excludes: clampMembers(spec.excludes),
    claims: clampClaims(spec.claims),
    advance: clampAdvance(spec.advance),
    euFinancing: clampEuFinancing(spec.euFinancing),
    inhouseAwarderEiks: clampIds(spec.inhouseAwarderEiks),
    knownSubcontractors: clampSubs(spec.knownSubcontractors),
    geo: clampGeo(spec.geo),
  };
};

/**
 * A curated /project/:slug file is read-only. "Edit" forks it into an editable
 * DIY copy at the ?q= builder route — the "start from this example" entry point.
 * It keeps the whole SEARCH (all threads incl. their per-buyer scopes — e.g.
 * Hemus's АПИ + НКСИП union), the sector tag (road €/km cross-check), the role
 * labels and the manual include/exclude curation, so the copy reproduces the
 * same member set as a starting point. It STRIPS every editorial field (thesis,
 * authority, claims, verifiedAt, subcontractor notes, …) so a DIY file never
 * carries a Наясно verdict (§11). `&edit=1` opens the copy straight into the
 * thread editor. Exported so a test can lock the no-editorial-leak invariant.
 */
export const curatedForkHref = (spec: ProjectFileSpec): string => {
  const bg = spec.title?.bg ? `Копие: ${spec.title.bg}` : undefined;
  const en = spec.title?.en ? `Copy: ${spec.title.en}` : undefined;
  const copy: ProjectFileSpec = {
    ...(bg || en ? { title: { bg, en } } : {}),
    search: spec.search,
    ...(spec.sector ? { sector: spec.sector } : {}),
    ...(spec.totalBasis ? { totalBasis: spec.totalBasis } : {}),
    ...(spec.nature ? { nature: spec.nature } : {}),
    ...(spec.includes ? { includes: spec.includes } : {}),
    ...(spec.excludes ? { excludes: spec.excludes } : {}),
  };
  return `/procurement/project?q=${encodeURIComponent(JSON.stringify(copy))}&edit=1`;
};

const nonEmpty = (a: readonly string[] | undefined): a is string[] =>
  Array.isArray(a) && a.length > 0;

const toFoldInput = (c: ProcurementContract): FoldInput => ({
  key: c.key,
  tag: c.tag,
  amountEur: c.amountEur ?? null,
  procurementMethod: c.procurementMethod ?? null,
  numberOfTenderers: c.numberOfTenderers ?? null,
  date: c.date ?? null,
  contractorEik: c.contractorEik ?? null,
  contractorName: c.contractorName ?? null,
  cpv: c.cpv ?? null,
  consortiumRole: c.consortiumRole ?? null,
});

// Lineage fetches are page-walked up to LINEAGE_PAGE (the engine caps a single
// page at 100): a buyer-anchored dossier's member set can exceed 100, so a single
// page would silently truncate the procedure list / tender count.
const fetchContractsByUnp = (unps: string[]) =>
  walkResource<ProcurementContract>(
    "contracts",
    [{ id: "date", desc: false }],
    {
      columns: [
        { id: "unp", value: unps },
        { id: "tag", value: ["contract"] },
      ],
    },
    LINEAGE_PAGE,
  ).then((r) => r.rows);

const fetchContractsByKey = (keys: string[]) =>
  walkResource<ProcurementContract>(
    "contracts",
    [{ id: "date", desc: false }],
    // tag='contract' so a curated include-key can't pull an amendment/award row
    // in — keeps every member a spend row (reconciles with the money total).
    {
      columns: [
        { id: "key", value: keys },
        { id: "tag", value: ["contract"] },
      ],
    },
    LINEAGE_PAGE,
  ).then((r) => r.rows);

const fetchTendersByUnp = (unps: string[]) =>
  walkResource<ProjectTenderRow>(
    "tenders",
    [{ id: "publication_date", desc: false }],
    { columns: [{ id: "unp", value: unps }] },
    LINEAGE_PAGE,
  ).then((r) => r.rows);

/** Curated ИСУН fund-project members by contract_number (§4.2.3b). Manual-add
 *  only — no lineage — so this pulls exactly the included contract numbers. */
const fetchFundProjects = (contractNumbers: string[]) =>
  fetchTablePage<FundProjectMember>({
    resource: "fund_projects",
    page: 0,
    pageSize: LINEAGE_PAGE,
    sort: [{ id: "total_eur", desc: true }],
    filters: { columns: [{ id: "contract_number", value: contractNumbers }] },
  });

// Walk a filtered set via the shared projectFile.pageWalk, injecting this
// resource + the React-Query fetch primitive. The offline builder injects its own
// runDbTable fetch into the SAME walker, so client + builder can never drift on
// membership. Returns a TablePageResult so existing callers are unchanged.
const walkResource = <T,>(
  resource: "contracts" | "tenders",
  sort: Array<{ id: string; desc: boolean }>,
  filters: TablePageRequest["filters"],
  cap: number,
): Promise<TablePageResult<T>> =>
  pageWalk<T>(
    ({ page, pageSize, sort: s, filters: f }) =>
      fetchTablePageWithTotal<T>({
        resource,
        page,
        pageSize,
        sort: s,
        filters: f as TablePageRequest["filters"],
      }),
    { sort, filters, cap },
  );

async function resolveProjectFile(
  spec: ProjectFileSpec,
): Promise<ProjectFileModel> {
  const threads = spec.search ?? [];
  const excludeKeys = new Set(spec.excludes?.contractKeys ?? []);
  const excludeUnps = new Set(spec.excludes?.tenderUnps ?? []);

  // 1. Seed — per-thread recall over contract titles + tender subjects.
  const seedFetches = threads.map((t) => {
    // A buyer- OR contractor-scoped thread is already precise → skip the
    // contractor-name collision nudge (§4.1b).
    const scoped = nonEmpty(t.buyerEik) || nonEmpty(t.contractorEik);
    // A buyer-anchored thread pages the WHOLE buyer, not the top-N window (its
    // small standalone contracts share no УНП with the big procedures, so lineage
    // can't recover them — see seedCapOf / BUYER_ANCHOR_MAX).
    const cap = seedCapOf(t);
    return Promise.all([
      // Title-only seed — see seedContractFilter (the ONE definition shared with
      // the offline builder). Title-only so a landmark term ("хемус") does not
      // recall a consortium merely NAMED after it; FTS-only for single-token
      // threads (the trigram `%>` fuzz — `планиране` for `саниране` — would only
      // flood the amount-sorted window and the "~M" banner), but FTS+trigram for
      // multi-word ones where the trigram arm is the real recall (see
      // isSingleToken). The confidence gate, not the seed breadth, decides
      // membership. pageWalk makes ONE request unless the thread is buyer-anchored.
      walkResource<ProcurementContract>(
        "contracts",
        [{ id: "amount_eur", desc: true }],
        seedContractFilter(t),
        cap,
      ),
      // A contractor-anchored thread does NOT seed tenders (no contractor column;
      // its procedures come via contract-УНП lineage) — see threadSeedsTenders.
      threadSeedsTenders(t)
        ? walkResource<ProjectTenderRow>(
            "tenders",
            [{ id: "estimated_value_eur", desc: true }],
            seedTenderFilter(t),
            cap,
          )
        : Promise.resolve<TablePageResult<ProjectTenderRow>>({
            rows: [],
            total: null,
            totalExact: false,
            sumEur: null,
          }),
      // Collision probe (§4.1b) — only for an UNSCOPED thread: how many contracts
      // were WON by a firm whose NAME matches the term (a contractor_name match a
      // buyer scope would exclude). We only need the count, so pageSize 1. A
      // buyer-scoped thread is already precise → skip (null). A non-exact count
      // (estimate) is treated as absent so the nudge never quotes a guess.
      scoped
        ? Promise.resolve<number | null>(null)
        : fetchTablePageWithTotal<ProcurementContract>({
            resource: "contracts",
            page: 0,
            pageSize: 1,
            sort: [{ id: "amount_eur", desc: true }],
            // contractor_name is a fold/ILIKE column, so globalFtsOnly is a
            // no-op here — intentionally omitted (the FTS-only rule applies only
            // to the searchText title/subject seeds above).
            filters: {
              global: t.terms ?? "",
              globalCols: ["contractor_name"],
              columns: [{ id: "tag", value: ["contract"] }],
            },
          }).then((r) => (r.totalExact ? r.total : null)),
    ]);
  });
  const seedResults = await Promise.all(seedFetches);
  // A seed page filled to its thread's cap → the search is over-broad (§4.1
  // breadth cap). A buyer-anchored thread's cap is the whole-buyer page, so it
  // only counts as truncated when the buyer exceeds BUYER_ANCHOR_MAX.
  const truncated = seedResults.some(
    ([c, t], i) =>
      c.rows.length >= seedCapOf(threads[i]) ||
      t.rows.length >= seedCapOf(threads[i]),
  );
  // The approximate total contracts matching the search term(s), from the
  // engine's exact count aggregate — so the banner can say "~M договора" (§4.1).
  // Null unless the CONTRACT side hit the cap (a tender-only truncation must not
  // claim contracts were trimmed) and every thread's count was exact.
  const matchedTotal = matchedContractTotal(
    seedResults.map(([c], i) => ({
      rowCount: c.rows.length,
      total: c.total,
      totalExact: c.totalExact,
      cap: seedCapOf(threads[i]),
    })),
    SEED_PAGE,
  );
  // Contractor-name collision nudge (§4.1b) — the first unscoped thread whose term
  // also names ≥ COLLISION_MIN winning firms, so the screen can suggest a buyer
  // scope. Scoped threads (already precise) never contribute.
  const collision = pickCollision(
    threads.map((t, i) => ({
      term: t.terms ?? "",
      scoped: nonEmpty(t.buyerEik) || nonEmpty(t.contractorEik),
      count: seedResults[i][2],
    })),
  );
  const matchedContracts: ProcurementContract[] = [];
  const matchedTenders: ProjectTenderRow[] = [];
  // Ids seeded by a buyer-anchored thread auto-include past the title gate — the
  // DB buyer-filter already decided their membership (mirrors resolveMembers).
  const anchoredKeys = new Set<string>();
  const anchoredUnps = new Set<string>();
  seedResults.forEach(([c, t], i) => {
    matchedContracts.push(...c.rows);
    matchedTenders.push(...t.rows);
    if (isAnchored(threads[i])) {
      for (const row of c.rows) anchoredKeys.add(row.key);
      for (const row of t.rows) anchoredUnps.add(row.unp);
    }
  });

  // 2. Score + seed = (autoIn ∪ includes) − excludes. A buyer-anchored seed row
  // bypasses the title gate (seedScore: score 1 / threshold 0).
  const scoredContracts = dedupContracts(matchedContracts).map((c) => ({
    id: c.key,
    ...seedScore(anchoredKeys.has(c.key), c.title, threads),
  }));
  const scoredTenders = dedupTenders(matchedTenders).map((t) => ({
    id: t.unp,
    ...seedScore(anchoredUnps.has(t.unp), t.subject, threads),
  }));
  const seedKeys = resolveSeedIds(
    scoredContracts,
    spec.includes?.contractKeys ?? [],
    spec.excludes?.contractKeys ?? [],
  );
  const seedTenderUnps = resolveSeedIds(
    scoredTenders,
    spec.includes?.tenderUnps ?? [],
    spec.excludes?.tenderUnps ?? [],
  );

  // 3. Lineage — the УНП spine. Union of: unps from the seeded contracts (fetch
  //    their procedures + sibling-lot contracts), the seeded tenders, and the
  //    explicitly-included tender unps. Every fetch guarded on a non-empty set.
  const seedContractRows = dedupContracts(matchedContracts).filter((c) =>
    seedKeys.includes(c.key),
  );
  const unpSet = new Set<string>();
  for (const c of seedContractRows) if (c.unp) unpSet.add(c.unp);
  for (const u of seedTenderUnps) unpSet.add(u);
  const unps = [...unpSet];

  const [lineageContracts, includeContracts, lineageTenders, fundMembers] =
    await Promise.all([
      nonEmpty(unps) ? fetchContractsByUnp(unps) : Promise.resolve([]),
      nonEmpty(spec.includes?.contractKeys)
        ? fetchContractsByKey(spec.includes!.contractKeys!)
        : Promise.resolve([]),
      nonEmpty(unps) ? fetchTendersByUnp(unps) : Promise.resolve([]),
      // ИСУН fund members (§4.2.3b) — manual-add only, by contract_number. Catch
      // so a fund-fetch failure (e.g. a DB predating the contract_number filter)
      // degrades to "no ИСУН block" rather than blanking the whole dossier.
      nonEmpty(spec.includes?.fundContractNumbers)
        ? fetchFundProjects(spec.includes!.fundContractNumbers!).catch(() => [])
        : Promise.resolve([]),
    ]);

  // 4. Lot over-expansion guard (§2): for a MANY-lot procedure keep only the
  //    seeded lot's contracts among the pulled siblings (a lot-per-oblast
  //    framework mustn't inflate the total); a few-lot procedure auto-includes
  //    all. Seeded + explicitly-included rows always stay.
  const lotsCountByUnp = new Map<string, number | undefined>(
    lineageTenders.map((t) => [t.unp, t.lotsCount]),
  );
  const seededKeySet = new Set(seedContractRows.map((c) => c.key));
  const matchedLotsByUnp = new Map<string, Set<string | null>>();
  for (const c of seedContractRows) {
    if (!c.unp) continue;
    const set = matchedLotsByUnp.get(c.unp) ?? new Set<string | null>();
    set.add(lotNumberOf(c.title));
    matchedLotsByUnp.set(c.unp, set);
  }
  const guardedLineage = guardLineageContracts(
    lineageContracts,
    seededKeySet,
    matchedLotsByUnp,
    lotsCountByUnp,
  );

  // 5. Assemble: seeded + guarded lineage + explicit includes, − excludes, deduped.
  //    Excluding a procedure (unp) drops BOTH its tender node AND its contracts —
  //    "remove procedure" removes the whole procedure and its money, not just the
  //    marker. Individual contract excludes still apply by key.
  const allContracts = dedupContracts([
    ...seedContractRows,
    ...guardedLineage,
    ...includeContracts,
  ]).filter(
    (c) => !excludeKeys.has(c.key) && !(c.unp && excludeUnps.has(c.unp)),
  );
  const allTenders = dedupTenders(lineageTenders).filter(
    (t) => !excludeUnps.has(t.unp),
  );

  const fold = foldMembers(allContracts.map(toFoldInput));
  // Merge the curated EU-vs-national split (spec.euFinancing, by contract_number)
  // onto each fund member — the bulk ИСУН feed carries only total/БФП/собствено,
  // so this share is curated+sourced, never joined (§4.2.3b).
  const funds = dedupFunds(fundMembers).map((f) => {
    const split = spec.euFinancing?.[f.contractNumber];
    return split
      ? {
          ...f,
          euEur: split.euEur,
          nationalEur: split.nationalEur,
          financingSource: split.source,
          financingSourceUrl: split.sourceUrl,
        }
      : f;
  });
  // Whole-corpus contracted total/count over the seed WHERE — the program-total
  // basis. GATED on usesCorpusTotal (single single-token thread) at the source,
  // exactly like the offline builder, so the model can never carry an unsafe
  // figure (a multi-word re-inflation / multi-thread double-count) even if a
  // future consumer forgets the guard.
  const corpusOn = usesCorpusTotal(spec);
  const corpusContractedEur =
    corpusOn && seedResults.some(([c]) => c.sumEur != null)
      ? seedResults.reduce((s, [c]) => s + (c.sumEur ?? 0), 0)
      : null;
  const corpusContractCount =
    corpusOn && seedResults.every(([c]) => c.totalExact)
      ? seedResults.reduce((s, [c]) => s + (c.total ?? 0), 0)
      : null;
  return {
    contracts: allContracts,
    tenders: allTenders,
    funds,
    fold,
    truncated,
    matchedTotal,
    collision,
    corpusContractedEur,
    corpusContractCount,
  };
}

export const useProjectFile = (spec: ProjectFileSpec | null) =>
  useQuery({
    // Key ONLY on the slice resolveProjectFile actually reads. Presentational,
    // resolver-irrelevant fields (title, nature, thesis, …) must not invalidate
    // the fetch: applying "разпредели по вид" writes `nature` into ?q=, and
    // keying on the whole spec would mint a new key → a full corpus re-resolve +
    // loading flash purely to re-group client-side.
    queryKey: [
      "procurement",
      "project-file",
      spec && {
        search: spec.search,
        includes: spec.includes,
        excludes: spec.excludes,
      },
    ],
    queryFn: () => resolveProjectFile(spec as ProjectFileSpec),
    enabled: !!spec && (spec.search?.length ?? 0) > 0,
    staleTime: Infinity,
  });

/**
 * A LOOSER candidate search for the "broader matches" panel (§0f.3): the same
 * search terms but WITHOUT the per-thread buyerEik scope, so the curator can add
 * on-topic rows the scoped seed missed. Returns deduped contracts RANKED by
 * confidence against the threads (not by amount) so the genuinely-missed rows
 * surface; the screen filters out members/excludes/includes. Runs only when
 * `enabled` (edit mode).
 */
async function fetchBroaderMatches(
  spec: ProjectFileSpec,
): Promise<ProcurementContract[]> {
  const threads = spec.search ?? [];
  // An anchored thread (buyer- or contractor-) has no recall term to broaden by
  // (an empty `global` would seq-scan the whole corpus for noise), and its member
  // set is already the whole scoped slice — nothing broader to surface.
  const fetches = threads
    .filter((t) => !isAnchored(t))
    .map((t) =>
      fetchTablePage<ProcurementContract>({
        resource: "contracts",
        page: 0,
        pageSize: BROADER_PAGE,
        sort: [{ id: "amount_eur", desc: true }],
        filters: {
          global: t.terms ?? "",
          columns: [{ id: "tag", value: ["contract"] }],
        },
      }),
    );
  const rows = dedupContracts((await Promise.all(fetches)).flat());
  return rankBroaderCandidates(rows, threads);
}

export const useBroaderMatches = (
  spec: ProjectFileSpec | null,
  enabled: boolean,
) =>
  useQuery({
    // Keyed on the search terms only — includes/excludes/title edits must not
    // re-trigger this unscoped fetch (it ignores them by design).
    queryKey: ["procurement", "project-broader", spec?.search],
    queryFn: () => fetchBroaderMatches(spec as ProjectFileSpec),
    enabled: enabled && !!spec && (spec.search?.length ?? 0) > 0,
    staleTime: Infinity,
  });

/** One entry in the curated-flagship index (`data/procurement/projects/index.json`). */
export interface CuratedProjectEntry {
  slug: string;
  title: LocalizedText;
  summary?: LocalizedText;
  verifiedAt?: string;
}

/** Keep only well-formed index entries — a non-empty `slug` AND a `title` object
 *  (the gallery renders `f.title` unconditionally, so a malformed entry must not
 *  reach it and blank the on-ramp). Pure + exported for unit testing. */
export const filterCuratedIndex = (
  files: CuratedProjectEntry[] | undefined,
): CuratedProjectEntry[] =>
  (files ?? []).filter(
    (f) =>
      f &&
      typeof f.slug === "string" &&
      f.slug.length > 0 &&
      f.title != null &&
      typeof f.title === "object",
  );

/** Reverse index (contract key / tender УНП → curated slug[]) from
 *  members.json, built offline by build_project_members.ts. */
const useProjectMembersIndex = () =>
  useQuery({
    queryKey: ["procurement", "project-members"],
    queryFn: () =>
      fetchJsonSoft<Record<string, string[]>>(
        dataUrl("/procurement/projects/members.json"),
      ),
    staleTime: Infinity,
  });

/** The curated flagship files that include a given contract key / tender УНП —
 *  drives the member→file up-link on the detail pages (§10 Phase 3). */
export const useProjectMemberFiles = (
  id: string | undefined,
): CuratedProjectEntry[] => {
  const members = useProjectMembersIndex();
  const index = useCuratedProjectIndex();
  return useMemo(() => {
    if (!id || !members.data || !index.data) return [];
    const slugs = new Set(members.data[id] ?? []);
    return slugs.size ? index.data.filter((f) => slugs.has(f.slug)) : [];
  }, [id, members.data, index.data]);
};

/** The list of committed curated flagship files, for the on-ramp gallery (§4.3b). */
export const useCuratedProjectIndex = () =>
  useQuery({
    queryKey: ["procurement", "curated-project-index"],
    queryFn: async (): Promise<CuratedProjectEntry[]> => {
      const raw = await fetchJsonSoft<{ files?: CuratedProjectEntry[] }>(
        dataUrl("/procurement/projects/index.json"),
      );
      return filterCuratedIndex(raw?.files);
    },
    staleTime: Infinity,
  });

/** Load a CURATED flagship file (§4.4 / §10 Phase 3) — a committed
 *  `data/procurement/projects/<slug>.json` ProjectFileSpec, served through the
 *  same validation as a ?q= spec. Returns null on a missing/invalid file (the
 *  screen renders a not-found state). Curated files are read-only + indexable. */
export const useCuratedProjectSpec = (slug: string | undefined) =>
  useQuery({
    queryKey: ["procurement", "curated-project", slug],
    queryFn: async (): Promise<ProjectFileSpec | null> => {
      const raw = await fetchJsonSoft<unknown>(
        dataUrl(`/procurement/projects/${slug}.json`),
      );
      // Reuse the untrusted-input validator (the file is committed, but the
      // clamps + shape checks keep one code path).
      return raw ? parseProjectSpec(JSON.stringify(raw)) : null;
    },
    enabled: !!slug,
    staleTime: Infinity,
  });

/** Resolve a curated `announcedBudget.budgetLine` to its ЗДБ Приложение III capital
 *  line (§10 P3, Tier C). Fetches data/budget/investment_program/<year>.json ONLY
 *  when the file carries a budget-line reference; returns null (caller hides the
 *  sourced-line caption) when there is no reference, no payload, or no match. */
export const useResolvedBudgetLine = (
  spec: ProjectFileSpec | null | undefined,
): ResolvedBudgetLine | null => {
  const budgetLine = spec?.announcedBudget?.budgetLine;
  // fiscalYear feeds a data URL — a DIY ?q= spec is untrusted, so accept only a
  // plausible integer year (never a string that could path-traverse the fetch).
  const year = safeFiscalYear(budgetLine?.fiscalYear);
  const { data } = useQuery({
    queryKey: ["budget", "investment-program", year],
    queryFn: () =>
      fetchJsonSoft<InvestmentProgram>(
        dataUrl(`/budget/investment_program/${year}.json`),
      ),
    enabled: year != null,
    staleTime: Infinity,
  });
  return useMemo(
    () => resolveBudgetLine(budgetLine, data ?? null),
    [budgetLine, data],
  );
};
