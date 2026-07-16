// Fold the cached ЦАИС ЕОП annex ("анекси") feed onto the contract shards,
// FLIPPING `amountEur` to the CURRENT (post-annex) contract value in place and
// preserving the original at-signing value in `signingAmountEur`.
//
// Why flip rather than add a column. `amountEur` is the value every aggregate,
// rollup and serving SUM already reads. Making it the current value means the
// whole corpus becomes current-basis (matching SIGMA's default list value) with
// ZERO changes to the ~30 SUM(amount_eur) sites — the current value is the
// headline. The at-signing value lives on in `signingAmountEur` (present only
// when an annex moved the value) for the per-contract Δ and the euro-peg canary.
//
// Background. Each annex record (ingest_anexi.ts cache) carries
// `currentContractValue`, the running post-annex value; the annex with the latest
// publicationDate holds the final current value. This pass indexes every annex,
// folds each contract's annexes to its latest current value, converts to EUR
// (same 1.95583 peg), and flips `amountEur` when it materially differs from
// signing. Idempotent: the signing baseline is always `signingAmountEur ??
// amountEur`, so re-running recomputes from the true signed value.
//
// Identity join, strongest first (mirrors ingest_eop.ts::contentKeys — precision
// over recall; a wrong current value is worse than none):
//   K1  buyerEik + normalized contractNumber + lotIdentifier   (most specific)
//   K2  proper УНП + supplierEik                                (lot-agnostic)
// A value/date fuzzy fallback is deliberately omitted: the annex value is the
// thing that changed, so it can't safely key the match.
//
//   tsx scripts/procurement/anexi_current_value.ts            # dry run (coverage)
//   tsx scripts/procurement/anexi_current_value.ts --apply    # write onto shards
//   tsx scripts/procurement/rebuild_from_cache.ts             # rebuild rollups/derived
//
// Re-runnable: idempotent. Sets currentAmountEur from scratch each run (clears a
// stale value when an annex is later corrected to equal signing). No network.

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { command, run, flag, optional, boolean } from "cmd-ts";
import { canonicalEik } from "./eik";
import { canonicalJson } from "./validate";
import { toEur } from "@/lib/currency";
import type { Contract } from "./types";
import type { EopAnnexRecord } from "./ingest_anexi";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROCUREMENT_DIR = path.resolve(__dirname, "../../data/procurement");
const CONTRACTS_DIR = path.join(PROCUREMENT_DIR, "contracts");
const ANEXI_CACHE_DIR = path.resolve(
  __dirname,
  "../../raw_data/procurement/anexi",
);

// "1 234 567,89" / "5112918,81" → number; undefined when blank/non-numeric.
const parseBgNumber = (v: unknown): number | undefined => {
  if (v == null) return undefined;
  let s = String(v).trim().replace(/\s/g, "");
  if (!s) return undefined;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

// Normalise a contract number for matching (same rule as ingest_eop.ts): the two
// feeds format punctuation/№/whitespace inconsistently.
const normContractNo = (s: string | undefined): string =>
  (s ?? "").toLocaleLowerCase("bg").replace(/[\s".,\-_/№#]/g, "");

const norm = (e: string | undefined): string => canonicalEik(e) || "";
const UNP_RE = /^\d{5}-\d{4}-\d{4}$/;

// Per contract-identity annex accumulator. Values are FULL (all suppliers); our
// contract rows hold a per-supplier SPLIT share (normalize_eop divides by
// validSupplierCount), so both the current value AND the continuity anchor are
// divided by the SAME count — otherwise a consortium split N ways credits the
// full value to each of N rows (an N× overcount).
//   cur*  — from the annex with the LATEST publicationDate = current value.
//   last* — from the annex with the EARLIEST publicationDate; its
//           `lastContractValue` is the value BEFORE the first annex, i.e. the
//           signing value, used as a continuity anchor to reject bad matches /
//           currency mislabels (it must reconcile with the contract's amountEur).
interface AnnexAcc {
  curEurFull: number;
  curSupplierCount: number;
  curSuppliers: string[]; // suppliers on the latest annex — disambiguates key collisions
  curPub: string;
  lastEurFull: number; // value before the earliest annex (≈ signing, FULL)
  lastSupplierCount: number;
  lastPub: string;
}

interface AnnexIndex {
  byContractNo: Map<string, AnnexAcc>; // K1
  byUnpSupplier: Map<string, AnnexAcc>; // K2
}

interface AnnexObs {
  curEurFull: number;
  lastEurFull: number | undefined;
  suppliers: string[];
  pub: string;
}

// Fold one annex observation into a key's accumulator: latest pub wins for the
// current value, earliest pub wins for the signing anchor.
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
    });
    return;
  }
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

