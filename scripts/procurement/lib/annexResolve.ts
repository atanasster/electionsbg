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
// ⚠️ TWO CONTRACT BASES, AND THE BASIS IS A PROPERTY OF THE **ROW**. The annex feed
// publishes a joint award's value in FULL (all members). The SHARD rows the fold
// reads carry a per-supplier SPLIT of it (normalize_eop divides by
// validSupplierCount), so the resolver divides the annex value by the published
// supplier count to compare like with like. `rebuild_consortium()` (087) then
// UNDOES that split for SOME Postgres rows — it moves the whole value onto one
// carrier row and zeroes the members — and on those the same division makes the
// continuity anchor short by exactly the member count, so every consortium
// contract is refused.
//
// ⚠️ "Reads Postgres" is therefore NOT the same as "reads un-split rows", and
// treating it that way drops links rather than gaining them: 087 leaves
// `joint_kind = 'framework'` on the equal split BY DESIGN (its step 2 — independent
// parallel winners, not one joint award), and any multi-supplier award its HAVING
// did not group keeps the split too. The caller DECLARES the basis per row
// (`ResolveOpts`), and the default stays "split" because that is the path that
// rewrites contracts.amountEur across the whole corpus. See
// docs/plans/annex-linkage-consortium-basis-v1.md.
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

// Which basis THIS CONTRACT ROW carries, i.e. what its value MEANS:
//   "split"  a joint award divided equally across its members, one row each at
//            value/N — every month shard, and in Postgres every row 087 did not
//            promote: `joint_kind = 'framework'` (its step 2 keeps the split
//            deliberately) and every multi-supplier award its HAVING did not group.
//   "full"   the whole joint value on ONE row, members zeroed — in Postgres a
//            post-087 CARRIER row, i.e. `consortium_role = 'carrier'`.
// ⚠️ It is a property of the ROW, never of the source: a Postgres consumer that
// claims "full" for everything it reads refuses its own framework rows. It is also
// not auto-detectable — a single-supplier contract is identical under both, so a
// heuristic would be right on the rows that do not matter and guess on the rows
// that do.
export type ContractBasis = "split" | "full";

export interface ResolveOpts {
  /** Defaults to "split" — the shard convention. See ContractBasis. */
  basis?: ContractBasis;
  /**
   * The member EIKs of THIS row's consortium award, for the member-set K2 probe below. Read
   * only on the `"full"` basis, and only when the row's own K2 key is absent from the index.
   *
   * ⚠️ Its reason for existing is the SYNTHETIC carrier: `contractor_eik` is then OURS, not the
   * register's — 087 mints `obed-<md5(member set)>` — so `canonicalEik` returns "" for it and no
   * supplier-keyed index can ever hold it. Two consequences, and the second is the one that
   * bites: the K2 arm silently probes the key `"<unp>|"` and always misses, AND guard 1
   * (`me &&` …) is skipped entirely, so that arm runs with its supplier check disabled. Passing
   * the members restores both. A NAMED carrier has a real EIK and normally resolves without
   * this; it reaches the probe only when the index holds no key for that EIK at all.
   *
   * ⚠️ The members must be THIS award's — 087 groups by `(ocid, contract_id)`, and a named
   * carrier's EIK recurs across awards, so a set gathered by carrier EIK alone unions unrelated
   * groups (measured: 42 EIKs across 323 groups). See load_annexes_pg.ts's group key.
   */
  members?: readonly string[];
}

// FINDING-004/DUP-001: the divisor is the RULE, so it lives once. `perSupplier`
// and the measurement harness's refusal replay both call it; a second copy is how
// the harness would end up reporting a convention no consumer uses.
export const annexDivisor = (hit: AnnexAcc, basis: ContractBasis): number =>
  basis === "full" ? 1 : Math.max(1, hit.lastSupplierCount);

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
// ONE divisor for both anchor and current — on the "split" basis the anchor's
// (lastSupplierCount), because that is the only divisor the continuity guard
// validates against the contract's actual signing value; on "full", 1. Everything
// from here to the end of this comment is about the "split" basis ONLY: under
// "full" nothing is divided, so the list-length protection has nothing to protect
// against. Dividing the current value by the LATEST
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
  basis: ContractBasis,
): number | undefined => {
  const me = normEik(c.contractorEik);
  if (me && hit.curSuppliers.length > 0 && !hit.curSuppliers.includes(me))
    return undefined; // (1)
  // On the "full" basis the row already holds the whole joint value, so there is
  // nothing to divide — dividing anyway is the 087 mismatch this option exists for.
  const n = annexDivisor(hit, basis);
  const anchor = hit.lastEurFull / n;
  if (!Number.isFinite(anchor) || anchor <= 0) return undefined;
  if (Math.abs(anchor - signed) / signed > CONTINUITY_TOL) return undefined; // (2)
  const cur = hit.curEurFull / n;
  if (cur / signed > MAX_MULTIPLE || cur / signed < 1 / MAX_MULTIPLE)
    return undefined; // (3)
  return Math.round(cur * 100) / 100; // cents — stable across re-runs
};

