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

/** Ceiling on a single declared ASSET row's euro value. Rows above it are excluded from
 *  every wealth total, in both the SQL layer (asset_row_ceiling_eur() in
 *  090_person_wealth.sql, which is the authority) and the JSON builders that still write
 *  data/officials and data/parliament.
 *
 *  Exactly one row in the corpus exceeds it: a "ипотечен кредит" — a MORTGAGE, i.e. a
 *  liability — filed in the SECURITIES table at 7,001,070,875 BGN (€3.58bn). It made that
 *  person #1 on /officials/assets by a factor of 326 over the next entry, on an indexed,
 *  prerendered page. The amount is wrong AND the category is wrong, so no override can
 *  restore what was meant; excluding the row is the only honest option.
 *
 *  ASSETS ONLY. Excluding an asset understates wealth (cautious, and visible as a €0);
 *  excluding a DEBT would overstate net worth — silently making someone look richer than
 *  they declared, which an accountability page must never do. The largest declared debt is
 *  already €47M, so a symmetric ceiling would be one filing from firing.
 *
 *  Keep this number equal to asset_row_ceiling_eur(). Two definitions of "implausible"
 *  drifting apart is how a page and its chart end up disagreeing. */
export const ASSET_ROW_CEILING_EUR = 50_000_000;

/** True when an asset row can be totalled — i.e. it is a debt (never capped) or its value
 *  is within the ceiling. */
export const withinAssetCeiling = (a: {
  category: string;
  valueEur: number | null;
}): boolean =>
  a.category === "debt" || (a.valueEur ?? 0) <= ASSET_ROW_CEILING_EUR;

/** Categories whose `share` column is an IDEAL PART (идеална част) of the thing valued.
 *
 *  `security` is deliberately absent and must stay absent: on the table-9/10 forms that
 *  column is a COUNT of дялове ("369 476"), not a fraction of anything. Weighting by it
 *  would multiply a shareholding by its own share count. */
const SHARE_WEIGHTED_CATEGORIES = new Set(["real_estate", "vehicle"]);

/** The declarant's fraction of an asset row, per the Сметна палата filing instructions.
 *
 *  ⚠️ THE DECLARED AMOUNT IS THE WHOLE PROPERTY, NOT THE DECLARANT'S SLICE. Column 11 of
 *  table 1: „Посочва се цената на придобиване на имота/правото В ЦЯЛОСТ, както е по
 *  съответния документ, БЕЗ ДА СЕ ДЕЛИ МЕЖДУ СЪСОБСТВЕНИЦИТЕ." Column 8 then requires each
 *  co-owner's part to be filed „самостоятелно на отделен ред" — its own row, repeating that
 *  same whole-property price — and only HOUSEHOLD members get a row (declarant, spouse,
 *  cohabiting partner, minor children). Tables 1.1/1.2 and the vehicle tables 3–3.4 all say
 *  „идентични с тези за Таблица 1", so the same rule governs them.
 *
 *  So `Σ valueEur` counts a jointly-held property once PER CO-OWNER. Measured 2026-08-15,
 *  before this: a villa declared by two spouses at 1/2 each put €30.85m on /officials/assets
 *  for a €15.4m holding, and the executive tier over-stated by €202m (14.9%). Weighting is
 *  right in all three configurations the form produces — 1/2 + 1/2 recovers the whole once,
 *  1/1 is unchanged, and a 1/2 held with a NON-household co-owner (who gets no row, so
 *  nothing else can restore the other half) correctly contributes half.
 *
 *  Returns 1 for anything not an unambiguous proper fraction, which is the pre-2026-08-15
 *  behaviour and the safe direction — the column is free text with ~3,200 distinct literals.
 *  „СИО" (marital community: the household owns the whole), „по 1/2", „1/2-1/2" and „1/2+1/2"
 *  (both co-owners' halves written on ONE row) all correctly land here rather than halving a
 *  row that already represents the whole. Bare integers are refused too: „50" is unreadable
 *  as either a percentage or an ideal part, and „0" would zero a real asset.
 *
 *  Keep this equal to asset_share_multiplier() in 090_person_wealth.sql — see
 *  declarations.share.test.ts, which runs both over the corpus. */
export const assetShareMultiplier = (a: {
  category: string;
  share?: string | null;
}): number => {
  if (!SHARE_WEIGHTED_CATEGORIES.has(a.category)) return 1;
  const raw = a.share;
  if (typeof raw !== "string") return 1;
  const t = raw
    .toLowerCase()
    .replace(/ид\.\s*ч\.|идеална\s+част/g, "")
    .trim();

  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (frac) {
    const n = Number(frac[1]);
    const d = Number(frac[2]);
    return d > 0 && n > 0 && n < d ? n / d : 1;
  }
  const pct = /^(\d+(?:[.,]\d+)?)\s*%$/.exec(t);
  if (pct) {
    const v = Number(pct[1].replace(",", "."));
    return v > 0 && v < 100 ? v / 100 : 1;
  }
  const dec = /^0[.,](\d+)$/.exec(t);
  if (dec) {
    const v = Number(`0.${dec[1]}`);
    return v > 0 && v < 1 ? v : 1;
  }
  return 1;
};

