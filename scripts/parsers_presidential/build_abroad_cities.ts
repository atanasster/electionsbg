// Derive `data/presidential/abroad_cities.json` from the parliamentary corpora.
//
// Run it when a new parliamentary cycle lands, which is the only thing that can widen
// the table:
//
//     npx tsx scripts/parsers_presidential/build_abroad_cities.ts          # report only
//     npx tsx scripts/parsers_presidential/build_abroad_cities.ts --write  # rewrite it
//
// ⚠ REPORT-ONLY BY DEFAULT. The output is committed and read by the aggregator, so a
// rebuild that silently narrowed it would move real polling stations to „country
// unknown" with nothing failing. `--write` is the deliberate half, and the run prints
// what changed either way.
//
// Plan: docs/plans/presidential-elections-v1.md T3.1.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ABROAD_CITIES_PATH,
  AMBIGUOUS_CITIES,
  COUNTRY_ALIASES,
  cityKey,
  countryKey,
  type AbroadCityTable,
} from "./abroad";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const ABROAD_OBLAST = "32";

interface Settlement {
  name: string;
  ekatte: string;
  oblast: string;
}

/** Country name (lower-cased) → ISO-2 id, from the settlement catalogue plus aliases. */
export const countryIndex = (
  settlements: Settlement[],
): Map<string, string> => {
  const out = new Map<string, string>();
  for (const s of settlements) {
    if (s.oblast === ABROAD_OBLAST) out.set(countryKey(s.name), s.ekatte);
  }
  for (const [name, id] of Object.entries(COUNTRY_ALIASES)) {
    out.set(countryKey(name), id);
  }
  return out;
};

export interface Harvest {
  /** `cityKey` → the country ids the corpus places it in. */
  cities: Map<string, Set<string>>;
  /** One real spelling per key, for the ambiguity report. */
  spelling: Map<string, string>;
  /** Country names the catalogue and the aliases both fail to resolve. */
  unknownCountries: Set<string>;
  cyclesRead: string[];
  /**
   * Cycles whose `sections.txt` was opened and yielded NO country evidence.
   *
   * ⚠ Reported, not silently tolerated. Some are legitimate — 2005 publishes abroad
   * sections as a bare city with no country at all — and some would be a layout this
   * harvest has stopped understanding. Only a reader can tell which, and a silent zero
   * looks the same either way.
   */
  cyclesWithoutCountries: string[];
}

/**
 * Read every parliamentary `sections.txt` for its abroad rows.
 *
 * ⚠ An unresolved country name is RECORDED, never skipped quietly: dropping one is what
 * made „Пърт" look unambiguous, since the UK spelling beside it vanished. See
 * `COUNTRY_ALIASES`.
 */
