// Build data/culture/oblast.json — the state cultural institutes located by
// oblast, for the /culture regional map. Unlike the film subsidies (producers
// have no EIK — see plan §6), the institutes ARE awarders with EIKs, so their
// oblast comes reliably from awarder_seats and their procurement from contracts.
//
//   npx tsx scripts/culture/build_oblast.ts
//
// Needs Postgres (awarder_seats + contracts_list). Stable output — the institute
// allowlist rarely changes — so it's a one-off enrichment, separate from the
// offline film ingest.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { allRows, getPool } from "../db/lib/pg";
import {
  STATE_CULTURE_INSTITUTE_EIKS,
  VERIFY_PRINCIPAL_EIKS,
} from "../../src/lib/kulturaReferenceData";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT = path.resolve(__dirname, "../../data/culture/oblast.json");

interface Row {
  eik: string;
  oblast: string | null;
  settlement: string | null;
  name: string | null;
  eur: string | null;
  n: string | null;
}

const main = async () => {
  const eiks = [...STATE_CULTURE_INSTITUTE_EIKS, ...VERIFY_PRINCIPAL_EIKS];
  const rows = await allRows<Row>(
    `select s.eik,
            s.oblast,
            s.settlement,
            min(cl.awarder_name) as name,
            round(sum(cl.amount_eur)) as eur,
            count(cl.*) as n
       from awarder_seats s
       left join contracts_list cl
         on cl.awarder_eik = s.eik and cl.tag = 'contract'
      where s.eik = any($1)
      group by s.eik, s.oblast, s.settlement`,
    [eiks],
  );

  // Aggregate by oblast name (the frontend maps the name → canon via
  // provinceToCanon, the same helper the procurement map uses).
  const byOblast = new Map<
    string,
    {
      oblast: string;
      instituteCount: number;
      procurementEur: number;
      institutes: {
        eik: string;
        name: string;
        settlement: string;
        eur: number;
      }[];
    }
  >();
  let resolved = 0;
  for (const r of rows) {
    if (!r.oblast) continue;
    resolved += 1;
    const eur = r.eur ? Number(r.eur) : 0;
    const o = byOblast.get(r.oblast) ?? {
      oblast: r.oblast,
      instituteCount: 0,
      procurementEur: 0,
      institutes: [],
    };
    o.instituteCount += 1;
    o.procurementEur += eur;
    o.institutes.push({
      eik: r.eik,
      name: (r.name ?? r.eik).replace(/\s*\/.*$/, "").trim(),
      settlement: r.settlement ?? "",
      eur,
    });
    byOblast.set(r.oblast, o);
  }

  const oblasts = [...byOblast.values()]
    .map((o) => ({
      ...o,
      institutes: o.institutes.sort((a, b) => b.eur - a.eur),
    }))
    .sort(
      (a, b) =>
        b.instituteCount - a.instituteCount ||
        b.procurementEur - a.procurementEur,
    );

  const out = {
    generatedAt: new Date().toISOString(),
    source: {
      publisher:
        "Търговски регистър (седалище) + регистър на обществените поръчки (АОП/ЦАИС ЕОП)",
      description:
        "Държавни културни институти (театри, опери, музеи, библиотеки) по област, локализирани по седалище от ТР; обществените им поръчки — от АОП/ЦАИС ЕОП. Субсидиите се плащат извън ЗОП.",
    },
    resolvedInstitutes: resolved,
    totalInstitutes: eiks.length,
    oblasts,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `✓ ${resolved}/${eiks.length} institutes located · ${oblasts.length} oblasts · → data/culture/oblast.json`,
  );
  oblasts.forEach((o) =>
    console.log(
      `  ${o.oblast.padEnd(18)} ${o.instituteCount} institutes · €${(o.procurementEur / 1e6).toFixed(2)}M`,
    ),
  );
  await getPool().end();
};

main().catch((e) => {
  console.error("culture oblast build failed:", e);
  process.exit(1);
});
