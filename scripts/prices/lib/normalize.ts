// Parse one chain CSV from the daily ZIP into normalized PriceRow[].
// Absorbs the 4 header variants (BOM / quoting / `,` vs `;` delimiter).

import { parse } from "csv-parse/sync";
import type { PriceRow } from "../types";
import { normalizeEkatte } from "./locations";

/** Thrown when one chain's CSV fails to parse, so the caller can count it and
 *  the load can be aborted rather than silently dropping that chain. */
export class ChainParseError extends Error {
  constructor(
    public readonly filename: string,
    message: string,
  ) {
    super(`parse failed for ${filename}: ${message}`);
    this.name = "ChainParseError";
  }
}

// Columns (uniform order across all 207 chains):
// 0 Населено място · 1 Търговски обект · 2 Наименование на продукта ·
// 3 Код на продукта · 4 Категория · 5 Цена на дребно · 6 Цена в промоция

const stripBom = (s: string): string => s.replace(/^\uFEFF/, "");

/** Extract chain display name + EIK from `<Chain> (<entity>)_<EIK>.csv`. */
export const parseChainFromFilename = (
  filename: string,
): { eik: string; chain: string } => {
  const base = filename.replace(/\.csv$/i, "");
  const us = base.lastIndexOf("_");
  const eik = us >= 0 ? base.slice(us + 1) : base;
  const full = us >= 0 ? base.slice(0, us) : base;
  const chain = full.replace(/\s*\(.*\)\s*$/, "").trim() || full.trim();
  return { eik, chain };
};

const toPrice = (raw: string): number | null => {
  const v = (raw ?? "").trim().replace(",", ".");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * The ONLY definition of key normalization in the codebase.
 *
 * `normLabel` backs `price_stores UNIQUE (eik, ekatte, label_norm)` and
 * `normName` backs `price_skus UNIQUE (eik, chain_code, name_norm)`. Both are
 * baked into database constraints: changing either is a data migration, not a
 * refactor. Keep them boring — NFKC, uppercase, collapse anything that is not a
 * letter or digit to a single space, trim.
 *
 * Deliberately NOT here: homoglyph folding, stopwords, token sorting. Those
 * belong to canonicalize() in ./canon.ts, which builds a *semantic* identity.
 * These two build a *storage* key and must never re-cluster anything.
 */
const normKey = (s: string): string =>
  s
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export const normLabel = (s: string): string => normKey(s);
export const normName = (s: string): string => normKey(s);

export const parseChainCsv = (text: string, filename: string): PriceRow[] => {
  const { eik, chain } = parseChainFromFilename(filename);
  const clean = stripBom(text);
  const first = clean.slice(0, clean.indexOf("\n"));
  const delimiter =
    first.split(";").length > first.split(",").length ? ";" : ",";

  let records: string[][];
  try {
    records = parse(clean, {
      delimiter,
      relax_quotes: true,
      relax_column_count: true,
      skip_empty_lines: true,
      bom: true,
    }) as string[][];
  } catch (e) {
    // A parse failure on one chain's CSV must be SURFACED, not swallowed. The
    // caller TRUNCATE+reloads price_current from what parses, so a header/quoting
    // regression on the largest chains could quietly replace "today's truth"
    // with a fraction of the day. Throwing here lets readZip() count it, and
    // load_day's sanity floor aborts the whole load if too much dropped.
    throw new ChainParseError(
      filename,
      e instanceof Error ? e.message : String(e),
    );
  }

  const rows: PriceRow[] = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!r || r.length < 6) continue;
    const c0 = stripBom((r[0] ?? "").trim()).replace(/^"|"$/g, "");
    if (i === 0 && /Населено\s*място/i.test(c0)) continue; // header
    if (!c0) continue;
    const price = toPrice(r[5]);
    if (price == null) continue;
    const ekatte = normalizeEkatte(c0);
    if (ekatte.length !== 5 || !/^\d{5}$/.test(ekatte)) continue;
    // Some chains quote the numeral (`"86"`). parseInt('"86"') is NaN, so those
    // rows were silently bucketed to 0 and dropped. Strip quotes first.
    const rawPid = (r[4] ?? "").trim().replace(/^"|"$/g, "");
    let productId = parseInt(rawPid, 10);
    if (!Number.isFinite(productId) || productId < 1 || productId > 101)
      productId = 0; // legacy / non-standard code bucket
    const store = (r[1] ?? "").trim();
    const product = (r[2] ?? "").trim();
    rows.push({
      ekatte,
      store,
      storeNorm: normLabel(store),
      product,
      productNorm: normName(product),
      productId,
      chainCode: (r[3] ?? "").trim(),
      price,
      promo: toPrice(r[6]),
      eik,
      chain,
    });
  }
  return rows;
};
