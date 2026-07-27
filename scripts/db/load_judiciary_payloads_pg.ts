// Load the judiciary precomputed page-payload blobs into Postgres (schema:
// 109_judiciary_payloads.sql). SERVING loader — never writes JSON back.
//
// Today's single tenant is kind='declarations', key='' — the ИВСС magistrate-
// declaration register index (data/judiciary/declarations.json, written by the
// live scrape in scripts/judiciary/__write_declarations.ts). The route
// `judiciary-declarations` then serves the blob verbatim so the frontend hook
// and the judiciaryDeclarations AI tool stop downloading the static JSON.
//
// No recordIngestBatch: a (kind,key,payload) blob has no per-entity rows to
// count, and — like fund_payloads (043) — the payload table is the serving copy,
// not a freshness source. The register's own changelog is unaffected.
//
// Run: `npm run db:load:judiciary-payloads:pg` (local) / `:cloud` (Cloud SQL proxy).

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exec, withClient, end } from "./lib/pg";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SCHEMA = path.join(
  ROOT,
  "scripts/db/schema/pg/109_judiciary_payloads.sql",
);
const DECLARATIONS_SRC = path.join(ROOT, "data/judiciary/declarations.json");

// One row per (kind, key). `text` is the raw file JSON, cast to jsonb on insert.
const collectPayloads = (): { kind: string; key: string; text: string }[] => {
  const rows: { kind: string; key: string; text: string }[] = [];
  if (existsSync(DECLARATIONS_SRC)) {
    // Parse-then-stringify to fail loudly on a malformed artifact and to store
    // canonical JSON (no trailing newline / formatting drift).
    const blob = JSON.parse(readFileSync(DECLARATIONS_SRC, "utf8"));
    rows.push({ kind: "declarations", key: "", text: JSON.stringify(blob) });
  } else {
    throw new Error(
      `judiciary payload source missing: ${DECLARATIONS_SRC} — run the declarations scrape first`,
    );
  }
  return rows;
};

export const loadJudiciaryPayloadsPg = async (): Promise<{
  payloads: number;
}> => {
  await exec(readFileSync(SCHEMA, "utf8"));
  const rows = collectPayloads();

  await withClient(async (c) => {
    await c.query("BEGIN");
    await c.query("TRUNCATE judiciary_payloads");
    for (const p of rows) {
      await c.query(
        `INSERT INTO judiciary_payloads (kind, key, payload)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (kind, key) DO NOTHING`,
        [p.kind, p.key, p.text],
      );
    }
    await c.query("COMMIT");
  });

  return { payloads: rows.length };
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadJudiciaryPayloadsPg()
    .then(({ payloads }) => {
      console.log(`judiciary_payloads: loaded ${payloads} blob(s)`);
      return end();
    })
    .catch(async (e) => {
      console.error(e);
      await end();
      process.exit(1);
    });
}
