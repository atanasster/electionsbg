// keep.eu project JSON → InterregOperation + InterregPartner[].
//
// Tier T1 of docs/plans/interreg-funds-ingest-v1.md §8. Pure: it reads the raw
// cache shape and nothing else — no network, no Postgres, no filesystem. Place
// resolution is loader-side (§8), because Tiers L1/L2 read Postgres tables and
// an ingest that reached into PG would make the committed tree unreproducible
// from a fresh clone.
//
// THE ONE RULE THIS FILE ENFORCES: the operation total and the partner budget
// never mix. `total_budget` appears at BOTH levels in keep.eu's payload with the
// same name and completely different meaning — the operation's is the whole
// cross-border project, the partner's is that partner's own line. Attributing
// the former to a Bulgarian partner is the €2m-for-a-€300k-partner inversion the
// plan exists to prevent, and it is one careless destructure away.
//
// SILENT OUTCOMES: exactly one. A project belonging to a programme the curated
// register does not admit returns null with a one-per-programme warning.
// Everything else throws, because a corpus that quietly shrinks is the failure
// mode this whole plan is about — including a PRESENT-but-unparseable number,
// which must not be allowed to read as "the programme published nothing".

import { canonicalEik } from "../eik";
import { programmeFor, warnUnknownProgramme } from "./programmes";
import {
  INTERREG_PERIODS,
  isBulgarianPartner,
  type BudgetBasis,
  type InterregOperation,
  type InterregPartner,
  type InterregPeriod,
} from "./types";

/** The raw shape, only as far as we read it. keep.eu sends ~90 more fields. */
export interface KeepProjectRaw {
  id: number;
  project_id?: string | null;
  status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  total_budget?: string | number | null;
  eu_funding?: string | number | null;
  union_co_financing_rate?: string | number | null;
  programme?: {
    id: number;
    title?: string;
    period?: { title?: string } | null;
  } | null;
  translations?: Record<
    string,
    { name?: string | null; description?: string | null } | undefined
  > | null;
  partnerships?: KeepPartnershipRaw[] | null;
}

export interface KeepPartnershipRaw {
  id?: number | null;
  type?: string | null;
  legal_status?: string | null;
  organisation_type?: string | null;
  pic?: string | null;
  beneficiary_id?: string | null;
  town?: string | null;
  town_department?: string | null;
  postcode?: string | null;
  postcode_department?: string | null;
  location_address?: string | null;
  location_json?: { lat?: number | null; lng?: number | null } | null;
  total_budget?: string | number | null;
  co_financing_eur?: string | number | null;
  country_department?: { title?: string } | null;
  partner?: {
    id?: number | null;
    name?: string | null;
    country?: { title?: string } | null;
    translations?: Record<
      string,
      { name_translated?: string | null } | undefined
    > | null;
  } | null;
}

export class OperationParseError extends Error {}

/**
 * keep.eu's own internal partner code — `<ISO2><group><sequence>`, e.g.
 * `BG120000012`, `PT220000133`, `FR120000168`.
 *
 * It has to be rejected explicitly, because it is NOT a national identifier and
 * it is shaped exactly like one: strip the `BG` and `120000012` is nine digits,
 * which `canonicalEik` would happily accept.
 *
 * THE SEQUENCE IS SIX DIGITS, NOT TWO. The first version of this rule wrote
 * `0000\d{2}`, covering only codes 00-99 — Bulgaria's own sequence reaches just
 * 18 today, so it passed every test while PT, FR, ES and IT are already past
 * 100 in this same corpus. A rule calibrated to one country's current ceiling
 * expires silently.
 *
 * The collision is real, not theoretical: `BG120000012` appears on operation
 * 29209 (Община Смолян) and `120000012` is `tr_companies.uic` for
 * ПРИЗМА-46 - ВАСИЛ РАЙЧЕВ. Five more real companies sit in the band the
 * two-digit rule missed — 120000560 СЛЕЙ, 120000603 ОПТИК, 120000884
 * ФЕНИКС-РОДОПИ 95, 120000934 РОДОПСКА ТЪКАН, 120000973 ИЛИНДЕН — and the
 * fall-through that reaches them is live: 35 rows resolve their EIK from a
 * later slot because slot 0 holds `Not applicable` / `No` / `-`.
 *
 * Verified over all 154 distinct `BG`+9-digit tokens in the 2026-08-07 crawl:
 * the widened rule catches the same 29 internal codes and rejects no real EIK.
 */
