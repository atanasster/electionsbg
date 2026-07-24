// Shared selectors over a declarant's filing history.
//
// A Court-of-Audit declarant files several KINDS of declaration. Only some of
// them carry the asset tables:
//
//   Annualy       годишна        — the full asset picture
//   Entry         при встъпване  — the full asset picture, on taking office
//   Vacate        при напускане  — the full asset picture, on leaving office
//   Other         несъвместимост — part II only: interests, NO asset tables
//
// So "the declarant's latest filing" and "the declarant's latest declared
// wealth" are different questions, and four consumers used to conflate them by
// taking `declarations[0]` for both. Because an `Other` filing legitimately has
// no assets, that answered the wealth question with an empty row whenever the
// most recent filing happened to be one — which measured at 421 of 1495
// executive officials (28%) and 114 municipal ones. Their profiles rendered no
// wealth block at all, and 525 of them ranked at €0 on the public leaderboard.
//
// Keep both questions, answer each with its own selector.

import type {
  MpAsset,
  MpIncomeRecord,
  MpOwnershipStake,
} from "@/data/dataTypes";

/** The subset of a declaration these selectors need. Structural on purpose, so
 *  the MP (`MpDeclaration`) and officials (`OfficialDeclaration`) shapes and the
 *  Postgres-served payload all satisfy it without a conversion. */
export type DeclarationLike = {
  declarationYear: number;
  fiscalYear?: number | null;
  /** Registry filing date, ISO. Absent on a good share of the corpus. */
  filedAt?: string | null;
  /** Registry entry number ("Г3810", "В998"). A last-resort ordering rung: its
   *  prefix encodes the form, not the sequence — see byRecency. */
  entryNumber?: string | null;
  /** Annualy | Entry | Vacate | Other. Orders filings that share a date, by
   *  what each one describes — see filingOrder. */
  declarationType?: string | null;
  /** Unique per filing; the terminal ordering tie-break and the dedup key. */
  sourceUrl: string;
  assets?: MpAsset[];
  income?: MpIncomeRecord[];
  ownershipStakes?: MpOwnershipStake[];
};

/** The most recent filing satisfying `carries`.
 *
 *  Each section of a profile has to ask this separately, because the filing
 *  KINDS carry different tables: an incompatibility filing has interests but no
 *  assets, and an exit filing may have assets but no income. Answering all of
 *  them with one "latest" is what produced both the empty wealth blocks and,
 *  when over-corrected, missing income on the pages that did render.
 *
 *  Expects `declarations` newest-first — every producer writes them that way
 *  (`mergeDeclarations` sorts by recency; the MP writer sorts on write). Callers
 *  that build their own array must sort before calling. */
export const latestDeclarationWith = <T extends DeclarationLike>(
  declarations: readonly T[],
  carries: (d: T) => boolean,
): T | null => declarations.find(carries) ?? null;

/** Does this filing carry an asset picture at all?
 *
 *  Deliberately narrow: table-10/11 ownership stakes are NOT counted here even
 *  though the MP net-worth basis values them, because a filing that declares
 *  only interests is an incompatibility filing — it has no wealth statement to
 *  show. Stakes get their own selector below. */
export const hasDeclaredAssets = (d: DeclarationLike | undefined): boolean =>
  (d?.assets?.length ?? 0) > 0;

/** Does this filing put a NUMBER on anything? The stronger test, and the one
 *  `latestAssetDeclaration` tries first.
 *
 *  `hasDeclaredAssets` asks only whether an asset ROW exists, and the parser
 *  emits a row for a blank table line — so an incompatibility filing can carry a
 *  single `bank` row with no value and no description and still pass. Of 4,895
 *  Other filings only 450 have asset rows, and 449 of those 450 have not one
 *  valued row (against 359/28,835 for annuals): an Other filing with rows is
 *  essentially always a shell. Treating that shell as an asset picture let it
 *  outrank a real annual — it is newer, and an annual's `filedAt` is sometimes
 *  null — and publish €0 for someone who had declared six figures. */
export const hasValuedAssets = (d: DeclarationLike | undefined): boolean =>
  (d?.assets ?? []).some((a) => (a.valueEur ?? 0) > 0);

export const hasDeclaredIncome = (d: DeclarationLike | undefined): boolean =>
  (d?.income ?? []).some(
    (r) => (r.amountEurDeclarant ?? 0) !== 0 || (r.amountEurSpouse ?? 0) !== 0,
  );

export const hasDeclaredStakes = (d: DeclarationLike | undefined): boolean =>
  (d?.ownershipStakes?.length ?? 0) > 0;