const buildAnnexIndex = (): {
  idx: AnnexIndex;
  records: number;
  days: number;
} => {
  const idx: AnnexIndex = {
    byContractNo: new Map(),
    byUnpSupplier: new Map(),
  };
  let records = 0;
  let days = 0;
  if (!fs.existsSync(ANEXI_CACHE_DIR)) return { idx, records, days };
  for (const f of fs
    .readdirSync(ANEXI_CACHE_DIR)
    .filter((f) => f.endsWith(".gz"))) {
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
        .map((x) => norm(x.trim()))
        .filter(Boolean);
      const pub = String(r.publicationDate ?? r.contractDate ?? "");
      const o: AnnexObs = { curEurFull, lastEurFull, suppliers, pub };
      const buyer = norm(r.buyerRegistryNumber);
      const cn = normContractNo(r.contractNumber);
      // Key lot-agnostic on (buyer, contractNumber): contractNumber already
      // distinguishes lots in practice, and our contract rows don't retain the
      // annex lotIdentifier. Latest publicationDate wins.
      if (buyer && cn) put(idx.byContractNo, `${buyer}|${cn}`, o);
      const unp = String(r.uniqueProcurementNumber ?? "").trim();
      if (UNP_RE.test(unp)) {
        for (const s of suppliers) put(idx.byUnpSupplier, `${unp}|${s}`, o);
      }
    }
  }
  return { idx, records, days };
};

// Continuity tolerance: the earliest annex's pre-annex value, per supplier, must
// land within ±12% of the contract's signing value for the match to be trusted.
// A wrong-contract collision or a euro-transition currency mislabel (BGN value
// tagged EUR ⇒ a ~1.96× gap) fails this; genuine rounding/minor source drift
// passes. 12% also tolerates the odd contract that was itself first amended
// slightly before we snapshot the anchor.
const CONTINUITY_TOL = 0.12;
// Hard cap on how far an annex can move a contract's value. Real annexes stay
// well within this; a value beyond it means a collided key mixed two different
// contracts (a small one anchored the guard while a huge one set the current).
const MAX_MULTIPLE = 15;

// Per-supplier current value for one annex hit, or undefined when a guard rejects
// the match. Three guards, all must pass:
//   1. supplier check — our contractor must appear on the latest annex's supplier
//      list (kills (buyer, contractNumber) collisions across different contracts;
//      skipped only when the annex published no supplier list to check against);
//   2. continuity anchor — the earliest annex's pre-annex value ≈ our signing
//      value (reconciles identity + stated currency);
//   3. ratio cap — the current value stays within MAX_MULTIPLE× of signing.
const perSupplier = (
  hit: AnnexAcc,
  c: Contract,
  signed: number,
): number | undefined => {
  const me = norm(c.contractorEik);
  if (me && hit.curSuppliers.length > 0 && !hit.curSuppliers.includes(me))
    return undefined; // (1)
  const anchor = hit.lastEurFull / Math.max(1, hit.lastSupplierCount);
  if (!Number.isFinite(anchor) || anchor <= 0) return undefined;
  if (Math.abs(anchor - signed) / signed > CONTINUITY_TOL) return undefined; // (2)
  const cur = hit.curEurFull / Math.max(1, hit.curSupplierCount);
  if (cur / signed > MAX_MULTIPLE || cur / signed < 1 / MAX_MULTIPLE)
    return undefined; // (3)
  return Math.round(cur * 100) / 100; // cents — stable across re-runs
};

// Resolve one contract's current value against an explicit `signed` baseline (NOT
// c.amountEur, which this pass mutates to the current value in place). The
// УНП+supplier key is inherently collision-safe (it carries the supplier), so try
// it FIRST; the (buyer, contractNumber) key is the fallback for rows lacking a
// proper УНП.
const lookup = (
  idx: AnnexIndex,
  c: Contract,
  signed: number,
): number | undefined => {
  if (signed <= 0) return undefined;
  if (c.unp && UNP_RE.test(c.unp) && c.contractorEik) {
    const hit = idx.byUnpSupplier.get(`${c.unp}|${norm(c.contractorEik)}`);
    const v = hit && perSupplier(hit, c, signed);
    if (v != null) return v;
  }
  const buyer = norm(c.awarderEik);
  const cn = normContractNo(c.contractId);
  if (buyer && cn) {
    const hit = idx.byContractNo.get(`${buyer}|${cn}`);
    const v = hit && perSupplier(hit, c, signed);
    if (v != null) return v;
  }
  return undefined;
};