const KEEP_INTERNAL_ID = /^[A-Z]{2}\d{3}000\d{3}$/;

/**
 * Pull a Bulgarian EIK out of keep.eu's free-text `beneficiary_id`.
 *
 * Observed shapes on the live corpus: `BG176168560`, `000057001`,
 * `BG176168560 | BG220000002 | - (FR), - (EN)`, `N.a.`, `N/A | 17590372`,
 * `BG 129010723`, `Not applicable | 176765096 | …`, and 20-odd rarer ones.
 *
 * Returns null rather than guessing. `canonicalEik` refuses 10-digit values, so
 * a legacy BULSTAT cannot be mistaken for an ЕГН and stored as PII.
 */
export const eikFromBeneficiaryId = (
  raw: string | null | undefined,
): string | null => {
  if (!raw) return null;
  for (const token of String(raw).split("|")) {
    const t = token.trim();
    if (!t) continue;
    if (KEEP_INTERNAL_ID.test(t)) continue;
    // `BG` here is the VAT prefix on a real national id, not a country tag we
    // are inventing: `BG000093442` is Община Варна's EIK 000093442.
    const digits = t.replace(/^BG\s*/i, "");
    // Every free-text not-applicable marker in the corpus — `N.a.`, `N/A`, `-`,
    // `No`, `Not applicable`, `Not VAT registered` — is dropped right here, by
    // not being digits. A separate marker list would only rot.
    if (!/^\d+$/.test(digits)) continue;
    const eik = canonicalEik(digits);
    if (eik) return eik;
  }
  return null;
};

/**
 * keep.eu sends money as a decimal STRING (`"123819.00"`).
 *
 * Absent is NULL; PRESENT-but-unparseable THROWS. Collapsing the two would let
 * an `n/a` budget read as `unpublished`, i.e. as "the programme published
 * nothing" — and plan §2.5 records that the (fenced-out) 2007-2013 template
 * really does write literal `n/a` in this field.
 */
const num = (
  v: string | number | null | undefined,
  what: string,
): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n))
    throw new OperationParseError(
      `${what} is not a number: ${JSON.stringify(v)}`,
    );
  return n;
};

const str = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

/**
 * Which of the three budget states a partner row is in.
 *
 * `published_zero` is NOT folded into `unpublished`: a co-beneficiary carrying
 * no budget line is a real arrangement (7 rows across the corpus, all
 * 2014-2020), while NULL means the programme did not publish a figure. They
 * answer different questions and a consumer must be able to tell them apart.
 */
export const budgetBasisOf = (budgetEur: number | null): BudgetBasis =>
  budgetEur === null
    ? "unpublished"
    : budgetEur === 0
      ? "published_zero"
      : "published";

export interface ParsedOperation {
  operation: InterregOperation;
  partners: InterregPartner[];
}

/**
 * Parse one raw keep.eu project.
 *
 * Returns null — with a one-per-programme warning — when the project belongs to
 * a programme the curated register does not admit. See the header for why that
 * is the only silent outcome.
 *
 * Deliberately takes no fetch timestamp: stamping one per row made the
 * committed corpus differ on every re-ingest. It lives once on the index.
 */
