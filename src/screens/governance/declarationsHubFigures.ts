// The /governance/declarations head's KPI band, as a pure function over the hub-stats blob.
//
// Out of the component for the reason `budgetHubFigures.ts`, `fundsHubFigures.ts`,
// `consumptionHubFigures.ts` and `subsidiesHubFigures.ts` are: a band built inline is
// unreachable from `hubHead.gates.test.ts`, whose band/tile clause compares band values
// against tile metrics as rendered strings.

import type { HubEvidence, HubKpi } from "@/ux/infographic/HubHead";
import type { DeclarationsHubStats } from "@/data/governance/useDeclarationsHubStats";
import { formatEurCompact } from "@/lib/currency";
// The EN routes never show Cyrillic — useCandidateName states the rule, and the rail's own
// destination renders this very column through it. Without this the rail whose whole claim is
// "these are that page's first rows" spells them differently, baked into the prerendered EN HTML.
import { transliterateName } from "@/data/candidates/transliterateName";

type T = (key: string, opts?: Record<string, unknown>) => string;

/** Which tile a band cell displaces, keyed by that cell's DESTINATION.
 *
 *  ⚠️ KEYED ON WHAT THE BAND EMITTED, never a compile-time list. Three of the four cells are
 *  withheld rather than published as a zero (an unbuilt `company_browse_table` ships 0, and a
 *  parliament with no registry rows ships no slice at all), so a constant list would blank the
 *  tile as well and delete the figure from the page entirely. */
const TILES_BY_DESTINATION: Record<string, readonly string[]> = {
  "/persons": ["persons"],
  "/officials/assets": ["officials"],
  "/companies?political=1": ["companies"],
  "/mp-assets": ["assets"],
};

/** The tiles whose metric this band is carrying, derived from the cells that rendered. */
export const promotedTiles = (kpis: HubKpi[]): Set<string> => {
  const out = new Set<string>();
  for (const k of kpis)
    for (const id of TILES_BY_DESTINATION[String(k.to)] ?? []) out.add(id);
  return out;
};

/** Every tile any band cell could displace — for gates, never for rendering. */
export const DECLARATIONS_BAND_TILES =
  Object.values(TILES_BY_DESTINATION).flat();

/** The head's four figures.
 *
 *  ⚠️⚠️ THREE ARE CORPUS-WIDE AND ONE FOLLOWS THE SCOPE PILL, AND THE HEAD MUST SAY SO.
 *  The pill sits directly above this band, which is the arrangement that makes a reader
 *  assume every figure under it moved. Only the fourth does: the register is sliced by
 *  PARLIAMENT and only the MP tables carry that dimension, so „лица", „длъжностни лица" and
 *  „организации" are the whole corpus at every scope. `declarationsKpiNote` is not a
 *  decoration — without it, „63 782 лица" reads as a claim about one parliament, which is
 *  off by the register's whole history.
 *
 *  ⚠️ A ZERO IS WITHHELD, NOT PUBLISHED. The generator ships `organisations: 0` when
 *  `company_browse_table` (188) is absent or unbuilt — a state its own warning describes as
 *  "ships without a figure" — and a cell printing that zero turns "we have not built this
 *  yet" into "no office-holder is attached to any organisation", about every named person at
 *  once. Same rule the per-parliament slice already follows.
 *
 *  ⚠️ THE MP CELL'S BASIS COMES FROM `bucket`, NOT FROM `scope`. `mpAssetsNsScope` falls back
 *  to the national roll-up when the selection resolves to no NS folder, so on `scope: "ns"`
 *  with no folder the figure IS the all-parliaments one — captioning it „този парламент"
 *  would then be a false sentence built from an arithmetically correct number. */
