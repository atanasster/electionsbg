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

// ── Titles that name a place but no work site (audit 2026-10-17, T5) ─────────
// A town in the title is not a site when the contract buys a utility or an
// operating service FOR the body's premises there, repairs rolling stock (which has
// no fixed place), or is let to an administrative district. Each was a pin on the
// map: „доставка на вода за сградата в Пловдив", „охрана на ЖП район Горна
// Оряховица", „ремонт на локомотиви". Unicode-boundary-safe throughout (JS `\b`
// is ASCII-only — A5).
const UTILITY =
  "(?:питейна\\s+вода|вода|водата|природен\\s+газ|природния\\s+газ|газ|газа|ел\\.?\\s?енерги\\p{L}*|електрическа\\s+енерги\\p{L}*|електроенерги\\p{L}*|топлинна\\s+енерги\\p{L}*|горив\\p{L}*|дизелово|бензин\\p{L}*)";
const NOT_A_SITE = [
  // A utility SUPPLIED to the premises — keyed on the supply verb, never on the
  // bare word: „тягова подстанция Червена вода" and a substation's
  // „захранване с електроенергия" are real track-side works.
  new RegExp(
    `${L}(?:доставка|доставки|доставчик|снабдяване|продажба)${R}[^.;:]{0,60}?${L}${UTILITY}${R}`,
    "iu",
  ),
  // a SERVICE contract, not „телефонна кабелна мрежа в участъка …" (track works)
  stem(
    "интернет|телефонни услуги|далекосъобщителни услуги|куриерск|пощенск|мобилни услуги|мобилна връзка",
  ),
  // operating services
  word("пране|прането|храна|храни"),
  stem(
    "перилн|климатиз|климатич|климатиц|охрана на|охранителн|охраняване|хотел|застрахов|ваучер|кетъринг|кейтъринг",
  ),
];
// Rolling stock has no fixed site — but a DEPOT or a WORKS does („локомотивно
// депо", „вагоноремонтен завод"), so the rule stands down when one is named.
const ROLLING_STOCK = stem(
  "вагон|локомотив|мотрис|подвижен състав|подвижния състав",
);
const FIXED_RAIL_FACILITY = stem("депо|депа|завод|работилниц");
// Only for a single-town POINT: on a section these words describe real track
// work („почистване на растителност в участък …"), and a large works contract may
// include training. „район на планиране" is a statistical region — the Пловдив
// intermodal terminal names one and is a real site.
const NOT_A_POINT = [
  stem("почистван|хигиенизиран|обучени"),
  // Only the ADMINISTRATIVE region a multi-oblast contract is let to („…за
  // територията на Югоизточен район, с административни центрове …"). The bare
  // word is how a title LOCATES a site („в района на 4 к.м., Пристанище Бургас")
  // and must not unplace it.
  new RegExp(
    `${L}(?:северозападен|северен\\s+централен|североизточен|югоизточен|югозападен|южен\\s+централен|западен|източен|северен|южен)\\s+(?:район|регион)${R}(?!\\s+(?:на|за)\\s+планиране)`,
    "iu",
  ),
];

/** Is the place in this title the site of the work? False for utilities and
 *  operating services, rolling-stock repair, and (for points) cleaning and
 *  district-level contracts — those stay unplaced. */
export const namesAWorkSite = (title: string, point: boolean): boolean =>
  !NOT_A_SITE.some((r) => r.test(title)) &&
  !(ROLLING_STOCK.test(title) && !FIXED_RAIL_FACILITY.test(title)) &&
  !(point && NOT_A_POINT.some((r) => r.test(title)));

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
/** Every settlement a section-end NAME could be — a town and the villages that
 *  share its name, or several same-named villages. pickSectionEnds chooses. */
export type PlaceCandidates = (name: string) => Place[];

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
    | "section-unresolved"
    | "not-a-work-site";
  /** Set when a named section's ends could not be placed, and why. */
  sectionRefused?: SectionRefusal;
}

export type SectionRefusal = "unknown" | "none-within" | "ambiguous";

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

