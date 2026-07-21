// Normalize the ЦАИС ЕОП flat "поръчки" (tenders) open-data feed into Tender
// records — the tender-STAGE counterpart to normalize_eop.ts (which handles the
// sibling "договори" signed-contracts feed).
//
// Why a separate record type (not an extension of Contract). A tender is the
// PROCEDURE, before any contract exists: it has an *estimated* (прогнозна) value
// — a forecast, NOT money spent — no contractor, and a fundamentally different
// lifecycle (active → cancelled / contracted). Conflating estimated tender value
// with contracted spend is exactly the мантинели dispute ("поскъпна 4 пъти") and
// the legacy "-x" re-inflation trap, so estimated value is QUARANTINED in its own
// field and never folded into any contracted-spend aggregate. See
// docs/plans/procurement-tenders-ingest-v1.md §12.
//
// Identity & lineage. The feed carries TWO keys:
//   - uniqueProcurementNumber (УНП, e.g. "00044-2025-0125") — the human procedure
//     number that groups a procedure's parent notice + its per-lot rows, and the
//     join key КЗК cites. This is the Tender's primary key.
//   - tenderId — the per-notice numeric id. The PROCEDURE-level (parent) tenderId
//     equals the OCDS ocid suffix: ocid = `ocds-e82gsb-<parentTenderId>`. That is
//     the free lineage link back to the signed contract in the OCDS corpus.
// (Lots each carry their own tenderId but share the УНП; the contract attaches to
// the parent tenderId — validated against the corpus, 116 parent vs 0 lot hits.)
//
// One Tender per УНП. The feed emits one parent row (isLot="Не", carries
// lotsCount + the procedure total) plus one row per lot (isLot="Да", carries the
// lot's own estimated value). A procedure can re-appear across days (correction /
// change notice); the latest publicationDate wins for the procedure-level fields.

import { tendersDayUrl, type EopTenderRecord } from "./eop_tender_types";
import { canonicalEik, isValidEik } from "./eik";
import { toEur } from "@/lib/currency";
import type { Tender, TenderLot } from "@/lib/tenderTypes";
import { normaliseOrgName } from "../lib/normalize_name";

// "Строителство" / "Доставки" / "Услуги" → the OCDS mainProcurementCategory
// vocabulary the contracts corpus stores, so `contractType` reads consistently
// across the tender and contract trees.
const CATEGORY_MAP: Record<string, string> = {
  Строителство: "works",
  Доставки: "goods",
  Услуги: "services",
};

