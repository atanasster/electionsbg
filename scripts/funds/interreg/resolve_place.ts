// Where a Bulgarian Interreg partner is — the Tier L / Tier P cascade.
//
// Tier T2 of docs/plans/interreg-funds-ingest-v1.md §3.2. LOADER-side, not
// ingest-side: L1 and L2 read `awarder_seats` and `tr_company_place` out of
// Postgres, and an ingest that reached into PG would make the committed
// data/funds/interreg/ tree unreproducible from a fresh clone.
//
// THE PERIOD SPLIT GOVERNS EVERYTHING HERE. keep.eu's national-ID field exists
// only in the 2021-2027 template: 0 of 1,080 Bulgarian 2014-2020 rows carry an
// EIK, against 336 of 413 (81.4%) in 2021-2027. So roughly two-thirds of the
// money can be attributed to a PLACE but never to a legal entity, and the
// cascade has to place those rows from geography alone.
//
//   TIER L — an EIK, and therefore a real identity.
//     L1  EIK → awarder_seats      (public bodies)          basis eik:awarder_seats
//     L2  EIK → tr_company_place   (companies, migration 133) basis eik:tr
//     L3  no hit → fall through to Tier P
//
//   TIER P — geography only. Inputs keep.eu fills at 95-100% in BOTH periods
//   (town 100%, lat/lng 100%, postcode 95.6% / 98.3%).
//     P1  Latin town → Cyrillic via settlements.json name_en, then
//         EkatteResolver.resolve({locality, postalCode})   basis = its confidence
//     P2  partner name in the CLOSED 265-municipality roster → that seat  basis roster
//     P3  confirm against the published lat/lng — a chosen settlement more than
//         25 km away is DROPPED, not kept
//     P4  unresolved → ekatte NULL. Never a guess.
//
// WHY NEVER A GUESS: `load_tr_company_place_pg.ts:11-13` states the rule this
// module inherits — "placing a company in the wrong village is worse than not
// placing it, because the tile reads as a fact about that place". An unplaced
// row costs a per-capita ranking one row; a misplaced one publishes a false
// fact about a municipality.
//
// P2 IS A NAME MATCH, AND THAT IS DELIBERATE AND BOUNDED.
// `feedback_name_match_not_identity` forbids attributing a PERSON or a COMPANY
// on a name. A municipality roster is a closed set of 265 authoritative names
// and the target is a PLACE, not an identity — "Община Ямбол" names exactly one
// municipality in a way "Иван Петров" never names one person. Any name outside
// the closed roster is not matched.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  getResolver,
  type EkatteEntry,
} from "../../procurement/resolve_ekatte";
import type { InterregPartner, PlaceBasis } from "./types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, "../../../data");

/** A settlement row, as data/settlements.json publishes it. */
interface Settlement {
  ekatte: string;
  name: string;
  name_en: string;
  oblast: string;
  obshtina: string;
  loc: string | null;
}

/** A municipality centre, as data/municipalities.json publishes it. */
interface Municipality {
  ekatte: string;
  name: string;
  obshtina: string;
  oblast: string;
  loc: string | null;
}

export interface ResolvedPlace {
  ekatte: string | null;
  obshtina: string | null;
  oblast: string | null;
  placeBasis: PlaceBasis | null;
}

export const UNPLACED: ResolvedPlace = {
  ekatte: null,
  obshtina: null,
  oblast: null,
  placeBasis: null,
};

/**
 * A place as the Postgres crosswalks publish it.
 *
 * `obshtina` and `oblast` MUST be codes in settlements.json's vocabulary
 * (BGS12, BGS) — the loader normalises before passing rows in. The crosswalks
 * do not agree among themselves: `awarder_seats` has no obshtina column at all
 * and stores oblast as a NAME ("София (столица)"), and `tr_company_place`
 * stores codes except for Sofia, where it uses SOF46. Passing either through
 * unnormalised puts three vocabularies in one column and splits a GROUP BY.
 *
 * These fields are only a FALLBACK anyway: `place()` prefers what the resolved
 * ekatte implies, which is always settlements.json's own coding.
 */
export interface SeatRow {
  ekatte: string | null;
  obshtina?: string | null;
  oblast?: string | null;
}

