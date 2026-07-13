// Canonical "hospital awarder" corpus — the reproducible, documented definition
// behind the procurement figures in the НЗОК-in-focus article. It answers the
// gap the article itself flags: the hospital-buyer aggregate was computed from an
// UNDOCUMENTED set (a plain awarder-name pattern gave ~72k, the article printed
// 59,912, and neither was pinned to a stable EIK list).
//
// THE CANONICAL SET (rule, so anyone can rebuild it):
//   a hospital awarder = an EIK that is EITHER
//     (A) a public-procurement awarder whose name matches a hospital token
//         (МБАЛ/УМБАЛ/СБАЛ/КОЦ/болница/диспансер/онкологичен/…), OR
//     (B) a facility НЗОК pays for inpatient care (болнична медицинска помощ) —
//         the verified Рег.№→EIK crosswalk in nzok_hospital_payments.
//   A catches the hospitals that never drew НЗОК БМП money (psychiatric ДПБ,
//   rehab СБР, transport НМТБ, the numbered София hospitals); B catches the ones
//   whose contract-register name doesn't carry a hospital token. The UNION is the
//   most complete set with the least false-positive risk (A has no name-only-
//   "лечебно заведение" matches; B is EIK-exact).
//
// Emits: data/budget/nzok/hospital_awarder_eiks.json — the materialised EIK list
// (so the number is auditable + stable against later name edits) + the rule + the
// headline stats + the as-of date, and prints the figures to paste into the article.
//
// Needs the local Postgres (contracts + nzok_hospital_payments loaded):
//   npx tsx scripts/nzok/hospital_awarder_stats.ts

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, end } from "../db/lib/pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.resolve(
  __dirname,
  "../../data/budget/nzok/hospital_awarder_eiks.json",
);

// The name tokens that mark a лечебно заведение за болнична помощ. Kept in one
// place so the JSON records the exact pattern used.
const NAME_PATTERN =
  "(МБАЛ|УМБАЛ|СБАЛ|СБАГАЛ|СБАЛО|КОЦ|МОБАЛ|УСБАЛ|болниц|hospital|лечебно заведение|диспансер|онкологич)";

