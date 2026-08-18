// Build data/culture/oblast.json — the state cultural institutes located by
// oblast, for the /culture regional map. Unlike the film subsidies (producers
// have no EIK — see plan §6), the institutes ARE awarders with EIKs, so their
// oblast comes reliably from awarder_seats and their procurement from contracts.
//
//   npx tsx scripts/culture/build_oblast.ts
//
// Needs Postgres (awarder_seats + contracts_list).
//
// RE-RUN IT WHEN, and none of these is automatic — `data/culture/oblast.json` is
// COMMITTED, so it goes stale in the repo while every input moves underneath it:
//   - kulturaReferenceData.ts gains or reclassifies an EIK (the register gate
//     will tell you; it sweeps the corpus, this does not);
//   - db:load:awarder-seats:pg runs, or CURATED_AWARDER_SEATS changes — that is
//     what puts a body on the map at all, and 9 roll-up members had no seat
//     until 2026-08-18;
//   - the contracts corpus reloads (the € per oblast is summed from it).
// There is no watcher and no db:refresh step for it.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { allRows, getPool } from "../db/lib/pg";
import {
  STATE_CULTURE_INSTITUTE_EIKS,
  ART_SCHOOL_EIKS,
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
}

const main = async () => {
  // Tier B (the МК art schools) is in the map because T0.1's whole point is
  // that those fifteen buyers were invisible to "no roll-up, roster, map or
  // search box" at once — the map is one of the four, so leaving it reading a
  // narrower list than the roll-up would fix three of them and keep this one.
  const eiks = [
    ...STATE_CULTURE_INSTITUTE_EIKS,
    ...ART_SCHOOL_EIKS,
    ...VERIFY_PRINCIPAL_EIKS,
  ];
  const rows = await allRows<Row>(
    `select s.eik,
            s.oblast,
            s.settlement,
            min(cl.awarder_name) as name,
            round(sum(cl.amount_eur)) as eur
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
        "Регистър на обществените поръчки (АОП/ЦАИС ЕОП) — седалища и поръчки",
      description:
        "Културни институции по област: държавни институти (театри, опери, музеи, библиотеки), националните училища по изкуствата на МК и институциите с неизяснен принципал. Седалището идва от адреса на възложителя в ЦАИС ЕОП (или, за малка част, от името му), а не от Търговския регистър — повечето от тях изобщо не са в ТР. Поръчките са от АОП/ЦАИС ЕОП; субсидиите се плащат извън ЗОП.",
    },
    resolvedInstitutes: resolved,
    totalInstitutes: eiks.length,
    // What `instituteCount` counts, stated rather than implied: this file mixes
    // three tiers that the register keeps apart, because a MAP wants everything
    // with a place on it. A consumer that needs the roll-up alone must filter by
    // EIK against CULTURE_GROUP_EIKS rather than trusting these counts.
    tiers: {
      institutes: STATE_CULTURE_INSTITUTE_EIKS.length,
      artSchools: ART_SCHOOL_EIKS.length,
      verifyPrincipal: VERIFY_PRINCIPAL_EIKS.length,
    },
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