export const declarationsHubKpis = (
  stats: DeclarationsHubStats | undefined,
  nsStats: DeclarationsHubStats["byNs"][string] | undefined,
  bucket: string,
  fmt: (n: number) => string,
  t: T,
): HubKpi[] => {
  if (!stats) return [];
  const out: HubKpi[] = [
    {
      value: fmt(stats.people),
      label: t("decl_kpi_people"),
      basis: t("decl_kpi_basis_corpus"),
      to: "/persons",
    },
    {
      value: fmt(stats.officials),
      label: t("decl_kpi_officials"),
      basis: t("decl_kpi_basis_corpus"),
      to: "/officials/assets",
    },
  ];
  if (stats.organisations > 0)
    out.push({
      value: fmt(stats.organisations),
      label: t("decl_kpi_companies"),
      // ⚠️ ITS BASIS NAMES THE WINDOW TOO, not only the companion fact. „свързани с
      // 14 866 публични фигури" is a second figure, not a denominator — so with only
      // that, this cell was the one corpus-wide number on the band declaring no scope,
      // and in the no-MP-slice state (`declarationsKpiNote` returns undefined, correctly)
      // nothing on the page said so while a „Този парламент" pill sat directly above it.
      // No `count` — `decl_kpi_basis_orgs` carries no `_one`/`_other` forms in either
      // corpus, so i18next resolves the base key and the argument changes nothing. It was
      // inherited from the secondary sentence this replaced; passing it would imply a
      // plural rule that does not exist.
      basis: t("decl_kpi_basis_orgs", { n: fmt(stats.organisationPeople) }),
      to: "/companies?political=1",
    });
  if (nsStats)
    out.push({
      value: fmt(nsStats.mpsWithAssets),
      label: t("decl_kpi_mps"),
      basis:
        bucket === "all"
          ? t("decl_kpi_basis_all_ns")
          : t("decl_kpi_basis_this_ns"),
      to: "/mp-assets",
    });
  return out;
};

/** The sentence under the band that says which of its figures the pill moves.
 *
 *  Returns undefined when no scoped cell rendered — a note about a scope nothing on the band
 *  follows is worse than no note. */
export const declarationsKpiNote = (
  kpis: HubKpi[],
  t: T,
): string | undefined =>
  kpis.some((k) => k.to === "/mp-assets")
    ? t("decl_kpi_note_scope")
    : undefined;

/** What a tile renders once the band may have taken its headline.
 *
 *  ⚠️ THE TILE IS DEMOTED, THE BAND CELL IS NOT DROPPED — §3.1 rule 5, resolved the way the
 *  sibling hubs resolve it. A demoted tile falls back to its OTHER figure, so promoting a
 *  number moves it up the page rather than deleting it: /persons keeps those with a filing,
 *  /companies the people behind the organisations, /mp-assets the all-parliaments count.
 *
 *  ⚠️ IT READS `secondaryValue`, NEVER `secondary`. The secondary is a SENTENCE („21 170 с
 *  подадена декларация"); recovering the number from it means parsing back out of rendered
 *  copy, past an `Intl` group separator that is a NO-BREAK space (U+00A0) in bg and a narrow
 *  one (U+202F) elsewhere — a literal " " matches neither and the failure is silent („21"
 *  for „21 170"). The builder carries the formatted number alongside the sentence instead.
 *
 *  ⚠️ A DEMOTED TILE WITH NO SECOND FIGURE RENDERS BARE, and that is correct rather than a
 *  gap. `officials` has only ever carried one number, and `assets` has none on the all-
 *  parliaments bucket (its second figure IS the band's). Re-printing the band's own value
 *  under it is the duplication rule 5 exists to prevent. */
export interface TileFigures {
  metric: string;
  caption: string;
  /** The sentence under the headline. */
  secondary?: string;
  /** The same figure as a bare formatted number, for when this tile is demoted. */
  secondaryValue?: string;
}

/** The caption a demoted tile's fallback figure gets. Absent → the tile renders bare. */
const DEMOTED_CAPTION: Record<string, string> = {
  persons: "decl_tile_persons_demoted",
  companies: "decl_tile_companies_demoted",
  assets: "decl_tile_assets_demoted",
};

