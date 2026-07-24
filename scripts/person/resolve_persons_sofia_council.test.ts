// Regression: Sofia's 24 район shards (S2***) each carry a REPLICA of the
// city-wide Столичен общински съвет slate — the council is elected city-wide and
// only the parent `SOF` shard is authoritative. The person resolver used to walk
// every shard's council, minting one councillor role per район per seat, so a
// single СОС councillor (e.g. Ваня Григорова) surfaced as "Общински съветник"
// against all 24 район names (Изгрев / Лозенец / Триадица / …) on /person/*.
//
// councilShardReplicatesSofia() is the guard; these hermetic checks lock (1) the
// predicate and (2) the raw-data invariant it depends on — that S2*** council
// blocks really are replicas of SOF, not each район's own body.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { councilShardReplicatesSofia } from "./resolve_persons";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const MI_DIR = path.join(REPO_ROOT, "data", "2023_10_29_mi", "municipalities");

type Shard = {
  obshtinaCode: string;
  council?: { candidates?: { name: string; isElected?: boolean }[] }[];
};

const readShard = (code: string): Shard =>
  JSON.parse(fs.readFileSync(path.join(MI_DIR, `${code}.json`), "utf8"));

const electedNames = (s: Shard): string[] =>
  (s.council ?? [])
    .flatMap((p) => p.candidates ?? [])
    .filter((c) => c.isElected && c.name)
    .map((c) => c.name);

describe("councilShardReplicatesSofia", () => {
  it("flags every Sofia район code (S2***) and nothing else", () => {
    for (const code of ["S2302", "S2401", "S2511", "S2524"])
      expect(councilShardReplicatesSofia(code)).toBe(true);
    for (const code of ["SOF", "BGS01", "PDV22", "VAR06", "S23", "S2"])
      expect(councilShardReplicatesSofia(code)).toBe(false);
  });
});

describe("mi2023 Sofia council replication invariant", () => {
  // Skip gracefully if the mi2023 tree isn't present (fresh clone before ingest).
  const have = fs.existsSync(path.join(MI_DIR, "SOF.json"));
  it.runIf(have)(
    "район shards replicate SOF's elected council verbatim — so only SOF is authoritative",
    () => {
      const sof = new Set(electedNames(readShard("SOF")));
      expect(sof.size).toBeGreaterThan(0);

      const rayonCodes = fs
        .readdirSync(MI_DIR)
        .filter((f) => /^S2\d{3}\.json$/.test(f))
        .map((f) => f.replace(/\.json$/, ""));
      expect(rayonCodes.length).toBe(24);

      for (const code of rayonCodes) {
        const names = electedNames(readShard(code));
        // Whatever council a район shard carries is exactly SOF's slate — never
        // a район-specific body — which is why the resolver must skip it.
        for (const n of names) expect(sof.has(n)).toBe(true);
      }
    },
  );

  it.runIf(have)(
    "a СОС councillor is elected once city-wide (Ваня Григорова)",
    () => {
      const isGrigorova = (n: string) =>
        n.includes("Ваня") && n.includes("Григоров");
      expect(electedNames(readShard("SOF")).filter(isGrigorova).length).toBe(1);
    },
  );
});