export const harvest = (
  rawRoot: string,
  countries: Map<string, string>,
): Harvest => {
  const cities = new Map<string, Set<string>>();
  const spelling = new Map<string, string>();
  const unknownCountries = new Set<string>();
  const cyclesRead: string[] = [];
  const cyclesWithoutCountries: string[] = [];

  const countryOf = (cell: string): string | undefined =>
    countries.get(countryKey(cell));

  for (const dir of fs
    .readdirSync(rawRoot)
    .filter((d) => /^\d{4}_\d{2}_\d{2}$/u.test(d))
    .sort()) {
    const file = path.join(rawRoot, dir, "sections.txt");
    if (!fs.existsSync(file)) continue;
    cyclesRead.push(dir);
    let found = 0;

    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/u)) {
      if (!line.trim()) continue;
      const cols = line.split(";").map((c) => c.trim());

      // ⚠ THE SECTION CODE DECIDES WHETHER A ROW IS ABROAD, and it is the one thing
      // every layout agrees on. Five different `sections.txt` shapes are committed here
      // — the column an address, a settlement or an oblast sits in moves between them —
      // but a section code is always exactly nine digits and always opens with its
      // oblast. Gating on `startsWith("32")` also EXCLUDES the domestic rows a looser
      // rule swept in: 2013's Провадия is `032400001`, which begins „03".
      const code = cols.find((c) => /^\d{9}$/u.test(c));
      if (!code || !code.startsWith(ABROAD_OBLAST)) continue;

      let country: string | undefined;
      let city = "";
      let unresolvedHead = "";

      for (let i = 0; i < cols.length; i++) {
        const cell = cols[i];
        if (!cell || cell === code) continue;
        // Form A — one cell, „Австралия, Канбера". 2014 and every cycle from 2017.
        const at = cell.indexOf(", ");
        if (at > 0) {
          const head = cell.slice(0, at).trim();
          const id = countryOf(head);
          if (id) {
            country = id;
            city = cell.slice(at + 2).trim();
            break;
          }
          if (!unresolvedHead) unresolvedHead = head;
          continue;
        }
        // Form B — country and city in SEPARATE cells, `;code;Австралия;;Канбера;`.
        // Only 2013 publishes this, which is exactly why the harvest must be driven by
        // what resolves rather than by a column index.
        const id = countryOf(cell);
        if (id) {
          // ⚠ THE NEXT CELL MUST CONTAIN A LETTER. 2005 publishes `329900119;Триполи;32`
          // — city, then the bare oblast marker — and several of its cities are spelled
          // exactly like their own country (Кувейт, Мексико, Сингапур, Тунис, Алжир).
          // Without this, those rows read the CITY as the country and „32" as the city,
          // minting a place called 32 in five countries at once.
          const rest = cols.slice(i + 1).filter((c) => c && /\p{L}/u.test(c));
          if (rest.length) {
            country = id;
            city = rest[0];
          }
          break;
        }
      }

      if (!country || !city) {
        // ⚠ Recorded, never skipped quietly — discarding an unresolvable country name is
        // what made „Пърт" look unambiguous once the UK spelling beside it vanished. The
        // code gate above is what keeps this honest: only ABROAD rows reach here, so a
        // polling station's address („ГР. БАНСКО, СОУ Неофит Рилски") cannot be reported
        // as a country the way it was when every row was scanned.
        if (unresolvedHead) unknownCountries.add(unresolvedHead);
        continue;
      }

      found++;
      const key = cityKey(city);
      if (!cities.has(key)) cities.set(key, new Set());
      cities.get(key)!.add(country);
      if (!spelling.has(key)) spelling.set(key, city);
    }

    // ⚠ A CYCLE THAT CONTRIBUTED NOTHING IS NAMED. Counting it as read is how this
    // harvest quietly lost four cycles: their `sections.txt` predates the layout it
    // parsed, so they matched nothing and were indistinguishable from a cycle with no
    // abroad sections — while the header went on claiming every cycle was read, and the
    // residue was blamed on consulates sitting in the discarded rows.
    if (!found) cyclesWithoutCountries.push(dir);
  }
  return {
    cities,
    spelling,
    unknownCountries,
    cyclesRead,
    cyclesWithoutCountries,
  };
};

/**
 * Fold a harvest into the committed table.
 *
 * @returns The table, plus the keys refused for naming more than one country.
 * @throws If a city listed in `AMBIGUOUS_CITIES` is no longer ambiguous, or a newly
 *   ambiguous city is not listed — the constant is a statement about the corpus, and one
 *   that has stopped being true is worse than none, because it reads as a decision
 *   somebody checked.
 */
export const buildTable = (
  h: Harvest,
): { table: AbroadCityTable; refused: string[] } => {
  const refused: string[] = [];
  const cities: Record<string, string> = {};
  for (const [key, ids] of [...h.cities].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (ids.size > 1) {
      refused.push(h.spelling.get(key)!);
      continue;
    }
    cities[key] = [...ids][0];
  }
  const declared = new Set(AMBIGUOUS_CITIES.map(cityKey));
  const found = new Set(refused.map(cityKey));
  const stale = [...declared].filter((k) => !found.has(k));
  const surprise = [...found].filter((k) => !declared.has(k));
  if (stale.length || surprise.length) {
    throw new Error(
      `build_abroad_cities: AMBIGUOUS_CITIES no longer matches the corpus — ` +
        `${stale.length ? `no longer ambiguous: ${stale.join(", ")}; ` : ""}` +
        `${surprise.length ? `newly ambiguous: ${surprise.join(", ")}` : ""}`,
    );
  }
  return {
    table: {
      builtFrom:
        `Derived by scripts/parsers_presidential/build_abroad_cities.ts from the ` +
        `oblast-32 rows of raw_data/<parliamentary cycle>/sections.txt ` +
        `(${h.cyclesRead.length} cycles: ${h.cyclesRead[0]}…${h.cyclesRead[h.cyclesRead.length - 1]}). ` +
        `Keys are cityKey() folds; values are the ISO-2 ids data/settlements.json uses ` +
        `at oblast 32. Do not hand-edit — re-run the script.`,
      cities,
      ambiguous: refused.sort((a, b) => a.localeCompare(b)),
    },
    refused,
  };
};

