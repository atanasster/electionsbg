// Road-attribute engine for the АПИ (Агенция "Пътна инфраструктура") spending
// dashboard. Pure, dependency-free functions that parse each procurement
// contract's title for the road designation, kilometre chainage and work type,
// then aggregate the corpus by corridor / work-type / procedure for the
// dashboard tiles and the road-network map.
//
// Why title-parsing: ~48% of АПИ contract titles carry a road reference
// (Път III-2903, АМ "Струма") and ~37% carry kilometre chainage
// (от км 12+300 до км 24+800). The procurement feed has no structured road
// fields, so the title is the only source of length / corridor.
//
// €/km is deliberately gated (see eurPerKmOf): a contract amount divided by a
// parsed length is only meaningful for a single-segment physical-works contract
// with a real amount — frameworks, design, supervision and archaeology contracts
// are excluded rather than shown a meaningless unit cost. Those service contracts
// routinely REPEAT the works lot's title and chainage („Участък Русе – Бяла от км
// 0+400 до км 40+640" is both the €448M build lot and its €6.5M supervision), so
// the title alone cannot tell them apart — CPV 71 and the contractor name can.

import type { ProcurementContract } from "@/data/dataTypes";
import { procedureBucket, type ProcedureBucket } from "@/lib/cpvSectors";
import {
  median,
  quantile,
  competitionStats,
  isSpendRow,
  isSingleBid,
} from "./awarderModel";

/** АПИ — Агенция "Пътна инфраструктура". Re-exported from @/lib/roadsAwarder,
 *  which owns the literal so a nav surface can name the buyer without importing
 *  this engine (and, through the pack registry, every sector's reference data)
 *  into the entry chunk. Importers here are unaffected. */
export { API_EIK } from "./roadsAwarder";

// --- Road designation -------------------------------------------------------

export type RoadClass = "АМ" | "I" | "II" | "III";

// Named motorways → canonical display name + OpenStreetMap `ref` (used by the
// road-network map to join contract spend onto OSM geometry). Europe/Kalotina
// share the А6 corridor in the data; Lyulin is the A6 Sofia–Daskalovo stretch.
interface MotorwaySpec {
  match: string;
  name: string;
  osmRef?: string;
}
const MOTORWAYS: MotorwaySpec[] = [
  { match: "тракия", name: "Тракия", osmRef: "A1" },
  { match: "хемус", name: "Хемус", osmRef: "A2" },
  { match: "струма", name: "Струма", osmRef: "A3" },
  { match: "марица", name: "Марица", osmRef: "A4" },
  { match: "черно море", name: "Черно море", osmRef: "A5" },
  { match: "люлин", name: "Люлин", osmRef: "A6" },
  { match: "калотина", name: "Европа", osmRef: "A6" },
  { match: "европа", name: "Европа", osmRef: "A6" },
];

const REPUBLICAN_REF =
  /[Пп]ът\s*([IVXIІ]{1,3})\s*-\s*(\d{1,5})|\b(I{1,3})\s*-\s*(\d{3,5})\b/;

// Words that can follow "обход" but are not city names — guards against the
// bypass capture grabbing a generic noun (e.g. "обходен път и мостово…").
const OBHOD_STOPWORDS = new Set([
  "път",
  "пътя",
  "пътен",
  "път,",
  "мост",
  "мостово",
  "мостови",
  "съоръжение",
  "трасе",
  "участък",
  "републиканската",
  "републикански",
  "имост",
  "имостта",
  "имо",
  "има",
]);

export interface RoadRef {
  /** Stable corridor grouping key — motorway name or "I-1" / "III-2903". */
  corridor: string;
  /** OSM `ref` for the map join, when known. */
  osmRef?: string;
  roadClass: RoadClass;
  /** true for the named-motorway matches (used to label / colour). */
  isMotorway: boolean;
}

// АМ „Русе – Велико Търново" (under construction, no OSM geometry yet). Its titles
// name the motorway, or only one of its two lots: „Участък Русе – Бяла" (km
// 0–40.6) and „Обход на гр. Бяла" (km 40.6–76). Measured 2026-10-12: €448.2M
// („Участък Русе – Бяла") + €348.5M (the Бяла bypass lot) + the archaeology
// rescue digs sat unattributed — or worse, the „ДЗЗД ХЕМУС" consortium's
// Русе–Бяла lot read as Хемус money. The OLD republican road I-5 is also titled
// „Русе – Бяла – Велико Търново", so the lot forms require their own label
// („участък" / „обход на гр.") and never match a bare place pair.
const RUSE_VT =
  /(?<![а-я])(?:ам|автомагистрал[аи]?)\s*[„"“]?\s*русе\s*[-–—]\s*(?:велико|в\.)\s*търново|участък\s*[„"“]?\s*русе\s*[-–—]\s*бяла|обход\s+на\s+(?:гр\.?|град)\s*бяла/;
export const RUSE_VT_CORRIDOR = "Русе – В. Търново";

