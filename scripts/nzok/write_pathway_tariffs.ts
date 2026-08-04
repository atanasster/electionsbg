// НЗОК clinical-pathway TARIFFS → data/budget/nzok/pathway_tariffs.json — the
// price factor that turns the volume-only activity corpus into a spend reading and
// unlocks the case-mix expected-vs-actual signal (migration 059).
//
// Source = the НРД (Национален рамков договор) CONTRACT BODY, not an annex: the
// per-pathway prices are the tables of чл. 368/369/370 (КП / КПр / АПр), and in
// the multi-year НРД era each amendment agreement re-tables them as чл. 368б/
// 369б/370б etc. — e.g. the 2025 prices live in Договор № РД-НС-01-2-3 от 22 май
// 2025 г. on https://www.nhif.bg/bg/nrd/2023-2025/medical. This script hunted a
// "цени" price annex for months and found nothing because NO SUCH ANNEX EXISTS
// (Приложение 17/18/19 are the NAME specs write_procedure_names.ts parses);
// see reference_nzok_pathway_tariffs / gaps plan T4.
//
// OPERATIONAL NOTES:
//   * nhif.bg is NOT IP-gated (verified 200 from non-BG egress, 2026-08-04) —
//     this header used to claim the opposite; the 403s were a different era or a
//     transient block.
//   * The table layout is `Код | Номенклатура | Обем (бр.) | Цена (лв.)` with
//     wrapped names; parseTariffs sections the text by the чл. 368/369/370
//     markers and reads the code + trailing (обем, цена) rows. Iterate against a
//     --dump with --from-dump (no re-fetch) if a future document shifts layout.
//   * Money: 2026+ НРД is EUR-native; pre-2026 is BGN — pass --bgn to convert at
//     1 EUR = 1.95583 BGN (the euro-adoption rate used across the repo).
//   * For a specific year pass the SPECIFIC document with --annex (the base
//     contract carries the launch-year prices, each amendment its own year's);
//     --page discovery pulls every НРД/amendment PDF on the page and first-wins
//     merges them in page order (newest amendment first), which approximates
//     "latest effective" but is fragile — prefer --annex.
//
// USAGE — value-carrying flags (--page/--annex/--nrd-year) require DIRECT
// invocation; the `npm run data:nzok --` wrapper only forwards the valueless
// passthrough flags (--dump/--from-dump/--bgn) and rejects unknown flags:
//   tsx scripts/nzok/write_pathway_tariffs.ts --annex "https://www.nhif.bg/upload/28002/….pdf" --dump --nrd-year 2025 --bgn
//   tsx scripts/nzok/write_pathway_tariffs.ts --from-dump --nrd-year 2025 --bgn
//   tsx scripts/nzok/write_pathway_tariffs.ts --page https://www.nhif.bg/bg/nrd/2023-2025/medical --dump --nrd-year 2025 --bgn
//   npm run data:nzok -- --pathway-tariffs --from-dump   # wrapper OK (no value flags)
//
// Requires the `pdftotext` binary (poppler-utils) for the PDFs.

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.resolve(
  __dirname,
  "../../data/budget/nzok/pathway_tariffs.json",
);
const DUMP_DIR = path.resolve(
  __dirname,
  "../../raw_data/nzok/pathway_tariffs_raw",
);
const BASE = "https://nhif.bg";
const UA = "Mozilla/5.0 (compatible; naiasno-data/1.0)";
const BGN_PER_EUR = 1.95583;

type ProcType = "КП" | "АПр" | "КПр";
const PREFIX: Record<ProcType, "P" | "A" | "K"> = {
  КП: "P",
  АПр: "A",
  КПр: "K",
};
const PAD: Record<ProcType, number> = { КП: 3, АПр: 2, КПр: 2 };

const arg = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};
const has = (flag: string): boolean => process.argv.includes(flag);

const fetchBuf = async (url: string): Promise<Buffer> => {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
};

