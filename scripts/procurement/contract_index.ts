// Slim per-year contract index for the faceted /procurement/contracts browser.
// A static SPA can't filter 301k rows server-side like SIGMA, so we shard by
// year (the first facet): each shard is loaded on demand, then filtered
// (sector / procedure / value / EU) + sorted + paginated client-side. Built
// from the EOP-enriched shards — run eop_field_map.ts first.
//
//   npx tsx scripts/procurement/contract_index.ts
//
// Output (gitignored, ship via bucket:sync):
//   derived/contract_index/<year>.json   { awarders, contractors, rows }
//   derived/contract_index/index.json    years + counts + the ROW schema
//
// Awarder/contractor names repeat thousands of times per year, so we
// dictionary-encode them (eik → name) and store only the eik in each row. The
// hook rehydrates by reference, so 40k+ rows share a few thousand name strings
// instead of allocating one per row — a real parse-time + memory win on top of
// the gzip transport (see scripts/bucket_gzip.ts). Compact row tuple (positional):
//   [date, awarderEik, contractorEik, amountEur, cpvDivision,
//    procedureBucket, euFunded(1|0|null), title, key, bidCount, cpv, euProgram]
// The hook re-expands this to the public ROW_SCHEMA below.
//
// `key` lets the browser deep-link each row to /procurement/contract/:key
// (resolved by the prefix-sharded by-id store — see by_id_shards.ts). `bidCount`
// (numberOfTenderers) lets the table compute the single-bidder red flag inline,
// without fetching the full contract.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { canonicalJson } from "./validate";
import { procedureBucket } from "@/lib/cpvSectors";
import type { Contract } from "./types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROC = path.resolve(__dirname, "../../data/procurement");
const CONTRACTS_DIR = path.join(PROC, "contracts");
const OUT = path.join(PROC, "derived", "contract_index");

const ROW_SCHEMA = [
  "date",
  "awarderEik",
  "awarderName",
  "contractorEik",
  "contractorName",
  "amountEur",
  "cpvDivision",
  "procedureBucket",
  "euFunded",
  "title",
  "key",
  "bidCount",
  "cpv",
  "euProgram",
] as const;

// Compact, dictionary-encoded row: names live in the per-shard eik→name maps.
//   [date, awarderEik, contractorEik, amountEur, cpvDivision,
//    procedureBucket, euFunded(1|0|null), title, key, bidCount, cpv, euProgram]
// `cpv` is the full 8-digit code (cpvDivision is its 2-digit prefix, kept for
// the existing sector facet); `euProgram` is the operational-programme name
// shown in the EU-badge tooltip (both "" when absent).
type CompactRow = [
  string,
  string,
  string,
  number,
  string,
  string,
  0 | 1 | null,
  string,
  string,
  number | null,
  string,
  string,
];

const trunc = (s: string | undefined, n: number): string =>
  !s ? "" : s.length > n ? s.slice(0, n - 1) + "…" : s;

export const main = (): void => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const years = fs
    .readdirSync(CONTRACTS_DIR)
    .filter((y) => /^\d{4}$/.test(y))
    .sort();
  const counts: Record<string, number> = {};

  for (const y of years) {
    const dir = path.join(CONTRACTS_DIR, y);
    const rows: CompactRow[] = [];
    const awarders: Record<string, string> = {};
    const contractors: Record<string, string> = {};
    for (const f of fs.readdirSync(dir).filter((x) => /\.json$/.test(x))) {
      const shard = JSON.parse(
        fs.readFileSync(path.join(dir, f), "utf8"),
      ) as Contract[];
      for (const c of shard) {
        // Amendments aren't standalone awards — keep the browser to contracts.
        if (c.tag === "contractAmendment") continue;
        if (c.awarderEik && !(c.awarderEik in awarders))
          awarders[c.awarderEik] = trunc(c.awarderName, 48);
        if (c.contractorEik && !(c.contractorEik in contractors))
          contractors[c.contractorEik] = trunc(c.contractorName, 38);
        rows.push([
          c.dateSigned || c.date,
          c.awarderEik,
          c.contractorEik,
          Math.round(c.amountEur ?? 0),
          c.cpv ? String(c.cpv).slice(0, 2) : "",
          c.procurementMethod ? procedureBucket(c.procurementMethod) : "",
          c.euFunded === true ? 1 : c.euFunded === false ? 0 : null,
          trunc(c.title, 70),
          c.key,
          typeof c.numberOfTenderers === "number" ? c.numberOfTenderers : null,
          c.cpv ? String(c.cpv) : "",
          trunc(c.euProgram, 90),
        ]);
      }
    }
    rows.sort((a, b) => b[3] - a[3]); // value desc — the browser's default sort
    fs.writeFileSync(
      path.join(OUT, `${y}.json`),
      canonicalJson({ awarders, contractors, rows }),
    );
    counts[y] = rows.length;
  }

  fs.writeFileSync(
    path.join(OUT, "index.json"),
    canonicalJson({
      generatedAt: new Date().toISOString(),
      schema: ROW_SCHEMA,
      years: years.map((y) => ({ year: y, count: counts[y] })),
    }),
  );

  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  console.log(
    `✓ contract_index: ${years.length} year shard(s), ${total.toLocaleString()} rows`,
  );
};

// Auto-run only when invoked directly; imported by dedup_contract_keys.ts so the
// re-key migration can refresh the index in-process.
const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) main();
