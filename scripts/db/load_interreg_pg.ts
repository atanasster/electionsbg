// Load the committed Interreg corpus into Postgres (schema: 137_interreg.sql),
// resolving each Bulgarian partner to a place on the way in.
//
// Tier T2 of docs/plans/interreg-funds-ingest-v1.md §8.
//
//   npm run funds:crawl-interreg      # keep.eu → raw_data/interreg/ (gitignored)
//   npm run funds:ingest-interreg     # raw cache → data/funds/interreg/ (committed)
//   npm run db:load:interreg:pg       # ← this, committed tree → Postgres
//   npm run db:load:interreg:pg:cloud # the same, against the Cloud SQL proxy
//
// PLACE RESOLUTION HAPPENS HERE, not in the ingest, because Tiers L1/L2 read
// `awarder_seats` and `tr_company_place` out of Postgres — an ingest that
// reached into PG would make the committed tree unreproducible from a fresh
// clone. That is also why this loader must run AFTER both of those tables are
// current: it is their content, not merely their existence, that decides where
// 199 of the 1,469 placed rows land.
//
// STAGE-MERGE, NEVER TRUNCATE. All three tables are on a serving path, and
// `person_reload_locks.data.test.ts` records `load_funds_pg.ts`'s two TRUNCATEs
// as accepted debt — this does not add a third. The merge order is forced by
// the foreign keys: programmes → operations → partners.
//
// THE STAGE IS ALWAYS THE WHOLE CORPUS. `stageDeleteSql` is an unscoped
// anti-join, so a stage built from one programme would delete every other
// programme's operations, ON DELETE CASCADE would take their partners, and
// `mergeFromStage`'s parity guard would PASS because live == staged. `ingest.ts`
// ships a `--programme` flag and refuses to write under it for the same reason;
// this loader has no such flag at all, deliberately.

import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { PoolClient } from "pg";
import { exec, withTx, allRows, end } from "./lib/pg";
import { copyRows, pgTextArray } from "./lib/copy";
import {
  createStageTable,
  addStagePrimaryKey,
  mergeChainFromStage,
  type StageMergeSpec,
} from "./lib/stage_merge";
import { recordIngestBatch } from "./lib/ingest_changelog";
import {
  INTERREG_PROGRAMMES,
  isEligibleNuts,
  programmeByCode,
} from "../funds/interreg/programmes";
import {
  buildPlaceContext,
  resolveAll,
  type PlaceLookups,
  type SeatRow,
} from "../funds/interreg/resolve_place";
import {
  isBulgarianPartner,
  type InterregOperation,
  type InterregPartner,
} from "../funds/interreg/types";
import { readCorpus } from "../funds/interreg/corpus";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SCHEMA_DIR = path.join(ROOT, "scripts/db/schema/pg");
// 005 first: recordIngestBatch writes ingest_batches / ingest_first_seen /
// changelog_days, and without it a COLD database fails with 42P01 after the
// schema, the resolution and all three merges have already run — rolling every
// one of them back. Same shape as load_funds_pg.ts and 13 other loaders.
// 138/139 are SERVING code (functions and a view), not tables — they carry no
// data and no other loader ships them. Applying them here is what keeps the
// "applied, never loaded" family from drifting: without it, a function-body fix
// is invisible to every row count and prod runs the previous body indefinitely.
// 139 must follow 137 (its view reads interreg_partners) and can be applied to
// any database that has fund_payloads, which every funds-serving database does.
const SCHEMA_FILES = [
  "005_ingest_tracking.sql",
  "137_interreg.sql",
  "138_interreg_serving.sql",
  "139_funds_muni_combined.sql",
];

/** Below this the corpus is treated as damaged and nothing is written. Same
 *  discipline (and the same measured basis) as the ingest's own floors. */
const MIN_OPERATIONS = 1_500;
const MIN_PARTNERS = 9_000;
const MIN_BG_PARTNERS = 1_200;

