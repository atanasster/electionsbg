// One streaming pass over the contract month-shards, producing the aggregates
// the invariant tests assert against. Reads ~685MB but retains only counters,
// key/twin sets, and per-EIK euro maps (never the row objects), so peak memory
// stays modest. The shard layout is data/procurement/contracts/<YYYY>/<YYYY-MM>.json
// (bare Contract[]); the contracts/by-id/ subtree is the deep-link store, not a
// month shard, so it is skipped.
//
// The relationships encoded here were measured against the live corpus on
// 2026-06-30 — see docs/plans/sql-migration-v1.md (Phase 1):
//   • totals.contracts   == count(tag === "contract")
//   • totals.amendments  == count(tag === "contractAmendment")
//   • totals.totalEur    == Σ amountEur where tag !== "contractAmendment"  (cents-exact)
//   • per-entity rollup totalEur is contract-only (amendments excluded)
//   • contract `key` is globally unique; zero synthetic "-x" twin survivors

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { PROC_DIR } from "./paths";
import { BGN_PER_EUR } from "../../../src/lib/currency";

interface ContractRow {
  key: string;
  ocid: string;
  tag: string;
  date: string;
  awarderEik: string;
  contractorEik: string;
  contractorName?: string;
  awarderName?: string;
  amount?: number;
  currency?: string;
  amountEur?: number;
  /** At-signing euro value; present only when an annex flipped amountEur to the
   *  current value. The euro-peg canary checks this (it pegs to native `amount`),
   *  not the annexed amountEur. */
  signingAmountEur?: number;
  title?: string;
}

export interface ContractsAggregate {
  rows: number;
  byTag: Record<string, number>;
  /** Σ amountEur per tag. */
  eurByTag: Record<string, number>;
  /** Σ amountEur over rows whose tag is not an amendment (the headline basis). */
  nonAmendEur: number;
  distinctKeyCount: number;
  duplicateKeys: string[];
  xTwinSurvivors: number;
  xTwinSample: string[];
  /** Contract-only euro total per contractor / awarder EIK (matches rollups). */
  contractorEur: Map<string, number>;
  awarderEur: Map<string, number>;
  /** Distinct EIKs across all tags vs non-amendment tags. */
  contractorEikAll: Set<string>;
  contractorEikNonAmend: Set<string>;
  awarderEikAll: Set<string>;
  awarderEikNonAmend: Set<string>;
  /** EUR-peg violations (BGN rows whose amountEur ≠ amount / 1.95583, or EUR
   *  rows whose amountEur ≠ amount), capped. */
  pegViolations: Array<{
    key: string;
    currency: string;
    amount: number;
    amountEur: number;
    expected: number;
  }>;
}

const BGN_CODES = new Set(["BGN", "ЛВ", "ЛВ.", "ЛЕВА"]);
const PEG_CAP = 25;

const monthShardDir = path.join(PROC_DIR, "contracts");

const twinKey = (c: ContractRow): string =>
  [c.date, c.awarderEik, c.contractorEik, c.amount, c.title].join(" ");

/** Stream the month shards and accumulate the invariant aggregates. */
export const aggregateContracts = (): ContractsAggregate => {
  const byTag: Record<string, number> = {};
  const eurByTag: Record<string, number> = {};
  let rows = 0;
  let nonAmendEur = 0;

  const keys = new Set<string>();
  const duplicateKeys: string[] = [];
  const realTwins = new Set<string>();
  const xTwins: string[] = [];

  const contractorEur = new Map<string, number>();
  const awarderEur = new Map<string, number>();
  const contractorEikAll = new Set<string>();
  const contractorEikNonAmend = new Set<string>();
  const awarderEikAll = new Set<string>();
  const awarderEikNonAmend = new Set<string>();
  const pegViolations: ContractsAggregate["pegViolations"] = [];

  const add = (m: Map<string, number>, k: string, v: number): void => {
    m.set(k, (m.get(k) ?? 0) + v);
  };

  for (const year of readdirSync(monthShardDir).sort()) {
    const dir = path.join(monthShardDir, year);
    if (year === "by-id" || !statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith(".json")) continue;
      const arr: ContractRow[] = JSON.parse(
        readFileSync(path.join(dir, f), "utf8"),
      );
      for (const c of arr) {
        rows++;
        byTag[c.tag] = (byTag[c.tag] ?? 0) + 1;

        if (keys.has(c.key)) duplicateKeys.push(c.key);
        else keys.add(c.key);

        if (/-x$/.test(c.ocid)) xTwins.push(twinKey(c));
        else realTwins.add(twinKey(c));

        const eur = typeof c.amountEur === "number" ? c.amountEur : 0;
        eurByTag[c.tag] = (eurByTag[c.tag] ?? 0) + eur;

        contractorEikAll.add(c.contractorEik);
        awarderEikAll.add(c.awarderEik);
        if (c.tag !== "contractAmendment") {
          nonAmendEur += eur;
          add(contractorEur, c.contractorEik, eur);
          add(awarderEur, c.awarderEik, eur);
          contractorEikNonAmend.add(c.contractorEik);
          awarderEikNonAmend.add(c.awarderEik);
        }

        // EUR peg spot-check. `amount`/`currency` are the native SIGNED figures,
        // so they peg to the SIGNING euro value — signingAmountEur when an annex
        // flipped amountEur to the current value, else amountEur itself.
        const pegBasis =
          typeof c.signingAmountEur === "number"
            ? c.signingAmountEur
            : c.amountEur;
        if (
          pegViolations.length < PEG_CAP &&
          typeof c.amount === "number" &&
          typeof pegBasis === "number" &&
          c.currency
        ) {
          const code = c.currency.trim().toUpperCase();
          let expected: number | null = null;
          if (code === "EUR") expected = c.amount;
          else if (BGN_CODES.has(code)) expected = c.amount / BGN_PER_EUR;
          if (expected !== null && Math.abs(pegBasis - expected) > 0.01) {
            pegViolations.push({
              key: c.key,
              currency: code,
              amount: c.amount,
              amountEur: pegBasis,
              expected,
            });
          }
        }
      }
    }
  }

  let xTwinSurvivors = 0;
  const xTwinSample: string[] = [];
  for (const k of xTwins) {
    if (realTwins.has(k)) {
      xTwinSurvivors++;
      if (xTwinSample.length < 5) xTwinSample.push(k);
    }
  }

  return {
    rows,
    byTag,
    eurByTag,
    nonAmendEur,
    distinctKeyCount: keys.size,
    duplicateKeys: [...new Set(duplicateKeys)],
    xTwinSurvivors,
    xTwinSample,
    contractorEur,
    awarderEur,
    contractorEikAll,
    contractorEikNonAmend,
    awarderEikAll,
    awarderEikNonAmend,
    pegViolations,
  };
};

export const centsEqual = (a: number, b: number): boolean =>
  Math.round(a * 100) === Math.round(b * 100);