export const kmBetween = (a: [number, number], b: [number, number]): number => {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

/** The runner-up pair must be this much further than the best for the best to
 *  count as THE section; closer than that, the name collision is not settled by
 *  distance and the section is refused. */
const AMBIGUITY_RATIO = 1.5;

/**
 * Choose the two places a named section runs between (transport-hub-v1 audit
 * 2026-10-17, T4). Every end is checked against the other — TOWNS INCLUDED: a
 * town name is often also a village elsewhere („Стражица" is a town in Велико
 * Търново and a village near Балчик; „Славяново" a town in Плевен and a village
 * near Попово), and taking the town blindly drew Стражица–Славяново 100 km across
 * two oblasts for track renewal between two adjacent stations. So among all
 * candidate pairs the closest one within MAX_SECTION_KM wins; none within it, or a
 * runner-up too close to call, is a refusal — never a guess.
 */
export const pickSectionEnds = (
  aCands: Place[],
  bCands: Place[],
): { a: Place; b: Place } | { refused: SectionRefusal } => {
  if (!aCands.length || !bCands.length) return { refused: "unknown" };
  const pairs: { a: Place; b: Place; km: number }[] = [];
  for (const a of aCands)
    for (const b of bCands) {
      const km = kmBetween(a.loc, b.loc);
      if (km > 0 && km <= MAX_SECTION_KM) pairs.push({ a, b, km });
    }
  if (!pairs.length) return { refused: "none-within" };
  pairs.sort((x, y) => x.km - y.km);
  const [best, next] = pairs;
  if (next && next.km < best.km * AMBIGUITY_RATIO)
    return { refused: "ambiguous" };
  return { a: best.a, b: best.b };
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
  sectionEndCandidates: PlaceCandidates,
  maxTowns: number,
): LinkDecision => {
  const isRail = universe === "rail";

  if (!namesAWorkSite(title, false))
    return { link: null, skipped: "not-a-work-site" };

  // A7: an explicitly named section wins over whatever else the title names.
  const pair = isRail ? sectionPair(title) : null;
  let sectionRefused: SectionRefusal | undefined;
  if (pair && pair[0] !== pair[1]) {
    const pick = pickSectionEnds(
      sectionEndCandidates(pair[0]),
      sectionEndCandidates(pair[1]),
    );
    if ("a" in pick)
      return {
        link: { kind: "segment", a: pick.a, b: pick.b, scope: "section" },
      };
    sectionRefused = pick.refused;
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
    // A refused named section must not come back as a "line" between the SAME
    // two places: that undoes the refusal with no distance check at all — the
    // 100 km Стражица–Славяново stroke (review 2026-10-17, FINDING-001). A
    // different dash pair (the parent line „Видин – София" beside a refused
    // „участък Медковец – Срацимир") is still the project's line.
    if (
      pair &&
      new Set([a.name, b.name]).size === 2 &&
      [a.name, b.name].every((n) => pair.includes(n))
    )
      return { link: null, skipped: "section-unresolved", sectionRefused };
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
    // T4b (audit 2026-10-17): a title that names its section explicitly is about
    // that section — „участъка Лозарево – Прилеп" with „Карнобат" elsewhere in the
    // project name was drawn as a Карнобат point. When the section cannot be
    // placed, the contract stays unplaced rather than landing on whichever single
    // town the title also mentions.
    if (pair)
      return { link: null, skipped: "section-unresolved", sectionRefused };
    if (!namesAWorkSite(title, true))
      return { link: null, skipped: "not-a-work-site" };
    const a = lookupTown(towns[0]);
    if (!a) return { link: null, skipped: "no-place" };
    return {
      link: { kind: "point", facility: facilityOf(title, universe), a },
    };
  }

  return { link: null, skipped: "multi-site" };
};

/**
 * Every settlement in the register by NAME — the candidate set for a section end
 * (plan C4 as revised by the audit of 2026-10-17, T4: a shared name is no longer
 * refused outright, it is settled by distance in pickSectionEnds, and refused there
 * when distance cannot settle it). Entries without a usable location are dropped.
 */
export const placeCandidatesIndex = (
  entries: { name: string; loc: string | null; is_village?: boolean }[],
): Map<string, Place[]> => {
  const idx = new Map<string, Place[]>();
  for (const e of entries) {
    const nm = e.name.trim();
    if (!nm) continue;
    const [lng, lat] = (e.loc ?? "").split(",").map(Number);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const list = idx.get(nm) ?? [];
    list.push({ name: nm, loc: [lng, lat], village: e.is_village !== false });
    idx.set(nm, list);
  }
  return idx;
};
