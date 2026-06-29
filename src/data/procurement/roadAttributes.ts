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
// with a real amount — frameworks, design and supervision contracts are
// excluded rather than shown a meaningless unit cost.

import type { ProcurementContract } from "@/data/dataTypes";
import { procedureBucket, type ProcedureBucket } from "@/lib/cpvSectors";

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

export interface RoadRef {
  /** Stable corridor grouping key — motorway name or "I-1" / "III-2903". */
  corridor: string;
  /** OSM `ref` for the map join, when known. */
  osmRef?: string;
  roadClass: RoadClass;
  /** true for the named-motorway matches (used to label / colour). */
  isMotorway: boolean;
}

/** Extract the road designation from a contract title, if any. */
export const roadRefOf = (title: string): RoadRef | undefined => {
  const n = (title || "").toLowerCase();
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
  return undefined;
};

// --- Chainage / length ------------------------------------------------------

const RANGE = /от\s*км\s*(\d+)\s*\+\s*(\d+)\s*до\s*км\s*(\d+)\s*\+\s*(\d+)/gi;
const KMPT = /км\s*(\d+)\s*\+\s*(\d+)/gi;

export interface ParsedLength {
  lengthKm: number;
  segments: number;
}

/** Parse the funded length from a title's chainage. Sums explicit
 *  "от км A до км B" ranges; falls back to max−min of bare km markers. */
