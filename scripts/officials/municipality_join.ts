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
//      "Район <NAME>"`. Covers Пловдив (6 districts aggregated under PDV22),
//      Варна (5 districts under VAR06), and any other large city the registry
//      might split in future.
//
//   3. 'Район <NAME>' (no city suffix) → Sofia район. Each Sofia район is
//      its own obshtina (S2301..S2324) and its own page in the SPA, so we
//      key by the район NAME against a sub-map built from the S23/S24/S25
//      oblast rows in data/municipalities.json.
//
//   4. Direct normalised name lookup against the obshtina table, with the
//      "<X>/<oblast>/" disambiguator form ("Бяла/Русе/") resolved by its
//      oblast hint through the SHARED dictionary in
//      ../parsers_local/oblastNames.ts.
//
//   5. If none match — or more than one does, with nothing to narrow it → null.
//      Both callers escalate: municipal.ts warns per entry and throws above a
//      threshold, build_municipal_shards.ts's CLI throws on any unmatched
//      entry at all.
//
// ⚠️ AN AMBIGUOUS NAME RETURNS null — IT DOES NOT PICK ONE. Three catalogue
// names collide in data/municipalities.json (бяла, искър, средец), but only
// ONE of them — бяла (VAR05 + RSE04) — survives this file's partition as a
// live ambiguity: искър and средец each pair a province município with a Sofia
// район, and rule 3 resolves those under their own "Район X" spelling before
// the generic map is consulted. So bare "Искър" → PVN23 and bare "Средец" →
// BGS06 still resolve; only bare "Бяла" refuses. Read `duplicateNames()`
// rather than this sentence — it is derived from the catalogue under the same
// partition, so it stays true when the catalogue changes.
//
// Until 2026-09-04 this file described the collision and then took whatever
// the deduped map happened to hold:
//
//     const bare = slashMatch[1]!.trim();   // slashMatch[2], the oblast, unread
//     const code = byName.get(normalize(bare));
//
// Both "Бяла/Варна/" and "Бяла/Русе/" therefore resolved to RSE04, so obshtina
// VAR05 was the ONE municipality of 288 with no shard at all while RSE04
// published the merged roster of both — 36 rows carrying TWO mayors and TWO
// council chairs, i.e. 15 named Бяла (Варна) officials attributed to Бяла
// (Русе). Downstream that is not a gap but a false statement about named
// people: the officials/CIK reconcile reported VAR05's elected mayor as having
// filed no declaration, on a page whose only content is that claim.
//
// The CIK-side parsers hit the identical collision and fixed it first (see
// oblastNames.ts's header and docs/plans/village-mayor-attribution-v1.md §T0).
// This file imports THAT dictionary rather than keeping a second copy — the
// two must not be able to disagree about which Бяла is which.
//
// Refusing is the right failure because both callers escalate it: municipal.ts
// warns per entry and throws above a threshold, and build_municipal_shards.ts's
// CLI throws on any unmatched entry at all. Either way an operator adds one
// line to _aliases.json. A guess has no such destination — it is
// indistinguishable from a correct answer at every layer below this one.
//
// ⚠️ RULE 4 ALSO REFUSES A **UNIQUE** NAME WHOSE OBLAST CONTRADICTS THE HINT,
// which is wider than the ambiguity rule above and is deliberate:
//
//     Разлог/Благоевград/  → BLG37   the hint agrees
//     Разлог/Марс/         → BLG37   unknown oblast spelling, unique name — resolves
//     Разлог/Варна/        → null    unique name, CONTRADICTING oblast — refuses
//
// That third case is not a tie, so no tiebreak can see it; oblastNames.ts calls
// it the "2011 Добрич shape" — a confidently wrong resolution. An UNKNOWN
// oblast spelling still resolves a unique name, so nothing that matched before
// stops matching, and only a hint that positively disagrees is refused.
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
// The oblast dictionary + name→oblast tiebreak are SHARED with the local-elections
// parsers. Do not re-declare either here: oblastNames.ts's header records that the same
// Бяла collision, resolved by two independent copies, is exactly how the CIK side
// published 14 Бяла (Русе) village mayors as Варна office-holders.
import { pickByOblast, oblastCodeForName } from "../parsers_local/oblastNames";

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
   *  obshtina (Plovdiv / Varna). The Sofia districts each have their own code
   *  and are NOT marked as districts. */
  isDistrict: boolean;
  /** Verbatim "Район X" label, set only when isDistrict is true. */
  district: string | null;
};

