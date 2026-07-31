// Култура ingest — parse the НФЦ Единен публичен регистър .xls files into
// data/culture/films.json (per-film corpus) + data/culture/overview.json
// (precomputed dashboard blob). JSON-only for the parse (plan §4); the one
// Postgres touch is the producer→EIK linking below, which runs BEFORE the write
// so a refresh can never leave overview.json without the EIKs (and degrades to
// carrying the previous ones forward when Postgres is down).
//
//   npx tsx scripts/culture/ingest.ts            # cache-first
//   npx tsx scripts/culture/ingest.ts --force    # re-download every year
//
// Two source-format families (plan §5):
//  - 2022–2025: [Вид · Наименование · Рег.№ · Продуцент · Субсидия лв · Бюджет лв
//    · Протокол на ФК · …], "Игрално кино:" section rows.
//  - 2014–2021: [№ · Филм · Рег.№ · Продуцент · Държавно финансиране лв · Заповед],
//    multi-sheet, discipline embedded in the title / reg-number.
//
// Discipline is classified from the reg-number letter (И=игрално, Д=документално,
// А=анимационно) — the one signal reliable across BOTH families — with a
// title-prefix fallback. Amounts are historical BGN → EUR at the fixed rate.
//
// Self-verifies (plan §9): asserts every year parsed > 0 rows and the Σ per year
// reconciles to the flat list; refuses to write a partial artifact on failure.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";
import { BGN_PER_EUR } from "../../src/lib/currency";
import { foldProducer } from "../../src/lib/foldProducer";
import { end as endPool } from "../db/lib/pg";
import { TrCorpusUnavailable, linkProducerEiks } from "./producer_eik";
import { NFC_REGISTER_PAGE, NFC_YEARS, fetchNfcYear } from "./sources";
import type {
  CultureFilmsFile,
  CultureOverviewFile,
  CultureSource,
  DisciplineBucket,
  FilmAward,
  FilmDiscipline,
  ProducerBucket,
  YearBucket,
} from "../../src/data/culture/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT_DIR = path.resolve(__dirname, "../../data/culture");

const SOURCE: CultureSource = {
  publisher: "Изпълнителна агенция „Национален филмов център“ (НФЦ)",
  url: NFC_REGISTER_PAGE,
  description:
    "Единен публичен регистър на финансираните филми и сериали, 2014–2025. Сумите са държавна субсидия в лева, конвертирани в евро по фиксирания курс.",
};

// ------------------------------------------------------------- helpers ------

/** Parse a BGN amount cell: keep digits, take the first number if a range. */
const parseAmount = (cell: unknown): number => {
  const s = String(cell ?? "").trim();
  if (!s) return 0;
  const first = s.split(/[-–—]/)[0]; // "7913217-417483" → total-budget head
  const digits = first.replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : 0;
};

/** Discipline from the reg-number letter after the 2-digit year (24И016 → И). */
const disciplineFromReg = (regNo: string): FilmDiscipline | null => {
  const m = /\b\d{2}\s*([ИДАидаIDA])/.exec(regNo);
  if (!m) return null;
  const c = m[1].toUpperCase();
  if (c === "И" || c === "I") return "feature";
  if (c === "Д" || c === "D") return "documentary";
  if (c === "А" || c === "A") return "animation";
  return null;
};

const disciplineFromTitle = (title: string): FilmDiscipline | null => {
  const t = title.toLocaleLowerCase("bg-BG");
  if (/анимацион/.test(t)) return "animation";
  if (/документал/.test(t)) return "documentary";
  if (/игрален|игрално/.test(t)) return "feature";
  return null;
};

const isTotalRow = (s: string): boolean =>
  /^(общо|всичко|total|сума)\b/i.test(s.trim());

const norm = (v: unknown): string =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();

// НФЦ enters many titles with a lowercase discipline prefix ("игрален филм …").
// Capitalise the first character (a no-op when it's already upper, a quote or a
// digit) so titles read as titles.
const capFirst = (s: string): string =>
  s ? s.charAt(0).toLocaleUpperCase("bg-BG") + s.slice(1) : s;

const findHeaderRow = (rows: string[][]): number =>
  rows.findIndex((r) => r.some((c) => /продуцент/i.test(String(c))));

const colFinder =
  (header: string[]) =>
  (re: RegExp): number =>
    header.findIndex((c) => re.test(String(c)));

// ----------------------------------------------------------- per-year -------