/** An asset row's contribution to a wealth total: its value, reduced to the declarant's
 *  ideal part. Use this instead of reading `valueEur` directly wherever rows are summed. */
export const assetWeightedEur = (a: {
  category: string;
  share?: string | null;
  valueEur: number | null;
}): number => (a.valueEur ?? 0) * assetShareMultiplier(a);

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

/** The income rows worth showing, and the two per-person totals.
 *
 *  ⚠️ THERE IS DELIBERATELY NO COMBINED TOTAL, and callers must not add the two together.
 *  Table 12 of the declaration („Годишна данъчна основа") has one column for the declarant
 *  and one for their spouse — two PEOPLE, not two halves of one figure. Both surfaces used
 *  to print `declarant + spouse` as a single number, so Илияна Йотова's profile announced
 *  EUR 163,255 where her declared income is EUR 104,975 and the balance is her spouse's; the
 *  press quoted 104,975 off the same filing and was right. Returning the totals as separate
 *  named fields, with no third field to reach for, makes the merge unrepresentable rather
 *  than merely fixed.
 *
 *  Note assets are a different editorial choice: net worth IS published as a household
 *  figure, disclosed by `mp_assets_source_note`. Only income is per-person.
 *
 *  The row filter is `!== 0`, matching `hasDeclaredIncome` above — a tax base can legitimately
 *  be NEGATIVE for a sole trader or business owner, and a `> 0` test drops those rows while
 *  the per-row table still renders them, so the summary would contradict the table beneath it. */
export const incomeTotals = <
  T extends {
    amountEurDeclarant?: number | null;
    amountEurSpouse?: number | null;
  },
>(
  rows: readonly T[],
): { rows: T[]; declarantEur: number; spouseEur: number } => {
  const kept = rows.filter(
    (r) => (r.amountEurDeclarant ?? 0) !== 0 || (r.amountEurSpouse ?? 0) !== 0,
  );
  return {
    rows: kept,
    declarantEur: kept.reduce((s, r) => s + (r.amountEurDeclarant ?? 0), 0),
    spouseEur: kept.reduce((s, r) => s + (r.amountEurSpouse ?? 0), 0),
  };
};

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

/** The two form tables that record something the declarant USES rather than owns.
 *
 *  1.2 „Чуждо недвижимо имущество" and 3.4 „Чужди моторни сухопътни, водни и
 *  въздухоплавателни превозни средства" — property and vehicles belonging to somebody
 *  else, rented or provided. Canonical (2018-form) numbers; see MpAsset.tableNum. */
const NON_HOLDING_TABLES = new Set(["1.2", "3.4"]);

/** Is this row part of the declarant's estate?
 *
 *  The register's own headers are what decide it: tables 1.2 / 3.4 price their rows
 *  „Цена по договор" under „Правно основание за ползване", where tables 1 / 3 say „Цена на
 *  придобиване" / „…за придобиване". So the number beside a чуждо row is what the USE
 *  costs — not a value the declarant holds, and not a figure any net worth may include.
 *
 *  Neither `category` nor `legalBasis` can stand in for this. A rented flat is still
 *  real_estate, and Пеевски's чужди cars carry legalBasis „договор" — which is also what
 *  Румен Радев's OWN car carries.
 *
 *  A NULL tableNum is a HOLDING. Rows parsed before the provenance existed carry none, and
 *  reading them as non-holdings would drop every real asset from every total at once.
 *
 *  Keep this equal to is_declared_holding() in 089_declarations.sql — see
 *  declarations.holding.test.ts, which runs both over the corpus. */
export const isDeclaredHolding = (a: { tableNum?: string | null }): boolean =>
  !NON_HOLDING_TABLES.has(a.tableNum ?? "");

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
    // Чуждо rows (tables 1.2 / 3.4) reach neither side of the balance and are not
    // counted as an unvalued caveat either — they are not this person's property at
    // all, so their absence from the total is not a gap in it.
    if (!isDeclaredHolding(a)) continue;
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

