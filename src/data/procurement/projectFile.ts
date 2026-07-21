// Project-file resolver — the PURE core behind /procurement/project (the curated
// "project file" / проектно досие). See docs/plans/procurement-project-lifecycle-v1.md.
//
// Membership = a saved search (an ARRAY of unioned threads, §0f.2) + a manual
// include-set − exclude-set. This module holds only the pure, deterministic
// pieces — confidence scoring, seed resolution, the lot fan-out guard, award-
// method classification, dedup, and the money fold — so they can be unit-tested
// without a live corpus. The React hook that actually fetches rows (via the
// DbDataTable /api/db/table endpoint whose unp/key filters step 1 enabled) wraps
// these; the fetch layer must short-circuit an EMPTY member set (an `in`-filter
// on [] returns the whole corpus).

/** One search thread. A file's `search` is an array of these, unioned (§0f.2) —
 *  a topic like "elections" needs lexically-disjoint threads (бюлетин / СУЕМГ /
 *  компютърна обработка), each with its own recall scope + confidence. */
export interface SearchThread {
  terms: string;
  mode?: "any" | "all-words" | "phrase";
  /** Per-thread RECALL filter only. NEVER a cross-file confidence signal (§0f):
   *  a multi-awarder topic would wrongly demote true members of the other buyer. */
  buyerEik?: string[];
  /** Token(s) that drive confidence — the distinctive part of the query
   *  ("дъга"), vs the generic landmark ("Софийски околовръстен"). The picker
   *  derives this as the rarest query token; stored on the thread. */
  distinctive?: string[];
  /** Auto-check rows scoring ≥ this in the picker. Default 0.6. */
  threshold?: number;
}

/** Member id-sets at every grain (§2). Fund projects are manual-add only. */
export interface MemberIds {
  contractKeys?: string[];
  tenderUnps?: string[];
  fundContractNumbers?: string[];
}

export const DEFAULT_THRESHOLD = 0.6;
/** Lot fan-out guard threshold (§2): a tender with ≤ K lots auto-includes all
 *  sibling lots (a genuinely split single object); more → matched lots only. */
export const LOTS_GUARD_MAX = 3;

// The membership recall budget, shared between the client resolver
// (useProjectFile.resolveProjectFile) and the offline member-index builder
// (scripts/procurement/build_project_members.ts) so both define the SAME member
// set. Changing these changes what a dossier contains — keep the two in lockstep.
export const SEED_PAGE = 60;
export const LINEAGE_PAGE = 400;

/** Lowercased comparison form. The server search matches over a transliterated
 *  `*_fold`; confidence compares the query and the row title in the same script
 *  (both Cyrillic here), so a plain lowercase is enough and keeps this pure. */
export const foldText = (s: string | null | undefined): string =>
  (s ?? "").toLowerCase();

const tokens = (s: string): string[] =>
  foldText(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);

const hasToken = (haystackFolded: string, token: string): boolean =>
  haystackFolded.includes(foldText(token));

export interface ConfidenceResult {
  score: number; // clamped [0,1]
  reasons: string[];
}

/**
 * Transparent, explainable confidence — NOT a classifier (§2). A row is in the
 * search result because it matched the terms; the score separates a row that
 * carries a *distinctive* token ("дъга") from one matching only a generic
 * landmark ("Софийски околовръстен"/"пътища"). Deterministic and reason-tagged
 * so the timeline can render "защо е тук?".
 */
export function scoreConfidence(
  text: string | null | undefined,
  thread: SearchThread,
): ConfidenceResult {
  const folded = foldText(text);
  const reasons: string[] = [];
  const qTokens = tokens(thread.terms);
  const distinctive = thread.distinctive ?? [];

  const anyTermPresent = qTokens.some((t) => hasToken(folded, t));
  if (!anyTermPresent) return { score: 0, reasons: ["no query token present"] };

  let score = 0.3;
  reasons.push("matches search");

  // An all-terms match alone reaches the 0.6 default threshold, so a thread with
  // no explicit `distinctive` (e.g. a single-term search) still auto-includes
  // its full-term matches. The distinctive boost then lifts genuine object rows
  // clear of landmark-only ones (which have the landmark term but miss the
  // distinctive one, so they stay at the 0.3 base — below threshold).
  const allTermsPresent =
    qTokens.length > 0 && qTokens.every((t) => hasToken(folded, t));
  if (allTermsPresent) {
    score += 0.3;
    reasons.push("all query terms present");
  }

  const hasDistinctive =
    distinctive.length > 0 && distinctive.some((d) => hasToken(folded, d));
  if (hasDistinctive) {
    score += 0.4;
    reasons.push(`distinctive token present (${distinctive.join("/")})`);
  } else if (distinctive.length > 0 && !allTermsPresent) {
    reasons.push("landmark-only (no distinctive token)");
  }

  return { score: Math.min(1, Math.max(0, score)), reasons };
}

