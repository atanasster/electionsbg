// Tier B dispatcher — run one or more per-município naredba parsers,
// merge the produced blocks into data/local_taxes/index.json, and stamp
// per-município ingest watermarks under state/ingest/local_taxes_<code>.json.
//
// Usage:
//   npx tsx scripts/local_taxes/run_naredba.ts                    # all wired
//   npx tsx scripts/local_taxes/run_naredba.ts SOF00,PDV01        # subset
//   npx tsx scripts/local_taxes/run_naredba.ts --force SOF00      # bypass cache
//
// The Tier A build (build_index.ts) preserves any `naredba` blocks this
// dispatcher writes, so the two paths can run in either order safely.

import fs from "node:fs";
import path from "node:path";
import { NAREDBA_PARSERS, parsersByObshtina } from "./parsers";
import type { NaredbaBlock } from "./types";

const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);
const OUT_DIR = path.join(PROJECT_ROOT, "data/local_taxes");
const INDEX_FILE = path.join(OUT_DIR, "index.json");
const SHARD_PATH = (code: string): string => path.join(OUT_DIR, `${code}.json`);
const INGEST_DIR = path.join(PROJECT_ROOT, "state/ingest");

type ShardFile = {
  obshtina: string;
  ipi?: Record<string, unknown>;
  naredba?: NaredbaBlock;
};

const parseArgs = (argv: string[]): { force: boolean; targets: string[] } => {
  const args = argv.slice(2);
  const targets: string[] = [];
  let force = false;
  for (const a of args) {
    if (a === "--force") force = true;
    else if (a.includes(","))
      targets.push(...a.split(",").map((s) => s.trim()));
    else targets.push(a);
  }
  return { force, targets };
};

const main = async () => {
  const { force, targets } = parseArgs(process.argv);
  if (!fs.existsSync(INDEX_FILE)) {
    throw new Error(
      `${INDEX_FILE} not found — run scripts/local_taxes/build_index.ts (Tier A) first`,
    );
  }

  const allParsers = parsersByObshtina();
  const queue =
    targets.length > 0
      ? targets.map((code) => {
          const p = allParsers.get(code);
          if (!p) throw new Error(`no naredba parser wired for ${code}`);
          return p;
        })
      : NAREDBA_PARSERS;

  fs.mkdirSync(INGEST_DIR, { recursive: true });

  let ok = 0;
  let failed = 0;
  for (const parser of queue) {
    process.stdout.write(`· ${parser.obshtina} (${parser.label})…`);
    try {
      const result = await parser.parse();
      // Merge the new naredba block into the per-município shard,
      // preserving any ipi block Tier A already wrote.
      const shardFile = SHARD_PATH(result.obshtina);
      let shard: ShardFile = { obshtina: result.obshtina };
      if (fs.existsSync(shardFile)) {
        try {
          shard = JSON.parse(fs.readFileSync(shardFile, "utf-8")) as ShardFile;
        } catch {
          // fall through with a fresh shard
        }
      }
      shard.naredba = result.block;
      fs.writeFileSync(shardFile, JSON.stringify(shard, null, 2) + "\n");

      // Watermark per-município so the watch source can short-circuit
      // when the source PDF hasn't changed byte-for-byte.
      fs.writeFileSync(
        path.join(INGEST_DIR, `local_taxes_${result.obshtina}.json`),
        JSON.stringify(
          {
            obshtina: result.obshtina,
            sourceUrl: parser.url,
            sourceHash: result.sourceHash,
            lastSuccessfulIngest: new Date().toISOString(),
          },
          null,
          2,
        ) + "\n",
      );
      // Surface partial-side state when a multi-source parser reports
      // one side failed (e.g. Sofia FEES fetched but TAX naredba was
      // unreachable). The block still ships with whatever was parsed.
      const sidesNote = result.sides
        ? ` · sides=${Object.entries(result.sides)
            .map(([k, v]) => `${k}:${v}`)
            .join(",")}`
        : "";
      const partial =
        result.sides && Object.values(result.sides).some((s) => s === "failed");
      process.stdout.write(
        ` ${partial ? "ok (partial)" : "ok"} · basis=${
          result.block.tboResidential?.basis ?? "?"
        } · rate=${result.block.tboResidential?.rate ?? "?"}${sidesNote}\n`,
      );
      ok++;
      void force; // currently force-flag only matters at the fetch layer
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stdout.write(` FAIL: ${msg}\n`);
      failed++;
    }
  }

  // Per-município shards were written inline above — nothing to flush here.
  console.log(
    `\nwrote ${ok} naredba shard(s) under ${path.relative(PROJECT_ROOT, OUT_DIR)}/ · ${ok} parsed · ${failed} failed`,
  );
  if (failed > 0) process.exit(1);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
