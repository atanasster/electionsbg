// The /culture head's KPI band, as a pure function over the hub-stats blob.
//
// Out of the component for the reason `budgetHubFigures.ts`, `fundsHubFigures.ts`,
// `consumptionHubFigures.ts`, `subsidiesHubFigures.ts` and `declarationsHubFigures.ts` are:
// a band built inline is unreachable from `hubHead.gates.test.ts`, whose band/tile clause
// compares band values against tile metrics as rendered strings.
//
// ⚠️ COPY LIVES HERE, NOT IN THE i18n CORPUS — the module's own convention, stated by
// `CULTURE_HUB_COPY` and followed by `cultureFundSources.ts`. Each function takes `bg` and
// returns the finished string, exactly as `tileMetric()` does.

import type { HubEvidence, HubKpi } from "@/ux/infographic/HubHead";
import type { To } from "react-router-dom";
import type { CultureHubStats } from "@/data/culture/hubStats";
import { formatEurCompact, formatInt } from "@/lib/currency";

/** Which tile a band cell displaces, keyed by that cell's DESTINATION.
 *
 *  ⚠️ KEYED ON WHAT THE BAND EMITTED, never a compile-time list. Three of the four cells
 *  are withheld rather than published as a zero — `budget` and `films` are OPTIONAL on the
 *  wire (a bundle can load against a blob minted before those fields existed) and the whole
 *  blob is null on a checkout that never ran the generator. A constant list would blank the
 *  tile as well, removing the figure from the page entirely. */
//
//  ⚠️ `?pscope=all` ON THE PROCUREMENT DESTINATION, and NOT on the other three. This is the
//  module's own documented rule (`cultureRegistry.ts`: „EVERY PROCUREMENT TILE CARRIES
//  ?pscope=all, and it is not decoration"), and it is per-destination because the culture
//  pages do not share one convention: `/culture/procurement` renders the DEFAULT
//  `<ScopeControl mode="toggle" />`, where `ns` is the selected parliament, so a corpus-wide
//  figure landing there without the param shows a fraction of itself. `/culture/subsidies`
//  overrides `ns` to mean „всички години" and sets `allowAll={false}`, so the param is
//  unnecessary there and would be clamped away; `/culture/funds` reads no scope at all; and
//  `/budget/ministries` is another module.
const TILES_BY_DESTINATION: Record<string, readonly string[]> = {
  "/budget/ministries": ["budget"],
  "/culture/procurement?pscope=all": ["procurement"],
  "/culture/subsidies": ["subsidies"],
  "/culture/funds": ["funds"],
};

/** The tiles whose metric this band is carrying, derived from the cells that rendered. */
export const promotedTiles = (kpis: HubKpi[]): Set<string> => {
  const out = new Set<string>();
  for (const k of kpis)
    for (const id of TILES_BY_DESTINATION[String(k.to)] ?? []) out.add(id);
  return out;
};

/** Every tile any band cell could displace — for gates, never for rendering. */
export const CULTURE_BAND_TILES = Object.values(TILES_BY_DESTINATION).flat();

/** The head's four figures — the four money streams, in the order the page already
 *  presents them.
 *
 *  ⚠️⚠️ THEY DO NOT SUM, AND A BAND IS WHERE THAT STOPS BEING OBVIOUS. Four euro figures
 *  in one row read as parts of a whole far more strongly than four tiles scattered down a
 *  grid do — and their sum (~€637m) is a number describing nothing. They sit on four
 *  different bases: the ministry's budget is ONE FISCAL YEAR, procurement accumulates from
 *  2011, film subsidy from 2014, EU funds from 2014. So every cell's basis names its own
 *  window, and `cultureKpiNote` says the four cannot be added — the caveat the page has
 *  carried in its intro paragraph since the hub was built, moved to where the figures are.
 *
 *  ⚠️ THE BUDGET CELL IS THE BUDGET LAW, AND THIS CAPTION SHIPPED SAYING THE OPPOSITE. It
 *  read „прогнозни разходи … не по закона", derived from a `basis` flag the generator built
 *  out of `planned_law_eur IS NULL`. That inverts 153's own column semantics: `planned_eur`
 *  IS the ЗДБ figure, and `planned_law_eur` is non-NULL only where an Отчет restated the
 *  appropriation at a WIDER scope. Measured 2026-08-26, 1 of 401 expenditure rows carries it
 *  and 0 of МК's nine years do — so the cell denied the budget act over the published
 *  ЗДБРБ-2026 appropriation. (The seasonal extrapolation is real, on
 *  `budget_fiscal_year_figure.basis` — migration 152, the КФП grain. Different table.)
 *
 *  ⚠️ THE FUNDS CELL PICKS THE EIK-EXACT ARM AND NAMES THE OTHER. `eikExactEur` (the
 *  register's own bodies, EIK-keyed and checkable) and `byNameEur` (a name match — a floor
 *  with a fuzzy edge) are both true and 38.8% apart. Publishing one bare invites a reader to
 *  take it for „EU culture money", so the basis carries both. */
