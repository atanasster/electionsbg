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
import { classifySupplierId } from "./supplier_identity";
import { isUnp } from "./unp";
import { overrideAmount } from "./amount_overrides";
import { toEur } from "@/lib/currency";
import { normaliseOrgName } from "../lib/normalize_name";
import { disambiguateContractKeys, releaseContractKey } from "./contract_key";

// Stable per-row BASE slug. Mirrors normalize.ts::contractKey exactly so a row's
// URL is stable across re-runs and namespaced away from OCDS rows by the
// synthetic `eop-…` releaseId. The flat feed already carries a contractNumber in
// both the releaseId and contractId, so collisions are practically impossible —
// the disambiguation pass below is kept only to stay symmetric with the other
// two generators.
const contractKey = releaseContractKey;

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

// Resolve a supplier token to a contractor key. Thin wrapper over the shared
// classifier in supplier_identity.ts, which owns the full rule set — a clean BG EIK
// passes through, a messy one is recovered, an ЕГН is replaced by a name-derived
// `np-…` key so a personal identity number is never stored, and a genuine foreign
// vendor is kept keyed by its registration id rather than dropped.
//
// The `{eik, foreign}` shape is deliberately preserved: call sites branch on
// `.foreign`, and the existing tests deepEqual against exactly these two fields.
// Callers that need to distinguish a person from a foreign vendor should use
// `classifySupplierId` directly and read `.kind`.
export const resolveSupplierEik = (
  raw: string | undefined,
  name?: string,
): { eik: string; foreign: boolean } => {
  const { eik, foreign } = classifySupplierId(raw, name);
  return { eik, foreign };
};

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
// Financial-control / oversight organs that appear in a multi-buyer field
// ALONGSIDE the real procuring authority — never as the actual buyer. АДФИ rides
// on АПИ's big road contracts ("175076479999; 000695089"), often listed FIRST.
// When recovering a multi-buyer record to its primary buyer we skip these so the
// contract lands on the real authority (АПИ), matching the retired --only-buyers
// whitelist's attribution. Extend as new co-listed organs surface.
export const CONTROL_ORGAN_EIKS = new Set<string>([
  "175076479999", // АДФИ — Агенция за държавна финансова инспекция
]);

export const resolvePrimaryBuyer = (
  rawEik: string | undefined,
  rawName: string | undefined,
  prefer?: Set<string>,
  recoverToPrimary?: boolean,
): { eik: string; name: string } => {
  const eikToks = splitMulti(rawEik);
  if (eikToks.length <= 1) {
    return { eik: canonicalEik(rawEik), name: (rawName ?? "").trim() };
  }
  const canons = eikToks.map((t) => canonicalEik(t));
  const nameToks = splitMulti(rawName);
  const pick = (idx: number) => ({
    eik: canons[idx],
    name: (nameToks[idx] ?? nameToks[0] ?? "").trim(),
  });
  // A whitelist wins: recover under the named authority (the --only-buyers path).
  if (prefer) {
    const idx = canons.findIndex((c) => isValidEik(c) && prefer.has(c));
    return idx < 0 ? { eik: "", name: "" } : pick(idx);
  }
  // Otherwise: DROP by default (a joint-procurement field could mis-attribute,
  // and the incremental path relies on this for its double-count invariant).
  // But under `recoverToPrimary` (the content-deduped cross-source path, where
  // double-count is impossible) attribute to the PRIMARY — the first valid buyer
  // that is NOT a co-listed control organ — rather than lose a real contract
  // (~653 rows / €1.16bn). Skipping control organs keeps АПИ's road contracts on
  // АПИ (not the АДФИ often listed first), matching the retired --only-buyers path.
  if (!recoverToPrimary) return { eik: "", name: "" };
  const realIdx = canons.findIndex(
    (c) => isValidEik(c) && !CONTROL_ORGAN_EIKS.has(c),
  );
  const idx = realIdx >= 0 ? realIdx : canons.findIndex((c) => isValidEik(c));
  return idx < 0 ? { eik: "", name: "" } : pick(idx);
};

export interface EopNormalizeStats {
  recordsSeen: number;
  recordsSkippedNoContract: number;
  recordsSkippedNoBuyerEik: number;
  rowsEmitted: number;
  rowsDroppedNoSupplierEik: number;
  rowsDroppedSelfDeal: number;
  // Split by resolved kind, so the log distinguishes "kept a foreign vendor" from
  // "encoded a natural person" from "kept an identity-less row". Before this the three
  // shared one drop counter, which is how the mixed-consortium drop stayed invisible.
  rowsForeignKept: number;
  rowsPersonEncoded: number;
  rowsAnonymous: number;
  rowsPlaceholderEstimate: number;
  rowsJointToPrimary: number;
}

