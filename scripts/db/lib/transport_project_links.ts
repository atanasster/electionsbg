// Pure title → map-link rules for the /sector/transport project map
// (transport_project_link, schema 076). Kept apart from the loader so every rule
// below carries a fixture test (transport_project_links.test.ts) and needs no
// database. docs/plans/transport-hub-v1.md A5–A7.
//
// Three rules, each of which shipped wrong before 2026-10-16:
//
//   • WORD BOUNDARIES ARE UNICODE-AWARE. JS `\b` is ASCII-only, so `\bпорт\b` and
//     `\bгара\b` never matched a Cyrillic title and every port and station fell
//     through to the default type (A5).
//   • THE DEFAULT TYPE FOLLOWS THE AWARDER, not "rail". БУЛАТСА's air-traffic
//     buildings were drawn as „Жп обект" because rail was the only fallback.
//   • A LINE IS A RAIL SECTION, NOT ANY TWO TOWNS. A segment is minted only for a
//     rail-universe awarder whose title names a section (участък / отсечка /
//     междугарие / жп линия); otherwise a demolition „в регион Варна / Горна
//     Оряховица" became a 200 km rail line (A6). A section named explicitly
//     („участък Медковец – Срацимир") beats the parent line the title also names
//     („линията Видин – София"), so the map draws the work, not the project (A7).

import type { TransportUniverse } from "../../../src/lib/transportReferenceData";

export type Facility =
  | "rail"
  | "port"
  | "station"
  | "junction"
  | "aviation"
  | "site";

/** Letter-or-digit lookarounds — the Unicode replacement for `\b`. */
const L = "(?<![\\p{L}\\p{N}])";
const R = "(?![\\p{L}\\p{N}])";
const word = (alt: string) => new RegExp(`${L}(?:${alt})${R}`, "iu");
const stem = (alt: string) => new RegExp(`${L}(?:${alt})`, "iu");

const PORT = [
  stem("пристанищ|терминал|акватори|фарватер"),
  word("порт|кей|кея"),
];
const AIRPORT = [stem("летищ|аерогар|аеропорт")];
const JUNCTION = [stem("жп възел|разпределителн")];
const STATION = [
  stem("жп гар|железопътна гар|гаров"),
  word("гара|гарата|гари|гарите"),
];

const DEFAULT_FACILITY: Record<TransportUniverse, Facility> = {
  rail: "rail",
  maritime: "port",
  aviation: "aviation",
  road: "site",
  ministry: "site",
};

/** Classify a single-town point. Keywords first (airport before port — „терминал"
 *  is both, and a passenger terminal at Летище София is not a port — then
 *  junction, then station), then the awarder's universe — never a blanket "rail". */
export const facilityOf = (
  title: string,
  universe: TransportUniverse | undefined,
): Facility => {
  if (AIRPORT.some((r) => r.test(title))) return "aviation";
  if (PORT.some((r) => r.test(title))) return "port";
  if (JUNCTION.some((r) => r.test(title))) return "junction";
  if (STATION.some((r) => r.test(title))) return "station";
  return universe ? DEFAULT_FACILITY[universe] : "site";
};

// A SECTION word names a worked stretch of track. „жп линия" is deliberately NOT
// one: a title mentioning the line it sits on („гара Юнак на жп линия София –
// Варна") is not a section of it, and treating it as one drew a 378 km line for one
// station's works. A line reaches the map only as an explicit dash pair (DASH_PAIR).
const SECTION_WORD = stem("участък|участъка|отсечк|междугари|жп участ");

/** Does the title describe a rail SECTION (as opposed to naming two places)? */
export const namesRailSection = (title: string): boolean =>
  SECTION_WORD.test(title);

// „участък Медковец – Срацимир", „междугарието гара Кочериново – гара Благоевград",
// „отсечка с. Михайлово - гр. Стара Загора". One or two capitalised words per end,
// an optional гара/с./гр. prefix, an en dash or hyphen between.
const PLACE = "\\p{Lu}[\\p{Ll}]+(?:[ -]\\p{Lu}[\\p{Ll}]+)?";
const PREFIX = "(?:(?:жп |ж\\.п\\. )?гара |гр\\. ?|с\\. ?)?";
// The keyword may open the title („Участък …"), so its first letter takes either
// case — the `i` flag cannot be used, because it would make PLACE's \p{Lu} match
// lowercase words too.
const SECTION_PAIR = new RegExp(
  `(?:[Уу]частък|[Уу]частъка|[Оо]тсечка|[Оо]тсечката|[Мм]еждугарие|[Мм]еждугарието)\\s+${PREFIX}(${PLACE})\\s*[–—-]\\s*${PREFIX}(${PLACE})`,
  "u",
);

/** The explicitly named section pair, if the title has one. */
export const sectionPair = (title: string): [string, string] | null => {
  const m = SECTION_PAIR.exec(title);
  return m ? [m[1], m[2]] : null;
};

