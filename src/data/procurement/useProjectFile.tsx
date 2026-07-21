// useProjectFile — the React fetch-hook that wires the pure resolver core
// (projectFile.ts) to the /api/db/table engine (whose unp/key `in`-filters step 1
// enabled). See docs/plans/procurement-project-lifecycle-v1.md §2/§4.1.
//
// Flow: for each search thread, fetch matched contracts + tenders (recall) →
// score with the confidence core → seed = (autoIn ∪ includes) − excludes →
// fetch the УНП-lineage (every contract of the seed procedures = sibling lots) →
// dedup + fold. CRITICAL: an `in`-filter on an EMPTY array returns the whole
// corpus, so every by-unp / by-key fetch is guarded on a non-empty set.

import { useQuery } from "@tanstack/react-query";
import { fetchTablePage } from "./fetchTablePage";
import type { ProcurementContract } from "@/data/dataTypes";
import {
  bestConfidence,
  rankBroaderCandidates,
  resolveSeedIds,
  dedupContracts,
  dedupTenders,
  foldMembers,
  siblingLotPolicy,
  lotNumberOf,
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
}

export interface Benchmark {
  unit: string;
  low?: number;
  high?: number;
  impliedLow?: number;
  impliedHigh?: number;
  note?: LocalizedText;
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
  announcedBudget?: AnnouncedBudget;
  benchmark?: Benchmark;
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
}

export interface ProjectFileModel {
  contracts: ProcurementContract[];
  tenders: ProjectTenderRow[];
  fold: ProjectFold;
  /** A seed thread hit the recall cap → the search is over-broad, results are a
   *  top-N slice, not the whole set. The screen should prompt to narrow (§4.1). */
  truncated: boolean;
}

const SEED_PAGE = 60;
const LINEAGE_PAGE = 400;
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
    !search.every((t) => t && typeof t.terms === "string" && t.terms.length > 0)
  ) {
    return null;
  }
  return {
    ...spec,
    search: search.slice(0, 20),
    includes: clampMembers(spec.includes),
    excludes: clampMembers(spec.excludes),
  };
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
});

const fetchContractsByUnp = (unps: string[]) =>
  fetchTablePage<ProcurementContract>({
    resource: "contracts",
    page: 0,
    pageSize: LINEAGE_PAGE,
    sort: [{ id: "date", desc: false }],
    filters: {
      columns: [
        { id: "unp", value: unps },
        { id: "tag", value: ["contract"] },
      ],
    },
  });

const fetchContractsByKey = (keys: string[]) =>
  fetchTablePage<ProcurementContract>({
    resource: "contracts",
    page: 0,
    pageSize: LINEAGE_PAGE,
    sort: [{ id: "date", desc: false }],
    // tag='contract' so a curated include-key can't pull an amendment/award row
    // in — keeps every member a spend row (reconciles with the money total).
    filters: {
      columns: [
        { id: "key", value: keys },
        { id: "tag", value: ["contract"] },
      ],
    },
  });

const fetchTendersByUnp = (unps: string[]) =>
  fetchTablePage<ProjectTenderRow>({
    resource: "tenders",
    page: 0,
    pageSize: LINEAGE_PAGE,
    sort: [{ id: "publication_date", desc: false }],
    filters: { columns: [{ id: "unp", value: unps }] },
  });

async function resolveProjectFile(
  spec: ProjectFileSpec,
): Promise<ProjectFileModel> {
  const threads = spec.search ?? [];
  const excludeKeys = new Set(spec.excludes?.contractKeys ?? []);
  const excludeUnps = new Set(spec.excludes?.tenderUnps ?? []);

  // 1. Seed — per-thread recall over contract titles + tender subjects.
  type Col = {
    id: string;
    value?: unknown;
    min?: string | number;
    max?: string | number;
  };
  const seedFetches = threads.flatMap((t) => {
    const cCols: Col[] = [{ id: "tag", value: ["contract"] }];
    if (nonEmpty(t.buyerEik))
      cCols.push({ id: "awarder_eik", value: t.buyerEik });
    const tCols: Col[] = [];
    if (nonEmpty(t.buyerEik))
      tCols.push({ id: "buyer_eik", value: t.buyerEik });
    return [
      fetchTablePage<ProcurementContract>({
        resource: "contracts",
        page: 0,
        pageSize: SEED_PAGE,
        sort: [{ id: "amount_eur", desc: true }],
        filters: { global: t.terms, columns: cCols },
      }),
      fetchTablePage<ProjectTenderRow>({
        resource: "tenders",
        page: 0,
        pageSize: SEED_PAGE,
        sort: [{ id: "estimated_value_eur", desc: true }],
        filters: { global: t.terms, columns: tCols },
      }),
    ];
  });
  const seedResults = await Promise.all(seedFetches);
  // A seed page filled to the cap → the search is over-broad (§4.1 breadth cap).
  const truncated = seedResults.some((rows) => rows.length >= SEED_PAGE);
  const matchedContracts: ProcurementContract[] = [];
  const matchedTenders: ProjectTenderRow[] = [];
  seedResults.forEach((rows, i) => {
    if (i % 2 === 0) matchedContracts.push(...(rows as ProcurementContract[]));
    else matchedTenders.push(...(rows as ProjectTenderRow[]));
  });

  // 2. Score + seed = (autoIn ∪ includes) − excludes.
  const scoredContracts = dedupContracts(matchedContracts).map((c) => {
    const b = bestConfidence(c.title, threads);
    return { id: c.key, score: b.score, threshold: b.threshold };
  });
  const scoredTenders = dedupTenders(matchedTenders).map((t) => {
    const b = bestConfidence(t.subject, threads);
    return { id: t.unp, score: b.score, threshold: b.threshold };
  });
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

  const [lineageContracts, includeContracts, lineageTenders] =
    await Promise.all([
      nonEmpty(unps) ? fetchContractsByUnp(unps) : Promise.resolve([]),
      nonEmpty(spec.includes?.contractKeys)
        ? fetchContractsByKey(spec.includes!.contractKeys!)
        : Promise.resolve([]),
      nonEmpty(unps) ? fetchTendersByUnp(unps) : Promise.resolve([]),
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
  const guardedLineage = lineageContracts.filter((c) => {
    if (seededKeySet.has(c.key)) return true; // a seed row always stays
    if (!c.unp) return true;
    if (siblingLotPolicy(lotsCountByUnp.get(c.unp)) === "all") return true;
    const matched = matchedLotsByUnp.get(c.unp); // many-lot: only seeded lots
    return matched ? matched.has(lotNumberOf(c.title)) : false;
  });

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
  return { contracts: allContracts, tenders: allTenders, fold, truncated };
}

export const useProjectFile = (spec: ProjectFileSpec | null) =>
  useQuery({
    queryKey: ["procurement", "project-file", spec],
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
  const fetches = threads.map((t) =>
    fetchTablePage<ProcurementContract>({
      resource: "contracts",
      page: 0,
      pageSize: BROADER_PAGE,
      sort: [{ id: "amount_eur", desc: true }],
      filters: {
        global: t.terms,
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