const emptyStats = (): EopNormalizeStats => ({
  recordsSeen: 0,
  recordsSkippedNoContract: 0,
  recordsSkippedNoBuyerEik: 0,
  rowsEmitted: 0,
  rowsDroppedNoSupplierEik: 0,
  rowsDroppedSelfDeal: 0,
  rowsForeignKept: 0,
  rowsPersonEncoded: 0,
  rowsAnonymous: 0,
  rowsPlaceholderEstimate: 0,
  rowsJointToPrimary: 0,
});

// Normalize one day's flat договори records into Contract[].
//
// `day` is the bucket day (YYYY-MM-DD); `sourceUrl` is the direct
// storage.eop.bg object link (carried verbatim onto every row for citation).
export const normalizeEopDay = (
  records: EopContractRecord[],
  day: string,
  sourceUrl: string,
  opts?: { preferBuyers?: Set<string>; recoverJointToPrimary?: boolean },
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
      opts?.recoverJointToPrimary,
    );
    if (!isValidEik(buyerEik)) {
      stats.recordsSkippedNoBuyerEik++;
      continue;
    }
    if (String(rec.buyerRegistryNumber ?? "").includes(";"))
      stats.rowsJointToPrimary++;
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
    // Keep null when the source carries no signing date — the cross-source dedup
    // content keys (content_key.ts) hash on `dateSigned`, and a per-feed
    // publication-date fallback here would diverge between the OCDS and ЦАИС ЕОП
    // twins and defeat EOP-twin eviction. The always-populated `date_signed`
    // invariant is enforced downstream at load time (load_pg.ts backfill).
    const dateSigned = parseBgDate(rec.contractDate);
    // The FULL contract value, before the multi-supplier split below. Publisher
    // amount errors are corrected here (see amount_overrides.ts) so the split
    // and every downstream aggregate work off the true figure.
    const rawAmount = parseBgNumber(rec.contractValue);
    // Placeholder contract value: the publisher signed the contract but left the
    // amount field a stub ("0,01" / "1,20") instead of the real figure. Fall back
    // to the procedure's estimated value (in the estimate's own currency), as
    // SIGMA does — booking €0 for a real award under-counts the buyer (~715 rows
    // / €330M). Overrides still win (they target the corrupt figure, not a stub).
    const estValue = parseBgNumber(rec.estimatedValue);
    const usePlaceholderEstimate =
      rawAmount != null && rawAmount < 1 && estValue != null && estValue > 1;
    const amount =
      overrideAmount({
        unp,
        ocid,
        contractId: contractNumber,
        amount: rawAmount,
      }) ?? (usePlaceholderEstimate ? estValue : rawAmount);
    const currency = usePlaceholderEstimate
      ? (rec.currency ?? rec.contractCurrency ?? "").trim() || undefined
      : (rec.contractCurrency ?? "").trim() || undefined;
    if (usePlaceholderEstimate) stats.rowsPlaceholderEstimate++;
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
    // would read as €7.8bn). Split it across the suppliers so the rows sum back
    // to the awarded total — the way SIGMA reports framework totals.
    //
    // Resolve each supplier: a clean BG EIK, a BG EIK recovered from a messy id, a
    // name-keyed natural person, or a foreign vendor keyed by its registration id.
    //
    // EVERY resolved supplier is now kept. Previously a non-BG member of a MIXED
    // consortium was dropped and foreign suppliers survived only when a contract had no
    // BG supplier at all (`recoverForeign = bgCount === 0`). That deleted the real
    // counterparty from the record: on УНП 00042-2024-0005 (МТС, €451.5m, 35 EMUs) the
    // source names four suppliers — КОНСОРЦИУМ БУЛЕМУ, ALSTOM TRANSPORT SA,
    // Alstom Ferroviaria SpA, РВП ИНВЕСТ ЕООД — and the corpus held two, so searching it
    // for "Alstom" returned nothing on the contract that bought Alstom trains.
    // Corpus-wide: 211 awards / €987m carried a dropped foreign member.
    //
    // It also silently dropped natural PERSONS once they became name-keyed (a person is
    // `foreign: true` because the key is synthetic, not a validated EIK), which would
    // have removed them from 7 mixed groups.
    //
    // Keeping everyone does NOT inflate the corpus: `rebuild_consortium()` (087) moves the
    // full value onto one carrier row and zeroes the members, so a joint award totals the
    // same at any member count. Where a group has a named ДЗЗД/Консорциум member the value
    // stays on it and this only ADDS zero-value participation rows (90 awards, €1,320m,
    // including the Alstom contract). Where it does not, 087 mints a synthetic `obed-`
    // carrier and the BG members that carry the money today drop to €0 — 47 awards, €493m,
    // a deliberate attribution change (plan §4, decision D1): we do not know each member's
    // share, so crediting one member the whole value is the less honest option.
    //
    // The aligned name is passed in because a natural-person supplier is keyed by their
    // NAME, not by the ЕГН the feed puts in the id field (supplier_identity.ts).
    // `names[i] ?? names[0]` mirrors the supplierName fallback used below.
    const resolved = eiks.map((e, i) =>
      classifySupplierId(e, names[i] ?? names[0]),
    );
    // "Keep everyone" means everyone with an IDENTITY. An identity-less token — a withheld
    // marker ("не се публикува", 732 in the raw corpus) or Cyrillic junk that leaves nothing
    // after the ASCII strip ("неприложимо", "БЕЗ ЕИК", "хххх", 70 more) — resolves to
    // `eik: ""` and must NOT become a member, for a reason that is invisible until it bites:
    //
    // 087's `_named_carrier` picks the ДЗЗД-named row with `ORDER BY contractor_eik`, and
    // `'' < '203250840'`. The feed routinely publishes the ДЗЗД name BESIDE a withheld id,
    // because an unincorporated ДЗЗД has no ЕИК — e.g. УНП 00024-2021-0005,
    // "…; не е наличен" / "…; ДЗЗД „ТРАНС БГ“". So the empty-eik row wins the carrier slot
    // over a real firm, the whole award value lands on `contractor_eik = ''`, and every
    // contractor-side aggregate (018/025/026/027/028/029/031/033/038/122/127,
    // contractor_search) filters it out. Corpus totals still reconcile and invariants_pg
    // stays green, so nothing fails — the money simply stops being attributed to anyone.
    // Measured: 54 awards / €100.2m, 38 of them inside the T2 re-ingest window.
    //
    // Pre-T1 these were dropped in any MIXED record (they carried `foreign: true` and only
    // survived when `bgCount === 0`). That behaviour is restored exactly: identity-less rows
    // are kept only when NO supplier in the record has an identity, which is the documented
    // all-anonymous case where the value legitimately lands on the buyer with no contractor
    // (see the all-anonymous test in normalize_eop.test.ts).
    const anyIdentified = resolved.some((r) => r.eik !== "");
    const keep = (r: { eik: string }): boolean =>
      r.eik !== "" || !anyIdentified;
    // Split by the number of rows that will actually SURVIVE the month-shard
    // rowKey merge (releaseId::contractId::contractorEik::tag), not the raw
    // supplier count: rows sharing a contractorEik collapse to one, so
    // identity-less anonymous suppliers (eik "") — and any duplicated EIK —
    // count ONCE. Using the raw count here divides the value by phantom rows
    // that then merge away, silently losing (N-1)/N of the contract.
    const keptKeys = new Set(resolved.filter(keep).map((r) => r.eik));
    const denom = keptKeys.size || 1;
    const amountPer = amount != null ? amount / denom : amount;
    const amountEurPer = amountEur != null ? amountEur / denom : amountEur;
    resolved.forEach((res, i) => {
      const rawEik = eiks[i];
      const supplierEik = res.eik;
      if (!keep(res)) {
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
      if (res.kind === "foreign") stats.rowsForeignKept++;
      else if (res.kind === "person") stats.rowsPersonEncoded++;
      else if (res.kind === "anonymous") stats.rowsAnonymous++;
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
        // Preserve the raw source id when it differs from the canonical key
        // (13-digit branch form, or a foreign / messy-BG id we normalized).
        //
        // NEVER for a natural person: the key is a name hash, so the raw token ALWAYS
        // differs and this field would faithfully re-publish the ЕГН that
        // `classifySupplierId` just removed — into `contracts.contractor_eik_full`,
        // the sibling of the very column the privacy gate guards.
        contractorEikFull:
          res.kind !== "person" && supplierEik && rawEik !== supplierEik
            ? rawEik
            : undefined,
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
