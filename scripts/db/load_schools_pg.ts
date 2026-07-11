// Load the schools serving layer into Postgres (schema: 055_schools.sql):
//   • schools        — dim (name, obshtina, oblast, geo, eik, latest ДЗИ)
//   • school_scores  — fact (school × year × subject: ДЗИ + НВО)
//   • school_context — per-obshtina SES index
//   • school_payloads — the 'directory' blob: the whole /education dataset with
//     the SES + value-added regressions ALREADY COMPUTED here, so the client
//     fetches one small blob instead of the 1.25 MB raw index + a client memo.
//
// SERVING loader — reads data/schools/index.json + data/education/school_context.json
// (written by the update-schools ingest); never writes JSON back. The regression
// port below MUST stay behaviourally identical to src/data/schools/useSchoolDirectory
// (same thresholds, same banding) — this is now the single source of the verdicts.
//
// Run: `npm run db:load:schools:pg` (local) / `:cloud` (Cloud SQL proxy).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, withClient, end } from "./lib/pg";
import { recordIngestBatch } from "./lib/ingest_changelog";
import {
  MIN_RANK_COHORT,
  ols,
  bandVerdict,
  nvoPriorOf,
  type Verdict,
} from "./lib/school_stats";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SCHEMA = path.join(ROOT, "scripts/db/schema/pg/055_schools.sql");
const INGEST_TRACKING = path.join(
  ROOT,
  "scripts/db/schema/pg/005_ingest_tracking.sql",
);
const INDEX_FILE = path.join(ROOT, "data/schools/index.json");
const CONTEXT_FILE = path.join(ROOT, "data/education/school_context.json");
const MUNI_FILE = path.join(ROOT, "data/municipalities.json");

const r2 = (v: number) => Math.round(v * 100) / 100;

type RawSchool = {
  id: string;
  name: string;
  address?: string;
  loc?: string;
  eik?: string;
  scoresByYear: Record<string, Record<string, number>>;
  countsByYear?: Record<string, Record<string, number>>;
  nvoByYear?: Record<string, { bel?: number; math?: number }>;
};

// A school in the directory payload — display fields + baked-in verdicts.
type DirSchool = {
  id: string;
  name: string;
  obshtina: string;
  obshtinaName: string;
  oblast: string;
  address?: string;
  loc?: string;
  eik?: string;
  latestYear: number | null;
  latestScore: number | null;
  latestN: number | null;
  series: { year: number; score: number }[];
  mathLatest: { year: number; score: number } | null;
  ses: number | null;
  predicted: number | null;
  residual: number | null;
  verdict: Verdict | null;
  nvoPrior: number | null;
  vaPredicted: number | null;
  vaResidual: number | null;
  vaVerdict: Verdict | null;
};