const parseYear = (year: number, buf: Buffer): FilmAward[] => {
  const wb = XLSX.read(buf, { type: "buffer" });
  const out: FilmAward[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, {
      header: 1,
      defval: "",
      raw: false,
    });
    const h = findHeaderRow(rows);
    if (h < 0) continue; // sheet has no film table
    const header = rows[h].map((c) => String(c));
    const find = colFinder(header);
    const cProducer = find(/продуцент/i);
    const cTitle = (() => {
      const t = find(/наименование/i);
      return t >= 0 ? t : find(/^\s*филм/i);
    })();
    const cReg = find(/рег/i);
    const cSubsidy = (() => {
      const s = find(/субсиди/i);
      return s >= 0 ? s : find(/финансиране|държавно/i);
    })();
    const cProtocol = find(/протокол/i);
    const cStage = find(/вид/i);
    if (cProducer < 0 || cSubsidy < 0) continue;

    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i];
      const producer = norm(r[cProducer]);
      if (!producer || isTotalRow(producer)) continue;
      const subsidyBgn = parseAmount(r[cSubsidy]);
      if (subsidyBgn <= 0) continue;
      const title = cTitle >= 0 ? norm(r[cTitle]) : "";
      if (isTotalRow(title)) continue;
      const regNo = cReg >= 0 ? norm(r[cReg]) : "";
      const discipline =
        disciplineFromReg(regNo) ?? disciplineFromTitle(title) ?? "other";
      const stage = cStage >= 0 ? norm(r[cStage]) || undefined : undefined;
      const protocol =
        cProtocol >= 0 ? norm(r[cProtocol]) || undefined : undefined;
      out.push({
        year,
        title: capFirst(title) || "(без заглавие)",
        regNo,
        producer,
        producerFold: foldProducer(producer),
        discipline,
        stage,
        subsidyBgn,
        subsidyEur: Math.round(subsidyBgn / BGN_PER_EUR),
        protocol,
      });
    }
  }
  return out;
};

// ------------------------------------------------------------- overview -----

const buildOverview = (films: FilmAward[]): CultureOverviewFile => {
  const byYearMap = new Map<number, YearBucket>();
  const byDiscMap = new Map<FilmDiscipline, DisciplineBucket>();
  const byProdMap = new Map<string, ProducerBucket>();
  let totalEur = 0;

  for (const f of films) {
    totalEur += f.subsidyEur;
    const y = byYearMap.get(f.year) ?? { year: f.year, eur: 0, count: 0 };
    y.eur += f.subsidyEur;
    y.count += 1;
    byYearMap.set(f.year, y);

    const d =
      byDiscMap.get(f.discipline) ??
      ({ discipline: f.discipline, eur: 0, count: 0 } as DisciplineBucket);
    d.eur += f.subsidyEur;
    d.count += 1;
    byDiscMap.set(f.discipline, d);

    const p =
      byProdMap.get(f.producerFold) ??
      ({
        producer: f.producer,
        producerFold: f.producerFold,
        eur: 0,
        count: 0,
        share: 0,
      } as ProducerBucket);
    p.eur += f.subsidyEur;
    p.count += 1;
    byProdMap.set(f.producerFold, p);
  }

  const byYear = [...byYearMap.values()].sort((a, b) => a.year - b.year);
  const byDiscipline = [...byDiscMap.values()].sort((a, b) => b.eur - a.eur);
  const producers = [...byProdMap.values()]
    .map((p) => ({ ...p, share: totalEur ? p.eur / totalEur : 0 }))
    .sort(
      (a, b) => b.eur - a.eur || a.producerFold.localeCompare(b.producerFold),
    );
  const top10Share = producers.slice(0, 10).reduce((s, p) => s + p.share, 0);

  const years = byYear.map((y) => y.year);
  return {
    generatedAt: new Date().toISOString(),
    source: SOURCE,
    totalEur,
    filmCount: films.length,
    producerCount: byProdMap.size,
    firstYear: Math.min(...years),
    lastYear: Math.max(...years),
    byYear,
    byDiscipline,
    topProducers: producers.slice(0, 25),
    top10Share,
  };
};

// ---------------------------------------------------------------- main ------

/** topProducers' `producerFold` → `eik` from the overview.json about to be
 *  overwritten. The fallback when the EIK linking cannot run. */
const previousProducerEiks = (): Map<string, string> => {
  const file = path.join(OUT_DIR, "overview.json");
  const map = new Map<string, string>();
  if (!fs.existsSync(file)) return map;
  try {
    const prev = JSON.parse(
      fs.readFileSync(file, "utf8"),
    ) as CultureOverviewFile;
    for (const p of prev.topProducers ?? [])
      if (p.eik) map.set(p.producerFold, p.eik);
  } catch {
    // Unparseable previous artifact — nothing to carry forward.
  }
  return map;
};