export const cultureHubKpis = (
  s: CultureHubStats | null | undefined,
  lang: string,
  bg: boolean,
): HubKpi[] => {
  if (!s) return [];
  const eur = (n: number) => formatEurCompact(n, lang);
  const int = (n: number) => formatInt(n, lang);
  const out: HubKpi[] = [];

  if (s.budget)
    out.push({
      value: eur(s.budget.eur),
      label: bg ? "бюджет на МК" : "ministry budget",
      basis: bg
        ? `по закона за бюджета за ${s.budget.fiscalYear} г. — една година, не натрупана сума`
        : `per the ${s.budget.fiscalYear} budget act — one year, not a cumulative total`,
      to: "/budget/ministries",
    });

  out.push({
    value: eur(s.procurement.eur),
    label: bg ? "обществени поръчки" : "public contracts",
    // An UNKNOWN window reads as unknown rather than as a guessed year — the same
    // „absence, never a substitute" rule the optional cells above follow.
    basis: (() => {
      const y = firstYear(s);
      if (bg)
        return y
          ? `${int(s.procurement.contracts)} договора, натрупани от ${y} г.`
          : `${int(s.procurement.contracts)} договора, натрупани`;
      return y
        ? `${int(s.procurement.contracts)} contracts, accumulated since ${y}`
        : `${int(s.procurement.contracts)} contracts, accumulated`;
    })(),
    to: "/culture/procurement?pscope=all",
  });

  if (s.films)
    out.push({
      value: eur(s.films.eur),
      label: bg ? "филмови субсидии" : "film subsidy",
      basis: bg
        ? `${int(s.films.films)} филма, ${s.films.firstYear}–${s.films.lastYear} г.`
        : `${int(s.films.films)} films, ${s.films.firstYear}–${s.films.lastYear}`,
      to: "/culture/subsidies",
    });

  out.push({
    value: eur(s.funds.eikExactEur),
    // ⚠️ THE ARM IS IN THE LABEL, not only in the basis. `/culture/funds` counts FOUR
    // separately-labelled arms as EU money — ИСУН by EIK, ИСУН by name, ДФЗ читалища
    // (€18.3m) and Interreg — so a bare „еврофондове" over the first silently excludes the
    // other three from a word that plainly covers them.
    label: bg ? "еврофондове (ИСУН)" : "EU funds (ИСУН)",
    // BOTH arms, because one alone reads as „EU culture money" and they are 38.8% apart.
    //
    // ⚠️ THE ONE CELL WITH NO YEAR WINDOW, and it is not an omission: `fund_projects`
    // carries NO date columns at all (ИСУН's beneficiary export publishes none), so no
    // honest window exists to state. Its basis names the DENOMINATOR instead — which arm
    // of the two produced the figure — and the streams note carries the accumulation.
    basis: bg
      ? `по ЕИК на регистъра; по име — ${eur(s.funds.byNameEur)}`
      : `by register EIK; by name — ${eur(s.funds.byNameEur)}`,
    to: "/culture/funds",
  });

  return out;
};

/** The procurement corpus's first year, or null when the blob carries no date.
 *
 *  Derived from the blob's own `firstDate` rather than written down: the registry header
 *  quotes „2011" in prose, and a frozen year in a basis line is the frozen-string defect
 *  `hubStats.ts`'s header exists to condemn. It used to FALL BACK to that prose year, which
 *  is the same defect wearing a default: the fallback fires exactly when the window is
 *  unknown, and published a specific year on no evidence. */
const firstYear = (s: CultureHubStats): string | null =>
  s.procurement.firstDate ? s.procurement.firstDate.slice(0, 4) : null;

/** The sentence under the band that says the four figures cannot be added.
 *
 *  ⚠️ NOT OPTIONAL, and not a restatement of the basis lines. Each basis says what ITS cell
 *  covers; only this says the four are incommensurable. It is the caveat the hub has carried
 *  in prose since it was built („стоят на различни основи и НЕ се събират"), and moving the
 *  figures into a band is precisely what makes the reader most likely to add them.
 *
 *  ⚠️ UNCONDITIONAL, AND THAT IS THE POINT. It first gated on `kpis.length >= 2`, which
 *  deleted it on any checkout that never ran the generator — and the argument is about the
 *  four STREAMS, which are the tiles, not about the band that happens to front them. The
 *  page's own gate says so: „losing this sentence turns the grid back into a leaderboard."
 *  So the screen renders it under the band when there is one and above the grid when there
 *  is not — one string, one place, never both. */
export const cultureStreamsNote = (bg: boolean): string => {
  return bg
    ? "Четирите потока стоят на различни основи и НЕ се събират: бюджетът на МК е за една година, а поръчките, филмовите субсидии и еврофондовете са натрупани за над десетилетие. Подредени са по източник, не по размер."
    : "The four streams sit on different bases and do NOT sum: the ministry budget is one year, while contracts, film subsidy and EU funds accumulate over more than a decade. They are ordered by source rather than by size.";
};

