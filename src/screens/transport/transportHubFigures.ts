// The /sector/transport head and tile figures, as pure functions over the hub
// blob. Out of the component so hubHead.gates.test.ts can reach them (the roads
// and water hubs' convention). Copy lives here, not in the i18n corpus.
//
// Plan: docs/plans/transport-hub-v1.md §3. Five rules the code below follows:
//
// · Every figure is whole-corpus (the hub is unscoped) and every link to a scoped
//   page carries `?pscope=all`.
// · The four KPIs sit on FOUR BASES — the awarder-side Σ, a mode share with the
//   ministry's rail contracts re-attributed (D8), an ex-member competition rate,
//   and a SUBSET of the first (the in-group money, D4) — and are never summed or
//   netted (D5); the note under the band says so.
// · Single-bid is quoted beside the national rate on the SAME basis: consortium
//   member rows excluded on both sides, with the bid-known coverage named.
//   Transport competes BETTER than average (38% vs 42%) — read it aloud.
// · A figure the band shows is never also a tile metric (dashboard-hub §3.1-5):
//   the competition, in-group and contracts tiles share a destination with a
//   band cell and render descriptor-only.
// · KPI 1 and KPI 4 render at two decimals („€7,29 млрд.") — at one, the
//   headline reads €7,3 and hides the €1.06M Летище Пловдив joined with (D2),
//   and the in-group €1,1 reads as the pre-D4 figure.

import type { HubEvidence, HubKpi } from "@/ux/infographic/HubHead";
import type { TransportHubStats } from "@/data/transport/hubStats";
import { formatEurCompact, formatInt } from "@/lib/currency";
import { euFundsExcludedShort } from "@/lib/transportReferenceData";
import { isBg } from "@/i18n";
import {
  ALL,
  TRANSPORT_CONTRACTS_PATH,
  TRANSPORT_PATHS,
} from "./transportRegistry";

export const TRANSPORT_KPI_TO = {
  eur: TRANSPORT_CONTRACTS_PATH,
  rail: `${TRANSPORT_PATHS.procurement}${ALL}#modes`,
  singleBid: `${TRANSPORT_PATHS.procurement}${ALL}#competition`,
  inGroup: `${TRANSPORT_PATHS.procurement}${ALL}#contractors`,
} as const;

/** Tiles whose destination a band cell already owns — they render no metric. */
export const TRANSPORT_BAND_TILES = [
  "competition",
  "contracts",
  "ingroup",
] as const;

/** „€7,29 млрд." — compact, two decimals. */
export const eur2 = (n: number, lang: string): string =>
  `€${new Intl.NumberFormat(isBg(lang) ? "bg-BG" : "en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(n)}`;

const pct0 = (num: number, den: number, bg: boolean): string | null =>
  den > 0
    ? new Intl.NumberFormat(bg ? "bg-BG" : "en-GB", {
        maximumFractionDigits: 0,
      }).format((num / den) * 100) + "%"
    : null;

const years = (s: TransportHubStats): string | null => {
  const a = s.procurement.firstDate?.slice(0, 4);
  const b = s.procurement.lastDate?.slice(0, 4);
  return a && b ? `${a}–${b}` : null;
};

/** The re-attributed rail € (D8) and the Σ over every mode — the same total. */
export const railPair = (
  s: TransportHubStats,
): { rail: number; total: number; rawRail: number } => {
  const total = s.modes.reduce((a, m) => a + m.eur, 0);
  const r = s.modes.find((m) => m.universe === "rail");
  return { rail: r?.eur ?? 0, rawRail: r?.rawEur ?? 0, total };
};