const extractPdfRaw = (buf: Buffer): Promise<string> =>
  new Promise((resolve, reject) => {
    const p = spawn("pdftotext", ["-enc", "UTF-8", "-layout", "-", "-"]);
    let out = "";
    let err = "";
    p.stdout.on("data", (b: Buffer) => (out += b.toString("utf8")));
    p.stderr.on("data", (b: Buffer) => (err += b.toString("utf8")));
    p.on("error", (e: NodeJS.ErrnoException) =>
      reject(
        e.code === "ENOENT"
          ? new Error("pdftotext not found — brew install poppler")
          : e,
      ),
    );
    p.on("close", (code: number | null) =>
      code === 0 || out
        ? resolve(out)
        : reject(new Error(`pdftotext exited ${code}: ${err.slice(0, 300)}`)),
    );
    p.stdin.write(buf);
    p.stdin.end();
  });

/** Normalize a source code to the activity-feed format (P/A/K + padded + .N). */
const normalizeCode = (type: ProcType, raw: string): string | null => {
  const m = raw.trim().match(/^(\d{1,3})(\.\d+)?$/);
  if (!m) return null;
  return `${PREFIX[type]}${m[1].padStart(PAD[type], "0")}${m[2] ?? ""}`;
};

/** Parse a price token like "1 234,56" / "1234.56" → number. */
const parsePrice = (raw: string): number | null => {
  const t = raw.replace(/\s/g, "");
  // The decimal separator is whichever of "," / "." appears LAST; the other is a
  // thousands separator. Handles both "1 234,56" (comma-decimal, the real НРД
  // format) and "1234.56" (dot-decimal, listed in the docstring) — the old
  // "strip every dot" logic turned the latter into 123456, a 100x error.
  const dec = t.lastIndexOf(",") > t.lastIndexOf(".") ? "," : ".";
  const thou = dec === "," ? "." : ",";
  const cleaned = t.split(thou).join("").replace(dec, ".");
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Extraction of (code → price) from the НРД contract text. The prices are the
 *  чл. 368/369/370 tables (…б/в variants in amendments): section the text at
 *  those article markers, read each section's type from its opening sentence
 *  ("дейностите по КП/КПр/АПр" — checked in КПр→АПр→КП order because "КПр"
 *  contains "КП", and \b is useless on Cyrillic), then match table rows of the
 *  shape `код … обем цена`. Special billing rows (ВР050.2, BONK03, ЕА06…) start
 *  with letters and fall out of the code pattern by design. First occurrence of
 *  a code wins. ITERATE against a --dump when the counts look wrong. */
const parseTariffs = (
  text: string,
  toEur: (v: number) => number,
): Record<string, number> => {
  const out: Record<string, number> = {};
  const markerRe = /„?Чл\.\s*3(?:68|69|70)[а-я]?\.\s*\(1\)/g;
  const markers: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(text))) markers.push(m.index);
  const typeOf = (head: string): ProcType | null =>
    /по\s+КПр/.test(head)
      ? "КПр"
      : /по\s+АПр/.test(head)
        ? "АПр"
        : /по\s+КП/.test(head)
          ? "КП"
          : null;
  // A table row: leading code (digits, optional .N sub-code), optional wrapped
  // name, then the two trailing numeric columns (обем, цена). Wrapped-name rows
  // put the numbers on the code's line with the name on neighbouring lines, so
  // the name group is optional.
  // Обем accepts [\d\s.,]: two real КП rows (187.1/187.2) carry comma-formatted
  // volumes ("494,000") and were silently dropped by a digits+spaces group.
  // Price accepts both comma and dot decimals — the 2026+ НРД is EUR-native and
  // may switch separator; parsePrice disambiguates by whichever appears last.
  const rowRe =
    /^\s{0,10}(\d{1,3}(?:\.\d+)?)(?:\s{2,}(?:\S.*?))?\s{2,}(?:\d[\d\s.,]{0,10}?)\s{2,}(\d[\d\s]*[.,]\d{2})\s*$/;
  for (let i = 0; i < markers.length; i++) {
    const sec = text.slice(markers[i], markers[i + 1] ?? text.length);
    const type = typeOf(sec.slice(0, 400));
    if (!type) continue;
    for (const line of sec.split(/\r?\n/)) {
      const r = rowRe.exec(line);
      if (!r) continue;
      const code = normalizeCode(type, r[1]);
      if (!code) continue;
      const price = parsePrice(r[2]);
      if (price == null) continue;
      if (out[code] == null) out[code] = Math.round(toEur(price) * 100) / 100;
    }
  }
  return out;
};

