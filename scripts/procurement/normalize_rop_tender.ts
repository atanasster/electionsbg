// Parse + normalize the pre-ЦАИС РОП tender (procedure) register at www.aop.bg —
// the tender-STAGE counterpart to normalize_rop.ts (which handles the sibling
// CONTRACTS register). The pure, side-effect-free half of the backfill (the
// fetch/cache/CLI half lives in ingest_rop_tenders.ts), so it can be unit-tested.
//
// The cases search (esearch_cases_from_to.php, "преписки" = the procedures)
// returns a server-rendered HTML table by publication-date range. Columns are
// fixed (10 <td>):
//   № | Дата на публикуване | УНП | Възложител | Процедура | Обект | Предмет |
//   Прогнозна стойност | Валута | Европейско финансиране
// This module maps that onto synthetic EopTenderRecord[] — the same shape the
// live ЦАИС ЕОП "поръчки" feed produces — so ingest_tenders.ts can normalize the
// two corpora together. The register carries NAMES, not EIKs, which the Tender
// shape requires; we resolve them from our existing corpus exactly as
// normalize_rop.ts does (УНП buyer-prefix first, buyer-name fallback).

import { load } from "cheerio";
import { unpPrefix, normOrgName, type ResolutionMaps } from "./normalize_rop";
import { isValidEik } from "./eik";
import type { EopTenderRecord } from "./eop_tender_types";

const UNP_RE = /^\d{5}-\d{4}-\d{4,}$/;

// "15.05.2018 г." / "15.05.2018" → "2018-05-15". Tolerates the trailing "&nbsp;г."
// the register appends. Returns undefined when unparseable.
export const parseBgDate = (raw: string | undefined): string | undefined => {
  if (!raw) return undefined;
  const s = raw.replace(/\u00A0/g, " ").trim();
  const m = s.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (!m) return undefined;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
};

const cellText = (s: string): string => s.replace(/\u00A0/g, " ").trim();

// One parsed row of the РОП cases (procedure) search table.
export interface RopCaseRow {
  unp: string;
  publishedDate?: string; // ISO YYYY-MM-DD
  buyerName: string;
  procedureType: string;
  object: string; // "Строителство" | "Доставки" | "Услуги"
  subject: string;
  estimatedValue: string; // raw прогнозна стойност cell (normalizer parses it)
  currency: string;
  isEuFunded: boolean; // "Да" in the Европейско финансиране column
}

// Parse one cases-search page's HTML. Columns are fixed (10 <td>); a data row is
// identified by a УНП in column 2. Header / layout rows lack that and are skipped.
export const parseCasesHtml = (html: string): RopCaseRow[] => {
  const $ = load(html);
  const rows: RopCaseRow[] = [];
  $("tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 10) return;
    const c = (i: number): string => cellText($(tds[i]).text());
    const unp = c(2);
    if (!UNP_RE.test(unp)) return;
    rows.push({
      unp,
      publishedDate: parseBgDate(c(1)),
      buyerName: c(3),
      procedureType: c(4),
      object: c(5),
      subject: c(6),
      estimatedValue: c(7),
      currency: c(8) || "BGN",
      isEuFunded: c(9) === "Да",
    });
  });
  return rows;
};

// Resolve a row's buyer EIK: the УНП's 5-digit АОП buyer-register prefix first
// (deterministic, ~98% coverage), then a normalized buyer-name fallback. Returns
// "" when neither resolves (the row is then dropped-and-counted, never guessed).
export const resolveBuyerEik = (
  row: RopCaseRow,
  maps: ResolutionMaps,
): string => {
  const eik =
    maps.awarderByPrefix.get(unpPrefix(row.unp)) ??
    maps.awarderByName.get(normOrgName(row.buyerName)) ??
    "";
  return isValidEik(eik) ? eik : "";
};

// Map a resolved row onto a synthetic EopTenderRecord (procedure-level, no lots).
// `sourceUrl` cites the day's cases-search page; the object string is passed as
// typeOfContract so buildTenders' shared CATEGORY_MAP maps it to works/goods/
// services exactly as it does the live feed.
export const toEopRecord = (
  row: RopCaseRow,
  eik: string,
  sourceUrl: string,
): EopTenderRecord => ({
  uniqueProcurementNumber: row.unp,
  buyerRegistryNumber: eik,
  buyerName: row.buyerName,
  publicationDate: row.publishedDate,
  isLot: "Не",
  procedureType: row.procedureType || undefined,
  typeOfContract: row.object || undefined,
  subject: row.subject || undefined,
  estimatedValue: row.estimatedValue || undefined,
  currency: row.currency || "BGN",
  isEuFunded: row.isEuFunded ? "Да" : "Не",
  sourceUrl,
});