/**
 * Placement floor, enforced at LOAD time and not only in the data test.
 *
 * §9 gate 6 asks for 90% and the measured corpus is 98.4%. The gate lives in
 * `interreg.data.test.ts`, which never runs against Cloud SQL — and the
 * stage-merge SETs the place columns like any other, so a degraded cascade
 * writes NULL over good EKATTEs and `mergeFromStage`'s parity guard passes
 * because it counts ROWS, not places. Measured: empty crosswalks take placed
 * rows 1,469 → 1,270 with the guard green.
 */
const MIN_PLACED_SHARE = 0.9;

const PROGRAMME_SPEC: StageMergeSpec = {
  table: "interreg_programmes",
  source: "interreg_programmes_stage",
  keys: ["code"],
  cols: [
    "code",
    "keep_programme_id",
    "period",
    "name_bg",
    "name_en",
    "keep_title",
    "cci",
    "eligible_nuts",
    "coverage_note",
  ],
};

const OPERATION_SPEC: StageMergeSpec = {
  table: "interreg_operations",
  source: "interreg_operations_stage",
  keys: ["keep_id"],
  cols: [
    "keep_id",
    "operation_id",
    "programme_code",
    "period",
    "title_en",
    "title_lang",
    "title_bg",
    "summary_en",
    "status",
    "start_date",
    "end_date",
    "total_budget_eur",
    "eu_funding_eur",
    "co_financing_rate",
    "partner_count",
    "partner_budget_sum_eur",
    "partner_budget_published_count",
    "countries",
    "source_fetched_at",
  ],
};

const PARTNER_SPEC: StageMergeSpec = {
  table: "interreg_partners",
  source: "interreg_partners_stage",
  keys: ["keep_id", "partner_seq"],
  cols: [
    "keep_id",
    "partner_seq",
    "keep_partnership_id",
    "keep_partner_id",
    "is_lead",
    "country",
    "country_department",
    "partner_name",
    "partner_name_en",
    "eik",
    "pic",
    "org_type",
    "legal_status",
    "budget_eur",
    "eu_funding_eur",
    "budget_basis",
    "location_raw",
    "postcode",
    "lat",
    "lng",
    "ekatte",
    "obshtina",
    "oblast",
    "place_basis",
  ],
};

/**
 * ekatte → the CANONICAL place codes, read from `place_dim` (117).
 *
 * Not from settlements.json, which is where `resolve_place` gets them and where
 * they are raw: гр. Пловдив's row carries `"oblast":"PDV-00"`, a shard code
 * `place_dim` normalises to `PDV` and that `place_dim` itself cannot resolve —
 * 17 partner rows carried it. `place_dim` is also the only source of NUTS3 in
 * Postgres, and it already seeds the two settlements the EKATTE master omits
 * (68134 София, 63183 Рудник), so one read answers all three questions.
 */
interface PlaceDimRow {
  obshtina: string | null;
  oblast: string | null;
  nuts3: string | null;
}
const readPlaceDim = async (): Promise<Map<string, PlaceDimRow>> => {
  await requireRelation("place_dim", "npm run db:load:place-dim:pg");
  const m = new Map<string, PlaceDimRow>();
  for (const r of await allRows<{
    code: string;
    obshtina_code: string | null;
    oblast_code: string | null;
    nuts3: string | null;
  }>(
    `SELECT code, obshtina_code, oblast_code, nuts3
       FROM place_dim WHERE kind = 'settlement'`,
  ))
    m.set(r.code, {
      obshtina: r.obshtina_code,
      oblast: r.oblast_code,
      nuts3: r.nuts3,
    });
  return m;
};

/**
 * Read the two crosswalks, NORMALISING both to settlements.json's vocabulary.
 *
 * They do not agree among themselves: `awarder_seats` has no obshtina column at
 * all and stores the oblast as a NAME ("София (столица)"), while
 * `tr_company_place` stores codes except for Sofia, where it uses SOF46.
 * Passing either through unnormalised puts three vocabularies in one column and
 * splits a GROUP BY — so only the EKATTE is carried across, and the place
 * columns are derived from it by `resolvePlace`, which reads settlements.json.
 */