/** Resolve one verbatim register institution name to an obshtina.
 *
 *  ⚠️ `null` MEANS "COULD NOT RESOLVE", NEVER "NO SUCH MUNICIPALITY", and a caller must
 *  escalate rather than drop the row. It covers three distinct states, all of which need an
 *  operator: an unknown name (a rename, or a new município), an ambiguous one (two obshtini
 *  share it and the register gave no oblast hint), and a hint that positively contradicts
 *  the catalogue. `municipality_join.ts --dry-run` names which. Dropping a `null` silently
 *  removes real officials from the shard tree — the failure this file exists to prevent. */
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

export type ObshtinaCandidate = { code: string; oblast: string };

/** Is this catalogue row a Sofia район? They are excluded from the generic name map because
 *  rule 3 owns them under their bare район name, and folding them in would make "искър" and
 *  "средец" collide with the PROVINCE municipalities of the same name. */
const isSofiaRayon = (oblast: string): boolean =>
  oblast === "S23" || oblast === "S24" || oblast === "S25";

type Catalogue = {
  /** Normalised name → EVERY non-Sofia obshtina carrying it. A `Map<string,string>` here
   *  was the defect: `data/municipalities.json` has one row per obshtina, but three of
   *  those names are shared by two obshtini, so "deduped by obshtina" silently meant
   *  last-write-wins across a collision. Keeping the candidates lets rule 4 narrow by
   *  oblast and lets both rules REFUSE when nothing can. */
  byName: Map<string, ObshtinaCandidate[]>;
  /** Sofia районни keyed by район name — i.e. without the "Район " prefix. */
  sofiaRayonByName: Map<string, string>;
  /** City-with-districts lookup for rule 2. */
  cityRayonObshtina: Map<string, string>;
  /** Every obshtina code the catalogue declares, for the alias fail-loud check. */
  knownCodes: Set<string>;
};

/** Read and PARTITION `data/municipalities.json` once. Both `buildResolver` and
 *  `duplicateNames` call this rather than each re-stating the partition: the first version
 *  of `duplicateNames` was a copy of these rules, so adding an `S26` — or changing the Sofia
 *  rule — would have silently desynced the CLI's diagnosis from the resolution it explains.
 *  That is the same "two copies of one rule" hazard this file's header cites as the reason
 *  for importing oblastNames.ts instead of re-declaring it, one level in. */
const readCatalogue = (): Catalogue => {
  const municipalities: MunicipalityInfo[] = JSON.parse(
    fs.readFileSync(MUNICIPALITIES_PATH, "utf-8"),
  );
  const byName = new Map<string, ObshtinaCandidate[]>();
  const sofiaRayonByName = new Map<string, string>();
  const cityRayonObshtina = new Map<string, string>();
  const knownCodes = new Set<string>();
  for (const m of municipalities) {
    knownCodes.add(m.obshtina);
    if (m.oblast === SKIP_OBLAST) continue;
    const key = normalize(m.name);
    if (isSofiaRayon(m.oblast)) {
      sofiaRayonByName.set(key, m.obshtina);
    } else {
      const list = byName.get(key);
      if (list) list.push({ code: m.obshtina, oblast: m.oblast });
      else byName.set(key, [{ code: m.obshtina, oblast: m.oblast }]);
    }
    if (m.name in CITY_RAYON_SUFFIXES) {
      cityRayonObshtina.set(m.name, m.obshtina);
    }
  }
  return { byName, sofiaRayonByName, cityRayonObshtina, knownCodes };
};

