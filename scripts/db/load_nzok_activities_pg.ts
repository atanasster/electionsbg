// Load the НЗОК CLINICAL-ACTIVITY corpus into Postgres so the health pack's
// activity tile (national procedure volumes + cases-per-bed outlier) and the
// /company/:eik case-mix tile are DB-served. Three tables:
//   nzok_activities                 — annual (ENTITY × procedure) cases + ЗОЛ
//   nzok_activity_monthly           — national monthly cases/ЗОЛ series (the trend)
//   nzok_activity_facility_periods  — per-period facility roster (churn + coverage)
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
//
// WHY THIS LOADER OWNS FACILITY IDENTITY. НЗОК renames facilities MID-YEAR (the
// 2025 feed switched from mixed-case trade names to ALL-CAPS legal names between
// м.06 and м.07). The writer can only key its annual matrix on the NAME, so a
// renamed hospital arrives here as two folds with its cases split — 463 names for
// 376–403 real facilities. Only the EIK crosswalk can re-unite them, and it lives
// here, so this loader:
//   1. resolves each fold to an `entity_key` (eik, else 'f:'||fold) and
//      re-aggregates the annual matrix onto (entity_key, procedure), keeping the
//      LATEST period's name as a display label only;
//   2. ASSERTS on name churn (below) so the next migration is caught pre-ship —
//      this is the check whose absence let the 2025 split ship;
//   3. loads the per-period roster so the overview can publish the unmapped share
//      (~11% of national cases) rather than drop it.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, withClient, vacuumAfterReload, end } from "./lib/pg";
import { recordIngestBatch } from "./lib/ingest_changelog";
import {
  buildActivityEikResolver,
  strongFold,
  type NamedEik,
} from "./lib/nzok_activity_eik";

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

// The facility-name → EIK bridge (strongFold + the region-scoped tiers + the
// curated holdout tables) lives in ./lib/nzok_activity_eik, so it is unit-tested
// and shared. strongFold is still used here for the beds-by-fold crosswalk below.

interface FacilityProc {
  rzok: string;
  facility: string;
  facilityFold: string;
  procedure: string;
  procType: string;
  cases: number;
  zol: number;
}
interface FacilityPeriod {
  facilityFold: string;
  rzok: string;
  periods: { period: string; facility: string; cases: number; zol: number }[];
}
interface ActivitiesFile {
  year: number;
  monthlyNational: { period: string; cases: number; zol: number }[];
  facilityProcedures: FacilityProc[];
  facilityPeriods?: FacilityPeriod[];
  totals: { totalCases: number };
}

// ── Name-churn ceiling ─────────────────────────────────────────────────────
// The year's distinct ENTITY count divided by the busiest single period's. A
// stable year sits at ~1.01–1.02: the only excess is genuine openings/closures.
// The unfixed 2025 name-grain matrix scored 1.149 (463 names / 403), which is
// what this ceiling is calibrated to catch. After the entity re-key 2025 lands
// near 1.05 — the residue is the ~32% of names that never reach an EIK and so
// cannot be re-united across their rename. 1.10 leaves headroom above that
// residue while still failing a fresh mass migration.
//
// If this throws: НЗОК has probably renamed a batch of facilities again. Do NOT
// raise the ceiling. Look at the printed churn report, then add curated
// signatures to scripts/db/lib/nzok_activity_eik.ts so the renamed halves
// resolve to the same EIK. Heuristic name-linking was measured and rejected —
// it recovers ~2 facilities and mis-merges genuinely distinct same-town
// hospitals (МЦ vs МБАЛ "Д-р Никола Василиев" are different EIKs).
const ENTITY_CHURN_CEILING = 1.1;

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
  "entity_key",
  "procedure",
  "proc_type",
  "cases",
  "zol",
  "beds",
] as const;
const MONTHLY_COLS = ["period", "cases", "zol"] as const;
const FAC_PERIOD_COLS = [
  "period",
  "facility_fold",
  "facility",
  "rzok",
  "eik",
  "entity_key",
  "cases",
  "zol",
] as const;

/** One facility fold's resolved identity. `eik` is NULL when no name the fold
 *  ever billed under reached the crosswalk; `entityKey` is then fold-scoped, so
 *  the fold stands alone and its rename halves stay split — visibly, via the
 *  coverage block, rather than silently merged on a guess. */
