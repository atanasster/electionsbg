// Dependency-free reference data for the Туризъм (Tourism) sector — the
// Ministry of Tourism (Министерство на туризма, МТ). Imported by the sector
// registry (sectorDashboards.ts), the ?sector=tourism browse pack
// (sectorPacks.tsx) and the two bespoke tiles (TourismThematicTiles,
// TourismSpendVsNightsTile). NOT imported by the offline sector_stats
// generator — see the basis note below.
//
// МТ is a PROMOTER, not an infrastructure builder: its €28.8M procurement corpus
// (335 contracts, 2014-12-30 → 2026-05-13) is dominated by destination
// marketing. Six of the ten largest suppliers all-scope: Апра €2.09M, Директ
// медия крес €1.62M, Нова броудкастинг €1.62M, Арка-Л.Т.Д. €1.29M, BBC Global
// News €1.10M, Медиа планинг груп €1.09M. The dashboard's thesis is "where the
// tourism-marketing money goes", so the SCREEN leads with procurement.
//
// ⚠️ THE HUB TILE DOES NOT. The /governance/sectors headline is `basis: 'budget'`
// — the ministry's enacted expenditure from
// data/budget/ministries/admin-ministerstvo-na-turizma.json (€14,462,400 for
// 2026) — set by the 2026-07-16 sectors-hub basis rework (e27eb2496d), one day
// after this file was first written. So WIDENING THE ROSTER BELOW MOVES THE
// SECTOR SCREEN AND NOT THE TILE, by construction: the generator's SECTOR_EIKS
// has no `tourism` key at all. This header claimed the opposite until the
// 2026-08-20 audit. The equivalent basis note is in educationReferenceData.ts;
// the "widening the roster deliberately does not move this number" sentence
// lives in scripts/db/gen_procurement/sector_stats.ts, beside BUDGET_SECTOR_NODE.
// Unlike education, SECTOR_DASHBOARDS.tourism carries no `footnote`, so the gap
// is documented here and nowhere a reader sees — open work.
//
// Single-member — VERIFIED (2026-07-15, re-verified 2026-08-20 over `%туриз%` ∪
// `%турис%`, which is TWO patterns and not one: „туристически" contains турис and
// not туриз, so the БТС row below is unreachable from the туриз sweep alone).
// A full scan of the awarder corpus for state tourism bodies returns exactly one
// clean principal, the ministry (176789478). Anti-allowlist (do NOT add):
//   - the 32 `Професионална гимназия по туризъм …` vocational schools
//     (principal = МОН, municipal) that a name/keyword classifier would sweep in;
//   - EIK 130169256 = МИЕ (corpus name „Министерство на икономиката и
//     енергетиката /МИЕ/", carrying „Министерство на икономиката, енергетиката и
//     туризма /МИЕТ/" as its старо наименование — grep for МИЕ, not МИЕТ), the
//     pre-2014 combined ministry, €21,279,264 over 2011-01-06→2015-07-13. It held
//     tourism before МТ was split out, but its spend is a MIXED
//     economy/energy/tourism mandate that cannot be separated by EIK — folding it
//     in would misattribute economy/energy procurement to Tourism.
//   - the state HOLIDAY and SPA operators, which look like tourism and answer to
//     other principals: ИА „Военни клубове и военно-почивно дело" 129008829
//     (€93.1M, принципал МО), „Профилактика, рехабилитация и отдих" ЕАД
//     121577013 (€6.2M, МТСП/НОИ), „Ученически отдих и спорт" ЕАД 175030371
//     (€5.5M, МОН), „Балнеологичен център — Камена" ЕАД 112013405 (€1.6M,
//     municipal/health). Each is larger than a real member would be, so admitting
//     one is a defense-audit-shaped error rather than a rounding difference.
//   - Сдружение „Български туристически съюз" 000690918 (€310,571) — an NGO that
//     ran a procedure, not a state body;
//   - „Обединено счетоводство — Община Айтос" 000056764 (€142,119), which the
//     туриз sweep returns only because its own name lists a municipal
//     „Образование, култура, вероизповедание, спорт и туризъм" directorate.
// ДАТ, the pre-2009 Държавна агенция по туризъм, is absent from the awarder
// corpus entirely, so there is no predecessor gap beyond the МИЕ decision.
// Widen only to bodies whose principal is verifiably the Minister of Tourism.
// See docs/plans/tourism-view-v1.md §3 and docs/plans/tourism-sector-audit-v1.md.

export const TOURISM_MINISTRY_EIK = "176789478"; // Министерство на туризма (МТ)
export const TOURISM_AWARDER_PATH = `/awarder/${TOURISM_MINISTRY_EIK}`;

