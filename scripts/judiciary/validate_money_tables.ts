// Validate the ИВСС money-table reader (moneyTables.ts) on a random sample of current-form
// filings, BEFORE anything is stored or published — the precondition the magistrate plan set
// („the bar is not ‚it parsed', it is ‚we can tell when it didn't'").
//
//   npx tsx scripts/judiciary/validate_money_tables.ts [--n 40] [--seed 2026]
//                                                      [--form 4.0] [--print]
//
// ⚠️ v4.0 CANNOT BE SELF-CHECKED. The euro reissue dropped the equivalence column, so its rows
// carry no redundancy and land in `unchecked`; a random sample is ~99% v3.0 and never reaches
// one anyway. `--form 4.0` samples only v4.0 filings (form read from filing_cache.json) and
// `--print` lists every row, which is the hand check against the PDF that has to stand in.
//
// The checks use the document's OWN redundancy rather than the reader's output alone:
//   * a EUR row that states its лев equivalence must have equiv / amount = 1.95583 (±1%);
//   * a лев row that states one must have equiv = amount.
// A column misread — an amount read from the wrong cell, an equivalence shifted by one — breaks
// one of those identities, so a sample that passes them was read in the right columns. Rows in
// a third currency, and rows with no equivalence, are counted but cannot be checked this way.
//
// PDFs are cached under raw_data/judiciary/pdf_cache/ (gitignored). Fetches are serial, 1 s
// apart, from the register the crawler reads.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formVersion,
  isRefusal,
  toRows,
  type Item,
  type Row,
} from "./declarationTables";
import {
  PEG,
  readMoneyTables,
  type MoneyRow,
  type MoneyTable,
} from "./moneyTables";
import { IVSS_REGISTER } from "./sources";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const INDEX = path.join(ROOT, "raw_data/judiciary/declarations_index.json");
const FILING_CACHE = path.join(ROOT, "raw_data/judiciary/filing_cache.json");
const CACHE = path.join(ROOT, "raw_data/judiciary/pdf_cache");
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfjs = require("pdfjs-dist") as any;
pdfjs.GlobalWorkerOptions.workerSrc = undefined;

const arg = (name: string, d: number): number => {
  const i = process.argv.indexOf(name);
  return i > 0 ? Number(process.argv[i + 1]) : d;
};

/** Deterministic sample: mulberry32 over the seed. */
const rng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const pagesOf = async (bytes: Uint8Array): Promise<Row[][]> => {
  const doc = await pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    verbosity: 0,
  }).promise;
  const out: Row[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const items: Item[] = tc.items
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((i: any) => typeof i.str === "string" && i.str.trim())
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((i: any) => ({
        s: i.str.replace(/\s+/g, " ").trim(),
        x: i.transform[4],
        y: i.transform[5],
      }));
    out.push(toRows(items));
  }
  return out;
};

