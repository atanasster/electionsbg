// Name → obshtina join for the municipal-officials roster ingest.
//
// The CACBG registry uses free-text Bulgarian institution names like "Гоце
// Делчев" or 'Район "Централен" - Пловдив', while the SPA keys every
// municipality page by the app's `obshtina` code (see data/municipalities.json
// — VAR06 for Варна, PDV22 for Пловдив, S23xx for each Sofia район). This
// helper bridges the two so scripts/officials/municipal.ts can emit one
// shard per obshtina.
//
// Resolution rules, applied in order:
//
//   1. Operator override in scripts/officials/_aliases.json. Adopted verbatim,
//      no normalisation. Use when an upstream rename or one-off oddity needs
//      a manual pin.
//
//   2. 'Район "<NAME>" - <CITY>' → the CITY's obshtina, with `district:
//      "Район <NAME>"`. Covers Пловдив (6 районs aggregated under PDV22),
//      Варна (5 районs under VAR06), and any other large city the registry
//      might split in future.
//
//   3. 'Район <NAME>' (no city suffix) → Sofia район. Each Sofia район is
//      its own obshtina (S2301..S2324) and its own page in the SPA, so we
//      key by the район NAME against a sub-map built from the S23/S24/S25
//      oblast rows in data/municipalities.json.
//
//   4. Direct normalised name lookup against the deduped obshtina table.
//      Trims, lowercases, collapses whitespace, and folds the few "<X>/<Y>/"
//      disambiguator forms ("Бяла/Русе/" → "Бяла" + oblast hint "Русе").
//
//   5. If none match → null. The caller (municipal.ts) collects unmatched
//      rows and fails loud once their count exceeds the operator-friendly
//      threshold.
//
// CLI dry-run mode prints unmatched entries grouped by similarity hint, so
// the operator can size the alias map before committing a real shard write:
//
//   tsx scripts/officials/municipality_join.ts --dry-run

import fs from "fs";
import path from "path";
import { command, run, flag, boolean } from "cmd-ts";
import type {
  MunicipalIndexFile,
  MunicipalityInfo,
} from "../../src/data/dataTypes";
import { ROOT } from "./shared";

const MUNICIPALITIES_PATH = path.join(ROOT, "data", "municipalities.json");
const INDEX_PATH = path.join(
  ROOT,
  "data",
  "officials",
  "municipal",
  "index.json",
);
const ALIASES_PATH = path.join(ROOT, "scripts", "officials", "_aliases.json");

// Pseudo-obshtini for out-of-country sections — `oblast: "32"` in the data
// file. These will never appear in the CACBG register and must not pollute
// the lookup map.
const SKIP_OBLAST = "32";

// Synthetic obshtina codes that are NOT in data/municipalities.json but are
// allowed as alias targets. Each represents a tier the SPA does not yet have
// a settlement page for — the shard is emitted for future use.
//
// SFO_CITY — Sofia city-wide administration (mayor + deputies + city council
// + chief architects). The SPA's Sofia districts each have their own
// S23xx code; the city-wide tier is a separate slice that future UI work can
// fold into every Sofia район page or surface on a dedicated /sofia route.
const SYNTHETIC_CODES = new Set<string>(["SFO_CITY"]);

