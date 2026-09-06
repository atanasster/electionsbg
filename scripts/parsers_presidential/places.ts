// Placing a section: which settlement, municipality and oblast its votes belong to.
//
// ⚠⚠ THE SECTION-CODE PREFIX IS NOT A SHARED GRID, AND TREATING IT AS ONE MISFILES A
// CAPITAL CITY. 2011 ran through the ОИК alongside that year's local vote, so its codes
// are on the 28-oblast grid where prefix `22` is София-град; on the 31-МИР parliamentary
// grid every other era uses, prefix `22` is Смолян. Measured: `224601001` is гр.София in
// 2011 and `220200001` is с.Баните in 2021. One shared map would file Sofia's ~400,000
// votes in Smolyan, and every count would still reconcile.
//
// So nothing here hard-codes a prefix→oblast table. Each section is placed by its own
// ЕКАТТЕ, and the prefix map is DERIVED per round from the sections that placed — which
// is per-era by construction and cannot be applied to the wrong grid.
//
// ⚠ `data/settlements.json` IS NOT A COMPLETE ЕКАТТЕ CATALOGUE. It holds 5,364 rows and
// carries neither София (68134) nor the absorbed quarters like Банево (02573), so
// 12.1–13.2% of domestic sections per cycle name a code it does not have. That is why the
// fallback exists — and why what the fallback may claim is deliberately narrow: an oblast
// and nothing finer, and only where the prefix's own witnesses agree.
//
// Plan: docs/plans/presidential-elections-v1.md T3.1.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAbroadCity, resolveCountryName } from "./abroad";
import type { PresidentialEra } from "./sources";
import type { PresidentialRound, PresidentialSection } from "./types";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** One catalogue row, narrowed to what placement needs. */
interface CatalogueRow {
  ekatte: string;
  name: string;
  oblast: string;
  obshtina: string;
  nuts3?: string;
}

let catalogue: Map<string, CatalogueRow> | null = null;

/** `data/settlements.json`, keyed by ЕКАТТЕ, read once. */
export const settlementCatalogue = (): Map<string, CatalogueRow> => {
  if (catalogue) return catalogue;
  const rows = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, "data/settlements.json"), "utf8"),
  ) as CatalogueRow[];
  catalogue = new Map(
    rows.filter((r) => r.oblast !== "32").map((r) => [r.ekatte, r]),
  );
  return catalogue;
};

/**
 * The section-code prefix that means „outside the country", PER ERA.
 *
 * ⚠ THE ONE PLACE THIS KNOWLEDGE LIVES, and it is per-era because the grids genuinely
 * disagree — 2011 ran on the 28-oblast ОИК grid where abroad is `29`, everyone else on
 * the 31-МИР grid where it is `32`. On the МИР grid `29` is Хасково and on the ОИК grid
 * `32` does not exist at all.
 */
export const ABROAD_PREFIX_BY_ERA: Record<PresidentialEra, string> = {
  "2001": "32",
  "2006": "32",
  "2011": "29",
  "2016": "32",
  "2021": "32",
};

/**
 * How unanimous a prefix's witnesses must be before it may place anything.
 *
 * ⚠⚠ THE FALLBACK USED TO TAKE THE PLURALITY, WHICH REPRODUCED THE VERY DEFECT THIS
 * MODULE OPENS BY WARNING ABOUT — one level down. 2011's prefix `22` is София-град, which
 * the МИР catalogue splits into S23, S24 and S25; its witnesses are 54 / 35 / 12, a 53.5%
 * plurality. Committing to the winner filed **1,354 sections and 441,328 votes, 13.1% of
 * round 1**, in S25 — roughly two thirds of them in the wrong МИР, with every count
 * reconciling.
 *
 * ⚠ 0.95, not 1.0, and the gap is measured rather than chosen. 2001's prefixes 18 and 19
 * and 2006's 06 and 08 each carry a handful of strays against hundreds (197:3, 325:4,
 * 159:4, 390:1) — an ЕКАТТЕ typo or a relocated station, noise in the WITNESSES rather
 * than a prefix that genuinely spans two oblasts. Demanding unanimity would refuse those
 * four otherwise-clean prefixes, and no prefix in this corpus sits between 0.975 and 1.0.
 */
export const PREFIX_PURITY_FLOOR = 0.95;

