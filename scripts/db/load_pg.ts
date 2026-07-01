// Load the contract corpus into Postgres — the PG port of load_procurement.ts.
// Reuses the shared column⇄field map (lib/procurement_schema) so the loaded rows
// are identical to the SQLite loader's; the generators (source-agnostic) then
// read from PG instead of node:sqlite. Full rebuild from the month shards.
//
//   npm run db:load:pg          (needs `npm run db:pg:up` first)
//
// See docs/plans/postgres-migration-v1.md.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PROC_DIR } from "./lib/paths";
import { getPool, exec, withClient, end } from "./lib/pg";
import { COLUMN_NAMES, contractToRow } from "./lib/procurement_schema";
import type { Contract } from "../procurement/types";

const SCHEMA_FILE = path.join(
  PROC_DIR,
  "..",
  "..",
  "scripts",
  "db",
  "schema",
  "pg",
  "001_procurement.sql",
);
const monthShardDir = path.join(PROC_DIR, "contracts");
const N = COLUMN_NAMES.length;
const BATCH = 1000; // 1000 × 31 cols = 31k params (< PG's 65535 cap)

const gitSha = (): string => {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
};

const readShards = (): { rows: Contract[]; years: Set<string> } => {
  const rows: Contract[] = [];
  const years = new Set<string>();
  for (const year of readdirSync(monthShardDir).sort()) {
    const dir = path.join(monthShardDir, year);
    if (year === "by-id" || !statSync(dir).isDirectory()) continue;
    years.add(year);
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith(".json")) continue;
      for (const c of JSON.parse(
        readFileSync(path.join(dir, f), "utf8"),
      ) as Contract[])
        rows.push(c);
    }
  }
  return { rows, years };
};

const waitForPg = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) {
    try {
      await getPool().query("SELECT 1");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("Postgres not reachable — run `npm run db:pg:up`.");
};

export const loadPg = async (): Promise<{ rows: number; years: string[] }> => {
  await waitForPg();
  await exec(readFileSync(SCHEMA_FILE, "utf8"));

  const { rows, years } = readShards();

  await withClient(async (c) => {
    await c.query("BEGIN");
    await c.query("TRUNCATE contracts");
    const insertCols = COLUMN_NAMES.join(", ");
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values = batch
        .map(
          (_, r) =>
            `(${COLUMN_NAMES.map((_, col) => `$${r * N + col + 1}`).join(",")})`,
        )
        .join(",");
      const params = batch.flatMap((row) => contractToRow(row));
      await c.query(
        `INSERT INTO contracts (${insertCols}) VALUES ${values}`,
        params,
      );
    }
    const sorted = [...years].sort();
    await c.query("TRUNCATE meta");
    await c.query(
      "INSERT INTO meta (key, value) VALUES ($1,$2),($3,$4),($5,$6),($7,$8),($9,$10)",
      [
        "schema_version",
        "pg/001_procurement.sql",
        "generated_at",
        new Date().toISOString(),
        "code_git_sha",
        gitSha(),
        "contracts",
        String(rows.length),
        "coverage",
        `${sorted[0]}..${sorted.at(-1)}`,
      ],
    );
    await c.query("COMMIT");
  });

  return { rows: rows.length, years: [...years].sort() };
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (!existsSync(path.join(PROC_DIR, "index.json"))) {
    console.error(`No procurement data at ${PROC_DIR} — run the ingest first.`);
    process.exit(1);
  }
  const t0 = Date.now();
  loadPg()
    .then(async ({ rows, years }) => {
      console.log(
        `loaded ${rows} contracts → Postgres (${years[0]}..${years.at(-1)}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      );
      await end();
    })
    .catch(async (e) => {
      console.error(e);
      await end();
      process.exit(1);
    });
}