const buildDirectory = () => {
  const idx = JSON.parse(readFileSync(INDEX_FILE, "utf8"));
  const ctx: {
    weights: Record<string, number>;
    byObshtina: Record<
      string,
      {
        ses: number;
        shareTertiary: number;
        shareLowEd: number;
        unemployment: number;
      }
    >;
  } = JSON.parse(readFileSync(CONTEXT_FILE, "utf8"));
  const muni = new Map(
    (
      JSON.parse(readFileSync(MUNI_FILE, "utf8")) as {
        obshtina: string;
        name: string;
      }[]
    ).map((m) => [m.obshtina, m.name]),
  );
  const resolveMuni = (code: string): { name: string; oblast: string } => {
    const oblast = code === "SOF00" ? "S23" : code.slice(0, 3);
    const nm = muni.get(code);
    if (nm) return { name: nm, oblast };
    if (code === "SOF00") return { name: "Столична община", oblast };
    return { name: code, oblast };
  };

  const schools: DirSchool[] = [];
  for (const [obshtina, recs] of Object.entries(
    idx.schoolsByObshtina as Record<string, RawSchool[]>,
  )) {
    const mn = resolveMuni(obshtina);
    for (const rec of recs) {
      const series = Object.keys(rec.scoresByYear)
        .map(Number)
        .sort((a, b) => a - b)
        .flatMap((y) => {
          const s = rec.scoresByYear[String(y)]?.dzi_bel;
          return typeof s === "number" ? [{ year: y, score: s }] : [];
        });
      const last = series[series.length - 1] ?? null;
      const latestN =
        last != null
          ? (rec.countsByYear?.[String(last.year)]?.dzi_bel ?? null)
          : null;
      // latest maths (any year, newest first)
      let mathLatest: { year: number; score: number } | null = null;
      for (const y of Object.keys(rec.scoresByYear)
        .map(Number)
        .sort((a, b) => b - a)) {
        const m = rec.scoresByYear[String(y)]?.dzi_math;
        if (typeof m === "number") {
          mathLatest = { year: y, score: m };
          break;
        }
      }
      schools.push({
        id: rec.id,
        name: rec.name,
        obshtina,
        obshtinaName: mn.name,
        oblast: mn.oblast,
        address: rec.address,
        loc: rec.loc,
        eik: rec.eik,
        latestYear: last?.year ?? null,
        latestScore: last?.score ?? null,
        latestN,
        series,
        mathLatest,
        ses: ctx.byObshtina[obshtina]?.ses ?? null,
        predicted: null,
        residual: null,
        verdict: null,
        nvoPrior: nvoPriorOf(rec.nvoByYear, last?.year ?? null),
        vaPredicted: null,
        vaResidual: null,
        vaVerdict: null,
      });
    }
  }

  // National count-weighted average per year, from the raw index (per-year counts).
  const nat = new Map<number, { sum: number; n: number }>();
  for (const recs of Object.values(
    idx.schoolsByObshtina as Record<string, RawSchool[]>,
  )) {
    for (const rec of recs) {
      for (const y of Object.keys(rec.scoresByYear)) {
        const s = rec.scoresByYear[y]?.dzi_bel;
        const c = rec.countsByYear?.[y]?.dzi_bel;
        if (typeof s === "number" && typeof c === "number") {
          const a = nat.get(Number(y)) ?? { sum: 0, n: 0 };
          a.sum += s * c;
          a.n += c;
          nat.set(Number(y), a);
        }
      }
    }
  }
  const nationalByYear = [...nat.entries()]
    .map(([year, a]) => ({
      year,
      avg: a.n ? r2(a.sum / a.n) : null,
      examinees: a.n,
    }))
    .sort((a, b) => a.year - b.year);
  const latestYear: number | null =
    (idx.latestYear as number) ?? nationalByYear.at(-1)?.year ?? null;

  const rankable = schools.filter(
    (s) => s.latestScore != null && (s.latestN ?? 0) >= MIN_RANK_COHORT,
  );

  // SES regression (score ~ community context) + verdict banding.
  const regression = ols(
    rankable
      .filter((s) => s.ses != null && s.latestScore != null)
      .map((s) => ({ x: s.ses!, y: s.latestScore! })),
  );
  if (regression) {
    for (const s of schools) {
      if (s.ses == null || s.latestScore == null) continue;
      s.predicted = r2(regression.intercept + regression.slope * s.ses);
      s.residual = r2(s.latestScore - s.predicted);
      if ((s.latestN ?? 0) >= MIN_RANK_COHORT)
        s.verdict = bandVerdict(s.residual, regression.residualSd);
    }
  }

  // Value-added regression (score ~ 7th-grade НВО prior attainment).
  const nvoRegression = ols(
    rankable
      .filter((s) => s.nvoPrior != null && s.latestScore != null)
      .map((s) => ({ x: s.nvoPrior!, y: s.latestScore! })),
  );
  if (nvoRegression) {
    for (const s of schools) {
      if (s.nvoPrior == null || s.latestScore == null) continue;
      s.vaPredicted = r2(
        nvoRegression.intercept + nvoRegression.slope * s.nvoPrior,
      );
      s.vaResidual = r2(s.latestScore - s.vaPredicted);
      if ((s.latestN ?? 0) >= MIN_RANK_COHORT)
        s.vaVerdict = bandVerdict(s.vaResidual, nvoRegression.residualSd);
    }
  }

  // Per-oblast rollup (count-weighted latest-year average).
  const oblAcc = new Map<string, { sum: number; n: number; schools: number }>();
  for (const s of schools) {
    if (
      s.latestYear !== latestYear ||
      s.latestN == null ||
      !s.oblast ||
      s.latestScore == null
    )
      continue;
    const a = oblAcc.get(s.oblast) ?? { sum: 0, n: 0, schools: 0 };
    a.sum += s.latestScore * s.latestN;
    a.n += s.latestN;
    a.schools += 1;
    oblAcc.set(s.oblast, a);
  }
  const byOblast = [...oblAcc.entries()]
    .map(([oblast, a]) => ({
      oblast,
      avg: a.n ? r2(a.sum / a.n) : 0,
      examinees: a.n,
      schools: a.schools,
    }))
    .sort((a, b) => b.avg - a.avg || a.oblast.localeCompare(b.oblast));

  const directory = {
    latestYear,
    schools: schools.sort((a, b) => a.id.localeCompare(b.id)),
    nationalByYear,
    byOblast,
    regression,
    nvoRegression,
    context: { weights: ctx.weights },
  };

  // Slim 'risk' blob for the МОН sector pack's SchoolRiskTile — the top
  // under-performers only (the negative tail of the SES regression), so that
  // tile fetches a few KB instead of the whole ~600 KB directory. Kept as its
  // own payload row rather than sliced client-side precisely to avoid shipping
  // the full corpus to a page that shows 15 rows. Buffer a few past the 15 the
  // tile renders so it can grow without a reload.
  const risk = {
    latestYear,
    schools: schools
      .filter((s) => s.verdict === "under" && s.residual != null)
      .sort((a, b) => (a.residual ?? 0) - (b.residual ?? 0))
      .slice(0, 20)
      .map((s) => ({
        id: s.id,
        name: s.name,
        obshtinaName: s.obshtinaName,
        latestScore: s.latestScore,
        predicted: s.predicted,
        residual: s.residual,
        vaVerdict: s.vaVerdict,
      })),
  };
  return { directory, risk, ctxByObshtina: ctx.byObshtina, idx };
};

