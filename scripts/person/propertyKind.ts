/**
 * Fold a declared property's free-text description into a display bucket.
 *
 * `declaration_asset.description` is what the declarant typed: **2,981 distinct spellings
 * over 133,240 real-estate rows**, mixing case ("апартамент" / "Апартамент"), compounds
 * ("Жилище,част от къща", "УПИ с постройка", "апартамент с гараж") and synonyms
 * ("нива" / "ниви" / "земеделска земя" / "посевна площ").
 *
 * WHY A LABEL FOLD RATHER THAN A CODE. There is no code — the register has no property
 * taxonomy at all, only this free-text column. So the rule reads the words, in the same
 * spirit as `src/lib/naceLabel.ts`: classify from the LABEL, deliberately, and keep the
 * unclassified bucket honest rather than hiding it.
 *
 * WHY IT EXISTS AT ALL. The comparison card DROPS a property table whose prices are
 * substantially unstated (22.9% of filings carry an unpriced row; 7.8% are entirely
 * unpriced), which otherwise removes the property information from the card completely —
 * even though the COUNT and the KIND are perfectly well known. A declarant who lists 24
 * properties without prices has still told us they hold 24 properties.
 *
 * Measured coverage over the whole corpus (2026-08-16):
 *
 *   farmland     45,489  34.1%
 *   apartment    36,466  27.4%
 *   house        21,372  16.0%
 *   plot         12,078   9.1%
 *   garage        7,942   6.0%
 *   commercial    5,701   4.3%
 *   other         4,192   3.1%
 *
 * `other` is a real answer, not a failure: its largest members are the register's own
 * „други" (1,283), `право на строеж` (667) and `право на ползване` (471) — rights, which
 * are not properties at all — then ancillary spaces (мазе, таван, лятна кухня, навес).
 *
 * THE LEADING NOUN DECIDES, with an ordered whole-string match as the fallback.
 *
 * A Bulgarian declaration names the object first and qualifies it after — „Гараж част от
 * къща", „къща с двор", „апартамент с гараж", „УПИ с постройка". Matching the whole string
 * against ordered rules gets three of those right and the first one wrong: it contains
 * „къща", so a GARAGE was published as a house. Рашков's 2023 filing came out as 11 къщи,
 * four of which were a terrace, a basement, a garage and a dwelling, each qualified
 * „част от къща".
 *
 * So the first token is classified first, and only when it says nothing is the whole string
 * tried in rule order — which is what still catches „трайни насаждения", „право на строеж",
 * „складови помещения" and the other multi-word kinds with no meaningful head noun.
 *
 * ⚠️ THE COUNT IS OF DECLARED ROWS, NOT OF BUILDINGS. A declarant may file one house as
 * four rows (dwelling, terrace, basement, garage) and the register carries nothing that
 * would let us fold them back together. „24 имота" means „24 declared property entries",
 * which is what the card's caption says and what any copy must not overstate.
 */

export type PropertyKind =
  | "apartment"
  | "house"
  | "farmland"
  | "plot"
  | "garage"
  | "commercial"
  | "other";

/** Singular and Bulgarian counting form (бройна форма), which is not the plural:
 *  „2 апартамента", never „2 апартаменти". */
export const PROPERTY_KIND_LABEL: Record<
  PropertyKind,
  { one: string; many: string }
> = {
  apartment: { one: "апартамент", many: "апартамента" },
  house: { one: "къща", many: "къщи" },
  farmland: { one: "земеделски имот", many: "земеделски имота" },
  plot: { one: "парцел", many: "парцела" },
  garage: { one: "гараж", many: "гаража" },
  commercial: { one: "търговски обект", many: "търговски обекта" },
  other: { one: "друг имот", many: "други имота" },
};

/** Display order — the order a reader scans, not the corpus frequency, so „other" is last. */
export const PROPERTY_KIND_ORDER: PropertyKind[] = [
  "apartment",
  "house",
  "farmland",
  "plot",
  "garage",
  "commercial",
  "other",
];

const RULES: [PropertyKind, RegExp][] = [
  // Ancillary spaces FIRST, and this rule is the reason the house count is believable.
  // „Тераса,част от къща" and „Сутерен,част от къща" have no head-noun rule of their own,
  // so they fell through to the whole-string pass, matched „къща", and were published as
  // houses — Рашков's filing declares a terrace, a basement and a gym this way, which took
  // his house count from 2 to 5. They are parts of a building, not buildings.
  [
    "other",
    /тераса|сутерен|мазе|таван|изба|навес|лятна кухня|барбекю|стълбищ|фитнес/,
  ],
  // Dwellings next: „къща с двор" is a house, „апартамент с гараж" a flat.
  ["apartment", /апартамент|жилище|мезонет|студио/],
  ["house", /къща|вила|етаж от|част от къща|бунгало/],
  [
    "farmland",
    /нива|ниви|ливад|гор(а|и)|лоз|пасищ|земедел|насажд|градина|мера|посевн|земя/,
  ],
  // „място" is deliberately after the garage words are NOT yet tried, so it must exclude
  // „паркомясто" / „парко място" itself.
  [
    "plot",
    /парцел|поземлен|дворно|двор|упи|терен|вилно място|(?<!парко ?)място/,
  ],
  ["garage", /гараж|паркомясто|парко ?място|паркинг/],
  [
    "commercial",
    /магазин|офис|склад|производствен|ателие|стопанск|сграда|заведение|хотел|търговск/,
  ],
];

/** Bucket one declared property. Anything unrecognised — including an empty description —
 *  is `other`, which is a real bucket and is displayed as one. */
export const propertyKind = (
  description: string | null | undefined,
): PropertyKind => {
  const d = (description ?? "").toLowerCase().trim();
  if (!d) return "other";
  // The head noun first — see the header. Split on the separators the register actually
  // uses: „Гараж част от къща", „Жилище,част от къща", „апартамент/гараж".
  const head = d.split(/[\s,;/-]+/)[0];
  if (head) for (const [kind, re] of RULES) if (re.test(head)) return kind;
  for (const [kind, re] of RULES) if (re.test(d)) return kind;
  return "other";
};

export type PropertyPart = { kind: PropertyKind; label: string; n: number };

/** Count declared properties by kind, largest first, ready for the card.
 *  Returns the parts and the total; an empty input gives an empty summary, never a zero row. */
export const summariseProperties = (
  descriptions: readonly (string | null | undefined)[],
): { total: number; parts: PropertyPart[] } => {
  const counts = new Map<PropertyKind, number>();
  for (const d of descriptions) {
    const k = propertyKind(d);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const parts = [...counts.entries()]
    .map(([kind, n]) => ({
      kind,
      n,
      label:
        n === 1
          ? PROPERTY_KIND_LABEL[kind].one
          : PROPERTY_KIND_LABEL[kind].many,
    }))
    // By count, then by the display order, so two equal counts are not ordered by chance.
    .sort(
      (a, b) =>
        b.n - a.n ||
        PROPERTY_KIND_ORDER.indexOf(a.kind) -
          PROPERTY_KIND_ORDER.indexOf(b.kind),
    );
  return { total: descriptions.length, parts };
};