// Parse a Bulgarian-formatted decimal: "1 234 567,89" / "960000000,00" →
// number. Mirrors normalize_eop.ts::parseBgNumber. Returns undefined for blank /
// non-numeric.
const parseBgNumber = (v: string | number | undefined): number | undefined => {
  if (v == null) return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  let s = String(v).trim().replace(/\s/g, "");
  if (s === "") return undefined;
  if (s.includes(",")) {
    // comma-decimal, dots are thousands separators ("1.234.567,89")
    s = s.replace(/\./g, "").replace(",", ".");
  } else if ((s.match(/\./g) ?? []).length > 1) {
    // dot-grouped with no decimal comma ("1.234.567") — strip the dot
    // separators rather than silently dropping the value at the regex below.
    s = s.replace(/\./g, "");
  }
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

// ISO datetime / "DD.MM.YYYY" → "YYYY-MM-DD". Returns undefined when unparseable.
const truncDate = (v: string | undefined): string | undefined => {
  if (!v) return undefined;
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return undefined;
};

// "Да" → true, "Не" → false, "" / null → undefined. The feed uses Bulgarian
// yes/no tokens for every boolean flag.
const yesNo = (v: string | undefined): boolean | undefined => {
  const s = (v ?? "").trim();
  if (s === "Да") return true;
  if (s === "Не") return false;
  return undefined;
};

const trimOr = (v: string | null | undefined): string | undefined => {
  const s = (v ?? "").trim();
  return s === "" ? undefined : s;
};

const toInt = (v: string | number | undefined): number | undefined => {
  if (v == null || v === "") return undefined;
  const n = Number(String(v).replace(/\s/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

// The Tender / TenderLot shape lives in src/lib/tenderTypes.ts (shared with the
// FE hook) so the writer and reader can't drift. Re-exported here so existing
// importers (`ingest_tenders.ts`) keep their `from "./normalize_eop_tender"`.
export type { Tender, TenderLot };

export interface TenderNormalizeStats {
  recordsSeen: number;
  recordsSkippedNoUnp: number;
  recordsSkippedNoBuyerEik: number;
  proceduresEmitted: number;
  lotsEmitted: number;
  cancelled: number;
  /** Procedures that published only lot rows (no parent) — their headline
   *  estimate is the SUM of the lots, not one lot's value. Observability for
   *  the otherwise-silent lot-only path. */
  proceduresFromLot: number;
}

// Day-bucket URL builder — shared with the ingest (see eop_tender_types).
const dayUrl = tendersDayUrl;

// A record tagged with the bucket day it was fetched from.
export interface DatedTenderRecord {
  day: string;
  rec: EopTenderRecord;
}

// Build one Tender per УНП from EVERY cached day's records. Grouping is by УНП
// (which spans days), so this takes the whole corpus at once rather than
// per-day. The procedure's latest publication wins for procedure-level fields.
export const buildTenders = (
  dated: DatedTenderRecord[],
): { tenders: Tender[]; stats: TenderNormalizeStats } => {
  const stats: TenderNormalizeStats = {
    recordsSeen: 0,
    recordsSkippedNoUnp: 0,
    recordsSkippedNoBuyerEik: 0,
    proceduresEmitted: 0,
    lotsEmitted: 0,
    cancelled: 0,
    proceduresFromLot: 0,
  };

  // Group by УНП.
  const byUnp = new Map<string, DatedTenderRecord[]>();
  for (const d of dated) {
    stats.recordsSeen++;
    const unp = (d.rec.uniqueProcurementNumber ?? "").trim();
    if (!unp) {
      stats.recordsSkippedNoUnp++;
      continue;
    }
    const arr = byUnp.get(unp) ?? [];
    arr.push(d);
    byUnp.set(unp, arr);
  }

  // Sort key: latest publication first (procedure-level fields take the most
  // recent notice — a correction / change notice supersedes the original).
  const pubTime = (r: EopTenderRecord): number =>
    Date.parse((r.publicationDate ?? "").replace(" ", "T")) || 0;

  const tenders: Tender[] = [];
  for (const [unp, recs] of byUnp) {
    const parents = recs.filter((d) => yesNo(d.rec.isLot) !== true);
    const lotRecs = recs.filter((d) => yesNo(d.rec.isLot) === true);
    // Choose the procedure-level row: prefer an explicit parent (isLot≠Да),
    // latest publication; fall back to the latest lot row when a procedure
    // published only its lots into a cached day.
    const procPool = parents.length > 0 ? parents : lotRecs;
    if (procPool.length === 0) continue;
    const head = procPool
      .slice()
      .sort((a, b) => pubTime(b.rec) - pubTime(a.rec))[0];
    const p = head.rec;

    const buyerEik = canonicalEik(p.buyerRegistryNumber);
    if (!isValidEik(buyerEik)) {
      stats.recordsSkippedNoBuyerEik++;
      continue;
    }

    const currency = trimOr(p.currency);
    const estNative = parseBgNumber(p.estimatedValue);
    const estEur = toEur(estNative, currency) ?? undefined;
    const tenderId = toInt(p.tenderId);

    // Dedupe lots by tenderId (latest publication wins) and sort for stability.
    const lotByTid = new Map<string, DatedTenderRecord>();
    lotRecs.forEach((d) => {
      // Prefer a stable id; when both are absent fall back to a CONTENT key
      // (name+value), not the array index, so re-ordering can't shift which lot
      // wins the latest-publication merge.
      const k = String(
        toInt(d.rec.tenderId) ??
          d.rec.lotIdentifier ??
          `${d.rec.lotTenderName ?? d.rec.subject ?? ""}|${d.rec.estimatedValue ?? ""}`,
      );
      const prev = lotByTid.get(k);
      if (!prev || pubTime(d.rec) >= pubTime(prev.rec)) lotByTid.set(k, d);
    });
    const lots: TenderLot[] = [...lotByTid.values()]
      .map((d, i): TenderLot => {
        const r = d.rec;
        // The feed omits the currency token on most lot rows (8.6k records,
        // almost all pre-2026 leva). Inherit the procedure's currency so the
        // lot's value still converts at the peg instead of being dropped.
        const cur = trimOr(r.currency) ?? currency;
        const lotNative = parseBgNumber(r.estimatedValue);
        return {
          lotId: trimOr(r.lotIdentifier) ?? String(i + 1),
          tenderId: toInt(r.tenderId),
          name: trimOr(r.lotTenderName) ?? trimOr(r.subject),
          cpv: trimOr(r.mainCpvCode),
          estimatedValueNative: lotNative,
          currency: cur,
          estimatedValueEur: toEur(lotNative, cur) ?? undefined,
          nuts: trimOr(r.executionPlaceNuts),
        };
      })
      .sort((a, b) => a.lotId.localeCompare(b.lotId, "bg", { numeric: true }));

    // Lot-only procedure (no parent row): `head` is the latest LOT, so its
    // value would understate the headline to a single lot. Use the SUM of the
    // lots so estimatedValueEur === Σ lots[].estimatedValueEur (F-007).
    let procEstNative = estNative;
    let procEstEur = estEur;
    if (parents.length === 0 && lots.length > 0) {
      stats.proceduresFromLot++;
      procEstEur =
        lots.reduce((s, l) => s + (l.estimatedValueEur ?? 0), 0) || undefined;
      const sameCurrency = lots.every(
        (l) => !l.currency || l.currency === currency,
      );
      procEstNative = sameCurrency
        ? lots.reduce((s, l) => s + (l.estimatedValueNative ?? 0), 0) ||
          undefined
        : undefined;
    }

    const isCancelled = yesNo(p.isCancelled) === true;
    if (isCancelled) stats.cancelled++;

    tenders.push({
      unp,
      ocid: tenderId != null ? `ocds-e82gsb-${tenderId}` : undefined,
      tenderId,
      noticeId: toInt(p.noticeId),
      publicationDate: truncDate(p.publicationDate) ?? head.day,
      buyerEik,
      buyerName: normaliseOrgName(p.buyerName ?? ""),
      buyerType: trimOr(p.buyerType),
      buyerMainActivity: trimOr(p.buyerMainActivity),
      subject: (p.subject ?? p.lotTenderName ?? "").trim(),
      noticeType: trimOr(p.noticeType),
      procedureType: trimOr(p.procedureType),
      awardMethod: trimOr(p.awardMethod),
      legalBasis: trimOr(p.legalBasis),
      contractType: p.typeOfContract
        ? CATEGORY_MAP[p.typeOfContract.trim()]
        : undefined,
      cpv: trimOr(p.mainCpvCode),
      cpvDesc: trimOr(p.mainCpvDescription),
      estimatedValueNative: procEstNative,
      currency,
      estimatedValueEur: procEstEur,
      lotsCount: toInt(p.lotsCount) ?? (lots.length || undefined),
      lots,
      submissionDeadline: trimOr(p.submissionDeadline),
      isCancelled,
      isFrameworkAgreement: yesNo(p.isFrameworkAgreement),
      isEuFunded: yesNo(p.isEuFunded),
      euProgram: trimOr(p.europeanProgram),
      hasUnsecuredFunding: yesNo(p.hasUnsecuredFunding),
      nuts: trimOr(p.executionPlaceNuts),
      linkToOjEu: trimOr(p.linkToOjEu),
      changeNoticeCount: toInt(p.changeNoticeCount),
      sourceDay: head.day,
      // Pre-2020 РОП rows carry their own aop.bg cases-search URL; the live ЦАИС
      // feed leaves it unset and falls back to the storage.eop.bg day bucket.
      sourceUrl: trimOr(p.sourceUrl) ?? dayUrl(head.day),
    });
    stats.proceduresEmitted++;
    stats.lotsEmitted += lots.length;
  }

  return { tenders, stats };
};
