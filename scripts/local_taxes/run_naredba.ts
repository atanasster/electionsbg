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
const OUT_FILE = path.join(PROJECT_ROOT, "data/local_taxes/index.json");
const INGEST_DIR = path.join(PROJECT_ROOT, "state/ingest");

type ExistingFile = {
  scoresByObshtina: Record<
    string,
    { ipi?: Record<string, unknown>; naredba?: NaredbaBlock }
  >;
  [k: string]: unknown;
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
  if (!fs.existsSync(OUT_FILE)) {
    throw new Error(
      `${OUT_FILE} not found — run scripts/local_taxes/build_index.ts (Tier A) first`,
    );
  }
  const existing = JSON.parse(
    fs.readFileSync(OUT_FILE, "utf-8"),
  ) as ExistingFile;

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
      // Merge into the scoresByObshtina entry, preserving any ipi block
      // Tier A already wrote.
      const prev = existing.scoresByObshtina[result.obshtina] ?? {};
      existing.scoresByObshtina[result.obshtina] = {
        ...prev,
        naredba: result.block,
      };

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
      process.stdout.write(
        ` ok · basis=${result.block.tboResidential?.basis ?? "?"} · rate=${
          result.block.tboResidential?.rate ?? "?"
        }\n`,
      );
      ok++;
      void force; // currently force-flag only matters at the fetch layer
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stdout.write(` FAIL: ${msg}\n`);
      failed++;
    }
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(existing, null, 2) + "\n");
  console.log(
    `\nwrote ${path.relative(PROJECT_ROOT, OUT_FILE)} · ${ok} parsed · ${failed} failed`,
  );
  if (failed > 0) process.exit(1);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