const main = async (): Promise<void> => {
  const pool = getPool();

  // The canonical EIK set (A ∪ B).
  const eikRows = await pool.query<{ eik: string }>(
    `SELECT DISTINCT awarder_eik AS eik FROM contracts WHERE awarder_name ~* $1
     UNION
     SELECT DISTINCT eik FROM nzok_hospital_payments WHERE eik IS NOT NULL`,
    [NAME_PATTERN],
  );
  const eiks = eikRows.rows.map((r) => r.eik).sort();

  // Aggregates over the contracts of that set. One round-trip, parameterised on
  // the same EIK list the JSON ships, so the file and the printout can never drift.
  const agg = await pool.query<{
    contracts: string;
    total_eur: string;
    awarders: string;
    c2025: string;
    eur2025: string;
    single2025: string;
    single_eur2025: string;
    bid2025: string;
  }>(
    `WITH c AS (SELECT * FROM contracts WHERE awarder_eik = ANY($1))
     SELECT
       count(*)                                                        AS contracts,
       ROUND(SUM(amount_eur))::bigint                                  AS total_eur,
       count(DISTINCT awarder_eik)                                     AS awarders,
       count(*)             FILTER (WHERE left(date,4)='2025')         AS c2025,
       ROUND(SUM(amount_eur) FILTER (WHERE left(date,4)='2025'))::bigint AS eur2025,
       count(*)             FILTER (WHERE left(date,4)='2025' AND number_of_tenderers=1) AS single2025,
       ROUND(SUM(amount_eur) FILTER (WHERE left(date,4)='2025' AND number_of_tenderers=1))::bigint AS single_eur2025,
       count(*)             FILTER (WHERE left(date,4)='2025' AND number_of_tenderers IS NOT NULL) AS bid2025
     FROM c`,
    [eiks],
  );
  const a = agg.rows[0];

  // 2025 announced procedures (tenders) + КЗК appeals for the same set, so the
  // whole procurement section of the article reproduces from one canonical roster.
  const ten = await pool.query<{ t2025: string; est2025: string }>(
    `SELECT count(*) FILTER (WHERE left(publication_date,4)='2025') AS t2025,
            ROUND(SUM(estimated_value_eur) FILTER (WHERE left(publication_date,4)='2025'))::bigint AS est2025
     FROM tenders WHERE buyer_eik = ANY($1)`,
    [eiks],
  );
  const kzk = await pool.query<{
    total: string;
    upheld: string;
    buyers: string;
  }>(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE outcome='уважена') AS upheld,
            count(DISTINCT buyer_eik) AS buyers
     FROM kzk_appeals WHERE buyer_eik = ANY($1)`,
    [eiks],
  );

  // As-of = the newest contract date in the corpus (so the article can cite it).
  const asOf = await pool.query<{ d: string }>(
    `SELECT max(date) AS d FROM contracts WHERE awarder_eik = ANY($1)`,
    [eiks],
  );

  const n = (v: string) => Number(v);
  const stats = {
    allTime: {
      contracts: n(a.contracts),
      totalEur: n(a.total_eur),
      awardersWithContracts: n(a.awarders),
    },
    y2025: {
      contracts: n(a.c2025),
      awardedEur: n(a.eur2025),
      singleBidder: n(a.single2025),
      singleBidderEur: n(a.single_eur2025),
      // Guard 0/0 (a re-run before any 2025 contract lands, or a future-year
      // re-parameterisation) — NaN would serialize as `null`, poisoning the
      // auditable number this file exists to make stable.
      singleBidderShare: n(a.c2025) ? n(a.single2025) / n(a.c2025) : 0,
      bidCoverage: n(a.c2025) ? n(a.bid2025) / n(a.c2025) : 0,
      tenders: n(ten.rows[0].t2025),
      tendersEstimatedEur: n(ten.rows[0].est2025),
    },
    kzkAppeals: {
      total: n(kzk.rows[0].total),
      upheld: n(kzk.rows[0].upheld),
      buyers: n(kzk.rows[0].buyers),
    },
  };

  const out = {
    generatedAt: new Date().toISOString(),
    asOfContractDate: asOf.rows[0]?.d ?? null,
    definition: {
      rule: "A ∪ B — awarder-name hospital token OR verified НЗОК-paid facility (Рег.№→EIK crosswalk)",
      namePattern: NAME_PATTERN,
      payingSource: "nzok_hospital_payments (crosswalk eik)",
    },
    eikCount: eiks.length,
    stats,
    eiks,
  };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));

  const eur = (v: number) => "€" + (v / 1e9).toFixed(2) + "bn";
  const eurM = (v: number) => "€" + (v / 1e6).toFixed(1) + "M";
  console.log(`Wrote ${OUT_FILE}`);
  console.log(
    `Canonical hospital-awarder set: ${eiks.length} EIKs (as of contract date ${out.asOfContractDate})`,
  );
  console.log(
    `  All-time: ${stats.allTime.contracts.toLocaleString("en")} contracts · ${eur(stats.allTime.totalEur)} · ${stats.allTime.awardersWithContracts} awarders with contracts`,
  );
  console.log(
    `  2025: ${stats.y2025.contracts.toLocaleString("en")} contracts · ${eurM(stats.y2025.awardedEur)} awarded`,
  );
  console.log(
    `  2025 single-bidder: ${stats.y2025.singleBidder.toLocaleString("en")} (${(stats.y2025.singleBidderShare * 100).toFixed(1)}%) · ${eurM(stats.y2025.singleBidderEur)}` +
      ` · bid coverage ${(stats.y2025.bidCoverage * 100).toFixed(2)}%`,
  );
  console.log(
    `  2025 tenders: ${stats.y2025.tenders.toLocaleString("en")} procedures · ${eur(stats.y2025.tendersEstimatedEur)} estimated`,
  );
  console.log(
    `  КЗК appeals: ${stats.kzkAppeals.total} against ${stats.kzkAppeals.buyers} hospital buyers · ${stats.kzkAppeals.upheld} upheld`,
  );
  await end();
};

main().catch(async (e) => {
  console.error(e);
  await end();
  process.exit(1);
});