export const thresholdOf = (thread: SearchThread): number =>
  thread.threshold ?? DEFAULT_THRESHOLD;

/**
 * The "see all" escape-hatch href for the truncation banner (§4.1), or null when
 * there is nothing to link. Deep-links the server-paginated contracts browser:
 *  - `q` seeds its free-text search box,
 *  - `pscope=all` pivots it to the full corpus (the seed search is all-time, so a
 *    default parliament-window scope would show far fewer than the ~M quoted),
 *  - `awarder` carries the thread's buyerEik so a buyer-scoped file lands on the
 *    SAME buyer scope its count was measured over, not an all-buyers superset.
 * Only the FIRST thread's terms are linked — the destination is one free-text box,
 * so unioning distinct threads' phrases would AND their tokens and match fewer.
 */
export function seeAllContractsHref(
  thread: SearchThread | undefined,
): string | null {
  const terms = thread?.terms?.trim();
  if (!terms) return null;
  let href = `/procurement/contracts?q=${encodeURIComponent(terms)}&pscope=all`;
  if (thread?.buyerEik?.length)
    href += `&awarder=${encodeURIComponent(thread.buyerEik.join(","))}`;
  return href;
}

/** One thread's contract-seed shape the truncation count reads. */
export interface ContractSeedMeta {
  rowCount: number;
  total: number | null;
  totalExact: boolean;
}

/**
 * The approximate total matching contracts for the "search too broad" notice, or
 * null when the notice should NOT lead with a contract count. Null unless:
 *  - the CONTRACT side actually hit the seed cap (a tender-only truncation must
 *    not claim contracts were trimmed — the count would be complete), AND
 *  - every thread reported an EXACT count (never sum reltuples estimates).
 * Summed across threads, which are unioned and may overlap → an approximate upper
 * bound (the caller renders it with a "~").
 */
export function matchedContractTotal(
  seeds: readonly ContractSeedMeta[],
  seedPage: number,
): number | null {
  const contractsTruncated = seeds.some((s) => s.rowCount >= seedPage);
  if (!contractsTruncated) return null;
  if (!seeds.every((s) => s.total != null && s.totalExact)) return null;
  return seeds.reduce((sum, s) => sum + (s.total ?? 0), 0);
}

/** The lot number parsed from a contract title ("Обособена позиция N"), matched
 *  against tenders.lots[].lotId (the title-parsed, non-FK link — §2). Null when
 *  the contract carries no lot marker (it attaches at the procedure grain). */
export function lotNumberOf(title: string | null | undefined): string | null {
  const m = (title ?? "").match(/Обособена позиция\s+(\d+)/i);
  return m ? m[1] : null;
}

/** The lot number for DISPLAY grouping on the timeline — wider than lotNumberOf:
 *  also matches the "ОП N" shorthand (and an optional "№") АПИ commonly uses in
 *  contract titles, so a contract whose DB `lot_name` wasn't recovered still lands
 *  under its обособена позиция. Kept SEPARATE from lotNumberOf so the membership
 *  over-expansion guard (§2) is not perturbed. */
export function displayLotNumberOf(
  title: string | null | undefined,
): string | null {
  const m = (title ?? "").match(/(?:Обособена позиция|ОП)\s*№?\s*(\d+)/i);
  return m ? m[1] : null;
}

export interface LotGroup {
  lotNo: string;
  /** The lot's full name, from the first member that carries a DB `lot_name`
   *  (null when none in the group has a recovered name). */
  lotName: string | null;
  contracts: LotContract[];
}

/** The contract fields the lot fold reads (a structural subset of
 *  ProcurementContract) — keeps the fold usable from tests without a full row. */
export interface LotContract {
  title?: string | null;
  lotName?: string | null;
}

