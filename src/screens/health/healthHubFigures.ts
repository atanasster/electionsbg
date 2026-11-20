// The /sector/health head and tile figures, as pure functions over the hub blob.
// Out of the component so the gates can reach them (the roads / water /
// transport / edu hubs' convention). Copy lives here, not in the i18n corpus.
//
// Plan: docs/plans/health-hub-v1.md §3 (Head). Rules the code below follows:
//
// · KPIs 1–3 share ONE year (the blob's `year`, complete in every corpus); KPI 4
//   is the procurement corpus over all years. Every link to the scoped
//   /procurement page carries `?pscope=all`.
// · KPI 2 (hospital care + devices) and KPI 3 (every reimbursed medicine) are
//   DISJOINT PARTS of KPI 1 — the generator asserts their sum stays below it.
//   KPI 4 is a different corpus and basis. The note under the band says the
//   four are never summed.
// · The competition baseline is „the other buyers" (national − sector), the
//   un-divided ex-member pairs from the blob, on the same window as the figure.
// · A figure the band shows is never also a tile metric (dashboard-hub §3.1-5):
//   the tiles that share a destination with a band cell render descriptor-only.

import type { HubEvidence, HubKpi } from "@/ux/infographic/HubHead";
import type { HealthHubStats } from "@/data/health/hubStats";
import { formatEurCompact, formatInt } from "@/lib/currency";
import { isBg } from "@/i18n";
import { ALL, HEALTH_PATHS } from "./healthRegistry";
import { healthPct } from "./healthSectorData";

export const HEALTH_KPI_TO = {
  nzok: `${HEALTH_PATHS.money}#nzok-budget`,
  hospitals: `${HEALTH_PATHS.hospitals}#payments`,
  medicines: `${HEALTH_PATHS.drugs}#pharmacy`,
  procurement: `${HEALTH_PATHS.procurement}${ALL}`,
} as const;

/** Tiles whose destination a band cell already owns — they render no metric. */
export const HEALTH_BAND_TILES = [
  "payments",
  "pharmacy",
  "nzok-budget",
] as const;

/** „€4,72 млрд." — compact, two decimals. */
export const eur2 = (n: number, lang: string): string =>
  `€${new Intl.NumberFormat(isBg(lang) ? "bg-BG" : "en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(n)}`;

/** A whole-number percentage, or null on an empty denominator. */
export const pct = (num: number, den: number, bg: boolean, digits = 0) =>
  den > 0 ? healthPct(num / den, bg, digits) : null;

const span = (s: HealthHubStats): string | null => {
  const a = s.procurement.firstDate?.slice(0, 4);
  const b = s.procurement.lastDate?.slice(0, 4);
  return a && b ? `${a}–${b}` : null;
};

/** Every buyer OUTSIDE the sector — national minus the sector, ex-member basis,
 *  same (whole-corpus) window. */
export const otherBuyersPair = (
  s: HealthHubStats,
): { singleBid: number; bidKnown: number } => ({
  singleBid: s.procurement.nationalSingleBid - s.procurement.singleBid,
  bidKnown: s.procurement.nationalBidKnown - s.procurement.bidKnown,
});