const main = (apply: boolean): void => {
  console.log("→ indexing анекси cache…");
  const { idx, records, days } = buildAnnexIndex();
  console.log(
    `  ${days} published days, ${records} annex value-records; ` +
      `${idx.byContractNo.size.toLocaleString()} contract-no keys, ` +
      `${idx.byUnpSupplier.size.toLocaleString()} УНП+supplier keys`,
  );
  if (records === 0) {
    console.log("No annex cache — run ingest_anexi.ts --backfill first.");
    return;
  }

  const years = fs
    .readdirSync(CONTRACTS_DIR)
    .filter((y) => /^\d{4}$/.test(y))
    .sort();
  let total = 0;
  let matched = 0;
  let changed = 0;
  let cleared = 0;
  let deltaUpEur = 0;
  let deltaDownEur = 0;
  let filesChanged = 0;

  for (const y of years) {
    const dir = path.join(CONTRACTS_DIR, y);
    for (const file of fs.readdirSync(dir).filter((f) => /\.json$/.test(f))) {
      const full = path.join(dir, file);
      const rows = JSON.parse(fs.readFileSync(full, "utf8")) as Contract[];
      let touched = false;
      for (const c of rows) {
        // Strip the superseded field from an earlier model, if present.
        if (
          (c as { currentAmountEur?: number }).currentAmountEur !== undefined
        ) {
          delete (c as { currentAmountEur?: number }).currentAmountEur;
          touched = true;
        }
        if (c.tag !== "contract") continue;
        total++;
        // The true SIGNING value survives in signingAmountEur once flipped; before
        // any flip it is amountEur. Always resolve from it so the pass is idempotent.
        const signed = c.signingAmountEur ?? c.amountEur;
        if (signed == null) continue;
        const cur = lookup(idx, c, signed);
        if (cur != null && Math.abs(cur - signed) >= 0.005) {
          matched++;
          // Flip in place: amountEur becomes the current value; the signing value
          // is preserved for the Δ. amount/currency stay the native SIGNED figures.
          if (c.amountEur !== cur || c.signingAmountEur !== signed) {
            c.signingAmountEur = signed;
            c.amountEur = cur;
            touched = true;
            changed++;
          }
          if (cur > signed) deltaUpEur += cur - signed;
          else deltaDownEur += signed - cur;
        } else if (c.signingAmountEur != null) {
          // A previously-flipped row whose annex no longer moves the value: restore.
          c.amountEur = signed;
          delete c.signingAmountEur;
          touched = true;
          cleared++;
        }
      }
      if (touched && apply) {
        fs.writeFileSync(full, canonicalJson(rows));
        filesChanged++;
      }
    }
  }

  console.log(
    `\n→ ${total.toLocaleString()} contracts scanned; ` +
      `${matched.toLocaleString()} got a current value ≠ signing`,
  );
  console.log(
    `  set/updated ${changed.toLocaleString()}, cleared ${cleared.toLocaleString()} stale`,
  );
  console.log(
    `  Σ increases +€${(deltaUpEur / 1e6).toFixed(1)}M, ` +
      `Σ reductions −€${(deltaDownEur / 1e6).toFixed(1)}M, ` +
      `net €${((deltaUpEur - deltaDownEur) / 1e6).toFixed(1)}M`,
  );
  if (!apply) {
    console.log(
      "\n✓ dry run — pass --apply to write currentAmountEur onto shards",
    );
    return;
  }
  console.log(`→ wrote ${filesChanged} shard(s)`);
  console.log(
    "✓ done. Now rebuild: tsx scripts/procurement/rebuild_from_cache.ts",
  );
};

const cli = command({
  name: "anexi_current_value",
  args: {
    apply: flag({
      type: optional(boolean),
      long: "apply",
      description:
        "Write currentAmountEur onto the month-shards (default dry).",
      defaultValue: () => false,
    }),
  },
  handler: (a) => main(!!a.apply),
});

run(cli, process.argv.slice(2));
