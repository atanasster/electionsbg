// Derive the state | municipal | private ownership map for every НЗОК-paid
// facility and write the committed data/budget/nzok/hospital_ownership.json —
// a small Рег.№→ownership lookup the payments loader joins onto each row (the
// same committed-derived-map pattern as hospital_eik.json).
//
// Ownership answers Диагноза България's headline gap: it excludes private
// hospitals; we include them and can now SAY which is which. The classifier lives
// in ./lib/ownership.ts (pure + testable); this script wires it to the two inputs:
//   * the ЕЕОФ financials file (state/municipal roster, by name)      — hospital_financials.json
//   * the loaded payment universe + the ЕЕОФ eik join (from Postgres) — nzok_hospital_*
//
// Needs the LOCAL Postgres (nzok_hospital_payments + nzok_hospital_financials must
// be loaded) and the ЕЕОФ financials file (`npm run data:nzok -- --eeof`). Like
// the crosswalk it is near-static and opt-in:
//   npm run data:nzok -- --ownership     (or folded into --crosswalk)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, end } from "../db/lib/pg";
import {
  buildEeofOwnershipIndex,
  classifyOwnership,
  type Ownership,
} from "./lib/ownership";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const FIN_FILE = path.join(REPO, "data/budget/nzok/hospital_financials.json");
const OUT_FILE = path.join(REPO, "data/budget/nzok/hospital_ownership.json");

const main = async (): Promise<void> => {
  if (!fs.existsSync(FIN_FILE))
    throw new Error(
      `${FIN_FILE} missing — regenerate the ЕЕОФ financials first:  npm run data:nzok -- --eeof`,
    );
  const financials = JSON.parse(fs.readFileSync(FIN_FILE, "utf8"));
  const index = buildEeofOwnershipIndex(financials);
  if (!index.quarter)
    throw new Error("no ЕЕОФ quarter found in financials file");

  const pool = getPool();
  // Seed the exact eik bridge from the loaded ЕЕОФ table (the financials JSON
  // itself carries no eik — it is resolved at PG-load time by the fold match).
  const finEik = await pool.query<{ eik: string; ownership: string }>(
    `WITH fq AS (SELECT max(quarter COLLATE "C") q FROM nzok_hospital_financials)
     SELECT DISTINCT eik, ownership FROM nzok_hospital_financials
     WHERE quarter = (SELECT q FROM fq) AND eik IS NOT NULL`,
  );
  for (const r of finEik.rows)
    if (r.ownership === "state" || r.ownership === "municipal")
      index.byEik.set(r.eik, r.ownership);

  // The full payment universe: one row per facility, its name preferring the бмп
  // spelling (the widest report), and its eik from the crosswalk join already in
  // the table. Every distinct Рег.№ across all periods/streams is classified.
  const universe = await pool.query<{
    reg_no: string;
    name: string;
    eik: string | null;
  }>(
    `SELECT reg_no,
            COALESCE(min(name) FILTER (WHERE stream = 'bmp'), min(name COLLATE "C")) AS name,
            min(eik) AS eik
     FROM nzok_hospital_payments
     GROUP BY reg_no
     ORDER BY reg_no COLLATE "C"`,
  );
  if (universe.rows.length === 0)
    throw new Error(
      "nzok_hospital_payments is empty — load it first (npm run db:load:nzok-hospital:pg)",
    );

  // Aggregate € per facility (summed across streams, latest period) for the audit
  // split only — the shipped file is the classification, not the money.
  const eur = await pool.query<{ reg_no: string; e: string }>(
    `SELECT reg_no, ROUND(SUM(cumulative_eur))::bigint AS e
     FROM nzok_hospital_payments_latest_rows GROUP BY reg_no`,
  );
  const eurByReg = new Map(eur.rows.map((r) => [r.reg_no, Number(r.e)]));

  const entries = universe.rows.map((f) => {
    const v = classifyOwnership(
      { regNo: f.reg_no, name: f.name, eik: f.eik },
      index,
    );
    return {
      regNo: f.reg_no,
      name: f.name,
      eik: f.eik,
      ownership: v.ownership,
      method: v.method,
    };
  });

  const out = {
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Наясно (изведено)",
      basis: "МЗ ЕЕОФ (Наредба № 5/2019) + НЗОК плащания по лечебно заведение",
      description:
        "Класификация на всяко лечебно заведение като държавно, общинско или частно. Държавните и общинските болници подават ЕЕОФ към МЗ; болница, която НЗОК заплаща, но която липсва в ЕЕОФ, е частна. Свързването на ЕЕОФ регистъра (по име) към платежния универсум (по Рег.№ ЛЗ) е точно съответствие (по ЕИК и по нормализирано име) с ръчно проверени изключения за националните държавни болници без ЕИК в ЕЕОФ.",
      eeofQuarter: index.quarter,
    },
    entries,
  };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));

  // Audit print: counts + € split + the method breakdown, so a regeneration is
  // eyeballable against the last-known-good split (state ~41% / muni ~15% / priv ~44%).
  const agg: Record<Ownership, { n: number; e: number }> = {
    state: { n: 0, e: 0 },
    municipal: { n: 0, e: 0 },
    private: { n: 0, e: 0 },
  };
  const methods: Record<string, number> = {};
  for (const e of entries) {
    agg[e.ownership].n++;
    agg[e.ownership].e += eurByReg.get(e.regNo) ?? 0;
    methods[e.method] = (methods[e.method] ?? 0) + 1;
  }
  const tot = agg.state.e + agg.municipal.e + agg.private.e || 1;
  console.log(
    `Wrote ${OUT_FILE}\n  ЕЕОФ quarter ${index.quarter} · ${entries.length} facilities · methods ${JSON.stringify(methods)}`,
  );
  for (const k of ["state", "municipal", "private"] as const)
    console.log(
      `  ${k.padEnd(10)} ${String(agg[k].n).padStart(3)} fac · €${(agg[k].e / 1e6).toFixed(1)}M · ${((100 * agg[k].e) / tot).toFixed(1)}%`,
    );
  console.log(
    `  → public ${(((agg.state.e + agg.municipal.e) * 100) / tot).toFixed(1)}% vs private ${((agg.private.e * 100) / tot).toFixed(1)}%`,
  );
  await end();
};

main().catch(async (e) => {
  console.error(e);
  await end();
  process.exit(1);
});
