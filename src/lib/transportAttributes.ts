// Транспорт procurement classification — the buyer-specific bit of the transport
// sector pack. Like the МО/МВР packs the transport group has no bespoke geometry:
// the model IS the generic per-category / per-supplier / per-year awarder model, so
// this file is a classifier (CPV division → transport operating function) plus a thin
// wrapper over `buildAwarderModel`. Labels kept local. Mirrors securityAttributes.ts.
//
// Category order is grounded in what the transport group actually buys: rolling stock
// (trains/buses/ships — the БДЖ/Шкода line), rail & port CONSTRUCTION (track, stations,
// quays — the НКЖИ + EU-funded line), transport SERVICES (bus/rail operations, toll,
// postal/telecom "съобщения"), signalling & IT, maintenance, design & supervision,
// fuel & energy, materials/supplies. Contracts with no CPV fall to the "other" sink.

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
import { TRANSPORT_EIK, transportUniverseOf } from "./transportReferenceData";
import type { TransportUniverse } from "./transportReferenceData";
import { procedureBucket } from "./cpvSectors";

export type TransportCategory =
  | "rolling_stock" // 34 — влакове, вагони, локомотиви, автобуси, кораби, самолети
  | "construction" // 45 — жп линии, гари, мостове, пристанища, летищна инфраструктура
  | "transport_services" // 60/63/64 — превози, спомагателни транспортни услуги, съобщения
  | "signalling_it" // 48/72/32/31/30 — сигнализация, ИТ, телеком, електроника
  | "maintenance" // 50 — ремонт и поддръжка на подвижен състав и инфраструктура
  | "design" // 71 — проектиране, инженеринг и строителен надзор
  | "fuel_energy" // 09 — горива и електроенергия (тяга)
  | "supplies" // 44/14/24/19 — материали, релси, химия, текстил
  | "other";

export type TransportCategoryAgg = AwarderCategoryAgg<TransportCategory>;
export type TransportModel = AwarderModel<TransportCategory>;

/** CPV prefix → category, the ONE table both `categoryOfCpv` and the deep-link
 *  mirror `categoryCpvDivs` read, so the tile's split and the browse it links to
 *  cannot disagree. Longest prefix wins.
 *
 *  Division 34 is NOT all vehicles (transport-hub-v1 A3): 3494 is rail track
 *  material (sleepers, switch parts, fastenings — €156.7M all-time) and 3496 is
 *  airport / air-traffic-control equipment (the Saab digital tower — €31.6M). Both
 *  sat in „Подвижен състав" and made it 45% not vehicles at the default scope.
 *  CPV 64 (postal & telecom services) is signalling/IT, not transport services: the
 *  „съобщения" half of МТС is outside the sector (D1). */
const CATEGORY_PREFIXES: [string, TransportCategory][] = [
  ["34942", "signalling_it"], // signalling equipment, inside 3494's track material
  ["34943", "signalling_it"], // train-monitoring equipment
  ["3494", "supplies"],
  ["3496", "signalling_it"],
  ["34", "rolling_stock"],
  ["45", "construction"],
  ["60", "transport_services"],
  ["63", "transport_services"],
  ["64", "signalling_it"],
  ["48", "signalling_it"],
  ["72", "signalling_it"],
  ["32", "signalling_it"],
  ["31", "signalling_it"],
  ["30", "signalling_it"],
  ["50", "maintenance"],
  ["71", "design"],
  ["09", "fuel_energy"],
  ["44", "supplies"],
  ["14", "supplies"],
  ["24", "supplies"],
  ["19", "supplies"],
];
const BY_LENGTH = [...CATEGORY_PREFIXES].sort(
  (x, y) => y[0].length - x[0].length,
);

const normCpv = (cpv: string | null | undefined): string =>
  String(cpv ?? "").replace(/\s/g, "");

/** CPV code → transport operating function, by longest matching prefix. */
export const categoryOfCpv = (cpv: string | undefined): TransportCategory => {
  const c = normCpv(cpv);
  if (!c) return "other";
  return BY_LENGTH.find(([p]) => c.startsWith(p))?.[1] ?? "other";
};

