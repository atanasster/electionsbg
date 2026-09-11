// Offline corpus capture: actual tool code, local files and local read-only PG.
// node --import tsx ai/toolgrad/capture.run.ts <new-output.json>
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { runTool } from "../tools/registry";
import { setFetcher, setDbFetcher, clearDataCache } from "../tools/dataClient";
import { withReadOnlyTx, pinLocalDatabase, end } from "../../scripts/db/lib/pg";
import type { DbRows } from "../../functions/db_table";
import { validateToolArgs } from "../orchestrator/toolSchema";
import {
  hash,
  LANGS,
  verifyCapture,
  verifyCorpus,
  inputInventory,
  type Corpus,
  type Evidence,
} from "./corpus";
import { SEEDS } from "./seeds";

async function main() {
  const output = process.argv[2];
  if (!output) throw new Error("Provide a new output JSON path");
  const root = resolve("data");
  pinLocalDatabase();
  const { DB_ROUTES } = createRequire(import.meta.url)(
    "../../functions/db_routes.js",
  ) as {
    DB_ROUTES: Record<
      string,
      (
        q: DbRows,
        params: Record<string, string>,
      ) => Promise<{ status?: number; body: unknown }>
    >;
  };
  let evidence: Evidence[] = [];
  setFetcher(async (path) => {
    const file = resolve(root, path.replace(/^\//, ""));
    if (relative(root, file).startsWith(".."))
      throw new Error("Data path escaped root");
    const data = JSON.parse(await readFile(file, "utf8"));
    evidence.push({
      source: `data/${relative(root, file)}`,
      sha256: hash(data),
    });
    return data;
  });
  setDbFetcher(async (route, params) => {
    if (!DB_ROUTES[route]) throw new Error(`Unknown DB route ${route}`);
    const query = Object.fromEntries(
      Object.entries(params)
        .filter(([, v]) => v != null && v !== "")
        .map(([k, v]) => [k, String(v)]),
    );
    const data = await withReadOnlyTx(async (rows) => {
      const q: DbRows = rows;
      q.tx = (cb) => cb(rows);
      const result = await DB_ROUTES[route](q, query);
      if ((result.status ?? 200) !== 200)
        throw new Error(`DB route ${route}: ${result.status}`);
      return result.body;
    });
    evidence.push({
      source: `local-pg:/api/db/${route}?${JSON.stringify(params)}`,
      sha256: hash(data),
    });
    return data;
  });
  const corpus: Corpus = {
    version: 1,
    capturedAt: new Date().toISOString(),
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    seedHash: hash(SEEDS),
    inputs: [],
    captures: [],
  };
  // Bundled election constants do not pass through the file fetcher.
  const bundled = {
    source: "src/data/json/elections.json",
    sha256: hash(
      JSON.parse(await readFile("src/data/json/elections.json", "utf8")),
    ),
  };
  for (const seed of SEEDS)
    for (const lang of LANGS) {
      if (!validateToolArgs(seed.tool, seed.args))
        throw new Error(`Invalid seed ${seed.id}`);
      clearDataCache();
      evidence = [bundled];
      const context = { lang, election: "2026_04_19" };
      const start = performance.now();
      const envelope = await runTool(seed.tool, seed.args, context);
      verifyCapture(seed, envelope);
      corpus.captures.push({
        seed,
        context,
        envelope,
        evidence,
        elapsedMs: performance.now() - start,
      });
      console.log(`${seed.id}:${lang} verified`);
    }
  corpus.inputs = inputInventory(corpus.captures);
  verifyCorpus(corpus, SEEDS);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(corpus, null, 2) + "\n", {
    flag: "wx",
  });
  console.log(`Captured ${corpus.captures.length} executions → ${output}`);
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(end);