interface Resolved {
  fold: string;
  rzok: string;
  eik: string | null;
  entityKey: string;
  /** Name billed in the LATEST period this fold appears in — the display label. */
  latestName: string;
  /** Latest period the fold appears in, "MM.YYYY". Orders the display label. */
  latestPeriod: string;
}

/** Order "MM.YYYY" chronologically (string order would sort 01 before 12 of the
 *  same year correctly, but across years it breaks — be explicit). */
const periodRank = (p: string): number => {
  const m = /^(\d{2})\.(\d{4})$/.exec(p);
  return m ? Number(m[2]) * 12 + Number(m[1]) : 0;
};

// One schema list for both the skip branch and the normal path — two hand-kept
// copies would drift exactly on the cold-clone path nobody exercises. 053 must
// precede 059: the pathway-spend functions read nzok_activities.
const applySchemas = async (): Promise<void> => {
  await exec(readFileSync(SCHEMA_FILE, "utf8"));
  await exec(readFileSync(PATHWAY_SPEND_SCHEMA_FILE, "utf8"));
};

const main = async (): Promise<void> => {
  // Absent vs malformed (gaps plan T1.0): activities.json is GITIGNORED, so on
  // a fresh clone it is legitimately missing — apply the schemas and skip, so
  // the &&-chained db:refresh survives. A PRESENT but wrong-shaped file is a
  // real defect and still throws below.
  if (!existsSync(JSON_FILE)) {
    await applySchemas();
    console.warn(
      `[nzok-activities] no ${JSON_FILE} — schemas 053+059 applied, load skipped ` +
        "(regenerate with:  npm run data:nzok -- --activities).",
    );
    await end();
    return;
  }
  const data = JSON.parse(readFileSync(JSON_FILE, "utf8")) as ActivitiesFile;
  if (
    !Array.isArray(data.facilityProcedures) ||
    data.facilityProcedures.length === 0
  )
    throw new Error(
      `${JSON_FILE} has no facilityProcedures[] — shape changed?`,
    );

  // Names + EIKs from the payments file (болнична-помощ; carries the RZOK region,
  // which the region-scoped resolver tiers need) and the МЗ ЕЕОФ financials.
  const payNamed: NamedEik[] = [];
  if (existsSync(PAYMENTS_FILE)) {
    const pay = JSON.parse(readFileSync(PAYMENTS_FILE, "utf8")) as {
      hospitals?: { name: string; eik?: string | null; rzokCode?: string }[];
    };
    for (const h of pay.hospitals ?? [])
      if (h.eik) payNamed.push({ name: h.name, eik: h.eik, rzok: h.rzokCode });
  }

  // МЗ ЕЕОФ financials (latest quarter): a second, МЗ-spelled EIK source AND the
  // only bed-count source. Beds bridge BOTH ways — by EIK (reliable, financials
  // carries eik) and by strongFold (for facilities the eik crosswalk missed).
  const finNamed: NamedEik[] = [];
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
        if (h.eik) finNamed.push({ name: h.name, eik: h.eik });
        if (h.avgMonthlyBeds && h.avgMonthlyBeds > 0) {
          if (!bedsByFold.has(f)) bedsByFold.set(f, h.avgMonthlyBeds);
          if (h.eik && !bedsByEik.has(h.eik))
            bedsByEik.set(h.eik, h.avgMonthlyBeds);
        }
      }
    }
  }

  // The name → EIK resolver: exact fold + region-scoped brand tiers + the curated
  // holdout tables (see ./lib/nzok_activity_eik). Was an exact-fold-only join that
  // matched ~31% of facilities; the tiers lift it to ~80% of cases.
  const resolveEik = buildActivityEikResolver(payNamed, finNamed);

  const yearAnchor = `${data.year}-01-01`;

  // ── 1. Resolve every facility fold to an entity ──────────────────────────
  // The per-period roster is what carries the name a fold billed under in each
  // month. Older activities.json files predate it; fall back to the annual
  // matrix's own (fold, name) pairs so a stale artifact still loads — it just
  // cannot see renames, and the churn assert below will say so.
  const facPeriods: FacilityPeriod[] = data.facilityPeriods ?? [
    ...new Map(
      data.facilityProcedures.map((g) => [
        g.facilityFold,
        {
          facilityFold: g.facilityFold,
          rzok: g.rzok,
          periods: [
            {
              period: `01.${data.year}`,
              facility: g.facility,
              cases: 0,
              zol: 0,
            },
          ],
        },
      ]),
    ).values(),
  ];

  const resolvedByFold = new Map<string, Resolved>();
  for (const fp of facPeriods) {
    const byRecency = [...fp.periods].sort(
      (a, b) => periodRank(b.period) - periodRank(a.period),
    );
    // Try the names newest-first and keep the first that resolves. A rename can
    // land either way round — НЗОК's new ALL-CAPS legal name may be the one the
    // crosswalk knows, or the retired trade name may be. Trying every name the
    // fold ever billed under recovers both directions; the newest name still
    // wins the DISPLAY label regardless of which one matched.
    let eik: string | null = null;
    for (const p of byRecency) {
      eik = resolveEik(p.facility, fp.rzok);
      if (eik) break;
    }
    resolvedByFold.set(fp.facilityFold, {
      fold: fp.facilityFold,
      rzok: fp.rzok,
      eik,
      entityKey: eik ?? `f:${fp.facilityFold}`,
      latestName: byRecency[0].facility,
      latestPeriod: byRecency[0].period,
    });
  }

  // ── 2. Re-aggregate the annual matrix onto (entity_key, procedure) ───────
  // This is the fix: the writer summed 12 months keyed on the NAME, so a
  // renamed hospital arrives as two rows. Summing them here — after identity is
  // known — is what makes one hospital one row, with its beds attached once.
  interface EntityProc {
    entityKey: string;
    r: Resolved;
    procedure: string;
    procType: string;
    cases: number;
    zol: number;
  }
  const entProc = new Map<string, EntityProc>();
  for (const g of data.facilityProcedures) {
    const r = resolvedByFold.get(g.facilityFold);
    if (!r)
      throw new Error(
        `facilityProcedures carries fold "${g.facilityFold}" with no facilityPeriods entry — writer/loader disagree`,
      );
    const key = `${r.entityKey}\x00${g.procedure}`;
    let e = entProc.get(key);
    if (!e)
      entProc.set(
        key,
        (e = {
          entityKey: r.entityKey,
          r,
          procedure: g.procedure,
          procType: g.procType,
          cases: 0,
          zol: 0,
        }),
      );
    e.cases += g.cases;
    e.zol += g.zol;
  }

  // One display label per ENTITY — the name from the latest period ANY of its
  // folds billed in. An entity spans several folds precisely when it was
  // renamed, so picking per fold would surface the retired name half the time.
  const displayByEntity = new Map<string, Resolved>();
  for (const r of resolvedByFold.values()) {
    const cur = displayByEntity.get(r.entityKey);
    if (!cur || periodRank(r.latestPeriod) > periodRank(cur.latestPeriod))
      displayByEntity.set(r.entityKey, r);
  }

  // Every name an entity has ever billed under, newest first — the fold bridge
  // to ЕЕОФ has to try all of them. МЗ spells hospitals its own way and does not
  // follow НЗОК's rename, so a bed count may only be reachable from the RETIRED
  // name; keying beds off the latest name alone silently drops those.
  const namesByEntity = new Map<string, string[]>();
  for (const fp of facPeriods) {
    const r = resolvedByFold.get(fp.facilityFold)!;
    const acc = namesByEntity.get(r.entityKey) ?? [];
    for (const p of fp.periods) acc.push(p.facility);
    namesByEntity.set(r.entityKey, acc);
  }

  // Beds are a per-ENTITY attribute. Attaching them per name-row is what let a
  // renamed hospital carry its full bed count on each of its two halves and so
  // report half its true cases-per-bed, twice, into the same peer median.
  const bedsFor = (entityKey: string, eik: string | null): number | null => {
    const byEik = eik ? bedsByEik.get(eik) : undefined;
    if (byEik != null) return byEik;
    for (const n of namesByEntity.get(entityKey) ?? []) {
      const b = bedsByFold.get(strongFold(n));
      if (b != null) return b;
    }
    return null;
  };

  const actRows: unknown[][] = [...entProc.values()].map((e) => {
    const d = displayByEntity.get(e.entityKey)!;
    return [
      yearAnchor,
      d.rzok,
      d.latestName,
      d.fold,
      d.eik,
      e.entityKey,
      e.procedure,
      e.procType,
      Math.round(e.cases),
      Math.round(e.zol),
      bedsFor(e.entityKey, d.eik),
    ];
  });

  const monthlyRows: unknown[][] = data.monthlyNational.map((m) => [
    monthToDate(m.period),
    Math.round(m.cases),
    Math.round(m.zol),
  ]);

  const facPeriodRows: unknown[][] = facPeriods.flatMap((fp) => {
    const r = resolvedByFold.get(fp.facilityFold)!;
    return fp.periods.map((p) => [
      monthToDate(p.period),
      fp.facilityFold,
      p.facility,
      fp.rzok,
      r.eik,
      r.entityKey,
      Math.round(p.cases),
      Math.round(p.zol),
    ]);
  });

  // ── 3. Name-churn asserts ────────────────────────────────────────────────
  // These are the checks whose absence let the 2025 mid-year rename ship as a
  // silent case split. (a) is diagnostic — it names the entities to curate;
  // (b) is the gate.
  //
  // (a) Any ENTITY whose facility name changes between consecutive periods.
  //
  // The signal is a name that STOPS partway through the year paired with one
  // that STARTS partway through — that is what a rename looks like from here.
  // An entity whose several names all run the FULL year is a different thing:
  // one legal entity billing from several sites (ВМА's Плевен/Варна/Сливен
  // hospitals, МИ МВР's филиали, Фърст Диализис's centres). Those are not
  // renames and must not be reported as such, or the real signal drowns — but
  // they are worth counting, because a spurious one is how a bad crosswalk
  // match shows itself.
  const firstPeriod = [...facPeriods.flatMap((f) => f.periods)].reduce(
    (a, p) => (periodRank(p.period) < periodRank(a) ? p.period : a),
    facPeriods[0]?.periods[0]?.period ?? "",
  );
  const lastPeriod = [...facPeriods.flatMap((f) => f.periods)].reduce(
    (a, p) => (periodRank(p.period) > periodRank(a) ? p.period : a),
    facPeriods[0]?.periods[0]?.period ?? "",
  );

  interface FoldSpan {
    facility: string;
    from: string;
    to: string;
    /** Absent from the corpus's last period — the name was retired. */
    retired: boolean;
    /** Absent from the corpus's first period — the name was introduced. */
    introduced: boolean;
  }
  const spansByEntity = new Map<string, FoldSpan[]>();
  for (const fp of facPeriods) {
    const r = resolvedByFold.get(fp.facilityFold)!;
    const ordered = [...fp.periods].sort(
      (a, b) => periodRank(a.period) - periodRank(b.period),
    );
    const from = ordered[0].period;
    const to = ordered[ordered.length - 1].period;
    spansByEntity.set(r.entityKey, [
      ...(spansByEntity.get(r.entityKey) ?? []),
      {
        facility: ordered[ordered.length - 1].facility,
        from,
        to,
        retired: to !== lastPeriod,
        introduced: from !== firstPeriod,
      },
    ]);
  }

  const renames: {
    entityKey: string;
    eik: string | null;
    spans: FoldSpan[];
  }[] = [];
  let multiSite = 0;
  // UNPAIRED name events — an entity holding a single name that starts or stops
  // mid-year. These are the rename halves the crosswalk did NOT re-unite, and
  // they are the dangerous residue: the ALL-CAPS migration expands acronyms, so
  // a renamed hospital's two names routinely resolve to DIFFERENT entities (one
  // to its EIK, one to nothing) and never meet. "СБАЛО-Хасково ЕООД" retiring
  // while "СПЕЦИАЛИЗИРАНА БОЛНИЦА ЗА АКТИВНО ЛЕЧЕНИЕ ПО ОНКОЛОГИЯ - ХАСКОВО"
  // appears is one hospital, and nothing but this list says so.
  const unpairedOut: FoldSpan[] = [];
  const unpairedIn: FoldSpan[] = [];
  for (const [entityKey, spans] of spansByEntity) {
    if (spans.length < 2) {
      const s = spans[0];
      if (s.retired) unpairedOut.push(s);
      else if (s.introduced) unpairedIn.push(s);
      continue;
    }
    const retired = spans.filter((s) => s.retired);
    const introduced = spans.filter((s) => s.introduced);
    if (retired.length && introduced.length)
      renames.push({
        entityKey,
        eik: entityKey.startsWith("f:") ? null : entityKey,
        spans: spans.sort((a, b) => periodRank(a.from) - periodRank(b.from)),
      });
    else multiSite++;
  }

  // (b) Entity churn — the year's distinct entities against the busiest single
  // period's. Excess above ~1.02 means facilities are entering and leaving the
  // roster mid-year, which for this feed means renames we failed to re-unite.
  const entitiesByPeriod = new Map<string, Set<string>>();
  for (const fp of facPeriods) {
    const r = resolvedByFold.get(fp.facilityFold)!;
    for (const p of fp.periods) {
      let s = entitiesByPeriod.get(p.period);
      if (!s) entitiesByPeriod.set(p.period, (s = new Set()));
      s.add(r.entityKey);
    }
  }
  const annualEntities = new Set(
    [...resolvedByFold.values()].map((r) => r.entityKey),
  ).size;
  const maxPeriodEntities = Math.max(
    1,
    ...[...entitiesByPeriod.values()].map((s) => s.size),
  );
  const churn = annualEntities / maxPeriodEntities;

  const renamedUnmapped = renames.filter((r) => !r.eik).length;
  const short = (s: string): string =>
    s.length > 58 ? `${s.slice(0, 55)}…` : s;
  console.log(
    `Name churn: ${annualEntities} annual entities vs ${maxPeriodEntities} in the busiest period ` +
      `→ ratio ${churn.toFixed(3)} (ceiling ${ENTITY_CHURN_CEILING})\n` +
      `  ${renames.length} entities renamed mid-year and RE-UNITED ` +
      `(${renames.length - renamedUnmapped} by EIK, ${renamedUnmapped} within one unmapped fold)\n` +
      `  ${multiSite} entities bill under several names concurrently (multi-site, not a rename)\n` +
      `  ${unpairedOut.length} names retired + ${unpairedIn.length} introduced mid-year WITHOUT a partner ` +
      `— each is either a genuine opening/closure or an unre-united rename half`,
  );
  for (const r of renames.slice(0, 8)) {
    console.log(`  ${r.eik ?? "(unmapped)"}:`);
    for (const s of r.spans)
      console.log(`      ${s.from}–${s.to}  ${short(s.facility)}`);
  }
  if (renames.length > 8) console.log(`  … and ${renames.length - 8} more`);
  if (unpairedOut.length || unpairedIn.length) {
    console.log(
      `  --- unpaired name events (curate these in scripts/db/lib/nzok_activity_eik.ts) ---`,
    );
    for (const s of unpairedOut.slice(0, 10))
      console.log(`   OUT ${s.from}–${s.to}  ${short(s.facility)}`);
    for (const s of unpairedIn.slice(0, 10))
      console.log(`   IN  ${s.from}–${s.to}  ${short(s.facility)}`);
  }

  if (churn > ENTITY_CHURN_CEILING)
    throw new Error(
      `entity churn ${churn.toFixed(3)} exceeds ${ENTITY_CHURN_CEILING}: ` +
        `${annualEntities} distinct entities across the year but only ${maxPeriodEntities} in the busiest period. ` +
        `НЗОК has likely renamed a batch of facilities mid-year and the crosswalk did not re-unite them, ` +
        `which SPLITS each renamed hospital's cases across two rows. ` +
        `Do NOT raise the ceiling — add curated signatures to scripts/db/lib/nzok_activity_eik.ts ` +
        `for the unmapped chains printed above.`,
    );

  await applySchemas();

  const casesSum = actRows.reduce((a, r) => a + (r[8] as number), 0);
  const matched = actRows.filter((r) => r[4]).length;
  const matchedEntities = new Set(actRows.filter((r) => r[4]).map((r) => r[5]))
    .size;
  const totalEntities = new Set(actRows.map((r) => r[5])).size;
  const bedsEntities = new Set(
    actRows.filter((r) => r[10] != null).map((r) => r[5]),
  ).size;
  // Cases must survive the entity re-key untouched — it regroups rows, never
  // drops them. Checked against the writer's own total.
  const sourceCases = Math.round(data.totals.totalCases);
  if (casesSum !== sourceCases)
    throw new Error(
      `entity re-key changed the case total: ${casesSum} after vs ${sourceCases} in ${JSON_FILE}`,
    );

  await withClient(async (c) => {
    await c.query("BEGIN");
    await c.query("TRUNCATE nzok_activities");
    await c.query("TRUNCATE nzok_activity_monthly");
    await c.query("TRUNCATE nzok_activity_facility_periods");

    await batchInsert(c, "nzok_activities", ACT_COLS, actRows);
    await batchInsert(c, "nzok_activity_monthly", MONTHLY_COLS, monthlyRows);
    await batchInsert(
      c,
      "nzok_activity_facility_periods",
      FAC_PERIOD_COLS,
      facPeriodRows,
    );

    // Post-load reconciliation — row count AND summed cases must agree.
    const { rows: chk } = await c.query<{
      n: number;
      s: string;
      m: number;
      f: number;
      dup: number;
    }>(
      `SELECT
         (SELECT count(*)::int          FROM nzok_activities)        AS n,
         (SELECT sum(cases)::bigint      FROM nzok_activities)        AS s,
         (SELECT count(*)::int          FROM nzok_activity_monthly)  AS m,
         (SELECT count(*)::int   FROM nzok_activity_facility_periods) AS f,
         -- The invariant the whole re-key exists to hold: one row per
         -- (entity, procedure). A second row means an entity was split again.
         (SELECT count(*)::int FROM (
            SELECT 1 FROM nzok_activities
            GROUP BY period, entity_key, procedure HAVING count(*) > 1) d) AS dup`,
    );
    if (
      chk[0].n !== actRows.length ||
      Number(chk[0].s) !== casesSum ||
      chk[0].m !== monthlyRows.length ||
      chk[0].f !== facPeriodRows.length
    )
      throw new Error(
        `post-load mismatch: activities ${chk[0].n}/${chk[0].s} vs ${actRows.length}/${casesSum}; monthly ${chk[0].m} vs ${monthlyRows.length}; facility-periods ${chk[0].f} vs ${facPeriodRows.length}`,
      );
    if (chk[0].dup > 0)
      throw new Error(
        `${chk[0].dup} (entity, procedure) pairs carry more than one row — the entity re-key did not collapse them`,
      );

    // "What changed" changelog — natural key = (year, facility fold, procedure).
    await recordIngestBatch(c, {
      source: "nzok_activities",
      table: "nzok_activities",
      keyExpr:
        "EXTRACT(YEAR FROM t.period)::text || '|' || t.entity_key || '|' || t.procedure",
      nameExpr: "t.facility",
      detailExpr: "t.procedure",
      amountExpr: "t.cases::double precision",
      rowsTotal: actRows.length,
    });

    await c.query("COMMIT");
  });

  // All three tables above were TRUNCATEd and refilled inside that ONE
  // transaction, which leaves relallvisible = 0 permanently — autovacuum fires
  // mid-chain against a held-back xmin horizon, marks nothing, and never revisits
  // (see vacuumAfterReload). Outside the withClient block: VACUUM cannot run in a
  // transaction block, and this one issues its own BEGIN.
  //
  // Latent today. nzok_activities_overview() aggregates broadly enough that no
  // index covers it — measured 1,003 buffers before and 1,002 after, i.e. the
  // plan does not change. Fixed because the state is a trap for the next reader,
  // not because it is costing anything now.
  await vacuumAfterReload(
    "nzok_activities",
    "nzok_activity_monthly",
    "nzok_activity_facility_periods",
  );

  const unmappedCases = actRows
    .filter((r) => !r[4])
    .reduce((a, r) => a + (r[8] as number), 0);
  console.log(
    `Loaded nzok_activities: ${actRows.length.toLocaleString("en")} rows · year ${data.year} · Σ ${casesSum.toLocaleString("en")} cases\n` +
      `Loaded nzok_activity_monthly: ${monthlyRows.length} months\n` +
      `Loaded nzok_activity_facility_periods: ${facPeriodRows.length.toLocaleString("en")} rows\n` +
      `Entity re-key: ${resolvedByFold.size} facility NAMES → ${totalEntities} entities ` +
      `(${resolvedByFold.size - totalEntities} rename halves re-united)\n` +
      `EIK crosswalk: ${matchedEntities}/${totalEntities} entities matched (${matched.toLocaleString("en")} of ${actRows.length.toLocaleString("en")} rows)\n` +
      `Unmapped coverage: ${totalEntities - matchedEntities} entities · ${unmappedCases.toLocaleString("en")} cases ` +
      `(${((unmappedCases / casesSum) * 100).toFixed(1)}% of national volume) — published in the overview's coverage block\n` +
      `Beds crosswalk: ${bedsEntities}/${totalEntities} entities have ЕЕОФ beds (cases-per-bed outlier universe)`,
  );
  await end();
};

main().catch(async (e) => {
  console.error(e);
  await end();
  process.exit(1);
});