const main = async () => {
  await exec(readFileSync(SCHEMA, "utf8"));
  await exec(readFileSync(INGEST_TRACKING, "utf8"));

  const { directory, risk, ctxByObshtina, idx } = buildDirectory();

  await withClient(async (c) => {
    await c.query("BEGIN");
    await c.query(
      "TRUNCATE schools, school_scores, school_context, school_payloads",
    );

    // schools dim. The id is the НЕИСПУО PK — a dup would let ON CONFLICT DO
    // NOTHING silently drop a school (undercounting the table vs the payload),
    // so fail loudly instead of masking it.
    const seenIds = new Set<string>();
    for (const s of directory.schools) {
      if (seenIds.has(s.id))
        throw new Error(`duplicate school id ${s.id} (${s.name})`);
      seenIds.add(s.id);
    }
    const dim = directory.schools.map((s) => {
      const [lng, lat] = (s.loc ?? "").split(",").map(Number);
      return [
        s.id,
        s.name,
        s.obshtina,
        s.oblast,
        s.address ?? null,
        Number.isFinite(lat) ? lat : null,
        Number.isFinite(lng) ? lng : null,
        s.eik ?? null,
        s.latestYear,
        s.latestScore,
        s.latestN,
      ];
    });
    for (let i = 0; i < dim.length; i += 500) {
      const b = dim.slice(i, i + 500);
      const vals = b
        .map(
          (_, r) =>
            `(${Array.from({ length: 11 }, (_, k) => `$${r * 11 + k + 1}`).join(",")})`,
        )
        .join(",");
      await c.query(
        `INSERT INTO schools (id,name,obshtina,oblast,address,lat,lng,eik,latest_year,latest_bel,latest_n)
         VALUES ${vals} ON CONFLICT (id) DO NOTHING`,
        b.flat(),
      );
    }

    // school_scores fact (ДЗИ + НВО), from the raw index.
    const fact: (string | number | null)[][] = [];
    for (const recs of Object.values(
      idx.schoolsByObshtina as Record<string, RawSchool[]>,
    )) {
      for (const rec of recs) {
        for (const [y, subs] of Object.entries(rec.scoresByYear)) {
          for (const [sub, v] of Object.entries(subs)) {
            // value is NOT NULL — skip anything non-numeric rather than fail the
            // whole batch on a malformed future ingest.
            if (typeof v !== "number" || !Number.isFinite(v)) continue;
            fact.push([
              rec.id,
              Number(y),
              sub,
              v,
              rec.countsByYear?.[y]?.[sub] ?? null,
            ]);
          }
        }
        for (const [y, nv] of Object.entries(rec.nvoByYear ?? {})) {
          if (typeof nv.bel === "number")
            fact.push([rec.id, Number(y), "nvo_bel", nv.bel, null]);
          if (typeof nv.math === "number")
            fact.push([rec.id, Number(y), "nvo_math", nv.math, null]);
        }
      }
    }
    for (let i = 0; i < fact.length; i += 1000) {
      const b = fact.slice(i, i + 1000);
      const vals = b
        .map(
          (_, r) =>
            `($${r * 5 + 1},$${r * 5 + 2},$${r * 5 + 3},$${r * 5 + 4},$${r * 5 + 5})`,
        )
        .join(",");
      await c.query(
        `INSERT INTO school_scores (school_id,year,subject,value,n) VALUES ${vals}
         ON CONFLICT (school_id,year,subject) DO NOTHING`,
        b.flat(),
      );
    }

    // school_context
    const ctxRows = Object.entries(ctxByObshtina).map(([ob, v]) => [
      ob,
      v.ses,
      v.shareTertiary,
      v.shareLowEd,
      v.unemployment,
    ]);
    for (let i = 0; i < ctxRows.length; i += 500) {
      const b = ctxRows.slice(i, i + 500);
      const vals = b
        .map(
          (_, r) =>
            `($${r * 5 + 1},$${r * 5 + 2},$${r * 5 + 3},$${r * 5 + 4},$${r * 5 + 5})`,
        )
        .join(",");
      await c.query(
        `INSERT INTO school_context (obshtina,ses,share_tertiary,share_low_ed,unemployment)
         VALUES ${vals} ON CONFLICT (obshtina) DO NOTHING`,
        b.flat(),
      );
    }

    // directory payload (verbatim) + the slim 'risk' blob for the МОН pack.
    await c.query(
      "INSERT INTO school_payloads (kind,key,payload) VALUES ('directory','',$1::jsonb) ON CONFLICT (kind,key) DO NOTHING",
      [JSON.stringify(directory)],
    );
    await c.query(
      "INSERT INTO school_payloads (kind,key,payload) VALUES ('risk','',$1::jsonb) ON CONFLICT (kind,key) DO NOTHING",
      [JSON.stringify(risk)],
    );

    // recent_updates changelog (per school-year-subject).
    await recordIngestBatch(c, {
      source: "school_scores",
      table: "school_scores",
      keyExpr: "t.school_id || ':' || t.year || ':' || t.subject",
      nameExpr: "(SELECT name FROM schools s WHERE s.id = t.school_id)",
      detailExpr: "t.year || ' · ' || t.subject || ' ' || t.value",
      amountExpr: "NULL::double precision",
      rowsTotal: fact.length,
    });

    await c.query("COMMIT");
    console.log(
      `schools→PG: ${dim.length} schools, ${fact.length} score-rows, ${ctxRows.length} context rows, directory + ${risk.schools.length}-row risk payload`,
    );
  });
  await end();
};

main().catch(async (e) => {
  console.error(e);
  await end();
  process.exit(1);
});
