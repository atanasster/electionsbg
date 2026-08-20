// Build data/funds/clean_delivery.json from the two ИСУН clean-delivery exports.
//
//   npm run funds:clean-delivery
//
// The inputs are operator-downloaded XLSX drops in data/_cache/isun_clean_delivery/
// (gitignored). That is deliberate and matches the municipal-fiscal ingest: the F5
// WAF in front of 2020.eufunds.bg refuses the export intermittently and blocks its
// GetProgrammes XHR outright, so a scheduled fetch cannot be relied on — but a
// human clicking „Excel" always works. The parse is therefore pure and offline.
//
// See parse.ts for the two rules that matter: these are ACHIEVEMENT lists (absence
// is not a correction), and the exports are COMPLETE (do not partition them).

import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import {
  parseCleanBeneficiaries,
  parseCleanContracts,
  type CleanBeneficiary,
  type CleanContract,
} from "./parse";

const CACHE = path.join(process.cwd(), "data/_cache/isun_clean_delivery");
const OUT = path.join(process.cwd(), "data/funds/clean_delivery.json");
/** These lists only grow as projects close; a shrink is a bad export, not news. */
const MAX_SHRINK = 0.05;

const sheetRows = (file: string): unknown[][] => {
  const wb = XLSX.read(fs.readFileSync(file), { type: "buffer" });
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    defval: "",
  });
};

const pick = (prefix: string): string[] =>
  fs.existsSync(CACHE)
    ? fs
        .readdirSync(CACHE)
        .filter((f) => f.startsWith(prefix) && f.endsWith(".xlsx"))
        .map((f) => path.join(CACHE, f))
        .sort()
    : [];

const main = (): void => {
  const cFiles = pick("contracts__");
  const bFiles = pick("beneficiaries__");
  if (!cFiles.length || !bFiles.length) {
    console.error(
      `Missing exports in ${path.relative(process.cwd(), CACHE)}.\n` +
        `Download both from ИСУН and save them there:\n` +
        `  contracts__ALL.xlsx      ← https://2020.eufunds.bg/bg/0/0/ExecutedContracts?ShowRes=True (Експорт → Excel)\n` +
        `  beneficiaries__ALL.xlsx  ← https://2020.eufunds.bg/bg/0/0/BeneficiaryWithoutFinancialCorrections?ShowRes=True`,
    );
    process.exit(1);
  }

  // Several drops fold by key, so a future per-programme split works unchanged —
  // but do not create one to "avoid a cap": there is none (parse.ts header).
  const contracts = new Map<string, CleanContract>();
  for (const f of cFiles)
    for (const r of parseCleanContracts(sheetRows(f)))
      contracts.set(r.regNo, r);

  const bAll: CleanBeneficiary[] = [];
  for (const f of bFiles) bAll.push(...parseCleanBeneficiaries(sheetRows(f)));

  // Organisations only. A natural person here is a bare first name with no id: it
  // identifies nobody and joins to nothing, so it is COUNTED and not published.
  const bByEik = new Map<string, CleanBeneficiary>();
  let naturalPersons = 0;
  for (const b of bAll) {
    if (!b.eik) {
      naturalPersons++;
      continue;
    }
    const cur = bByEik.get(b.eik);
    if (!cur || b.onTimeContracts > cur.onTimeContracts) bByEik.set(b.eik, b);
  }

  const contractRows = [...contracts.values()].sort((a, b) =>
    a.regNo.localeCompare(b.regNo),
  );
  const beneficiaryRows = [...bByEik.values()].sort((a, b) =>
    (a.eik as string).localeCompare(b.eik as string),
  );

  const out = {
    // ⚠️ Every consumer must be able to state what this IS and is NOT without
    // re-deriving it. `absenceMeaning` is not decoration: it is the one field that
    // stops a reader turning this into an accusation dataset.
    coverage: {
      source:
        "ИСУН 2020 — „Проекти без наложени финансови корекции“ + „Бенефициенти без ФК“",
      urls: [
        "https://2020.eufunds.bg/bg/0/0/ExecutedContracts?ShowRes=True",
        "https://2020.eufunds.bg/bg/0/0/BeneficiaryWithoutFinancialCorrections?ShowRes=True",
      ],
      builtAt: new Date().toISOString(),
      contractCriterion:
        "Приключен проект без наложена финансова корекция (всички редове са със статус „Приключен“)",
      beneficiaryCriterion:
        "Бенефициент без ФК; брой договори, успешно приключени В СРОК",
      absenceMeaning:
        "Отсъствието от тези списъци НЕ означава наложена финансова корекция — проектът може да е приключил със закъснение, да е прекратен или още да е в проверка. Индивидуалните нередности се докладват в системата IMS на OLAF и не са публични.",
      contracts: contractRows.length,
      beneficiaries: beneficiaryRows.length,
      naturalPersonsExcluded: naturalPersons,
      onTimeContractsDeclared: beneficiaryRows.reduce(
        (s, b) => s + b.onTimeContracts,
        0,
      ),
      programmes: [...new Set(contractRows.map((c) => c.programme))].sort(),
    },
    contracts: contractRows,
    beneficiaries: beneficiaryRows,
  };

  if (fs.existsSync(OUT)) {
    const prev = JSON.parse(fs.readFileSync(OUT, "utf8")) as {
      contracts?: unknown[];
      beneficiaries?: unknown[];
    };
    for (const [k, now] of [
      ["contracts", contractRows.length],
      ["beneficiaries", beneficiaryRows.length],
    ] as const) {
      const before = (prev[k] as unknown[] | undefined)?.length ?? 0;
      if (before && now < before * (1 - MAX_SHRINK))
        throw new Error(
          `refusing to write: ${k} ${before} → ${now}. These lists only grow as ` +
            `projects close, so a shrink is a bad or partial export.`,
        );
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  // Compact, not pretty-printed. At 42k rows the one-space indent costs ~10 MB of
  // pure whitespace in a COMMITTED file; the artifact is machine-read by the loader
  // and never hand-edited, so the diff readability an indent buys is worth nothing
  // here. `coverage` is written separately so a human can still eyeball the header.
  fs.writeFileSync(
    OUT,
    `${JSON.stringify({ coverage: out.coverage }, null, 1).replace(/\n?\}$/, "")},\n` +
      `"contracts":${JSON.stringify(out.contracts)},\n` +
      `"beneficiaries":${JSON.stringify(out.beneficiaries)}}\n`,
    "utf8",
  );
  const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1);
  console.log(
    `✓ ${contractRows.length.toLocaleString()} clean contract(s) · ` +
      `${beneficiaryRows.length.toLocaleString()} beneficiary organisation(s) · ` +
      `${naturalPersons.toLocaleString()} natural person(s) excluded → ` +
      `${path.relative(process.cwd(), OUT)} (${mb} MB)`,
  );
  console.log(
    `  ⚠️ absence from these lists is NOT a financial correction — see coverage.absenceMeaning`,
  );
};

main();
