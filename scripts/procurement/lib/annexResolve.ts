// Shared Registry-Agency annex ("анекси") → contract identity resolution.
//
// Extracted from anexi_current_value.ts so that TWO consumers resolve an annex
// to its contract by the SAME K2→K1 keys and the SAME three guards:
//   • anexi_current_value.ts — folds each contract's annexes to its current value
//     and flips amountEur (the ~€2.2bn current-basis corpus).
//   • load_annexes_pg.ts (114) — stores the per-annex modification rows, keyed to
//     the contract, so we can say "one annex at the cap, or several summing to it".
// A second, divergent notion of "this contract's annexes" would be worse than
// none (docs/plans/procurement-risk-v2.md §0b) — hence one module, two callers.
//
// Identity join — K2 first, but K2 refuses ambiguity (precision over recall; a
// wrong current value is worse than none):
//   K2  proper УНП + supplierEik               (lot-agnostic; REFUSES when its
//       annexes span >1 distinct contract number — see resolveAnnexKey)
//   K1  buyerEik + normalized contractNumber   (contract-precise fallback)
// K2 is NOT collision-free on its own: one supplier can hold several contracts
// under one procedure (Дансон трейдинг held two under 00536-2023-0049), and the
// merged accumulator then anchors on contract A's earliest annex while serving
// contract B's latest value — every guard passes and the fold flips A to B's
// value (−€193,352.65 on that contract). Hence the ambiguity refusal.

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { canonicalEik } from "../eik";
import { toEur } from "@/lib/currency";
import type { Contract } from "../types";
import type { EopAnnexRecord } from "../ingest_anexi";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ANEXI_CACHE_DIR = path.resolve(
  __dirname,
  "../../../raw_data/procurement/anexi",
);

