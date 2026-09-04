// READ-ONLY measurement of annex ("анекси") → contract linkage coverage.
//
// There is no `--apply` and no write path anywhere in this file. It exists so that every number
// in docs/plans/annex-linkage-consortium-basis-v1.md can be re-derived by one command, against
// EITHER contract source, with THE SAME resolver both consumers act on (lib/annexResolve.ts)
// rather than a re-implementation.
//
//   npx tsx scripts/procurement/measure_annex_linkage.ts                  # both sources + divergence
//   npx tsx scripts/procurement/measure_annex_linkage.ts --source=pg      # what load_annexes_pg sees
//   npx tsx scripts/procurement/measure_annex_linkage.ts --source=shards  # what anexi_current_value sees
//   npx tsx scripts/procurement/measure_annex_linkage.ts --json           # machine-readable
//   npx tsx scripts/procurement/measure_annex_linkage.ts --read-only      # accepted no-op alias
//
// Against Cloud SQL (production), via the proxy — still read-only:
//   DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg \
//     npx tsx scripts/procurement/measure_annex_linkage.ts --source=pg
//
// ── IT DRIVES FROM THE ANNEX SIDE, WHICH NEITHER CONSUMER DOES ───────────────────────────────
//
// Both consumers iterate CONTRACTS and ask "does this contract have annexes?". An annex that no
// contract claims is therefore not an error anywhere — it is simply absent from
// procurement_annexes and from the value fold, with every row count reconciling. This harness
// iterates the annex CACHE instead, so that population is countable at all.
//
// ── THE TWO SOURCES DECLARE DIFFERENT BASES, AND BOTH ARE RIGHT ──────────────────────────────
//
// `perSupplier()` divides the annex's FULL published value by the supplier count, because the
// SHARD convention is a per-supplier split (normalize_eop divides by validSupplierCount).
// `rebuild_consortium()` (087_procurement_consortium.sql) runs INSIDE Postgres after the load and
// UNDOES that split for the rows it promotes: it moves a consortium award's whole value onto one
// carrier row and zeroes the rest. So each source declares its own basis, PER ROW —
// `pgBasis()` below mirrors the loader's `consortium_role = 'carrier'` test, and a shard row is
// always split.
//
//   `--source=shards`  what the VALUE FOLD sees — contracts.amount_eur is built on this
//   `--source=pg`      what the ANNEXES TABLE sees — procurement_annexes is built on this
//
// Until 2026-09-04 the pg side took the shard divisor for everything and the continuity guard
// refused every consortium carrier by exactly its member count (−66.7% at 3, −83.3% at 6). That
// is fixed; what §4 now prints is the RESIDUE — the records one source links and the other does
// not — which is what Tier 2 of the plan targets. Some of it is structural rather than a defect:
// Postgres additionally holds ~2,680 synthetic `obed-` carrier rows that have no shard row at all,
// and whose EIK the annex feed can never publish.

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import {
  ANEXI_CACHE_DIR,
  CONTINUITY_TOL,
  MAX_MULTIPLE,
  UNP_RE,
  buildAnnexIndex,
  normContractNo,
  normEik,
  parseBgNumber,
  resolveAnnexKey,
  annexDivisor,
  consortiumGroupKey,
  memberProbeHits,
  membersByConsortiumGroup,
  type AnnexAcc,
  type AnnexIndex,
  type ContractBasis,
} from "./lib/annexResolve";
import { toEur } from "@/lib/currency";
import type { Contract } from "./types";
import type { EopAnnexRecord } from "./ingest_anexi";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const MONTH_DIR = path.join(ROOT, "data/procurement/contracts");

type Source = "pg" | "shards";

/** The basis a Postgres row carries, decided exactly as `load_annexes_pg.ts` decides it: 087
 *  un-splits the consortium CARRIER only, so everything else — frameworks (its step 2 keeps the
 *  equal split deliberately) and any multi-supplier award its HAVING did not group — is still
 *  split. Mirrored rather than inferred so the harness measures what the loader does. */
const pgBasis = (consortiumRole: string | null): ContractBasis =>
  consortiumRole === "carrier" ? "full" : "split";