/** The minimum a row needs for 087's consortium group identity. */
export interface ConsortiumGroupRow {
  ocid?: string | null;
  contractId?: string | null;
  contractorEik?: string | null;
  consortiumRole?: string | null;
}

/** 087's group identity — `(ocid, COALESCE(contract_id,''))`, the pair its own `_cg` CTE groups
 *  on. NOT `consortium_eik`: that is the carrier's EIK, which for a NAMED carrier is a real ДЗЗД
 *  company that recurs across awards (measured 2026-09-04: 42 such EIKs spanning 323 groups with
 *  DIFFERENT member sets), so keying on it unions unrelated awards' members. */
export const consortiumGroupKey = (r: ConsortiumGroupRow): string =>
  `${r.ocid ?? ""}|${r.contractId ?? ""}`;

/** Member EIKs per 087 consortium group, for `ResolveOpts.members`. Lives here, and is used by
 *  the loader, the measurement harness and the data gate alike, because the grouping is part of
 *  the probe's contract rather than of any one caller — and because keying it wrongly is a
 *  cross-award attribution that no call-site regex can see. */
export const membersByConsortiumGroup = (
  rows: readonly ConsortiumGroupRow[],
): Map<string, string[]> => {
  const out = new Map<string, string[]>();
  for (const r of rows) {
    if (r.consortiumRole !== "member" || !r.contractorEik) continue;
    const k = consortiumGroupKey(r);
    const list = out.get(k);
    if (list) list.push(r.contractorEik);
    else out.set(k, [r.contractorEik]);
  }
  return out;
};

/** The member-set K2 probe's candidate gathering: every member key the index actually holds,
 *  de-duplicated (2,246 of 4,040 carriers carry a repeated member EIK). Exported so the
 *  measurement harness and the data gate replay the probe rather than each re-implementing it —
 *  the probe is the RULE, and it was expressed three times before this. */
