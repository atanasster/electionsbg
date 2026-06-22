// Slim per-year contract index for the faceted /procurement/contracts browser.
// A static SPA can't filter 301k rows server-side like SIGMA, so we shard by
// year (the first facet): each shard is a compact tuple array the browser loads
// on demand, then filters (sector / procedure / value / EU) + sorts + paginates
// client-side. Built from the EOP-enriched shards — run eop_field_map.ts first.
//
//   npx tsx scripts/procurement/contract_index.ts
//
// Output (gitignored, ship via bucket:sync):
//   derived/contract_index/<year>.json   tuple rows for that year
//   derived/contract_index/index.json     years + counts + the ROW schema
//
// Row tuple (kept positional to shave ~30% vs object keys):
//   [date, awarderEik, awarderName, contractorEik, contractorName,
//    amountEur, cpvDivision, procedureBucket, euFunded(1|0|null), title]

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
] as const;

type Row = [
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  string,
  0 | 1 | null,
  string,
];

const trunc = (s: string | undefined, n: number): string =>
  !s ? "" : s.length > n ? s.slice(0, n - 1) + "…" : s;

const main = (): void => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const years = fs
    .readdirSync(CONTRACTS_DIR)
    .filter((y) => /^\d{4}$/.test(y))
    .sort();
  const counts: Record<string, number> = {};

  for (const y of years) {
    const dir = path.join(CONTRACTS_DIR, y);
    const rows: Row[] = [];
    for (const f of fs.readdirSync(dir).filter((x) => /\.json$/.test(x))) {
      const shard = JSON.parse(
        fs.readFileSync(path.join(dir, f), "utf8"),
      ) as Contract[];
      for (const c of shard) {
        // Amendments aren't standalone awards — keep the browser to contracts.
        if (c.tag === "contractAmendment") continue;
        rows.push([
          c.dateSigned || c.date,
          c.awarderEik,
          trunc(c.awarderName, 48),
          c.contractorEik,
          trunc(c.contractorName, 38),
          Math.round(c.amountEur ?? 0),
          c.cpv ? String(c.cpv).slice(0, 2) : "",
          c.procurementMethod ? procedureBucket(c.procurementMethod) : "",
          c.euFunded === true ? 1 : c.euFunded === false ? 0 : null,
          trunc(c.title, 70),
        ]);
      }
    }
    rows.sort((a, b) => b[5] - a[5]); // value desc — the browser's default sort
    fs.writeFileSync(path.join(OUT, `${y}.json`), canonicalJson(rows));
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

main();
