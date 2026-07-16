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

const startsWithAny = (s: string, prefixes: string[]) =>
  prefixes.some((p) => s.startsWith(p));

/** CPV division → transport operating function, on the two-digit division only. */
export const categoryOfCpv = (cpv: string | undefined): TransportCategory => {
  const c = String(cpv ?? "").replace(/\s/g, "");
  if (!c) return "other";
  const div = c.slice(0, 2);
  // Transport equipment: rail rolling stock (34.6), buses (34.1), ships (34.5),
  // aircraft (34.7) — all under division 34.
  if (div === "34") return "rolling_stock";
  // Construction works (45) — track, stations, bridges, quays, runways.
  if (div === "45") return "construction";
  // Transport services (60), supporting transport services incl. toll/traffic (63),
  // postal & telecom services (64, the "съобщения" half of МТС).
  if (startsWithAny(div, ["60", "63", "64"])) return "transport_services";
  // Signalling, IT, telecom equipment, electronics, electrical machinery.
  if (startsWithAny(div, ["48", "72", "32", "31", "30"]))
    return "signalling_it";
  // Repair & maintenance services (50).
  if (div === "50") return "maintenance";
  // Architectural, engineering, design & supervision services (71).
  if (div === "71") return "design";
  // Fuels & energy (09) — diesel, electricity for traction.
  if (div === "09") return "fuel_energy";
  // Construction materials (44), mining/rail products (14), chemicals (24),
  // textiles/uniforms (19).
  if (startsWithAny(div, ["44", "14", "24", "19"])) return "supplies";
  return "other";
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
    bg: "Транспортни услуги и съобщения",
    en: "Transport services & communications",
  },
  signalling_it: {
    bg: "Сигнализация и ИТ",
    en: "Signalling & IT",
  },
  maintenance: { bg: "Ремонт и поддръжка", en: "Repair & maintenance" },
  design: { bg: "Проектиране и надзор", en: "Design & supervision" },
  fuel_energy: { bg: "Горива и енергия", en: "Fuel & energy" },
  supplies: { bg: "Материали и консумативи", en: "Materials & supplies" },
  other: { bg: "Друго", en: "Other" },
};

export const categoryLabel = (id: TransportCategory, lang: string): string =>
  (lang === "bg" ? CATEGORY_LABEL[id]?.bg : CATEGORY_LABEL[id]?.en) ?? id;

/** The CPV divisions each category is built from — for deep-linking a category to
 *  `/procurement/contracts?cpv=<divs>` (the browse ORs the prefixes), reproducing
 *  the tile's split EXACTLY. Must mirror `categoryOfCpv` above. `other` (the no-CPV
 *  sink) has no divisions, so it isn't deep-linkable. */
const CATEGORY_CPV_DIVS: Record<TransportCategory, string[]> = {
  rolling_stock: ["34"],
  construction: ["45"],
  transport_services: ["60", "63", "64"],
  signalling_it: ["48", "72", "32", "31", "30"],
  maintenance: ["50"],
  design: ["71"],
  fuel_energy: ["09"],
  supplies: ["44", "14", "24", "19"],
  other: [],
};

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