const argv = process.argv.slice(2);
const KNOWN = new Set([
  "--json",
  "--source=pg",
  "--source=shards",
  "--read-only",
]);
for (const a of argv) {
  if (!KNOWN.has(a)) {
    console.error(`unknown flag ${a}\n  known: ${[...KNOWN].join(" ")}`);
    process.exit(2);
  }
}
const JSON_OUT = argv.includes("--json");
const SOURCES: Source[] = argv.includes("--source=pg")
  ? ["pg"]
  : argv.includes("--source=shards")
    ? ["shards"]
    : ["shards", "pg"];

// ── loading ──────────────────────────────────────────────────────────────────────────────────

/** Only the fields the resolver reads, plus `consortiumFullEur` — which is what tells a zeroed
 *  member row apart from a contract the feed genuinely published without a value. */
interface Row {
  key: string;
  unp?: string;
  awarderEik?: string;
  contractorEik?: string;
  contractId?: string;
  signed: number | null;
  consortiumFullEur?: number;
  /** What THIS row's value means — see ContractBasis. Shards are always split. */
  basis: ContractBasis;
  /** Member EIKs behind a post-087 synthetic carrier, for the member-set K2 probe. */
  members?: readonly string[];
}

const isYearDir = (n: string): boolean => /^\d{4}$/.test(n);

/** The shard convention: `signingAmountEur ?? amountEur`, exactly as anexi_current_value.ts
 *  resolves it (that fallback is what makes the fold idempotent). */
const loadShards = (): Row[] => {
  const out: Row[] = [];
  if (!fs.existsSync(MONTH_DIR)) return out;
  for (const y of fs.readdirSync(MONTH_DIR).filter(isYearDir)) {
    const dir = path.join(MONTH_DIR, y);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const rows = JSON.parse(
        fs.readFileSync(path.join(dir, f), "utf8"),
      ) as (Contract & { consortiumFullEur?: number })[];
      if (!Array.isArray(rows)) continue;
      for (const r of rows) {
        if (r.tag !== "contract") continue;
        out.push({
          // Shards carry no `key`; the resolver never reads one, and the divergence in §4 is
          // computed over ANNEX records rather than contracts, so a synthetic id is enough.
          key: `${r.unp ?? ""}|${r.contractId ?? ""}|${r.contractorEik ?? ""}`,
          unp: r.unp,
          awarderEik: r.awarderEik,
          contractorEik: r.contractorEik,
          contractId: r.contractId,
          signed: r.signingAmountEur ?? r.amountEur ?? null,
          consortiumFullEur: r.consortiumFullEur,
          basis: "split",
        });
      }
    }
  }
  return out;
};

/** The Postgres convention: the same COALESCE load_annexes_pg.ts uses — but over rows 087 has
 *  already un-split. */
const loadPg = async (): Promise<Row[]> => {
  const { allRows } = await import("../db/lib/pg");
  const rows = await allRows<{
    key: string;
    unp: string | null;
    awarder_eik: string | null;
    contractor_eik: string | null;
    contract_id: string | null;
    signing_amount_eur: number | null;
    amount_eur: number | null;
    consortium_full_eur: number | null;
    consortium_role: string | null;
    consortium_eik: string | null;
    ocid: string | null;
  }>(
    `SELECT key, unp, awarder_eik, contractor_eik, contract_id,
            signing_amount_eur, amount_eur, consortium_full_eur, consortium_role,
            consortium_eik, ocid
       FROM contracts WHERE tag = 'contract'`,
  );
  // Mirrors load_annexes_pg.ts, including its GROUP key — 087 groups by (ocid, contract_id),
  // and a named carrier's consortium_eik recurs across awards.
  const gr = (r: (typeof rows)[number]) => ({
    ocid: r.ocid,
    contractId: r.contract_id,
    contractorEik: r.contractor_eik,
    consortiumRole: r.consortium_role,
  });
  const membersByGroup = membersByConsortiumGroup(rows.map(gr));
  return rows.map((r) => ({
    key: r.key,
    unp: r.unp ?? undefined,
    awarderEik: r.awarder_eik ?? undefined,
    contractorEik: r.contractor_eik ?? undefined,
    contractId: r.contract_id ?? undefined,
    signed: r.signing_amount_eur ?? r.amount_eur ?? null,
    consortiumFullEur: r.consortium_full_eur ?? undefined,
    basis: pgBasis(r.consortium_role),
    members:
      r.consortium_role === "carrier"
        ? membersByGroup.get(consortiumGroupKey(gr(r)))
        : undefined,
  }));
};

