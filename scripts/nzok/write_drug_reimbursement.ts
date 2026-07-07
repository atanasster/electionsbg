// Fetch + parse НЗОК's annual gross drug-reimbursement report ("Справка за
// реимбурсна сума … по INN") and write data/budget/nzok/drug_reimbursement.json —
// the health pack's top-reimbursed-medicines tile. Drug reimbursement is НЗОК's
// second-largest budget line (~€1.33bn/yr) and, like hospital payments, flows
// OUTSIDE public procurement.
//
// Usage:
//   tsx scripts/nzok/write_drug_reimbursement.ts --year 2025
//   tsx scripts/nzok/write_drug_reimbursement.ts            # newest year on the page
//
// Source: nhif.bg/bg/medicine_food/quarter-payments/{year}. The annual roll-up
// file is "Брутни разходи за {year} г.xls"; before a year closes only quarterly
// files exist, so we fall back to the newest quarterly file for that year.
// Amounts are gross reimbursement in BGN (лв.) → converted to EUR at 1.95583.
//
// Row grain is (INN × trade name × pack); we aggregate to INN and to ATC
// anatomical main group (the first ATC letter) — the therapeutic-area view that
// surfaces oncology's dominance.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as xlsx from "xlsx";
import { toEur } from "../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAW_DIR = path.resolve(__dirname, "../../raw_data/nzok/drugs");
const OUT_FILE = path.resolve(
  __dirname,
  "../../data/budget/nzok/drug_reimbursement.json",
);
const BASE = "https://www.nhif.bg";
const UA = "Mozilla/5.0 (compatible; naiasno-data/1.0)";

// ATC anatomical main groups (first letter). Label the ones НЗОК actually
// reimburses; unknown letters fall back to the bare code.
const ATC_GROUP: Record<string, { bg: string; en: string }> = {
  A: { bg: "Храносмилане и обмяна", en: "Alimentary & metabolism" },
  B: { bg: "Кръв и кръвотворни органи", en: "Blood & blood-forming organs" },
  C: { bg: "Сърдечно-съдова система", en: "Cardiovascular system" },
  D: { bg: "Дерматология", en: "Dermatology" },
  G: { bg: "Пикочо-полова система", en: "Genito-urinary system" },
  H: { bg: "Хормони (без полови)", en: "Systemic hormones" },
  J: { bg: "Противоинфекциозни", en: "Anti-infectives" },
  L: {
    bg: "Онкология и имуномодулатори",
    en: "Antineoplastic & immunomodulating",
  },
  M: { bg: "Мускулно-скелетна система", en: "Musculoskeletal system" },
  N: { bg: "Нервна система", en: "Nervous system" },
  P: { bg: "Антипаразитни", en: "Antiparasitic" },
  R: { bg: "Дихателна система", en: "Respiratory system" },
  S: { bg: "Сетивни органи", en: "Sensory organs" },
  V: { bg: "Разни", en: "Various" },
};

// The source mixes Cyrillic homoglyphs into some Latin INN strings (e.g. a
// Cyrillic "Р" leading "РEMBROLIZUMAB"). Normalise the common lookalikes back to
// Latin so equal INNs aggregate together and display cleanly.
const CYR2LAT: Record<string, string> = {
  А: "A",
  В: "B",
  Е: "E",
  К: "K",
  М: "M",
  Н: "H",
  О: "O",
  Р: "P",
  С: "C",
  Т: "T",
  У: "Y",
  Х: "X",
};
const normInn = (s: string): string =>
  s
    .trim()
    .replace(/[АВЕКМНОРСТУХ]/g, (c) => CYR2LAT[c] ?? c)
    .replace(/\s+/g, " ");

const fetchText = async (url: string): Promise<string> => {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  return r.text();
};
const fetchToFile = async (url: string, dest: string): Promise<void> => {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
};

const argYear = (): number => {
  const i = process.argv.indexOf("--year");
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : 0;
};

/** Pick the gross-reimbursement file link for a year: prefer the annual roll-up
 *  ("Брутни разходи за {year} г"), else the newest quarterly file (they list
 *  newest-first). */
const findFileHref = (html: string, year: number): string | null => {
  const links = [
    ...html.matchAll(/href="(\/upload\/[^"]+\.(?:xlsx|xls))"/gi),
  ].map((m) => ({ href: m[1], name: decodeURIComponent(m[1]) }));
  const annual = links.find((l) =>
    new RegExp(`Брутни разходи за\\s*${year}\\s*г`, "i").test(l.name),
  );
  if (annual) return annual.href;
  const quarterly = links.find((l) => /Брутни разходи/i.test(l.name));
  return quarterly?.href ?? null;
};

