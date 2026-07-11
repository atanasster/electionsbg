// Flood-risk feature — the Tier-A "maintenance-spend" half (docs/plans/
// water-view-v1.md §4.5b). Riverbed-cleaning / river-regulation / dere works are
// already in the procurement corpus; this aggregates them into a small committed
// artifact (data/water/flood_maintenance.json), served static like the judiciary
// data (plan §0b.5) — no new table, no external data. The РЗПРН flood-risk
// geodata half (who is at risk) is a later phase; this shows who spent on
// cleaning and where.
//
// Run: npx tsx scripts/water/write_flood_maintenance.ts

import { writeFileSync, mkdirSync } from "node:fs";
import { allRows, end } from "../db/lib/pg";
import { NAPOITELNI_EIK } from "../../src/lib/vikReferenceData";

// The riverbed-works discriminator: CPV (river regulation / flood-defence works)
// OR title keywords. Kept in one place so every aggregate below counts the same
// corpus. No user input — inline literals are safe.
const WHERE = `tag = 'contract' AND (
  cpv LIKE '45246%' OR cpv LIKE '45247%' OR cpv LIKE '90721%'
  OR title ILIKE '%речно корито%' OR title ILIKE '%речни корита%'
  OR title ILIKE '%проводимост%' OR title ILIKE '%корекция на река%'
  OR title ILIKE '%почистване%дере%'
)`;

interface HeadRow {
  contract_count: string;
  eur: string | null;
  awarder_count: string;
  nap_count: string;
  nap_eur: string | null;
}
interface YearRow {
  year: number;
  eur: string | null;
  count: string;
}
interface AwarderRow {
  eik: string;
  name: string;
  eur: string | null;
  count: string;
}
interface ContractRow {
  key: string;
  title: string | null;
  awarder_eik: string;
  awarder_name: string;
  contractor_name: string | null;
  contractor_eik: string | null;
  eur: string | null;
  date: string | null;
}

const num = (v: string | null): number => Math.round(Number(v ?? 0));

const main = async () => {
  const [head] = await allRows<HeadRow>(`
    SELECT
      count(*)::text AS contract_count,
      round(sum(amount_eur))::bigint::text AS eur,
      count(DISTINCT awarder_eik)::text AS awarder_count,
      count(*) FILTER (WHERE awarder_eik = '${NAPOITELNI_EIK}')::text AS nap_count,
      round(sum(amount_eur) FILTER (WHERE awarder_eik = '${NAPOITELNI_EIK}'))::bigint::text AS nap_eur
    FROM contracts WHERE ${WHERE}`);

  const byYear = await allRows<YearRow>(`
    SELECT left(date, 4)::int AS year,
           round(sum(amount_eur))::bigint::text AS eur,
           count(*)::text AS count
    FROM contracts WHERE ${WHERE} AND date ~ '^[12][0-9]{3}'
    GROUP BY 1 ORDER BY 1`);

  // Deterministic: € desc with an eik tiebreak (plan payload-determinism rule).
  const topAwarders = await allRows<AwarderRow>(`
    SELECT awarder_eik AS eik, min(awarder_name) AS name,
           round(sum(amount_eur))::bigint::text AS eur, count(*)::text AS count
    FROM contracts WHERE ${WHERE}
    GROUP BY awarder_eik
    ORDER BY sum(amount_eur) DESC NULLS LAST, awarder_eik
    LIMIT 15`);

  const topContracts = await allRows<ContractRow>(`
    SELECT key, title, awarder_eik, awarder_name,
           contractor_name, contractor_eik,
           round(amount_eur)::bigint::text AS eur, date
    FROM contracts WHERE ${WHERE}
    ORDER BY amount_eur DESC NULLS LAST, key
    LIMIT 12`);

  const out = {
    // No timestamp from Date.now() to keep the artifact deterministic across
    // rebuilds unless the underlying data changed; the query is the provenance.
    source:
      "АОП/ЦАИС ЕОП — договори за почистване/корекция на речни корита и дерета",
    totalEur: num(head.eur),
    contractCount: Number(head.contract_count),
    awarderCount: Number(head.awarder_count),
    napoitelniEur: num(head.nap_eur),
    napoitelniCount: Number(head.nap_count),
    byYear: byYear.map((y) => ({
      year: y.year,
      eur: num(y.eur),
      count: Number(y.count),
    })),
    topAwarders: topAwarders.map((a) => ({
      eik: a.eik,
      name: a.name,
      eur: num(a.eur),
      count: Number(a.count),
    })),
    topContracts: topContracts.map((c) => ({
      key: c.key,
      title: c.title ?? "",
      awarderEik: c.awarder_eik,
      awarderName: c.awarder_name,
      contractorEik: c.contractor_eik ?? "",
      contractorName: c.contractor_name ?? "",
      eur: num(c.eur),
      date: c.date ?? "",
    })),
  };

  mkdirSync("data/water", { recursive: true });
  writeFileSync(
    "data/water/flood_maintenance.json",
    JSON.stringify(out, null, 2) + "\n",
  );
  console.log(
    `flood_maintenance.json: €${(out.totalEur / 1e6).toFixed(1)}M · ${out.contractCount} contracts · ${out.awarderCount} awarders`,
  );
  await end();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
