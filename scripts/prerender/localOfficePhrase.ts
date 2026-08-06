// Office + place, as ONE phrase, for the prerendered /person pages of local officials.
//
// The prerender used to glue the place on with a single generic rule — `${role} в ${place}`
// — and that rule names the place twice on the two commonest local offices, because the
// office LABEL already carries the kind of place it governs:
//
//   "Кмет на кметство в с. Цветино"   the кметство IS с. Цветино
//   "Кмет на община в Исперих"        the община IS Исперих
//
// Those strings are the <title>, the description and the JSON-LD of 6,506 of the 19,506
// prerendered local pages (5,927 village mayors + 579 mayors), so the redundancy was the
// first thing a reader and a crawler saw. Each office now says how its place attaches: the two
// mayors take the place as their JURISDICTION ("Кмет на с. Цветино", "Кмет на община
// Исперих"), everything else genuinely sits INSIDE a wider place and keeps the preposition
// ("Общински съветник в Опака").
//
// The place label arrives exactly as 082_person_api.sql / 120_person_browse.sql /
// emit_prerender_slugs.ts compose it — a settlement carries its type ("с. Ореше",
// "гр. Българово"), an obshtina is bare ("Исперих") — and this module reads that marker
// rather than the role to decide the form. That matters: `resolve_persons` falls back to the
// ОБЩИНА around a кметство whose name did not resolve (77 of 5,927 cards today), and there
// the short form would name a different office held by a different person — "Кмет на
// Омуртаг" is the община mayor, not the village mayor this page is about.

/** Local office labels (person_role.role), place-free. Static — this is a Node build step
 *  with no i18n runtime. */
const ROLE_BG: Record<string, string> = {
  mayor: "Кмет на община",
  village_mayor: "Кмет на кметство",
  rayon_mayor: "Районен кмет",
  councillor: "Общински съветник",
  council_chair: "Председател на общински съвет",
  deputy_mayor: "Заместник-кмет",
  chief_architect: "Главен архитект",
};

const ROLE_EN: Record<string, string> = {
  mayor: "Municipal mayor",
  village_mayor: "Village mayor",
  rayon_mayor: "District mayor",
  councillor: "Municipal councillor",
  council_chair: "Municipal council chair",
  deputy_mayor: "Deputy mayor",
  chief_architect: "Chief architect",
};

const FALLBACK_BG = "Местен вот";
const FALLBACK_EN = "Local office";

/** The settlement-type markers place_dim prints in front of a name (data/settlements.json
 *  т.в.м.). "общ." is deliberately NOT one of them: it is the type of the 21 Sofia district
 *  shards, so treating it as a settlement would turn "общ. Витоша" into a place somebody is
 *  the mayor OF. Only these three license the short "Кмет на <place>" form. */
const SETTLEMENT_MARKER = /^(?:с|гр|ман)\.\s+/u;

/** Does this label name a settlement (rather than an obshtina)? */
export const isSettlementLabel = (place: string): boolean =>
  SETTLEMENT_MARKER.test(place);

/** The English half prints the BULGARIAN place name — the card carries no English one — but
 *  "с." is a Bulgarian abbreviation, not part of the name, and reads as a typo in an English
 *  title. Strip just the marker, keep the name. */
export const stripSettlementMarker = (place: string): string =>
  place.replace(SETTLEMENT_MARKER, "");

/** "община Исперих" — but never "община Столична община": the synthetic SFO_CITY label
 *  already carries the word (SYNTHETIC_OBSHTINA_LABELS) and 172 local cards sit on it. */
const withObshtina = (place: string): string =>
  /общин|общ\./i.test(place) ? place : `община ${place}`;

/** Sofia's 24 районa live in the OBSHTINA namespace as `S2***` (src/lib/obshtinaPlace) —
 *  they are районa, not общини, and 137 local cards are theirs (58 mayors, 55 deputy
 *  mayors, 24 chief architects; the councillors sit on the city bundle). Only the
 *  CODE can tell them apart from a município: six of the names are shared, and "Средец" is
 *  both a Sofia район and a Бургас община, so a name-based rule would put a район mayor at
 *  the head of somebody else's municipality. A card minted before place_code shipped reads
 *  as an obshtina, which is what it printed before this module existed. */
const isSofiaRayon = (code: string | null | undefined): boolean =>
  !!code && /^S2\d{3}$/.test(code);

/** Bulgarian office phrase. `place` is the label as stored; null when the role has none. */
export const localOfficePhraseBg = (
  role: string,
  place: string | null,
  placeCode?: string | null,
): string => {
  const office = ROLE_BG[role] ?? FALLBACK_BG;
  if (!place) return office;
  if (isSofiaRayon(placeCode))
    return role === "mayor"
      ? `Кмет на район ${place}`
      : `${office} в район ${place}`;
  switch (role) {
    case "mayor":
      return `Кмет на ${withObshtina(place)}`;
    case "village_mayor":
      return isSettlementLabel(place)
        ? `Кмет на ${place}`
        : `${office} в ${withObshtina(place)}`;
    default:
      return `${office} в ${place}`;
  }
};

/** English office phrase, over the same (Bulgarian) place label. */
export const localOfficePhraseEn = (
  role: string,
  place: string | null,
  placeCode?: string | null,
): string => {
  const office = ROLE_EN[role] ?? FALLBACK_EN;
  if (!place) return office;
  const name = stripSettlementMarker(place);
  if (isSofiaRayon(placeCode))
    return role === "mayor"
      ? `District mayor of ${name}`
      : `${office} in ${name} district`;
  switch (role) {
    case "mayor":
      return `${office} of ${name}`;
    case "village_mayor":
      return isSettlementLabel(place)
        ? `${office} of ${name}`
        : `${office} in ${name}`;
    default:
      return `${office} in ${name}`;
  }
};
