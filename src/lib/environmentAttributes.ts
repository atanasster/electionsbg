// Околна среда (МОСВ) procurement classification — the buyer-specific bit of the
// environment sector pack. Like the МО/МВР/transport packs the МОСВ group has no
// bespoke geometry: the model IS the generic per-category / per-supplier / per-year
// awarder model, so this file is a classifier (CPV → environmental function) plus a
// thin wrapper over `buildAwarderModel`. Labels kept local. Mirrors transportAttributes.ts.
//
// CPV COVERAGE, re-measured 2026-08-13 over the 28-EIK group: **96.6% of € and 99.2% of
// rows carry a CPV** — the corpus backfilled since the §0.5 note (which recorded МОСВ
// ~46% / ИАОС ~39% / ПУДООС ~33% on 2026-07-16) and that note is no longer true of any
// unit. „Друго" is now 10.1% and the FIFTH bucket, not the largest: ~3.4pp of it is the
// genuinely uncoded residue and the rest is divisions this classifier does not name.
// The tile still discloses the coverage, computed LIVE from the model (1 − other share),
// so no figure here is hard-coded — but do not reason from the old „under half" claim.
//
// Division 90 (екологични услуги) is the group's signature, so it is split on the
// 3-digit sub-group (90.4 отпадъчни води / 90.5 отпадъци / 90.6 санитария / 90.7
// екологичен мониторинг) rather than lumped — unlike the transport classifier which
// only needs the 2-digit division.

import type { ProcurementContract } from "@/data/dataTypes";
import {
  buildAwarderModel,
  buildAwarderModelFromAggregates,
  isSpendRow,
  type AwarderModel,
  type AwarderCategoryAgg,
  type GroupModelPayload,
  type SectorClassifier,
} from "./awarderModel";

export type EnvCategory =
  | "waste" // 90.5 отпадъци, 90.6 санитария/почистване
  | "water_treatment" // 90.4 отпадъчни води (ПСОВ услуги)
  | "monitoring" // 90.7 екологичен мониторинг/въздух + 38 апаратура + 50.4 сервиз на нея
  | "nature" // 77 залесяване, поддръжка на терени, паркове
  | "construction" // 45 строителство (ПСОВ, депа, сгради, терени)
  | "services" // 71 проектиране/надзор · 72 ИТ · 73 НИРД · 79 бизнес услуги · 48 софтуер · 50 ремонт/поддръжка
  | "supplies" // доставки — 09 горива/енергия · 30/31/33 оборудване · 34 МПС · 44 материали · 24 химия
  | "other";

export type EnvCategoryAgg = AwarderCategoryAgg<EnvCategory>;
export type EnvModel = AwarderModel<EnvCategory>;

/** CPV → environmental function. Divisions 90 and 50 are split on their 3-digit
 *  sub-group; the rest classify on the 2-digit division. */
export const categoryOfCpv = (cpv: string | undefined): EnvCategory => {
  const c = String(cpv ?? "").replace(/\s/g, "");
  if (!c) return "other";
  // Division 90 — екологични услуги (the group's signature), split by sub-group.
  if (c.startsWith("904")) return "water_treatment";
  if (c.startsWith("905") || c.startsWith("906")) return "waste";
  if (c.startsWith("907")) return "monitoring";
  // 50.4 — „ремонт и поддържане на прецизни апарати". For this group that is not
  // generic maintenance: 151 contracts / €6.8M, of which 99.6% is servicing of
  // MEASURING instrumentation — the монитoring networks themselves. Measured
  // 2026-08-13 by title: air 37.1% (АИС, газанализатори), radiation 19.7%
  // (the biggest single contract in the block is „Обновяване на Националната
  // автоматизирана система за непрекъснат контрол на радиационния гама-фон",
  // €1,016,758), water 7.7%, other lab/calibration 35.5%. So it is monitoring
  // across all three media, not air alone.
  //
  // Classing it as a service would keep €6.8M of the monitoring networks' upkeep
  // OUT of the „Мониторинг" figure EnvironmentAirMoneyTile prints beside the
  // measured ФПЧ10 — a figure that understated by 11.5% before this.
  if (c.startsWith("504")) return "monitoring";
  const div = c.slice(0, 2);
  // Measuring / lab / monitoring instruments (38) — the air-quality equipment line.
  if (div === "38") return "monitoring";
  // Construction works (45) — ПСОВ, landfills, park/terrain works, buildings.
  if (div === "45") return "construction";
  // Agricultural / forestry / horticultural — nature upkeep, afforestation (77).
  if (div === "77") return "nature";
  // Design & supervision (71), IT (72), R&D (73), business services (79),
  // software & information systems (48, beside 72), and the rest of repair &
  // maintenance (50 minus the 50.4 handled above — vehicles, boilers, building
  // installations). The sibling transport classifier maps 50 the same way.
  if (
    div === "71" ||
    div === "72" ||
    div === "73" ||
    div === "79" ||
    div === "48" ||
    div === "50"
  )
    return "services";
  // Supplies — fuel/energy (09), equipment (30/31/33), vehicles (34), materials
  // (44), chemicals (24).
  if (["09", "30", "31", "33", "34", "44", "24"].includes(div))
    return "supplies";
  return "other";
};

