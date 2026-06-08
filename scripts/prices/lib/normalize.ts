// Parse one chain CSV from the daily ZIP into normalized PriceRow[].
// Absorbs the 4 header variants (BOM / quoting / `,` vs `;` delimiter).

import { parse } from "csv-parse/sync";
import type { PriceRow } from "../types";
import { normalizeEkatte } from "./locations";

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
  } catch {
    return [];
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
    let productId = parseInt((r[4] ?? "").trim(), 10);
    if (!Number.isFinite(productId) || productId < 1 || productId > 101)
      productId = 0; // legacy / non-standard code bucket
    rows.push({
      ekatte,
      store: (r[1] ?? "").trim(),
      product: (r[2] ?? "").trim(),
      productId,
      price,
      promo: toPrice(r[6]),
      eik,
      chain,
    });
  }
  return rows;
};