/** Procedure ids the tender corpus knows. Postgres-only and OPTIONAL: on a checkout with no
 *  database the "УНП unknown to the tender corpus" category is reported as n/a rather than
 *  silently as zero. */
const loadTenderUnps = async (): Promise<Set<string> | null> => {
  try {
    const { allRows } = await import("../db/lib/pg");
    const rows = await allRows<{ unp: string }>(
      "SELECT DISTINCT unp FROM tenders WHERE unp IS NOT NULL",
    );
    return new Set(rows.map((r) => r.unp));
  } catch {
    return null;
  }
};

// ── the annex side ───────────────────────────────────────────────────────────────────────────

/** One cache record, reduced to what linkage turns on. `id` is positional so the same record is
 *  identifiable across two source runs (the feed has no per-annex primary key: `noticeId` is
 *  absent on some rows and repeats across lots on others). */
interface AnnexRec {
  id: string;
  buyer: string;
  cn: string;
  unp: string;
  suppliers: string[];
  curEur: number;
  lastEur: number | null;
  moves: boolean;
}

/** Re-derives the cache with the SAME acceptance filter indexAnnexRows applies (a record with no
 *  usable positive current value enters neither map), so these counts and the index agree. */
const readAnnexRecords = (): AnnexRec[] => {
  const out: AnnexRec[] = [];
  if (!fs.existsSync(ANEXI_CACHE_DIR)) return out;
  for (const f of fs
    .readdirSync(ANEXI_CACHE_DIR)
    .filter((x) => x.endsWith(".gz"))
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
    if (!Array.isArray(rows)) continue;
    rows.forEach((r, i) => {
      const ccy = String(r.contractCurrency ?? "").trim() || undefined;
      const curEur = toEur(parseBgNumber(r.currentContractValue), ccy);
      if (curEur == null || !Number.isFinite(curEur) || curEur <= 0) return;
      const lastEur = toEur(parseBgNumber(r.lastContractValue), ccy) ?? null;
      const unp = String(r.uniqueProcurementNumber ?? "").trim();
      out.push({
        id: `${f}#${i}`,
        buyer: normEik(r.buyerRegistryNumber),
        cn: normContractNo(r.contractNumber),
        unp: UNP_RE.test(unp) ? unp : "",
        suppliers: String(r.supplierRegisterNumber ?? "")
          .split(";")
          .map((x) => normEik(x.trim()))
          .filter(Boolean),
        curEur,
        lastEur,
        moves: lastEur != null && Math.abs(curEur - lastEur) > 0.005,
      });
    });
  }
  return out;
};

// ── refusal attribution ──────────────────────────────────────────────────────────────────────

// Ordered so the FIRST applicable cause is reported. The order is the resolver's own decision
// path, not a severity ranking — an annex refused for two reasons is counted once, under the one
// that fires first, which is the one a fix would have to address first.
const CAUSES = [
  "annex carries no proper УНП (ЦАИС internal id)",
  "annex publishes no supplier EIK",
  "no contract row under this УНП",
  "no contract under this УНП carries the annex's supplier",
  "contract row has no usable value (zeroed consortium member)",
  "contract row has no usable value (feed published none)",
  "no accumulator under either key (annex indexed elsewhere)",
  "K2 ambiguity refusal (>1 contract № under УНП+supplier)",
  "K1 ambiguity refusal (>1 УНП under buyer+contract №)",
  "guard 1: supplier absent from the latest annex",
  "guard 2: no usable anchor",
  "guard 2: continuity — pre-annex value ≠ signing (±12%)",
  "guard 3: ratio cap",
  "carrier member-set probe refused: members disagree",
  "unattributed",
] as const;
type Cause = (typeof CAUSES)[number];

