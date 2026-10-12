// The /sector/roads head and tile figures, as pure functions over the hub blob.
// Out of the component so hubHead.gates.test.ts can reach them (the culture
// hub's convention). Copy lives here, not in the i18n corpus.
//
// Plan: docs/plans/roads-hub-v1.md §3. Four rules the code below follows:
//
// · Every figure is whole-corpus (the hub is unscoped) and every link carries
//   `?pscope=all`, or it lands on the selected parliament's ~2.6% slice.
// · The headline is CURRENT VALUE AFTER ANNEXES (D6), and its basis says so.
// · Single-bid is quoted beside the national rate on the SAME basis (consortium
//   member rows excluded on both sides) — roads competes BETTER than average
//   (≈26% vs ≈42%), so the figure alone would read as an indictment it is not.
// · A figure the band shows is never also a tile metric (dashboard-hub §3.1-5):
//   the competition and contractors tiles share a destination with a band cell
//   and render descriptor-only.

import type { HubEvidence, HubKpi } from "@/ux/infographic/HubHead";
import type { RoadsHubStats } from "@/data/roads/hubStats";
import { formatEurCompact, formatInt } from "@/lib/currency";
import { ALL, ROADS_PATHS } from "./roadsRegistry";

export const ROADS_KPI_TO = {
  eur: "/procurement/contracts?sector=roads&pscope=all",
  singleBid: "/procurement/contracts?sector=roads&single=1&pscope=all",
  direct: "/procurement/contracts?sector=roads&proc=direct&pscope=all",
  contractors: `${ROADS_PATHS.procurement}${ALL}#contractors`,
} as const;

/** Tiles whose destination a band cell already owns — they render no metric. */
export const ROADS_BAND_TILES = ["competition", "contractors"] as const;

const pctOf = (num: number, den: number, bg: boolean): string | null =>
  den > 0
    ? new Intl.NumberFormat(bg ? "bg-BG" : "en-GB", {
        maximumFractionDigits: 1,
      }).format((num / den) * 100) + "%"
    : null;

const years = (s: RoadsHubStats): string | null => {
  const a = s.firstDate?.slice(0, 4);
  const b = s.lastDate?.slice(0, 4);
  return a && b ? `${a}–${b}` : null;
};

export const roadsHubKpis = (
  s: RoadsHubStats | null | undefined,
  lang: string,
  bg: boolean,
): HubKpi[] => {
  if (!s) return [];
  const p = s.procurement;
  const eur = (n: number) => formatEurCompact(n, lang);
  const int = (n: number) => formatInt(n, lang);
  const out: HubKpi[] = [];
  const span = years(s);

  out.push({
    value: eur(p.eur),
    label: bg ? "договори за пътища" : "road contracts",
    basis: bg
      ? `АПИ и НКСИП${span ? `, ${span}` : ""} — текуща стойност след анекси`
      : `АПИ and НКСИП${span ? `, ${span}` : ""} — current value after annexes`,
    to: ROADS_KPI_TO.eur,
  });

  const sector = pctOf(p.singleBid, p.bidKnown, bg);
  const national = pctOf(p.nationalSingleBid, p.nationalBidKnown, bg);
  if (sector)
    out.push({
      value: sector,
      label: bg ? "с една оферта" : "single-bidder",
      basis: national
        ? bg
          ? `при ${national} средно за всички възложители; вкл. законови изключения`
          : `against ${national} across all buyers; incl. statutory exceptions`
        : bg
          ? "от договорите с известен брой оферти"
          : "of contracts with a known bid count",
      to: ROADS_KPI_TO.singleBid,
    });

  const direct = pctOf(p.directEur, p.eur, bg);
  // The denominator is ALL value, and about a third of it carries no recorded
  // procedure — so the share is a floor, and the basis says how much is unknown.
  const unknownPct = p.unknownMethodEur
    ? pctOf(p.unknownMethodEur, p.eur, bg)
    : null;
  if (direct)
    out.push({
      value: direct,
      label: bg ? "без обявена процедура" : "without an open call",
      basis: unknownPct
        ? bg
          ? `${eur(p.directEur)} — пряко възлагане и договаряне без обявление; за ${unknownPct} от стойността процедурата не е посочена`
          : `${eur(p.directEur)} — direct awards and negotiation without notice; ${unknownPct} of the value records no procedure`
        : bg
          ? `${eur(p.directEur)} от стойността — пряко възлагане и договаряне без обявление`
          : `${eur(p.directEur)} of the value — direct awards and negotiation without notice`,
      to: ROADS_KPI_TO.direct,
    });

  out.push({
    value: int(p.contractors),
    label: bg ? "изпълнители" : "contractors",
    // Not the in-house share: the in-house tile carries that figure (§3.1-5).
    basis: bg
      ? "фирми и обединения с договор — без €0 дялове в обединения"
      : "firms and consortia holding a contract — no €0 consortium shares",
    to: ROADS_KPI_TO.contractors,
  });

  return out;
};

/** The note under the band: what the headline is, and what it is not. */
export const roadsKpiNote = (bg: boolean): string =>
  bg
    ? "Сумата е текущата стойност на договорите след анекси — ръстът по анекс се отнася към годината на подписване. Еврофондовете по-долу са друг корпус и не се събират с нея."
    : "The total is the contracts' current value after annexes — annex growth is booked to the signing year. The EU funds below are a different corpus and do not add to it.";