const main = async (): Promise<void> => {
  let year = argYear();
  if (!year) {
    const page = await fetchText(
      `${BASE}/bg/medicine_food/quarter-payments/2026`,
    );
    const years = [...page.matchAll(/quarter-payments\/(\d{4})/g)].map((m) =>
      Number(m[1]),
    );
    year = years.length ? Math.max(...years) : 2025;
  }
  const pageHtml = await fetchText(
    `${BASE}/bg/medicine_food/quarter-payments/${year}`,
  );
  const href = findFileHref(pageHtml, year);
  if (!href) throw new Error(`no gross-reimbursement file on the ${year} page`);
  const isAnnual = new RegExp(`Брутни разходи за\\s*${year}\\s*г`, "i").test(
    decodeURIComponent(href),
  );
  const cachePath = path.join(
    RAW_DIR,
    `${year}${isAnnual ? "" : "-latest"}.xls`,
  );
  await fetchToFile(BASE + href, cachePath);

  const wb = xlsx.read(fs.readFileSync(cachePath), {
    type: "buffer",
    codepage: 1251,
  });
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    defval: null,
  }) as unknown[][];

  interface InnAcc {
    inn: string;
    atc: string;
    eur: number;
    productCount: number;
    topProduct: { name: string; eur: number } | null;
  }
  const byInn = new Map<string, InnAcc>();
  const byGroup = new Map<string, number>();
  let totalEur = 0;
  let dataRows = 0;

  // Data starts at row 2 (row 0 title, row 1 header). Cols: 1=ATC, 2=INN,
  // 4=trade name, 9=Реимбурсна сума (BGN).
  let droppedNonPositive = 0;
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const inn = normInn(String(r[2] ?? ""));
    const atc = String(r[1] ?? "").trim();
    const product = String(r[4] ?? "").trim();
    const bgn = Number(r[9]);
    // Count silently-dropped non-positive amounts — a correction/clawback row
    // shouldn't invisibly shrink the total.
    if (inn && Number.isFinite(bgn) && bgn <= 0) droppedNonPositive++;
    if (!inn || !Number.isFinite(bgn) || bgn <= 0) continue;
    const eur = Math.round((toEur(bgn, "BGN") ?? 0) * 100) / 100;
    dataRows++;
    totalEur += eur;
    const group = atc.charAt(0).toUpperCase() || "?";
    byGroup.set(group, (byGroup.get(group) ?? 0) + eur);
    let e = byInn.get(inn);
    if (!e) {
      e = { inn, atc, eur: 0, productCount: 0, topProduct: null };
      byInn.set(inn, e);
    }
    e.eur += eur;
    e.productCount += 1;
    if (!e.topProduct || eur > e.topProduct.eur)
      e.topProduct = { name: product, eur };
  }

  const top = [...byInn.values()]
    .sort((a, b) => b.eur - a.eur || a.inn.localeCompare(b.inn))
    .slice(0, 25)
    .map((e) => ({
      inn: e.inn,
      atc: e.atc,
      atcGroup: e.atc.charAt(0).toUpperCase(),
      eur: Math.round(e.eur),
      productCount: e.productCount,
      topProduct: e.topProduct?.name ?? null,
    }));

  const byAtcGroup = [...byGroup.entries()]
    .map(([code, eur]) => ({
      code,
      bg: ATC_GROUP[code]?.bg ?? code,
      en: ATC_GROUP[code]?.en ?? code,
      eur: Math.round(eur),
    }))
    .sort((a, b) => b.eur - a.eur || a.code.localeCompare(b.code));

  const out = {
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Национална здравноосигурителна каса (НЗОК)",
      url: `${BASE}/bg/medicine_food/quarter-payments/${year}`,
      description:
        "Брутен разход (реимбурсна сума) за лекарствени продукти по INN и ATC. Сумите са в лева, конвертирани в евро при 1 EUR = 1.95583 BGN.",
    },
    year,
    basis: isAnnual ? "annual" : "ytd",
    totalEur: Math.round(totalEur),
    distinctInn: byInn.size,
    productRows: dataRows,
    byAtcGroup,
    top,
  };
  // Completeness gate BEFORE writing — a shifted sheet layout (hardcoded column
  // indices) would silently collect ~0 rows and ship a zeroed artifact. The
  // corpus is ~€1.33bn across thousands of product rows, so anything far below
  // that is a parse failure, not a real year.
  if (dataRows < 500 || totalEur < 100_000_000)
    throw new Error(
      `implausible drug-reimbursement parse: ${dataRows} rows, €${Math.round(totalEur)} — sheet layout may have changed`,
    );

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));

  console.log(
    `Wrote ${OUT_FILE}\n  ${year} (${out.basis}): €${out.totalEur.toLocaleString("en")} across ${out.distinctInn} INN / ${dataRows} products` +
      (droppedNonPositive
        ? ` (${droppedNonPositive} non-positive rows dropped)`
        : "") +
      `\n  top: ${top[0].inn} €${top[0].eur.toLocaleString("en")} · onco group L €${(byAtcGroup.find((g) => g.code === "L")?.eur ?? 0).toLocaleString("en")}`,
  );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
