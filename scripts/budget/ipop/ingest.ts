// Ingest for the МРРБ IPOP (Инвестиционна програма за общински проекти)
// execution-status feed. This is the nationwide companion to the PLAN
// data already in data/budget/investment_program/{year}.json (which is
// parsed from Приложение III to ЗДБРБ): same OP-YY.NNN-NNNN project IDs,
// but here every project carries paid/submitted/pending amounts.
//
// Source: https://ipop.mrrb.bg/reports_projects_export.php
//   — a UTF-8 BOM CSV with semicolon delimiters, EU decimal separators
//     (`1234567,89` with optional NBSP grouping). 264 municipalities,
//     3492 projects, ~€2.98B committed, ~€991M paid (~33% execution as
//     of late May 2026).
//
// Emits:
//   data/budget/ipop/{fiscalYear}.json
//     — national summary + per-município index (totals, project count,
//       execution percentage, flagged-stalled count). Smaller, ~80 KB.
//   data/budget/ipop/municipalities/{obshtinaCode}.json (one per muni)
//     — full project list + execution rollup for that município.
//     Each file is tiny (~5-50 KB depending on project count).
//
// Stalled-project flag (the heuristic that surfaces stuck spending):
//   agreement_value >= EUR 100k AND paid_pct < 5%.
//
// Run: tsx scripts/budget/ipop/ingest.ts [--year 2025]

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// CSV oblast name (Cyrillic) → our 3-letter oblast code.
const OBLAST_NAME_TO_CODE: Record<string, string> = {
  Благоевград: "BLG",
  Бургас: "BGS",
  Варна: "VAR",
  "Велико Търново": "VTR",
  Видин: "VID",
  Враца: "VRC",
  Габрово: "GAB",
  Добрич: "DOB",
  Кърджали: "KRZ",
  Кюстендил: "KNL",
  Ловеч: "LOV",
  Монтана: "MON",
  Пазарджик: "PAZ",
  Перник: "PER",
  Плевен: "PVN",
  Пловдив: "PDV",
  Разград: "RAZ",
  Русе: "RSE",
  Силистра: "SLS",
  Сливен: "SLV",
  Смолян: "SML",
  "София град": "SOF",
  "София област": "SFO",
  "Стара Загора": "SZR",
  Търговище: "TGV",
  Хасково: "HKV",
  Шумен: "SHU",
  Ямбол: "JAM",
};

// (oblast_code, csv_muni_name) → obshtina code overrides for CSV ↔
// data/municipalities.json name mismatches (mostly capitalization or
// hyphen/space differences).
const MUNI_NAME_OVERRIDES: Record<string, string> = {
  // Sofia capital — single синтетична muni for IPOP purposes (our
  // data/municipalities.json splits Stolichna into 24 раиони under
  // S23/S24/S25; IPOP treats it as one entity, so we mirror that).
  "SOF|Столична": "SOF22",
  // Plovdiv city special code in our data.
  "PDV|Пловдив": "PDV-00",
  // Spelling / case fixes.
  "DOB|Добричка": "DOB15", // Добрич-селска
  "SFO|Долна Баня": "SFO59", // Долна баня (lowercase б)
  "VAR|Вълчидол": "VAR09", // Вълчи дол
  "VAR|Долни Чифлик": "VAR13", // Долни чифлик
};

const STALLED_MIN_AGREEMENT_EUR = 100_000;
const STALLED_MAX_PAID_PCT = 5;

interface CsvRow {
  oblastName: string;
  muniName: string;
  projectId: string;
  description: string;
  agreementEur: number;
  submittedEur: number;
  awaitingEur: number;
  paidEur: number;
  mrrbPaidEur: number;
  bbrPaidEur: number;
}

interface IpopProject {
  id: string; // "OP-YY.NNN-NNNN"
  description: string;
  oblastCode: string;
  oblastName: string;
  obshtinaCode: string;
  municipalityName: string;
  agreementEur: number;
  submittedEur: number;
  awaitingEur: number;
  paidEur: number;
  mrrbPaidEur: number;
  bbrPaidEur: number;
  paidPct: number; // 0..100; 0 when agreement <= 0
  stalled: boolean;
}

interface IpopMunicipalityRollup {
  obshtinaCode: string;
  municipalityName: string;
  oblastCode: string;
  oblastName: string;
  projectCount: number;
  stalledCount: number;
  agreementEur: number;
  submittedEur: number;
  awaitingEur: number;
  paidEur: number;
  mrrbPaidEur: number;
  bbrPaidEur: number;
  paidPct: number;
}