/**
 * Compare a holder name to the declarant's. The declaration form names, per row,
 * who holds the thing — „Собственик или титуляр на правото" — and that person is
 * frequently NOT the declarant.
 *
 * THE MEASURED SPLIT LIVES HERE AND NOWHERE ELSE. Re-measured 2026-09-05 over 18,569
 * `declaration_stake` rows, under THIS fold:
 *
 *     4,683  held by someone other than the declarant   (46.8% of named holders)
 *     5,315  held by the declarant                      (53.2%)
 *     8,571  naming nobody — 8,563 blank, and 8 whose cell has no LETTERS
 *
 * (Was 4,814 / 5,184 under the separator-only fold, measured 2026-08-19. The token
 * passes moved 131 rows, all toward „the declarant" — which is this block's own point,
 * so the correction strengthens the argument rather than weakening it.)
 *
 * ⚠️ Do not quote a raw `holder_name <> declarant_name` count. That reports
 * 5,386 / 4,620 and INVERTS the conclusion — it makes „somebody else" look like the
 * majority when the fold puts the declarant there. The 572-row gap between the two
 * is this normalisation doing its job. Three source files carried the raw pair as
 * the feature's rationale before anyone re-measured it; that is why the numbers now
 * sit on the rule itself and the call sites point here instead of restating them.
 *
 * ⚠️ COVERAGE LIMIT. Only `stake_kind = 'share'` / table-10 rows carry a holder at
 * all — every `role`, `sole_trader` and table-11 row in the corpus has a blank one
 * (they are the 8,563 above), so this short-circuits on them. A spouse's
 * DIRECTORSHIP is therefore not markable by this rule, and „Дялове в дружества"
 * gives a reader no hint of the asymmetry.
 *
 * ONE definition, shared by the parser (which stores it on `declaration_asset`
 * as `is_spouse`) and by the renderer (which has no such column on
 * `declaration_stake` and must derive it from `holderName` + `declarantName`).
 * Copying the fold is how the two sides come to disagree about whose company a
 * row describes — and on a stake row that disagreement publishes a named
 * individual's spouse's company as their own. Changing it desyncs the renderer from
 * the stored column until a re-stamp + reload, so it is never a drive-by edit.
 *
 * The re-stamp is `scripts/declarations/backfill_asset_is_spouse.ts`, then
 * `db:load:declarations:pg` phase 1 and phase 2 — and note the shape that makes THIS
 * rule cheaper to change than its neighbours in 089. `table_num`, `value_basis` and
 * `held_scope` are recoverable only from the source XML, so each needs a re-parse
 * that matches rows positionally and can refuse a shard. This is a pure function of
 * two fields the shard already carries, so the backfill reads only the shards and has
 * no mismatch class. Proof it stayed in step: the stored column was reproducible from
 * `holder_name` + `declarant_name` for 335,676 of 335,676 rows under the separator-only
 * rule, and again after each widening. The separator pass moved 563 rows and the
 * letters-free guard a further 30, leaving 110,242 marked; the token passes added by
 * docs/plans/declaration-holder-self-fold-v1.md clear ~8,000 more.
 *
 * ⚠️ Named `spouse` for the form's dominant case, but all it proves is „not the
 * declarant": a minor child's holdings are reported on the same form. The stake row
 * shows `holderName` for that reason, and so does every asset-side surface: they all
 * render `HolderChip` (src/screens/person/HolderChip.tsx), which prints the register's
 * own holder NAME where there is one and „друг титуляр" where there is not. Seven sites
 * used to print „съпруг/а" instead — `PersonDeclarations` (×2), `PersonHeldAbroad`,
 * `PersonCryptoHoldings`, `MpAssetsSummary`, `MpCarsScreen`, `CryptoRegistryScreen` and
 * `CandidateAssetsScreen` — and on `/mp-cars` and `/declarations/crypto` it was the VALUE
 * of a column headed „Притежател", i.e. a claim about a named MP's family that this rule
 * cannot support.
 *
 * `mp_cars`, `person_crypto_table` and `person_abroad_table` now all select `holder_name`
 * too (docs/plans/declaration-holder-self-fold-v1.md T0), so every surface that renders
 * this flag can print the register's own text instead of the neutral label — which
 * matters most here, since a false flag on one of those three degrades from an
 * unqualified „не е негово/нейно" into a visible typo beside a public figure's own name.
 */
export const normHolderName = (s: string | null): string =>
  (s ?? "")
    // NFC first, because `lettersOnly` below strips \p{M} and a DECOMPOSED „й" (и +
    // U+0306) would lose its breve and fold equal to „и" — reattributing a real third
    // party's row to the declarant, the one direction this rule must never fail in.
    // 0 rows in the corpus are non-NFC today, so it lands as a no-op; this repo has
    // already been burned on the same й→и NFD axis in `councilNameKey`.
    .normalize("NFC")
    .toUpperCase()
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();

