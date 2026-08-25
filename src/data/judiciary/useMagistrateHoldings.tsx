// Companies a magistrate declared a link to (чл. 175а ЗСВ), name-matched to the
// Commerce Registry. Served from Postgres (schema 070_magistrates, loaded from
// magistrate_holdings.json): the /person tile fetches ONE magistrate by name, the
// /company tile by EIK, the search a slim roster — instead of downloading the whole
// holdings / company-index / search JSON. Sparse by design; a lead, not proof.

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "./fetchJson";
import { normName } from "./normName";

export interface MagistrateCompany {
  name: string;
  stakePct: number | null;
  /** EIK when the declared name maps to exactly one registry entity; else null. */
  eik: string | null;
  /** true when the name matches several entities (a lead we cannot pin down). */
  eikAmbiguous: boolean;
}

/** Best-effort, informational figures reproduced from the declaration — specific
 *  labelled amounts, NOT a net-worth total. All in лв. */
export interface MagistrateFinancials {
  bankCashLv: number;
  securitiesLv: number;
  /** ⚠️ THE ORIGINAL HEURISTIC'S COUNT — DELIBERATELY NOT RENDERED ANYWHERE, by any surface.
   *  It invents property against magistrates who declared none and misses it where it exists,
   *  so it is not a rougher version of the real number and is never a fallback for one.
   *  declaredPropertyCount() below is the only thing a surface may call.
   *
   *  It stays on the wire because `magistrate_by_name()` returns it and the asset loader
   *  reports the two side by side when it runs, which is how a drift in either is noticed.
   *  Nothing else reads it. */
  realEstateCount: number;
  /** The same count from the structured reader. `null` means it has no answer for this
   *  filing — the operator crawl has not reached it, or the document is on a form version the
   *  parser refuses. NOT zero: zero is the reader saying the filing lists no property. */
  realEstateCountParsed?: number | null;
}

/** One declaration the ИВСС register lists under this magistrate's NAME.
 *
 *  A document a reader can open — never a claim that we have parsed it. Exactly one filing
 *  per magistrate is parsed, and `MagistrateHolding.sourceUrl` names that one. */
export interface MagistrateFiling {
  /** The register's page-heading year — the year the declaration was FILED, NOT the period
   *  it covers. An annual filed in 2026 covers 01.01–31.12.2025 and states that on its own
   *  page 2, which nothing here reads. Never render this as „данни за <year>". */
  year: number;
  /** ⚠️ The register's DIRECTORY, not the declaration type: `annual` = /declaracii/<year>/,
   *  `change` = /declaracii/<year>-1/. The ИВСС files some ANNUAL declarations into the
   *  `-1` one — Цацаров's from 2025-1 is stamped „ЕЖЕГОДНА" and covers 2024 — so rendering
   *  this as „Годишна / За промяна" states something the document contradicts. */
  registerDir: string;
  /** Входящ номер, e.g. „4352/22.04.2026". Null where the register published none. */
  ref: string | null;
  sourceUrl: string;
  /** The declaration's own type — annual | entry | exit | post-exit | interests | unknown —
   *  read from the document. Null until the operator crawl has reached this filing.
   *  ⚠️ It decides what Таблица 1 MEANS: a year's acquisitions on an annual, the WHOLE estate
   *  on an entry filing. A surface showing those rows must have it. */
  kind?: string | null;
}

/** One property row declared in a filing (schema 185), exactly as the magistrate wrote it. */
export interface MagistrateFilingAsset {
  /** ⚠️ '1' and '2' are DIFFERENT CLAIMS and must never be totalled together.
   *  '1' — property ACQUIRED during the declared period. Except on an ENTRY filing, where
   *        Таблица 1 is the whole estate at the date of taking office; only the filing's
   *        `kind` separates the two.
   *  '2' — property TRANSFERRED AWAY during the period. */
  tableNum: "1" | "2";
  /** The ordinal the FORM prints. Gaps are legitimate — the form prints numbered but
   *  unfilled slots — so this is not a dense index. */
  ord: number;
  kind: string | null;
  location: string | null;
  municipality: string | null;
  area: string | null;
  builtArea: string | null;
  /** „Цена на сделката", in лв. Null where the cell is blank, which is common and real:
   *  property received under a marriage contract or a gift declares no price. */
  priceLv: number | null;
  /** ⚠️ THE UNIT `priceLv` IS IN, AND IT IS NOT ALWAYS ЛЕВА. Bulgaria adopted the euro on
   *  2026-01-01 and the ИВСС reissued the declaration as v4.0 with „Цена на сделката /евро/";
   *  v3.0 says /лева/. Both are current — 2026 carries 3,483 v3.0 filings beside 201 v4.0 —
   *  so this is read from each document and never derived from its year or version.
   *  `null` means the corpus predates that reading; render no unit rather than guessing. */
  priceCurrency?: "BGN" | "EUR" | null;
  acquiredYear: number | null;
  holderName: string | null;
  share: string | null;
  legalBasis: string | null;
  fundsOrigin: string | null;
  /** ⚠️ FALSE means the row was sparse and its cells were placed by nearest column header
   *  rather than positionally, which can merge two adjacent cells into one. A surface that
   *  publishes VALUES off this row should say so or withhold them. */
  exact: boolean;
}