/** Where a section's votes belong. */
export interface Place {
  /** ЕКАТТЕ, when the catalogue carries the section's code. */
  ekatte?: string;
  /** Municipality key (`BLG52`), only ever from the catalogue. */
  obshtina?: string;
  /** Oblast key (`BLG`, `S23`). */
  oblast: string;
  /** How it was placed — see `PlaceBasis`. */
  basis: PlaceBasis;
}

/**
 * How a section was placed.
 *
 * ⚠ CARRIED THROUGH, not discarded once the answer is found. „This section is in Пловдив"
 * and „this section is in a prefix whose other sections are in Пловдив" are different
 * claims, and only the first supports a settlement-level figure.
 */
export type PlaceBasis =
  /** The catalogue carries this section's ЕКАТТЕ. Settlement, municipality and oblast. */
  | "ekatte"
  /** The catalogue does not. Oblast only, from the round's own derived prefix map. */
  | "code-prefix"
  /** Outside the country. */
  | "abroad";

/** Why a domestic section could not be placed. */
export type UnplacedReason =
  /** Its prefix has no placed sections at all, so nothing witnesses its oblast. */
  | "no-witnesses"
  /**
   * Its prefix's witnesses disagree past `PREFIX_PURITY_FLOOR`. The prefix spans more
   * than one oblast, so any single answer would be a guess about real votes.
   */
  | "ambiguous-prefix";

export interface AbroadPlace {
  country: string | null;
  city: string;
  /**
   * How the country was established.
   *
   * ⚠ `code-group` IS WEAKER THAN THE OTHERS AND IS STILL EVIDENCE FROM THE FILE. See
   * `abroadCountryField`: it is the country the section's OWN code-group agrees on, adopted
   * only when every resolved member of that group names the same one. It is not a guess from
   * a city name — „Триполи" is Libya here because its group-mate is Бенгази, not because
   * somebody knew.
   */
  /** ⚠ `file` IS RESERVED AND UNREACHABLE TODAY. Every reader that sets `section.abroad`
   *  hard-codes `country: null` (era2001/2006/2011) and 2016/2021 set no `abroad` at all, so
   *  only three of the four routes can occur — measured, `file` is 0 across all ten rounds. It
   *  stays in the union because a reader that starts publishing a country is a change that
   *  should not also have to widen a type. */
  countryBasis?: "file" | "name" | "city" | "code-group";
}

export interface PlacedRound {
  /** Section code → place, for every DOMESTIC section that could be placed. */
  domestic: Map<string, Place>;
  /** Section code → country, for every abroad section. `country` may be null. */
  abroad: Map<string, AbroadPlace>;
  /** The prefix→oblast map derived from THIS round. Never reused across cycles. */
  prefixOblast: Map<string, string>;
  report: PlacementReport;
}