// "1 234 567,89" / "5112918,81" → number; undefined when blank/non-numeric.
export const parseBgNumber = (v: unknown): number | undefined => {
  if (v == null) return undefined;
  let s = String(v).trim().replace(/\s/g, "");
  if (!s) return undefined;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

// Normalise a contract number for matching (same rule as ingest_eop.ts): the two
// feeds format punctuation/№/whitespace inconsistently.
export const normContractNo = (s: string | undefined): string =>
  (s ?? "").toLocaleLowerCase("bg").replace(/[\s".,\-_/№#]/g, "");

export const normEik = (e: string | undefined): string => canonicalEik(e) || "";
export const UNP_RE = /^\d{5}-\d{4}-\d{4}$/;

// Per contract-identity annex accumulator. Values are FULL (all suppliers); our
// contract rows hold a per-supplier SPLIT share (normalize_eop divides by
// validSupplierCount), so both the current value AND the continuity anchor are
// divided by the SAME count — otherwise a consortium split N ways credits the
// full value to each of N rows (an N× overcount).
export interface AnnexAcc {
  curEurFull: number;
  curSupplierCount: number; // informational only — perSupplier divides by lastSupplierCount
  curSuppliers: string[]; // suppliers on the latest annex — disambiguates key collisions
  curPub: string;
  lastEurFull: number; // value before the earliest annex (≈ signing, FULL)
  lastSupplierCount: number;
  lastPub: string;
  // Distinct identities merged into this accumulator, for the ambiguity refusal:
  // normalized non-empty contract numbers (checked by K2 — >1 means this
  // УНП+supplier key mixed annexes of different contracts) and proper УНП
  // (checked by K1 — >1 means this buyer reused a contract number across
  // procedures). Empty/unpublished values are not collected: only a PROVEN
  // second contract refuses the key. Storage-side note: both maps materialize
  // both sets, but per map only one is informative — a K1 accumulator's
  // contractNos is always the singleton of its own key component, and a K2
  // accumulator's unps likewise; the unified put() keeps that cost for
  // simplicity.
  contractNos: Set<string>;
  unps: Set<string>;
}

// One stored annex modification row (only built when retainRecords is set).
export interface AnnexRecordRow {
  noticeId: number | null;
  lotIdentifier: string | null;
  publicationDate: string | null;
  contractDate: string | null;
  currency: string | null;
  lastValueEur: number | null;
  currentValueEur: number | null;
  valueDiffEur: number | null;
  changeReason: string | null;
  changeReasonDescription: string | null;
  changeDescription: string | null;
  directAwardJustification: string | null;
}

export interface AnnexIndex {
  byContractNo: Map<string, AnnexAcc>; // K1
  byUnpSupplier: Map<string, AnnexAcc>; // K2
  // Populated only when buildAnnexIndex({ retainRecords: true }); the raw
  // per-annex rows under each key, for the annexes TABLE loader.
  recordsByContractNo?: Map<string, AnnexRecordRow[]>;
  recordsByUnpSupplier?: Map<string, AnnexRecordRow[]>;
}

interface AnnexObs {
  curEurFull: number;
  lastEurFull: number | undefined;
  suppliers: string[];
  pub: string;
  contractNo: string; // normalized; "" when the annex published none
  unp: string; // proper УНП; "" when absent/ЦАИС "T…" id
}

// Fold one annex observation into a key's accumulator: latest pub wins for the
// current value, earliest pub wins for the signing anchor.
// ⚠️ On EQUAL pub the FIRST observation wins (the `>`/`<` comparisons are
// strict), so `curSuppliers` is order-sensitive when two annexes share a pub
// string (pub = publicationDate ?? contractDate can tie across files). This is
// deterministic only because buildAnnexIndex iterates files in sorted order and
// preserves within-file source order — do not remove that `.sort()`.
const put = (m: Map<string, AnnexAcc>, key: string, o: AnnexObs): void => {
  const supplierCount = Math.max(1, o.suppliers.length);
  const prev = m.get(key);
  if (!prev) {
    m.set(key, {
      curEurFull: o.curEurFull,
      curSupplierCount: supplierCount,
      curSuppliers: o.suppliers,
      curPub: o.pub,
      lastEurFull: o.lastEurFull ?? o.curEurFull,
      lastSupplierCount: supplierCount,
      lastPub: o.pub,
      contractNos: new Set(o.contractNo ? [o.contractNo] : []),
      unps: new Set(o.unp ? [o.unp] : []),
    });
    return;
  }
  if (o.contractNo) prev.contractNos.add(o.contractNo);
  if (o.unp) prev.unps.add(o.unp);
  if (o.pub > prev.curPub) {
    prev.curEurFull = o.curEurFull;
    prev.curSupplierCount = supplierCount;
    prev.curSuppliers = o.suppliers;
    prev.curPub = o.pub;
  }
  if (o.pub < prev.lastPub) {
    prev.lastEurFull = o.lastEurFull ?? o.curEurFull;
    prev.lastSupplierCount = supplierCount;
    prev.lastPub = o.pub;
  }
};

const pushRecord = (
  m: Map<string, AnnexRecordRow[]>,
  key: string,
  row: AnnexRecordRow,
): void => {
  const list = m.get(key);
  if (list) list.push(row);
  else m.set(key, [row]);
};

// Fold one day-file's raw annex records into the index. Extracted from
// buildAnnexIndex so the record→accumulator wiring (incl. the ambiguity sets)
// is unit-testable without a disk cache; returns how many records carried a
// usable value (a keyless record still counts — it enters neither map, but the
// callers' coverage log and `records === 0` bail-out predate the extraction).
// Callers must preserve the sorted-file / within-file source order (see put()).
export const indexAnnexRows = (
  idx: AnnexIndex,
  rows: EopAnnexRecord[],
  opts: { retainRecords?: boolean } = {},
): number => {
  let records = 0;
  for (const r of rows) {
    const ccy = String(r.contractCurrency ?? "").trim() || undefined;
    const curEurFull = toEur(parseBgNumber(r.currentContractValue), ccy);
    if (curEurFull == null || !Number.isFinite(curEurFull) || curEurFull <= 0)
      continue;
    const lastEurFull =
      toEur(parseBgNumber(r.lastContractValue), ccy) ?? undefined;
    records++;
    const suppliers = String(r.supplierRegisterNumber ?? "")
      .split(";")
      .map((x) => normEik(x.trim()))
      .filter(Boolean);
    const pub = String(r.publicationDate ?? r.contractDate ?? "");
    const buyer = normEik(r.buyerRegistryNumber);
    const cn = normContractNo(r.contractNumber);
    const unp = String(r.uniqueProcurementNumber ?? "").trim();
    const o: AnnexObs = {
      curEurFull,
      lastEurFull,
      suppliers,
      pub,
      contractNo: cn,
      unp: UNP_RE.test(unp) ? unp : "",
    };

    // The stored row carries the full published (not per-supplier) values —
    // it is the raw modification, itemised; the per-contract Δ already lives on
    // the contract row (signing vs current).
    const diffEur = toEur(parseBgNumber(r.contractValueDifference), ccy);
    const row: AnnexRecordRow | null = opts.retainRecords
      ? {
          noticeId: typeof r.noticeId === "number" ? r.noticeId : null,
          lotIdentifier: r.lotIdentifier ? String(r.lotIdentifier) : null,
          publicationDate: r.publicationDate ?? null,
          contractDate: r.contractDate ?? null,
          currency: ccy ?? null,
          lastValueEur: lastEurFull ?? null,
          currentValueEur: curEurFull,
          valueDiffEur: diffEur ?? null,
          changeReason: r.changeReason ?? null,
          changeReasonDescription: r.changeReasonDescription ?? null,
          changeDescription: r.changeDescription ?? null,
          directAwardJustification: r.directAwardJustification ?? null,
        }
      : null;

    // Key lot-agnostic on (buyer, contractNumber): contractNumber already
    // distinguishes lots in practice, and our contract rows don't retain the
    // annex lotIdentifier. Latest publicationDate wins.
    if (buyer && cn) {
      put(idx.byContractNo, `${buyer}|${cn}`, o);
      if (row && idx.recordsByContractNo)
        pushRecord(idx.recordsByContractNo, `${buyer}|${cn}`, row);
    }
    if (o.unp) {
      for (const s of suppliers) {
        put(idx.byUnpSupplier, `${o.unp}|${s}`, o);
        if (row && idx.recordsByUnpSupplier)
          pushRecord(idx.recordsByUnpSupplier, `${o.unp}|${s}`, row);
      }
    }
  }
  return records;
};

// Build the annex index from the cached ЦАИС ЕОП feed. `retainRecords` also
// keeps the raw per-annex rows per key (off by default so the value-fold caller
// pays no extra memory and its accumulator maps stay byte-identical).
export const buildAnnexIndex = (
  opts: { retainRecords?: boolean } = {},
): { idx: AnnexIndex; records: number; days: number } => {
  const idx: AnnexIndex = {
    byContractNo: new Map(),
    byUnpSupplier: new Map(),
  };
  if (opts.retainRecords) {
    idx.recordsByContractNo = new Map();
    idx.recordsByUnpSupplier = new Map();
  }
  let records = 0;
  let days = 0;
  if (!fs.existsSync(ANEXI_CACHE_DIR)) return { idx, records, days };
  for (const f of fs
    .readdirSync(ANEXI_CACHE_DIR)
    .filter((f) => f.endsWith(".gz"))
    .sort()) {
    let rows: EopAnnexRecord[];
    try {
      rows = JSON.parse(
        zlib
          .gunzipSync(fs.readFileSync(path.join(ANEXI_CACHE_DIR, f)))
          .toString(),
      );
    } catch {
      continue;
    }
    if (!Array.isArray(rows) || rows.length === 0) continue;
    days++;
    records += indexAnnexRows(idx, rows, opts);
  }
  return { idx, records, days };
};

// Continuity tolerance: the earliest annex's pre-annex value, per supplier, must
// land within ±12% of the contract's signing value for the match to be trusted.
// A wrong-contract collision or a euro-transition currency mislabel (BGN value
// tagged EUR ⇒ a ~1.96× gap) fails this; genuine rounding/minor source drift
// passes.
export const CONTINUITY_TOL = 0.12;
// Hard cap on how far an annex can move a contract's value. Real annexes stay
// well within this; a value beyond it means a collided key mixed two contracts.
export const MAX_MULTIPLE = 15;

// Per-supplier current value for one annex hit, or undefined when a guard rejects
// the match. Three guards, all must pass: (1) supplier appears on the latest
// annex, (2) continuity anchor ≈ signing, (3) ratio within MAX_MULTIPLE×.
//
// ONE divisor for both anchor and current — the anchor's (lastSupplierCount),
// because that is the only divisor the continuity guard validates against the
// contract's actual signing value. Dividing the current value by the LATEST
// annex's list length instead silently rescales the result whenever the
// published supplier list grows or shrinks between annexes: a list that grew
// 1→2 halved a €195k contract to €97.6k, and a list that shrank 8→1 inflated a
// €317k contract to €2.54M — eight rows / ~€5.7M measured on the 2026-08-04
// corpus, all inside the 15× ratio cap. If the list length changed because the
// supplier set changed BEFORE the earliest annex, the anchor mismatch against
// signing makes guard (2) refuse. A set change BETWEEN annexes is invisible to
// the anchor; the row then keeps the full current value, which is the right
// corpus total whenever the added supplier has no contract row of its own (the
// usual annex-substitution shape) — the residual per-company overstatement is
// accepted.
const perSupplier = (
  hit: AnnexAcc,
  c: Contract,
  signed: number,
): number | undefined => {
  const me = normEik(c.contractorEik);
  if (me && hit.curSuppliers.length > 0 && !hit.curSuppliers.includes(me))
    return undefined; // (1)
  const n = Math.max(1, hit.lastSupplierCount);
  const anchor = hit.lastEurFull / n;
  if (!Number.isFinite(anchor) || anchor <= 0) return undefined;
  if (Math.abs(anchor - signed) / signed > CONTINUITY_TOL) return undefined; // (2)
  const cur = hit.curEurFull / n;
  if (cur / signed > MAX_MULTIPLE || cur / signed < 1 / MAX_MULTIPLE)
    return undefined; // (3)
  return Math.round(cur * 100) / 100; // cents — stable across re-runs
};

// Resolve one contract to the annex key it matches (and the current value),
// trying the УНП+supplier key FIRST then (buyer, contractNumber). Returns the
// matched KEY so the annexes loader can emit exactly that key's raw rows;
// `lookup` below is the value-only wrapper the fold uses.
//
// AMBIGUITY REFUSAL. Each key is skipped — not resolved — when its accumulator
// provably merged annexes of more than one contract: >1 distinct contract
// number under a K2 key (one supplier, several contracts in one procedure), or
// >1 distinct УНП under a K1 key (a buyer reusing a contract number across
// procedures). A merged accumulator can anchor on contract A's earliest annex
// and serve contract B's latest value, passing every perSupplier guard with a
// perfect continuity match — the K2 fallthrough then lets the contract-precise
// K1 answer instead.
//
// DELIBERATELY NOT REFUSED: a K2 key whose SINGLE collected contract number
// differs from the querying contract's own contractId. That looks like proof of
// a sibling-contract match, but measured on the 2026-08-04 corpus it would
// refuse 972 currently-resolved rows and lose 968 of them outright (no K1
// fallback), forfeiting €46.8M of tracked value change — because the contract
// feed's contractId and the annex feed's contractNumber routinely name the SAME
// contract in different identifier spaces ("ДОГ-35" vs the ЦАИС numeric id,
// "Договор № 20ДГ157" vs "20дг157"). A mismatch is therefore NOT evidence of a
// different contract; only a second distinct number within the annex feed
// itself is. The residual sibling-variant exposure (only contract B's annexes
// in the feed, sibling signings within ±12%) is accepted and left to guards
// 1–3; the characterization test in annexResolve.test.ts pins this.
export const resolveAnnexKey = (
  idx: AnnexIndex,
  c: Contract,
  signed: number,
): { key: string; via: "unp" | "contract_no"; value: number } | undefined => {
  if (signed <= 0) return undefined;
  if (c.unp && UNP_RE.test(c.unp) && c.contractorEik) {
    const key = `${c.unp}|${normEik(c.contractorEik)}`;
    const hit = idx.byUnpSupplier.get(key);
    if (hit && hit.contractNos.size <= 1) {
      const v = perSupplier(hit, c, signed);
      if (v != null) return { key, via: "unp", value: v };
    }
  }
  const buyer = normEik(c.awarderEik);
  const cn = normContractNo(c.contractId);
  if (buyer && cn) {
    const key = `${buyer}|${cn}`;
    const hit = idx.byContractNo.get(key);
    if (hit && hit.unps.size <= 1) {
      const v = perSupplier(hit, c, signed);
      if (v != null) return { key, via: "contract_no", value: v };
    }
  }
  return undefined;
};

// Value-only resolution (the fold's original `lookup`).
export const lookup = (
  idx: AnnexIndex,
  c: Contract,
  signed: number,
): number | undefined => resolveAnnexKey(idx, c, signed)?.value;