/** The same name with every separator removed — the second pass `isSpouseHolder`
 *  falls back to. Deliberately NOT folded into `normHolderName`, which stays the
 *  display-shaped normalisation: this form is unreadable and is only ever compared. */
const lettersOnly = (s: string): string => s.replace(/[^\p{L}]/gu, "");

/** Latin letters that are visually identical to a BULGARIAN Cyrillic one, uppercase.
 *
 *  The register is typed on a keyboard that switches layouts, so a name otherwise
 *  spelled in Cyrillic picks up one Latin letter: „Aлександър" (Latin A), „ПETKO"
 *  (Latin E, T, K, O). Those compare unequal to the declarant's own Cyrillic spelling
 *  and publish the declarant's own row as somebody else's — 61 asset rows across 22
 *  people, measured 2026-09-03.
 *
 *  ⚠️ STRICTLY VISUAL CONFUSABLES, AND STRICTLY BULGARIAN ONES. Unicode also confuses
 *  Latin I/J/S with Cyrillic І/Ј/Ѕ, but those three letters are not in the Bulgarian
 *  alphabet, so mapping onto them can never make two Bulgarian names compare equal —
 *  they were in this table and measured 0 folds. Latin N is not a confusable at all
 *  (Cyrillic И is a MIRRORED N; the letter that looks like Latin N is Cyrillic Н, which
 *  H already covers), so mapping N→И was a transliteration rule wearing a confusables
 *  label. Both classes are out: a fold is only defensible here because the two spellings
 *  are indistinguishable on the page.
 *
 *  ⚠️ FOR COMPARISON ONLY. The stored `holder_name` keeps the register's own bytes:
 *  it is what HolderChip prints, and „correcting" a public register's text at rest is
 *  a different (and unasked-for) claim.
 *
 *  `translit_bg_latin()` in 000_search_fns.sql carries a confusables table for the
 *  search side, but in the Cyrillic→Latin direction, so it is not reusable here. If a
 *  future change gives it both directions, collapse the two. */
const LATIN_TO_CYRILLIC: Record<string, string> = {
  A: "А",
  B: "В",
  C: "С",
  E: "Е",
  H: "Н",
  K: "К",
  M: "М",
  O: "О",
  P: "Р",
  T: "Т",
  X: "Х",
  Y: "У",
};
const deHomoglyph = (s: string): string =>
  [...s].map((c) => LATIN_TO_CYRILLIC[c] ?? c).join("");

/** Tokens that DECORATE a name without naming anybody: a title, a legal-basis note, a
 *  role, a connective. Stripped from BOTH sides before the token-level comparisons.
 *
 *  ⚠️ AN ALLOWLIST, NEVER A HEURISTIC, and the difference is the whole safety argument.
 *  „Does the surplus look like a name?" mis-folds three corpus cells that name a real
 *  second person whose surname the declarant shares — „Айрие Ибрямова, Алис Ремзиева"
 *  (surplus [АЛИС]), „Виктор Стоянов, Цветомир Стоянов" ([ЦВЕТОМИР]), „Борислав Божинов
 *  Чалъков, Драгомир Божинов Чалъков" ([ДРАГОМИР]). One unknown token is enough to name
 *  a person, so anything not on this list refuses the fold and the row stays marked.
 *
 *  ⚠️ NO BARE SINGLE CYRILLIC LETTER except the two prepositions „В" and „И" — which are
 *  themselves among the most common Bulgarian initials (Васил, Веселин; Иван, Илия).
 *  Measured, no corpus verdict depends on them: an initial eaten here re-routes through
 *  T3 and lands on the same answer. Do not add a third. „Г" was on this list during
 *  development (as the „г." year abbreviation) and it silently ate the middle INITIAL out
 *  of „дирк йохан г пергот" — 70 of the 75 rows the initial rule exists for.
 *
 *  Digits never reach here: `tokenize` strips non-letters per token and drops what is
 *  left empty, so „през 2021" contributes only „ПРЕЗ". */
const DECORATION_TOKENS = new Set([
  // legal form / status of the holding, not a holder
  "СИО",
  "ЗП",
  "ЕТ",
  "ИД",
  "ЧАСТ",
  "ЧАСТИ",
  "ИДЕАЛНА",
  "ИДЕАЛНИ",
  "НАСЛЕДСТВО",
  "ДАРЕНИЕ",
  "ПРЕЗ",
  "ГОДИНА",
  // the declarant's role in the transaction, not a second party
  "СЪКРЕДИТОР",
  "СЪДЛЪЖНИК",
  "ПРОДАВАЧ",
  "КУПУВАЧ",
  "ДАРИТЕЛ",
  "СОБСТВЕНИК",
  "СОБСТВЕНОСТ",
  // connectives
  "В",
  "НА",
  "ОТ",
  "ПО",
  "ЗА",
  "И",
]);