const CATEGORY_LABEL: Record<EnvCategory, { bg: string; en: string }> = {
  waste: { bg: "Отпадъци и санитария", en: "Waste & sanitation" },
  water_treatment: {
    bg: "Отпадъчни води (ПСОВ)",
    en: "Wastewater (treatment)",
  },
  monitoring: {
    bg: "Мониторинг и измерване",
    en: "Monitoring & measurement",
  },
  nature: { bg: "Природа и терени", en: "Nature & terrain" },
  construction: { bg: "Строителство", en: "Construction" },
  services: { bg: "Проектиране и услуги", en: "Design & services" },
  supplies: { bg: "Доставки", en: "Supplies" },
  other: { bg: "Друго", en: "Other" },
};

export const categoryLabel = (id: EnvCategory, lang: string): string =>
  (lang === "bg" ? CATEGORY_LABEL[id]?.bg : CATEGORY_LABEL[id]?.en) ?? id;

/** The CPV prefixes each category is built from — for deep-linking a category to
 *  `/procurement/contracts?cpv=<prefixes>` (the browse ORs the prefixes), reproducing
 *  the tile's split EXACTLY. Must mirror `categoryOfCpv` above, and
 *  `environmentAttributes.test.ts` fails if it stops doing so.
 *
 *  `other` has no prefixes and is therefore not deep-linkable — it is the sink for
 *  BOTH the uncoded rows (~3.4pp of the group's €) and every division this
 *  classifier does not name (~6.7pp), and neither is expressible as a prefix set. */
const CATEGORY_CPV_DIVS: Record<EnvCategory, string[]> = {
  waste: ["905", "906"],
  water_treatment: ["904"],
  monitoring: ["907", "38", "504"],
  nature: ["77"],
  construction: ["45"],
  // Division 50 is enumerated by sub-group rather than as a bare "50", because
  // these are PREFIXES the browse ORs: "50" would also match 504, which
  // categoryOfCpv sends to `monitoring`, and the deep-link would then select
  // rows the tile counted elsewhere. The list is every 3-digit group CPV-2008
  // defines under 50 EXCEPT 504 — a fixed standard, so this cannot silently
  // under-select the way a corpus-derived list would.
  services: [
    "71", "72", "73", "79", "48",
    "500", "501", "502", "503", "505", "506", "507", "508",
  ], // prettier-ignore
  supplies: ["09", "30", "31", "33", "34", "44", "24"],
  other: [],
};

export const categoryCpvDivs = (id: EnvCategory): string[] =>
  CATEGORY_CPV_DIVS[id] ?? [];

const environmentClassifier: SectorClassifier<EnvCategory> = {
  categoryOf: (c: ProcurementContract) => categoryOfCpv(c.cpv),
  order: [
    "waste",
    "water_treatment",
    "monitoring",
    "nature",
    "construction",
    "services",
    "supplies",
  ],
  sink: "other",
};

/** Build the environment model. Only tag='contract' rows carry money (awards/
 *  amendments would double-count), matching the awarder rollup the host shows. */
export const buildEnvironmentModel = (rows: ProcurementContract[]): EnvModel =>
  buildAwarderModel(
    rows.filter((c) => isSpendRow(c, true)),
    environmentClassifier,
  );

/** Same model, folded from the server's group aggregates (awarder-group-model)
 *  instead of raw rows — the tag='contract' filter lives in SQL there. */
export const buildEnvironmentModelFromAggregates = (
  p: GroupModelPayload,
): EnvModel => buildAwarderModelFromAggregates(p, environmentClassifier);
