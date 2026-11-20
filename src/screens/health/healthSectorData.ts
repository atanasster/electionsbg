// Pure helpers shared by the /sector/health screens and their tests. Kept out of
// the screen modules so each of those exports components only (fast refresh).
// Plan: docs/plans/health-hub-v1.md §3.

import {
  HEALTH_ENTITIES,
  HEALTH_UNIVERSES,
  type HealthUniverse,
} from "@/lib/healthReferenceData";
import { HEALTH_UNIVERSE_PARAMS } from "@/lib/healthPaths";
import type { HealthBodyAgg } from "@/data/health/useHealthSector";
import type { HealthPaymentStream } from "@/data/health/hubStats";

/** The hub's heading — also the prerendered <h1> (scripts/prerender/routes.ts). */
export const HEALTH_HUB_TITLE = {
  bg: "Здравеопазване",
  en: "Healthcare",
};

/** The payments corpus's three streams, as a reader names them. */
export const STREAM_LABEL: Record<
  HealthPaymentStream,
  { bg: string; en: string }
> = {
  bmp: { bg: "болнична помощ", en: "hospital care" },
  drugs: { bg: "лекарства", en: "medicines" },
  devices: { bg: "медицински изделия", en: "medical devices" },
};

/** `?universe=` validated on read: an unknown value is the whole sector. */
export const parseUniverse = (raw: string | null): HealthUniverse | null =>
  raw && (HEALTH_UNIVERSE_PARAMS as readonly string[]).includes(raw)
    ? (raw as HealthUniverse)
    : null;

/** A share as a percent, at `digits` decimals — the ONE percent formatter of the
 *  health pages. */
export const healthPct = (v: number, bg: boolean, digits = 0): string =>
  new Intl.NumberFormat(bg ? "bg-BG" : "en-GB", {
    maximumFractionDigits: digits,
  }).format(v * 100) + "%";

const BY_EIK = new Map(HEALTH_ENTITIES.map((e) => [e.eik, e]));

/** A retired EIK's successor, else the EIK itself — the ONE retired-EIK fold
 *  of the health pages (procurement bodies and EU funds alike). */
export const successorOf = (eik: string): string =>
  BY_EIK.get(eik)?.retiredEikOf ?? eik;

export const healthEntityName = (eik: string, bg: boolean): string => {
  const e = BY_EIK.get(eik);
  return e ? (bg ? e.name.bg : e.name.en) : `ЕИК ${eik}`;
};

/** Per-institution aggregate with the retired РИОКОЗ EIKs folded into their
 *  successors (A6 of the edu plan, the same rule): one row per institution. */
export interface HealthInstitutionRow extends HealthBodyAgg {
  universe: HealthUniverse | null;
}

export const foldBodies = (
  bodies: readonly HealthBodyAgg[],
): HealthInstitutionRow[] => {
  const out = new Map<string, HealthInstitutionRow>();
  for (const b of bodies) {
    const eik = successorOf(b.eik);
    const a = out.get(eik);
    out.set(
      eik,
      a
        ? {
            ...a,
            totalEur: a.totalEur + b.totalEur,
            contractCount: a.contractCount + b.contractCount,
            bidKnownN: a.bidKnownN + b.bidKnownN,
            singleBidN: a.singleBidN + b.singleBidN,
            frameworkEur: a.frameworkEur + b.frameworkEur,
            frameworkN: a.frameworkN + b.frameworkN,
          }
        : { ...b, eik, universe: BY_EIK.get(eik)?.universe ?? null },
    );
  }
  return [...out.values()].sort(
    (x, y) => y.totalEur - x.totalEur || x.eik.localeCompare(y.eik),
  );
};

export interface HealthUniverseRow {
  universe: HealthUniverse;
  totalEur: number;
  contractCount: number;
  bidKnownN: number;
  singleBidN: number;
  frameworkEur: number;
}

/** Per-universe sums of the folded rows, in HEALTH_UNIVERSES order, empty
 *  universes dropped. */
export const universeRows = (
  rows: readonly HealthInstitutionRow[],
): HealthUniverseRow[] => {
  const m = new Map<HealthUniverse, HealthUniverseRow>();
  for (const r of rows) {
    if (!r.universe) continue;
    const a = m.get(r.universe) ?? {
      universe: r.universe,
      totalEur: 0,
      contractCount: 0,
      bidKnownN: 0,
      singleBidN: 0,
      frameworkEur: 0,
    };
    a.totalEur += r.totalEur;
    a.contractCount += r.contractCount;
    a.bidKnownN += r.bidKnownN;
    a.singleBidN += r.singleBidN;
    a.frameworkEur += r.frameworkEur;
    m.set(r.universe, a);
  }
  return HEALTH_UNIVERSES.map((u) => m.get(u)).filter(
    (r): r is HealthUniverseRow =>
      !!r && (r.contractCount > 0 || r.frameworkEur > 0),
  );
};