/** Every normalised município name that more than one obshtina claims, with its claimants.
 *
 *  ⚠️ THIS IS THE COLLISION SET **AFTER** THE PARTITION, WHICH IS NARROWER THAN THE
 *  CATALOGUE'S. `data/municipalities.json` has three shared names — бяла, искър, средец —
 *  but искър and средец pair a province município with a SOFIA РАЙОН, and rule 3 resolves
 *  those under their own "Район X" spelling, so only "бяла" (VAR05 + RSE04) survives here as
 *  a live ambiguity.
 *
 *  The gate and the CLI read this rather than that literal, so a catalogue edit creating a
 *  second collision surfaces as a refusal to resolve rather than as a silent pick. */
export const duplicateNames = (): Map<string, ObshtinaCandidate[]> =>
  new Map([...readCatalogue().byName].filter(([, v]) => v.length > 1));

export const buildResolver = (): Resolver => {
  const { byName, sofiaRayonByName, cityRayonObshtina, knownCodes } =
    readCatalogue();

  const aliases = readAliases();

  // Fail-loud at startup if an alias points to a code that exists in
  // neither data/municipalities.json nor the synthetic-code set. A silent
  // typo here would manifest as a 404 shard or a wrong-page roster.
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

    // 4. Disambiguator form "<X>/<oblast>/" — e.g. "Бяла/Русе/", which the register writes
    //    precisely because the bare name is ambiguous. The oblast is the answer, so it is
    //    read rather than discarded; `pickByOblast` is the same tiebreak the CIK-side
    //    parsers use, so the two sides cannot disagree about which Бяла is which.
    const slashMatch = trimmed.match(/^([^/]+)\/([^/]+)\/$/);
    if (slashMatch) {
      const bare = slashMatch[1]!.trim();
      const oblastHint = slashMatch[2]!.trim();
      const matches = byName.get(normalize(bare)) ?? [];
      // ⚠️ An UNKNOWN oblast spelling must refuse a collision rather than fall through to
      // the bare lookup below — falling through is what produced RSE04 for both Бяла.
      // `pickByOblast` reports that case as `ambiguous`, and a single match with a
      // contradicting oblast as `oblastMismatch`; neither may resolve here.
      const picked = pickByOblast(matches, oblastHint);
      if (picked.pick && !picked.ambiguous && !picked.oblastMismatch) {
        return { code: picked.pick.code, isDistrict: false, district: null };
      }
      return null;
    }

    // 5. Direct normalised lookup. A name matching two obshtini carries no hint to narrow
    //    it, so it REFUSES — the caller warns per entry and throws above a threshold, and
    //    an operator pins it in _aliases.json (rule 1, which is checked before this and so
    //    stays the escape hatch for a register spelling this file cannot resolve).
    const matches = byName.get(normalize(trimmed)) ?? [];
    if (matches.length === 1) {
      return { code: matches[0]!.code, isDistrict: false, district: null };
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

    // An unmatched name has three quite different causes and three different fixes, so the
    // dry-run names the cause rather than leaving the operator to guess from a bare list.
    const dupes = duplicateNames();
    const diagnose = (name: string): string => {
      const slash = name.trim().match(/^([^/]+)\/([^/]+)\/$/);
      if (slash) {
        const hint = slash[2]!.trim();
        if (!oblastCodeForName(hint))
          return `unknown oblast spelling ${JSON.stringify(hint)} — add it to scripts/parsers_local/oblastNames.ts`;
        return `oblast ${JSON.stringify(hint)} matches no obshtina of that name`;
      }
      const claimants = dupes.get(normalize(name.trim()));
      if (claimants)
        return `ambiguous — ${claimants.map((c) => `${c.code}/${c.oblast}`).join(" + ")}; pin it in _aliases.json`;
      return "no catalogue entry — rename or new municipality";
    };

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
          `  ${JSON.stringify(u.municipality)} — ${diagnose(u.municipality)}` +
            ` — e.g. ${u.sampleNames.join(", ")}`,
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