export const lengthOf = (title: string): ParsedLength | undefined => {
  const t = title || "";
  RANGE.lastIndex = 0;
  let total = 0;
  let n = 0;
  let r: RegExpExecArray | null;
  while ((r = RANGE.exec(t)) !== null) {
    const a = Number(r[1]) + Number(r[2]) / 1000;
    const b = Number(r[3]) + Number(r[4]) / 1000;
    total += Math.abs(b - a);
    n++;
  }
  if (n > 0) return { lengthKm: total, segments: n };
  KMPT.lastIndex = 0;
  const pts: number[] = [];
  while ((r = KMPT.exec(t)) !== null)
    pts.push(Number(r[1]) + Number(r[2]) / 1000);
  if (pts.length >= 2) {
    return { lengthKm: Math.max(...pts) - Math.min(...pts), segments: 1 };
  }
  return undefined;
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

/** Coarse classification of a contract's work type — title verbs first, then a
 *  CPV-code fallback for verb-less titles. */
export const workTypeOf = (title: string, cpv?: string): WorkType => {
  const n = (title || "").toLowerCase();
  if (
    /надзор|консултант|инвеститорски|оценка на съответст|одит|овос|експертиз|инвентаризац/.test(
      n,
    )
  )
    return "supervision";
  if (/поддър|снегопочист|зимно/.test(n)) return "area_maint";
  if (n.includes("проектиране") && !/строителств|ремонт/.test(n))
    return "design";
  if (n.includes("основен ремонт")) return "rehab_major";
  if (/рехабилитац/.test(n)) return "rehab";
  if (/реконструкц/.test(n)) return "reconstruction";
  if (/строителств|изграждане/.test(n)) return "new_build";
  if (/превантив/.test(n)) return "preventive";
  if (/текущ ремонт/.test(n)) return "rehab";
  return workTypeFromCpv(cpv) ?? "other";
};

// Display grouping for the build-vs-repair donut.
export type WorkGroup = "build" | "rehab" | "maintenance" | "design" | "other";
export const workGroupOf = (w: WorkType): WorkGroup => {
  if (w === "new_build" || w === "reconstruction") return "build";
  if (w === "rehab_major" || w === "rehab" || w === "preventive")
    return "rehab";
  if (w === "maintenance" || w === "area_maint") return "maintenance";
  if (w === "design" || w === "supervision") return "design";
  return "other";
};

// --- €/km gating ------------------------------------------------------------

const BUILD_FLOOR = 1_000_000;
const REHAB_FLOOR = 150_000;
const PER_KM_FLOOR = 30_000; // below this, an amount↔length scope mismatch is certain

export interface EurPerKm {
  eurPerKm: number;
  lengthKm: number;
  confidence: "high" | "med";
}

/** Defensible €/km for one contract, or undefined if it should not carry one. */
export const eurPerKmOf = (
  c: ProcurementContract,
  workType: WorkType,
  len: ParsedLength | undefined,
): EurPerKm | undefined => {
  if (!PHYSICAL.has(workType)) return undefined;
  if (!len) return undefined;
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
  | "lighting"
  | "drainage"
  | "retaining"
  | "winter_maint"
  | "roadway"
  | "design_supervision"
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
  if (/тунел/.test(n)) return "tunnel";
  if (/мост|надлез|подлез|естакад|виадукт/.test(n) || cpv?.startsWith("45221"))
    return "bridge";
  if (
    /\bтол\b|тол систем|естп|електронн[а-я ]{0,12}такс|видеонаблюд|система за просле/.test(
      n,
    ) ||
    eqAny(cpv, ["63712200", "50312610", "34972000"])
  )
    return "tolling_its";
  if (
    /маркировк|пътни знаци|вертикална сигнализац|пътна сигнализац/.test(n) ||
    eqAny(cpv, ["45233221", "45233290", "34992200"])
  )
    return "markings_signs";
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

// --- Per-contract enrichment + corpus aggregation ---------------------------

export interface RoadContract {
  c: ProcurementContract;
  ref?: RoadRef;
  workType: WorkType;
  group: WorkGroup;
  component: WorkComponent;
  perKm?: EurPerKm;
  amountEur: number;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (xs: number[], q: number): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

export interface CorridorAgg {
  corridor: string;
  osmRef?: string;
  roadClass: RoadClass;
  isMotorway: boolean;
  totalEur: number;
  contractCount: number;
  eurPerKmMedian?: number;
  eurPerKmIqr?: [number, number];
  eurPerKmN: number;
  singleBidShare?: number; // over rows with a known bidder count
  directShare: number; // € via direct/no-notice procedures
}

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

export interface RoadsModel {
  /** Deduped, amendment-free contract rows with road attributes. */
  rows: RoadContract[];
  corridors: CorridorAgg[];
  workGroups: WorkGroupAgg[];
  components: ComponentAgg[];
  methods: MethodAgg[];
  topProjects: RoadContract[];
  // Corpus integrity headline (over rows with a known value).
  singleBidShare?: number;
  directShare: number;
  refCoverageEur: number; // € share carrying a road ref (0..1)
  totalEur: number; // sum over the deduped non-amendment rows
}

/** Build the full dashboard model from an awarder's contract rows. */
export const buildRoadsModel = (
  contracts: ProcurementContract[],
): RoadsModel => {
  // Dedup by contract key; drop amendments so money is not double-counted.
  const seen = new Set<string>();
  const rows: RoadContract[] = [];
  for (const c of contracts) {
    if (c.tag === "contractAmendment") continue;
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    const ref = roadRefOf(c.title);
    const workType = workTypeOf(c.title, c.cpv);
    const len = lengthOf(c.title);
    rows.push({
      c,
      ref,
      workType,
      group: workGroupOf(workType),
      component: workComponentOf(c.title, c.cpv, workType),
      perKm: eurPerKmOf(c, workType, len),
      amountEur: c.amountEur ?? 0,
    });
  }

  const totalEur = rows.reduce((s, r) => s + r.amountEur, 0);
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
      const perKms = arr
        .map((r) => r.perKm?.eurPerKm)
        .filter((x): x is number => x != null);
      const bidKnown = arr.filter((r) => r.c.numberOfTenderers != null);
      const single = bidKnown.filter((r) => r.c.numberOfTenderers === 1).length;
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
        eurPerKmMedian: perKms.length ? median(perKms) : undefined,
        eurPerKmIqr: perKms.length
          ? [quantile(perKms, 0.25), quantile(perKms, 0.75)]
          : undefined,
        eurPerKmN: perKms.length,
        singleBidShare: bidKnown.length ? single / bidKnown.length : undefined,
        directShare: tot > 0 ? directEur / tot : 0,
      };
    },
  );
  corridors.sort((a, b) => b.totalEur - a.totalEur);

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
      const single = bidKnown.filter((r) => r.c.numberOfTenderers === 1).length;
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

  // Procedure mix.
  const mMap = new Map<ProcedureBucket, number>();
  for (const r of rows) {
    const b = procedureBucket(r.c.procurementMethod);
    mMap.set(b, (mMap.get(b) ?? 0) + r.amountEur);
  }
  const methods: MethodAgg[] = [...mMap.entries()]
    .map(([bucket, totalEur]) => ({ bucket, totalEur }))
    .sort((a, b) => b.totalEur - a.totalEur);

  // Headline integrity.
  const bidKnown = rows.filter((r) => r.c.numberOfTenderers != null);
  const singleBidShare = bidKnown.length
    ? bidKnown.filter((r) => r.c.numberOfTenderers === 1).length /
      bidKnown.length
    : undefined;
  const directEur = rows.reduce(
    (s, r) =>
      procedureBucket(r.c.procurementMethod) === "direct" ? s + r.amountEur : s,
    0,
  );

  const topProjects = [...rows]
    .sort((a, b) => b.amountEur - a.amountEur)
    .slice(0, 10);

  return {
    rows,
    corridors,
    workGroups,
    components,
    methods,
    topProjects,
    singleBidShare,
    directShare: totalEur > 0 ? directEur / totalEur : 0,
    refCoverageEur: totalEur > 0 ? refEur / totalEur : 0,
    totalEur,
  };
};
