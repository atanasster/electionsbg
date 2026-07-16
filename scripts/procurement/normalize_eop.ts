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

import type { Contract, ContractTag } from "./types";
import { canonicalEik, isValidEik } from "./eik";
import { isUnp } from "./unp";
import { overrideAmount } from "./amount_overrides";
import { toEur } from "@/lib/currency";
import { normaliseOrgName } from "../lib/normalize_name";
import { disambiguateContractKeys, hashKey } from "./contract_key";

// Stable per-row BASE slug. Mirrors normalize.ts::contractKey exactly so a row's
// URL is stable across re-runs and namespaced away from OCDS rows by the
// synthetic `eop-…` releaseId. The flat feed already carries a contractNumber in
// both the releaseId and contractId, so collisions are practically impossible —
// the disambiguation pass below is kept only to stay symmetric with the other
// two generators.
const contractKey = (
  releaseId: string,
  contractId: string | undefined,
  contractorEik: string,
  tag: ContractTag,
): string =>
  hashKey(`${releaseId}::${contractId ?? ""}::${contractorEik}::${tag}`);

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
export const parseBgNumber = (
  v: string | number | undefined,
): number | undefined => {
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

// Resolve the contracting authority from `buyerRegistryNumber`, which is
// USUALLY a single EIK but is occasionally a semicolon-joined list — either a
// genuine joint procurement or (as on АПИ's big road contracts) a control body
// such as the АДФИ listed *alongside* the real authority, e.g.
// "175076479999; 000695089" (АДФИ; АПИ) with the aligned names in `buyerName`.
//
// Single-token fields keep their historical behaviour exactly. For a multi-token
// field we deliberately DROP it (return "") in the general feed — picking one
// primary buyer for arbitrary joint procurements is out of scope and could
// mis-attribute. Only when the caller passes a `prefer` set (the scoped
// gap-fill's --only-buyers whitelist) do we recover the record under the
// whitelisted authority, taking its positionally-aligned name. This keeps the
// incremental path — and its double-count invariant — byte-for-byte unchanged.
export const resolvePrimaryBuyer = (
  rawEik: string | undefined,
  rawName: string | undefined,
  prefer?: Set<string>,
): { eik: string; name: string } => {
  const eikToks = splitMulti(rawEik);
  if (eikToks.length <= 1) {
    return { eik: canonicalEik(rawEik), name: (rawName ?? "").trim() };
  }
  if (!prefer) return { eik: "", name: "" };
  const canons = eikToks.map((t) => canonicalEik(t));
  const idx = canons.findIndex((c) => isValidEik(c) && prefer.has(c));
  if (idx < 0) return { eik: "", name: "" };
  const nameToks = splitMulti(rawName);
  return { eik: canons[idx], name: (nameToks[idx] ?? nameToks[0] ?? "").trim() };
};

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
  opts?: { preferBuyers?: Set<string> },
): { rows: Contract[]; stats: EopNormalizeStats } => {
  const stats = emptyStats();
  const rows: Contract[] = [];
  // Per-row discriminator, aligned 1:1 with `rows` (see disambiguateContractKeys
  // below). Practically never used — the eop base key already separates rows.
  const discs: string[] = [];
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
    const { eik: buyerEik, name: buyerRawName } = resolvePrimaryBuyer(
      rec.buyerRegistryNumber,
      rec.buyerName,
      opts?.preferBuyers,
    );
    if (!isValidEik(buyerEik)) {
      stats.recordsSkippedNoBuyerEik++;
      continue;
    }
    const buyerName = normaliseOrgName(buyerRawName);

    // `uniqueProcurementNumber` is NOT always a УНП: for some ЦАИС-internal
    // procedures the source publishes a `T…` id (e.g. "T56644") in the same
    // field. Those still shape the ocid — which is where the `eop-T…` namespace
    // comes from — but they must never reach `Contract.unp`, whose whole purpose
    // is to join `tenders.unp`. Validate before emitting.
    const procedureRef = (rec.uniqueProcurementNumber ?? "").trim();
    const unp = isUnp(procedureRef) ? procedureRef : undefined;
    // Synthetic OCDS-style identifiers, namespaced with `eop-` so they can
    // never collide with the data.egov.bg OCDS corpus. The УНП is the natural
    // procedure key; contractNumber distinguishes contracts within a procedure.
    const ocid = `eop-${procedureRef || contractNumber}`;
    const releaseId = `eop-${procedureRef || "x"}-${contractNumber}`;

    const date = parseBgDate(rec.publicationDate) ?? day;
    const dateSigned = parseBgDate(rec.contractDate);
    // The FULL contract value, before the multi-supplier split below. Publisher
    // amount errors are corrected here (see amount_overrides.ts) so the split
    // and every downstream aggregate work off the true figure.
    const rawAmount = parseBgNumber(rec.contractValue);
    const amount =
      overrideAmount({
        unp,
        ocid,
        contractId: contractNumber,
        amount: rawAmount,
      }) ?? rawAmount;
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
    // A multi-supplier award (consortium members or parallel framework winners)
    // repeats the SAME total contractValue on every supplier in the flat feed.
    // Crediting each supplier the full value would multiply one award's money by
    // the supplier count (a €1.3bn drug framework awarded to six distributors
    // would read as €7.8bn). Split it across the valid suppliers so the rows sum
    // back to the awarded total — the way SIGMA reports framework totals.
    const validSupplierCount =
      eiks.filter((e) => isValidEik(canonicalEik(e))).length || 1;
    const amountPer = amount != null ? amount / validSupplierCount : amount;
    const amountEurPer =
      amountEur != null ? amountEur / validSupplierCount : amountEur;
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
        // Undefined when the source published no УНП, or a `T…` internal id in
        // its place — those rows have no procedure to join to. Never synthesise
        // one from the contract number or the T-id.
        unp,
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
        amount: amountPer,
        currency,
        amountEur: amountEurPer,
        title,
        cpv,
        procurementMethod,
        procurementMethodRationale,
        numberOfTenderers,
        category,
        bundleUuid,
        sourceUrl,
      });
      discs.push(`${amountPer ?? ""}`);
      stats.rowsEmitted++;
    });
  }

  // Symmetric with the OCDS / legacy generators: re-key any within-day base-key
  // collision (a republished contract is collapsed, not split, because it shares
  // both base key and discriminator).
  disambiguateContractKeys(rows, (i) => discs[i]);

  return { rows, stats };
};