// The awarder EIK-set whose contract € rolls up to the Tourism sector. One
// member today; kept as an array so the sector graduates to a multi-entity
// roster (like defense/water).
// ⚠ „without touching its consumers" would be false: SECTOR_DASHBOARDS.tourism
// .members is built from the SCALAR TOURISM_MINISTRY_EIK, not from this array
// (it carries per-EIK display names), so a second member must be added there too
// or the browse pack widens while the dashboard does not — silently, at one
// member the two agree and every lockstep check passes. That is the milder form
// of the SECTOR_DASHBOARDS.energy.members defect CLAUDE.md records.
// tourismReferenceData.test.ts asserts the two agree.
export const TOURISM_SECTOR_EIKS: readonly string[] = [TOURISM_MINISTRY_EIK];

/** CONTRACTORS to МТ that are themselves state or municipal bodies — the money
 *  is an intra-government transfer rather than a market award, and unlabelled the
 *  row reads as a private vendor topping the sector. Wired in step 2 of the audit
 *  as `SECTOR_DASHBOARDS.tourism.stateBodyContractors` → SectorTopContractorsTile's
 *  `stateBodyEiks`, which yields the per-row „държавно" chip, a dimmed bar and one
 *  footnote — and nothing else. It does NOT drive a market-only HHI or an
 *  `internalShare` figure the way SECURITY_STATE_BODY_CONTRACTORS does, because
 *  those live in VikContractorHhiTile and /sector/tourism renders no HHI tile.
 *
 *  This sector needs the chip more than most, because the shape only appears on
 *  the page's DEFAULT scope. Over the whole corpus the leaderboard is a real
 *  market (top row 7.3%), but the current parliament's window is 5 contracts /
 *  €312,500 of which €262,500 — 84% — is four host cities being paid to stage the
 *  international cycling tour: five SEPARATE „Договаряне без предварително
 *  обявление" procedures (УНП 05024-2026-0005/0006/0008/0009/0011, five distinct
 *  ocid), all CPV 79340000, every row single-bid, each citing
 *  `tenders.legal_basis` = „Чл. 79, ал. 1, т.3, б.в от ЗОП" — joined on УНП,
 *  since `contracts.procurement_method_rationale` is empty on all five. So „Топ
 *  изпълнители" on the default view is municipalities, ranks 1–4.
 *
 *  ⚠ CURATED BY EIK, and it MUST stay curated — never derived from „is this EIK an
 *  awarder somewhere". On THIS corpus that probe answers Електрохолд Продажби
 *  (rank 5) and ЕВН България Електроснабдяване (rank 7), both private regulated
 *  companies that ЗОП's utilities regime makes contracting authorities; measured
 *  on the water sector, 44% of its answer was private. It under-captures too:
 *  Фондация „Бургас - 2032" is not a ЗОП awarder at all.
 *
 *  ⚠ THE BAR IS TOP-8 REACH, NOT THE WHOLE CONTRACTOR SET, plus two extensions.
 *  The tile badges only the rows it displays, so the rule is „every public body
 *  that reaches a displayed rank at some scope", and then: anything already badged
 *  „държавно" on a SIBLING sector page, and the same-page TWIN of an admitted
 *  entry. Two entries sit below the rank bar and each names the extension that
 *  admits it.
 *
 *  ⚠ THE DISCRIMINATOR IS THE FOUNDING ACT AND COUNCIL OVERSIGHT, NOT
 *  `entity_class`. Both municipal foundations here are `ngo_found` in
 *  tr_companies, so a legal-form test would exclude them — and a фондация has no
 *  owners at all, so „its представляващ is a deputy mayor" would not establish
 *  control either. What settles it is that a municipal council founded the body
 *  and receives its accounts, which this repo holds in `council_resolution` and
 *  each row cites. Ownership or that founding act is named per row, because that
 *  is the claim the chip publishes (the rule is stated at
 *  securityReferenceData.ts's own list).
 *
 *  ⚠ NGOs ARE NOT PUBLIC BODIES and are deliberately absent — no founding act, no
 *  council oversight — even though several outrank the €62,500 municipal rows. All
 *  figures all-scope corpus totals: the guide associations (Асоциация на
 *  екскурзоводите €650k, Съюз на екскурзоводите €270k, „Планини и хора" €189k,
 *  Югоизточен съюз „Ваня Райкова" €169k — the last reaching rank 5) and the sports
 *  federations (волейбол €424k, тенис €128k, джудо €51k) are all `ngo_assoc` in
 *  tr_companies, state-subsidised but not government; so is the Германо-българска
 *  камара €75k. Интер експо център 121122275 is an ЕООД company and България ЕР
 *  is private.
 *
 *  Euro figures and ranks below are the 2026-05-13 corpus, and are provenance
 *  rather than assertions. tourismReferenceData.test.ts holds the network-free
 *  invariants (well-formed deduped EIKs, disjoint from the roster, the two
 *  below-bar entries, agreement with the sibling lists on every shared EIK);
 *  scripts/db/tests/sector_stats_tourism.data.test.ts adds the corpus arms —
 *  every entry still a МТ contractor and still outside the roster, the
 *  default-scope share the chips cover, the anti-allowlist with its own
 *  non-vacuity floor, and the advertising band the spend↔nights caption depends
 *  on. For the BENEFICIARY figures it pins shares and classifications, never a
 *  rank or an absolute €; the anti-allowlist's own floors are absolute by
 *  necessity, since their job is to prove each excluded body is still large
 *  enough for its inclusion to be a material error. */