/** The two Postgres lookups, passed in so this module never opens a connection. */
export interface PlaceLookups {
  /** awarder_seats: EIK → seat. Public bodies. */
  seatByEik: Map<string, SeatRow>;
  /** tr_company_place (migration 133): EIK → seat. Companies. */
  trPlaceByEik: Map<string, SeatRow>;
}

/**
 * How far a resolved settlement may sit from keep.eu's own published point.
 *
 * MEASURED, not guessed. Accepted-row distance over the real corpus is p50
 * 0.7 km, p90 3.4 km, p99 10.5 km — while every confirmed cross-municipality
 * misplacement sat at 15.4-22.3 km. A 25 km ceiling let all of them through:
 * a Добрич school placed in Генерал Тошево at 22.3 km, a Камено company in
 * Созопол at 21.5 km, a Костинброд company in Столична at 15.4 km. Each had a
 * `town` and an address that said otherwise and a postcode that did not.
 *
 * Radius sweep against the corpus: 30 km → 1,476 placed · 25 → 1,476 ·
 * 20 → 1,473 · **15 → 1,467** · 10 → 1,458. Fifteen removes all three
 * misplacements for nine rows, and leaves both periods far above §9 gate 6.
 */
export const GEO_CONFIRM_KM = 15;

/**
 * The roster arm gets a wider radius, because it is a different EVIDENCE CLASS.
 *
 * A postcode match is one weak signal that the point has to check. A name in
 * the closed 265-municipality roster is authoritative — and a municipality's
 * territory legitimately extends well beyond its seat, so the seat-to-point
 * distance is not the same measurement at all. At 25 km the shared ceiling was
 * silently dropping four CORRECT municipalities whose point keep.eu had
 * geocoded badly (Община Левски pointed at Плевен, Полски Тръмбеш at a
 * motorway near Варна, Бойница at a generic "Bulgaria", Бяла at Русе) — all
 * small border municipalities, i.e. exactly the population this ingest exists
 * to stop under-counting.
 */
export const ROSTER_CONFIRM_KM = 60;

const EARTH_KM = 6371;
const rad = (d: number): number => (d * Math.PI) / 180;