const fetchPdf = async (pdf: string): Promise<Uint8Array> => {
  const file = path.join(CACHE, pdf.replace(/[^\w.-]+/g, "_"));
  if (existsSync(file)) return new Uint8Array(readFileSync(file));
  await new Promise((r) => setTimeout(r, 1000));
  const res = await fetch(new URL(pdf, IVSS_REGISTER).href, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`${pdf} → HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (String.fromCharCode(...bytes.slice(0, 4)) !== "%PDF")
    throw new Error(`${pdf} is not a PDF`);
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, bytes);
  return bytes;
};

type Verdict =
  | "identity-ok"
  | "declarant-rate"
  | "declarant-typo"
  | "identity-FAIL"
  | "unchecked";
/** Does the row's own redundancy hold? A COLUMN MISREAD puts a year, a count or a name-adjacent
 *  number in a money cell, which lands far from the identity; what lands NEAR it is the
 *  declarant's arithmetic — a rate rounded to 2.0, a one-digit typo — and is counted apart,
 *  since the reader values those rows from the amount anyway. */
const verdict = (r: MoneyRow, unit: "BGN" | "EUR" | null): Verdict => {
  if (r.equiv === null || unit === null) return "unchecked";
  // The equivalence is in the unit its OWN header label states — „в лв." on every v3.0
  // filing seen so far, but the reader accepts „в евро" too, so the check must as well.
  const inLev =
    r.currency === "EUR"
      ? r.amount * PEG
      : r.currency === "BGN"
        ? r.amount
        : null;
  if (inLev === null) return "unchecked";
  const expected = unit === "EUR" ? inLev / PEG : inLev;
  const diff = Math.abs(r.equiv - expected);
  if (diff <= Math.max(1, expected * 0.01)) return "identity-ok";
  if (
    unit === "BGN" &&
    r.currency === "EUR" &&
    Math.abs(r.equiv / r.amount - 2) <= 0.02
  )
    return "declarant-rate";
  if (diff <= expected * 0.05) return "declarant-typo";
  return "identity-FAIL";
};

const main = async (): Promise<void> => {
  const n = arg("--n", 40);
  const rand = rng(arg("--seed", 2026));
  const index = JSON.parse(readFileSync(INDEX, "utf8")) as {
    pdf: string;
    name: string;
    year: number;
  }[];
  // v3.0 arrived 22.11.2022, so filings lodged 2023+ are the current form's population.
  const formIdx = process.argv.indexOf("--form");
  const form = formIdx > 0 ? process.argv[formIdx + 1] : null;
  const print = process.argv.includes("--print");
  const versions: Record<string, { formVersion: string | null }> = form
    ? JSON.parse(readFileSync(FILING_CACHE, "utf8"))
    : {};
  const pool = index.filter(
    (e) => e.year >= 2023 && (!form || versions[e.pdf]?.formVersion === form),
  );
  if (pool.length < n)
    throw new Error(`only ${pool.length} filing(s) match; asked for ${n}`);
  const sample = new Set<number>();
  while (sample.size < n) sample.add(Math.floor(rand() * pool.length));
  const tally = new Map<string, number>();
  const bump = (k: string) => tally.set(k, (tally.get(k) ?? 0) + 1);
  const failures: string[] = [];
  let filings = 0;
  for (const i of sample) {
    const e = pool[i];
    let pages: Row[][];
    try {
      pages = await pagesOf(await fetchPdf(e.pdf));
    } catch (err) {
      bump("fetch-or-pdf-error");
      failures.push(`${e.year} ${e.pdf}: ${(err as Error).message}`);
      continue;
    }
    filings++;
    bump(`form ${formVersion(pages) ?? "unversioned"}`);
    const t = readMoneyTables(pages);
    for (const table of ["10", "11", "13"] as MoneyTable[]) {
      const res = t[table];
      if (isRefusal(res)) {
        bump(`table ${table} refused: ${res.kind}`);
        if (res.kind !== "form-version")
          failures.push(`${e.year} ${e.name} T${table}: ${res.detail}`);
        continue;
      }
      bump(`table ${table} read`);
      for (const r of res.rows) {
        bump(`rows ${table}`);
        if (print)
          console.log(
            `  ${e.name} ${e.year} T${table} #${r.ord}: ${r.amount} ${r.currency}` +
              (r.equiv === null ? "" : ` (= ${r.equiv} ${res.equivUnit})`) +
              ` → €${r.valueEur ?? "—"} · ${r.rest.slice(0, 50)}`,
          );
        const v = verdict(r, res.equivUnit);
        bump(`row ${v}`);
        if (v !== "identity-ok" && v !== "unchecked")
          failures.push(
            `${e.year} ${e.name} T${table} row ${r.ord}: ${r.amount} ${r.currency} → ${r.equiv}`,
          );
      }
    }
  }
  console.log(
    `money-table validation: ${filings} filings read of ${n} sampled (seed ${arg("--seed", 2026)}` +
      (form ? `, form ${form} only` : "") +
      ")",
  );
  for (const [k, v] of [...tally.entries()].sort()) console.log(`  ${k}: ${v}`);
  console.log(
    failures.length
      ? `FAILURES (${failures.length}):\n  ${failures.join("\n  ")}`
      : "no identity failures",
  );
};

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