/** Replays the three guards against ONE accumulator, and names the first that refused —
 *  `undefined` means it would have resolved. The divisor comes from the resolver's own
 *  `annexDivisor`, never a local copy: the divisor IS the rule, and the whole claim of this
 *  file is that it re-derives the VERDICT and nothing else. */
const guardRefusal = (
  acc: AnnexAcc,
  c: Row,
  signed: number,
): { cause: Cause; anchorRatio?: number } | undefined => {
  const me = normEik(c.contractorEik);
  if (me && acc.curSuppliers.length > 0 && !acc.curSuppliers.includes(me))
    return { cause: CAUSES[9] };
  const n = annexDivisor(acc, c.basis);
  const anchor = acc.lastEurFull / n;
  if (!Number.isFinite(anchor) || anchor <= 0) return { cause: CAUSES[10] };
  if (Math.abs(anchor - signed) / signed > CONTINUITY_TOL)
    return { cause: CAUSES[11], anchorRatio: signed / anchor };
  const cur = acc.curEurFull / n;
  if (cur / signed > MAX_MULTIPLE || cur / signed < 1 / MAX_MULTIPLE)
    return { cause: CAUSES[12] };
  return undefined;
};

/** Replays resolveAnnexKey's decision path for one unlinked annex against its candidate
 *  contracts — K2 (УНП+supplier) then K1 (buyer+contract №), the resolver's own order — and
 *  names the guard that refused. Reads the same accumulators and the same divisor the resolver
 *  reads; it re-derives the VERDICT, never the rule. */
const attribute = (
  a: AnnexRec,
  idx: AnnexIndex,
  byUnp: Map<string, Row[]>,
): { cause: Cause; anchorRatio?: number } => {
  if (!a.unp) return { cause: CAUSES[0] };
  if (a.suppliers.length === 0) return { cause: CAUSES[1] };
  const under = byUnp.get(a.unp) ?? [];
  if (under.length === 0) return { cause: CAUSES[2] };
  // A synthetic carrier's own EIK folds to "" and is never on the annex's supplier list, so it
  // is admitted through its MEMBERS — otherwise every carrier refusal is misreported as "no
  // contract under this УНП carries the annex's supplier".
  const cands = under.filter(
    (c) =>
      a.suppliers.includes(normEik(c.contractorEik)) ||
      (c.members ?? []).some((m) => a.suppliers.includes(normEik(m))),
  );
  if (cands.length === 0) return { cause: CAUSES[3] };

  let out: { cause: Cause; anchorRatio?: number } = { cause: CAUSES[14] };
  for (const c of cands) {
    if (c.signed == null || c.signed <= 0) {
      out = { cause: c.consortiumFullEur != null ? CAUSES[4] : CAUSES[5] };
      continue;
    }
    let seen = false;
    // K2 first, exactly as resolveAnnexKey does.
    const ownKey = `${a.unp}|${normEik(c.contractorEik)}`;
    const k2 = idx.byUnpSupplier.get(ownKey);
    if (k2) {
      seen = true;
      out =
        k2.contractNos.size > 1
          ? { cause: CAUSES[7] }
          : (guardRefusal(k2, c, c.signed) ?? { cause: CAUSES[14] });
    } else if (c.members?.length) {
      // …then the member-set probe, on the same terms resolveAnnexKey uses.
      const hits = memberProbeHits(idx, a.unp, c.members);
      if (hits.length > 0) {
        seen = true;
        const nos = new Set<string>();
        const shapes = new Set<string>();
        for (const h of hits) {
          for (const n of h.acc.contractNos) nos.add(n);
          shapes.add(
            `${h.acc.curEurFull}|${h.acc.lastEurFull}|${h.acc.curPub}`,
          );
        }
        if (nos.size > 1 || shapes.size > 1) out = { cause: CAUSES[13] };
        else {
          const onLatest = hits.find(
            (h) =>
              h.acc.curSuppliers.length === 0 ||
              h.acc.curSuppliers.includes(h.member),
          );
          out = onLatest
            ? (guardRefusal(
                onLatest.acc,
                { ...c, contractorEik: onLatest.member },
                c.signed,
              ) ?? { cause: CAUSES[14] })
            : { cause: CAUSES[9] };
        }
      }
    }
    // …then K1, which is what an unlinked record with no usable K2 actually fell through to.
    const buyer = normEik(c.awarderEik);
    const cn = normContractNo(c.contractId);
    const k1 = buyer && cn ? idx.byContractNo.get(`${buyer}|${cn}`) : undefined;
    if (k1) {
      seen = true;
      out =
        k1.unps.size > 1
          ? { cause: CAUSES[8] }
          : (guardRefusal(k1, c, c.signed) ?? { cause: CAUSES[14] });
    }
    if (!seen) out = { cause: CAUSES[6] };
  }
  return out;
};