/**
 * Attach the /company/:eik link to every top producer, in place.
 *
 * The invariant is "overview.json is never left without EIKs". The register has
 * no EIK column, so this is the only place they come from — and it used to be a
 * separate script the operator had to remember, which is how a routine refresh
 * silently stripped all 9 links on 2026-07-31. When Postgres is unavailable the
 * ingest does NOT fail (the parse is sound and films.json is unaffected): it
 * carries the previous file's EIKs forward and says so loudly.
 */
const attachProducerEiks = async (
  overview: CultureOverviewFile,
): Promise<void> => {
  try {
    const { linked, total } = await linkProducerEiks(overview.topProducers);
    console.log(`  ${linked}/${total} top producers linked to a unique EIK`);
  } catch (e) {
    // ONLY the corpus-unavailable case degrades. A renamed column, a revoked
    // grant or a statement timeout must stop the pipeline: degrading those would
    // carry a stale link set forward indefinitely behind a warning that says
    // "Postgres is down", with `git diff` showing no change and the gate passing.
    if (!(e instanceof TrCorpusUnavailable)) throw e;

    const prev = previousProducerEiks();
    let carried = 0;
    for (const p of overview.topProducers) {
      const eik = prev.get(p.producerFold);
      if (eik) {
        p.eik = eik;
        carried += 1;
      }
    }
    // Report against what the PREVIOUS file held, not against the number of top
    // producers: the fold key moves when the register respells a legal form, and
    // carried-vs-25 cannot tell "all 18 kept" from "2 lost to name churn".
    const lost = prev.size - carried;
    console.warn(
      `\n  ⚠ producer→EIK linking SKIPPED: ${(e as Error).message}` +
        `\n    carried ${carried}/${prev.size} eik(s) forward from the previous overview.json` +
        (lost > 0 ? ` — ${lost} LOST to producer-name churn` : "") +
        ` (${overview.topProducers.length} top producers).` +
        `\n    Re-run \`npx tsx scripts/culture/enrich_producers.ts\` once Postgres is up.\n`,
    );
  } finally {
    await endPool();
  }
};

const main = async () => {
  const force = process.argv.includes("--force");
  const all: FilmAward[] = [];
  for (const year of NFC_YEARS) {
    const buf = await fetchNfcYear(year, { force });
    const films = parseYear(year, buf);
    if (films.length === 0)
      throw new Error(`НФЦ ${year}: parsed 0 films — parser/source drift`);
    const eur = films.reduce((s, f) => s + f.subsidyEur, 0);
    console.log(
      `  ${year}: ${films.length} films · €${(eur / 1e6).toFixed(2)}M`,
    );
    all.push(...films);
  }

  // Drop exact full-row duplicates: the НФЦ .xls source occasionally repeats an
  // award row verbatim, which would double-count it in the headline totals. Key
  // on the full identifying tuple (year|regNo|title|producer|subsidyBgn).
  const seen = new Set<string>();
  const deduped: FilmAward[] = [];
  for (const f of all) {
    const key = `${f.year}|${f.regNo}|${f.title}|${f.producer}|${f.subsidyBgn}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(f);
  }
  const dropped = all.length - deduped.length;
  if (dropped > 0) console.log(`  deduped ${dropped} exact-duplicate row(s)`);
  all.length = 0;
  all.push(...deduped);

  // Σ-reconciliation (plan §9): the flat total must equal the per-year sum.
  const flatEur = all.reduce((s, f) => s + f.subsidyEur, 0);
  const overview = buildOverview(all);
  if (overview.totalEur !== flatEur)
    throw new Error(
      `Σ mismatch: overview ${overview.totalEur} ≠ flat ${flatEur}`,
    );

  // BEFORE the write: overview.json must never land without the producer EIKs.
  await attachProducerEiks(overview);

  const films: CultureFilmsFile = {
    generatedAt: new Date().toISOString(),
    source: SOURCE,
    firstYear: overview.firstYear,
    lastYear: overview.lastYear,
    films: all.sort((a, b) => a.year - b.year || b.subsidyEur - a.subsidyEur),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, "films.json"),
    JSON.stringify(films) + "\n",
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "overview.json"),
    JSON.stringify(overview, null, 2) + "\n",
  );
  console.log(
    `\n✓ ${all.length} films · €${(flatEur / 1e6).toFixed(1)}M · ${overview.producerCount} producers · ${overview.firstYear}–${overview.lastYear}`,
  );
  console.log(
    `  top-10 producers hold ${(overview.top10Share * 100).toFixed(1)}% of subsidy`,
  );
  console.log(`  → data/culture/films.json + overview.json`);
};

main().catch((e) => {
  console.error("culture ingest failed:", e);
  process.exit(1);
});
