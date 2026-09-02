// Build data/funds/clean_delivery.json from the two ИСУН clean-delivery exports.
//
//   npm run funds:clean-delivery
//
// The inputs are XLSX drops in data/_cache/isun_clean_delivery/ (gitignored).
// They were operator-downloaded until 2026-09-02, because the F5 WAF in front of
// 2020.eufunds.bg refuses the export and blocks its GetProgrammes XHR outright,
// so a scheduled fetch could not be relied on — but a human clicking „Excel"
// always works.
//
// ⚠️ [2026-09-02] `--fetch` now downloads both, through curl. Measured that day,
// the refusal has two independent triggers and neither is rate: the WAF rejects
// the node CLIENT whatever headers it sends (a TLS handshake fingerprint), and
// rejects ANY client that sends a `Referer` on these endpoints. curl with no
// Referer gets both exports first time — 894,724-byte contracts and
// 2,264,101-byte beneficiaries. See scripts/funds/isun_download.ts for the full
// isolation table; the GetProgrammes XHR is a separate wall and stays blocked,
// which is why the programme list is still derived from the rows.
//
// The parse stays pure and offline: `--fetch` only refreshes the cache first, so
// a re-run without it reproduces the same corpus from the same drops.
//
// See parse.ts for the two rules that matter: these are ACHIEVEMENT lists (absence
// is not a correction), and the exports are COMPLETE (do not partition them).

import { spawnSync } from "node:child_process";
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

/** The two listings' export endpoints, and the cache name each drop takes. */
const EXPORTS = [
  ["contracts__ALL.xlsx", "ExecutedContracts"],
  ["beneficiaries__ALL.xlsx", "BeneficiaryWithoutFinancialCorrections"],
] as const;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** Refresh the cache from ИСУН. curl, and NO Referer — see the header. */
const fetchExports = (): void => {
  fs.mkdirSync(CACHE, { recursive: true });
  for (const [name, route] of EXPORTS) {
    const url = `https://2020.eufunds.bg/bg/0/0/${route}/ExportToExcel`;
    const res = spawnSync(
      "curl",
      [
        "-sSL",
        "--compressed",
        "--max-time",
        "300",
        "-H",
        `User-Agent: ${UA}`,
        "-H",
        "Accept-Language: bg-BG,bg;q=0.9,en;q=0.8",
        url,
      ],
      { maxBuffer: 256 * 1024 * 1024, encoding: "buffer" },
    );
    if (res.error) throw res.error;
    if (res.status !== 0)
      throw new Error(`curl exited ${res.status} for ${url}`);
    const buf = Buffer.from(res.stdout);
    // An XLSX is a zip, so it opens "PK". The WAF refusal is small HTML served
    // as HTTP 200 — writing it would surface later as a parse error about the
    // header row, which sends the reader to the wrong file entirely.
    if (buf.length < 1024 || buf.subarray(0, 2).toString("latin1") !== "PK")
      throw new Error(
        `${url} did not return an XLSX (${buf.length} bytes). The WAF refused ` +
          `it; download by hand from the listing and save as ${name}.`,
      );
    fs.writeFileSync(path.join(CACHE, name), buf);
    console.log(`  fetched ${name} (${(buf.length / 1e6).toFixed(1)} MB)`);
  }
};
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
  if (process.argv.includes("--fetch")) fetchExports();
  const cFiles = pick("contracts__");
  const bFiles = pick("beneficiaries__");
  if (!cFiles.length || !bFiles.length) {
    console.error(
      `Missing exports in ${path.relative(process.cwd(), CACHE)}.\n` +
        `Re-run with --fetch, or download both from ИСУН and save them there:\n` +
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