/**
 * Group a procedure's member contracts by their обособена позиция (lot) for the
 * timeline tree (§4.2). The lot key is the display lot-number parsed from each
 * title (so "ОП N" and "Обособена позиция N" both resolve), NOT the DB `lot_name`
 * alone — many АПИ contracts carry a title lot marker but no recovered `lot_name`.
 * Contracts with no parseable lot number attach directly under the procedure
 * (`noLot`). Pure + deterministic; lots ordered by numeric lot number.
 */
export function foldContractsByLot<T extends LotContract>(
  contracts: readonly T[],
): { lots: (LotGroup & { contracts: T[] })[]; noLot: T[] } {
  const byNo = new Map<string, LotGroup & { contracts: T[] }>();
  const noLot: T[] = [];
  for (const c of contracts) {
    const no = displayLotNumberOf(c.title);
    if (!no) {
      noLot.push(c);
      continue;
    }
    let g = byNo.get(no);
    if (!g) {
      g = { lotNo: no, lotName: null, contracts: [] };
      byNo.set(no, g);
    }
    if (!g.lotName && c.lotName) g.lotName = c.lotName;
    g.contracts.push(c);
  }
  const lots = [...byNo.values()].sort(
    (a, b) => Number(a.lotNo) - Number(b.lotNo),
  );
  return { lots, noLot };
}

/** Broad role for a CPV division (2-digit) — the money-by-role fallback when a
 *  member has no curated `nature`. Unknown divisions show "ЦПВ NN". */
const CPV_DIVISION_ROLE: Record<string, { bg: string; en: string }> = {
  "45": { bg: "строителство", en: "works" },
  "71": { bg: "проектиране и надзор", en: "design & supervision" },
  "34": { bg: "транспортни средства", en: "transport equipment" },
  "44": { bg: "строителни материали", en: "construction materials" },
  "48": { bg: "софтуер", en: "software" },
  "72": { bg: "ИТ услуги", en: "IT services" },
  "50": { bg: "поддръжка и ремонт", en: "maintenance & repair" },
  "79": { bg: "бизнес услуги", en: "business services" },
  "90": { bg: "околна среда", en: "environmental services" },
  "77": { bg: "озеленяване", en: "landscaping" },
  "09": { bg: "горива и енергия", en: "fuels & energy" },
  "33": { bg: "медицински", en: "medical" },
  "30": { bg: "офис/ИТ оборудване", en: "office/IT equipment" },
};

export interface ContractorAgg {
  eik?: string;
  name: string;
  count: number;
  eur: number;
}

/** Aggregate member contracts by contractor (§4.2.5) — count + Σ amount_eur,
 *  sorted by value desc. Spend rows only (tag='contract'); amendment/award rows
 *  are skipped so this reconciles with the Σ amount_eur total. */
export function foldByContractor(
  rows: ReadonlyArray<{
    contractorEik?: string | null;
    contractorName?: string | null;
    tag?: string | null;
    amountEur?: number | null;
  }>,
): ContractorAgg[] {
  const map = new Map<string, ContractorAgg>();
  for (const c of rows) {
    if ((c.tag ?? "contract") !== "contract") continue;
    const key = c.contractorEik || c.contractorName || "?";
    const e = map.get(key) ?? {
      eik: c.contractorEik || undefined,
      name: c.contractorName || key,
      count: 0,
      eur: 0,
    };
    e.count += 1;
    e.eur += c.amountEur ?? 0;
    map.set(key, e);
  }
  return [...map.values()].sort((a, b) => b.eur - a.eur);
}

/** A stable grouping key for a member's role (§4.2.4) — the curated `nature`
 *  label when set, else `cpv:<2-digit division>`. Nature labels are Cyrillic
 *  words and CPV keys are `cpv:NN`, so the two spaces never collide. */
export function roleKeyOf(
  nature: unknown, // untrusted ?q= — may be a non-string; guarded below
  cpv: string | null | undefined,
): string {
  const n = typeof nature === "string" ? nature.trim() : "";
  if (n) return n;
  const div = (cpv ?? "").slice(0, 2);
  return div ? `cpv:${div}` : "cpv:—";
}

/** Display label for a role key from `roleKeyOf`. */
export function roleLabel(key: string, bg: boolean): string {
  if (!key.startsWith("cpv:")) return key; // a curated nature label
  const div = key.slice(4);
  const r = CPV_DIVISION_ROLE[div];
  if (r) return bg ? r.bg : r.en;
  return div === "—"
    ? bg
      ? "без ЦПВ"
      : "no CPV"
    : `${bg ? "ЦПВ" : "CPV"} ${div}`;
}

