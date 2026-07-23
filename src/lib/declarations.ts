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
  /** Registry entry number ("Г3810", "В998"). The rung that actually separates
   *  an annual from an entry/exit filing when both share a year and neither
   *  carries a filing date — see byRecency. */
  entryNumber?: string | null;
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
 *  filing", and this only for "what are they worth". */
export const latestAssetDeclaration = <T extends DeclarationLike>(
  declarations: readonly T[],
): T | null => latestDeclarationWith(declarations, hasDeclaredAssets);

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
  const period = (d: DeclarationLike) => d.fiscalYear ?? d.declarationYear;
  const latestPeriod = period(latest);
  return (
    declarations.find(
      (d) => d !== latest && hasDeclaredAssets(d) && period(d) !== latestPeriod,
    ) ?? null
  );
};

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
 *  `sourceUrl` is the terminal tie-break: opaque, but unique and stable, so the
 *  order is deterministic across runs and renders. */
export const byRecency = (a: DeclarationLike, b: DeclarationLike): number =>
  b.declarationYear - a.declarationYear ||
  (b.filedAt ?? "").localeCompare(a.filedAt ?? "") ||
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
