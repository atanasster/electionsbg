// The /water head and tile figures, as pure functions over the hub blob. Out of
// the component so hubHead.gates.test.ts can reach them (the roads and culture
// hubs' convention). Copy lives here, not in the i18n corpus.
//
// Plan: docs/plans/water-hub-v1.md §3. Four rules the code below follows:
//
// · Every figure is whole-corpus (the hub is unscoped) and every link to a
//   scoped page carries `?pscope=all`.
// · The four KPIs sit on FOUR BASES — operator procurement, a national
//   competition rate, ИСУН programme funds and an НСИ population share — and
//   are never summed; the note under the band says so.
// · Single-bid is quoted beside the national rate on the SAME basis: consortium
//   member rows excluded on both sides (migration 167's ex-member keys, G3).
// · A figure the band shows is never also a tile metric (dashboard-hub §3.1-5):
//   the competition, funds and rationing tiles share a destination with a band
//   cell and render descriptor-only.

import type { HubEvidence, HubKpi } from "@/ux/infographic/HubHead";
import type { WaterHubStats } from "@/data/water/hubStats";
import { formatEurCompact, formatInt } from "@/lib/currency";
import { categoryLabel } from "@/lib/vikAttributes";
import { ALL, WATER_PATHS } from "./waterRegistry";

export const WATER_KPI_TO = {
  eur: `${WATER_PATHS.procurement}${ALL}`,
  singleBid: `${WATER_PATHS.procurement}${ALL}#competition`,
  funds: WATER_PATHS.funds,
  rationing: WATER_PATHS.services,
} as const;

/** Tiles whose destination a band cell already owns — they render no metric. */
export const WATER_BAND_TILES = ["competition", "funds", "rationing"] as const;

const pctOf = (num: number, den: number, bg: boolean): string | null =>
  den > 0
    ? new Intl.NumberFormat(bg ? "bg-BG" : "en-GB", {
        maximumFractionDigits: 1,
      }).format((num / den) * 100) + "%"
    : null;

const pct = (v: number | null | undefined, bg: boolean): string | null =>
  v == null
    ? null
    : new Intl.NumberFormat(bg ? "bg-BG" : "en-GB", {
        maximumFractionDigits: 1,
      }).format(v) + "%";

export const waterHubKpis = (
  s: WaterHubStats | null | undefined,
  lang: string,
  bg: boolean,
): HubKpi[] => {
  if (!s) return [];
  const p = s.procurement;
  const eur = (n: number) => formatEurCompact(n, lang);
  const out: HubKpi[] = [];
  const from = p.firstDate?.slice(0, 4);

  out.push({
    value: eur(p.eur),
    label: bg ? "поръчки на ВиК сектора" : "water-sector procurement",
    basis: bg
      ? `${s.register.eiks} възложители в сектора${from ? `, от ${from} г.` : ""} — текуща стойност след анекси`
      : `${s.register.eiks} buyers in the sector${from ? `, since ${from}` : ""} — current value after annexes`,
    to: WATER_KPI_TO.eur,
  });

  const sector = pctOf(p.singleBid, p.bidKnown, bg);
  const national = pctOf(p.nationalSingleBid, p.nationalBidKnown, bg);
  if (sector)
    out.push({
      value: sector,
      label: bg ? "с една оферта" : "single-bidder",
      basis: national
        ? bg
          ? `при ${national} средно за всички възложители; без редовете на участниците в обединения`
          : `against ${national} across all buyers; consortium-member rows excluded`
        : bg
          ? "от договорите с известен брой оферти"
          : "of contracts with a known bid count",
      to: WATER_KPI_TO.singleBid,
    });

  const e = s.euFunds;
  if (e.contractedEur > 0)
    out.push({
      value: eur(e.contractedEur),
      label: bg ? "договорени еврофондове" : "EU funds contracted",
      basis: bg
        ? `изплатени ${eur(e.paidEur)} — ${formatInt(e.beneficiaries, lang)} дружества в сектора, за целия програмен период (ИСУН)`
        : `${eur(e.paidEur)} paid — ${formatInt(e.beneficiaries, lang)} sector companies, over the whole programme period (ИСУН)`,
      to: WATER_KPI_TO.funds,
    });

  const r = s.services;
  const rationing = pct(r?.rationingPct, bg);
  if (r && rationing)
    out.push({
      value: rationing,
      label: bg ? "от населението с воден режим" : "of people under rationing",
      basis: bg
        ? `НСИ, ${r.year} г. — сезонен и целогодишен режим заедно`
        : `NSI, ${r.year} — seasonal and year-round together`,
      to: WATER_KPI_TO.rationing,
    });

  return out;
};