export interface PlacementReport {
  cycle: string;
  round: 1 | 2;
  sections: number;
  placedByEkatte: number;
  placedByPrefix: number;
  /**
   * Domestic sections this module refuses to place, with the reason.
   *
   * ⚠ REFUSED, NOT LOST. Their votes are still in the round and still in every national
   * figure; what they lack is an oblast attribution the evidence cannot support. A
   * consumer must exclude them from a per-oblast roll-up AND say how many it excluded —
   * silently assigning them is what `PREFIX_PURITY_FLOOR` exists to stop.
   */
  unplaced: {
    code: string;
    placeName: string;
    ekatte?: string;
    reason: UnplacedReason;
    /**
     * The section's own total.
     *
     * ⚠ CARRIED, because „refused, not lost" is otherwise a claim the written tree does
     * not support. Measured: 2011's 1,354 refusals hold 441,328 votes, 13.1% of round 1,
     * and with only a code and a reason on the row those votes appear in no file at all
     * — the roll-ups exclude them by design and nothing else names them.
     */
    votes: number;
  }[];
  abroadSections: number;
  /** Abroad sections whose country the corpus cannot name. Written, never dropped. */
  abroadUnresolved: { code: string; city: string }[];
  /**
   * Abroad sections whose country came from their code-group rather than their name.
   *
   * ⚠ REPORTED, because it is the weakest of the four routes and the only one that depends on
   * a property of the CODE SPACE rather than on a name. 2001 recovers 16 sections this way and
   * 2011 recovers 10; 2006 recovers none, because its abroad codes carry a constant `99` and
   * the group spans 48 countries — which the rule refuses rather than resolving to the
   * commonest.
   */
  abroadByCodeGroup: { code: string; city: string; country: string }[];
  /**
   * Prefixes whose placed sections disagree about their oblast, with the counts.
   *
   * ⚠ NOT ALWAYS A DEFECT, WHICH IS WHY `purity` AND `witnesses` RIDE ALONG. Two shapes
   * appear, and only the counts separate them:
   *
   *   • A prefix that genuinely SPANS oblasts. 2011's `22` is София-град, which the МИР
   *     catalogue splits into S23/S24/S25 (54/35/12), and its `16` is the whole of
   *     Пловдив, which the catalogue carries as `PDV` (the градски МИР) and `PDV-00`
   *     (501/460) — a real distinction `src/lib/oblastName.ts` documents, not a catalogue
   *     defect. Neither places a section; see `PREFIX_PURITY_FLOOR`.
   *   • A prefix with a handful of STRAYS. 2001's 18 and 19 and 2006's 06 and 08 sit at
   *     197:3, 325:4, 159:4 and 390:1 — an ЕКАТТЕ typo or a relocated station. These
   *     still place.
   */
  /**
   * Sections whose ЕКАТТЕ named a different oblast from their own prefix's.
   *
   * ⚠ THE ЕКАТТЕ LOSES, and the section keeps its oblast but gives up its settlement.
   * Measured: 14 in 2001 and 10 in 2006, none after. `с.Зверино` is in Мездра, Враца, and
   * its recorded ЕКАТТЕ 81414 resolves to Чирпан, Стара Загора — a source typo, and the
   * place name is what says so. Trusting the code files a real village's votes in another
   * oblast at a basis that claims to be exact; refusing it costs the settlement figure and
   * keeps the oblast one right.
   */
  ekatteOblastConflicts: {
    code: string;
    placeName: string;
    ekatte: string;
    ekatteOblast: string;
    prefixOblast: string;
  }[];
  mixedPrefixes: {
    prefix: string;
    oblasts: Record<string, number>;
    /** How many placed sections voted on this prefix. */
    witnesses: number;
    /** The winner's share of them. */
    purity: number;
    /** Whether it cleared `PREFIX_PURITY_FLOOR` and may place its pending sections. */
    placesSections: boolean;
  }[];
}

/**
 * The country field of an abroad section code — `320100005` → `01`.
 *
 * ⚠⚠ IT IS A PER-ROUND ORDINAL, NOT A COUNTRY ID. It means „the first country in THIS file",
 * so it is meaningless across cycles and across rounds, and nothing may key on it. Measured
 * over the committed corpus: 2001 has 64 such groups and 2011 has 58, and **not one group in
 * either contains two different countries** — which is what makes the fallback below evidence
 * rather than a guess. 2006 is the counter-example that proves the refusal has to exist: every
 * one of its abroad sections carries a constant `99`, so its single group spans 48 countries
 * and resolves nothing.
 */
const abroadCountryField = (code: string): string => code.slice(2, 4);

/**
 * Place every section of a round.
 *
 * @param round - A round as read by its era's reader.
 * @returns The placements and a report. ⚠ NOTHING IS DROPPED: a section the catalogue
 *   cannot place appears in `unplaced`, and an abroad section whose country is unknown
 *   appears in `abroadUnresolved` with `country: null`. Both hold real votes.
 */