/** The most recent filing that actually declares assets — the wealth snapshot.
 *
 *  NOT the page's existence anchor: 1,199 municipal and 46 executive declarants
 *  have filings but no asset tables anywhere in their history, and they still
 *  have a profile, a filing list, procurement links and council activity. Use
 *  `declarations[0]` for "does this person exist / what is their newest
 *  filing", and this only for "what are they worth".
 *
 *  Two passes, not one predicate: prefer the latest filing that VALUES something,
 *  and only if the person has never valued anything fall back to the latest that
 *  merely has asset rows. The fallback is what keeps the 359 annuals whose assets
 *  are all unvalued (unvalued real estate is a real pattern, reported as a caveat
 *  rather than treated as absence) from losing their wealth block entirely. Kept
 *  in lockstep with person_wealth_year's ORDER BY in
 *  scripts/db/schema/pg/090_person_wealth.sql, which ranks the same two tiers in
 *  the same order — if these drift, a person's profile and the leaderboard quote
 *  different net worths for the same year. The matview's PARTITION key must equal
 *  this sort's leading rung (`declarationPeriod`) for the same reason: partition on
 *  one year and rank on another and the matview's newest point stops being this
 *  selector's answer, which measured at 269 declarants when tried. */
export const latestAssetDeclaration = <T extends DeclarationLike>(
  declarations: readonly T[],
): T | null =>
  latestDeclarationWith(declarations, hasValuedAssets) ??
  latestDeclarationWith(declarations, hasDeclaredAssets);

/** The year a filing SPEAKS FOR — the period it covers, not the year it was filed.
 *
 *  The two are different fields and they routinely disagree. `declarationYear` is
 *  the filing year (parse_declaration.resolveDeclarationYear derives it as an
 *  annual's `fiscalYear + 1`, and as `fiscalYear` itself for Entry/Vacate);
 *  `fiscalYear` is the period the estate is stated as of. So an annual filed in
 *  May 2025 declares the estate at 31 Dec 2024 — filed 2025, covering 2024 — while
 *  an exit filing lodged in February 2025 declares it as of that February.
 *
 *  Every question a wealth figure answers is about the period, not the filing
 *  date: "what were they worth in 2024", "what changed between two snapshots",
 *  "which of two filings describes the later state of affairs". Publishing a net
 *  worth against a year therefore has to key on this, or the figure shown against
 *  2025 describes 2024.
 *
 *  The fallback matters: `fiscalYear` is null on 450 incompatibility filings, 267
 *  Entry and 8 Vacate filings, and on 15 annuals whose `<Year>` was unusable or
 *  implausible (resolveDeclarationYear refuses to believe those rather than
 *  inventing one). For Entry/Vacate the filing year IS the period, so the fallback
 *  is exact; for the handful of undated annuals it is off by one, which is the
 *  same error the whole series carried before and strictly rarer.
 *
 *  Kept identical to `COALESCE(fiscal_year, declaration_year)` in
 *  scripts/db/schema/pg/090_person_wealth.sql (and 096_stake_procurement.sql,
 *  which already dates a declared shareholding this way). */
export const declarationPeriod = (d: DeclarationLike): number =>
  d.fiscalYear ?? d.declarationYear;

/** The filing to compare the snapshot against: the next asset-bearing filing
 *  that covers a DIFFERENT period.
 *
 *  Comparing on `declarationYear` alone is not enough — an official who files an
 *  annual and an exit declaration in the same calendar year has two rows sharing
 *  a `declarationYear`, and differencing them yields a meaningless "+€0 vs 2023"
 *  on a card already headlined 2023. The fiscal year is what actually differs
 *  (2022 → 2023), so key on that and fall back to the filing year. */
export const priorAssetDeclaration = <T extends DeclarationLike>(
  declarations: readonly T[],
  latest: DeclarationLike | null,
): T | null => {
  if (!latest) return null;
  const latestPeriod = declarationPeriod(latest);
  return (
    declarations.find(
      (d) =>
        d !== latest &&
        hasDeclaredAssets(d) &&
        declarationPeriod(d) !== latestPeriod,
    ) ?? null
  );
};