const main = (): void => {
  const settlements = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, "data/settlements.json"), "utf8"),
  ) as Settlement[];
  const countries = countryIndex(settlements);
  const h = harvest(path.join(PROJECT_ROOT, "raw_data"), countries);
  const { table, refused } = buildTable(h);

  const previous = fs.existsSync(ABROAD_CITIES_PATH)
    ? (JSON.parse(
        fs.readFileSync(ABROAD_CITIES_PATH, "utf8"),
      ) as AbroadCityTable)
    : null;
  const before = Object.keys(previous?.cities ?? {}).length;
  const after = Object.keys(table.cities).length;

  console.log(
    `[abroad] ${h.cyclesRead.length} parliamentary cycles → ${after} cities ` +
      `(was ${before}), ${refused.length} refused as ambiguous`,
  );
  if (h.unknownCountries.size) {
    // Named, not counted: each is either an alias to add or a country the catalogue
    // genuinely lacks, and only a reader can tell which.
    console.log(
      `[abroad] country names neither the catalogue nor COUNTRY_ALIASES resolve: ` +
        `${[...h.unknownCountries].sort().join(", ")}`,
    );
  }
  if (h.cyclesWithoutCountries.length) {
    // ⚠ Named, because „this cycle publishes no country" and „this cycle's layout I no
    // longer parse" look identical from here, and only a reader can tell them apart.
    console.log(
      `[abroad] cycles that yielded NO country evidence: ` +
        `${h.cyclesWithoutCountries.join(", ")}`,
    );
  }
  const lost = previous
    ? Object.keys(previous.cities).filter((k) => !(k in table.cities))
    : [];

  if (lost.length) {
    console.log(`[abroad] would drop: ${lost.join(", ")}`);
  }
  if (!process.argv.includes("--write")) {
    console.log("[abroad] report only — pass --write to rewrite the table");
    return;
  }
  // ⚠⚠ A NARROWING WRITE IS REFUSED. The table is committed and the aggregator reads it,
  // so a rebuild that lost cities would move real polling stations to „country unknown"
  // at exit 0 — and the regeneration gate cannot catch it, because it compares the file
  // against a fresh build and the two narrow together. Losing a city is only ever right
  // when a city became AMBIGUOUS, which is a decision `AMBIGUOUS_CITIES` records.
  const expectedLoss = new Set(table.ambiguous.map(cityKey));
  const unexplained = lost.filter((k) => !expectedLoss.has(k));
  if (unexplained.length) {
    throw new Error(
      `[abroad] refusing to write: ${unexplained.length} city(ies) would be LOST — ` +
        `${unexplained.slice(0, 10).join(", ")}. Either a source cycle is missing or ` +
        `the harvest has stopped understanding a layout. Pass --allow-shrink only if ` +
        `the loss is intended.`,
    );
  }
  if (lost.length) {
    console.log(
      `[abroad] ${lost.length} city(ies) dropped, all now ambiguous: ${lost.join(", ")}`,
    );
  }
  fs.mkdirSync(path.dirname(ABROAD_CITIES_PATH), { recursive: true });
  fs.writeFileSync(ABROAD_CITIES_PATH, `${JSON.stringify(table, null, 2)}\n`);
  console.log(`[abroad] wrote ${ABROAD_CITIES_PATH}`);
};

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main();
}
