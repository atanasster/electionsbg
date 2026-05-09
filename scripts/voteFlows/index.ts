// Vote-flow ("Where did the votes go") pipeline entry. Builds an estimated
// transition matrix between every consecutive pair of parliamentary
// elections. Each cycle pair becomes a directory of per-scope files:
//
//   /public/transitions/<from>_<to>/national.json       (~12KB)
//   /public/transitions/<from>_<to>/<mir>.json          (~8KB each)
//   /public/transitions/index.json                       (catalog)
//
// Splitting per scope means the home dashboard fetches ~12KB instead of
// the ~436KB combined file used previously. Run on demand via
// `npm run data -- --flows`, and as part of `npm run prod` when --all is
// set.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CanonicalPartiesIndex } from "@/data/parties/canonicalPartyTypes";
import { ElectionInfo } from "@/data/dataTypes";
import { reconcileCycles } from "./reconcile";
import { estimateOblast } from "./estimate";
import { buildVoteFlowScopeFiles } from "./aggregate";
import { VoteFlowIndex } from "@/data/voteFlows/voteFlowTypes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const generateVoteFlows = ({
  publicFolder,
  stringify,
}: {
  publicFolder: string;
  stringify: (o: object) => string;
}) => {
  const electionsFile = path.resolve(
    __dirname,
    "../../src/data/json/elections.json",
  );
  // elections.json is newest-first; sort oldest-first so consecutive pairs
  // run forward in time.
  const elections: ElectionInfo[] = (
    JSON.parse(fs.readFileSync(electionsFile, "utf-8")) as ElectionInfo[]
  ).sort((a, b) => a.name.localeCompare(b.name));

  const canonicalPath = path.join(publicFolder, "canonical_parties.json");
  if (!fs.existsSync(canonicalPath)) {
    console.warn(
      "[voteFlows] canonical_parties.json missing — run `--summary` first.",
    );
    return;
  }
  const canonical: CanonicalPartiesIndex = JSON.parse(
    fs.readFileSync(canonicalPath, "utf-8"),
  );

  const outDir = path.join(publicFolder, "transitions");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  // Purge any legacy combined-file outputs from the previous schema so
  // the directory only ever contains the new per-scope layout.
  for (const entry of fs.readdirSync(outDir)) {
    const full = path.join(outDir, entry);
    if (entry.endsWith(".json") && entry !== "index.json") {
      fs.unlinkSync(full);
    }
  }

  const indexPairs: VoteFlowIndex["pairs"] = [];

  for (let k = 0; k < elections.length - 1; k += 1) {
    const fromDate = elections[k].name;
    const toDate = elections[k + 1].name;
    // Skip pairs where either side hasn't been parsed yet.
    if (
      !fs.existsSync(path.join(publicFolder, fromDate, "cik_parties.json")) ||
      !fs.existsSync(path.join(publicFolder, toDate, "cik_parties.json"))
    ) {
      continue;
    }
    process.stdout.write(`[voteFlows] ${fromDate} → ${toDate} ...`);
    const reconcile = reconcileCycles({
      publicFolder,
      fromDate,
      toDate,
      canonical,
    });
    const estimates = Object.entries(reconcile.byOblast).map(
      ([oblast, payload]) =>
        estimateOblast({
          oblast,
          sections: payload.sections,
          fromTotals: payload.fromTotals,
          toTotals: payload.toTotals,
        }),
    );
    const scopeFiles = buildVoteFlowScopeFiles({
      fromDate,
      toDate,
      reconcile,
      estimates,
    });
    const pairDir = path.join(outDir, `${fromDate}_${toDate}`);
    if (!fs.existsSync(pairDir)) fs.mkdirSync(pairDir);
    for (const [scope, payload] of Object.entries(scopeFiles)) {
      fs.writeFileSync(path.join(pairDir, `${scope}.json`), stringify(payload));
    }
    indexPairs.push({ from: fromDate, to: toDate });
    const nationalDiag = scopeFiles.national.diagnostics;
    process.stdout.write(
      ` matched=${reconcile.diagnostics.sectionsMatched} dropped=${reconcile.diagnostics.sectionsDropped} resid=${nationalDiag?.rasResidual.toExponential(2)}\n`,
    );
    // Surface the worst three oblasts when the national residual is high —
    // that's almost always abroad (oblast 32) or one with a small section
    // count where NNLS struggled to fit a brand-new party.
    if ((nationalDiag?.rasResidual ?? 0) > 5e-3) {
      const ranked = estimates
        .slice()
        .sort((a, b) => b.rasResidual - a.rasResidual)
        .slice(0, 3);
      for (const e of ranked) {
        process.stdout.write(
          `  oblast=${e.oblast} resid=${e.rasResidual.toExponential(2)} iters=${e.rasIterations}\n`,
        );
      }
    }
  }
  // Newest pairs first in the index (matches the rest of the site's UX).
  indexPairs.reverse();
  const indexFile: VoteFlowIndex = {
    pairs: indexPairs,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(outDir, "index.json"), stringify(indexFile));
};