export type AwardMethodClass = "competitive" | "nonCompetitive" | "unspecified";

/**
 * Classify an award method for the "как е възложено" honesty strip (§0g.1).
 * Blank is its OWN bucket (§11 caveat: ~€2.66bn of АПИ awards carry an empty
 * method; folding them into "competitive" would understate the non-competitive
 * share). Non-competitive markers are matched explicitly; everything else that
 * is non-blank is treated as competitive.
 */
export function classifyMethod(
  procurementMethod: string | null | undefined,
): AwardMethodClass {
  const m = foldText(procurementMethod).trim();
  if (!m) return "unspecified";
  if (
    /договаряне без|пряко договаряне|вътрешен|без предварително|без публикуване|inhouse|in-house/.test(
      m,
    )
  ) {
    return "nonCompetitive";
  }
  return "competitive";
}

/** Single-bidder flag (§0g.1). `number_of_tenderers ≤ 1` — a red honesty flag.
 *  Null/undefined (undisclosed) is NOT single-bid — don't over-flag. */
export const isSingleBid = (
  numberOfTenderers: number | null | undefined,
): boolean => typeof numberOfTenderers === "number" && numberOfTenderers <= 1;

/** The signing→current (post-annex) value change on a contract — an annex moved
 *  the value. Null when either side is missing (foreign-currency rows) or the
 *  change is sub-€1 (rounding noise, not an annex). Positive = the value grew. */
export function annexDelta(
  signing: number | null | undefined,
  current: number | null | undefined,
): number | null {
  if (signing == null || current == null) return null;
  const d = current - signing;
  return Math.abs(d) >= 1 ? d : null;
}

/**
 * Resolve the seed id-set from scored matches + the manual overrides (§2):
 *   seed = (autoIn ∪ includes) − excludes
 * `autoIn` = matches scoring ≥ their thread threshold. Ids are opaque strings
 * (contract keys or tender unps); includes force-add, excludes always win.
 */
export function resolveSeedIds(
  scored: ReadonlyArray<{ id: string; score: number; threshold: number }>,
  includes: readonly string[] = [],
  excludes: readonly string[] = [],
): string[] {
  const ex = new Set(excludes);
  const out = new Set<string>();
  for (const r of scored) if (r.score >= r.threshold) out.add(r.id);
  for (const id of includes) out.add(id);
  for (const id of ex) out.delete(id);
  return [...out];
}

/** Lot fan-out guard (§2): does resolving a tender auto-include ALL its sibling
 *  lots' contracts, or only the matched lot(s)? Few lots → a genuinely split
 *  single object (auto-all); many → a framework (matched-only, rest are
 *  candidates), so a lot-per-oblast tender can't drag the whole thing in. */
export function siblingLotPolicy(
  lotsCount: number | null | undefined,
  guardMax: number = LOTS_GUARD_MAX,
): "all" | "matched-only" {
  const n = lotsCount ?? 1;
  return n <= guardMax ? "all" : "matched-only";
}

const uniqBy = <T>(items: readonly T[], key: (t: T) => string): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const k = key(it);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
};

/** Dedup member contracts by `key` (§2). */
export const dedupContracts = <T extends { key: string }>(
  rows: readonly T[],
): T[] => uniqBy(rows, (r) => r.key);

/** Dedup member tenders by `unp` — two lots of one tender collapse to one node. */
export const dedupTenders = <T extends { unp: string }>(
  rows: readonly T[],
): T[] => uniqBy(rows, (r) => r.unp);

/** Dedup fund members by `contractNumber` (§4.2.3b). `contract_number` is the
 *  fund_projects PRIMARY KEY (one row per project), so this only guards a curated
 *  include-set that lists the same project twice — it never merges distinct
 *  projects. Keeps the first (highest total_eur under the resolver's sort). */
export const dedupFunds = <T extends { contractNumber: string }>(
  rows: readonly T[],
): T[] => uniqBy(rows, (r) => r.contractNumber);

export interface FoldInput {
  key: string;
  tag?: string | null;
  amountEur?: number | null;
  procurementMethod?: string | null;
  numberOfTenderers?: number | null;
  date?: string | null;
  contractorEik?: string | null;
  contractorName?: string | null;
  cpv?: string | null;
}

export interface MethodMix {
  competitive: number; // Σ amountEur
  nonCompetitive: number;
  unspecified: number;
}