const requireRelation = async (table: string, cmd: string): Promise<void> => {
  const [row] = await allRows<{ reg: string | null }>(
    `SELECT to_regclass($1)::text AS reg`,
    [table],
  );
  if (!row?.reg)
    throw new Error(
      `interreg: ${table} does not exist — the place cascade would resolve ` +
        `nothing and the merge would write NULL over every placement. ` +
        `Run \`${cmd}\` first. Nothing was written.`,
    );
};

const readLookups = async (): Promise<PlaceLookups> => {
  await requireRelation("awarder_seats", "npm run db:load:awarder-seats:pg");
  await requireRelation(
    "tr_company_place",
    "npm run db:load:tr-company-place:pg",
  );

  const seatByEik = new Map<string, SeatRow>();
  for (const r of await allRows<{ eik: string; ekatte: string }>(
    `SELECT eik, ekatte FROM awarder_seats WHERE ekatte IS NOT NULL`,
  ))
    seatByEik.set(r.eik, { ekatte: r.ekatte });

  const trPlaceByEik = new Map<string, SeatRow>();
  for (const r of await allRows<{ eik: string; ekatte: string }>(
    `SELECT uic AS eik, ekatte FROM tr_company_place WHERE ekatte IS NOT NULL`,
  ))
    trPlaceByEik.set(r.eik, { ekatte: r.ekatte });

  return { seatByEik, trPlaceByEik };
};

const copyProgrammes = async (c: PoolClient): Promise<number> =>
  copyRows(
    c,
    PROGRAMME_SPEC.source,
    PROGRAMME_SPEC.cols,
    INTERREG_PROGRAMMES.map((p) => [
      p.code,
      p.keepProgrammeId,
      p.period,
      p.nameBg,
      p.nameEn,
      p.keepTitle ?? null,
      p.cci ?? null,
      p.eligibleNuts ? pgTextArray(p.eligibleNuts) : null,
      p.coverageNote ?? null,
    ]),
  );

const copyOperations = async (
  c: PoolClient,
  operations: InterregOperation[],
  fetchedAt: string,
): Promise<number> =>
  copyRows(
    c,
    OPERATION_SPEC.source,
    OPERATION_SPEC.cols,
    operations.map((o) => [
      o.keepId,
      o.operationId,
      o.programmeCode,
      o.period,
      o.titleEn,
      o.titleLang,
      o.titleBg,
      o.summaryEn,
      o.status,
      o.startDate,
      o.endDate,
      o.totalBudgetEur,
      o.euFundingEur,
      o.coFinancingRate,
      o.partnerCount,
      o.partnerBudgetSumEur,
      o.partnerBudgetPublishedCount,
      pgTextArray(o.countries),
      // One stamp for the whole corpus, from index.json — the committed tree
      // deliberately carries no per-row timestamp.
      fetchedAt,
    ]),
  );

const EMPTY_DIM: PlaceDimRow = { obshtina: null, oblast: null, nuts3: null };
const dimOf = (dim: Map<string, PlaceDimRow>, ekatte: string): PlaceDimRow =>
  dim.get(ekatte) ?? EMPTY_DIM;

const copyPartners = async (
  c: PoolClient,
  partners: InterregPartner[],
  places: Map<
    string,
    {
      ekatte: string | null;
      obshtina: string | null;
      oblast: string | null;
      placeBasis: string | null;
    }
  >,
  dim: Map<string, PlaceDimRow>,
): Promise<number> =>
  copyRows(
    c,
    PARTNER_SPEC.source,
    PARTNER_SPEC.cols,
    partners.map((p) => {
      const place = places.get(`${p.keepId}:${p.partnerSeq}`);
      return [
        p.keepId,
        p.partnerSeq,
        p.keepPartnershipId,
        p.keepPartnerId,
        p.isLead,
        p.country,
        p.countryDepartment,
        p.partnerName,
        p.partnerNameEn,
        p.eik,
        p.pic,
        p.orgType,
        p.legalStatus,
        p.budgetEur,
        p.euFundingEur,
        p.budgetBasis,
        p.locationRaw,
        p.postcode,
        p.lat,
        p.lng,
        place?.ekatte ?? null,
        // place_dim's codes WIN over the raw settlements.json ones the cascade
        // carried: it is the dimension every other table joins, and it is the
        // only place PDV-00 is normalised to PDV.
        (place?.ekatte ? dimOf(dim, place.ekatte).obshtina : null) ??
          place?.obshtina ??
          null,
        (place?.ekatte ? dimOf(dim, place.ekatte).oblast : null) ??
          place?.oblast ??
          null,
        place?.placeBasis ?? null,
      ];
    }),
  );