// ── measurement ──────────────────────────────────────────────────────────────────────────────

interface Measured {
  source: Source;
  contracts: number;
  basisSplit: number;
  basisFull: number;
  total: number;
  linked: number;
  unlinked: number;
  movesTotal: number;
  movesUnlinked: number;
  linkedIds: Set<string>;
  causes: Map<Cause, number>;
  /** signed / anchor for continuity refusals, rounded — an integer here is the member count, i.e.
   *  the 087 basis mismatch rather than a genuine value disagreement. */
  anchorRatios: Map<string, number>;
  numberAxis: Record<string, number | null>;
  rescue: {
    anchored: number;
    unique: number;
    ambiguous: number;
    none: number;
    movesRescued: number;
  };
}

const measure = (
  source: Source,
  rows: Row[],
  recs: AnnexRec[],
  idx: AnnexIndex,
  tenderUnps: Set<string> | null,
): Measured => {
  const resolvedUnp = new Set<string>();
  const resolvedCn = new Set<string>();
  const byUnp = new Map<string, Row[]>();
  const cnByBuyer = new Set<string>();
  for (const c of rows) {
    if (c.unp) {
      const l = byUnp.get(c.unp);
      if (l) l.push(c);
      else byUnp.set(c.unp, [c]);
    }
    const b = normEik(c.awarderEik);
    const cn = normContractNo(c.contractId);
    if (b && cn) cnByBuyer.add(`${b}|${cn}`);
    if (c.signed == null) continue;
    const hit = resolveAnnexKey(
      idx,
      {
        unp: c.unp,
        contractorEik: c.contractorEik,
        awarderEik: c.awarderEik,
        contractId: c.contractId,
      } as Contract,
      c.signed,
      { basis: c.basis, members: c.members },
    );
    if (hit) (hit.via === "unp" ? resolvedUnp : resolvedCn).add(hit.key);
  }

  const m: Measured = {
    source,
    contracts: rows.length,
    basisSplit: rows.filter((r) => r.basis === "split").length,
    basisFull: rows.filter((r) => r.basis === "full").length,
    total: recs.length,
    linked: 0,
    unlinked: 0,
    movesTotal: 0,
    movesUnlinked: 0,
    linkedIds: new Set(),
    causes: new Map(),
    anchorRatios: new Map(),
    numberAxis: {
      "empty contract number": 0,
      "empty УНП": 0,
      "УНП unknown to the tender corpus": tenderUnps ? 0 : null,
      "УНП known, no contract under it": 0,
      "УНП has contracts, no № match (the number-namespace class)": 0,
      "УНП has contracts and the № DOES match": 0,
    },
    rescue: { anchored: 0, unique: 0, ambiguous: 0, none: 0, movesRescued: 0 },
  };

  for (const a of recs) {
    if (a.moves) m.movesTotal++;
    let linked = false;
    if (a.buyer && a.cn && resolvedCn.has(`${a.buyer}|${a.cn}`)) linked = true;
    if (!linked && a.unp)
      for (const s of a.suppliers)
        if (resolvedUnp.has(`${a.unp}|${s}`)) {
          linked = true;
          break;
        }
    if (linked) {
      m.linked++;
      m.linkedIds.add(a.id);
      continue;
    }
    m.unlinked++;
    if (a.moves) m.movesUnlinked++;

    const { cause, anchorRatio } = attribute(a, idx, byUnp);
    m.causes.set(cause, (m.causes.get(cause) ?? 0) + 1);
    if (anchorRatio != null && Number.isFinite(anchorRatio)) {
      const k = anchorRatio.toFixed(2);
      m.anchorRatios.set(k, (m.anchorRatios.get(k) ?? 0) + 1);
    }

    // The CONTRACT-NUMBER axis, split out separately. A resolver keyed on the buyer's contract
    // number breaks here, because the annex feed publishes an internal ЦАИС number where the
    // contract feed publishes the buyer's own registry number ("148846" against "Д-226"). Ours
    // is keyed УНП-first so it does not, and this section is what keeps that claim measured
    // rather than asserted — if these two rows ever invert, the key order stopped paying.
    const s = m.numberAxis;
    if (!a.cn) s["empty contract number"]!++;
    if (!a.unp) s["empty УНП"]!++;
    else if (tenderUnps && !tenderUnps.has(a.unp))
      s["УНП unknown to the tender corpus"]!++;
    else {
      const cs = byUnp.get(a.unp) ?? [];
      if (cs.length === 0) s["УНП known, no contract under it"]!++;
      else if (cs.some((c) => normContractNo(c.contractId) === a.cn))
        s["УНП has contracts and the № DOES match"]!++;
      else s["УНП has contracts, no № match (the number-namespace class)"]!++;
    }

    // The value-anchored fallback, costed against OUR residue before anyone builds it: is there
    // EXACTLY one contract under this procedure whose signing value equals the annex's pre-annex
    // value to the cent? That is a THIRD key — neither К1 nor К2 — and this is its yield.
    if (a.lastEur == null || !(a.lastEur > 0) || !a.unp) {
      m.rescue.none++;
      continue;
    }
    m.rescue.anchored++;
    const cands = (byUnp.get(a.unp) ?? []).filter(
      (c) =>
        a.suppliers.length === 0 ||
        a.suppliers.includes(normEik(c.contractorEik)),
    );
    const hits = cands.filter(
      (c) => c.signed != null && Math.abs(c.signed - a.lastEur!) < 0.005,
    );
    if (hits.length === 1) {
      m.rescue.unique++;
      if (a.moves) m.rescue.movesRescued++;
    } else if (hits.length > 1) m.rescue.ambiguous++;
    else m.rescue.none++;
  }
  return m;
};