export const tileFigures = (
  m: TileFigures | undefined,
  demoted: boolean,
  id: string,
  t: T,
): { metric?: string; metricCaption?: string; metricSecondary?: string } => {
  if (!m) return {};
  if (!demoted)
    return {
      metric: m.metric,
      metricCaption: m.caption,
      ...(m.secondary ? { metricSecondary: m.secondary } : {}),
    };
  const caption = DEMOTED_CAPTION[id];
  return caption && m.secondaryValue
    ? { metric: m.secondaryValue, metricCaption: t(caption) }
    : {};
};

/** The head's evidence rail: the largest declared net worth.
 *
 *  ⚠️ THE ROWS ARE THE DESTINATION'S OWN FIRST ROWS, not a ranking of our own — the
 *  evidence column's SAME-SET rule. `OfficialsAssetsScreen` renders the same matview with
 *  `fixedFilters [{is_exec:true}]` and `defaultSort [{net_worth_eur, desc}]`, and the
 *  generator's query is that filter and that sort verbatim. Ranking by `total_assets_eur`
 *  instead (the column beside it, and the matview's only index) would publish a different
 *  five under a heading naming this destination.
 *
 *  ⚠️⚠️ `is_exec` IS NOT „THE EXECUTIVE", AND THE BASIS SAID IT WAS. 100's definition is
 *  `bool_or(source <> 'official_muni')` — i.e. every official in the register EXCEPT the
 *  municipal ones — whose largest categories are school (2,759), state_enterprise (2,420)
 *  and kindergarten (1,826). Measured 2026-08-26, three of the five rows fail „изпълнителна
 *  власт" outright: two are `party_leader` and one `social_care`. A population clause is not
 *  decoration on a rail naming five living people and a euro figure each; it is the sentence
 *  that says who they are.
 *
 *  ⚠️⚠️ THE YEARS DIFFER PER PERSON, AND THE YEAR GOES ON THE ROW. Each row is that person's
 *  LATEST filing, and people stop filing when they leave office — measured 2026-08-26, the
 *  five rows span 2021 to 2026, one of them by a minister who left in 2022. „Декларирано
 *  през 2026" over that row is a false sentence about a named individual, which is the whole
 *  §0 class. A span in the basis is honest about the SET and cannot be resolved to a member
 *  (the rows are ordered by value, so there is no positional cue either), so the basis says
 *  the years differ and each row carries its own.
 *
 *  ⚠️ REFUSED WITHOUT THE SPAN, for the reason the subsidies rail is refused without its
 *  untraceable share: a dated list that cannot say which years it mixes is a claim about
 *  named people's present wealth that the data does not support. Both halves come from one
 *  blob, so they cannot disagree.
 *
 *  ⚠️ „Net worth" here is DECLARED assets minus DECLARED debts — not a valuation. The
 *  register excludes property the declarant only uses (`is_declared_holding`), converts
 *  foreign-currency rows at a dated ECB rate, and counts nothing it was not told about. The
 *  basis names it as declared rather than as wealth. */
export const declarationsHubEvidence = (
  stats: DeclarationsHubStats | undefined,
  lang: string,
  t: T,
): HubEvidence | undefined => {
  const rows = stats?.topNetWorth;
  const years = stats?.topNetWorthYears;
  if (!rows?.length || !years) return undefined;
  return {
    heading: t("decl_evidence_heading"),
    basis:
      years.first === years.last
        ? t("decl_evidence_basis_one", { year: years.last })
        : t("decl_evidence_basis"),
    rows: rows.map((r) => ({
      // The slug, not the name: two officials can share one and React reuses the row.
      id: r.slug,
      // ⚠️ THE YEAR IS PER ROW, SO IT BELONGS ON THE ROW. The basis names the SPAN, which
      // is honest about the SET and cannot be resolved to a member — the rows are ordered
      // by value, so nothing otherwise tells a reader that one of these figures is a 2021
      // filing by somebody who left office in 2022 and never filed again. „A false sentence
      // about a named individual" is the §0 harm, and it lives at the row.
      label: `${lang === "en" ? transliterateName(r.name) : r.name} · ${r.year}`,
      value: formatEurCompact(r.netWorthEur, lang),
      to: `/person/${r.slug}`,
    })),
    action: { to: "/officials/assets", label: t("decl_evidence_action") },
  };
};