/** The note under the band: what the four figures are, and what they are not. */
export const waterKpiNote = (bg: boolean): string =>
  bg
    ? "Четирите числа са от различни източници и не се събират: поръчките на операторите, делът им с една оферта (в сравнение със средното за страната), европейски проекти (ИСУН) и дял от населението (НСИ). Почистването на речни корита е отделно — по предмет на договора, от всички възложители."
    : "The four figures come from different sources and do not add up: the operators' procurement, their single-bid share (beside the national average), EU projects (ИСУН) and a population share (NSI). Riverbed cleaning is separate — by contract subject, from every awarder.";

/** The evidence rail: the operators that buy the most. */
export const waterHubEvidence = (
  s: WaterHubStats | null | undefined,
  lang: string,
  bg: boolean,
): HubEvidence | undefined => {
  const rows = s?.topOperators;
  if (!rows?.length) return undefined;
  return {
    heading: bg ? "Най-големите оператори" : "The largest operators",
    basis: bg
      ? "по стойност на поръчките, за целия период; без Напоителни системи и язовирите, които не са ВиК оператори."
      : "by procurement value, over the whole period; excluding the irrigation and dams companies, which are not water operators.",
    rows: rows.map((r) => ({
      id: r.eik,
      label: r.name,
      value: formatEurCompact(r.eur, lang),
      to: `/awarder/${r.eik}${ALL}`,
    })),
    action: {
      to: `${WATER_PATHS.operators}${ALL}`,
      label: bg ? "всички оператори" : "every operator",
    },
  };
};

/** One tile's metric, or nothing. `undefined` — never a 0 — when the blob is
 *  absent or the figure cannot be stated. */
export const waterTileMetric = (
  id: string,
  s: WaterHubStats | null | undefined,
  lang: string,
  bg: boolean,
):
  | { metric: string; metricCaption: string; metricSecondary?: string }
  | undefined => {
  if (!s) return undefined;
  const eur = (n: number) => formatEurCompact(n, lang);
  const int = (n: number) => formatInt(n, lang);
  switch (id) {
    case "operators": {
      const r = s.register;
      if (!r.operators) return undefined;
      const dead = r.operators - r.liveOperators;
      return {
        metric: int(r.liveOperators),
        metricCaption: bg
          ? "работещи ВиК оператора"
          : "operating water utilities",
        metricSecondary: dead
          ? bg
            ? `още ${int(dead)} неработещи`
            : `${int(dead)} more not operating`
          : undefined,
      };
    }
    case "functions": {
      const top = s.functions
        .filter((f) => f.id !== "other")
        .sort((a, b) => b.eur - a.eur)[0];
      return top
        ? {
            metric: eur(top.eur),
            metricCaption: categoryLabel(top.id, bg ? "bg" : "en"),
          }
        : undefined;
    }
    case "contractors": {
      // Ex-self: the destination's in-window figure comes from the group model,
      // which drops awarder-as-own-contractor rows — so the tile states the same
      // number the card leads with at the all-time scope (G-C).
      const g = s.intraGroup;
      return g.contracts - g.selfContracts > 0
        ? {
            metric: eur(g.eur - g.selfEur),
            metricCaption: bg ? "остават в сектора" : "stay inside the sector",
            metricSecondary: bg
              ? `от тях ${eur(g.loansToHoldingEur)} заеми към холдинга`
              : `of which ${eur(g.loansToHoldingEur)} loans to the holding`,
          }
        : undefined;
    }
    case "contracts":
      return s.procurement.contracts
        ? {
            metric: int(s.procurement.contracts),
            metricCaption: bg ? "договора" : "contracts",
          }
        : undefined;
    case "access": {
      const t = pct(s.services?.wasteTreatmentPct, bg);
      return t && s.services
        ? {
            metric: t,
            metricCaption: bg
              ? `с пречистване на отпадъчните води, ${s.services.year}`
              : `with wastewater treatment, ${s.services.year}`,
          }
        : undefined;
    }
    case "riverbed":
      return s.riverbed.contracts
        ? {
            metric: eur(s.riverbed.eur),
            metricCaption: bg
              ? "за речни корита и дерета"
              : "on riverbeds and gullies",
            metricSecondary: [
              bg
                ? `${int(s.riverbed.contracts)} договора, всички възложители`
                : `${int(s.riverbed.contracts)} contracts, every awarder`,
              s.riverbed.corpusThrough
                ? `${bg ? "към" : "as of"} ${s.riverbed.corpusThrough.split("-").reverse().join(".")}`
                : null,
            ]
              .filter(Boolean)
              .join(" · "),
          }
        : undefined;
    default:
      // competition, funds, rationing: a band cell owns their destination.
      // map, holding: no hub figure is the destination's own.
      // sofia: its € is already the rail's first row — the rail's figures are
      // shown nowhere else on the head.
      return undefined;
  }
};