/** The bodies a name or keyword sweep would pull into this sector, each with the
 *  reason it is out and the money that makes admitting it a material error rather
 *  than a rounding difference. The header above is the prose version; this is the
 *  machine-readable one, so sector_stats_tourism.data.test.ts can assert BOTH
 *  halves — that none is in the roster, and that each is still a live awarder at
 *  roughly this scale. A restated copy in the test would cover only the entries
 *  somebody remembered to duplicate.
 *
 *  `minEur` is a FLOOR on the whole EIK's contract corpus, deliberately well under
 *  the measured figure so an ordinary reload cannot trip it. Мeasured 2026-05-13:
 *  МИЕ €21,279,264 · Военни клубове €93,080,352 · ПРО €6,237,402 · Ученически
 *  отдих €5,469,656 · Камена €1,609,798 · БТС €310,571 · ОЦСЗУ Айтос €64,098,089
 *  (that last on its whole corpus; the €142,119 in the header above is the subset
 *  the туриз name sweep returns). */
export const TOURISM_ANTI_ALLOWLIST: readonly {
  eik: string;
  why: string;
  minEur: number;
}[] = [
  { eik: "130169256", why: "МИЕ — the pre-2014 combined ministry; MIXED economy/energy/tourism mandate, inseparable by EIK", minEur: 15_000_000 }, // prettier-ignore
  { eik: "129008829", why: "ИА „Военни клубове и военно-почивно дело“ — принципал МО", minEur: 50_000_000 }, // prettier-ignore
  { eik: "121577013", why: "„Профилактика, рехабилитация и отдих“ ЕАД — МТСП/НОИ", minEur: 3_000_000 }, // prettier-ignore
  { eik: "175030371", why: "„Ученически отдих и спорт“ ЕАД — МОН", minEur: 3_000_000 }, // prettier-ignore
  { eik: "112013405", why: "„Балнеологичен център — Камена“ ЕАД — municipal/health", minEur: 1_000_000 }, // prettier-ignore
  { eik: "000690918", why: "Сдружение „Български туристически съюз“ — an NGO that ran a procedure", minEur: 100_000 }, // prettier-ignore
  { eik: "000056764", why: "„Обединено счетоводство — Община Айтос“ — matched only because its own name lists a municipal „…спорт и туризъм“ directorate", minEur: 50_000_000 }, // prettier-ignore
];

export const TOURISM_STATE_BODY_CONTRACTORS: readonly string[] = [
  // Държавна: the public broadcaster. €1,073,528 all-scope; displayed at four
  // scopes and rank 2 at two of them (y:2024, ns:2023_04_02). Already badged by
  // SOCIAL_STATE_BODY_CONTRACTORS, so omitting it here would badge one company
  // on one page and not another.
  "000672350", // Българска национална телевизия — държавна
  // Ranks 1–4 at ns:2026_04_19 are the cycling-tour host cities; the lower three
  // tie exactly at €62,500 and are ordered by eik ASC, so their ranks are a
  // tiebreak position rather than a property of the body.
  "000696327", // Столична община — municipality; rank 1 (€75,000); 6,513 contracts of its own as an awarder
  "000133634", // Община Велико Търново — municipality; rank 2 (€62,500); 1,331 contracts as an awarder
  "176182033", // Общинска фондация „Пловдив 2019" — founded by and reporting to Община Пловдив under чл.19(8) of its учредителен акт (council_resolution PDV01-2026-prot10-r229; ГФО accepted by PDV01-2026-prot9-r194); rank 3 (€62,500)
  "208188531", // Фондация „Бургас - 2032" — founded by Община Бургас (council_resolution BGS01-2025-prot19-r16564), which accepts its annual report + ГФО (BGS01-2026-prot39-r18522); rank 4 (€62,500). NOT a ЗОП awarder, which is why an awarder-derived probe misses it
  // Below the rank bar (best rank 10, at y:2023). Already badged „държавно" on
  // two sibling sector pages (security + social), and one company badged on one
  // page and not another is a worse defect than an unused entry — the reason
  // securityReferenceData.ts carries Български пощи.
  "831609046", // „Топлофикация София" ЕАД — 100% Столична община (€40,477)
  // Below the rank bar (best rank 14) and badged on NO sibling page. Admitted as
  // the same-page TWIN of БНТ above: the two state broadcasters appear together
  // on this leaderboard, and badging one but not the other is the inconsistency
  // this list exists to remove. NOT the Български пощи precedent.
  "000672343", // Българско национално радио — държавна (€81,203)
];