const CATEGORY_LABEL: Record<TransportCategory, { bg: string; en: string }> = {
  rolling_stock: {
    bg: "Подвижен състав и превозни средства",
    en: "Rolling stock & vehicles",
  },
  construction: {
    bg: "Строителство (жп, гари, пристанища)",
    en: "Construction (rail, stations, ports)",
  },
  transport_services: {
    bg: "Транспортни услуги",
    en: "Transport services",
  },
  signalling_it: {
    bg: "Сигнализация, ИТ и връзки",
    en: "Signalling, IT & telecoms",
  },
  maintenance: { bg: "Ремонт и поддръжка", en: "Repair & maintenance" },
  design: { bg: "Проектиране и надзор", en: "Design & supervision" },
  fuel_energy: { bg: "Горива и енергия", en: "Fuel & energy" },
  supplies: { bg: "Материали и консумативи", en: "Materials & supplies" },
  other: { bg: "Друго", en: "Other" },
};

export const categoryLabel = (id: TransportCategory, lang: string): string =>
  (lang === "bg" ? CATEGORY_LABEL[id]?.bg : CATEGORY_LABEL[id]?.en) ?? id;

/** The CPV prefixes each category is built from — for deep-linking a category to
 *  `/procurement/contracts?cpv=<prefixes>` (the browse ORs the prefixes),
 *  reproducing the tile's split EXACTLY. A category owning a 2-digit division that a
 *  longer prefix carves out of (34 minus 3494/3496) is spelled out as the sibling
 *  prefixes it keeps, so the link never reaches the carved-out codes. `other` (the
 *  no-CPV sink) has no prefixes, so it isn't deep-linkable. */
const carve = (prefix: string, carved: string[]): string[] => {
  // 34 minus {3494, 3496} → 340..348, 3490..3493, 3495, 3497..3499.
  if (carved.includes(prefix)) return [];
  if (!carved.some((c) => c.startsWith(prefix))) return [prefix];
  return Array.from({ length: 10 }, (_, i) =>
    carve(`${prefix}${i}`, carved),
  ).flat();
};

const CATEGORY_CPV_DIVS: Record<TransportCategory, string[]> = (() => {
  const out = {} as Record<TransportCategory, string[]>;
  for (const [, cat] of CATEGORY_PREFIXES) out[cat] = [];
  out.other = [];
  for (const [prefix, cat] of CATEGORY_PREFIXES) {
    const carved = CATEGORY_PREFIXES.map(([q]) => q).filter(
      (q) => q !== prefix && q.startsWith(prefix),
    );
    out[cat].push(...(carved.length ? carve(prefix, carved) : [prefix]));
  }
  return out;
})();

export const categoryCpvDivs = (id: TransportCategory): string[] =>
  CATEGORY_CPV_DIVS[id] ?? [];

const transportClassifier: SectorClassifier<TransportCategory> = {
  categoryOf: (c: ProcurementContract) => categoryOfCpv(c.cpv),
  order: [
    "rolling_stock",
    "construction",
    "transport_services",
    "signalling_it",
    "maintenance",
    "design",
    "fuel_energy",
    "supplies",
  ],
  sink: "other",
};

/** Build the transport model. Only tag='contract' rows carry money (awards/
 *  amendments would double-count), matching the awarder rollup the host shows. */
export const buildTransportModel = (
  rows: ProcurementContract[],
): TransportModel =>
  buildAwarderModel(
    rows.filter((c) => isSpendRow(c, true)),
    transportClassifier,
  );

/** Same model, folded from the server's group aggregates (awarder-group-model)
 *  instead of raw rows — the tag='contract' filter lives in SQL there. */
export const buildTransportModelFromAggregates = (
  p: GroupModelPayload,
): TransportModel => buildAwarderModelFromAggregates(p, transportClassifier);

// ── Sector-specific readings of the same rows (transport-hub-v1) ──────────────

/** A ministry contract that IS rail spending: the rail public-service obligation
 *  (CPV 6021*) and rolling stock (346*). МТС awards both centrally, so a split by
 *  awarder shows the ministry as a €2.4bn spender and rail at 57% of the sector
 *  when it is 89% (D8). The rule is CPV + awarder, nothing else. */
