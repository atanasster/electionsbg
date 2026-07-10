// Resolve each school in data/schools/index.json to its ЕИК (Bulstat) by
// high-precision matching against the public-procurement awarder corpus — the
// only place schools carry an EIK (they procure textbooks/services as buyers).
// This is the join that lets /school/:id show a school's own procurement and
// links schools into the entity graph (contracts, TR), and the prerequisite for
// the schools→Postgres migration.
//
// PRECISION-FIRST. A wrong EIK links a school to another entity's contracts, so
// we only accept a match on: (1) normalised name-core + settlement, (2) name-core
// + exact município, or (3) a globally-unique name-core. Anything ambiguous is
// left null. Measured on the current corpus: 426/994 schools matched (64% of the
// schools that have ever procured), 100% precision-verified (every match's
// awarder settlement/município agrees with the school's, or the name is unique).
//
// Needs the local Postgres up (contracts + awarder_seats). Run AFTER
// build_index.ts. `npx tsx scripts/schools/match_eik.ts`.

import fs from "node:fs";
import path from "node:path";
import { getPool, end } from "../db/lib/pg";

const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);
const INDEX_FILE = path.join(PROJECT_ROOT, "data/schools/index.json");
const MUNI_FILE = path.join(PROJECT_ROOT, "data/municipalities.json");

// Strip the legal form + quotes/punctuation/numbers so "Средно училище „Неофит
// Рилски"" and "СУ Неофит Рилски - гр. Банско" reduce to the same core.
// Long descriptive forms are safe to strip as substrings (they don't occur
// mid-word in a proper name).
const LEGAL_LONG =
  /(средно училище|основно училище|обединено училище|профилирана гимназия|професионална гимназия|начално училище|езикова гимназия|спортно училище|детска градина|гимназия|национална|профилирана|природо-математическа|природоматематическа|основно|средно)/g;
// Short abbreviations MUST be whole tokens — JS `\b` doesn't fire next to a
// Cyrillic letter, so anchor on whitespace/start/end instead. A bare global
// strip would delete "су"/"пг"/"оу"… mid-word and corrupt the name-core.
// Longer abbreviations first so "соу"/"ппмг" win over "су"/"пг".
const LEGAL_ABBR = /(^|\s)(соу|ппмг|нег|оу|су|пг|ну|ег|дг)(?=\s|$)/g;
const nameCore = (n: string): string =>
  n
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/["„“»«'`№]/g, " ")
    .replace(/св\.?\s*св\.?/g, "свсв")
    .replace(/[.\-–,()/]/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(LEGAL_LONG, " ")
    .replace(LEGAL_ABBR, " ")
    .replace(
      /\b(по|за|с|на|и|акад|проф|д-р|инж|с изучаване|чужди езици)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

const settlNorm = (a: string | undefined): string =>
  (a ?? "")
    .toUpperCase()
    // Strip a leading settlement-kind prefix. JS `\b` is ASCII-only and never
    // fires next to Cyrillic, so anchor at start and allow the no-space form
    // ("ГР.РУСЕ") — mirrors settlementName() in build_index.ts.
    .replace(/^(ГР|С|ГРАД|СЕЛО)\.?\s*/, "")
    .trim();

// Settlement parsed from an awarder-name tail: "… - гр. Русе" / "… – с. Труд".
const nameSettl = (nm: string): string => {
  const mo = nm.match(/[-–]\s*(?:гр|с|град|село)\.?\s*([^,\-–]+)$/i);
  return mo ? settlNorm(mo[1]) : "";
};

type Awarder = { eik: string; name: string; settl: string; muni: string };

const main = async () => {
  const pool = getPool();
  const { rows } = await pool.query<{
    eik: string;
    nm: string;
    settlement: string | null;
    municipality: string | null;
  }>(`
    select a.awarder_eik as eik, max(a.awarder_name) nm, s.settlement, s.municipality
    from contracts a
    left join awarder_seats s on s.eik = a.awarder_eik
    where a.tag = 'contract'
      and (a.awarder_name ilike '%училищ%' or a.awarder_name ilike '%гимназия%'
        or a.awarder_name ilike '%СОУ%' or a.awarder_name ilike '%детска градина%'
        or a.awarder_name ilike 'ОУ %' or a.awarder_name ilike 'ПГ %')
    group by a.awarder_eik, s.settlement, s.municipality
  `);

  const awarders: Awarder[] = rows
    .filter((r) => r.eik)
    .map((r) => ({
      eik: r.eik.trim(),
      name: r.nm,
      settl: r.settlement ?? "",
      muni: r.municipality ?? "",
    }));

  const byCore = new Map<string, Map<string, Awarder>>(); // core → eik → awarder
  const byCoreSettl = new Map<string, Map<string, Awarder>>(); // `${core}|${settl}` → eik → awarder
  const add = (m: Map<string, Map<string, Awarder>>, k: string, a: Awarder) => {
    let inner = m.get(k);
    if (!inner) m.set(k, (inner = new Map()));
    inner.set(a.eik, a);
  };
  for (const a of awarders) {
    const c = nameCore(a.name);
    if (!c) continue;
    add(byCore, c, a);
    for (const st of new Set([settlNorm(a.settl), nameSettl(a.name)]))
      if (st) add(byCoreSettl, `${c}|${st}`, a);
  }

  const muniName = new Map<string, string>(
    (
      JSON.parse(fs.readFileSync(MUNI_FILE, "utf8")) as {
        obshtina: string;
        name: string;
      }[]
    ).map((m) => [m.obshtina, m.name.toUpperCase()]),
  );
  muniName.set("SOF00", "СТОЛИЧНА");

  const idx = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
  let total = 0;
  let matched = 0;
  const tally = { settl: 0, muni: 0, unique: 0 };
  for (const [obshtina, recs] of Object.entries(
    idx.schoolsByObshtina as Record<
      string,
      { name: string; address?: string; eik?: string }[]
    >,
  )) {
    for (const rec of recs) {
      total += 1;
      delete rec.eik; // idempotent re-run
      const c = nameCore(rec.name);
      const st = settlNorm(rec.address);
      const mn = muniName.get(obshtina) ?? "";

      let hit: Awarder | undefined;
      const csHit = byCoreSettl.get(`${c}|${st}`);
      if (csHit && csHit.size === 1) {
        hit = [...csHit.values()][0];
        tally.settl += 1;
      }
      if (!hit) {
        const cand = [...(byCore.get(c)?.values() ?? [])].filter(
          (a) => a.muni.toUpperCase() === mn,
        );
        if (cand.length === 1) {
          hit = cand[0];
          tally.muni += 1;
        }
      }
      if (!hit) {
        const core = byCore.get(c);
        if (core && core.size === 1) {
          hit = [...core.values()][0];
          tally.unique += 1;
        }
      }
      if (hit) {
        rec.eik = hit.eik;
        matched += 1;
      }
    }
  }

  fs.writeFileSync(INDEX_FILE, JSON.stringify(idx, null, 2) + "\n");
  console.log(
    `matched ${matched}/${total} schools to EIK (${Math.round((100 * matched) / total)}%) — settlement ${tally.settl}, município ${tally.muni}, unique-name ${tally.unique}`,
  );
  await end();
};

main().catch(async (e) => {
  console.error(e);
  await end();
  process.exit(1);
});