/**
 * Plan §8's eligible-area report, and §9 gate 14's consumer.
 *
 * A Bulgarian partner placed outside its own programme's declared eligible area
 * is either a placement error or a keep.eu error, and nothing else in the gate
 * list would notice. REPORTED, never failed: a partner may legitimately sit
 * outside — a national body leading a border project is the common case — so
 * zero is the wrong assertion and an unbounded silence is the wrong tolerance.
 */
const reportEligibleArea = (
  partners: InterregPartner[],
  places: Map<string, { ekatte: string | null; obshtina: string | null }>,
  operations: InterregOperation[],
  nuts3ByEkatte: Map<string, string>,
): void => {
  const programmeOf = new Map(
    operations.map((o) => [o.keepId, o.programmeCode]),
  );
  const off: string[] = [];
  let checked = 0;
  for (const p of partners) {
    const place = places.get(`${p.keepId}:${p.partnerSeq}`);
    if (!place?.ekatte) continue;
    const programme = programmeByCode(programmeOf.get(p.keepId) ?? "");
    // Nationwide programmes declare no area, so there is nothing to be outside.
    if (!programme?.eligibleNuts) continue;
    const nuts = nuts3ByEkatte.get(place.ekatte);
    if (!nuts) continue;
    checked++;
    if (!isEligibleNuts(programme, nuts))
      off.push(`${p.partnerName} (${programme.code}, ${nuts})`);
  }
  if (!checked) return;
  const pct = ((100 * off.length) / checked).toFixed(1);
  console.log(
    `  eligible area: ${off.length}/${checked} placed BG partners of a ` +
      `border programme sit outside its declared NUTS area (${pct}%)`,
  );
  for (const row of off.slice(0, 10)) console.log(`    ${row}`);
  if (off.length > 10) console.log(`    … +${off.length - 10} more`);
};

