// Pure helpers shared by the /sector/edu screens and their tests. Kept out of
// the screen modules so each of those exports components only (fast refresh).
// Plan: docs/plans/edu-hub-v1.md §3.

import type { EduBodyAgg, EduFundOp } from "@/data/edu/useEduSector";
import {
  EDU_ENTITIES,
  EDU_UNIVERSES,
  type EducationUniverse,
} from "@/lib/educationReferenceData";
import { EDU_UNIVERSE_PARAMS } from "@/lib/eduPaths";

/** The hub's heading — also the prerendered <h1> (scripts/prerender/routes.ts). */
export const EDU_HUB_TITLE = {
  bg: "Образование и наука",
  en: "Education and science",
};

/** `?universe=` validated on read: an unknown value is the whole sector. */
export const parseUniverse = (raw: string | null): EducationUniverse | null =>
  raw && (EDU_UNIVERSE_PARAMS as readonly string[]).includes(raw)
    ? (raw as EducationUniverse)
    : null;

export interface UniverseRow {
  universe: EducationUniverse;
  totalEur: number;
  contractCount: number;
  bidKnownN: number;
  singleBidN: number;
}

/** Per-universe ex-member aggregates from the per-body rollup. */
export const universeRows = (bodies: EduBodyAgg[]): UniverseRow[] => {
  const m = new Map<EducationUniverse, UniverseRow>();
  for (const b of bodies) {
    if (!b.universe) continue;
    const r = m.get(b.universe) ?? {
      universe: b.universe,
      totalEur: 0,
      contractCount: 0,
      bidKnownN: 0,
      singleBidN: 0,
    };
    r.totalEur += b.totalEur;
    r.contractCount += b.contractCount;
    r.bidKnownN += b.bidKnownN;
    r.singleBidN += b.singleBidN;
    m.set(b.universe, r);
  }
  return EDU_UNIVERSES.map((u) => m.get(u)).filter(
    (r): r is UniverseRow => !!r && r.contractCount > 0,
  );
};

/** Per-institution aggregate in the window, kept apart from the rollup's raw
 *  per-EIK rows so the fold below is the only place the two meet. */
export interface Agg {
  totalEur: number;
  contractCount: number;
  bidKnownN: number;
  singleBidN: number;
}

/** Folds each retired EIK's row into its successor's (A5/A6). Exported for the
 *  test: a fold that drops a row would under-state a university with nothing
 *  failing. */
export const foldRetired = (bodies: EduBodyAgg[]): Map<string, Agg> => {
  const successor = new Map(
    EDU_ENTITIES.filter((e) => e.retiredEikOf).map((e) => [
      e.eik,
      e.retiredEikOf as string,
    ]),
  );
  const out = new Map<string, Agg>();
  for (const b of bodies) {
    const key = successor.get(b.eik) ?? b.eik;
    const a = out.get(key) ?? {
      totalEur: 0,
      contractCount: 0,
      bidKnownN: 0,
      singleBidN: 0,
    };
    a.totalEur += b.totalEur;
    a.contractCount += b.contractCount;
    a.bidKnownN += b.bidKnownN;
    a.singleBidN += b.singleBidN;
    out.set(key, a);
  }
  return out;
};

/** A share as a percent, at `digits` decimals. The ONE percent formatter of the
 *  edu pages (the hub's null-guarded `pct0` wraps it). */
export const eduPct = (v: number, bg: boolean, digits = 0): string =>
  new Intl.NumberFormat(bg ? "bg-BG" : "en-GB", {
    maximumFractionDigits: digits,
  }).format(v * 100) + "%";

/** The ИСУН rows folded the same way as `foldRetired` (A5/A6): a retired EIK's
 *  grants land on its successor, so /money lists and counts one row per
 *  institution. */
export const foldRetiredFunds = (rows: EduFundOp[]): EduFundOp[] => {
  const successor = new Map(
    EDU_ENTITIES.filter((e) => e.retiredEikOf).map((e) => [
      e.eik,
      e.retiredEikOf as string,
    ]),
  );
  const out = new Map<string, EduFundOp>();
  for (const r of rows) {
    const eik = successor.get(r.eik) ?? r.eik;
    const a = out.get(eik);
    out.set(
      eik,
      a
        ? {
            ...a,
            grantEur: a.grantEur + r.grantEur,
            paidEur: a.paidEur + r.paidEur,
            projectCount: a.projectCount + r.projectCount,
          }
        : { ...r, eik },
    );
  }
  return [...out.values()];
};