/** Where a filing sits within a single day, by what it describes.
 *
 *  Two filings routinely share a date — an official leaving office files their
 *  exit declaration alongside the annual for the year just ended. Neither the
 *  date nor the registry entry number can order those: the entry number's
 *  prefix encodes the FORM (Г = annual, Ф = entry/exit), not the sequence, so
 *  sorting on it is arbitrary dressed up as chronology.
 *
 *  What does order them is what each one states. An exit declaration is the
 *  last thing filed in a tenure and describes the position at its end; an entry
 *  declaration is the first and describes the position at its start; an annual
 *  sits between, describing the fiscal year just closed.
 *
 *  Not cosmetic. Ивелина Дундакова's exit filing (4 properties, 2 vehicles, 2
 *  accounts, 1 debt → +€52,270) lost the entry-number tie-break to a 3-row
 *  annual covering only two accounts and the same debt, so her published net
 *  worth was −€79,546. 100 declarants had the same shape. */
const FILING_ORDER: Record<string, number> = {
  Vacate: 3,
  Annualy: 2,
  Other: 1,
  Entry: 0,
};

const filingOrder = (d: DeclarationLike): number =>
  FILING_ORDER[d.declarationType ?? ""] ?? 1;

/** Newest-first ordering for a filing history — the ONE definition.
 *
 *  Every producer and consumer must agree on it, because "the latest filing" is
 *  literally the head of this sort. It lived only in scripts/officials/merge.ts
 *  until a second copy in the client dropped the `entryNumber` rung; annual
 *  (Г…) and entry/vacate (Ф…) filings routinely share a year with a null
 *  `filedAt`, so that rung is what actually decides the winner. The result was
 *  32 declarants showing one net worth on /person and a different one on
 *  /officials, up to 4.8x apart.
 *
 *  THE LEADING RUNG IS THE PERIOD COVERED, NOT THE YEAR FILED. "Newest" here
 *  means "describes the most recent state of affairs" — that is the only sense in
 *  which one wealth statement supersedes another. Ranking on `declarationYear`
 *  instead let a filing that covers an EARLIER period win purely by being lodged
 *  later, because an annual for fiscal N is filed the following May while an exit
 *  filing for fiscal N+1 is lodged in-year:
 *
 *    Лучия Александрова Добрева, both filings dated 2025
 *      Vacate  · covers 2025 · filed 2025-02-18 · 12 valued rows · net +€382,272
 *      Annualy · covers 2024 · filed 2025-06-13 ·  3 valued rows · net −€274,784
 *
 *  On `filedAt` the fiscal-2024 annual wins, so her published 2025 net worth was
 *  −€274,784 — a figure that describes 2024, on a card headlined 2025, for a named
 *  public figure. 877 person-years were represented by a filing covering an
 *  earlier period than another filing available for the same year.
 *
 *  `filedAt` keeps the next rung and is still the right tie-break WITHIN a period:
 *  an annual closes the calendar year and is filed after any entry/exit lodged
 *  during it, so the later-filed of two same-period filings is the later snapshot.
 *
 *  `sourceUrl` is the terminal tie-break: opaque, but unique and stable, so the
 *  order is deterministic across runs and renders. */
export const byRecency = (a: DeclarationLike, b: DeclarationLike): number =>
  declarationPeriod(b) - declarationPeriod(a) ||
  (b.filedAt ?? "").localeCompare(a.filedAt ?? "") ||
  filingOrder(b) - filingOrder(a) ||
  (a.entryNumber ?? "").localeCompare(b.entryNumber ?? "") ||
  a.sourceUrl.localeCompare(b.sourceUrl);

export type DeclarationTotals = {
  assetsEur: number;
  debtsEur: number;
  netEur: number;
  /** Real-estate rows with no declared value — the denominator caveat for any
   *  net-worth figure, since an unvalued property counts as €0. */
  realEstateUnvalued: number;
};

/** Net worth = every non-debt category summed, minus `debt`.
 *
 *  Used by the person profile and the officials profile. The two leaderboard
 *  generators keep their own arithmetic for now — `scripts/officials/index.ts`
 *  also counts real-estate rows, and `build_assets_rankings.ts` folds in
 *  table-10 stake values that this does not — so they are NOT yet unified.
 *  Collapsing all three onto one basis is Tier 2 work, once the declarations
 *  live in Postgres and there is a single serving payload to compute from. */
export const declarationTotals = (
  assets: readonly MpAsset[] | undefined,
): DeclarationTotals => {
  let assetsEur = 0;
  let debtsEur = 0;
  let realEstateUnvalued = 0;
  for (const a of assets ?? []) {
    const v = a.valueEur ?? 0;
    if (a.category === "debt") debtsEur += v;
    else assetsEur += v;
    if (a.category === "real_estate" && a.valueEur == null)
      realEstateUnvalued++;
  }
  return {
    assetsEur,
    debtsEur,
    netEur: assetsEur - debtsEur,
    realEstateUnvalued,
  };
};