// ── reporting ────────────────────────────────────────────────────────────────────────────────

const pct = (n: number, d: number): string =>
  `${((100 * n) / (d || 1)).toFixed(1)}%`;
const pad = (n: number): string => String(n).padStart(6);

const report = (m: Measured): void => {
  console.log(
    `\n══ --source=${m.source} ══ (${m.contracts.toLocaleString()} contract rows; ` +
      `basis split×${m.basisSplit.toLocaleString()}, full×${m.basisFull.toLocaleString()})`,
  );
  console.log("\n§1 coverage");
  console.log(`  ${pad(m.total)}  annex value-records in the cache`);
  console.log(
    `  ${pad(m.linked)}  linked to at least one contract  (${pct(m.linked, m.total)})`,
  );
  console.log(
    `  ${pad(m.unlinked)}  UNLINKED                        (${pct(m.unlinked, m.total)})`,
  );
  console.log(
    `          price-moving: ${pct(m.movesUnlinked, m.unlinked)} of the unlinked ` +
      `vs ${pct(m.movesTotal, m.total)} of the cache` +
      (m.movesUnlinked / (m.unlinked || 1) >= m.movesTotal / (m.total || 1)
        ? "  ⚠ the residue is not the harmless tail"
        : ""),
  );

  console.log(
    "\n§2 why each unlinked record was refused (first applicable cause)",
  );
  for (const c of CAUSES) {
    const n = m.causes.get(c) ?? 0;
    if (n) console.log(`  ${pad(n)}  ${c}`);
  }
  if (m.anchorRatios.size) {
    const top = [...m.anchorRatios].sort((a, b) => b[1] - a[1]).slice(0, 6);
    console.log(
      "\n  continuity refusals by signed/anchor ratio. An INTEGER ≥2 is the annex's own",
    );
    console.log(
      "  supplier count — i.e. the 087 un-split basis, not a value disagreement. ×1.96",
    );
    console.log(
      "  is the euro peg (1.95583), a currency mislabel, which guard 2 exists to catch:",
    );
    for (const [r, n] of top) {
      const v = Number(r);
      const note =
        Number.isInteger(v) && v >= 2
          ? "  ← member count"
          : v === 1.96
            ? "  ← peg"
            : "";
      console.log(`  ${pad(n)}  ×${r}${note}`);
    }
  }

  console.log(
    "\n§3 the contract-number axis (what a №-keyed resolver would break on)",
  );
  for (const [k, v] of Object.entries(m.numberAxis))
    console.log(`  ${v == null ? "   n/a" : pad(v)}  ${k}`);

  console.log(
    "\n§5 a value-anchored third key, costed (exact pre-annex value ↔ signing value)",
  );
  console.log(
    `  ${pad(m.rescue.anchored)}  unlinked records carrying a usable anchor`,
  );
  console.log(
    `  ${pad(m.rescue.unique)}  resolve to EXACTLY one contract  (${pct(m.rescue.unique, m.unlinked)} of unlinked, ${m.rescue.movesRescued} price-moving)`,
  );
  console.log(
    `  ${pad(m.rescue.ambiguous)}  more than one contract at that value`,
  );
  console.log(`  ${pad(m.rescue.none)}  no contract at that value`);
};