export const placeRound = (round: PresidentialRound): PlacedRound => {
  const cat = settlementCatalogue();
  const domestic = new Map<string, Place>();
  const abroad = new Map<string, AbroadPlace>();
  const abroadUnresolved: PlacementReport["abroadUnresolved"] = [];
  const unplaced: PlacementReport["unplaced"] = [];

  // Pass 1 — ЕКАТТЕ, the only route to a settlement and a municipality.
  const prefixCounts = new Map<string, Map<string, number>>();
  const pending: PresidentialSection[] = [];
  const abroadPrefix = ABROAD_PREFIX_BY_ERA[round.sourceEra];
  for (const s of round.sections) {
    // ⚠ TWO WAYS A SECTION IS ABROAD, and both are structural rather than a guess about
    // its name. The 2006 and 2011 readers set `abroad` because their files say so; 2016
    // and 2021 do not, so the CODE PREFIX decides — per era, see `ABROAD_PREFIX_BY_ERA`.
    // Without the second arm all 750 of 2021's abroad sections read as „unplaced".
    const isAbroad = Boolean(s.abroad) || s.code.startsWith(abroadPrefix);
    if (isAbroad) {
      // ⚠ Resolution is by descending certainty: what the file says, then the country it
      // NAMES, then the city table. The table answers for names that are also Bulgarian
      // villages (Димитровград, Охрид, Сараево…), so it is the last resort and is only
      // ever reached for a section already known to be abroad.
      const named = s.placeName.indexOf(", ");
      const city =
        s.abroad?.city ??
        (named > 0 ? s.placeName.slice(named + 2).trim() : s.placeName);
      const fromName =
        named > 0 ? resolveCountryName(s.placeName.slice(0, named)) : null;
      const fromCity = fromName ? null : resolveAbroadCity(city);
      const country = s.abroad?.country ?? fromName ?? fromCity;
      const countryBasis = s.abroad?.country
        ? ("file" as const)
        : fromName
          ? ("name" as const)
          : fromCity
            ? ("city" as const)
            : undefined;
      abroad.set(s.code, {
        country,
        city,
        ...(countryBasis ? { countryBasis } : {}),
      });
      if (!country) abroadUnresolved.push({ code: s.code, city });
      continue;
    }
    const row = s.ekatte ? cat.get(s.ekatte) : undefined;
    if (!row) {
      pending.push(s);
      continue;
    }
    domestic.set(s.code, {
      ekatte: row.ekatte,
      obshtina: row.obshtina,
      oblast: row.oblast,
      basis: "ekatte",
    });
    const prefix = s.code.slice(0, 2);
    if (!prefixCounts.has(prefix)) prefixCounts.set(prefix, new Map());
    const m = prefixCounts.get(prefix)!;
    m.set(row.oblast, (m.get(row.oblast) ?? 0) + 1);
  }

  // ⚠ DERIVED FROM THIS ROUND'S OWN SECTIONS, which is what makes it safe. A prefix map
  // built once and shared would be the Sofia/Smolyan defect in the banner.
  const prefixOblast = new Map<string, string>();
  const mixedPrefixes: PlacementReport["mixedPrefixes"] = [];
  for (const [prefix, counts] of [...prefixCounts].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const ranked = [...counts].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    const witnesses = ranked.reduce((a, [, n]) => a + n, 0);
    const purity = ranked[0][1] / witnesses;
    // ⚠ A PREFIX THAT SPANS TWO OBLASTS PLACES NOTHING. See `PREFIX_PURITY_FLOOR`.
    if (purity >= PREFIX_PURITY_FLOOR) prefixOblast.set(prefix, ranked[0][0]);
    if (ranked.length > 1) {
      mixedPrefixes.push({
        prefix,
        oblasts: Object.fromEntries(ranked),
        witnesses,
        purity,
        placesSections: purity >= PREFIX_PURITY_FLOOR,
      });
    }
  }

  // Pass 1b — an ЕКАТТЕ that contradicts its own prefix is a source typo, not a
  // relocation. See `ekatteOblastConflicts`.
  //
  // ⚠ The conflicting sections DID vote in the prefix map above, since it is built from
  // every ЕКАТТЕ placement. At 24 sections across two cycles of 12,000 that cannot move a
  // prefix off its winner — and re-deriving the map after this pass would be circular,
  // since the conflict is defined against it.
  const ekatteOblastConflicts: PlacementReport["ekatteOblastConflicts"] = [];
  for (const s of round.sections) {
    const place = domestic.get(s.code);
    if (!place || place.basis !== "ekatte") continue;
    const expected = prefixOblast.get(s.code.slice(0, 2));
    if (!expected || expected === place.oblast) continue;
    ekatteOblastConflicts.push({
      code: s.code,
      placeName: s.placeName,
      ekatte: place.ekatte!,
      ekatteOblast: place.oblast,
      prefixOblast: expected,
    });
    domestic.set(s.code, { oblast: expected, basis: "code-prefix" });
  }

  // Pass 2 — the sections the catalogue could not place. Oblast only, and only where the
  // prefix's own witnesses agree.
  for (const s of pending) {
    const prefix = s.code.slice(0, 2);
    const oblast = prefixOblast.get(prefix);
    if (!oblast) {
      unplaced.push({
        code: s.code,
        placeName: s.placeName,
        ...(s.ekatte ? { ekatte: s.ekatte } : {}),
        reason: prefixCounts.has(prefix) ? "ambiguous-prefix" : "no-witnesses",
        votes: s.votes.reduce((a, v) => a + v.totalVotes, 0),
      });
      continue;
    }
    // ⚠ No `obshtina` and no `ekatte`: the prefix names an oblast and nothing finer, so
    // inventing either would put a village's votes in a municipality on the strength of
    // its neighbours. A settlement roll-up must therefore exclude these, and the report
    // is what lets a consumer see how much it is excluding.
    domestic.set(s.code, { oblast, basis: "code-prefix" });
  }

  // Pass 4 — the country-ordinal fallback, for abroad sections whose name resolves to nothing.
  //
  // ⚠ THE GROUP MUST NAME EXACTLY ONE COUNTRY. 2006's single group holds 144 sections across 48
  // countries, so adopting its commonest would file its 9 unnamed stations (1,084 votes) in
  // Turkey — 43 of 135 resolved members, a plurality of nothing. Refusing there is the point.
  // What the rule DOES recover is a station whose own group-mates are unambiguous: Триполи
  // beside Бенгази is Libya, Бостън beside Ню Йорк and Вашингтон is the United States —
  // evidence from the file, not a fact somebody knew.
  //
  // ⚠ IT NEVER OVERRIDES A NAME. A section already resolved keeps its basis; this only fills.
  const groupCountries = new Map<string, Set<string>>();
  for (const [code, where] of abroad) {
    if (!where.country) continue;
    const field = abroadCountryField(code);
    if (!groupCountries.has(field)) groupCountries.set(field, new Set());
    groupCountries.get(field)!.add(where.country);
  }
  const abroadByCodeGroup: PlacementReport["abroadByCodeGroup"] = [];
  const stillUnresolved: PlacementReport["abroadUnresolved"] = [];
  for (const row of abroadUnresolved) {
    const set = groupCountries.get(abroadCountryField(row.code));
    const country = set && set.size === 1 ? [...set][0] : null;
    if (!country) {
      stillUnresolved.push(row);
      continue;
    }
    abroad.set(row.code, {
      country,
      city: row.city,
      countryBasis: "code-group",
    });
  }
  // ⚠ DERIVED FROM THE MAP, NOT PUSHED BESIDE IT. The basis and the report row are one claim;
  // written by hand in two places they are kept in step by nothing, and a `placement.json` that
  // under- or over-reports the weakest basis would still reconcile on every count.
  for (const [code, where] of abroad)
    if (where.countryBasis === "code-group" && where.country)
      abroadByCodeGroup.push({
        code,
        city: where.city,
        country: where.country,
      });

  return {
    domestic,
    abroad,
    prefixOblast,
    report: {
      cycle: round.cycle,
      round: round.round,
      sections: round.sections.length,
      placedByEkatte: [...domestic.values()].filter((p) => p.basis === "ekatte")
        .length,
      placedByPrefix: [...domestic.values()].filter(
        (p) => p.basis === "code-prefix",
      ).length,
      unplaced,
      ekatteOblastConflicts,
      abroadSections: abroad.size,
      abroadUnresolved: stillUnresolved,
      abroadByCodeGroup,
      mixedPrefixes,
    },
  };
};

/** A one-line summary of a placement, for an ingest's stdout. */
export const describePlacement = (r: PlacementReport): string =>
  `[places] ${r.cycle} round ${r.round}: ${r.sections} sections — ` +
  `${r.placedByEkatte} by ЕКАТТЕ, ${r.placedByPrefix} by code prefix (oblast only), ` +
  `${r.unplaced.length} unplaced, ${r.abroadSections} abroad ` +
  `(${r.abroadUnresolved.length} without a country` +
  (r.abroadByCodeGroup.length
    ? `, ${r.abroadByCodeGroup.length} placed by their code-group`
    : "") +
  `)` +
  (r.ekatteOblastConflicts.length
    ? `, ${r.ekatteOblastConflicts.length} ЕКАТТЕ overruled by their own code`
    : "");