export interface MagistrateHolding {
  name: string;
  position: string | null;
  court: string | null;
  companies: MagistrateCompany[];
  /** Present for records written after the financials ingest; may be absent. */
  financials?: MagistrateFinancials;
  /** The declaration the figures above were parsed FROM — provenance, so a reader can
   *  check them. NOT necessarily the newest filing: for a magistrate off the current bench
   *  the pipeline keeps an older parse it does not refresh. Null on pre-2026-08-24 rows. */
  sourceUrl?: string | null;
  /** Every declaration the register lists under this name, newest first. */
  filings?: MagistrateFiling[];
  /** ⚠️ TRUE when this NAME provably covers more than one human, so `filings` is a name's
   *  history rather than a person's. The register is indexed by name with no court or id
   *  beside it, so namesakes are indistinguishable in it: 26.6% of rostered names carry
   *  more than one annual declaration in a single year, and 256 have two filed on the same
   *  day. A surface rendering `filings` MUST say „подадени под това име" when this is set —
   *  attributing another judge's declarations to this one is the harm it exists to
   *  prevent. */
  filingsNameAmbiguous?: boolean;
}

export interface MagistrateOverview {
  year: number;
  stats: {
    magistratesScanned: number;
    withHoldings: number;
    /** The full latest-year roster count (all magistrates, holders or not). */
    rosterTotal: number;
    totalCompanies: number;
    resolvedEik: number;
  };
  magistrates: MagistrateHolding[];
}

/** Top-N magistrates (by declared-company count) + stats → the /judiciary tile.
 *  Fetch 8 by default; the full list lives on the standalone /judiciary/magistrates
 *  browse page (the tile links there — it does not re-fetch). */
export const useMagistrateOverview = (limit: number) =>
  useQuery({
    queryKey: ["judiciary", "magistrate_overview", limit] as const,
    queryFn: () =>
      fetchJson<MagistrateOverview>(
        `/api/db/magistrate-overview?limit=${limit}`,
      ),
    staleTime: Infinity,
  });

// Magistrates who declared a given company (company page).
export interface CompanyMagistrate {
  name: string;
  position: string | null;
  court: string | null;
  company: string;
  stakePct: number | null;
}

/** Magistrates whose ИВСС declaration names the company at `eik`. Empty for the vast
 *  majority of companies — a lead, not proof. */
export const useCompanyMagistrates = (
  eik: string | undefined,
): { magistrates: CompanyMagistrate[]; year: number | null } => {
  const { data } = useQuery({
    queryKey: ["judiciary", "magistrate_by_company", eik] as const,
    queryFn: () =>
      fetchJson<{ year: number; magistrates: CompanyMagistrate[] }>(
        `/api/db/magistrate-by-company?eik=${encodeURIComponent(eik ?? "")}`,
      ),
    enabled: !!eik,
    staleTime: Infinity,
  });
  return { magistrates: data?.magistrates ?? [], year: data?.year ?? null };
};

/** The magistrate record for a person NAME, if that person is a magistrate who
 *  declared a company. Null for everyone else. Name-matched (a common name could
 *  collide), so the UI must frame it as a lead. */
export const usePersonMagistrateHoldings = (
  name: string | undefined,
): { holding: MagistrateHolding | null; year: number | null } => {
  const norm = name ? normName(name) : "";
  const { data } = useQuery({
    queryKey: ["judiciary", "magistrate_by_name", norm] as const,
    queryFn: () =>
      fetchJson<(MagistrateHolding & { year: number }) | null>(
        `/api/db/magistrate-by-name?norm=${encodeURIComponent(norm)}`,
      ),
    enabled: !!norm,
    staleTime: Infinity,
  });
  return { holding: data ?? null, year: data?.year ?? null };
};

