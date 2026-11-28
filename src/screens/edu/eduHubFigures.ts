// The /sector/edu head and tile figures, as pure functions over the hub blob.
// Out of the component so hubHead.gates.test.ts can reach them (the roads /
// water / transport hubs' convention). Copy lives here, not in the i18n corpus.
//
// Rules the code below follows:
//
// · Every figure is whole-corpus (the hub is unscoped) and every link to a
//   scoped page carries `?pscope=all`.
// · The four KPIs sit on FOUR BASES — the awarder-side Σ, the universities'
//   share of it, an ex-member competition rate beside the rate of every OTHER
//   buyer on the same basis and window, and ИСУН grant aid (a different corpus) —
//   and are never summed; the note under the band says so.
// · The baseline is „the other buyers" (national − sector), un-divided pairs
//   from the blob, so both sides of the comparison are derived the same way.
// · A figure the band shows is never also a tile metric (dashboard-hub §3.1-5):
//   the competition and funds tiles share a destination with a band cell and
//   render descriptor-only.

import type { HubEvidence, HubKpi } from "@/ux/infographic/HubHead";
import type { EduHubStats } from "@/data/edu/hubStats";
import { formatEurCompact, formatInt } from "@/lib/currency";
import {
  EDU_ENTITIES,
  educationEntityByEik,
  type EducationUniverse,
} from "@/lib/educationReferenceData";
import { isBg } from "@/i18n";
import { ALL, EDU_CONTRACTS_PATH, EDU_PATHS } from "./eduRegistry";
import { eduPct } from "./eduSectorData";

export const EDU_KPI_TO = {
  eur: EDU_CONTRACTS_PATH,
  universities: `${EDU_PATHS.procurement}${ALL}#universes`,
  singleBid: `${EDU_PATHS.procurement}${ALL}#competition`,
  funds: `${EDU_PATHS.money}#funds`,
} as const;

/** Tiles whose destination a band cell already owns — they render no metric. */
export const EDU_BAND_TILES = ["competition", "funds"] as const;

/** „€2,15 млрд." — compact, two decimals. */
export const eur2 = (n: number, lang: string): string =>
  `€${new Intl.NumberFormat(isBg(lang) ? "bg-BG" : "en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(n)}`;

export const pct0 = (num: number, den: number, bg: boolean): string | null =>
  den > 0 ? eduPct(num / den, bg) : null;

const years = (s: EduHubStats): string | null => {
  const a = s.procurement.firstDate?.slice(0, 4);
  const b = s.procurement.lastDate?.slice(0, 4);
  return a && b ? `${a}–${b}` : null;
};

const universe = (s: EduHubStats, u: EducationUniverse) =>
  s.universes.find((x) => x.universe === u);

/** State universities in the roster (institutions, retired EIKs folded). */
const UNIVERSITY_COUNT = EDU_ENTITIES.filter(
  (e) => e.universe === "higher_education" && !e.retiredEikOf,
).length;

/** The single-bid pair of every buyer OUTSIDE the sector — national minus the
 *  sector, both on the ex-member basis and the same (whole-corpus) window. */
export const otherBuyersPair = (
  s: EduHubStats,
): { singleBid: number; bidKnown: number } => ({
  singleBid: s.procurement.nationalSingleBid - s.procurement.singleBid,
  bidKnown: s.procurement.nationalBidKnown - s.procurement.bidKnown,
});