export const transportHubKpis = (
  s: TransportHubStats | null | undefined,
  lang: string,
  bg: boolean,
): HubKpi[] => {
  if (!s) return [];
  const p = s.procurement;
  const out: HubKpi[] = [];
  const span = years(s);
  const bodies = s.bodyIndex.length;

  out.push({
    value: eur2(p.eur, lang),
    label: bg ? "обществени поръчки" : "public procurement",
    basis: bg
      ? `договори на ${bodies} структури на МТС${span ? `, ${span}` : ""}, текуща стойност след анекси`
      : `contracts of ${bodies} МТС bodies${span ? `, ${span}` : ""}, current value after annexes`,
    to: TRANSPORT_KPI_TO.eur,
  });

  const { rail, total } = railPair(s);
  const railShare = pct0(rail, total, bg);
  if (railShare)
    out.push({
      value: railShare,
      label: bg ? "за железниците" : "on the railways",
      basis: bg
        ? "вкл. договорите на МТС за жп превози и подвижен състав"
        : "incl. МТС's contracts for rail services and rolling stock",
      to: TRANSPORT_KPI_TO.rail,
    });

  const sector = pct0(p.singleBid, p.bidKnown, bg);
  const national = pct0(p.nationalSingleBid, p.nationalBidKnown, bg);
  const coverage = pct0(p.bidKnown, p.contracts, bg);
  if (sector)
    out.push({
      value: sector,
      label: bg ? "с една оферта" : "single-bidder",
      basis: [
        national
          ? bg
            ? `при ${national} средно за всички възложители`
            : `against ${national} across all buyers`
          : null,
        coverage
          ? bg
            ? `известен брой оферти за ${coverage} от договорите`
            : `bid count known for ${coverage} of contracts`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
      to: TRANSPORT_KPI_TO.singleBid,
    });

  if (s.inGroup.contracts > 0)
    out.push({
      value: eur2(s.inGroup.eur, lang),
      label: bg ? "в държавната група" : "inside the state group",
      // T7 (audit 2026-10-17): most of this is ONE multi-year estimate — the PSO
      // contract МТС → БДЖ-ПП — so the basis line says so.
      basis: [
        bg
          ? "договори между структури на МТС, вкл. ТСВ ЕАД; не се изваждат от общата сума"
          : "contracts between МТС bodies, incl. ТСВ ЕАД; not subtracted from the total",
        s.inGroup.psoEur
          ? bg
            ? `от тях ${eur2(s.inGroup.psoEur, lang)} е прогнозната стойност на договора за обществена услуга с БДЖ`
            : `of which ${eur2(s.inGroup.psoEur, lang)} is the estimated value of the public-service contract with БДЖ`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
      to: TRANSPORT_KPI_TO.inGroup,
    });

  return out;
};

/** The note under the band: what the four figures are, and what they are not. */
export const transportKpiNote = (bg: boolean): string =>
  bg
    ? "Четирите числа са на различна база и не се събират: общата стойност на поръчките, делът на железниците в нея (с договорите на министерството за жп превози и влакове), делът с една оферта (до средното за страната) и частта от същата обща сума, която остава между структурите на МТС. Пътищата са отделен сектор."
    : "The four figures sit on different bases and do not add up: the total procurement value, the railways' share of it (with the ministry's contracts for rail services and trains), the single-bid share (beside the national average) and the part of that same total that stays between МТС bodies. Roads are a separate sector.";

/** The evidence rail: the bodies that buy the most. */
export const transportHubEvidence = (
  s: TransportHubStats | null | undefined,
  lang: string,
  bg: boolean,
): HubEvidence | undefined => {
  const rows = s?.topBodies;
  if (!rows?.length) return undefined;
  return {
    heading: bg ? "Най-големите възложители" : "The largest buyers",
    basis: bg
      ? "по стойност на поръчките, за целия период; договорите на МТС за жп превози и влакове са в реда на министерството."
      : "by procurement value, over the whole period; МТС's rail-service and train contracts sit on the ministry's row.",
    rows: rows.map((r) => ({
      id: r.eik,
      label: r.name,
      value: formatEurCompact(r.eur, lang),
      to: `/awarder/${r.eik}${ALL}`,
    })),
    action: {
      to: `${TRANSPORT_PATHS.bodies}${ALL}`,
      label: bg ? "всички структури" : "every body",
    },
  };
};

/** One tile's metric, or nothing. `undefined` — never a 0 — when the blob is
 *  absent or the figure cannot be stated. */
export const transportTileMetric = (
  id: string,
  s: TransportHubStats | null | undefined,
  lang: string,
  bg: boolean,
):
  | { metric: string; metricCaption: string; metricSecondary?: string }
  | undefined => {
  if (!s) return undefined;
  const eur = (n: number) => formatEurCompact(n, lang);
  const int = (n: number) => formatInt(n, lang);
  const mode = (u: string) => s.modes.find((m) => m.universe === u);
  switch (id) {
    case "map": {
      const c = s.mapCoverage;
      const share = pct0(c.placedEur, c.totalEur, bg);
      return share
        ? {
            metric: share,
            metricCaption: bg
              ? "от стойността е на картата"
              : "of the value is on the map",
            metricSecondary: bg
              ? "останалото е мрежово — без едно място"
              : "the rest is network-wide, with no single place",
          }
        : undefined;
    }
    case "rail": {
      // The rail BODIES' own € — what /network?mode=rail filters to. The
      // re-attributed figure (KPI 2) adds the ministry's rail contracts, which the
      // map's mode filter cannot place; the secondary names the difference.
      const m = mode("rail");
      if (!m?.rawEur) return undefined;
      const moved = m.eur - m.rawEur;
      return {
        metric: eur(m.rawEur),
        metricCaption: bg
          ? "поръчки на жп структурите"
          : "procurement of the rail bodies",
        metricSecondary:
          moved > 0
            ? bg
              ? `и ${eur(moved)} на МТС за жп превози и влакове`
              : `plus ${eur(moved)} by МТС for rail services and trains`
            : undefined,
      };
    }
    case "maritime":
    case "aviation": {
      const m = mode(id);
      return m?.rawEur
        ? {
            metric: eur(m.rawEur),
            metricCaption:
              id === "maritime"
                ? bg
                  ? "поръчки за пристанища и Дунав"
                  : "procurement for ports and the Danube"
                : bg
                  ? "поръчки за въздушния транспорт"
                  : "procurement for aviation",
          }
        : undefined;
    }
    case "direct": {
      const d = s.direct;
      const share = pct0(d.directEur, d.knownEur, bg);
      const known = pct0(d.knownEur, s.procurement.eur, bg);
      return share
        ? {
            metric: share,
            metricCaption: bg
              ? "без предварително обявление"
              : "without a prior notice",
            metricSecondary: known
              ? bg
                ? `от стойността с известна процедура (${known} от общата)`
                : `of the value with a known procedure (${known} of the total)`
              : undefined,
          }
        : undefined;
    }
    case "top":
      return s.pso.contracts
        ? {
            metric: eur(s.pso.eur),
            metricCaption: bg
              ? `${int(s.pso.contracts)} многогодишни договора за обществена услуга`
              : `${int(s.pso.contracts)} multi-year public-service contracts`,
            metricSecondary: bg
              ? "прогнозна стойност за целия срок, не годишен разход"
              : "estimated value over the whole term, not annual spend",
          }
        : undefined;
    case "bodies": {
      const n = s.bodyIndex.length;
      const v = s.verifyIndex?.length ?? 0;
      return n
        ? {
            metric: int(n),
            metricCaption: bg ? "структури в сектора" : "bodies in the sector",
            metricSecondary: v
              ? bg
                ? `и ${int(v)} за проверка, извън сумата`
                : `and ${int(v)} to verify, outside the total`
              : undefined,
          }
        : undefined;
    }
    case "funds": {
      const f = s.euFunds;
      return f.grantEur > 0
        ? {
            metric: eur(f.grantEur),
            metricCaption: bg
              ? "безвъзмездна помощ (ИСУН)"
              : "grant aid (ИСУН)",
            // T2 (audit 2026-10-17): the RRP broadband project is out of the
            // sector, and the tile says so rather than silently shrinking.
            metricSecondary: f.excludedGrantEur
              ? bg
                ? `изплатени ${eur(f.paidEur)}; ${euFundsExcludedShort("bg")}`
                : `${eur(f.paidEur)} paid; ${euFundsExcludedShort("en")}`
              : bg
                ? `изплатени ${eur(f.paidEur)}, за целия програмен период`
                : `${eur(f.paidEur)} paid, over the whole programme period`,
          }
        : undefined;
    }
    default:
      // competition, contracts, ingroup: a band cell owns their destination.
      // subsidy: the blob carries no budget-law figure — /money's own source
      // (rail_subsidy.json) is the only honest one, and the hub does not fetch it.
      return undefined;
  }
};
