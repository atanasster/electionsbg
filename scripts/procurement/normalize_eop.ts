// Normalize the ЦАИС ЕОП flat "договори" open-data feed into Contract rows.
//
// Background. We ingest АОП's OCDS "обявления" bundles from data.egov.bg (see
// normalize.ts). That OCDS export is a *strict subset* of what ЦАИС ЕОП itself
// publishes: the daily MinIO buckets at storage.eop.bg carry three flat
// camelCase base files (договори / поръчки / анекси) PLUS the OCDS package, and
// the flat договори file is the superset — it lists ~900 small contracting
// authorities (overwhelmingly schools & kindergartens) whose contracts never
// surface in the OCDS обявления export. In the daily bucket the flat файл is the
// base layer; the OCDS package only enriches it.
//
// This module maps ONE flat договори record to Contract[] (one row per supplier
// — multi-supplier consortia are semicolon-concatenated in the source). It is
// shape-compatible with normalize.ts output so the existing rollup / derived /
// by-settlement machinery consumes it unchanged. The ingest_eop.ts CLI applies
// a gap-fill filter on top (only buyers absent from our corpus) so EOP rows can
// never double-count an OCDS contract.

import { createHash } from "crypto";
import type { Contract, ContractTag } from "./types";
import { canonicalEik, isValidEik } from "./eik";
import { toEur } from "@/lib/currency";
import { normaliseOrgName } from "../lib/normalize_name";

// Stable per-row slug. Mirrors normalize.ts::contractKey exactly so a row's URL
// is stable across re-runs and namespaced away from OCDS rows by the synthetic
// `eop-…` releaseId.
const contractKey = (
  releaseId: string,
  contractId: string | undefined,
  contractorEik: string,
  tag: ContractTag,
): string =>
  createHash("sha256")
    .update(`${releaseId}::${contractId ?? ""}::${contractorEik}::${tag}`)
    .digest("hex")
    .slice(0, 12);

// The flat договори record. Loose on purpose — the feed carries ~55 fields;
// we read the subset that maps onto Contract. Keys are English camelCase.
export interface EopContractRecord {
  noticeId?: number | string;
  publicationDate?: string; // ISO datetime, e.g. "2026-06-12T05:04:28"
  uniqueProcurementNumber?: string; // УНП, e.g. "00515-2025-0066" (= OCDS ocid base)
  procedureType?: string; // "Открита процедура", …
  tenderName?: string;
  tenderMainCpv?: string;
  typeOfContract?: string; // "Строителство" | "Доставки" | "Услуги"
  estimatedValue?: string | number;
  currency?: string; // procurement (estimated) currency
  buyerName?: string;
  buyerRegistryNumber?: string; // authority EIK
  contractNumber?: string; // present iff a contract was signed (keep gate)
  contractDate?: string; // "DD.MM.YYYY"
  contractValue?: string | number;
  contractCurrency?: string;
  contractSubject?: string;
  supplierRegisterNumber?: string; // "EIK" or "EIK1; EIK2; …" for consortia
  supplierName?: string; // "Name1; Name2; …"
  directAwardJustification?: string;
  offersCount?: string | number;
  noAwarding?: string;
}

// "Строителство" / "Доставки" / "Услуги" → the OCDS mainProcurementCategory
// vocabulary our existing rows store, so `category` reads consistently across
// the two feeds.
const CATEGORY_MAP: Record<string, string> = {
  Строителство: "works",
  Доставки: "goods",
  Услуги: "services",
};