/** What a tile renders once the band has taken its headline.
 *
 *  ⚠️ THE TILE IS DEMOTED, THE BAND CELL IS NOT DROPPED — §3.1 rule 5, resolved the way the
 *  sibling hubs resolve it. `procurement` is the only one of the four that carries a tile
 *  figure today, and its secondary („N договора · M институции") is a different quantity
 *  from the € the band took, so it becomes the tile's headline: promoting a number moves it
 *  up the page rather than deleting it.
 *
 *  ⚠️ THE OTHER THREE RENDER BARE, and that is correct rather than a gap. `budget`,
 *  `subsidies` and `funds` have never carried a tile metric, so there is nothing to fall
 *  back to — and re-printing the band's own value under it is the duplication rule 5 exists
 *  to prevent. */
export const demotedMetric = (
  id: string,
  s: CultureHubStats | null | undefined,
  lang: string,
  bg: boolean,
): { metric?: string; metricCaption?: string } => {
  if (!s || id !== "procurement") return {};
  const int = (n: number) => formatInt(n, lang);
  return {
    metric: int(s.procurement.contracts),
    metricCaption: bg
      ? `договора · ${int(s.procurement.buyers)} институции`
      : `contracts · ${int(s.procurement.buyers)} institutions`,
  };
};

/** The head's evidence rail: the sector's biggest BUYERS by contract value.
 *
 *  ⚠️ BUYERS, NOT SUPPLIERS, AND THAT IS FORCED. `/procurement/contractors` is the national
 *  leaderboard of ~29,550 contractors and refuses `?sector` by design — `contractor_rank`
 *  has no buyer dimension — so a supplier rail would link to a page that cannot name its own
 *  rows, which is §3.1 rule 4 exactly. It is the same constraint that keeps the `contractors`
 *  tile figureless, and the tile's own comment records it.
 *
 *  ⚠️⚠️ ROW ONE IS THE MINISTRY, AND THE HEADING MUST NOT CALL THESE „ИНСТИТУТИ". The roster
 *  is `CULTURE_GROUP_EIKS`, which spans МК, its funders and the state institutes — so МК
 *  appears here as a BUYER of its own contracts (€62.8m over 324) rather than as the funder
 *  of the rest. „Най-големи възложители" is true of every row; „културните институти" is
 *  false of the largest one, which is the §0 shape this head is full of.
 *
 *  ⚠️ THE € IS THE SAME CORPUS THE BAND COUNTS — same `tag='contract'` filter, same roster —
 *  so the rail's rows sum to a part of the band's procurement cell rather than to some other
 *  number that happens to be about culture.
 *
 *  ⚠️ EVERY LINK CARRIES `?pscope=all`. Both destinations are parliament-scoped —
 *  `/awarder/:eik` and `/culture/procurement` each default to the selected election's
 *  window — while these figures are whole-corpus. Measured before the fix: the €43.7m НДК
 *  row landed on an awarder page showing ZERO contracts, and „всички поръчки в сектора"
 *  on €5.4m against the rail's €118.7m. That is the module's own rule, stated at length in
 *  `cultureRegistry.ts` and gated for the tiles by `cultureRegistry.test.ts`.
 *
 *  ⚠️ REFUSED WHEN THE ROWS ARE ABSENT rather than rendered empty: `topBuyers` is optional on
 *  the wire (this blob ships via `bucket:sync`, a different command from `npm run deploy`), so
 *  a bundle can load against a blob that predates it. An empty rail under a „biggest buyers"
 *  heading reads as „this sector has none". */
export const cultureHubEvidence = (
  s: CultureHubStats | null | undefined,
  lang: string,
  bg: boolean,
  awarderHref: (eik: string) => To,
): HubEvidence | undefined => {
  const rows = s?.topBuyers;
  if (!rows?.length) return undefined;
  return {
    heading: bg ? "Най-големи възложители" : "Largest contracting bodies",
    basis: bg
      ? "по стойност на договорите, натрупана за целия корпус — списъкът включва самото министерство, което е и най-големият възложител."
      : "by contract value, accumulated over the whole corpus. The roster includes the ministry itself, which is also the largest buyer.",
    rows: rows.map((r) => ({
      // The ЕИК, not the name: two bodies can share a name and React reuses the row.
      id: r.eik,
      label: r.name,
      value: formatEurCompact(r.eur, lang),
      // ⚠️ Through the shared helper, never a hand-built `/awarder/…`: a bare pathname
      // RESETS the active time scope on the destination.
      to: awarderHref(r.eik),
    })),
    action: {
      to: "/culture/procurement?pscope=all",
      label: bg ? "всички поръчки в сектора" : "all contracts in the sector",
    },
  };
};
