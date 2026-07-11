// Load the НЗОК CLINICAL-ACTIVITY corpus into Postgres so the health pack's
// activity tile (national procedure volumes + cases-per-bed outlier) and the
// /company/:eik case-mix tile are DB-served. Two tables:
//   nzok_activities        — annual (facility × procedure) cases + ЗОЛ
//   nzok_activity_monthly  — national monthly cases/ЗОЛ series (the trend)
//
//   npm run db:load:nzok-activities:pg          (needs `npm run db:pg:up` first)
//   npm run db:load:nzok-activities:pg:cloud    (targets the Cloud SQL proxy :5434)
//
// Source = data/budget/nzok/activities.json, produced by
// scripts/nzok/write_activities.ts. The design rules (cases are volume not value;
// the cases-per-bed outlier is pathway-internal + type-grouped; signpost not
// verdict) live in the writer and in 053_nzok_activities.sql.
//
// The source has NO Рег.№ ЛЗ, only the facility NAME. This loader attaches EIK by
// folding the facility name and matching it to nzok_hospital_payments (which
// carries name + eik and spans private hospitals). The fold MUST match
// write_activities.ts foldName so the two agree; unmatched → eik NULL (honest).

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, withClient, end } from "./lib/pg";
import { recordIngestBatch } from "./lib/ingest_changelog";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const SCHEMA_FILE = path.join(
  REPO,
  "scripts/db/schema/pg/053_nzok_activities.sql",
);
// Pathway-navigation + spend + case-mix fns (migration 059). It reads
// nzok_activities; the pathway tree uses nzok_activity_by_procedure_spend (which
// hospitals bill one КП, by cases, with implied spend when tariffs are loaded).
// The tariff TABLE it creates stays empty until the opt-in tariff loader runs, but
// the FUNCTIONS must exist here so the pathway tree works on a fresh DB — it
// degrades to volume-only when the tariff table is empty.
const PATHWAY_SPEND_SCHEMA_FILE = path.join(
  REPO,
  "scripts/db/schema/pg/059_nzok_pathway_tariffs.sql",
);
const JSON_FILE = path.join(REPO, "data/budget/nzok/activities.json");
const PAYMENTS_FILE = path.join(
  REPO,
  "data/budget/nzok/hospital_payments.json",
);
const FINANCIALS_FILE = path.join(
  REPO,
  "data/budget/nzok/hospital_financials.json",
);

/** STRONG fold for cross-source hospital-name matching. The three sources spell
 *  the same hospital differently — the activities feed writes "Свети Георги ЕАД",
 *  the МЗ financials "Св. Георги … ЕАД", the payments partner list its own
 *  variant — so a plain fold does not bridge them. This one additionally: drops
 *  legal-form + geographic-filler tokens, collapses "СВЕТИ/СВЕТА/СВ." → "СВ", and
 *  drops the "Д-Р" honorific, which lifts the match rate from ~30% to the ~90%
 *  the payloads need. Used identically for activities, payments and financials
 *  names below. */