interface IpopMunicipalityFile {
  fiscalYear: number;
  generatedAt: string;
  obshtinaCode: string;
  municipalityName: string;
  oblastCode: string;
  oblastName: string;
  rollup: IpopMunicipalityRollup;
  projects: IpopProject[]; // sorted by agreementEur DESC
}

interface IpopNationalFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
  };
  totals: {
    projectCount: number;
    municipalityCount: number;
    oblastCount: number;
    stalledCount: number;
    agreementEur: number;
    submittedEur: number;
    awaitingEur: number;
    paidEur: number;
    mrrbPaidEur: number;
    bbrPaidEur: number;
    paidPct: number;
  };
  byMunicipality: IpopMunicipalityRollup[]; // sorted by agreementEur DESC
  byOblast: Array<{
    oblastCode: string;
    oblastName: string;
    municipalityCount: number;
    projectCount: number;
    stalledCount: number;
    agreementEur: number;
    paidEur: number;
    paidPct: number;
  }>;
}

// EU number parser: handles "1234567,89" or "1 234 567,89" (NBSP spaces).
const parseEur = (s: string): number => {
  if (!s) return 0;
  const cleaned = s.replace(/[\s\u00A0]/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
};

// Stateful CSV parser that handles embedded newlines inside quoted
// fields (the IPOP export quotes descriptions with internal `\n` and
// escapes `"` as `""`; a naive line-split breaks ~50 rows out of 3492).
const parseCsv = (text: string): CsvRow[] => {
  // Strip UTF-8 BOM (U+FEFF)
  const cleaned = text.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let cur = "";
  let row: string[] = [];
  let inQuote = false;
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inQuote) {
      if (c === '"') {
        if (cleaned[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuote = true;
    } else if (c === ";") {
      row.push(cur);
      cur = "";
    } else if (c === "\n" || c === "\r") {
      // End of record (only outside a quote). Squash CRLF.
      if (c === "\r" && cleaned[i + 1] === "\n") i++;
      row.push(cur);
      if (row.some((f) => f !== "")) records.push(row);
      row = [];
      cur = "";
    } else {
      cur += c;
    }
  }
  if (cur !== "" || row.length > 0) {
    row.push(cur);
    if (row.some((f) => f !== "")) records.push(row);
  }

  // First record is the header.
  const rows: CsvRow[] = [];
  for (let i = 1; i < records.length; i++) {
    const cols = records[i];
    if (cols.length < 10) continue;
    rows.push({
      oblastName: cols[0],
      muniName: cols[1],
      projectId: cols[2],
      description: cols[3],
      agreementEur: parseEur(cols[4]),
      submittedEur: parseEur(cols[5]),
      awaitingEur: parseEur(cols[6]),
      paidEur: parseEur(cols[7]),
      mrrbPaidEur: parseEur(cols[8]),
      bbrPaidEur: parseEur(cols[9]),
    });
  }
  return rows;
};

interface MunicipalityLookup {
  code: string;
  name: string;
}
type MuniData = Array<{ obshtina: string; name: string; oblast: string }>;

const buildMuniLookup = (muniData: MuniData) => {
  const byOblastName: Record<string, Record<string, MunicipalityLookup>> = {};
  for (const m of muniData) {
    byOblastName[m.oblast] ??= {};
    byOblastName[m.oblast][m.name] = { code: m.obshtina, name: m.name };
  }
  return byOblastName;
};

const resolveObshtinaCode = (
  oblastCode: string,
  muniName: string,
  lookup: ReturnType<typeof buildMuniLookup>,
): { code: string; name: string } | null => {
  const overrideKey = `${oblastCode}|${muniName}`;
  if (MUNI_NAME_OVERRIDES[overrideKey]) {
    return { code: MUNI_NAME_OVERRIDES[overrideKey], name: muniName };
  }
  const hit = lookup[oblastCode]?.[muniName];
  if (hit) return hit;
  return null;
};

const main = () => {
  const args = process.argv.slice(2);
  const yearIdx = args.indexOf("--year");
  const fiscalYear = yearIdx >= 0 ? Number(args[yearIdx + 1]) : 2025;

  const csvPath = resolve(
    __dirname,
    "../../../raw_data/budget/ipop",
    `projects-${fiscalYear}.csv`,
  );
  if (!existsSync(csvPath)) {
    throw new Error(
      `Missing source CSV at ${csvPath} — download from ipop.mrrb.bg first`,
    );
  }
  console.log(`[ipop] reading ${csvPath}`);

  const csv = readFileSync(csvPath, "utf-8");
  const rows = parseCsv(csv);
  console.log(`[ipop] parsed ${rows.length} CSV rows`);

  const muniDataPath = resolve(__dirname, "../../../data/municipalities.json");
  const muniData = JSON.parse(readFileSync(muniDataPath, "utf-8")) as MuniData;
  const lookup = buildMuniLookup(muniData);

  // Build per-project entries with resolved obshtina codes.
  const projects: IpopProject[] = [];
  const unresolved: Array<{ oblast: string; muni: string }> = [];
  for (const r of rows) {
    const oblastCode = OBLAST_NAME_TO_CODE[r.oblastName];
    if (!oblastCode) {
      unresolved.push({ oblast: r.oblastName, muni: r.muniName });
      continue;
    }
    const m = resolveObshtinaCode(oblastCode, r.muniName, lookup);
    if (!m) {
      unresolved.push({ oblast: r.oblastName, muni: r.muniName });
      continue;
    }
    const paidPct =
      r.agreementEur > 0
        ? Number(((100 * r.paidEur) / r.agreementEur).toFixed(2))
        : 0;
    const stalled =
      r.agreementEur >= STALLED_MIN_AGREEMENT_EUR &&
      paidPct < STALLED_MAX_PAID_PCT;
    projects.push({
      id: r.projectId,
      description: r.description,
      oblastCode,
      oblastName: r.oblastName,
      obshtinaCode: m.code,
      municipalityName: m.name,
      agreementEur: r.agreementEur,
      submittedEur: r.submittedEur,
      awaitingEur: r.awaitingEur,
      paidEur: r.paidEur,
      mrrbPaidEur: r.mrrbPaidEur,
      bbrPaidEur: r.bbrPaidEur,
      paidPct,
      stalled,
    });
  }
  console.log(`[ipop] resolved ${projects.length} projects`);
  if (unresolved.length > 0) {
    console.log(
      `[ipop] WARN unresolved ${unresolved.length} rows:`,
      [...new Set(unresolved.map((u) => `${u.oblast}|${u.muni}`))].slice(0, 10),
    );
  }

  // Per-município rollups
  const byMuniMap = new Map<
    string,
    {
      obshtinaCode: string;
      municipalityName: string;
      oblastCode: string;
      oblastName: string;
      projects: IpopProject[];
    }
  >();
  for (const p of projects) {
    let agg = byMuniMap.get(p.obshtinaCode);
    if (!agg) {
      agg = {
        obshtinaCode: p.obshtinaCode,
        municipalityName: p.municipalityName,
        oblastCode: p.oblastCode,
        oblastName: p.oblastName,
        projects: [],
      };
      byMuniMap.set(p.obshtinaCode, agg);
    }
    agg.projects.push(p);
  }

  const buildRollup = (
    obshtinaCode: string,
    municipalityName: string,
    oblastCode: string,
    oblastName: string,
    list: IpopProject[],
  ): IpopMunicipalityRollup => {
    const sum = (k: keyof IpopProject) =>
      list.reduce(
        (s, p) => s + (typeof p[k] === "number" ? (p[k] as number) : 0),
        0,
      );
    const agreement = sum("agreementEur");
    const paid = sum("paidEur");
    return {
      obshtinaCode,
      municipalityName,
      oblastCode,
      oblastName,
      projectCount: list.length,
      stalledCount: list.filter((p) => p.stalled).length,
      agreementEur: agreement,
      submittedEur: sum("submittedEur"),
      awaitingEur: sum("awaitingEur"),
      paidEur: paid,
      mrrbPaidEur: sum("mrrbPaidEur"),
      bbrPaidEur: sum("bbrPaidEur"),
      paidPct:
        agreement > 0 ? Number(((100 * paid) / agreement).toFixed(2)) : 0,
    };
  };

  // Per-município shard files
  const muniDir = resolve(
    __dirname,
    "../../../data/budget/ipop",
    "municipalities",
  );
  if (existsSync(muniDir)) {
    rmSync(muniDir, { recursive: true, force: true });
  }
  mkdirSync(muniDir, { recursive: true });

  const byMunicipality: IpopMunicipalityRollup[] = [];
  for (const agg of byMuniMap.values()) {
    const rollup = buildRollup(
      agg.obshtinaCode,
      agg.municipalityName,
      agg.oblastCode,
      agg.oblastName,
      agg.projects,
    );
    byMunicipality.push(rollup);
    const shard: IpopMunicipalityFile = {
      fiscalYear,
      generatedAt: new Date().toISOString(),
      obshtinaCode: agg.obshtinaCode,
      municipalityName: agg.municipalityName,
      oblastCode: agg.oblastCode,
      oblastName: agg.oblastName,
      rollup,
      projects: agg.projects
        .slice()
        .sort((a, b) => b.agreementEur - a.agreementEur),
    };
    writeFileSync(
      resolve(muniDir, `${agg.obshtinaCode}.json`),
      JSON.stringify(shard, null, 2) + "\n",
      "utf-8",
    );
  }
  byMunicipality.sort((a, b) => b.agreementEur - a.agreementEur);
  console.log(`[ipop] wrote ${byMunicipality.length} municipality shards`);

  // Per-oblast aggregates
  const oblastMap = new Map<
    string,
    {
      oblastCode: string;
      oblastName: string;
      munis: Set<string>;
      projects: IpopProject[];
    }
  >();
  for (const p of projects) {
    let agg = oblastMap.get(p.oblastCode);
    if (!agg) {
      agg = {
        oblastCode: p.oblastCode,
        oblastName: p.oblastName,
        munis: new Set(),
        projects: [],
      };
      oblastMap.set(p.oblastCode, agg);
    }
    agg.munis.add(p.obshtinaCode);
    agg.projects.push(p);
  }
  const byOblast = [...oblastMap.values()]
    .map((o) => {
      const agreement = o.projects.reduce((s, p) => s + p.agreementEur, 0);
      const paid = o.projects.reduce((s, p) => s + p.paidEur, 0);
      return {
        oblastCode: o.oblastCode,
        oblastName: o.oblastName,
        municipalityCount: o.munis.size,
        projectCount: o.projects.length,
        stalledCount: o.projects.filter((p) => p.stalled).length,
        agreementEur: agreement,
        paidEur: paid,
        paidPct:
          agreement > 0 ? Number(((100 * paid) / agreement).toFixed(2)) : 0,
      };
    })
    .sort((a, b) => b.agreementEur - a.agreementEur);

  // National totals
  const totalAgreement = projects.reduce((s, p) => s + p.agreementEur, 0);
  const totalPaid = projects.reduce((s, p) => s + p.paidEur, 0);
  const national: IpopNationalFile = {
    fiscalYear,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "МРРБ — Инвестиционна програма за общински проекти",
      documentTitle: `Изпълнение на проектите по ИПОП към ${fiscalYear} г.`,
      url: "https://ipop.mrrb.bg/reports_projects_export.php",
      fetchedAt: new Date().toISOString(),
    },
    totals: {
      projectCount: projects.length,
      municipalityCount: byMuniMap.size,
      oblastCount: oblastMap.size,
      stalledCount: projects.filter((p) => p.stalled).length,
      agreementEur: totalAgreement,
      submittedEur: projects.reduce((s, p) => s + p.submittedEur, 0),
      awaitingEur: projects.reduce((s, p) => s + p.awaitingEur, 0),
      paidEur: totalPaid,
      mrrbPaidEur: projects.reduce((s, p) => s + p.mrrbPaidEur, 0),
      bbrPaidEur: projects.reduce((s, p) => s + p.bbrPaidEur, 0),
      paidPct:
        totalAgreement > 0
          ? Number(((100 * totalPaid) / totalAgreement).toFixed(2))
          : 0,
    },
    byMunicipality,
    byOblast,
  };

  const nationalPath = resolve(
    __dirname,
    "../../../data/budget/ipop",
    `${fiscalYear}.json`,
  );
  writeFileSync(
    nationalPath,
    JSON.stringify(national, null, 2) + "\n",
    "utf-8",
  );
  console.log(`[ipop] wrote ${nationalPath}`);

  // Stats
  console.log("");
  console.log(`[ipop] === fiscal year ${fiscalYear} ===`);
  console.log(`  Projects:     ${projects.length}`);
  console.log(`  Municipalities: ${byMuniMap.size}`);
  console.log(`  Oblasts:      ${oblastMap.size}`);
  console.log(
    `  Agreement:    EUR ${(totalAgreement / 1_000_000).toFixed(1)}M`,
  );
  console.log(`  Paid:         EUR ${(totalPaid / 1_000_000).toFixed(1)}M`);
  console.log(`  Execution:    ${national.totals.paidPct}%`);
  console.log(
    `  Stalled:      ${national.totals.stalledCount} projects (>= €100k agreement, < 5% paid)`,
  );
  console.log("");
  console.log("[ipop] top-5 munis by agreement:");
  for (const r of byMunicipality.slice(0, 5)) {
    console.log(
      `  ${r.municipalityName.padEnd(22)} (${r.obshtinaCode.padEnd(6)})  €${(r.agreementEur / 1_000_000).toFixed(1)}M agreement | €${(r.paidEur / 1_000_000).toFixed(1)}M paid (${r.paidPct}%) | ${r.projectCount} proj, ${r.stalledCount} stalled`,
    );
  }
};

main();