/** Find the НРД contract / amendment PDF link(s) on the НРД medical page. The
 *  prices live in the contract body (чл. 368/369/370), so the documents to pull
 *  are the рамков договор + its изменение и допълнение agreements — page order
 *  lists the newest amendment first, which is what first-wins merging wants. */
const findAnnexHrefs = (html: string): string[] => {
  const hrefs: string[] = [];
  const re = /<a[^>]+href="([^"]+)"[^>]*>([^<]*)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const [, href] = m;
    // Guarded: a malformed %-sequence in a scraped href must not kill the run
    // (the same hazard mh_eeof_quarterly.ts documents).
    let name = href;
    try {
      name = decodeURIComponent(href);
    } catch {
      /* keep the raw href */
    }
    if (
      /\.pdf$/i.test(name) &&
      /рамков\s+договор|изменение\s+и\s+допълнение\s+на\s+Н/i.test(name)
    )
      hrefs.push(href.startsWith("http") ? href : BASE + href);
  }
  return [...new Set(hrefs)];
};

const main = async (): Promise<void> => {
  const nrdYear = Number(arg("--nrd-year") ?? new Date().getFullYear() - 1);
  const toEur = (v: number): number => (has("--bgn") ? v / BGN_PER_EUR : v);
  const fromDump = has("--from-dump");
  const dump = has("--dump");
  if (!fromDump) fs.mkdirSync(DUMP_DIR, { recursive: true });

  // 1) Gather annex text — from a local dump, a direct --annex URL, or by
  //    discovering the price annex on the --page.
  const texts: string[] = [];
  if (fromDump) {
    // Numeric sort on the annex_N index — readdirSync's alphabetical order
    // diverges from fetch order past 9 dumps, and merge order is first-wins.
    const files = (
      fs.existsSync(DUMP_DIR) ? fs.readdirSync(DUMP_DIR) : []
    ).sort(
      (a, b) =>
        Number(/\d+/.exec(a)?.[0] ?? 0) - Number(/\d+/.exec(b)?.[0] ?? 0),
    );
    if (!files.length)
      throw new Error(`No dumps in ${DUMP_DIR} — run --dump first.`);
    for (const f of files)
      texts.push(fs.readFileSync(path.join(DUMP_DIR, f), "utf8"));
  } else {
    const annexes: string[] = [];
    const direct = arg("--annex");
    if (direct) annexes.push(direct);
    else {
      const page = arg("--page");
      if (!page)
        throw new Error(
          "Pass --page <НРД medical page> or --annex <direct annex URL>.",
        );
      annexes.push(
        ...findAnnexHrefs(await (await fetchBuf(page)).toString("utf8")),
      );
      if (!annexes.length)
        throw new Error(
          "No price-annex link found on the page — pass --annex directly.",
        );
    }
    let i = 0;
    for (const url of annexes) {
      const buf = await fetchBuf(url);
      const text = /\.pdf/i.test(url)
        ? await extractPdfRaw(buf)
        : buf.toString("utf8");
      texts.push(text);
      if (dump) fs.writeFileSync(path.join(DUMP_DIR, `annex_${i++}.txt`), text);
    }
  }

  // 2) Parse. FIRST-wins across documents: --page discovery lists the newest
  // amendment first, so an earlier document may not overwrite a code the newer
  // one already priced (Object.assign here would be last-wins and publish the
  // 2023 base prices under the current label).
  const names: Record<string, number> = {};
  for (const text of texts)
    for (const [code, price] of Object.entries(parseTariffs(text, toEur)))
      if (names[code] == null) names[code] = price;

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      nrdYear,
      currency: "EUR",
      source:
        "НЗОК НРД за медицинските дейности — цените по чл. 368/369/370 (КП/КПр/АПр) от тялото на договора и измененията му, nhif.bg",
      count: Object.keys(names).length,
    },
    tariffs: Object.fromEntries(
      Object.entries(names).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + "\n");
  console.log(`Wrote ${payload.meta.count} pathway tariffs → ${OUT_FILE}`);
  if (payload.meta.count < 300)
    console.warn(
      "! Fewer tariffs than expected (~410: ~352 КП + ~51 АПр + ~7 КПр in the 2025 tables). Iterate parseTariffs against a --dump — the layout varies per document.",
    );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