/** Titles the register prints BEFORE a name, strippable in LEADING POSITION ONLY.
 *
 *  ⚠️ „ДР" IS WHY THIS SET EXISTS SEPARATELY. `tokenize` reduces a token to its letters,
 *  so the title „д-р" and the abbreviation „др." („други" — AND OTHERS) both arrive as
 *  `ДР`. On the general allowlist that made „Калоян Емилов Методиев и др." strip to
 *  exactly the declarant's own tokens and fold — publishing a holding the register says
 *  is shared as solely his. That is worse than the defect this rule set out to fix: it
 *  does not mislabel a holder, it ERASES one the register named. A title only ever
 *  precedes the name; „и др." only ever trails it. */
const LEADING_TITLES = new Set(["АДВ", "ДР", "ПРОФ", "ДОЦ", "ИНЖ", "АРХ"]);

/** „и др." / „и други" — the cell names holders it does not spell out.
 *
 *  A boolean cannot say „the declarant AND someone unnamed", so this refuses the whole
 *  fold rather than letting any allowlist entry reach it. Belt and braces beside
 *  `LEADING_TITLES`: the position rule already stops today's corpus row, and this stops
 *  a future one that writes the marker somewhere else in the cell.
 *
 *  ⚠️ `(?![\p{L}\p{N}])` with the `u` flag, never `\b` — `\b` is ASCII-only and never
 *  matches after a Cyrillic letter (the same trap `tender_subcontracting` records). */
const NAMES_UNLISTED_OTHERS = /(?:^|[\s,])И\s*ДР(?![\p{L}\p{N}])/u;

/** Whitespace-separated name tokens, each reduced to its letters.
 *
 *  Splits on whitespace ONLY: `normHolderName` has already glued „X - Y" into „X-Y", and
 *  keeping a double-barrelled surname as one token is what makes „Тенова-Илчевска"
 *  compare equal to „Тенова - Илчевска". The per-token letters-only pass then drops the
 *  hyphen itself, so both sides reach „ТЕНОВАИЛЧЕВСКА". */
const tokenize = (norm: string): string[] =>
  norm.split(/\s+/).map(lettersOnly).filter(Boolean);

const stripDecoration = (tokens: string[]): string[] => {
  const withoutTitle =
    tokens[0] !== undefined && LEADING_TITLES.has(tokens[0])
      ? tokens.slice(1)
      : tokens;
  return withoutTitle.filter((t) => !DECORATION_TOKENS.has(t));
};

/** The last token that is part of the NAME.
 *
 *  ⚠️ NOT `tokens[tokens.length - 1]`. T4/T5/T6 run on RAW tokens (see there), so a
 *  trailing „в СИО" / „наследство" pushes the family name out of final position — which
 *  silently turned T5's masculine/feminine carve-out OFF without changing a single name
 *  token, folding the 270-row residue the plan deliberately keeps marked. 0 corpus rows
 *  hit it, but 1,442 rows already carry a trailing note of exactly that kind. */
const lastNameToken = (tokens: string[]): string | undefined => {
  const named = stripDecoration(tokens);
  return named[named.length - 1];
};

