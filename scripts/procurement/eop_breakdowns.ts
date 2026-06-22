// Per-entity sector / procedure / EU-funding breakdowns + a corpus sector
// total, built from the EOP-enriched contract shards (run eop_field_map.ts
// --apply first). Powers the "Какво купува" / "Как купува" + EU-share widgets
// on /company/:eik and /awarder/:eik — the SIGMA entity-page parity views.
//
// Map-safe and rollup-independent: this reads only the contract shards and
// writes its own derived files, so it never touches rollups.ts / by_settlement
// / the awarder geo.
//
//   npx tsx scripts/procurement/eop_breakdowns.ts
//
// Output (all gitignored, ship via bucket:sync):
//   derived/breakdowns/c/<eik>.json   per-contractor breakdown
//   derived/breakdowns/a/<eik>.json   per-awarder breakdown
//   derived/sector_totals.json        corpus CPV-division + procedure + EU totals

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { canonicalJson } from "./validate";
import { procedureBucket, type ProcedureBucket } from "@/lib/cpvSectors";
import type { Contract } from "./types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROC = path.resolve(__dirname, "../../data/procurement");
const CONTRACTS_DIR = path.join(PROC, "contracts");
const DERIVED = path.join(PROC, "derived");
const BREAK_C = path.join(DERIVED, "breakdowns", "c");
const BREAK_A = path.join(DERIVED, "breakdowns", "a");

// Only emit a breakdown shard when the entity has at least this many
// CPV-coded contracts — a singleton's "100% one sector" isn't worth a file.
const MIN_CPV_CONTRACTS = 2;

interface Acc {
  totalEur: number;
  cpvKnownEur: number;
  cpvContracts: number;
  procKnownEur: number;
  euEur: number; // euFunded === true
  euKnownEur: number; // euFunded !== undefined
  cpv: Map<string, { eur: number; n: number }>;
  proc: Map<ProcedureBucket, { eur: number; n: number }>;
}

const blank = (): Acc => ({
  totalEur: 0,
  cpvKnownEur: 0,
  cpvContracts: 0,
  procKnownEur: 0,
  euEur: 0,
  euKnownEur: 0,
  cpv: new Map(),
  proc: new Map(),
});

const add = (acc: Acc, c: Contract): void => {
  const eur = c.amountEur ?? 0;
  acc.totalEur += eur;
  if (c.cpv) {
    const d = String(c.cpv).slice(0, 2);
    acc.cpvKnownEur += eur;
    acc.cpvContracts += 1;
    const e = acc.cpv.get(d) ?? { eur: 0, n: 0 };
    e.eur += eur;
    e.n += 1;
    acc.cpv.set(d, e);
  }
  if (c.procurementMethod) {
    acc.procKnownEur += eur;
    const b = procedureBucket(c.procurementMethod);
    const e = acc.proc.get(b) ?? { eur: 0, n: 0 };
    e.eur += eur;
    e.n += 1;
    acc.proc.set(b, e);
  }
  if (c.euFunded !== undefined) {
    acc.euKnownEur += eur;
    if (c.euFunded) acc.euEur += eur;
  }
};

// Serialise an accumulator to the compact on-disk shape (top 12 sectors).
const dump = (eik: string, acc: Acc) => ({
  eik,
  totalEur: Math.round(acc.totalEur),
  cpvKnownEur: Math.round(acc.cpvKnownEur),
  procKnownEur: Math.round(acc.procKnownEur),
  euEur: Math.round(acc.euEur),
  euKnownEur: Math.round(acc.euKnownEur),
  cpv: [...acc.cpv.entries()]
    .map(([d, v]) => ({ d, eur: Math.round(v.eur), n: v.n }))
    .sort((a, b) => b.eur - a.eur)
    .slice(0, 12),
  proc: [...acc.proc.entries()]
    .map(([b, v]) => ({ b, eur: Math.round(v.eur), n: v.n }))
    .sort((a, b) => b.eur - a.eur),
});

const main = (): void => {
  const contractors = new Map<string, Acc>();
  const awarders = new Map<string, Acc>();
  const corpusCpv = new Map<string, { eur: number; n: number }>();
  const corpusProc = new Map<ProcedureBucket, { eur: number; n: number }>();
  let euEur = 0;
  let euKnownEur = 0;

  for (const y of fs
    .readdirSync(CONTRACTS_DIR)
    .filter((d) => /^\d{4}$/.test(d))) {
    const dir = path.join(CONTRACTS_DIR, y);
    for (const f of fs.readdirSync(dir).filter((x) => /\.json$/.test(x))) {
      const rows = JSON.parse(
        fs.readFileSync(path.join(dir, f), "utf8"),
      ) as Contract[];
      for (const c of rows) {
        if (c.contractorEik) {
          const a = contractors.get(c.contractorEik) ?? blank();
          add(a, c);
          contractors.set(c.contractorEik, a);
        }
        if (c.awarderEik) {
          const a = awarders.get(c.awarderEik) ?? blank();
          add(a, c);
          awarders.set(c.awarderEik, a);
        }
        const eur = c.amountEur ?? 0;
        if (c.cpv) {
          const d = String(c.cpv).slice(0, 2);
          const e = corpusCpv.get(d) ?? { eur: 0, n: 0 };
          e.eur += eur;
          e.n += 1;
          corpusCpv.set(d, e);
        }
        if (c.procurementMethod) {
          const b = procedureBucket(c.procurementMethod);
          const e = corpusProc.get(b) ?? { eur: 0, n: 0 };
          e.eur += eur;
          e.n += 1;
          corpusProc.set(b, e);
        }
        if (c.euFunded !== undefined) {
          euKnownEur += eur;
          if (c.euFunded) euEur += eur;
        }
      }
    }
  }

  // Clean + rewrite the per-entity shard dirs.
  for (const dir of [BREAK_C, BREAK_A]) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }
  const writeShards = (m: Map<string, Acc>, dir: string): number => {
    let n = 0;
    for (const [eik, acc] of m) {
      if (acc.cpvContracts < MIN_CPV_CONTRACTS) continue;
      fs.writeFileSync(
        path.join(dir, `${eik}.json`),
        canonicalJson(dump(eik, acc)),
      );
      n += 1;
    }
    return n;
  };
  const nc = writeShards(contractors, BREAK_C);
  const na = writeShards(awarders, BREAK_A);

  const corpus = {
    generatedAt: new Date().toISOString(),
    euEur: Math.round(euEur),
    euKnownEur: Math.round(euKnownEur),
    cpv: [...corpusCpv.entries()]
      .map(([d, v]) => ({ d, eur: Math.round(v.eur), n: v.n }))
      .sort((a, b) => b.eur - a.eur),
    proc: [...corpusProc.entries()]
      .map(([b, v]) => ({ b, eur: Math.round(v.eur), n: v.n }))
      .sort((a, b) => b.eur - a.eur),
  };
  fs.writeFileSync(
    path.join(DERIVED, "sector_totals.json"),
    canonicalJson(corpus),
  );

  console.log(
    `✓ breakdowns: ${nc} contractor + ${na} awarder shard(s); ` +
      `sector_totals.json (${corpus.cpv.length} divisions, ` +
      `EU ${((euEur / euKnownEur) * 100).toFixed(0)}% of known €)`,
  );
};

main();