export const loadInterregPg = async (): Promise<{
  programmes: number;
  operations: number;
  partners: number;
  placed: number;
  bgPartners: number;
}> => {
  for (const f of SCHEMA_FILES)
    await exec(readFileSync(path.join(SCHEMA_DIR, f), "utf8"));

  const { index, operations, partners } = readCorpus();
  const bg = partners.filter(isBulgarianPartner);

  // Floors precede the write, not the read. A damaged committed tree must not
  // reach the stage at all — the merge's anti-join delete would then remove the
  // rows it did not produce, and the parity guard would pass.
  if (operations.length < MIN_OPERATIONS)
    throw new Error(
      `interreg: ${operations.length} operations is below the floor ${MIN_OPERATIONS} — ` +
        `the committed corpus looks damaged. Nothing was written.`,
    );
  if (partners.length < MIN_PARTNERS)
    throw new Error(
      `interreg: ${partners.length} partnerships is below the floor ${MIN_PARTNERS} — ` +
        `the committed corpus looks damaged. Nothing was written.`,
    );
  if (bg.length < MIN_BG_PARTNERS)
    throw new Error(
      `interreg: ${bg.length} Bulgarian partner rows is below the floor ` +
        `${MIN_BG_PARTNERS}. Nothing was written.`,
    );

  // Only Bulgarian rows are resolved: a Romanian partner has no EKATTE by
  // construction, and running the cascade on one could only place it wrongly.
  const lookups = await readLookups();
  const dim = await readPlaceDim();
  const { places, stats } = resolveAll(bg, lookups, buildPlaceContext());
  console.log(
    `interreg: placed ${stats.placed}/${stats.total} Bulgarian partner rows ` +
      `(${((100 * stats.placed) / (stats.total || 1)).toFixed(1)}%) · ` +
      `${stats.geoRejected} geo-rejected · ${stats.geoUncheckable} uncheckable`,
  );
  console.log(`  by basis: ${JSON.stringify(stats.byBasis)}`);
  // REFUSE, do not warn. An empty crosswalk is not a degraded run that is still
  // worth publishing: the merge would write NULL over 199 already-correct Tier L
  // placements and the parity guard would pass.
  if (!lookups.seatByEik.size)
    throw new Error(
      "interreg: awarder_seats is empty — Tier L1 would resolve to nothing and " +
        "the merge would write NULL over every eik:awarder_seats placement. " +
        "Run `npm run db:load:awarder-seats:pg` first. Nothing was written.",
    );
  if (!lookups.trPlaceByEik.size)
    throw new Error(
      "interreg: tr_company_place is empty — Tier L2 would resolve to nothing. " +
        "Run `npm run db:load:tr-company-place:pg` first. Nothing was written.",
    );

  const share = stats.placed / (stats.total || 1);
  if (share < MIN_PLACED_SHARE)
    throw new Error(
      `interreg: placed ${stats.placed}/${stats.total} ` +
        `(${(100 * share).toFixed(1)}%) is below the floor ` +
        `${100 * MIN_PLACED_SHARE}% — the place cascade looks broken, and the ` +
        `merge would write NULL over the rows it can no longer resolve. ` +
        `Nothing was written.`,
    );

  reportEligibleArea(
    bg,
    places,
    operations,
    new Map(
      [...dim].flatMap(([k, v]) => (v.nuts3 ? [[k, v.nuts3] as const] : [])),
    ),
  );

  await withTx(async (c) => {
    // Order is forced by the foreign keys, in both directions: a stage merge
    // that inserted a partner before its operation would violate the FK, and
    // one that deleted an operation before its partners would cascade.
    for (const spec of [PROGRAMME_SPEC, OPERATION_SPEC, PARTNER_SPEC])
      await createStageTable(c, spec);

    await copyProgrammes(c);
    await copyOperations(c, operations, index.fetchedAt);
    await copyPartners(c, partners, places, dim);

    // Parent → child. mergeChainFromStage upserts in this order and deletes in
    // reverse, because the coupled per-table form raises 23503 the first time a
    // programme is retired while its operations are still live.
    const CHAIN = [PROGRAMME_SPEC, OPERATION_SPEC, PARTNER_SPEC];
    for (const spec of CHAIN) await addStagePrimaryKey(c, spec);
    await mergeChainFromStage(c, CHAIN);

    await recordIngestBatch(c, {
      source: "interreg_partner",
      table: "interreg_partners",
      // Stable across reloads: the PK is the natural key here, and both halves
      // are keep.eu's own — `partner_seq` is derived from its partnership id,
      // not from array order.
      keyExpr: "t.keep_id || ':' || t.partner_seq",
      nameExpr: "t.partner_name",
      detailExpr: "t.country",
      amountExpr: "t.budget_eur::double precision",
      rowsTotal: partners.length,
    });

    for (const spec of [PARTNER_SPEC, OPERATION_SPEC, PROGRAMME_SPEC])
      await c.query(`DROP TABLE IF EXISTS ${spec.source}`);
  });

  return {
    programmes: INTERREG_PROGRAMMES.length,
    operations: operations.length,
    partners: partners.length,
    placed: stats.placed,
    bgPartners: bg.length,
  };
};

const isMain =
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "");
if (isMain) {
  const r = await loadInterregPg();
  console.log(
    `interreg: loaded ${r.programmes} programmes, ${r.operations} operations, ` +
      `${r.partners} partnerships (${r.bgPartners} Bulgarian, ${r.placed} placed)`,
  );
  await end();
}