/** Extract the road designation from a contract title, if any. */
export const roadRefOf = (title: string): RoadRef | undefined => {
  const n = (title || "").toLowerCase();
  if (RUSE_VT.test(n))
    return { corridor: RUSE_VT_CORRIDOR, roadClass: "АМ", isMotorway: true };
  // The Железница tunnel is АМ „Струма" Lot 3.2; its sub-lot titles name the
  // tunnel and the I-1 chainage only (€94.8M „Подучастък № 2 … тунел Железница").
  const tunnelOnStruma = /тунел\s*[„"“]?железница/.test(n);
  for (const m of MOTORWAYS) {
    if (tunnelOnStruma && m.match === "струма")
      return {
        corridor: m.name,
        osmRef: m.osmRef,
        roadClass: "АМ",
        isMotorway: true,
      };
  }
  for (const m of MOTORWAYS) {
    if (n.includes(m.match)) {
      return {
        corridor: m.name,
        osmRef: m.osmRef,
        roadClass: "АМ",
        isMotorway: true,
      };
    }
  }
  if (/автомагистрал/.test(n)) {
    return { corridor: "Автомагистрала", roadClass: "АМ", isMotorway: true };
  }
  const m = REPUBLICAN_REF.exec(title || "");
  if (m) {
    const rawClass = (m[1] || m[3] || "").replace(/І/g, "I").toUpperCase();
    const num = m[2] || m[4];
    const roadClass: RoadClass =
      rawClass === "III" ? "III" : rawClass === "II" ? "II" : "I";
    return {
      corridor: `${roadClass}-${num}`,
      osmRef: `${roadClass}-${num}`,
      roadClass,
      isMotorway: false,
    };
  }
  // Named expressway / bypass projects that carry no А-ref or "път" designation
  // (e.g. "Обход на гр. Габрово", "Северна скоростна тангента").
  if (/тангента/.test(n)) {
    const name = /северна/.test(n)
      ? "Северна тангента"
      : /южна/.test(n)
        ? "Южна тангента"
        : "Скоростна тангента";
    return { corridor: name, roadClass: "АМ", isMotorway: true };
  }
  if (/околовръст/.test(n))
    return { corridor: "Околовръстен път", roadClass: "I", isMotorway: false };
  // Lookbehind kills the substring trap: "необходимост" contains "обход"
  // (не-обход-имост) and would otherwise capture "имост" as a city.
  const ob = n.match(
    /(?<![а-яё])обход(?:ен)?(?:\s+път)?\s*(?:на\s*)?(?:гр\.?\s*|град\s*)?([а-яё]{3,})/,
  );
  if (ob && !OBHOD_STOPWORDS.has(ob[1])) {
    const city = ob[1][0].toUpperCase() + ob[1].slice(1);
    return { corridor: `Обход ${city}`, roadClass: "I", isMotorway: false };
  }
  return undefined;
};

// Bulgarian oblasti, longest-first so "велико търново" matches before "търново".
const OBLASTI = [
  "благоевград",
  "бургас",
  "варна",
  "велико търново",
  "видин",
  "враца",
  "габрово",
  "добрич",
  "кърджали",
  "кюстендил",
  "ловеч",
  "монтана",
  "пазарджик",
  "перник",
  "плевен",
  "пловдив",
  "разград",
  "русе",
  "силистра",
  "сливен",
  "смолян",
  "софия",
  "стара загора",
  "търговище",
  "хасково",
  "шумен",
  "ямбол",
].sort((a, b) => b.length - a.length);

/** The bucket for a lot that names two or more ОПУ directorates — a motorway
 *  maintenance lot („АМ „Тракия" на територията на ОПУ София, ОПУ Пазарджик, …")
 *  or a multi-oblast framework „Район". Its € belongs to no single oblast. */
export const MULTI_REGION = "Няколко ОПУ";

/** Display label for a region key — the oblast names are Bulgarian proper
 *  nouns on both locales, MULTI_REGION is not. */
export const regionLabel = (region: string, lang: string): string =>
  region === MULTI_REGION && lang !== "bg" ? "Several ОПУ" : region;

const titleCaseOblast = (o: string) =>
  o.replace(/(^|\s)[а-яё]/g, (c) => c.toUpperCase());

/** Oblast for a regional-directorate (ОПУ) maintenance lot, e.g. "Обособена
 *  позиция №4 – ОПУ Хасково" → "Хасково". These framework lots carry no single
 *  road reference; the region is the meaningful unit. Returns undefined when the
 *  title is not an ОПУ-region lot, and MULTI_REGION when it names several ОПУ.
 *
 *  It reads the oblast written AFTER „ОПУ", not the first oblast anywhere in the
 *  title. The old rule (longest oblast name anywhere) sent 87 multi-ОПУ lots /
 *  €800.6M — 23.5% of the region tile — to one oblast: АМ „Тракия" OP3, €193.1M
 *  across 7 ОПУ, became „Стара Загора", and Шумен showed €0.6M (measured
 *  2026-10-12). A „Граница ОПУ-Видин" is a road ENDPOINT, not the directorate,
 *  so it is not counted; with no directorate named the title falls back to the
 *  longest oblast it mentions (II-11 „Граница ОПУ-Видин – Лом – Граница
 *  ОПУ-Враца … област Монтана" → Монтана). */
export const regionOf = (title: string): string | undefined => {
  const n = (title || "").toLowerCase();
  if (!/опу/.test(n)) return undefined;
  const named = new Set<string>();
  const re = /(граница\s+)?опу[\s\-–—"„“]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(n)) !== null) {
    if (m[1]) continue;
    const rest = n.slice(m.index + m[0].length);
    const o = OBLASTI.find((x) => rest.startsWith(x));
    if (o) named.add(o);
  }
  if (named.size >= 2) return MULTI_REGION;
  if (named.size === 1) return titleCaseOblast([...named][0]);
  for (const o of OBLASTI) {
    if (n.includes(o)) return titleCaseOblast(o);
  }
  return undefined;
};

// --- Chainage / length ------------------------------------------------------

const RANGE = /от\s*км\s*(\d+)\s*\+\s*(\d+)\s*до\s*км\s*(\d+)\s*\+\s*(\d+)/gi;
const KMPT = /км\s*(\d+)\s*\+\s*(\d+)/gi;

export interface ParsedLength {
  lengthKm: number;
  segments: number;
  /** Absolute chainage extent along the road (min/max km markers seen). Present
   *  whenever any km marker was parsed; used by the chainage-coverage strip to
   *  place a contract on its motorway's km axis. */
  kmFrom?: number;
  kmTo?: number;
}

/** Parse the funded length from a title's chainage. Sums explicit
 *  "от км A до км B" ranges; falls back to max−min of bare km markers. */
export const lengthOf = (title: string): ParsedLength | undefined => {
  const t = title || "";
  RANGE.lastIndex = 0;
  let total = 0;
  let n = 0;
  let r: RegExpExecArray | null;
  const rangePts: number[] = [];
  while ((r = RANGE.exec(t)) !== null) {
    const a = Number(r[1]) + Number(r[2]) / 1000;
    const b = Number(r[3]) + Number(r[4]) / 1000;
    total += Math.abs(b - a);
    n++;
    rangePts.push(a, b);
  }
  if (n > 0)
    return {
      lengthKm: total,
      segments: n,
      kmFrom: Math.min(...rangePts),
      kmTo: Math.max(...rangePts),
    };
  KMPT.lastIndex = 0;
  const pts: number[] = [];
  while ((r = KMPT.exec(t)) !== null)
    pts.push(Number(r[1]) + Number(r[2]) / 1000);
  if (pts.length >= 2) {
    return {
      lengthKm: Math.max(...pts) - Math.min(...pts),
      segments: 1,
      kmFrom: Math.min(...pts),
      kmTo: Math.max(...pts),
    };
  }
  return undefined;
};

// --- Motorway km axes (chainage strip) --------------------------------------

/** One km axis a named motorway's contracts are placed on. `lo`/`hi` are the
 *  plausible chainage bounds; they also reject km markers a title borrowed from
 *  a cross-referenced road. */
export interface MotorwayAxis {
  corridor: string;
  /** Distinguishes a second axis on the same motorway (Струма). */
  axisKey: string;
  lo: number;
  hi: number;
  /** BG/EN suffix shown after the motorway name, when an axis needs one. */
  suffix?: { bg: string; en: string };
}

/** Struma has TWO chainages in the register: its own (km 0 – ~166.5, the
 *  maintenance lots) and the I-1/E79 chainage every construction lot uses
 *  (Lot 1 km 305–322, Lot 2 322–359, Lot 3 359–440). A single 0–165 cap
 *  rejected every construction contract: the strip showed Струма at 13
 *  contracts / €47.7M against a corridor total of €943.9M (2026-10-12), and the
 *  OP6 maintenance lot „км 56+170 до 166+500" fell off the end by 1.5 km. */
export const MOTORWAY_AXES: MotorwayAxis[] = [
  { corridor: "Тракия", axisKey: "Тракия", lo: 0, hi: 380 },
  { corridor: "Хемус", axisKey: "Хемус", lo: 0, hi: 434 },
  { corridor: "Струма", axisKey: "Струма", lo: 0, hi: 167 },
  {
    corridor: "Струма",
    axisKey: "Струма I-1",
    lo: 300,
    hi: 445,
    suffix: { bg: "км по път I-1 (Е79)", en: "km along road I-1 (E79)" },
  },
  { corridor: "Марица", axisKey: "Марица", lo: 0, hi: 120 },
  { corridor: "Черно море", axisKey: "Черно море", lo: 0, hi: 110 },
  { corridor: "Люлин", axisKey: "Люлин", lo: 0, hi: 25 },
  { corridor: "Европа", axisKey: "Европа", lo: 0, hi: 95 },
  { corridor: RUSE_VT_CORRIDOR, axisKey: RUSE_VT_CORRIDOR, lo: 0, hi: 140 },
];

/** Average spend per km a bin must reach to count as „covered". A road-safety
 *  audit or an archaeology dig is a €0–€5M contract over many kilometres; under
 *  the old any-€>0 rule three near-€0 audits plus one dig made „Хемус 68%
 *  покритие" (ns:2026).
 *
 *  Coverage is measured on CAPITAL work only (every group but `maintenance`).
 *  A maintenance framework is priced over the whole motorway — €4.78M over Тракия
 *  km 208–359, €44M over Струма km 0–56 — so with it in the numerator one lot
 *  „covered" 27 points of Тракия and all of Струма's own axis. Its € still
 *  shades the bins; it just does not count as works done on that stretch. */
export const CHAINAGE_COVER_EUR_PER_KM = 25_000;
const CHAINAGE_BINS = 44;

export interface ChainageStrip {
  axis: MotorwayAxis;
  bins: number[]; // € per bin
  maxBin: number;
  totalEur: number;
  contracts: number;
  /** Share of the AXIS length (lo..hi) whose bins carry at least
   *  CHAINAGE_COVER_EUR_PER_KM of CAPITAL work — never the span between the
   *  outermost contracted markers, which reads as „68% of the motorway". */
  coveredPct: number;
}

/** Place every named-motorway row that carries absolute chainage on its axis.
 *  Needs at least `minContracts` locatable rows per axis. */
export const buildChainageStrips = (
  rows: RoadContract[],
  minContracts = 3,
): ChainageStrip[] => {
  const segsByAxis = new Map<
    string,
    {
      axis: MotorwayAxis;
      segs: { from: number; to: number; eur: number; capital: boolean }[];
    }
  >();
  for (const r of rows) {
    if (!r.ref?.isMotorway) continue;
    const len = lengthOf(r.c.title);
    if (len?.kmFrom == null || len.kmTo == null) continue;
    let from = len.kmFrom;
    let to = len.kmTo;
    if (to < from) [from, to] = [to, from];
    // Non-degenerate, and not a whole-network row borrowing two far-apart
    // markers from another road.
    if (to - from < 0.2 || to - from > 200) continue;
    const axis = MOTORWAY_AXES.find(
      (a) => a.corridor === r.ref!.corridor && from >= a.lo && to <= a.hi,
    );
    if (!axis) continue;
    const e = segsByAxis.get(axis.axisKey) ?? { axis, segs: [] };
    e.segs.push({
      from,
      to,
      eur: r.amountEur,
      capital: r.group !== "maintenance",
    });
    segsByAxis.set(axis.axisKey, e);
  }
  const out: ChainageStrip[] = [];
  for (const { axis, segs } of segsByAxis.values()) {
    if (segs.length < minContracts) continue;
    const binW = (axis.hi - axis.lo) / CHAINAGE_BINS;
    const bins = new Array<number>(CHAINAGE_BINS).fill(0);
    const capitalBins = new Array<number>(CHAINAGE_BINS).fill(0);
    for (const s of segs) {
      const perKm = s.eur / Math.max(0.1, s.to - s.from);
      const b0 = Math.floor((s.from - axis.lo) / binW);
      const b1 = Math.min(
        CHAINAGE_BINS - 1,
        Math.floor((s.to - axis.lo) / binW),
      );
      for (let b = Math.max(0, b0); b <= b1; b++) {
        const binStart = axis.lo + b * binW;
        const overlap =
          Math.min(s.to, binStart + binW) - Math.max(s.from, binStart);
        if (overlap > 0) {
          bins[b] += perKm * overlap;
          if (s.capital) capitalBins[b] += perKm * overlap;
        }
      }
    }
    const floor = CHAINAGE_COVER_EUR_PER_KM * binW;
    out.push({
      axis,
      bins,
      maxBin: Math.max(...bins, 1),
      totalEur: segs.reduce((a, s) => a + s.eur, 0),
      contracts: segs.length,
      coveredPct: capitalBins.filter((v) => v >= floor).length / CHAINAGE_BINS,
    });
  }
  return out.sort((a, b) => b.totalEur - a.totalEur);
};

// --- Work type --------------------------------------------------------------

export type WorkType =
  | "new_build"
  | "reconstruction"
  | "rehab_major"
  | "rehab"
  | "preventive"
  | "maintenance"
  | "area_maint"
  | "design"
  | "supervision"
  | "archaeology"
  | "noise_barrier"
  | "other";

/** Physical work types whose cost-per-km is meaningful. */
const PHYSICAL: ReadonlySet<WorkType> = new Set<WorkType>([
  "new_build",
  "reconstruction",
  "rehab_major",
  "rehab",
  "preventive",
]);

// CPV fallback when the title carries no work verb (verb-less framework / lot
// titles like "Обособена позиция №4 – ОПУ Хасково" — common on the big-money
// rows). Keeps the build-vs-repair split meaningful instead of dumping half the
// volume into "other".
const workTypeFromCpv = (cpv?: string): WorkType | undefined => {
  if (!cpv) return undefined;
  if (cpv.startsWith("71")) return "supervision"; // engineering design / oversight
  if (
    cpv.startsWith("50") ||
    cpv === "45233139" || // highway maintenance work
    cpv === "45233141" || // road-maintenance works
    cpv === "45233142" || // road-repair works
    cpv === "45233140" // road works (maintenance class)
  )
    return "maintenance";
  if (cpv.startsWith("45221")) return "new_build"; // bridges / tunnels
  if (cpv.startsWith("4523") || cpv.startsWith("4521")) return "new_build"; // road / civil works
  return undefined;
};

// A design-AND-build (инженеринг) contract is physical works even when it is
// CPV-coded 71 (ДЗЗД Проход Маказа, 71311220, €6.4M) — the services rules below
// must not swallow it.
const DESIGN_BUILD =
  /(?:проект[а-я]*|проектиране|проектантски работи)\s*(?:и|с)\s*(?:строителство|изграждане|изпълнение)|инженеринг/;

/** Archaeology contracts (пълно спасително археологическо проучване, наблюдение,
 *  разкопки — НАИМ-БАН, CPV 71351914) carry the motorway's chainage in their
 *  title but are a survey service, not road works. A works lot that merely sits
 *  „при археологически обект" (CPV 45…, e.g. a retaining wall) stays physical;
 *  CPV 451124 is archaeological EXCAVATION and counts as archaeology. */
const isArchaeology = (n: string, cpv?: string): boolean =>
  /археолог/.test(n) &&
  !DESIGN_BUILD.test(n) &&
  !(cpv?.startsWith("45") && !cpv.startsWith("451124"));

/** Coarse classification of a contract's work type — title verbs first, then
 *  CPV 71 / the contractor's name for the service contracts whose title is just
 *  the works lot they oversee, then a CPV-code fallback for verb-less titles. */
export const workTypeOf = (
  title: string,
  cpv?: string,
  contractorName?: string,
): WorkType => {
  const n = (title || "").toLowerCase();
  const designBuild = DESIGN_BUILD.test(n);
  if (isArchaeology(n, cpv)) return "archaeology";
  if (
    /надзор|консултант|супервизи|конс\.\s*услуг|инвеститорски|оценка на съответст|одит|овос|експертиз|инвентаризац/.test(
      n,
    )
  )
    return "supervision";
  // CPV 71 (architecture / engineering / supervision services) is a service
  // whatever the title says: a supervision lot is titled after the section it
  // oversees, and an „Изготвяне на идеен проект за доизграждане" design job
  // otherwise reads as „изграждане". Only a design-and-build title escapes.
  if (cpv?.startsWith("71") && !designBuild)
    return /^715[0-4]/.test(cpv) ? "supervision" : "design";
  // Same shape with no CPV at all: a supervision ДЗЗД („КОНСУЛТАНТИ СТРУМА 1",
  // „Консултанти АМ Хемус 2020") whose lot title is the works section. Only when
  // CPV is absent — a consortium of builders with one „…консулт ЕООД" member is
  // CPV 45 and real works (АМ „Струма" Лот 3.1, €89.9M).
  if (!cpv && !designBuild && /консулт/i.test(contractorName ?? ""))
    return "supervision";
  if (/поддър|снегопочист|зимно/.test(n)) return "area_maint";
  if (n.includes("проектиране") && !/строителств|ремонт/.test(n))
    return "design";
  // „Изготвяне / изработване на (технически|идеен) проект за …", ПУП, and
  // предпроектни / геоложки проучвания — a deliverable on paper, even when the
  // title goes on to name the works it is for (основен ремонт, доизграждане).
  if (
    !designBuild &&
    (/(?:изготвяне|изработване|актуализация)\s+на\s[^.]{0,60}?(?:проект|пуп(?![\p{L}\p{N}])|план)/u.test(
      n,
    ) ||
      (/проучван/.test(n) && !cpv?.startsWith("45")))
  )
    return "design";
  // Шумозащитни съоръжения (noise walls along a motorway past housing): physical
  // works, but a wall's € over the chainage it shields is not a road cost — the
  // Шумен / Ботевград lots read 1.5 and 3.0 M€/km „reconstruction" on АМ „Хемус".
  // Placed AFTER the design rules so a wall's acoustic design stays design.
  if (/шумозащит/.test(n)) return "noise_barrier";
  if (n.includes("основен ремонт")) return "rehab_major";
  if (/рехабилитац/.test(n)) return "rehab";
  if (/реконструкц/.test(n)) return "reconstruction";
  if (/строителств|строително|изграждане/.test(n)) return "new_build";
  if (/превантив/.test(n)) return "preventive";
  if (/текущ ремонт/.test(n)) return "rehab";
  // Verb-less titles: infer from the physical component the title names, then a
  // plain "ремонт", then an ОПУ regional-unit lot, before the CPV fallback.
  // Without this, guardrail / marking / tunnel / bridge installs and bare
  // "ОПУ X" framework lots (big-money rows) all collapse into "other".
  const comp = workComponentOf(title, cpv, "other");
  // A repair of a structure is not new build: „ремонтно – възстановителни
  // дейности на виадукти … на АМ Хемус" was a 5.65 M€/km „new build".
  if (comp === "tunnel" || comp === "bridge")
    return /ремонт|възстанов|рехабил/.test(n) ? "rehab" : "new_build";
  if (comp === "retaining") return "reconstruction";
  if (
    comp === "markings_signs" ||
    comp === "safety_barriers" ||
    comp === "lighting" ||
    comp === "drainage" ||
    comp === "winter_maint"
  )
    return "area_maint";
  if (/ремонт|възстанов/.test(n)) return "rehab"; // plain "ремонт"/"възстановяване"
  if (regionOf(title)) return "area_maint"; // bare "ОПУ X" regional lot
  if (/включващ\s+облас/.test(n)) return "area_maint"; // NUTS-2 multi-oblast framework
  // Verb-less lot on a numbered road with explicit chainage ("Път III-866 …
  // от км A до км B"): a capital work on a defined segment, not routine
  // (network-wide) maintenance. Classed as reconstruction so a €152M road
  // contract no longer reads as "Друго".
  if (roadRefOf(title) && lengthOf(title)) return "reconstruction";
  return workTypeFromCpv(cpv) ?? "other";
};

/** УНПs of the procedures whose lots are noise barriers. Only ONE lot of such a
 *  procedure tends to say so — 00044-2023-0103's „ОП 2: в.з. Зелин, гр. Ботевград
 *  … АМ „Хемус“ от км 44+717 до км 45+474" names a place and a chainage and no
 *  work at all — so the work type is read off the procedure, i.e. off any sibling
 *  lot that names it. */
export const noiseBarrierUnps = (
  rows: ReadonlyArray<{ title?: string | null; unp?: string | null }>,
): Set<string> => {
  const out = new Set<string>();
  for (const r of rows)
    if (r.unp && /шумозащит/i.test(r.title ?? "")) out.add(r.unp);
  return out;
};

/** A lot's work type in the context of its procedure: a physical-works lot of a
 *  noise-barrier procedure that names no work of its own is a noise barrier. A
 *  lot whose title states its own work („Рехабилитация на …") keeps it, so a
 *  mixed procedure does not lose its road lots' €/km. Design / supervision /
 *  archaeology lots keep their own type. */
export const workTypeInProcedure = (
  workType: WorkType,
  title: string | null | undefined,
  unp: string | null | undefined,
  noiseUnps: ReadonlySet<string>,
): WorkType =>
  unp &&
  noiseUnps.has(unp) &&
  PHYSICAL.has(workType) &&
  !/строител|изграждане|реконструкц|рехабилитац|ремонт|превантив|поддър/i.test(
    title ?? "",
  )
    ? "noise_barrier"
    : workType;

// Display grouping for the build-vs-repair donut.
export type WorkGroup = "build" | "rehab" | "maintenance" | "design" | "other";
export const workGroupOf = (w: WorkType): WorkGroup => {
  // A noise wall is newly built, even though it carries no €/km.
  if (w === "new_build" || w === "reconstruction" || w === "noise_barrier")
    return "build";
  if (w === "rehab_major" || w === "rehab" || w === "preventive")
    return "rehab";
  if (w === "maintenance" || w === "area_maint") return "maintenance";
  if (w === "design" || w === "supervision") return "design";
  // Archaeology is a survey service, but not „Проектиране и надзор" — it reads
  // under „Друго" in the donut and is named as its own component in the table.
  return "other";
};

// --- €/km gating ------------------------------------------------------------

/** A corridor's €/km median needs at least this many defensible rows. ns:2026
 *  Струма published €33.3M/km from ONE contract (Lot 3.1 over 2.7 km). */
export const EUR_PER_KM_MIN_N = 3;

const BUILD_FLOOR = 1_000_000;
const REHAB_FLOOR = 150_000;
const PER_KM_FLOOR = 30_000; // below this, an amount↔length scope mismatch is certain

export interface EurPerKm {
  eurPerKm: number;
  lengthKm: number;
  confidence: "high" | "med";
}

/** A contract for a FRACTION of a lot whose title still carries the whole lot's
 *  chainage: „допълнителни строителни работи / СМР" on a finished lot, „допълнително
 *  възникнали видове СМР", or one „Подобект". Dividing its amount by the lot's
 *  length is a scope mismatch (АМ „Струма" Лот 1 Подобект № 1: €1.7M over 16.8 km
 *  = 0.05 M€/km). NOT „допълнително проектиране и строителство" — that is the
 *  FIDIC design-and-build form of a MAIN contract (Мездра – Ботевград Лот 2,
 *  €113.8M over 13.4 km). */
export const isPartialScope = (title: string | null | undefined): boolean =>
  /допълнителн[иа]\s+(?:строител|строително|смр|работи)|допълнително\s+възникнал|подобект/i.test(
    title ?? "",
  );

/** Defensible €/km for one contract, or undefined if it should not carry one.
 *  Reads only `amountEur` and (optionally) `title`, so the parameter is the
 *  minimal shape — this keeps callers that hold just an amount (e.g. the
 *  project-file €/km cross-check) type-checked without an unsafe cast. */
export const eurPerKmOf = (
  c: Pick<ProcurementContract, "amountEur"> & { title?: string | null },
  workType: WorkType,
  len: ParsedLength | undefined,
): EurPerKm | undefined => {
  if (!PHYSICAL.has(workType)) return undefined;
  if (!len) return undefined;
  if (isPartialScope(c.title)) return undefined;
  const { lengthKm, segments } = len;
  if (!(lengthKm >= 0.5 && lengthKm <= 50)) return undefined;
  const amt = c.amountEur ?? 0;
  const floor =
    workType === "new_build" || workType === "reconstruction"
      ? BUILD_FLOOR
      : REHAB_FLOOR;
  if (amt < floor) return undefined;
  const perKm = amt / lengthKm;
  if (perKm < PER_KM_FLOOR) return undefined;
  return {
    eurPerKm: perKm,
    lengthKm,
    confidence: segments === 1 ? "high" : "med",
  };
};

// --- Work component ("what kind of work") -----------------------------------

export type WorkComponent =
  | "tunnel"
  | "bridge"
  | "tolling_its"
  | "markings_signs"
  | "safety_barriers"
  | "noise_barriers"
  | "lighting"
  | "drainage"
  | "retaining"
  | "winter_maint"
  | "roadway"
  | "design_supervision"
  | "archaeology"
  | "other";

const eqAny = (cpv: string | undefined, codes: string[]): boolean =>
  !!cpv && codes.includes(cpv);

// Primary component by precedence: a design / oversight contract is a service
// regardless of what it concerns (services first), then the distinctive
// structures and systems, then the roadway itself. CPV is a co-signal only — it
// is ~43% absent and frequently mis-coded (e.g. 63712200 "highway operation" is
// used for markings), so title keywords lead.
export const workComponentOf = (
  title: string,
  cpv: string | undefined,
  workType: WorkType,
): WorkComponent => {
  const n = (title || "").toLowerCase();
  if (workType === "supervision" || workType === "design")
    return "design_supervision";
  if (workType === "archaeology") return "archaeology";
  if (workType === "noise_barrier") return "noise_barriers";
  if (/тунел/.test(n)) return "tunnel";
  if (/мост|надлез|подлез|естакад|виадукт/.test(n) || cpv?.startsWith("45221"))
    return "bridge";
  // Markings must beat tolling: CPV 63712200 ("highway operation") is widely
  // mis-coded onto road-marking contracts, so the title keyword has to lead or
  // a "ПОЛАГАНЕ НА … МАРКИРОВКА" lot gets dragged into tolling/ИТС.
  if (
    /маркировк|пътни знаци|вертикална сигнализац|пътна сигнализац/.test(n) ||
    eqAny(cpv, ["45233221", "45233290", "34992200"])
  )
    return "markings_signs";
  if (
    /\bтол\b|тол систем|естп|електронн[а-я ]{0,12}такс|видеонаблюд|система за просле/.test(
      n,
    ) ||
    eqAny(cpv, ["63712200", "50312610", "34972000"])
  )
    return "tolling_its";
  if (
    /ограничителн|предпазна ограда|предпазни огради|мантинел|ударогасит/.test(
      n,
    ) ||
    eqAny(cpv, ["45340000", "45233292"]) ||
    cpv?.startsWith("34928")
  )
    return "safety_barriers";
  if (/осветлени/.test(n) || cpv === "45316110") return "lighting";
  if (/отводн|дренаж|водосток/.test(n)) return "drainage";
  if (/подпорн/.test(n)) return "retaining";
  if (/зимно поддър|снегопочист/.test(n)) return "winter_maint";
  if (
    workType === "new_build" ||
    workType === "reconstruction" ||
    workType === "rehab_major" ||
    workType === "rehab" ||
    workType === "preventive" ||
    workType === "maintenance" ||
    workType === "area_maint"
  )
    return "roadway";
  return "other";
};

// --- Display labels (single source of truth) --------------------------------
// Bilingual labels for the work-group and component taxonomies. Kept here in the
// dependency-free engine so every layer shares one map: the dashboard tiles
// (via roadLabels.ts), and the AI narration in ai/tools/fiscal.ts (which can't
// import src/screens). Title Case; the AI layer lowercases at its call site.

export const GROUP_META: Record<
  WorkGroup,
  { bg: string; en: string; color: string }
> = {
  build: { bg: "Ново строителство", en: "New build", color: "#1D9E75" },
  rehab: {
    bg: "Ремонт и рехабилитация",
    en: "Repair & rehabilitation",
    color: "#EF9F27",
  },
  maintenance: { bg: "Поддържане", en: "Maintenance", color: "#378ADD" },
  design: {
    bg: "Проектиране и надзор",
    en: "Design & supervision",
    color: "#888780",
  },
  other: { bg: "Друго", en: "Other", color: "#B4B2A9" },
};

export const COMPONENT_LABEL: Record<
  WorkComponent,
  { bg: string; en: string }
> = {
  tunnel: { bg: "Тунели", en: "Tunnels" },
  bridge: { bg: "Мостове и съоръжения", en: "Bridges & structures" },
  tolling_its: { bg: "Тол и ИТС", en: "Tolling & ITS" },
  markings_signs: { bg: "Маркировка и знаци", en: "Markings & signs" },
  safety_barriers: { bg: "Ограничителни системи", en: "Safety barriers" },
  noise_barriers: { bg: "Шумозащитни съоръжения", en: "Noise barriers" },
  lighting: { bg: "Осветление", en: "Lighting" },
  drainage: { bg: "Отводняване", en: "Drainage" },
  retaining: { bg: "Подпорни стени", en: "Retaining walls" },
  winter_maint: { bg: "Зимно поддържане", en: "Winter maintenance" },
  roadway: { bg: "Пътно платно (строеж/ремонт)", en: "Roadway (build/repair)" },
  design_supervision: {
    bg: "Проектиране и надзор",
    en: "Design & supervision",
  },
  archaeology: {
    bg: "Археологически проучвания",
    en: "Archaeological surveys",
  },
  other: { bg: "Друго", en: "Other" },
};

// --- Per-contract enrichment + corpus aggregation ---------------------------

/** What annexes added to one contract: current value − signing value, when both
 *  are known and the contract grew. 0 otherwise. */
export const annexGrowthOf = (
  c: Pick<ProcurementContract, "amountEur" | "signingAmountEur">,
): number => {
  const cur = c.amountEur ?? 0;
  const sig = c.signingAmountEur ?? 0;
  return sig > 0 && cur > sig ? cur - sig : 0;
};

export interface RoadContract {
  c: ProcurementContract;
  ref?: RoadRef;
  workType: WorkType;
  group: WorkGroup;
  component: WorkComponent;
  /** Oblast for ОПУ regional-maintenance lots (see regionOf). */
  region?: string;
  perKm?: EurPerKm;
  amountEur: number;
}

export interface RegionAgg {
  region: string;
  totalEur: number;
  contractCount: number;
  singleBidShare?: number;
}

export interface CorridorAgg {
  corridor: string;
  osmRef?: string;
  roadClass: RoadClass;
  isMotorway: boolean;
  totalEur: number;
  contractCount: number;
  /** The ONE work class the €/km median is taken over — never a mix. „build"
   *  (new build + reconstruction) when it has EUR_PER_KM_MIN_N defensible rows,
   *  else „rehab" (основен ремонт / рехабилитация / превантивен), else none. A
   *  motorway median that pooled a €448M build lot with a viaduct repair and a
   *  widening answered no question at all. */
  eurPerKmClass?: PerKmClass;
  /** Undefined below EUR_PER_KM_MIN_N defensible rows in either class. */
  eurPerKmMedian?: number;
  eurPerKmIqr?: [number, number];
  /** Defensible €/km rows in `eurPerKmClass` — or, when no class publishes, in
   *  both classes together (the evidence that exists but is too thin). */
  eurPerKmN: number;
  singleBidShare?: number; // over rows with a known bidder count
  directShare: number; // € via direct/no-notice procedures
}

/** The work classes a corridor €/km median may be taken over (WorkGroup subset:
 *  every PHYSICAL work type maps into one of the two). */
export type PerKmClass = Extract<WorkGroup, "build" | "rehab">;

export interface WorkGroupAgg {
  group: WorkGroup;
  totalEur: number;
  contractCount: number;
}

export interface ComponentAgg {
  component: WorkComponent;
  totalEur: number;
  contractCount: number;
  /** Single-bidder share over rows with a known bidder count. */
  singleBidShare?: number;
  /** Largest contractor in this component + its share of the component €
   *  (a niche-capture signal). */
  topContractorName?: string;
  topContractorShare?: number;
}

export interface MethodAgg {
  bucket: ProcedureBucket;
  totalEur: number;
}

export interface YearAgg {
  year: string;
  totalEur: number;
  /** € by work group (build / rehab / maintenance / design / other). */
  groups: Record<WorkGroup, number>;
  /** € by top corridor name (others folded into "other"). */
  corridors: Record<string, number>;
  /** € by oblast for ОПУ regional-maintenance lots (others → "other"). */
  regions: Record<string, number>;
  /** Single-bidder share over rows with a known bidder count that year. */
  singleBidShare?: number;
  /** Of totalEur, the growth annexes added (current − signing value), booked —
   *  like every figure here — in the year the contract was SIGNED. */
  growthEur: number;
}

export interface TopContractor {
  eik: string;
  name: string;
  totalEur: number;
  contractCount: number;
  /** Single-bidder share over this contractor's rows with a known count. */
  singleBidShare?: number;
  /** Component where this contractor earns the most. */
  topComponent: WorkComponent;
}

export interface RoadsModel {
  /** Amendment-free contract rows with road attributes (one per distinct
   *  contract; the ingest already removed true repeats). */
  rows: RoadContract[];
  corridors: CorridorAgg[];
  regions: RegionAgg[];
  workGroups: WorkGroupAgg[];
  components: ComponentAgg[];
  years: YearAgg[];
  /** The 12 largest contractors (AI tool, chips). */
  topContractors: TopContractor[];
  /** Every contractor, by € — what the roads procurement page lists. */
  contractors: TopContractor[];
  methods: MethodAgg[];
  topProjects: RoadContract[];
  // Corpus integrity headline (over rows with a known value).
  singleBidShare?: number;
  directShare: number;
  refCoverageEur: number; // € share carrying a road ref (0..1)
  totalEur: number; // sum over the non-amendment rows (matches the rollup)
}

/** Build the full dashboard model from an awarder's contract rows. */
export const buildRoadsModel = (
  contracts: ProcurementContract[],
): RoadsModel => {
  // Drop amendments (they re-state an existing contract's value — see
  // rollups.ts). Do NOT dedup by `key`: it is a content hash, not a unique
  // contract id, so distinct contracts (e.g. two lots of one procedure, or two
  // identical-value awards with different contractId) collide on it. Deduping
  // by key dropped those real records and under-counted ~1%. The ingest already
  // dedups true repeats by (releaseId, contractId, contractor, tag), so every
  // surviving row is a distinct contract — count them all, matching the rollup.
  //
  // Consortium MEMBER rows (migration 087) are dropped too. They carry €0 — the
  // joint award sits on the carrier — but inherit the procedure's tenderer
  // count, so keeping them counted every consortium contract 1 + members times
  // in every count and single-bid share: 499 of 2,826 АПИ rows, winter
  // maintenance shown at 90.0% single-bid against a true 76.9% (2026-10-12).
  // No € moves. The awarder route counts the same way (consortium_role IS
  // DISTINCT FROM 'member').
  const rows: RoadContract[] = [];
  const noiseUnps = noiseBarrierUnps(contracts);
  for (const c of contracts) {
    if (!isSpendRow(c)) continue;
    if (c.consortiumRole === "member") continue;
    const ref = roadRefOf(c.title);
    const workType = workTypeInProcedure(
      workTypeOf(c.title, c.cpv, c.contractorName),
      c.title,
      c.unp,
      noiseUnps,
    );
    const len = lengthOf(c.title);
    rows.push({
      c,
      ref,
      workType,
      group: workGroupOf(workType),
      component: workComponentOf(c.title, c.cpv, workType),
      region: regionOf(c.title),
      perKm: eurPerKmOf(c, workType, len),
      amountEur: c.amountEur ?? 0,
    });
  }

  // Canonical totals + competition (single-bid / direct) from the shared core,
  // so the headline rules are defined in exactly one place (awarderModel).
  const stats = competitionStats(rows.map((r) => r.c));
  const totalEur = stats.totalEur;
  const refEur = rows.reduce((s, r) => (r.ref ? s + r.amountEur : s), 0);

  // Corridor aggregation.
  const byCorridor = new Map<string, RoadContract[]>();
  for (const r of rows) {
    if (!r.ref) continue;
    const arr = byCorridor.get(r.ref.corridor) ?? [];
    arr.push(r);
    byCorridor.set(r.ref.corridor, arr);
  }
  const corridors: CorridorAgg[] = [...byCorridor.entries()].map(
    ([corridor, arr]) => {
      const ref = arr[0].ref!;
      const perKmOfClass = (g: PerKmClass) =>
        arr
          .filter((r) => r.group === g)
          .map((r) => r.perKm?.eurPerKm)
          .filter((x): x is number => x != null);
      const build = perKmOfClass("build");
      const rehab = perKmOfClass("rehab");
      const perKmClass: PerKmClass | undefined =
        build.length >= EUR_PER_KM_MIN_N
          ? "build"
          : rehab.length >= EUR_PER_KM_MIN_N
            ? "rehab"
            : undefined;
      const perKms =
        perKmClass === "build"
          ? build
          : perKmClass === "rehab"
            ? rehab
            : [...build, ...rehab];
      const bidKnown = arr.filter((r) => r.c.numberOfTenderers != null);
      const single = bidKnown.filter((r) =>
        isSingleBid(r.c.numberOfTenderers),
      ).length;
      const directEur = arr.reduce(
        (s, r) =>
          procedureBucket(r.c.procurementMethod) === "direct"
            ? s + r.amountEur
            : s,
        0,
      );
      const tot = arr.reduce((s, r) => s + r.amountEur, 0);
      return {
        corridor,
        osmRef: ref.osmRef,
        roadClass: ref.roadClass,
        isMotorway: ref.isMotorway,
        totalEur: tot,
        contractCount: arr.length,
        eurPerKmClass: perKmClass,
        eurPerKmMedian: perKmClass ? median(perKms) : undefined,
        eurPerKmIqr: perKmClass
          ? [quantile(perKms, 0.25), quantile(perKms, 0.75)]
          : undefined,
        eurPerKmN: perKms.length,
        singleBidShare: bidKnown.length ? single / bidKnown.length : undefined,
        directShare: tot > 0 ? directEur / tot : 0,
      };
    },
  );
  corridors.sort((a, b) => b.totalEur - a.totalEur);

  // Region aggregation — ОПУ regional-maintenance lots by oblast.
  const rMap = new Map<string, RoadContract[]>();
  for (const r of rows) {
    if (!r.region) continue;
    const arr = rMap.get(r.region) ?? [];
    arr.push(r);
    rMap.set(r.region, arr);
  }
  const regions: RegionAgg[] = [...rMap.entries()]
    .map(([region, arr]) => {
      const tot = arr.reduce((s, r) => s + r.amountEur, 0);
      const bidKnown = arr.filter((r) => r.c.numberOfTenderers != null);
      const single = bidKnown.filter((r) =>
        isSingleBid(r.c.numberOfTenderers),
      ).length;
      return {
        region,
        totalEur: tot,
        contractCount: arr.length,
        singleBidShare: bidKnown.length ? single / bidKnown.length : undefined,
      };
    })
    .sort((a, b) => b.totalEur - a.totalEur);

  // Work-group split (build vs repair vs maintenance vs design).
  const wgMap = new Map<WorkGroup, WorkGroupAgg>();
  for (const r of rows) {
    const a = wgMap.get(r.group) ?? {
      group: r.group,
      totalEur: 0,
      contractCount: 0,
    };
    a.totalEur += r.amountEur;
    a.contractCount++;
    wgMap.set(r.group, a);
  }
  const workGroups = [...wgMap.values()].sort(
    (a, b) => b.totalEur - a.totalEur,
  );

  // Component split ("what kind of work") + per-component integrity / capture.
  const cMap = new Map<WorkComponent, RoadContract[]>();
  for (const r of rows) {
    const arr = cMap.get(r.component) ?? [];
    arr.push(r);
    cMap.set(r.component, arr);
  }
  const components: ComponentAgg[] = [...cMap.entries()]
    .map(([component, arr]) => {
      const tot = arr.reduce((s, r) => s + r.amountEur, 0);
      const bidKnown = arr.filter((r) => r.c.numberOfTenderers != null);
      const single = bidKnown.filter((r) =>
        isSingleBid(r.c.numberOfTenderers),
      ).length;
      // Largest contractor by € in this component (niche-capture signal).
      const byEik = new Map<string, { name: string; eur: number }>();
      for (const r of arr) {
        const e = byEik.get(r.c.contractorEik) ?? {
          name: r.c.contractorName,
          eur: 0,
        };
        e.eur += r.amountEur;
        byEik.set(r.c.contractorEik, e);
      }
      const top = [...byEik.values()].sort((a, b) => b.eur - a.eur)[0];
      return {
        component,
        totalEur: tot,
        contractCount: arr.length,
        singleBidShare: bidKnown.length ? single / bidKnown.length : undefined,
        topContractorName: top?.name,
        topContractorShare: top && tot > 0 ? top.eur / tot : undefined,
      };
    })
    .sort((a, b) => b.totalEur - a.totalEur);

  // Yearly series — € by work group + by top corridor + by top region.
  const topCorridorNames = new Set(
    corridors.slice(0, 6).map((c) => c.corridor),
  );
  const topRegionNames = new Set(regions.slice(0, 6).map((r) => r.region));
  const yMap = new Map<string, YearAgg>();
  const yBid = new Map<string, { known: number; single: number }>();
  for (const r of rows) {
    const year = (r.c.date || "").slice(0, 4);
    if (!/^\d{4}$/.test(year)) continue;
    const ya = yMap.get(year) ?? {
      year,
      totalEur: 0,
      groups: {
        build: 0,
        rehab: 0,
        maintenance: 0,
        design: 0,
        other: 0,
      } as Record<WorkGroup, number>,
      corridors: {},
      regions: {},
      growthEur: 0,
    };
    ya.totalEur += r.amountEur;
    ya.growthEur += annexGrowthOf(r.c);
    ya.groups[r.group] += r.amountEur;
    const ck =
      r.ref && topCorridorNames.has(r.ref.corridor) ? r.ref.corridor : "other";
    ya.corridors[ck] = (ya.corridors[ck] ?? 0) + r.amountEur;
    const rk = r.region && topRegionNames.has(r.region) ? r.region : "other";
    ya.regions[rk] = (ya.regions[rk] ?? 0) + r.amountEur;
    yMap.set(year, ya);
    if (r.c.numberOfTenderers != null) {
      const b = yBid.get(year) ?? { known: 0, single: 0 };
      b.known++;
      if (isSingleBid(r.c.numberOfTenderers)) b.single++;
      yBid.set(year, b);
    }
  }
  const years: YearAgg[] = [...yMap.values()]
    .map((y) => {
      const b = yBid.get(y.year);
      return {
        ...y,
        singleBidShare: b && b.known ? b.single / b.known : undefined,
      };
    })
    .sort((a, b) => a.year.localeCompare(b.year));

  // Top contractors (all, not just MP-connected) + competition profile.
  const conMap = new Map<
    string,
    {
      eik: string;
      name: string;
      totalEur: number;
      contractCount: number;
      known: number;
      single: number;
      byComp: Map<WorkComponent, number>;
    }
  >();
  for (const r of rows) {
    const e = conMap.get(r.c.contractorEik) ?? {
      eik: r.c.contractorEik,
      name: r.c.contractorName,
      totalEur: 0,
      contractCount: 0,
      known: 0,
      single: 0,
      byComp: new Map<WorkComponent, number>(),
    };
    e.name = r.c.contractorName || e.name;
    e.totalEur += r.amountEur;
    e.contractCount++;
    if (r.c.numberOfTenderers != null) {
      e.known++;
      if (isSingleBid(r.c.numberOfTenderers)) e.single++;
    }
    e.byComp.set(r.component, (e.byComp.get(r.component) ?? 0) + r.amountEur);
    conMap.set(r.c.contractorEik, e);
  }
  const contractors: TopContractor[] = [...conMap.values()]
    .sort((a, b) => b.totalEur - a.totalEur)
    .map((e) => ({
      eik: e.eik,
      name: e.name,
      totalEur: e.totalEur,
      contractCount: e.contractCount,
      singleBidShare: e.known ? e.single / e.known : undefined,
      topComponent: [...e.byComp.entries()].sort((a, b) => b[1] - a[1])[0][0],
    }));
  const topContractors = contractors.slice(0, 12);

  // Procedure mix.
  const mMap = new Map<ProcedureBucket, number>();
  for (const r of rows) {
    const b = procedureBucket(r.c.procurementMethod);
    mMap.set(b, (mMap.get(b) ?? 0) + r.amountEur);
  }
  const methods: MethodAgg[] = [...mMap.entries()]
    .map(([bucket, totalEur]) => ({ bucket, totalEur }))
    .sort((a, b) => b.totalEur - a.totalEur);

  const topProjects = [...rows]
    .sort((a, b) => b.amountEur - a.amountEur)
    .slice(0, 10);

  return {
    rows,
    corridors,
    regions,
    workGroups,
    components,
    years,
    topContractors,
    contractors,
    methods,
    topProjects,
    singleBidShare: stats.singleBidShare ?? undefined,
    directShare: stats.directShare,
    refCoverageEur: totalEur > 0 ? refEur / totalEur : 0,
    totalEur,
  };
};