export const eduHubKpis = (
  s: EduHubStats | null | undefined,
  lang: string,
  bg: boolean,
): HubKpi[] => {
  if (!s) return [];
  const p = s.procurement;
  const out: HubKpi[] = [];
  const span = years(s);

  out.push({
    value: eur2(p.eur, lang),
    label: bg ? "обществени поръчки" : "public procurement",
    basis: bg
      ? `договори на ${formatInt(p.institutions, lang)} институции${span ? `, ${span}` : ""}, текуща стойност след анекси`
      : `contracts of ${formatInt(p.institutions, lang)} institutions${span ? `, ${span}` : ""}, current value after annexes`,
    to: EDU_KPI_TO.eur,
  });

  const uni = universe(s, "higher_education");
  const uniShare = uni ? pct0(uni.eur, p.eur, bg) : null;
  if (uniShare)
    out.push({
      value: uniShare,
      label: bg ? "университетите" : "the universities",
      basis: bg
        ? `дял на ${UNIVERSITY_COUNT}-те държавни висши училища в поръчките на групата`
        : `the share of the ${UNIVERSITY_COUNT} state universities in the group's procurement`,
      to: EDU_KPI_TO.universities,
    });

  const sector = pct0(p.singleBid, p.bidKnown, bg);
  const other = otherBuyersPair(s);
  const others = pct0(other.singleBid, other.bidKnown, bg);
  const coverage = pct0(p.bidKnown, p.contracts, bg);
  if (sector)
    out.push({
      value: sector,
      label: bg ? "с една оферта" : "single-bidder",
      basis: [
        others
          ? bg
            ? `при ${others} средно за останалите възложители`
            : `against ${others} for every other buyer`
          : null,
        coverage
          ? bg
            ? `известен брой оферти за ${coverage} от договорите`
            : `bid count known for ${coverage} of contracts`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
      to: EDU_KPI_TO.singleBid,
    });

  if (s.euFunds.grantEur > 0)
    out.push({
      value: eur2(s.euFunds.grantEur, lang),
      label: bg ? "евросредства" : "EU funds",
      basis: bg
        ? "безвъзмездна финансова помощ по договори в ИСУН на същите институции; не се събира с поръчките"
        : "grant aid on ИСУН contracts of the same institutions; not added to procurement",
      to: EDU_KPI_TO.funds,
    });

  return out;
};

/** The note under the band: what the four figures are, and what they are not. */
export const eduKpiNote = (bg: boolean): string =>
  bg
    ? "Четирите числа са на различна база и не се събират: общата стойност на поръчките, делът на университетите в нея, делът с една оферта (до този на всички останали възложители за същия период) и европейската безвъзмездна помощ за същите институции, която е друг корпус. Общинските училища не са в сектора."
    : "The four figures sit on different bases and do not add up: the total procurement value, the universities' share of it, the single-bid share (beside that of every other buyer over the same window) and the EU grant aid to the same institutions, which is a different corpus. Municipal schools are not in the sector.";

/** The evidence rail: the institutions that buy the most. */
export const eduHubEvidence = (
  s: EduHubStats | null | undefined,
  lang: string,
  bg: boolean,
): HubEvidence | undefined => {
  const rows = s?.topBodies;
  if (!rows?.length) return undefined;
  return {
    heading: bg ? "Най-големите възложители" : "The largest buyers",
    basis: bg
      ? "по стойност на поръчките, за целия период; поръчките под стар ЕИК са към наследника."
      : "by procurement value, over the whole period; contracts under a retired ЕИК sit on its successor.",
    rows: rows.slice(0, 5).map((r) => ({
      id: r.eik,
      label: educationEntityByEik(r.eik)?.name ?? r.name,
      value: formatEurCompact(r.eur, lang),
      to: `/awarder/${r.eik}${ALL}`,
    })),
    action: {
      to: `${EDU_PATHS.bodies}${ALL}`,
      label: bg ? "всички институции" : "every institution",
    },
  };
};

/** One tile's metric, or nothing. `undefined` — never a 0 — when the blob is
 *  absent or the figure cannot be stated. */
export const eduTileMetric = (
  id: string,
  s: EduHubStats | null | undefined,
  lang: string,
  bg: boolean,
):
  | { metric: string; metricCaption: string; metricSecondary?: string }
  | undefined => {
  if (!s) return undefined;
  const eur = (n: number) => formatEurCompact(n, lang);
  const int = (n: number) => formatInt(n, lang);
  switch (id) {
    case "universities":
    case "ministry":
    case "ban": {
      const u = universe(
        s,
        id === "universities"
          ? "higher_education"
          : id === "ministry"
            ? "ministry"
            : "research_ban",
      );
      return u?.eur
        ? {
            metric: eur(u.eur),
            metricCaption: bg
              ? `по ${int(u.contracts)} договора`
              : `over ${int(u.contracts)} contracts`,
          }
        : undefined;
    }
    case "bodies": {
      const n = s.bodyIndex.length;
      const v = s.verifyIndex.length;
      return n
        ? {
            metric: int(n),
            metricCaption: bg
              ? "институции в сектора"
              : "institutions in the sector",
            metricSecondary: v
              ? bg
                ? `и ${int(v)} за проверка, извън сумата`
                : `and ${int(v)} to verify, outside the total`
              : undefined,
          }
        : undefined;
    }
    case "buses": {
      const b = s.buses;
      const single = pct0(b.singleBid, b.bidKnown, bg);
      return b.eur
        ? {
            metric: eur(b.eur),
            metricCaption: bg
              ? `${int(b.contracts)} договора за автобуси`
              : `${int(b.contracts)} bus contracts`,
            metricSecondary: single
              ? bg
                ? `${single} с една оферта`
                : `${single} single-bid`
              : undefined,
          }
        : undefined;
    }
    case "top": {
      const t = s.topProcurements[0];
      return t
        ? {
            metric: eur(t.eur),
            metricCaption: bg
              ? `най-голямата поръчка${t.lots > 1 ? `, ${int(t.lots)} позиции` : ""}`
              : `the largest procurement${t.lots > 1 ? `, ${int(t.lots)} lots` : ""}`,
          }
        : undefined;
    }
    case "research": {
      const ban = universe(s, "research_ban")?.eur ?? 0;
      const ssa = universe(s, "research_ssa")?.eur ?? 0;
      return ban + ssa > 0
        ? {
            metric: eur(ban + ssa),
            metricCaption: bg
              ? "поръчки на БАН и ССА"
              : "procurement of БАН and the Agricultural Academy",
          }
        : undefined;
    }
    default:
      // competition, funds: a band cell owns their destination. textbooks,
      // budget, schools: their figures live in other corpora the hub does not
      // fetch.
      return undefined;
  }
};