export const isMinistryRailCpv = (
  awarderEik: string,
  cpv: string | undefined,
): boolean =>
  isPsoAward(awarderEik, cpv) ||
  (awarderEik === TRANSPORT_EIK && normCpv(cpv).startsWith("346"));

export interface ModeEur {
  universe: TransportUniverse;
  eur: number;
}

/**
 * Per-mode € with the ministry's rail contracts re-attributed to rail (D8).
 * `byUnit` is the group's per-awarder €; `ministryByCpv` is the ministry's own
 * per-CPV € (an awarder-group-model call over [TRANSPORT_EIK]). Σ in == Σ out:
 * money only moves between modes, so the total is the headline's.
 */
export const reattributedModes = (
  byUnit: { eik: string; totalEur: number }[],
  ministryByCpv: { cpv: string; totalEur: number }[],
): ModeEur[] => {
  const acc = new Map<TransportUniverse, number>();
  for (const u of byUnit) {
    const uni = transportUniverseOf(u.eik);
    if (!uni) continue;
    acc.set(uni, (acc.get(uni) ?? 0) + u.totalEur);
  }
  const moved = ministryByCpv
    .filter((c) => isMinistryRailCpv(TRANSPORT_EIK, c.cpv))
    .reduce((a, c) => a + c.totalEur, 0);
  if (moved) {
    acc.set("ministry", (acc.get("ministry") ?? 0) - moved);
    acc.set("rail", (acc.get("rail") ?? 0) + moved);
  }
  return [...acc].map(([universe, eur]) => ({ universe, eur }));
};

/** The rail public-service-obligation awards: МТС + CPV 6021*. Their amounts are a
 *  multi-year „прогнозна стойност" (the 2026 lots are €1.40bn against an annual
 *  PSO of ~€110M), and they arrive as `open` with one tenderer — so a caption keyed
 *  on the procurement METHOD finds none of them (G2, G3). */
export function isPsoAward(
  awarderEik: string,
  cpv: string | undefined,
): boolean {
  return awarderEik === TRANSPORT_EIK && normCpv(cpv).startsWith("6021");
}

export type PassThrough = "vouchers" | "fuel" | "electricity" | "insurance";

// „талон" counts only next to „храна": bare, it is ИААА's €28.4M „контролни талони"
// print run and the Sofia parking coupons, neither of which is a staff voucher.
const VOUCHER_TITLE =
  /(?<![\p{L}\p{N}])ваучер\p{L}*(?![\p{L}\p{N}])|карти за храна|храна[^.]{0,40}(?:ваучер|талон)|талон\p{L}*\s+за\s+храна/iu;

/**
 * Spending that passes through the buyer to its staff or a utility rather than
 * buying transport (G9): food vouchers, fuel, electricity, insurance. CPV alone is
 * not enough — НКЖИ's vouchers from Български пощи are filed under CPV 98000000 —
 * so vouchers are matched on the title. Captioned where they rank; never filtered.
 */
export const passThroughOf = (row: {
  title?: string | null;
  cpv?: string | null;
}): PassThrough | null => {
  const c = normCpv(row.cpv);
  if (c.startsWith("30199770") || VOUCHER_TITLE.test(row.title ?? ""))
    return "vouchers";
  if (c.startsWith("0931")) return "electricity";
  if (c.startsWith("091")) return "fuel";
  if (c.startsWith("665")) return "insurance";
  return null;
};

/**
 * „Без обявление" over the € whose procurement method is KNOWN (A4). All-time,
 * 37.7% of the group's € carries no method at all; dividing by the whole total
 * understates the share and hides that the rest is unknown. Returns the pair
 * un-divided plus the coverage, so a surface can say both.
 */
export const directShareKnown = (
  byMethod: { method: string | null; totalEur: number }[],
): { directEur: number; knownEur: number; totalEur: number } => {
  let directEur = 0;
  let knownEur = 0;
  let totalEur = 0;
  for (const m of byMethod) {
    totalEur += m.totalEur;
    const b = procedureBucket(m.method ?? undefined);
    if (b === "unknown") continue;
    knownEur += m.totalEur;
    if (b === "direct") directEur += m.totalEur;
  }
  return { directEur, knownEur, totalEur };
};
