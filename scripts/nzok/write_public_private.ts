// Public-vs-private hospital comparison blob — the "Частни болници и
// обществените поръчки" band on the НЗОК pack (data/budget/nzok/public_private.json).
//
// Joins four already-produced inputs into one ~31 KB serving file so the band
// needs a single fetch:
//   • hospital_ownership.json            → state | municipal | private per EIK
//   • hospital_reimbursement_by_eik.json → НЗОК € per EIK (YTD)
//   • hospital_revenue.json              → latest ГФО revenue + nzokShare (private)
//   • Postgres contracts corpus          → tenders run as a ЗОП awarder (last 3y)
//
// The story it powers: private hospitals take ~44% of НЗОК's hospital money and
// most are majority-public-funded, yet ~86% of them run zero public tenders —
// the exemption the European Commission is suing Bulgaria over (Directive
// 2014/24/ЕС). Opt-in (needs the local Postgres for the tender counts), so it
// rides the --revenue step. Run after write_hospital_revenue.ts.
//
//   npm run data:nzok -- --revenue

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getPool, end } from "../db/lib/pg";
import type {
  NzokPublicPrivateFile,
  NzokPublicPrivateHospital,
  NzokOwnership,
} from "../../src/data/budget/types";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const nzok = (f: string) => path.join(REPO, "data/budget/nzok", f);
const YTD_MONTHS = 5; // reimbursement snapshot is Jan–May; annualise for the € framing

const load = <T>(f: string): T =>
  JSON.parse(readFileSync(nzok(f), "utf8")) as T;

/** contracts run as a ЗОП awarder in the last 3 calendar years, per EIK. */
const loadTenders = async (): Promise<Map<string, number>> => {
  const pool = getPool();
  const q = await pool.query<{ eik: string; c3: string }>(`
    SELECT awarder_eik AS eik,
           count(*) FILTER (WHERE left(date, 4) IN ('2023','2024','2025'))::int::text AS c3
    FROM contracts WHERE awarder_eik IS NOT NULL GROUP BY awarder_eik`);
  const m = new Map<string, number>();
  for (const r of q.rows) m.set(r.eik, Number(r.c3));
  return m;
};

const main = async (): Promise<void> => {
  const own = load<{
    entries: { eik: string; name: string; ownership: string }[];
  }>("hospital_ownership.json");
  const reim = load<{
    asOf: string;
    byEik: Record<string, { totalCumulativeEur: number }>;
  }>("hospital_reimbursement_by_eik.json");
  const rev = load<{
    hospitals: Record<
      string,
      { years: Record<string, { revenueEur: number; nzokShare?: number }> }
    >;
  }>("hospital_revenue.json");
  const tenders = await loadTenders();

  const ownByEik = new Map<
    string,
    { ownership: NzokOwnership; name: string }
  >();
  for (const e of own.entries)
    if (e.eik && !ownByEik.has(e.eik))
      ownByEik.set(e.eik, {
        ownership: e.ownership as NzokOwnership,
        name: e.name,
      });

  const ann = (v: number) => Math.round((v * 12) / YTD_MONTHS);
  const agg: Record<NzokOwnership, { count: number; nzokEur: number }> = {
    state: { count: 0, nzokEur: 0 },
    municipal: { count: 0, nzokEur: 0 },
    private: { count: 0, nzokEur: 0 },
  };
  const rows: NzokPublicPrivateHospital[] = [];
  for (const [eik, o] of ownByEik) {
    const nzokEur = reim.byEik[eik]?.totalCumulativeEur ?? 0;
    agg[o.ownership].count++;
    agg[o.ownership].nzokEur += nzokEur;
    if (o.ownership !== "private") continue;
    const h = rev.hospitals[eik];
    let revenueEur: number | null = null;
    let revenueYear: number | null = null;
    let nzokShare: number | null = null;
    if (h) {
      for (const y of ["2024", "2023"]) {
        if (h.years[y]?.nzokShare != null) {
          revenueEur = h.years[y].revenueEur;
          revenueYear = Number(y);
          nzokShare = h.years[y].nzokShare!;
          break;
        }
      }
      if (nzokShare == null) {
        const ys = Object.keys(h.years)
          .filter((y) => h.years[y].revenueEur)
          .sort();
        if (ys.length) {
          revenueEur = h.years[ys[ys.length - 1]].revenueEur;
          revenueYear = Number(ys[ys.length - 1]);
        }
      }
    }
    rows.push({
      eik,
      name: o.name,
      nzokEur,
      nzokAnnualEur: ann(nzokEur),
      revenueEur,
      revenueYear,
      nzokShare,
      tenders3y: tenders.get(eik) ?? 0,
    });
  }
  rows.sort((a, b) => b.nzokEur - a.nzokEur);

  const withShare = rows.filter((r) => r.nzokShare != null);
  const over50 = withShare.filter((r) => r.nzokShare! > 0.5);
  const over50NoTender = over50.filter((r) => r.tenders3y === 0);
  const shares = withShare.map((r) => r.nzokShare!).sort((a, b) => a - b);
  const totalNzok = (["state", "municipal", "private"] as const).reduce(
    (s, k) => s + agg[k].nzokEur,
    0,
  );
  const pctOf = (v: number) => Math.round((1000 * v) / totalNzok) / 10;

  const out: NzokPublicPrivateFile = {
    generatedAt: new Date().toISOString(),
    asOf: reim.asOf,
    ytdMonths: YTD_MONTHS,
    source: {
      note: "Съпоставка държавни/общински/частни болници: НЗОК плащания (hospital_reimbursement_by_eik) + собственост (hospital_ownership) + приход по ГФО (hospital_revenue) + брой процедури като възложител (корпус на поръчките, посл. 3 г.). nzokShare = НЗОК ÷ приход за същата година (2023+).",
    },
    ownership: {
      state: { ...agg.state, sharePct: pctOf(agg.state.nzokEur) },
      municipal: { ...agg.municipal, sharePct: pctOf(agg.municipal.nzokEur) },
      private: { ...agg.private, sharePct: pctOf(agg.private.nzokEur) },
    },
    privateStats: {
      total: rows.length,
      withShare: withShare.length,
      over50: over50.length,
      over50Pct: Math.round((100 * over50.length) / withShare.length),
      medianSharePct: Math.round(100 * shares[Math.floor(shares.length / 2)]),
      zeroTender: rows.filter((r) => r.tenders3y === 0).length,
      over50NoTender: over50NoTender.length,
      over50NoTenderAnnualEur: over50NoTender.reduce(
        (s, r) => s + r.nzokAnnualEur,
        0,
      ),
      belowThreshold: withShare.length - over50.length,
      over50WithTender: over50.length - over50NoTender.length,
    },
    hospitals: rows,
  };
  writeFileSync(nzok("public_private.json"), JSON.stringify(out, null, 1));
  await end();
  console.log(
    `Wrote ${nzok("public_private.json")}\n  ownership: state ${out.ownership.state.sharePct}% · municipal ${out.ownership.municipal.sharePct}% · private ${out.ownership.private.sharePct}%\n  private: ${out.privateStats.over50Pct}% over 50% (median ${out.privateStats.medianSharePct}%) · ${out.privateStats.zeroTender}/${out.privateStats.total} zero-tender · ${out.privateStats.over50NoTender} over-50%-no-tender`,
  );
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