export interface ProjectFold {
  contractCount: number;
  contractorCount: number;
  totalContractedEur: number; // Σ amountEur over tag='contract' rows
  singleBidCount: number;
  methodMix: MethodMix;
  byYear: Record<string, number>;
}

const yearOf = (date: string | null | undefined): string | null =>
  date && /^\d{4}/.test(date) ? date.slice(0, 4) : null;

/**
 * Money fold over the deduped member CONTRACTS (§4.1 step 3). Basis is
 * Σ `amountEur` over spend rows only (tag='contract'; amendment/award rows are
 * excluded upstream but guarded here too — reference_procurement_eur_sum_basis).
 * Deterministic; rounds nothing (callers format).
 */
export function foldMembers(rows: readonly FoldInput[]): ProjectFold {
  // Filter to spend rows BEFORE dedup: a same-`key` amendment sorted first must
  // never shadow the real contract row (dedup keeps the first per key).
  const spend = dedupContracts(
    rows.filter((r) => (r.tag ?? "contract") === "contract"),
  );
  const contractors = new Set<string>();
  const byYear: Record<string, number> = {};
  const methodMix: MethodMix = {
    competitive: 0,
    nonCompetitive: 0,
    unspecified: 0,
  };
  let total = 0;
  let singleBidCount = 0;

  for (const r of spend) {
    const amt = r.amountEur ?? 0;
    total += amt;
    if (r.contractorEik) contractors.add(r.contractorEik);
    if (isSingleBid(r.numberOfTenderers)) singleBidCount += 1;
    const cls = classifyMethod(r.procurementMethod);
    methodMix[cls] += amt;
    const y = yearOf(r.date);
    if (y) byYear[y] = (byYear[y] ?? 0) + amt;
  }

  return {
    contractCount: spend.length,
    contractorCount: contractors.size,
    totalContractedEur: total,
    singleBidCount,
    methodMix,
    byYear,
  };
}

export interface PeriodAgg {
  period: string; // the calendar year, e.g. "2021"
  totalEur: number;
  contractCount: number;
  topContractorName?: string;
  topContractorEur: number;
  methodMix: MethodMix;
}

/**
 * Per-period rollup for a RECURRING project (§4.2.2b) — elections per cycle,
 * annual maintenance, yearly IT support. The single lifecycle timeline can't show
 * "all parliamentary printing 2016–2026"; this groups member spend rows by
 * calendar year with Σ contracted, # contracts, the top contractor, and the
 * method mix, sorted chronologically. Cycle-precise attribution (multiple
 * elections in one year) would need per-contract election linkage we don't hold,
 * so both `recurrence.by` modes bucket by year — the label differs in the UI.
 */
export function foldByPeriod(rows: readonly FoldInput[]): PeriodAgg[] {
  const spend = dedupContracts(
    rows.filter((r) => (r.tag ?? "contract") === "contract"),
  );
  const buckets = new Map<
    string,
    {
      totalEur: number;
      count: number;
      methodMix: MethodMix;
      contractors: Map<string, number>;
    }
  >();
  for (const r of spend) {
    const y = yearOf(r.date);
    if (!y) continue;
    const b = buckets.get(y) ?? {
      totalEur: 0,
      count: 0,
      methodMix: { competitive: 0, nonCompetitive: 0, unspecified: 0 },
      contractors: new Map<string, number>(),
    };
    const amt = r.amountEur ?? 0;
    b.totalEur += amt;
    b.count += 1;
    b.methodMix[classifyMethod(r.procurementMethod)] += amt;
    const name = r.contractorName || r.contractorEik;
    if (name) b.contractors.set(name, (b.contractors.get(name) ?? 0) + amt);
    buckets.set(y, b);
  }
  return [...buckets.entries()]
    .map(([period, b]) => {
      let topContractorName: string | undefined;
      let topContractorEur = 0;
      for (const [name, eur] of b.contractors) {
        // Name tiebreak on equal Σ → stable regardless of fetch/iteration order.
        if (
          eur > topContractorEur ||
          (eur === topContractorEur &&
            name.localeCompare(topContractorName ?? "") < 0)
        ) {
          topContractorEur = eur;
          topContractorName = name;
        }
      }
      return {
        period,
        totalEur: b.totalEur,
        contractCount: b.count,
        topContractorName,
        topContractorEur,
        methodMix: b.methodMix,
      };
    })
    .sort((a, b) => a.period.localeCompare(b.period));
}

/** Union-of-threads scoring: score a row against EVERY thread and keep the best
 *  (a row auto-includes if any thread is confident about it, §0f.2). */