const reportDivergence = (a: Measured, b: Measured): void => {
  const onlyA = [...a.linkedIds].filter((id) => !b.linkedIds.has(id)).length;
  const onlyB = [...b.linkedIds].filter((id) => !a.linkedIds.has(id)).length;
  console.log(`\n══ §4 the residue between the two consumers ══`);
  console.log(
    `  ${pad(onlyA)}  linked on ${a.source} only  (in the value fold, absent from procurement_annexes)`,
  );
  console.log(
    `  ${pad(onlyB)}  linked on ${b.source} only  (in procurement_annexes, absent from the value fold)`,
  );
  console.log(
    `  ${pad(a.linkedIds.size)} / ${b.linkedIds.size}  linked on ${a.source} / ${b.source}`,
  );
  console.log(
    "\n  The two consumers link different annex RECORDS — the residue, not a contradiction:\n" +
      "  each declares its own per-row basis, and Postgres additionally holds ~2,680 synthetic\n" +
      "  `obed-` carrier rows with no shard row at all. Shrinking this is Tier 2 of\n" +
      "  docs/plans/annex-linkage-consortium-basis-v1.md; it does not go to zero.",
  );
};

// ── main ─────────────────────────────────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  const { idx, records, days } = buildAnnexIndex();
  const recs = readAnnexRecords();
  if (!JSON_OUT)
    console.log(
      `annex cache: ${days} published day-files, ${records.toLocaleString()} value-records ` +
        `(${idx.byContractNo.size.toLocaleString()} contract-№ keys, ` +
        `${idx.byUnpSupplier.size.toLocaleString()} УНП+supplier keys)`,
    );
  if (recs.length === 0) {
    console.error(
      "No annex cache — run `tsx scripts/procurement/ingest_anexi.ts --backfill` first.",
    );
    process.exit(1);
  }

  const tenderUnps = SOURCES.includes("pg") ? await loadTenderUnps() : null;
  const out: Measured[] = [];
  for (const s of SOURCES) {
    const rows = s === "pg" ? await loadPg() : loadShards();
    if (rows.length === 0) {
      console.error(`--source=${s}: no contract rows — skipping.`);
      continue;
    }
    out.push(measure(s, rows, recs, idx, tenderUnps));
  }

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        out.map((m) => ({
          ...m,
          linkedIds: undefined,
          causes: Object.fromEntries(m.causes),
          anchorRatios: Object.fromEntries(m.anchorRatios),
        })),
        null,
        2,
      ),
    );
  } else {
    for (const m of out) report(m);
    if (out.length === 2) reportDivergence(out[0], out[1]);
    console.log(
      "\n✓ read-only — this script has no --apply and writes nothing.",
    );
  }
  if (SOURCES.includes("pg")) {
    const { end } = await import("../db/lib/pg");
    await end();
  }
};

void main();