export const parseOperation = (raw: KeepProjectRaw): ParsedOperation | null => {
  const keepId = raw.id;
  if (!Number.isInteger(keepId))
    throw new OperationParseError(
      `project has no numeric id: ${JSON.stringify(raw.id)}`,
    );

  const keepProgrammeId = raw.programme?.id;
  if (keepProgrammeId === undefined || keepProgrammeId === null)
    throw new OperationParseError(`project ${keepId} has no programme`);

  const programme = programmeFor(keepProgrammeId);
  if (!programme) {
    warnUnknownProgramme(keepProgrammeId, raw.programme?.title);
    return null;
  }

  const period = raw.programme?.period?.title;
  if (!INTERREG_PERIODS.includes(period as InterregPeriod))
    throw new OperationParseError(
      `project ${keepId} has period ${JSON.stringify(period)}, outside {${INTERREG_PERIODS.join(", ")}}`,
    );
  // The register and the payload must agree. A disagreement means the curated
  // entry names the wrong keep.eu programme — the silent defect programmes.ts
  // exists to prevent — so it is an error, not a preference.
  if (period !== programme.period)
    throw new OperationParseError(
      `project ${keepId}: keep.eu says period ${period}, register says ${programme.period} for ${programme.code}`,
    );

  // Prefer `en`, but do not REQUIRE it: keep.eu's language detection files two
  // plainly-English titles under `mt` and `it`, and refusing them would drop
  // real operations over a metadata slip. Candidates are sorted by key so the
  // choice is deterministic under any object-key ordering, not merely per file.
  const translations = Object.entries(raw.translations ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const enTitle = str(raw.translations?.en?.name);
  const titleFallback = translations.find(([, v]) => str(v?.name));
  const titleEn =
    enTitle ?? (titleFallback ? str(titleFallback[1]?.name) : null);
  const titleLang = enTitle ? "en" : (titleFallback?.[0] ?? "en");
  if (!titleEn)
    throw new OperationParseError(
      `project ${keepId} has no title in any language`,
    );
  // Mirror the fallback so an operation filing BOTH under `mt` keeps its
  // summary. Today the two exceptions have a null `en.name` but a populated
  // `en.description`, so this never fires — by luck, not design.
  const summaryFallback = translations.find(([, v]) => str(v?.description));
  const summaryEn =
    str(raw.translations?.en?.description) ??
    (summaryFallback ? str(summaryFallback[1]?.description) : null);

  // Sort by keep.eu's own partnership id so `partnerSeq` — half the primary key
  // (§4) — is a function of the DATA rather than of array order. Measured: `id`
  // is present on all 12,141 partnerships and unique both within an operation
  // and globally. Without this, keep.eu returning an operation's partnerships
  // in a different order on the monthly re-crawl would shift every PK and make
  // the T2 stage-merge rewrite budgets, EIKs and places onto the wrong partner,
  // with every row count reconciling.
  const rawPartners = [...(raw.partnerships ?? [])].sort(
    (a, b) => (a.id ?? 0) - (b.id ?? 0),
  );

  const partners: InterregPartner[] = rawPartners.map((p, i) => {
    const budgetEur = num(
      p.total_budget,
      `project ${keepId} partner ${i} budget`,
    );
    const country = str(p.partner?.country?.title);
    if (!country)
      throw new OperationParseError(
        `project ${keepId}: partner ${i} has no country`,
      );
    const partnerName =
      str(p.partner?.name) ?? str(p.partner?.translations?.en?.name_translated);
    if (!partnerName)
      throw new OperationParseError(
        `project ${keepId}: partner ${i} has no name in any language`,
      );
    return {
      keepId,
      partnerSeq: i,
      keepPartnershipId: p.id ?? null,
      keepPartnerId: p.partner?.id ?? null,
      isLead: p.type === "lead",
      country,
      countryDepartment: str(p.country_department?.title),
      partnerName,
      partnerNameEn: str(p.partner?.translations?.en?.name_translated),
      eik: eikFromBeneficiaryId(p.beneficiary_id),
      pic: str(p.pic),
      orgType: str(p.organisation_type),
      legalStatus: str(p.legal_status),
      budgetEur,
      // 2021-2027 only: NULL on every 2014-2020 row, alongside pic and
      // beneficiary_id. Partner-level EU funding therefore covers 413 of the
      // corpus's 1,493 Bulgarian rows, not all of them.
      euFundingEur: num(
        p.co_financing_eur,
        `project ${keepId} partner ${i} co-financing`,
      ),
      budgetBasis: budgetBasisOf(budgetEur),
      // Prefer the department's address: it is where the work happens, which is
      // the place this corpus is attributing money to.
      locationRaw:
        str(p.location_address) ?? str(p.town_department) ?? str(p.town),
      postcode: str(p.postcode_department) ?? str(p.postcode),
      lat:
        typeof p.location_json?.lat === "number" ? p.location_json.lat : null,
      lng:
        typeof p.location_json?.lng === "number" ? p.location_json.lng : null,
    };
  });

  const totalBudgetEur = num(raw.total_budget, `project ${keepId} total`);

  const publishedBudgets = partners.filter((p) => p.budgetEur !== null);
  const partnerBudgetSumEur = publishedBudgets.length
    ? publishedBudgets.reduce((a, p) => a + (p.budgetEur ?? 0), 0)
    : null;

  for (const p of partners)
    if (p.budgetEur !== null && p.budgetEur < 0)
      throw new OperationParseError(
        `project ${keepId}: partner ${p.partnerSeq} has a negative budget ${p.budgetEur}`,
      );

  // THE INVERSION, and the only budget shape worth refusing: a partner carrying
  // the WHOLE operation total while a sibling also has real money. That is the
  // €2m-on-a-€300k-partner error, and it is a structural impossibility rather
  // than a reconciliation gap.
  //
  // `others` excludes the carrier BY IDENTITY, not by value. Filtering on
  // `budgetEur !== totalBudgetEur` drops EVERY partner at the total, so two
  // partners each carrying the whole operation — the worse form of the same
  // bug — slipped through whenever the remaining siblings were zero.
  if (totalBudgetEur !== null && totalBudgetEur > 0 && partners.length > 1) {
    const carriesWhole = partners.find((p) => p.budgetEur === totalBudgetEur);
    if (carriesWhole) {
      const others = partners.filter((p) => p !== carriesWhole);
      if (others.some((p) => (p.budgetEur ?? 0) > 0))
        throw new OperationParseError(
          `project ${keepId}: partner ${carriesWhole.partnerSeq} ` +
            `(${carriesWhole.partnerName}) carries the entire operation total ` +
            `${totalBudgetEur.toFixed(2)} while other partners also hold budget — ` +
            `the operation total has been attributed to one partner`,
        );
    }
  }

  const countries = [
    ...new Set(
      partners.flatMap((p) =>
        [p.country, p.countryDepartment].filter((c): c is string => Boolean(c)),
      ),
    ),
  ].sort();

  return {
    operation: {
      keepId,
      operationId: str(raw.project_id),
      programmeCode: programme.code,
      period,
      titleEn,
      titleLang,
      // keep.eu is English-only for titles (measured: 0 of 1,954 carry `bg`).
      // Read it anyway rather than hard-coding null, so the day a programme
      // starts publishing Bulgarian we pick it up without a code change.
      titleBg: str(raw.translations?.bg?.name),
      summaryEn,
      status: str(raw.status),
      startDate: str(raw.start_date),
      endDate: str(raw.end_date),
      totalBudgetEur,
      euFundingEur: num(raw.eu_funding, `project ${keepId} EU funding`),
      coFinancingRate: num(
        raw.union_co_financing_rate,
        `project ${keepId} co-financing rate`,
      ),
      partnerCount: rawPartners.length,
      partnerBudgetSumEur,
      partnerBudgetPublishedCount: publishedBudgets.length,
      countries,
    },
    partners,
  };
};

/** The Bulgarian rows of a parsed operation — the ones that become BG money. */
export const bulgarianPartners = (p: ParsedOperation): InterregPartner[] =>
  p.partners.filter(isBulgarianPartner);