export function bestConfidence(
  text: string | null | undefined,
  threads: readonly SearchThread[],
): { score: number; threshold: number; reasons: string[] } {
  let best = {
    score: 0,
    threshold: DEFAULT_THRESHOLD,
    reasons: ["no thread matched"],
  };
  for (const t of threads) {
    const c = scoreConfidence(text, t);
    if (c.score > best.score) {
      best = { score: c.score, threshold: thresholdOf(t), reasons: c.reasons };
    }
  }
  return best;
}

// How many broader-match candidates the edit-mode panel shows at once (§0f.3).
export const BROADER_SHOWN = 15;

export interface BroaderCandidate {
  key: string;
  title?: string | null;
  amountEur?: number | null;
}

/**
 * Rank the looser (unscoped) broader-search rows by RELEVANCE, not amount: score
 * each title against the search threads, drop below-threshold rows, then sort by
 * confidence desc (amount as tiebreak). Without this an on-name-but-off-topic
 * large contract would crowd out the genuinely-missed small one the panel exists
 * to surface (§0f.3).
 */
export function rankBroaderCandidates<T extends BroaderCandidate>(
  rows: readonly T[],
  threads: readonly SearchThread[],
): T[] {
  return rows
    .map((r) => ({ r, c: bestConfidence(r.title, threads) }))
    .filter((x) => x.c.score >= x.c.threshold)
    .sort(
      (a, b) =>
        b.c.score - a.c.score || (b.r.amountEur ?? 0) - (a.r.amountEur ?? 0),
    )
    .map((x) => x.r);
}

/**
 * Keep only genuinely-new candidates — those that aren't already members, aren't
 * excluded, and aren't already force-included — then cap the visible list. Pure
 * so the edit-panel selection is unit-tested independent of the network.
 */
export function selectBroaderCandidates<T extends { key: string }>(
  ranked: readonly T[],
  memberKeys: Iterable<string>,
  excludeKeys: Iterable<string>,
  includeKeys: Iterable<string>,
  limit = BROADER_SHOWN,
): T[] {
  const seen = new Set([...memberKeys, ...excludeKeys, ...includeKeys]);
  return ranked.filter((r) => !seen.has(r.key)).slice(0, limit);
}

/** The state in-house contractors present among the members (§0g.2) — one deduped
 *  {eik,name} per member contractor whose EIK is in the blind-spot set. This is
 *  where the ЦАИС money trail stops (their onward awards aren't published). */
export function matchInhouseContractors(
  rows: ReadonlyArray<{
    contractorEik?: string | null;
    contractorName?: string | null;
  }>,
  inhouseEiks: Iterable<string>,
): { eik: string; name: string }[] {
  const set = new Set(inhouseEiks);
  if (set.size === 0) return [];
  const seen = new Map<string, string>();
  for (const c of rows) {
    if (c.contractorEik && set.has(c.contractorEik))
      seen.set(c.contractorEik, c.contractorName || c.contractorEik);
  }
  return [...seen.entries()].map(([eik, name]) => ({ eik, name }));
}

// --- Multi-thread search edits (§0f.2) -------------------------------------
// Pure transforms over the search-thread array; the screen wraps each in
// mutateSpec. Kept here so the load-bearing invariants (keep-other-fields,
// ignore-blank, never-drop-the-last) are unit-testable without the DOM.

/** Replace thread i's terms, preserving its other fields (distinctive,
 *  threshold, buyerEik). A blank/whitespace commit is ignored — a thread must
 *  keep some terms; use withoutThread to drop it. */
export function withThreadTerms(
  threads: readonly SearchThread[],
  i: number,
  terms: string,
): SearchThread[] {
  const t = terms.trim();
  if (!t) return [...threads];
  return threads.map((th, idx) => (idx === i ? { ...th, terms: t } : th));
}

/** Append a new (terms-only) thread; a blank add is ignored. */
export function withAddedThread(
  threads: readonly SearchThread[],
  terms: string,
): SearchThread[] {
  const t = terms.trim();
  return t ? [...threads, { terms: t }] : [...threads];
}

/** Drop thread i — but never the last one (an empty `search` parses to a null
 *  spec, i.e. an unresolvable file). */
export function withoutThread(
  threads: readonly SearchThread[],
  i: number,
): SearchThread[] {
  return threads.length > 1
    ? threads.filter((_, idx) => idx !== i)
    : [...threads];
}