export const memberProbeHits = (
  idx: AnnexIndex,
  unp: string | undefined,
  members: readonly string[] | undefined,
): { key: string; member: string; acc: AnnexAcc }[] => {
  if (!unp || !UNP_RE.test(unp) || !members?.length) return [];
  const out: { key: string; member: string; acc: AnnexAcc }[] = [];
  const seen = new Set<string>();
  for (const m of members) {
    const me = normEik(m);
    if (!me || seen.has(me)) continue;
    seen.add(me);
    const acc = idx.byUnpSupplier.get(`${unp}|${me}`);
    if (acc) out.push({ key: `${unp}|${me}`, member: me, acc });
  }
  return out;
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
  opts: ResolveOpts = {},
): { key: string; via: "unp" | "contract_no"; value: number } | undefined => {
  const basis = opts.basis ?? "split";
  if (signed <= 0) return undefined;
  const properUnp = c.unp && UNP_RE.test(c.unp) ? c.unp : undefined;
  const ownKey =
    properUnp && c.contractorEik
      ? `${properUnp}|${normEik(c.contractorEik)}`
      : undefined;
  if (ownKey) {
    const hit = idx.byUnpSupplier.get(ownKey);
    if (hit && hit.contractNos.size <= 1) {
      const v = perSupplier(hit, c, signed, basis);
      if (v != null) return { key: ownKey, via: "unp", value: v };
    }
  }
  // K2 THROUGH THE MEMBER SET — for a row whose own key is ABSENT from the index. That is
  // always true of a synthetic carrier (`normEik` gives "", so `ownKey` is "<unp>|", which the
  // index never holds) and possible for a NAMED carrier whose EIK the annex feed did not
  // publish; named carriers are deliberately included rather than filtered — 9 of them enter
  // the arm on the current corpus.
  //
  // The `has` test is deliberately "absent", NOT "the own key was refused": routing a guard
  // refusal through a sibling's key would let N members supply N chances to get past guard 1 or
  // the continuity anchor, which is the opposite of what the guards are for.
  if (
    basis === "full" &&
    properUnp &&
    opts.members?.length &&
    !idx.byUnpSupplier.has(ownKey ?? "")
  ) {
    const hits = memberProbeHits(idx, properUnp, opts.members);
    // REFUSE DISAGREEMENT, NEVER VOTE. One annex record is indexed under EVERY supplier it
    // lists, so a genuine joint modification gives every member an equivalent accumulator —
    // and a member holding a SECOND contract under the same procedure gives a different one.
    // Taking the first hit would attribute that other contract's annexes to this consortium,
    // with N times the surface of the single-key collision the ambiguity refusal exists for.
    // The shape carries every field the answer depends on, `lastSupplierCount` included: it is
    // half the divisor (annexDivisor), so two hits agreeing on the values and disagreeing on it
    // do NOT agree on the result. It is redundant while the arm is gated to "full" (divisor 1)
    // and is the one line that would otherwise have to be remembered if that gate ever moves.
    //
    // ⚠️ NOTE a single hit satisfies both tests VACUOUSLY — and that is the shape a member's
    // OTHER contract also produces, since only that member would have an accumulator. It is
    // intended: one member carrying the award's annexes is the ordinary case, the rule exists to
    // refuse CONTRADICTION rather than to demand corroboration, and requiring two hits would
    // drop every consortium whose modification the register filed against a single member. What
    // actually validates the N=1 case is guard 2 against the carrier's FULL signing value —
    // measured 2026-09-04, 3 of 336 resolutions come from a single hit and all three carry a
    // pre-annex value equal to the carrier's full joint value to the cent.
    const nos = new Set<string>();
    const shapes = new Set<string>();
    for (const h of hits) {
      for (const n of h.acc.contractNos) nos.add(n);
      shapes.add(
        `${h.acc.curEurFull}|${h.acc.lastEurFull}|${h.acc.curPub}|${h.acc.lastSupplierCount}`,
      );
    }
    if (hits.length > 0 && nos.size <= 1 && shapes.size === 1) {
      // Guard 1 against the MEMBER, never the carrier — the carrier's EIK folds to "" and
      // would skip the check. A member absent from the latest annex is the supplier-
      // substitution shape; the consortium still owns the annex if any member is on it.
      // ⚠️ TOTAL ORDER, not `find`. `opts.members` arrives in Postgres row order (the loader's
      // contracts query has no ORDER BY), and two eligible members can hold DIFFERENT record
      // lists under an identical accumulator shape — measured, 27 carriers — because each annex
      // record is indexed under the suppliers IT lists. The loader emits the chosen key's record
      // list, so an unordered pick varies the rows written to procurement_annexes between
      // reloads, and with them `annexCount` — the "one annex at the cap vs several summing to
      // it" figure the table exists for.
      const onLatest = hits
        .filter(
          (h) =>
            h.acc.curSuppliers.length === 0 ||
            h.acc.curSuppliers.includes(h.member),
        )
        .sort((a, b) =>
          a.member < b.member ? -1 : a.member > b.member ? 1 : 0,
        )[0];
      if (onLatest) {
        const v = perSupplier(
          onLatest.acc,
          { ...c, contractorEik: onLatest.member } as Contract,
          signed,
          basis,
        );
        if (v != null) return { key: onLatest.key, via: "unp", value: v };
      }
    }
  }
  const buyer = normEik(c.awarderEik);
  const cn = normContractNo(c.contractId);
  if (buyer && cn) {
    const key = `${buyer}|${cn}`;
    const hit = idx.byContractNo.get(key);
    if (hit && hit.unps.size <= 1) {
      const v = perSupplier(hit, c, signed, basis);
      if (v != null) return { key, via: "contract_no", value: v };
    }
  }
  return undefined;
};

// Value-only resolution (the fold's original `lookup`). The fold reads SHARDS, so
// it takes the "split" default and must keep it: a "full" divisor there would
// rewrite every consortium contract's published amountEur by its member count.
export const lookup = (
  idx: AnnexIndex,
  c: Contract,
  signed: number,
  opts: ResolveOpts = {},
): number | undefined => resolveAnnexKey(idx, c, signed, opts)?.value;