export interface Place {
  name: string;
  loc: [number, number];
  /** True for a settlement resolved through the village pass (not a town). */
  village: boolean;
}

export type PlaceLookup = (name: string) => Place | null;

export type ContractLink =
  | {
      kind: "segment";
      a: Place;
      b: Place;
      /** 'section' — the title names the worked section itself; 'line' — only the
       *  parent line resolved, so the segment is the PROJECT's line, not the work
       *  site (A7). The map captions the second kind. */
      scope: "section" | "line";
    }
  | { kind: "point"; facility: Facility; a: Place };

export interface LinkDecision {
  link: ContractLink | null;
  /** Why no link was minted — for the loader's summary line. */
  skipped?:
    | "no-place"
    | "too-many"
    | "multi-site"
    | "two-towns-not-a-section"
    | "section-unresolved";
}

/** Two ends of a named section are adjacent stations: a pair further apart than
 *  this is a name collision, not a section (a unique village name can still be the
 *  wrong place — „Срацимир" resolves to Силистра, 340 km from Медковец). */
export const MAX_SECTION_KM = 120;

/** The two towns written as one dash-joined pair („Видин – София", „Пловдив-Бургас"),
 *  in either order — the shape a title uses to name a line or a section. */
const isDashPair = (title: string, a: string, b: string): boolean => {
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const gap = "\\s*(?:гара\\s+|гр\\.\\s*)?[–—-]\\s*(?:гара\\s+|гр\\.\\s*)?";
  return [
    [a, b],
    [b, a],
  ].some(([x, y]) =>
    new RegExp(`${L}${esc(x)}${gap}${esc(y)}${R}`, "u").test(title),
  );
};

const kmBetween = (a: [number, number], b: [number, number]): number => {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

/**
 * Decide the one map link a contract gets, from its title, the towns the town
 * gazetteer found in it, and the awarder's universe. Returns at most ONE link:
 * the PK is (key, a_town, b_town), so two links would put the contract's € on
 * two features (plan C3).
 */
export const linkForContract = (
  title: string,
  towns: string[],
  universe: TransportUniverse | undefined,
  lookupTown: PlaceLookup,
  lookupSectionEnd: PlaceLookup,
  maxTowns: number,
): LinkDecision => {
  const isRail = universe === "rail";

  // A7: an explicitly named section wins over whatever else the title names.
  const pair = isRail ? sectionPair(title) : null;
  if (pair) {
    const a = lookupSectionEnd(pair[0]);
    const b = lookupSectionEnd(pair[1]);
    if (
      a &&
      b &&
      a.name !== b.name &&
      kmBetween(a.loc, b.loc) <= MAX_SECTION_KM
    )
      return { link: { kind: "segment", a, b, scope: "section" } };
  }

  if (towns.length === 0) return { link: null, skipped: "no-place" };
  if (towns.length > maxTowns) return { link: null, skipped: "too-many" };

  if (towns.length === 2) {
    // A6: two towns are a line only for a rail awarder, and only in one of two
    // shapes. Anything else naming two towns (a two-region demolition, a station
    // on a named line, a list of stations) is not drawn.
    if (!isRail) return { link: null, skipped: "two-towns-not-a-section" };
    const a = lookupTown(towns[0]);
    const b = lookupTown(towns[1]);
    if (!a || !b) return { link: null, skipped: "section-unresolved" };
    const km = kmBetween(a.loc, b.loc);
    const dashed = isDashPair(title, a.name, b.name);
    // A section between the two towns themselves — adjacent, so the distance guard
    // applies. Skipped when the title's own named section was refused above: the
    // same pair must not come back in through this door.
    if (!pair && namesRailSection(title) && dashed && km <= MAX_SECTION_KM)
      return { link: { kind: "segment", a, b, scope: "section" } };
    // Otherwise a dash pair is the parent line: the project's line, not the work site.
    if (dashed) return { link: { kind: "segment", a, b, scope: "line" } };
    return { link: null, skipped: "two-towns-not-a-section" };
  }

  if (towns.length === 1) {
    const a = lookupTown(towns[0]);
    if (!a) return { link: null, skipped: "no-place" };
    return {
      link: { kind: "point", facility: facilityOf(title, universe), a },
    };
  }

  return { link: null, skipped: "multi-site" };
};

/**
 * Build the village lookup used for section ends: a name resolves only when it
 * names exactly ONE settlement in the whole register (plan C4 — village names
 * collide, and a name match is not a place). Refused names are counted by the
 * caller, never guessed.
 */
export const uniquePlaceIndex = (
  entries: { name: string; loc: string | null }[],
): Map<string, [number, number] | null> => {
  const idx = new Map<string, [number, number] | null>();
  for (const e of entries) {
    const nm = e.name.trim();
    if (!nm) continue;
    if (idx.has(nm)) {
      idx.set(nm, null); // a second settlement of that name → refuse
      continue;
    }
    const [lng, lat] = (e.loc ?? "").split(",").map(Number);
    idx.set(
      nm,
      Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null,
    );
  }
  return idx;
};