// Cyrillic Bulgarian normalisation. Lowercase, collapse whitespace, strip
// surrounding quotes (the registry mixes plain "..." and typographic “…”
// quotes around район names), drop trailing punctuation. The "Район" prefix
// is handled separately, not stripped here.
const normalize = (s: string): string =>
  s
    .toLowerCase()
    // Cyrillic-aware: nothing to fold to ASCII; just normalise whitespace.
    .replace(/[“”„"'`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, " - ")
    .trim();

export type ResolveResult = {
  /** App's obshtina code, e.g. "BLG14", "S2309", "PDV22". */
  code: string;
  /** True when the registry entry is a sub-район folded into a larger city's
   *  obshtina (Plovdiv / Varna). The Sofia районs each have their own code
   *  and are NOT marked as districts. */
  isDistrict: boolean;
  /** Verbatim "Район X" label, set only when isDistrict is true. */
  district: string | null;
};

export type Resolver = (registryName: string) => ResolveResult | null;

type Aliases = {
  aliases: Record<string, string>;
};

const readAliases = (): Record<string, string> => {
  try {
    const raw = fs.readFileSync(ALIASES_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Aliases;
    return parsed.aliases ?? {};
  } catch {
    return {};
  }
};

// City names that the registry splits into "Район <X>" - <city>" entries.
// Maps the suffix tag to the city's obshtina code. Derived from
// data/municipalities.json at build time but kept as a small map here for
// clarity: only three cities use this pattern (Sofia uses a different,
// suffix-less form), and they all live in their own obshtini rather than a
// sub-район grouping.
const CITY_RAYON_SUFFIXES: Record<string, string> = {
  // city BG name → obshtina code (looked up below from data/municipalities.json
  // when the resolver is built; this object is just the seed key set).
  Пловдив: "",
  Варна: "",
  Бургас: "",
  "Стара Загора": "",
};

export const buildResolver = (): Resolver => {
  const municipalities: MunicipalityInfo[] = JSON.parse(
    fs.readFileSync(MUNICIPALITIES_PATH, "utf-8"),
  );

  // 1. Generic name → code map, deduped by obshtina. The data file already
  //    carries one row per obshtina, so dedupe is just a guard.
  const byName = new Map<string, string>();
  // 2. Sofia районs (S23/S24/S25) keyed by район name only — i.e. without
  //    the "Район " prefix.
  const sofiaRayonByName = new Map<string, string>();
  // 3. City-with-районs lookup, filled from data/municipalities.json.
  const cityRayonObshtina = new Map<string, string>();

  for (const m of municipalities) {
    if (m.oblast === SKIP_OBLAST) continue;
    const key = normalize(m.name);
    if (m.oblast === "S23" || m.oblast === "S24" || m.oblast === "S25") {
      sofiaRayonByName.set(key, m.obshtina);
    } else {
      // Last-write-wins is safe — the data file has one row per obshtina.
      byName.set(key, m.obshtina);
    }
    if (m.name in CITY_RAYON_SUFFIXES) {
      cityRayonObshtina.set(m.name, m.obshtina);
    }
  }

  const aliases = readAliases();

  // Fail-loud at startup if an alias points to a code that exists in
  // neither data/municipalities.json nor the synthetic-code set. A silent
  // typo here would manifest as a 404 shard or a wrong-page roster.
  const knownCodes = new Set(municipalities.map((m) => m.obshtina));
  for (const [key, code] of Object.entries(aliases)) {
    if (!knownCodes.has(code) && !SYNTHETIC_CODES.has(code)) {
      throw new Error(
        `_aliases.json: ${JSON.stringify(key)} → ${JSON.stringify(code)} — code not found in data/municipalities.json and not in SYNTHETIC_CODES`,
      );
    }
  }

  return (registryName: string): ResolveResult | null => {
    // 1. Operator override.
    if (aliases[registryName]) {
      return {
        code: aliases[registryName]!,
        isDistrict: false,
        district: null,
      };
    }

    const trimmed = registryName.trim();

    // 2. 'Район "<X>" - <CITY>' → city's obshtina + district tag.
    //    Tolerant on quote style and on the surrounding whitespace.
    const cityRayonMatch = trimmed.match(
      /^Район\s+[“”„"']?([^“”„"']+?)[“”„"']?\s*-\s*(.+)$/u,
    );
    if (cityRayonMatch) {
      const rayonName = cityRayonMatch[1]!.trim();
      const city = cityRayonMatch[2]!.trim();
      const code = cityRayonObshtina.get(city);
      if (code) {
        return {
          code,
          isDistrict: true,
          district: `Район ${rayonName}`,
        };
      }
      // Unknown city — fall through to other rules rather than committing
      // to a wrong code.
    }

    // 3. 'Район <X>' (no suffix) → Sofia район.
    if (/^Район\s+/i.test(trimmed)) {
      const rayonName = trimmed.replace(/^Район\s+/i, "");
      const code = sofiaRayonByName.get(normalize(rayonName));
      if (code) {
        return { code, isDistrict: false, district: null };
      }
    }

    // 4. Disambiguator form "<X>/<oblast hint>/" — e.g. "Бяла/Русе/" to
    //    distinguish from "Бяла" in Варна. We try the bare name first;
    //    if multiple obshtini share the name the operator must add an
    //    alias. For now, return whatever the dedup map holds.
    const slashMatch = trimmed.match(/^([^/]+)\/([^/]+)\/$/);
    if (slashMatch) {
      const bare = slashMatch[1]!.trim();
      const code = byName.get(normalize(bare));
      if (code) {
        return { code, isDistrict: false, district: null };
      }
    }

    // 5. Direct normalised lookup.
    const code = byName.get(normalize(trimmed));
    if (code) {
      return { code, isDistrict: false, district: null };
    }

    return null;
  };
};

// CLI: dry-run the resolver over the current index.json and print stats +
// unmatched rows. Idempotent, no writes.
const cmd = command({
  name: "municipality-join",
  description:
    "Dry-run the registry-name → obshtina resolver against the current municipal officials index.json. Prints match-rate and unmatched entries so the operator can size scripts/officials/_aliases.json before a real shard build.",
  args: {
    dryRun: flag({
      type: boolean,
      long: "dry-run",
      description:
        "Default and only mode — no writes. Flag is accepted for symmetry with the other officials scripts.",
    }),
  },
  handler: async () => {
    if (!fs.existsSync(INDEX_PATH)) {
      console.error(
        `index.json missing at ${INDEX_PATH}. Run scripts/officials/municipal.ts first.`,
      );
      process.exit(1);
    }
    const index: MunicipalIndexFile = JSON.parse(
      fs.readFileSync(INDEX_PATH, "utf-8"),
    );
    const resolve = buildResolver();

    const unmatched: { municipality: string; sampleNames: string[] }[] = [];
    const byMunicipalityUnmatched = new Map<string, string[]>();
    const codeCounts = new Map<string, number>();
    let matched = 0;
    for (const entry of index.entries) {
      const result = resolve(entry.municipality);
      if (!result) {
        if (!byMunicipalityUnmatched.has(entry.municipality)) {
          byMunicipalityUnmatched.set(entry.municipality, []);
        }
        if (byMunicipalityUnmatched.get(entry.municipality)!.length < 3) {
          byMunicipalityUnmatched.get(entry.municipality)!.push(entry.name);
        }
        continue;
      }
      matched++;
      codeCounts.set(result.code, (codeCounts.get(result.code) ?? 0) + 1);
    }

    for (const [m, sampleNames] of byMunicipalityUnmatched.entries()) {
      unmatched.push({ municipality: m, sampleNames });
    }

    console.log(`total entries:       ${index.entries.length}`);
    console.log(`matched:             ${matched}`);
    console.log(`unmatched (entries): ${index.entries.length - matched}`);
    console.log(`unmatched (unique municipality strings): ${unmatched.length}`);
    console.log(`obshtini covered:    ${codeCounts.size}`);
    console.log("");
    if (unmatched.length > 0) {
      console.log("Unmatched municipality strings (add to _aliases.json):");
      for (const u of unmatched.sort((a, b) =>
        a.municipality.localeCompare(b.municipality, "bg"),
      )) {
        console.log(
          `  ${JSON.stringify(u.municipality)} — e.g. ${u.sampleNames.join(", ")}`,
        );
      }
    }
  },
});

// Only run the CLI when invoked directly, not when imported. The other
// officials scripts (./index.ts, ./municipal.ts) bind unconditionally because
// they are dedicated CLI entry points; this file does double duty as a
// library, so guard on the argv check. ESM-safe — no __filename.
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  return (
    entry.endsWith("municipality_join.ts") ||
    entry.endsWith("municipality_join.js")
  );
})();
if (invokedDirectly) {
  run(cmd, process.argv.slice(2));
}