// The "richer bridge": a politician reachable from a magistrate's DECLARED companies
// over the TR officer graph. `path.companies` runs from the magistrate's declared
// company to the politician's company; `path.people` are the bridge officers between
// them (length = companies.length − 1). degree 0 = a shared company, 1 = a shared
// officer, 2 = one more hop.
export interface MagistratePoliticianLink {
  politician: string;
  /** App route to the politician: /candidate/mp-<id> | /officials/<slug>. */
  ref: string;
  kind: "mp" | "official";
  role: string | null;
  totalEur: number | null;
  degree: number;
  path: {
    companies: { eik: string; name: string | null }[];
    people: string[];
  };
}

/** Politicians a magistrate is linked to THROUGH a declared company (ownership →
 *  shared officer → … → politician's company). Empty for almost every magistrate; a
 *  name-matched, multi-hop LEAD, never proof. Same normName key as the holdings hook. */
export const useMagistratePoliticianLinks = (
  name: string | undefined,
): MagistratePoliticianLink[] => {
  const norm = name ? normName(name) : "";
  const { data } = useQuery({
    queryKey: ["judiciary", "magistrate_politician_links", norm] as const,
    queryFn: () =>
      fetchJson<MagistratePoliticianLink[]>(
        `/api/db/magistrate-politician-links?norm=${encodeURIComponent(norm)}`,
      ),
    enabled: !!norm,
    staleTime: Infinity,
  });
  return data ?? [];
};

/** The property rows declared in ONE filing.
 *
 *  Fetched per filing rather than folded into `usePersonMagistrateHoldings`, because a
 *  magistrate can have 72 filings and almost every reader opens none of them. `enabled` is
 *  the caller's disclosure state, so nothing is requested until a row is expanded.
 *
 *  ⚠️ AN EMPTY ARRAY IS NOT „declared no property". It is also what a filing the operator
 *  crawl has not reached yet returns, and what a document the parser REFUSED returns — the
 *  pre-v3.0 form is refused wholesale. The caller must render nothing in that case rather
 *  than an emptiness claim; `magistrate_filing.table1_refused` is where the reason lives. */
export const useMagistrateFilingAssets = (
  sourceUrl: string | undefined,
  enabled: boolean,
): MagistrateFilingAsset[] | undefined => {
  const { data } = useQuery({
    queryKey: ["judiciary", "magistrate_filing_assets", sourceUrl] as const,
    queryFn: () =>
      fetchJson<MagistrateFilingAsset[]>(
        `/api/db/magistrate-filing-assets?url=${encodeURIComponent(sourceUrl ?? "")}`,
      ),
    enabled: !!sourceUrl && enabled,
    staleTime: Infinity,
  });
  return data;
};

/**
 * How many properties a magistrate's own declaration lists — or `null` when we do not know.
 * THE one place that choice is made, because the payload carries two different answers.
 *
 * ⚠️ THE HEURISTIC IS NEVER A FALLBACK. It is not a rougher version of the same number; it is
 * wrong in BOTH directions, adjudicated against the documents themselves. It counted a row
 * whenever some cell parsed above 2,000 — which the control number stamped on every page
 * satisfies — so it INVENTS property against magistrates who declared none (Димо Николов
 * Николов: 6, on a filing carrying „Нямам нищо за деклариране" five times and not one property
 * noun over 11 pages) and MISSES it wholesale where it exists (Иво Веселинов Радев: 0, on a
 * filing declaring 20). Publishing it where the reader is silent would put a fabricated
 * property count beside a named judge's name, which is the one failure this card exists to
 * end. So `null` in, `null` out: the caller renders nothing.
 *
 * `null` means the structured reader has no answer — the operator crawl has not reached this
 * filing, or it is on a form version the parser refuses (v3.0 only; the ИВСС began issuing
 * v4.0 in 2026). `0` is an ANSWER — this filing lists no property — and renders as such.
 *
 * Measured when this shipped: 3,497 of 3,594 roster records already had a read answer, and
 * exactly 40 were showing a heuristic count that this withholds.
 */
export const declaredPropertyCount = (
  f: Pick<
    MagistrateFinancials,
    "realEstateCount" | "realEstateCountParsed"
  > | null,
): number | null => f?.realEstateCountParsed ?? null;