// Parse a Bulgarian-formatted decimal: "1 234 567,89" / "5112918,81" /
// "10000000,00" → number. Strip spaces, then if a comma is present treat dots as
// thousands separators and the comma as the decimal point. Returns undefined for
// blank / non-numeric.
const parseBgNumber = (v: string | number | undefined): number | undefined => {
  if (v == null) return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  let s = String(v).trim().replace(/\s/g, "");
  if (s === "") return undefined;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

// "DD.MM.YYYY" → "YYYY-MM-DD"; pass through an already-ISO value. Returns
// undefined when unparseable.
const parseBgDate = (v: string | undefined): string | undefined => {
  if (!v) return undefined;
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return undefined;
};

const toInt = (v: string | number | undefined): number | undefined => {
  if (v == null) return undefined;
  const n = Number(String(v).replace(/\s/g, ""));
  return Number.isInteger(n) && n >= 0 ? n : undefined;
};

// Split a semicolon-concatenated multi-supplier field. The source joins
// consortium members with "; " in both supplierRegisterNumber and supplierName,
// positionally aligned.
const splitMulti = (v: string | undefined): string[] =>
  (v ?? "")
    .split(/\s*;\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

export interface EopNormalizeStats {
  recordsSeen: number;
  recordsSkippedNoContract: number;
  recordsSkippedNoBuyerEik: number;
  rowsEmitted: number;
  rowsDroppedNoSupplierEik: number;
  rowsDroppedSelfDeal: number;
}

const emptyStats = (): EopNormalizeStats => ({
  recordsSeen: 0,
  recordsSkippedNoContract: 0,
  recordsSkippedNoBuyerEik: 0,
  rowsEmitted: 0,
  rowsDroppedNoSupplierEik: 0,
  rowsDroppedSelfDeal: 0,
});

// Normalize one day's flat договори records into Contract[].
//
// `day` is the bucket day (YYYY-MM-DD); `sourceUrl` is the direct
// storage.eop.bg object link (carried verbatim onto every row for citation).
export const normalizeEopDay = (
  records: EopContractRecord[],
  day: string,
  sourceUrl: string,
): { rows: Contract[]; stats: EopNormalizeStats } => {
  const stats = emptyStats();
  const rows: Contract[] = [];
  const bundleUuid = `eop-flat:${day}`;
  const tag: ContractTag = "contract";

  for (const rec of records) {
    stats.recordsSeen++;
    // Keep gate matches the source: a row is a signed contract iff it carries a
    // contract number (announcements without an award are tender-only).
    const contractNumber =
      rec.contractNumber != null ? String(rec.contractNumber).trim() : "";
    if (!contractNumber) {
      stats.recordsSkippedNoContract++;
      continue;
    }
    const buyerEik = canonicalEik(rec.buyerRegistryNumber);
    if (!isValidEik(buyerEik)) {
      stats.recordsSkippedNoBuyerEik++;
      continue;
    }
    const buyerName = normaliseOrgName(rec.buyerName ?? "");

    const unp = (rec.uniqueProcurementNumber ?? "").trim();
    // Synthetic OCDS-style identifiers, namespaced with `eop-` so they can
    // never collide with the data.egov.bg OCDS corpus. The УНП is the natural
    // procedure key; contractNumber distinguishes contracts within a procedure.
    const ocid = `eop-${unp || contractNumber}`;
    const releaseId = `eop-${unp || "x"}-${contractNumber}`;

    const date = parseBgDate(rec.publicationDate) ?? day;
    const dateSigned = parseBgDate(rec.contractDate);
    const amount = parseBgNumber(rec.contractValue);
    const currency = (rec.contractCurrency ?? "").trim() || undefined;
    const amountEur = toEur(amount, currency) ?? undefined;
    const title = (rec.contractSubject || rec.tenderName || "").trim();
    const cpv = (rec.tenderMainCpv ?? "").trim() || undefined;
    const category = rec.typeOfContract
      ? (CATEGORY_MAP[rec.typeOfContract.trim()] ?? undefined)
      : undefined;
    const procurementMethod = (rec.procedureType ?? "").trim() || undefined;
    const procurementMethodRationale =
      (rec.directAwardJustification ?? "").trim() || undefined;
    const numberOfTenderers = toInt(rec.offersCount);

    const eiks = splitMulti(rec.supplierRegisterNumber);
    const names = splitMulti(rec.supplierName);
    if (eiks.length === 0) {
      stats.rowsDroppedNoSupplierEik++;
      continue;
    }
    eiks.forEach((rawEik, i) => {
      const supplierEik = canonicalEik(rawEik);
      if (!isValidEik(supplierEik)) {
        stats.rowsDroppedNoSupplierEik++;
        return;
      }
      const supplierName = normaliseOrgName(names[i] ?? names[0] ?? "");
      // Same self-deal guard as the OCDS path: a supplier EIK equal to the
      // buyer EIK with a divergent name is the upstream's "missing supplier"
      // placeholder, not a real self-contract.
      if (
        supplierEik === buyerEik &&
        normaliseOrgName(supplierName).toLocaleLowerCase("bg") !==
          buyerName.toLocaleLowerCase("bg")
      ) {
        stats.rowsDroppedSelfDeal++;
        return;
      }
      rows.push({
        key: contractKey(releaseId, contractNumber, supplierEik, tag),
        ocid,
        releaseId,
        contractId: contractNumber,
        tag,
        date,
        dateSigned,
        awarderEik: buyerEik,
        awarderName: buyerName,
        // The flat договори feed carries no buyer address — region/locality/
        // postal stay undefined, so these awarders won't resolve to an EKATTE
        // (they're absent from the by-settlement map but present everywhere
        // else). Acceptable for the gap-fill; revisit if a buyer→settlement
        // lookup is added.
        contractorEik: supplierEik,
        contractorEikFull: rawEik !== supplierEik ? rawEik : undefined,
        contractorName: supplierName,
        amount,
        currency,
        amountEur,
        title,
        cpv,
        procurementMethod,
        procurementMethodRationale,
        numberOfTenderers,
        category,
        bundleUuid,
        sourceUrl,
      });
      stats.rowsEmitted++;
    });
  }

  return { rows, stats };
};