const multiset = (tokens: string[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
};

/** Is every token of `small` present in `big`, counting repeats? */
const containsAll = (
  big: Map<string, number>,
  small: Map<string, number>,
): boolean => {
  for (const [k, v] of small) if ((big.get(k) ?? 0) < v) return false;
  return true;
};

/** Levenshtein distance. Names more than ONE apart in LENGTH cannot be one edit apart, so
 *  they are rejected without building the matrix — the only caller asks `=== 1`. Nothing
 *  is capped: past the prefilter the real distance is returned. */
const editDistance = (a: string, b: string): number => {
  if (Math.abs(a.length - b.length) > 1) return Number.MAX_SAFE_INTEGER;
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return row[b.length];
};

/** The one token that differs, when the two names are the same length and everything
 *  else matches by VALUE. Returns null when zero or more than one token is unmatched.
 *
 *  Matching by value rather than by position is deliberate: it is what lets „Деница С.
 *  Славкова" pair its „С" against „Спасова" without assuming the two names put their
 *  tokens in the same order. */
const soleDifferingPair = (
  holder: string[],
  declarant: string[],
): [holderToken: string, declarantToken: string] | null => {
  if (holder.length !== declarant.length) return null;
  const rest = [...declarant];
  const unmatched: string[] = [];
  for (const t of holder) {
    const i = rest.indexOf(t);
    if (i >= 0) rest.splice(i, 1);
    else unmatched.push(t);
  }
  return unmatched.length === 1 && rest.length === 1
    ? [unmatched[0], rest[0]]
    : null;
};

/** Are these the masculine and feminine forms of ONE family name? „Петров"/„Петрова",
 *  „Марешки"/„Марешка". Order-independent: the caller has no idea which side is which.
 *
 *  ⚠️ NO „Я" ARM. „X" vs „X + я" is not a Bulgarian gender pair — the feminine of Петров
 *  is Петрова — and the arm was measured producing 9 rows of refusals over 5 name pairs
 *  of which ZERO were correct: „Борил Петров Петровя", „Валентин Василев Георгиевя",
 *  „Цанка михайлова Райковая". All stray-„я" typos of the declarant's OWN name, two of
 *  them glued onto an already-feminine name, each kept marked and published as somebody
 *  else's — the very defect this rule exists to end. The one case cited for the arm
 *  („Анели"/„Анелия") is a GIVEN name at position 0, where the carve-out never applies.
 *
 *  ⚠️ THE ADJECTIVAL FLIP IS SAME-LENGTH, so the shorter/longer split cannot see it and
 *  both directions must be tried. It is also not only „-ски": „-цки", „-чки", „-шки" and
 *  „-жки" all flip the same way, and pinning the literal „СКИ" folded „Марешки"/„Марешка"
 *  (2 corpus rows) while refusing „Стоянски"/„Стоянска" — the residue applied to one
 *  spelling of an ending and not its siblings, for no stated reason. */
const isGenderPair = (a: string, b: string): boolean => {
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (longer === `${shorter}А`) return true;
  const adjectival = (masc: string, fem: string): boolean =>
    masc.length > 2 && masc.endsWith("И") && fem === `${masc.slice(0, -1)}А`;
  return adjectival(a, b) || adjectival(b, a);
};

export const isSpouseHolder = (
  holderName: string | null,
  declarantName: string | null,
): boolean => {
  const h = normHolderName(holderName);
  const d = normHolderName(declarantName);
  // Both guards, and the second is the one that matters. With no declarant to compare
  // against, every non-blank holder compares unequal and EVERY row on the filing fires —
  // attributing the declarant's whole holding to unnamed third parties. Unreachable today
  // (`declaration.declarant_name` is NOT NULL and `DeclarationDetail.declarantName` is
  // `string`), but the parameter is nullable and the failure direction is „publish a claim
  // about who owns what", which is not a direction to fail open in.
  if (!h || !d) return false;
  if (h === d) return false;
  const hl = lettersOnly(h);
  const dl = lettersOnly(d);
  // A CELL WITH NO LETTERS NAMES NOBODY — „-", „.", „0", „91697", „*6", „(", a 255-char
  // run of „#". The blank guard above runs on the DISPLAY-shaped form, which keeps
  // punctuation and digits, so these passed it, compared unequal, and published „held by
  // someone else" against a named individual on their own page: 21 asset rows and 8 stake
  // rows, one of which rendered a chip whose entire text was „.".
  //
  // ⚠️ SYMMETRIC, and the declarant half is not hypothetical: two filings name the
  // declarant „0" and two name them „4", carrying 9 marked rows between them. Guarding
  // only the holder would leave those asserting „somebody else" on the strength of the
  // DECLARANT's typo — the same fail-open as `!d` above, one normalisation down.
  if (!hl || !dl) return false;
  // SEPARATOR + HOMOGLYPH PASS. The register is hand-typed, so a declarant naming
  // THEMSELVES loses a space („ПЕТКОАНГЕЛОВ КУЩИРЕВ", „Николай МихайловКолибаров"),
  // gains a hyphen where the register carries none („Димитриева - Николова" against
  // „Димитриева Николова"), or picks up one Latin look-alike letter („Aлександър").
  // `normHolderName` cannot reach any of them: it tidies the space AROUND a hyphen, not
  // a hyphen standing in for one, cannot invent a space that was never typed, and does
  // not know a Latin A from a Cyrillic one. Comparing letters-only + de-homoglyphed does.
  if (deHomoglyph(hl) === deHomoglyph(dl)) return false;

  // ── TOKEN-LEVEL PASSES ────────────────────────────────────────────────────────────
  // Everything below folds a name the declarant spelled a SECOND way on their own
  // filing. Each can only move a row OUT of „somebody else", never into it — so the
  // failure they risk is the opposite of the one they fix: a spouse's or a child's
  // property relabelled as the declarant's own, on a public figure's page. That is why
  // every rule here demands the whole rest of the name match exactly, why the two that
  // could otherwise reach a household member pin the GIVEN name, and why the one
  // single-edit shape with a two-person reading is refused outright.
  //
  // Plan, with the per-class corpus measurements: docs/plans/declaration-holder-self-fold-v1.md

  // A cell naming holders it does not spell out („X и др.") is the MIXED class, and no
  // pass below may reach it — see NAMES_UNLISTED_OTHERS.
  if (NAMES_UNLISTED_OTHERS.test(h)) return true;

  // De-homoglyphed so the tiers COMPOSE: without this a name carrying one Latin
  // look-alike plus any other variation („адв. Aлександър Стоянов Савов") passes the
  // whole-string homoglyph check unequal and then compares a Latin A against a Cyrillic
  // А token by token, so it can never reach T2-T6. 0 corpus rows fold because of this
  // today; it is here so the ladder behaves the way the plan describes it.
  const holderTokens = tokenize(h).map(deHomoglyph);
  const declarantTokens = tokenize(d).map(deHomoglyph);

  // T1/T2 — the same name once the decoration is gone: „адв. Борис Давидов Михайлов",
  // „Ангел Андреев Куртишев в СИО", „Георги Богданов Янев /дарение/". Stripped from BOTH
  // sides, because the title is on the DECLARANT in 355 of the corpus rows this covers
  // („д-р Али Вели Дурмушали" filed against a holder of „Али Вели Дурмушали"), and
  // stripping only the holder leaves every one of them marked. 1,101 asset rows.
  //
  // A cell that also names somebody else („Албена Иванова Михайлова и Милко Златков
  // Михайлов") keeps its surplus tokens here and stays unequal — which is the intended
  // refusal, not a gap. `is_spouse` is a boolean over a question with three answers and
  // „the declarant is ONE OF several holders" is not one of them.
  const strippedHolder = stripDecoration(holderTokens);
  const strippedDeclarant = stripDecoration(declarantTokens);
  if (
    strippedHolder.length > 0 &&
    strippedDeclarant.length > 0 &&
    strippedHolder.join("") === strippedDeclarant.join("")
  )
    return false;

  // T3 — the holder is a SHORTER form of the declarant's own name, i.e. a dropped middle
  // name: „Албена Туджарова" against „Албена Иванова Туджарова". 916 asset rows.
  //
  // ⚠️ THE GIVEN NAME IS PINNED, and that is what separates this from MOST household
  // members: a child's patronymic is the declarant's GIVEN name, so no child's FULL
  // three-token name is a token-subset of the parent's while also opening with the same
  // given name. Without the pin the rule also swallows two-token cells whose given name
  // was dropped („Димитрова Иванова" against „Искра Димитрова Иванова") — the same
  // person, but on weaker evidence, and only 2 rows; they stay marked.
  //
  // ⚠️ IT IS A MARGIN, NOT A PROOF, and the gap is this tier's DOMINANT shape: 866 of
  // the 1,308 folded rows have a TWO-token holder („given + family"). A son named after
  // his father writes exactly that, and it is a strict subset opening with the same
  // given name — indistinguishable from the declarant's own short form. What carries the
  // fold is that Bulgarian juniors are uncommon (the convention names a son after the
  // GRANDfather), and that is the whole safety margin. Do not widen this tier, and do
  // not drop the pin.
  if (
    strippedHolder.length >= 2 &&
    strippedHolder.length < strippedDeclarant.length &&
    strippedHolder[0] === strippedDeclarant[0] &&
    containsAll(multiset(strippedDeclarant), multiset(strippedHolder))
  )
    return false;

  // T4/T5/T6 run on the RAW tokens, NOT the decoration-stripped ones. Decoration removal
  // is not a prerequisite for them, and it actively hurts: the allowlist would have to
  // contain single letters to be useful here, and a single letter in a name position is
  // an initial far more often than an abbreviation.
  //
  // ⚠️ ALL THREE REQUIRE AT LEAST TWO TOKENS, and that is the load-bearing half of their
  // safety argument rather than a detail. Every one of them rests on „the rest of the
  // name matches exactly" — with a single token there IS no rest, so the premise is
  // vacuously true and the rule degenerates into „two names one letter apart are the
  // same person". „ЙОРДАНОВ" against „ИОРДАНОВ" is one edit and two different surnames.
  //
  // ⚠️ A CHILD'S NAME CAN BE A ROTATION OF THE PARENT'S, and the refusal below is what
  // keeps that out. Under the triple-GIVEN-name convention this corpus uses heavily
  // („Айдоан Али Муталиб", „Нуршен Халил Исмаил") a name is [own, father's, grandfather's],
  // so a child is P = [p, f, g] → S = [s, p, f]: two of three tokens shared, and
  // `soleDifferingPair` matches by VALUE rather than position, so it happily returns
  // (s, g) for a parent and child. One-edit given-name variants are ordinary there
  // (Мехмед/Мехмет, Ахмед/Ахмет), so T5 would fold a father onto his son. 0 corpus rows
  // carry the signature — measured across all 2,051 T5 pairs — so refusing costs nothing.
  const isGenerationalRotation =
    holderTokens.length === 3 &&
    (holderTokens[1] === declarantTokens[0] ||
      declarantTokens[1] === holderTokens[0]);
  if (isGenerationalRotation) return true;

  if (
    holderTokens.length >= 2 &&
    holderTokens.length === declarantTokens.length
  ) {
    const pair = soleDifferingPair(holderTokens, declarantTokens);
    if (pair) {
      const [ht, dt] = pair;

      // T4 — an INITIAL where the other side writes the word: „Деница С. Славкова"
      // against „Деница Спасова Славкова". 75 rows over 3 name pairs, 70 of them one
      // person; the whole population fits on three lines and was checked by hand.
      if (
        (ht.length === 1 && dt.startsWith(ht)) ||
        (dt.length === 1 && ht.startsWith(dt))
      )
        return false;

      // T5 — ONE token differing by ONE edit, every other token identical: „Адалберт
      // Огнянав Йолов" against „Адалберт Огнянов Йолов". 4,632 rows, the largest class.
      //
      // ⚠️ It reads like the class this rule must never touch, because Петров/Петрова is
      // one edit and IS the spouse case. It is not, and the reason is structural: this
      // arm fires only when EVERY OTHER TOKEN IS IDENTICAL. For the Bulgarian
      // given/patronymic/family triple a spouse differs in all three tokens and a sibling
      // or child in two, so neither can present as one token off. That argument is about
      // THAT triple only — the triple-given-name convention escapes it through a
      // rotation, which `isGenerationalRotation` above refuses before this point.
      //
      // ⚠️ The guarantee is WEAKEST at exactly THREE tokens and gone below it, which is
      // why this arm alone floors at three. At two, „the rest of the name" is one given
      // name drawn from a pool of a few hundred, so „Ана Петрова" ⟂ „Яна Петрова" is one
      // edit and two sisters. 0 corpus rows have that shape, so the floor costs nothing.
      //
      // ⚠️ The one exception is a masculine/feminine pair on the LAST token — the only
      // single-edit shape with a reading in which two people are involved. 270 rows,
      // kept marked deliberately. The carve-out is the last token ONLY: a
      // gender-mismatched PATRONYMIC beside an unchanged given name („Августина
      // Веселинов Кайкова") is a dropped „а" (136 rows), and so is the given-name
      // variant „Анели"/„Анелия" (34). Applying it at every position keeps 440 rows
      // instead of 270 and buys nothing.
      //
      // ⚠️ Do NOT widen this to two edits or to a similarity score. At two edits a
      // spouse becomes reachable, and this is the tier where a wrong fold relabels a
      // household member's property as a public figure's own.
      if (holderTokens.length >= 3 && editDistance(ht, dt) === 1) {
        // Compared against the last NAME token of each side — `lastNameToken`, not
        // `tokens[length - 1]`. Two reasons: a trailing „в СИО" would otherwise push the
        // family name out of final position and turn this carve-out off (0 corpus rows,
        // but 1,442 rows carry such a note), and a name repeating a token („Иванов Иван
        // Иванов") would resolve a by-value lookup to the matched occurrence.
        const differsOnLastToken =
          lastNameToken(holderTokens) === ht &&
          lastNameToken(declarantTokens) === dt;
        if (!(differsOnLastToken && isGenderPair(ht, dt))) return false;
        return true;
      }
    }

    // T6 — the same tokens in another order: „Айдоан Али Муталиб" against „Айдоан
    // Муталиб Али". 68 rows over 23 name pairs, every one verified by hand.
    // (length >= 2 is guaranteed by the enclosing guard.)
    //
    // ⚠️ The given name is pinned, as in T3, and that keeps a family-name-first spelling
    // („Копринков Николай Иванов") out: nothing about that ordering proves it is the
    // declarant rather than a relative.
    //
    // ⚠️ THE PIN DOES NOT KEEP OUT A FATHER AND SON, which is why the repeated-token
    // refusal is here too. Under the triple-given-name convention, P named after his
    // GRANDfather is [p, f, p] and P's son named after P is [p, p, f] — same multiset,
    // same leading token, two people. A REPEATED token is that shape's signature, and
    // none of the 23 corpus pairs has one, so refusing it costs nothing.
    const hasRepeatedToken = new Set(holderTokens).size !== holderTokens.length;
    if (
      !hasRepeatedToken &&
      holderTokens[0] === declarantTokens[0] &&
      [...holderTokens].sort().join("|") ===
        [...declarantTokens].sort().join("|")
    )
      return false;
  }

  return true;
};
