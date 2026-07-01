// Phase 2c — generate the per-entity contract lists (contractor_contracts,
// awarder_contracts) and the by-id prefix store FROM SQL, and verify they
// reproduce the on-disk JSON.
//
// These embed full Contract rows, which carry 113 source-dependent field
// orderings (see docs/plans/sql-migration-v1.md), so byte-identity isn't the
// goal — the check is order-independent deep-equal: same rows, same sequence
// (per-entity sort), same counts/names. The contract-list files are rounded via
// canonicalJson (so we round the generated objects the same way before
// comparing); by-id shards are full-precision compact maps compared directly.
//
//   npm run db:gen-lists            # verify only (default)
//   npm run db:gen-lists -- --write # also write the files
//
// See docs/plans/sql-migration-v1.md.

import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { PROC_DIR } from "../lib/paths";
import { readContractsFromPg } from "../lib/rows";
import { stripVolatile } from "../lib/canonical";
import {
  buildContractorContractsFiles,
  type ContractorContractsFile,
} from "../../procurement/contractor_contracts";
import {
  buildAwarderContractsFiles,
  type AwarderContractsFile,
} from "../../procurement/awarder_contracts";
import { buildByIdBuckets } from "../../procurement/by_id_shards";
import { canonicalJson } from "../../procurement/validate";
import type { Contract } from "../../procurement/types";

type EntityFile = ContractorContractsFile | AwarderContractsFile;

interface CompareResult {
  match: number;
  diff: number;
  missing: number;
  extra: number;
  samples: string[];
}

// Compare rounded (canonicalJson) generated per-entity files to the live files,
// key-order + field-order independent. Handles the blank EIK (filename ".json").
const compareEntityFiles = (
  kind: string,
  files: EntityFile[],
): CompareResult => {
  const dir = path.join(PROC_DIR, kind);
  const liveNames = new Set(
    fs.readdirSync(dir).filter((f) => f.endsWith(".json")),
  );
  const genNames = new Set<string>();
  let match = 0;
  let diff = 0;
  let missing = 0;
  const samples: string[] = [];

  for (const file of files) {
    const name = `${file.eik}.json`;
    genNames.add(name);
    const live = path.join(dir, name);
    if (!fs.existsSync(live)) {
      missing++;
      if (samples.length < 8) samples.push(`${name} (no live)`);
      continue;
    }
    const gen = stripVolatile(JSON.parse(canonicalJson(file)));
    const liv = stripVolatile(JSON.parse(fs.readFileSync(live, "utf8")));
    if (isDeepStrictEqual(gen, liv)) match++;
    else {
      diff++;
      if (samples.length < 8) samples.push(file.eik || "<blank>");
    }
  }

  const extra = [...liveNames].filter((n) => !genNames.has(n)).length;
  return { match, diff, missing, extra, samples };
};

const compareByIdBuckets = (
  buckets: Map<string, Record<string, Contract>>,
): CompareResult => {
  const dir = path.join(PROC_DIR, "contracts", "by-id", "shard");
  const liveNames = new Set(
    fs.readdirSync(dir).filter((f) => f.endsWith(".json")),
  );
  const genNames = new Set<string>();
  let match = 0;
  let diff = 0;
  let missing = 0;
  const samples: string[] = [];

  for (const [prefix, bucket] of buckets) {
    const name = `${prefix}.json`;
    genNames.add(name);
    const live = path.join(dir, name);
    if (!fs.existsSync(live)) {
      missing++;
      if (samples.length < 8) samples.push(`${name} (no live)`);
      continue;
    }
    const liv = JSON.parse(fs.readFileSync(live, "utf8"));
    if (isDeepStrictEqual(bucket, liv)) match++;
    else {
      diff++;
      if (samples.length < 8) samples.push(prefix);
    }
  }

  const extra = [...liveNames].filter((n) => !genNames.has(n)).length;
  return { match, diff, missing, extra, samples };
};

const report = (label: string, r: CompareResult): void =>
  console.log(
    `${label}: ${r.match} match, ${r.diff} diff, ${r.missing} missing-live, ${r.extra} extra-live` +
      (r.samples.length ? `  e.g. ${r.samples.join(", ")}` : ""),
  );

const main = async (): Promise<void> => {
  const write = process.argv.includes("--write");

  const t0 = Date.now();
  const rows: Contract[] = await readContractsFromPg();
  console.log(
    `read ${rows.length} rows from Postgres in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );

  const now = new Date().toISOString();
  const contractorFiles = buildContractorContractsFiles(rows, now);
  const awarderFiles = buildAwarderContractsFiles(rows, now);
  const buckets = buildByIdBuckets(rows);

  const c = compareEntityFiles("contractor_contracts", contractorFiles);
  const a = compareEntityFiles("awarder_contracts", awarderFiles);
  const b = compareByIdBuckets(buckets);
  report("contractor_contracts", c);
  report("awarder_contracts", a);
  report("by-id shards", b);

  if (write) {
    const writeEntity = (kind: string, files: EntityFile[]): void => {
      const dir = path.join(PROC_DIR, kind);
      fs.mkdirSync(dir, { recursive: true });
      const keep = new Set<string>();
      for (const f of files) {
        fs.writeFileSync(path.join(dir, `${f.eik}.json`), canonicalJson(f));
        keep.add(`${f.eik}.json`);
      }
      for (const name of fs.readdirSync(dir))
        if (name.endsWith(".json") && !keep.has(name))
          fs.unlinkSync(path.join(dir, name));
    };
    writeEntity("contractor_contracts", contractorFiles);
    writeEntity("awarder_contracts", awarderFiles);
    const shardDir = path.join(PROC_DIR, "contracts", "by-id", "shard");
    fs.rmSync(shardDir, { recursive: true, force: true });
    fs.mkdirSync(shardDir, { recursive: true });
    for (const [prefix, bucket] of buckets)
      fs.writeFileSync(
        path.join(shardDir, `${prefix}.json`),
        JSON.stringify(bucket),
      );
    console.log("wrote contractor_contracts, awarder_contracts, by-id shards");
  }

  const clean = [c, a, b].every(
    (r) => r.diff === 0 && r.missing === 0 && r.extra === 0,
  );
  console.log(clean ? "OK — reproduces on-disk output" : "DIFFERENCES FOUND");
  process.exit(clean ? 0 : 1);
};

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
