// Resolve each school in data/schools/index.json to its ЕИК (Bulstat). This is
// the join that lets /school/:id show a school's own procurement and links
// schools into the entity graph (contracts, TR), and the prerequisite for the
// schools→Postgres migration.
//
// TWO sources, authoritative-first:
//   1. The МОН institution-register crosswalk (mon_ri_eik_crosswalk.json, built
//      by scripts/procurement/mon_ri_crawl.ts). The school's НЕИСПУО code (its
//      `id`) joins to the register's own ЕИК — EXACT and authoritative, covers
//      ~989/994. This is the primary source; use it whenever present.
//   2. Name-match against the procurement awarder corpus — the FALLBACK for the
//      handful not in the register. Precision-first: only accept a match on
//      normalised name-core + settlement, name-core + exact município, or a
//      globally-unique name-core. Anything ambiguous is left null.
//
// The crosswalk both widens coverage (was ~435 name-matched) and CORRECTS the
// name-match's mistakes (a shared school name matched the wrong town's EIK) —
// measured 28 corrections on the current corpus.
//
// Needs the local Postgres up (contracts + awarder_seats) for the name-match
// fallback. Run AFTER build_index.ts. `npx tsx scripts/schools/match_eik.ts`.

import fs from "node:fs";
import path from "node:path";
import { getPool, end } from "../db/lib/pg";
import { nameCore, settlNorm, nameSettl } from "./school_name_match";

const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);
const INDEX_FILE = path.join(PROJECT_ROOT, "data/schools/index.json");
const MUNI_FILE = path.join(PROJECT_ROOT, "data/municipalities.json");
// НЕИСПУО→ЕИК from the МОН institution register (see mon_ri_crawl.ts). Keyed by
// ЕИК with a `neispuo` field; we invert it to join on the school's НЕИСПУО id.
const RI_CROSSWALK_FILE = path.join(
  PROJECT_ROOT,
  "data/procurement/derived/mon_ri_eik_crosswalk.json",
);

// Build НЕИСПУО(string) → ЕИК from the crosswalk. Empty map when the file is
// absent (the crawl hasn't run) — the name-match fallback then covers everyone.
const loadRiByNeispuo = (): Map<string, string> => {
  const out = new Map<string, string>();
  if (!fs.existsSync(RI_CROSSWALK_FILE)) return out;
  const j = JSON.parse(fs.readFileSync(RI_CROSSWALK_FILE, "utf8")) as {
    awarders?: Record<string, { neispuo?: number }>;
  };
  for (const [eik, rec] of Object.entries(j.awarders ?? {}))
    if (rec.neispuo != null) out.set(String(rec.neispuo), eik);
  return out;
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

  const riByNeispuo = loadRiByNeispuo();

  const idx = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
  let total = 0;
  let matched = 0;
  const tally = { ri: 0, settl: 0, muni: 0, unique: 0 };
  for (const [obshtina, recs] of Object.entries(
    idx.schoolsByObshtina as Record<
      string,
      { id: string; name: string; address?: string; eik?: string }[]
    >,
  )) {
    for (const rec of recs) {
      total += 1;
      delete rec.eik; // idempotent re-run

      // Source 1 — authoritative НЕИСПУО→ЕИК from the МОН register.
      const riEik = riByNeispuo.get(String(rec.id));
      if (riEik) {
        rec.eik = riEik;
        matched += 1;
        tally.ri += 1;
        continue;
      }

      // Source 2 — name-match against the procurement awarder corpus.
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
    `matched ${matched}/${total} schools to EIK (${Math.round((100 * matched) / total)}%) — ` +
      `RI-register ${tally.ri}, name-match [settlement ${tally.settl}, município ${tally.muni}, unique-name ${tally.unique}]`,
  );
  await end();
};

main().catch(async (e) => {
  console.error(e);
  await end();
  process.exit(1);
});