const DROP_TOKENS = new Set([
  "ЕАД",
  "АД",
  "ЕООД",
  "ООД",
  "ДЗЗД",
  "ДР",
  "ГР",
  "ЕТ",
]);
const strongFold = (name: string): string =>
  name
    .toUpperCase()
    .replace(/[«»"'`„“”‘’]/g, "")
    .replace(/СВЕТИ|СВЕТА|СВ\./g, "СВ")
    .replace(/Д-Р/g, "ДР")
    .replace(/[^0-9A-ZА-Я]+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t && !DROP_TOKENS.has(t))
    .join(" ");

interface FacilityProc {
  rzok: string;
  facility: string;
  facilityFold: string;
  procedure: string;
  procType: string;
  cases: number;
  zol: number;
}
interface ActivitiesFile {
  year: number;
  monthlyNational: { period: string; cases: number; zol: number }[];
  facilityProcedures: FacilityProc[];
  totals: { totalCases: number };
}

const batchInsert = async (
  c: import("pg").PoolClient,
  table: string,
  cols: readonly string[],
  rows: unknown[][],
): Promise<void> => {
  const N = cols.length;
  const BATCH = Math.max(1, Math.floor(60000 / N));
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const values = slice
      .map(
        (_, r) => `(${cols.map((_, col) => `$${r * N + col + 1}`).join(",")})`,
      )
      .join(",");
    await c.query(
      `INSERT INTO ${table} (${cols.join(",")}) VALUES ${values}`,
      slice.flat(),
    );
  }
};

// "MM.YYYY" → "YYYY-MM-01" for the monthly national series.
const monthToDate = (p: string): string => {
  const m = /^(\d{2})\.(\d{4})$/.exec(p);
  if (!m) throw new Error(`unexpected month "${p}" (want MM.YYYY)`);
  return `${m[2]}-${m[1]}-01`;
};

const ACT_COLS = [
  "period",
  "rzok",
  "facility",
  "facility_fold",
  "eik",
  "procedure",
  "proc_type",
  "cases",
  "zol",
  "beds",
] as const;
const MONTHLY_COLS = ["period", "cases", "zol"] as const;

const main = async (): Promise<void> => {
  if (!existsSync(JSON_FILE))
    throw new Error(
      `${JSON_FILE} missing — regenerate with:  npm run data:nzok -- --activities`,
    );
  const data = JSON.parse(readFileSync(JSON_FILE, "utf8")) as ActivitiesFile;
  if (
    !Array.isArray(data.facilityProcedures) ||
    data.facilityProcedures.length === 0
  )
    throw new Error(
      `${JSON_FILE} has no facilityProcedures[] — shape changed?`,
    );

  // strongFold → eik, from the payments file (name + eik; spans private hospitals).
  const eikByFold = new Map<string, string>();
  if (existsSync(PAYMENTS_FILE)) {
    const pay = JSON.parse(readFileSync(PAYMENTS_FILE, "utf8")) as {
      hospitals?: { name: string; eik?: string | null }[];
    };
    for (const h of pay.hospitals ?? []) {
      if (!h.eik) continue;
      const f = strongFold(h.name);
      if (!eikByFold.has(f)) eikByFold.set(f, h.eik);
    }
  }

  // strongFold → {eik, beds}, from the МЗ ЕЕОФ financials (latest quarter). This is
  // BOTH a second eik source (МЗ-spelled names) AND the only bed-count source.
  // Beds bridge BOTH ways: by EIK (reliable — financials carries eik) and by
  // strongFold (for facilities the payments eik crosswalk missed). Name spelling
  // diverges hard across the three НЗОК/МЗ sources, so eik is the primary key and
  // the fold the fallback.
  const eikByFoldFin = new Map<string, string>();
  const bedsByFold = new Map<string, number>();
  const bedsByEik = new Map<string, number>();
  if (existsSync(FINANCIALS_FILE)) {
    const fin = JSON.parse(readFileSync(FINANCIALS_FILE, "utf8")) as {
      quarters?: {
        quarter: string;
        hospitals: {
          name: string;
          eik?: string | null;
          avgMonthlyBeds?: number | null;
        }[];
      }[];
    };
    const latestQ = (fin.quarters ?? [])
      .map((q) => q.quarter)
      .sort()
      .pop();
    for (const q of fin.quarters ?? []) {
      if (q.quarter !== latestQ) continue;
      for (const h of q.hospitals) {
        const f = strongFold(h.name);
        if (h.eik && !eikByFoldFin.has(f)) eikByFoldFin.set(f, h.eik);
        if (h.avgMonthlyBeds && h.avgMonthlyBeds > 0) {
          if (!bedsByFold.has(f)) bedsByFold.set(f, h.avgMonthlyBeds);
          if (h.eik && !bedsByEik.has(h.eik))
            bedsByEik.set(h.eik, h.avgMonthlyBeds);
        }
      }
    }
  }

  const yearAnchor = `${data.year}-01-01`;
  const actRows: unknown[][] = data.facilityProcedures.map((g) => {
    const sf = strongFold(g.facility);
    const eik = eikByFold.get(sf) ?? eikByFoldFin.get(sf) ?? null;
    return [
      yearAnchor,
      g.rzok,
      g.facility,
      g.facilityFold,
      eik,
      g.procedure,
      g.procType,
      Math.round(g.cases),
      Math.round(g.zol),
      (eik ? bedsByEik.get(eik) : undefined) ?? bedsByFold.get(sf) ?? null,
    ];
  });
  const monthlyRows: unknown[][] = data.monthlyNational.map((m) => [
    monthToDate(m.period),
    Math.round(m.cases),
    Math.round(m.zol),
  ]);

  await exec(readFileSync(SCHEMA_FILE, "utf8"));
  await exec(readFileSync(PATHWAY_SPEND_SCHEMA_FILE, "utf8"));

  const casesSum = actRows.reduce((a, r) => a + (r[7] as number), 0);
  const matched = actRows.filter((r) => r[4]).length;
  const matchedFacilities = new Set(
    actRows.filter((r) => r[4]).map((r) => r[3]),
  ).size;
  const totalFacilities = new Set(actRows.map((r) => r[3])).size;
  const bedsFacilities = new Set(
    actRows.filter((r) => r[9] != null).map((r) => r[3]),
  ).size;

  await withClient(async (c) => {
    await c.query("BEGIN");
    await c.query("TRUNCATE nzok_activities");
    await c.query("TRUNCATE nzok_activity_monthly");

    await batchInsert(c, "nzok_activities", ACT_COLS, actRows);
    await batchInsert(c, "nzok_activity_monthly", MONTHLY_COLS, monthlyRows);

    // Post-load reconciliation — row count AND summed cases must agree.
    const { rows: chk } = await c.query<{ n: number; s: string; m: number }>(
      `SELECT
         (SELECT count(*)::int          FROM nzok_activities)        AS n,
         (SELECT sum(cases)::bigint      FROM nzok_activities)        AS s,
         (SELECT count(*)::int          FROM nzok_activity_monthly)  AS m`,
    );
    if (
      chk[0].n !== actRows.length ||
      Number(chk[0].s) !== casesSum ||
      chk[0].m !== monthlyRows.length
    )
      throw new Error(
        `post-load mismatch: activities ${chk[0].n}/${chk[0].s} vs ${actRows.length}/${casesSum}; monthly ${chk[0].m} vs ${monthlyRows.length}`,
      );

    // "What changed" changelog — natural key = (year, facility fold, procedure).
    await recordIngestBatch(c, {
      source: "nzok_activities",
      table: "nzok_activities",
      keyExpr:
        "EXTRACT(YEAR FROM t.period)::text || '|' || t.facility_fold || '|' || t.procedure",
      nameExpr: "t.facility",
      detailExpr: "t.procedure",
      amountExpr: "t.cases::double precision",
      rowsTotal: actRows.length,
    });

    await c.query("COMMIT");
  });

  console.log(
    `Loaded nzok_activities: ${actRows.length.toLocaleString("en")} rows · year ${data.year} · Σ ${casesSum.toLocaleString("en")} cases\n` +
      `Loaded nzok_activity_monthly: ${monthlyRows.length} months\n` +
      `EIK crosswalk: ${matchedFacilities}/${totalFacilities} facilities matched (${matched.toLocaleString("en")} of ${actRows.length.toLocaleString("en")} rows)\n` +
      `Beds crosswalk: ${bedsFacilities}/${totalFacilities} facilities have ЕЕОФ beds (cases-per-bed outlier universe)`,
  );
  await end();
};

main().catch(async (e) => {
  console.error(e);
  await end();
  process.exit(1);
});
