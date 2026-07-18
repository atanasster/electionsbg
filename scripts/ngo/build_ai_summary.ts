// Build the compact AI-facing NGO summary the chat tools read
// (data/ngo/ai_summary.json). This is NOT a serving twin of the DB — the site
// pages (/company/:eik, /procurement/ngos) serve live from Postgres. It is a
// small aggregate (counts + top-20 lists, a few KB) so the browser AI assistant
// — which reads static JSON, not /api/db — can answer NGO overview questions.
//
//   npm run ngo:ai-summary   (needs the local Postgres up + loaded)
//
// See docs/plans/ngo-final-implementation-plan.md.

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getPool, end } from "../db/lib/pg";

const OUT = fileURLToPath(
  new URL("../../data/ngo/ai_summary.json", import.meta.url),
);

const q = async <T>(sql: string): Promise<T[]> =>
  (await getPool().query(sql)).rows as T[];

const tableExists = async (name: string): Promise<boolean> =>
  (await getPool().query("SELECT to_regclass($1) AS t", [`public.${name}`]))
    .rows[0]?.t != null;

export const buildNgoAiSummary = async (): Promise<{ path: string }> => {
  // Only tr_companies is a hard requirement (the NGO surface itself). The other
  // sources may be absent on a partial DB (e.g. a TR-only load) — each section
  // below is gated so the summary regenerates on any DB state instead of throwing.
  if (!(await tableExists("tr_companies")))
    throw new Error(
      "[ngo:ai-summary] tr_companies missing — load the TR data first.",
    );
  const hasFunding = await tableExists("ngo_funding");
  const hasContracts = await tableExists("contracts");
  const hasFunds = await tableExists("fund_projects");
  const hasKindex = await tableExists("awarder_kindex_ranking");
  const hasSignals = await tableExists("ngo_signals");

  const [ngoCount] = await q<{ ngos: number }>(
    `SELECT count(*)::int AS ngos FROM tr_companies
     WHERE entity_class IN ('ngo_assoc','ngo_found','chitalishte')`,
  );
  const byType = await q<{ ngo_type: string; count: number }>(
    `SELECT ngo_type, count(*)::int AS count FROM tr_companies
     WHERE ngo_type IS NOT NULL GROUP BY ngo_type ORDER BY count DESC`,
  );
  const byClass = await q<{ entity_class: string; count: number }>(
    `SELECT entity_class, count(*)::int AS count FROM tr_companies
     WHERE entity_class IN ('ngo_assoc','ngo_found','chitalishte','foreign_branch','coop')
     GROUP BY entity_class ORDER BY count DESC`,
  );

  // Public-money touch = distinct NGO EIKs appearing as a contractor and/or an
  // EU-funds beneficiary — over whichever of those two tables exist.
  const publicMoneyParts: string[] = [];
  if (hasContracts)
    publicMoneyParts.push(
      "SELECT contractor_eik AS eik FROM contracts WHERE tag='contract'",
    );
  if (hasFunds)
    publicMoneyParts.push("SELECT beneficiary_eik FROM fund_projects");
  const touchingPublicMoney = publicMoneyParts.length
    ? (
        await q<{ n: number }>(`
          SELECT count(DISTINCT eik)::int AS n FROM (${publicMoneyParts.join(" UNION ")}) x
          WHERE eik IN (SELECT uic FROM tr_companies
                        WHERE entity_class IN ('ngo_assoc','ngo_found','chitalishte'))`)
      )[0].n
    : 0;

  const contractsEur = hasContracts
    ? Number(
        (
          await q<{ eur: number }>(`
            SELECT COALESCE(ROUND(SUM(c.amount_eur)),0) AS eur FROM contracts c
              JOIN tr_companies t ON t.uic=c.contractor_eik
             WHERE c.tag='contract' AND t.entity_class IN ('ngo_assoc','ngo_found','chitalishte')`)
        )[0].eur,
      )
    : 0;

  const externalFundingEur = hasFunding
    ? Number(
        (
          await q<{ eur: number }>(
            "SELECT COALESCE(ROUND(SUM(amount_eur)),0) AS eur FROM ngo_funding WHERE eik IS NOT NULL",
          )
        )[0].eur,
      )
    : 0;
  const fundingBySource = hasFunding
    ? await q<{ source: string; eur: number; n: number }>(
        `SELECT source, ROUND(SUM(amount_eur)) AS eur, count(DISTINCT eik)::int AS n
         FROM ngo_funding WHERE eik IS NOT NULL GROUP BY source ORDER BY eur DESC`,
      )
    : [];
  const topFunded = hasFunding
    ? await q<{ eik: string; name: string; eur: number; sources: string }>(`
        SELECT f.eik, MIN(c.name) AS name, ROUND(SUM(f.amount_eur)) AS eur,
               string_agg(DISTINCT f.source, ',') AS sources
        FROM ngo_funding f JOIN tr_companies c ON c.uic=f.eik
        WHERE f.eik IS NOT NULL
        GROUP BY f.eik ORDER BY eur DESC NULLS LAST LIMIT 20`)
    : [];
  const topKindex = hasKindex
    ? await q<{
        eik: string;
        name: string;
        share_pct: number;
        linked_eur: number;
        linked_supplier_count: number;
      }>(`
        SELECT eik, name, share_pct, linked_eur, linked_supplier_count
        FROM awarder_kindex_ranking
        WHERE total_eur >= 1000000
        ORDER BY share_pct DESC, linked_eur DESC LIMIT 20`)
    : [];

  // Signal distribution + top NGOs per signal (migration 080). Kept compact:
  // per-code counts + the top-10 NGOs per code (by valueEur where the signal
  // carries one). Feeds ngoRiskSignals / ngoBySignal + the ngoOverview strip.
  const [signalTotals] = hasSignals
    ? await q<{ with_signal: number; total: number }>(
        `SELECT count(*) FILTER (WHERE signal_count > 0)::int AS with_signal,
                count(*)::int AS total FROM ngo_signals`,
      )
    : [{ with_signal: 0, total: 0 }];
  const signalByCode = hasSignals
    ? await q<{ code: string; count: number }>(
        `SELECT unnest(string_to_array(signal_codes, ' ')) AS code, count(*)::int AS count
         FROM ngo_signals WHERE signal_codes <> '' GROUP BY code ORDER BY count DESC`,
      )
    : [];
  const topBySignalRows = hasSignals
    ? await q<{ code: string; eik: string; name: string; eur: number | null }>(`
        WITH s AS (
          SELECT e.eik, sig->>'code' AS code, (sig->>'valueEur')::numeric AS eur
          FROM ngo_signals e, jsonb_array_elements(e.signals) sig
        ),
        ranked AS (
          SELECT s.code, s.eik, MIN(c.name) AS name, MAX(s.eur) AS eur,
                 row_number() OVER (PARTITION BY s.code
                                    ORDER BY MAX(s.eur) DESC NULLS LAST, s.eik) AS rn
          FROM s JOIN tr_companies c ON c.uic = s.eik
          GROUP BY s.code, s.eik
        )
        SELECT code, eik, name, eur FROM ranked WHERE rn <= 10 ORDER BY code, rn`)
    : [];
  const topBySignal: Record<
    string,
    { eik: string; name: string; eur: number | null }[]
  > = {};
  for (const r of topBySignalRows) {
    (topBySignal[r.code] ??= []).push({
      eik: r.eik,
      name: r.name,
      eur: r.eur != null ? Number(r.eur) : null,
    });
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    signals: {
      withSignal: signalTotals.with_signal,
      surface: signalTotals.total,
      byCode: signalByCode.map((r) => ({ code: r.code, count: r.count })),
      topByCode: topBySignal,
    },
    totals: {
      ngos: ngoCount.ngos,
      touchingPublicMoney,
      externalFundingEur,
      contractsEur,
    },
    byType,
    byClass,
    fundingBySource: fundingBySource.map((r) => ({
      source: r.source,
      eur: Number(r.eur),
      ngos: r.n,
    })),
    topFunded: topFunded.map((r) => ({
      eik: r.eik,
      name: r.name,
      eur: Number(r.eur),
      sources: r.sources.split(","),
    })),
    topKindexAwarders: topKindex.map((r) => ({
      eik: r.eik,
      name: r.name,
      sharePct: Number(r.share_pct),
      linkedEur: Number(r.linked_eur),
      linkedSuppliers: r.linked_supplier_count,
    })),
  };

  mkdirSync(fileURLToPath(new URL("../../data/ngo", import.meta.url)), {
    recursive: true,
  });
  writeFileSync(OUT, JSON.stringify(summary, null, 2));
  return { path: OUT };
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  buildNgoAiSummary()
    .then(async ({ path }) => {
      console.log(`wrote ${path}`);
      await end();
    })
    .catch(async (e) => {
      console.error(e);
      await end();
      process.exit(1);
    });
}