/** Great-circle distance, km. */
export const haversineKm = (
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number => {
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** `data/settlements.json` publishes `loc` as "lng,lat" — note the order. */
const parseLoc = (loc: string | null): { lat: number; lng: number } | null => {
  if (!loc) return null;
  const [lng, lat] = loc.split(",").map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

/**
 * Normalise a name for matching: lowercase, strip the settlement/municipality
 * markers, quotes and punctuation, collapse whitespace.
 *
 * `Община "Тунджа" - гр.Ямбол` and `Община Тунджа` must fold together — that
 * exact row is the one the plan records as the single roster miss.
 */
export const normPlaceName = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[„“”"'«»]/g, " ")
    .replace(
      /^\s*(община|общ\.|municipality of|municipality|village of|town of|city of)\s+/i,
      " ",
    )
    .replace(/\s+(village|town|city)\s*$/i, " ")
    // The dot is REQUIRED. Optional, this ate any hyphenated name whose second
    // element starts with с or гр — folding the MUNICIPALITY Добрич-селска onto
    // Добрич (and Длъхчево-Сабляр, Сан-Стефано). That one is undetectable by
    // the geo check, because Добрич-селска's seat IS Добрич city.
    .replace(/\s*[-–—]\s*(гр|с)\.\s*\S+\s*$/i, " ")
    // (^|\s) rather than \b: \b is an ASCII word boundary and does not fire
    // before a Cyrillic letter, so "гр.София" kept its prefix.
    .replace(/(^|\s)(гр|с|общ|обл)\.\s*/gi, "$1")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * Sofia is ABSENT from data/settlements.json — the capital is modelled as its
 * 24 district shards (S23xx), not as one settlement — so the resolver can never
 * place it and 176 of 201 otherwise-unplaced Bulgarian rows were Sofia alone.
 *
 * Same synthetic row `scripts/funds/projects_resolve.ts:145` uses for the ИСУН
 * corpus, deliberately identical so the two corpora agree about where Sofia is:
 * EKATTE 68134 is the real code ГРАО, the commercial register and ИСУН itself
 * all use, under the pseudo-obshtina S22 (Столична община).
 */
export const SOFIA = {
  ekatte: "68134",
  name: "София",
  name_en: "Sofia",
  obshtina: "S22",
  oblast: "S22",
  lat: 42.6977,
  lng: 23.3219,
} as const;

/**
 * English exonyms and spelling variants keep.eu uses that settlements.json's
 * transliteration does not carry.
 *
 * CURATED, not fuzzy-matched. A tolerant string distance would place
 * "Kirkov" on Кирково and also quietly place a dozen villages on their
 * near-namesakes; every entry here is a spelling of a town this corpus actually
 * contains, checked against the settlement it names. Key is the output of
 * normPlaceName().
 *
 * Deliberately MINIMAL: every entry is a spelling settlements.json's own
 * `name_en` does NOT carry. "Dobrich", "Gabrovo", "Plovdiv" and a dozen more
 * were in an earlier draft and are redundant — the transliteration already
 * matches — and a redundant alias is a second place for the same fact to be
 * wrong.
 */
export const TOWN_ALIASES: Record<string, string> = {
  // "sofia" itself is NOT here: the synthetic Sofia row carries name_en
  // "Sofia", so townEnToBg resolves it like any other settlement. These are
  // the spellings that actually occur in the corpus and that no name_en covers.
  софиа: "София",
  sofie: "София",
  bourgas: "Бургас",
  rousse: "Русе",
  shoumen: "Шумен",
  "veliko turnovo": "Велико Търново",
  "veliko tirnovo": "Велико Търново",
  turgovishte: "Търговище",
  kardzali: "Кърджали",
  kardjali: "Кърджали",
  nessebar: "Несебър",
  ivailovgrad: "Ивайловград",
  strumiani: "Струмяни",
  peturch: "Петърч",
};

export interface PlaceContext {
  /** Normalised English settlement name → the Cyrillic one keep.eu does not give us. */
  townEnToBg: Map<string, string>;
  /** ekatte → settlement, for the obshtina/oblast a resolved ekatte implies. */
  byEkatte: Map<string, Settlement>;
  /**
   * Normalised municipality name → EVERY municipality carrying it. The CLOSED
   * roster for P2.
   *
   * A list, not a first-wins scalar: four names are shared (Бяла RSE/VAR,
   * Добрич-селска/Добрич, Искър S24/PVN, Средец S24/BGS), and for the roster
   * the NAME IS THE DECISION — unlike townEnToBg, where the resolver and the
   * geo check still get a vote. Keeping only the first silently resolved
   * "Община Бяла" from Русе to Варna's Бяла, surviving only because the 230 km
   * gap happened to trip the geo check.
   */
  roster: Map<string, Municipality[]>;
  /** Postal code → every settlement carrying it, for the P1 tie-break. */
  byPostal: Map<string, EkatteEntry[]>;
}

/** Read the reference data once. No network, no database. */
export const buildPlaceContext = (dataDir = DATA): PlaceContext => {
  const settlements: Settlement[] = JSON.parse(
    fs.readFileSync(path.join(dataDir, "settlements.json"), "utf8"),
  );
  const municipalities: Municipality[] = JSON.parse(
    fs.readFileSync(path.join(dataDir, "municipalities.json"), "utf8"),
  );

  const townEnToBg = new Map<string, string>();
  const byEkatte = new Map<string, Settlement>();
  // Sofia is seeded as a synthetic row rather than special-cased in the
  // cascade, mirroring `scripts/funds/projects_resolve.ts:232`. Special-casing
  // it only in the P1 branch left the OTHER paths to 68134 — the two crosswalks
  // and the resolver itself, which reads ekatte_index.json where Sofia DOES
  // exist — writing three further codings: obshtina SOF46, obshtina NULL with
  // an oblast NAME, and NULL/NULL. 22 rows carrying €15.86m were `placed` with
  // no municipality at all, invisible to the per-capita ranking that is this
  // ingest's whole point, and passing 137's IFF CHECK because that constraint
  // only forbids an obshtina WITHOUT an ekatte.
  const sofiaRow: Settlement = {
    ekatte: SOFIA.ekatte,
    name: SOFIA.name,
    name_en: SOFIA.name_en,
    oblast: SOFIA.oblast,
    obshtina: SOFIA.obshtina,
    loc: `${SOFIA.lng},${SOFIA.lat}`,
  };
  for (const s of [...settlements, sofiaRow]) {
    byEkatte.set(s.ekatte, s);
    const k = normPlaceName(s.name_en ?? "");
    // FIRST WINS, and the map is only a hint: a duplicate English name (Novo
    // Selo and friends) must not silently prefer the later row. The resolver
    // and the geo confirmation are what actually decide.
    if (k && !townEnToBg.has(k)) townEnToBg.set(k, s.name);
  }

  const roster = new Map<string, Municipality[]>();
  for (const m of municipalities) {
    const k = normPlaceName(m.name);
    if (!k) continue;
    const arr = roster.get(k);
    if (arr) arr.push(m);
    else roster.set(k, [m]);
  }

  const byPostal = new Map<string, EkatteEntry[]>();
  for (const e of getResolver().entries) {
    if (!e.postal) continue;
    const arr = byPostal.get(e.postal);
    if (arr) arr.push(e);
    else byPostal.set(e.postal, [e]);
  }

  return { townEnToBg, byEkatte, roster, byPostal };
};

/** Fill obshtina/oblast from the settlement an ekatte names. */
const place = (
  ekatte: string,
  basis: PlaceBasis,
  ctx: PlaceContext,
  fallback?: SeatRow,
): ResolvedPlace => {
  const s = ctx.byEkatte.get(ekatte);
  return {
    ekatte,
    obshtina: s?.obshtina ?? fallback?.obshtina ?? null,
    oblast: s?.oblast ?? fallback?.oblast ?? null,
    placeBasis: basis,
  };
};

/**
 * Is the candidate close enough to keep.eu's own point?
 *
 * `true` when there is nothing to check against — an absent lat/lng or an
 * ungeocoded settlement is not evidence AGAINST a match, and treating it as
 * such would throw away every row in a settlement whose centroid we lack.
 */
export const geoConfirms = (
  ekatte: string,
  partner: Pick<InterregPartner, "lat" | "lng">,
  ctx: PlaceContext,
  maxKm: number = GEO_CONFIRM_KM,
): boolean => {
  if (partner.lat === null || partner.lng === null) return true;
  const loc = parseLoc(ctx.byEkatte.get(ekatte)?.loc ?? null);
  if (!loc) return true;
  return haversineKm(partner.lat, partner.lng, loc.lat, loc.lng) <= maxKm;
};

/**
 * Resolve one partner row to a place.
 *
 * Only ever called for rows `isBulgarianPartner()` admits — the caller narrows,
 * because a Romanian partner has no EKATTE by construction and running the
 * cascade on one would at best waste work and at worst place it in Bulgaria.
 */
export const resolvePlace = (
  partner: InterregPartner,
  lookups: PlaceLookups,
  ctx: PlaceContext,
  tally?: { geoRejected: number; geoUncheckable: number },
): ResolvedPlace => {
  const confirm = (ekatte: string, maxKm = GEO_CONFIRM_KM): boolean => {
    const ok = geoConfirms(ekatte, partner, ctx, maxKm);
    if (!ok && tally) tally.geoRejected++;
    return ok;
  };
  // ── Tier L ───────────────────────────────────────────────────────────────
  // An EIK is an identity, so it outranks every geographic signal. Still geo-
  // confirmed: a crosswalk row can be stale, and a silent 400 km disagreement
  // between the registry seat and keep.eu's own point is worth not publishing.
  if (partner.eik) {
    const seat = lookups.seatByEik.get(partner.eik);
    if (seat?.ekatte && confirm(seat.ekatte))
      return place(seat.ekatte, "eik:awarder_seats", ctx, seat);

    const tr = lookups.trPlaceByEik.get(partner.eik);
    if (tr?.ekatte && confirm(tr.ekatte))
      return place(tr.ekatte, "eik:tr", ctx, tr);
    // L3: fall through. ~38% of Tier-L rows are читалища, museums, chambers and
    // universities — BULSTAT bodies in neither crosswalk.
  }

  // ── Tier P ───────────────────────────────────────────────────────────────
  // P1. keep.eu writes the town in Latin ("Nikopol"); the resolver keys on
  // Cyrillic. Map through settlements.json's own name_en rather than
  // transliterating, so we never invent a spelling.
  //
  // `town`, NOT `locationRaw`: the latter is a full street address whose town
  // is at no fixed offset, and splitting it on commas resolved
  // `ul. "Ekzarh Yosif" 1` as a settlement name.
  const townRaw = (partner.town ?? "").trim();
  const townKey = normPlaceName(townRaw);

  // Sofia has no settlements.json row to resolve to, so it is answered here
  // rather than by the resolver. Still geo-confirmed like any other candidate.
  if (townKey === "sofia" || TOWN_ALIASES[townKey] === "София") {
    if (geoConfirms(SOFIA.ekatte, partner, ctx))
      return {
        ekatte: SOFIA.ekatte,
        obshtina: SOFIA.obshtina,
        oblast: SOFIA.oblast,
        placeBasis: "name_only",
      };
  }

  const locality =
    TOWN_ALIASES[townKey] ?? ctx.townEnToBg.get(townKey) ?? townRaw;

  const hit = getResolver().resolve({
    locality,
    postalCode: partner.postcode ?? undefined,
  });
  if (hit.ekatte && hit.confidence !== "unresolved" && confirm(hit.ekatte))
    return place(hit.ekatte, hit.confidence as PlaceBasis, ctx);

  // P1 tie-break. The resolver refuses an ambiguous postcode outright — every
  // arm requires exactly one candidate, and 308 of 4,275 postcodes name more
  // than one settlement (2060 names 13). keep.eu's published point is what
  // settles it, and only when a single candidate is inside the radius.
  if (
    partner.postcode &&
    partner.lat !== null &&
    partner.lng !== null &&
    !hit.ekatte
  ) {
    const near = (ctx.byPostal.get(partner.postcode) ?? []).filter((e) =>
      geoConfirms(e.ekatte, partner, ctx),
    );
    if (near.length === 1) return place(near[0].ekatte, "postal_only", ctx);
  }

  // P2. The closed 265-municipality roster, and only it. Where a name is shared
  // the point picks, and only when it picks EXACTLY ONE — the same shape as the
  // postal tie-break above.
  const rosterHits = ctx.roster.get(normPlaceName(partner.partnerName)) ?? [];
  const rosterOk = rosterHits.filter((m) =>
    confirm(m.ekatte, ROSTER_CONFIRM_KM),
  );
  if (rosterOk.length === 1)
    return place(rosterOk[0].ekatte, "roster", ctx, rosterOk[0]);

  // P4. Unresolved. `location_raw` is kept on the row so the evidence survives.
  return UNPLACED;
};

export interface ResolveStats {
  total: number;
  placed: number;
  byBasis: Record<string, number>;
  /**
   * Candidates the geo check REFUSED — the one number this module publishes
   * about whether its own safety rule is doing anything.
   *
   * Counted inside the cascade, not re-derived afterwards. An earlier version
   * inferred it from `seatByEik.has(eik)` and reported 1 where the truth was
   * 12, because 11 of the rejections were Tier P and one was tr-only — so the
   * rule read as inert.
   */
  geoRejected: number;
  /**
   * Placements the geo check could not test — an absent point, or a settlement
   * with no centroid. Zero today; counted so it stays visible if a keep.eu
   * template change starts dropping `location_json`.
   */
  geoUncheckable: number;
}

/** Resolve a batch and report coverage, the way load_tr_company_place_pg does. */
export const resolveAll = (
  partners: InterregPartner[],
  lookups: PlaceLookups,
  ctx: PlaceContext,
): { places: Map<string, ResolvedPlace>; stats: ResolveStats } => {
  const places = new Map<string, ResolvedPlace>();
  const byBasis: Record<string, number> = {};
  const tally = { geoRejected: 0, geoUncheckable: 0 };
  let placed = 0;

  for (const p of partners) {
    const r = resolvePlace(p, lookups, ctx, tally);
    places.set(`${p.keepId}:${p.partnerSeq}`, r);
    if (r.placeBasis) {
      placed++;
      byBasis[r.placeBasis] = (byBasis[r.placeBasis] ?? 0) + 1;
      if (p.lat === null || p.lng === null) tally.geoUncheckable++;
    }
  }

  return {
    places,
    stats: { total: partners.length, placed, byBasis, ...tally },
  };
};