export const healthHubKpis = (
  s: HealthHubStats | null | undefined,
  lang: string,
  bg: boolean,
): HubKpi[] => {
  if (!s) return [];
  const int = (n: number) => formatInt(n, lang);
  const out: HubKpi[] = [];

  out.push({
    value: eur2(s.nzok.expenditureEur, lang),
    label: bg ? "разходи на здравната каса" : "health fund spending",
    basis: bg
      ? `касови разходи на НЗОК за ${s.year} г., месечен отчет B1`
      : `НЗОК cash expenditure in ${s.year}, monthly report B1`,
    to: HEALTH_KPI_TO.nzok,
  });

  if (s.payments.careEur > 0)
    out.push({
      value: eur2(s.payments.careEur, lang),
      label: bg
        ? `към ${int(s.payments.careFacilities)} болници`
        : `to ${int(s.payments.careFacilities)} hospitals`,
      basis: bg
        ? `плащания по договори с НЗОК за ${s.year} г.: болнична помощ и медицински изделия · лечебни заведения с поне едно плащане`
        : `payments under НЗОК contracts in ${s.year}: hospital care and medical devices · facilities with at least one payment`,
      to: HEALTH_KPI_TO.hospitals,
    });

  if (s.medicines.eur > 0)
    out.push({
      value: eur2(s.medicines.eur, lang),
      label: bg ? "лекарства" : "medicines",
      basis: bg
        ? `всички реимбурсирани лекарства — в аптеките и в болниците, ${int(s.medicines.inns)} активни вещества, ${s.year} г.`
        : `every reimbursed medicine — in pharmacies and in hospitals, ${int(s.medicines.inns)} active substances, ${s.year}`,
      to: HEALTH_KPI_TO.medicines,
    });

  const p = s.procurement;
  if (p.eur > 0) {
    const yrs = span(s);
    const sector = pct(p.singleBid, p.bidKnown, bg);
    const o = otherBuyersPair(s);
    const others = pct(o.singleBid, o.bidKnown, bg);
    out.push({
      value: eur2(p.eur, lang),
      label: bg ? "обществени поръчки" : "public procurement",
      basis: [
        bg
          ? `договори на касата, МЗ и ведомствата му${yrs ? `, ${yrs}` : ""}, без тавана на рамковите споразумения`
          : `contracts of the fund, the Ministry of Health and its bodies${yrs ? `, ${yrs}` : ""}, framework ceilings excluded`,
        sector
          ? bg
            ? `${sector} с една оферта${others ? ` при ${others} за останалите възложители` : ""}`
            : `${sector} single-bid${others ? ` against ${others} for every other buyer` : ""}`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
      to: HEALTH_KPI_TO.procurement,
    });
  }
  return out;
};

/** The note under the band: what the four figures are, and what they are not. */
export const healthKpiNote = (bg: boolean): string =>
  bg
    ? "Плащанията към болниците и лекарствата са части от разходите на касата — платени от тях, без да се припокриват. Поръчките са друг регистър и друга база. Четирите числа не се събират. Поръчките на самите болници не са в сектора: те са дружества, на които касата плаща."
    : "The payments to hospitals and the medicines are parts of the fund's spending — paid out of it, without overlapping. Procurement is a different register on a different basis. The four figures are never added up. The hospitals' own procurement is not in the sector: they are companies the fund pays.";

/** The evidence rail: the hospitals the fund paid most in `year`. */
export const healthHubEvidence = (
  s: HealthHubStats | null | undefined,
  lang: string,
  bg: boolean,
): HubEvidence | undefined => {
  const rows = s?.topHospitals;
  if (!s || !rows?.length) return undefined;
  return {
    heading: bg ? "Болниците с най-много плащания" : "The hospitals paid most",
    basis: bg
      ? `по плащания от НЗОК за ${s.year} г., всички потоци; по юридическо лице`
      : `by НЗОК payments in ${s.year}, every stream; by legal entity`,
    rows: rows.slice(0, 5).map((r) => ({
      id: r.eik,
      label: r.name,
      value: formatEurCompact(r.eur, lang),
      to: `/company/${r.eik}`,
    })),
    action: {
      to: `${HEALTH_PATHS.hospitals}#payments`,
      label: bg ? "всички болници" : "every hospital",
    },
  };
};

/** One tile's metric, or nothing. `undefined` — never a 0 — when the blob is
 *  absent or the figure cannot be stated. */
export const healthTileMetric = (
  id: string,
  s: HealthHubStats | null | undefined,
  lang: string,
  bg: boolean,
):
  | { metric: string; metricCaption: string; metricSecondary?: string }
  | undefined => {
  if (!s) return undefined;
  const eur = (n: number) => formatEurCompact(n, lang);
  const int = (n: number) => formatInt(n, lang);
  switch (id) {
    case "hospital-drugs": {
      const d = s.payments.byStream.find((x) => x.stream === "drugs");
      return d?.eur
        ? {
            metric: eur(d.eur),
            metricCaption: bg
              ? `към ${int(d.facilities)} болници, ${s.year} г.`
              : `to ${int(d.facilities)} hospitals, ${s.year}`,
          }
        : undefined;
    }
    case "spine": {
      const y = s.byYear.find((r) => r.year === String(s.year));
      return y?.eur
        ? {
            metric: eur(y.eur),
            metricCaption: bg
              ? `поръчки за ${s.year} г., ${int(y.contracts)} договора`
              : `procurement in ${s.year}, ${int(y.contracts)} contracts`,
          }
        : undefined;
    }
    case "frameworks": {
      const p = s.procurement;
      return p.frameworkCeilingEur > 0
        ? {
            metric: eur(p.frameworkCeilingEur),
            metricCaption: bg
              ? `таван на ${int(p.frameworkCeilingContracts)} рамкови дяла — не похарчени пари`
              : `ceiling of ${int(p.frameworkCeilingContracts)} framework shares — not money spent`,
          }
        : undefined;
    }
    case "funds": {
      const f = s.euFunds;
      return f.grantEur > 0
        ? {
            metric: eur(f.grantEur),
            metricCaption: bg
              ? `безвъзмездна помощ по ${int(f.projects)} договора в ИСУН`
              : `grant aid on ${int(f.projects)} ИСУН contracts`,
          }
        : undefined;
    }
    default:
      // payments, pharmacy, nzok-budget: a band cell owns their destination.
      // map, momentum, ownership, trend, overpay: their figures live in
      // corpora the hub does not fetch.
      return undefined;
  }
};