/** The evidence rail: the corridors that took the most money. */
export const roadsHubEvidence = (
  s: RoadsHubStats | null | undefined,
  lang: string,
  bg: boolean,
): HubEvidence | undefined => {
  const rows = s?.topCorridors;
  if (!rows?.length || !s) return undefined;
  const cov = pctOf(s.coverage.refCoverageEur, 1, bg);
  return {
    heading: bg ? "Коридори по вложени средства" : "Corridors by money spent",
    basis: bg
      ? `по договорите с разпознат път${cov ? ` (${cov} от стойността)` : ""}; останалото са областни и мрежови поръчки без единен коридор.`
      : `from contracts naming a road${cov ? ` (${cov} of the value)` : ""}; the rest are regional and network-wide lots with no single corridor.`,
    rows: rows.map((r) => ({
      id: r.corridor,
      label: r.corridor,
      value: formatEurCompact(r.eur, lang),
      to: `${ROADS_PATHS.network}?corridor=${encodeURIComponent(r.corridor)}&pscope=all`,
    })),
    action: {
      to: `${ROADS_PATHS.network}${ALL}`,
      label: bg ? "цялата мрежа на карта" : "the whole network on a map",
    },
  };
};

/** One tile's metric, or nothing. `undefined` — never a 0 — when the blob is
 *  absent or the figure cannot be stated. */
export const roadsTileMetric = (
  id: string,
  s: RoadsHubStats | null | undefined,
  lang: string,
  bg: boolean,
):
  | { metric: string; metricCaption: string; metricSecondary?: string }
  | undefined => {
  if (!s) return undefined;
  const eur = (n: number) => formatEurCompact(n, lang);
  const int = (n: number) => formatInt(n, lang);
  switch (id) {
    case "spend": {
      const y = s.peakYear;
      if (!y) return undefined;
      return {
        metric: eur(y.eur),
        metricCaption: bg
          ? `${y.year} — най-силната година`
          : `${y.year} — the peak year`,
        metricSecondary:
          y.growthEur > 0
            ? bg
              ? `от тях ${eur(y.growthEur)} ръст по анекси`
              : `of which ${eur(y.growthEur)} annex growth`
            : undefined,
      };
    }
    case "network": {
      const cov = pctOf(s.coverage.refCoverageEur, 1, bg);
      return cov
        ? {
            metric: cov,
            metricCaption: bg
              ? "от стойността — с назован път"
              : "of the value names a road",
          }
        : undefined;
    }
    case "costs":
      return s.coverage.perKmRows
        ? {
            metric: int(s.coverage.perKmRows),
            metricCaption: bg
              ? "договора със защитима цена/км"
              : "contracts with a defensible €/km",
          }
        : undefined;
    case "funds":
      return s.euFunds.projects
        ? {
            metric: eur(s.euFunds.totalEur),
            metricCaption: bg
              ? "общ бюджет на проекти"
              : "total project budget",
            metricSecondary: bg
              ? `${int(s.euFunds.projects)} проекта · изплатени ${eur(s.euFunds.paidEur)}`
              : `${int(s.euFunds.projects)} projects · ${eur(s.euFunds.paidEur)} paid`,
          }
        : undefined;
    case "risk": {
      const n = (s.riskGrades.D ?? 0) + (s.riskGrades.E ?? 0);
      return n
        ? {
            metric: int(n),
            metricCaption: bg ? "с оценка D или E" : "graded D or E",
          }
        : undefined;
    }
    case "options": {
      // ⚠️ THE CLUSTER IS NOT ALL OPTIONS: 12 of 45 cite unforeseeable circumstances
      // (т. 3). The metric is the OPTION part only, and the rest is named beside it —
      // „ръст по опции" over the whole €1.02bn would assert a ground 12 annexes do not.
      const o = s.annexOptions;
      if (!o.contracts) return undefined;
      const opt = o.byReason.find((r) => r.reason === "option");
      const rest = o.growthEur - (opt?.growthEur ?? 0);
      const share = pctOf(o.growthEur, o.nationalGrowthEur, bg);
      return {
        metric: eur(opt?.growthEur ?? 0),
        metricCaption: bg
          ? "ръст по клауза за опция"
          : "growth under an option clause",
        metricSecondary: bg
          ? `+ ${eur(rest)} по други основания · ${int(o.contracts)} договора${share ? ` · ${share} от всички в страната` : ""}`
          : `+ ${eur(rest)} on other grounds · ${int(o.contracts)} contracts${share ? ` · ${share} of all nationally` : ""}`,
      };
    }
    case "inhouse": {
      const share = pctOf(s.inhouse.eur, s.procurement.eur, bg);
      return s.inhouse.eur
        ? {
            metric: eur(s.inhouse.eur),
            metricCaption: bg ? "като изпълнител" : "as a contractor",
            metricSecondary: share
              ? bg
                ? `${int(s.inhouse.contracts)} договора · ${share} от сектора`
                : `${int(s.inhouse.contracts)} contracts · ${share} of the sector`
              : undefined,
          }
        : undefined;
    }
    default:
      // competition, contractors: a band cell owns their destination.
      // tenders, awarder, regions: no hub figure is the destination's own.
      return undefined;
  }
};
