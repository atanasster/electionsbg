// Pre-vote flow pipeline: for every regular local cycle, estimate the voter
// transition from the most recent PARLIAMENTARY vote before it into that
// cycle's council ballot. "Where did the national-election voters go when the
// same people voted for a municipal council a few months later."
//
// Output mirrors the same-type flow layout under a separate root:
//
//   /data/transitions_prevote/<parlDate>_<toCycle>/national.json
//   /data/transitions_prevote/<parlDate>_<toCycle>/<oblast>.json   (BGS, SOF…)
//   /data/transitions_prevote/<parlDate>_<toCycle>/persistence.json
//   /data/transitions_prevote/index.json                            (catalog)
//
// Reuses the estimator (estimateOblast: NNLS + RAS) and serializer
// (buildVoteFlowScopeFiles) verbatim — only the cross-type reconcile differs
// (reconcile_parl_local.ts). National + oblast scope only (per-município has
// too few sections for stable inference — same product decision as the
// council-to-council local flow).
//
// Flag-gated operator step (not part of `--all`): `npm run data -- --prevote-flows`.

import fs from "fs";
import path from "path";
import allElections from "@/data/json/elections.json";
import { CanonicalPartiesIndex } from "@/data/parties/canonicalPartyTypes";
import {
  VoteFlowIndex,
  VoteFlowPersistenceSummary,
} from "@/data/voteFlows/voteFlowTypes";
import { reconcileParliamentaryToLocal } from "./reconcile_parl_local";
import { estimateOblast } from "./estimate";
import { buildVoteFlowScopeFiles } from "./aggregate";

const REGULAR_MI_RE = /^\d{4}_\d{2}_\d{2}_mi$/;

/** Regular local cycles that actually have section shards on disk, oldest-first. */
const discoverLocalCycles = (publicFolder: string): string[] =>
  fs
    .readdirSync(publicFolder)
    .filter((name) => REGULAR_MI_RE.test(name))
    .filter((name) => {
      const dir = path.join(publicFolder, name, "sections");
      return (
        fs.existsSync(dir) &&
        fs.readdirSync(dir).some((f) => f.endsWith(".json"))
      );
    })
    .sort((a, b) => a.localeCompare(b));

/** "2023_10_29_mi" or "2023_04_02" → "2023-04-02". */
const folderToIso = (name: string): string =>
  name.replace(/^(\d{4})_(\d{2})_(\d{2}).*/, "$1-$2-$3");

const cycleRound1Iso = (publicFolder: string, cycle: string): string => {
  try {
    const idx = JSON.parse(
      fs.readFileSync(path.join(publicFolder, cycle, "index.json"), "utf-8"),
    );
    if (typeof idx.round1Date === "string") return idx.round1Date;
  } catch {
    /* fall through */
  }
  return folderToIso(cycle);
};

/** Most recent parliamentary election strictly before the given ISO date, or
 *  undefined when none precedes it (the earliest cycles). */
const parliamentaryBefore = (
  publicFolder: string,
  beforeIso: string,
): string | undefined =>
  allElections
    .map((e) => e.name)
    .filter((name) => folderToIso(name) < beforeIso)
    // Must ship per-oblast section data to estimate a flow.
    .filter((name) =>
      fs.existsSync(path.join(publicFolder, name, "sections", "by-oblast")),
    )
    .sort((a, b) => folderToIso(b).localeCompare(folderToIso(a)))[0];

export const generatePrevoteFlows = ({
  publicFolder,
  stringify,
}: {
  publicFolder: string;
  stringify: (o: object) => string;
}): void => {
  const canonicalPath = path.join(publicFolder, "canonical_parties.json");
  if (!fs.existsSync(canonicalPath)) {
    console.warn(
      "[prevoteFlows] canonical_parties.json missing — run `--summary` first.",
    );
    return;
  }
  const canonical: CanonicalPartiesIndex = JSON.parse(
    fs.readFileSync(canonicalPath, "utf-8"),
  );

  const cycles = discoverLocalCycles(publicFolder);
  if (cycles.length === 0) {
    console.warn("[prevoteFlows] no regular local cycles with section data.");
    return;
  }

  const outDir = path.join(publicFolder, "transitions_prevote");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const indexPairs: VoteFlowIndex["pairs"] = [];

  for (const toCycle of cycles) {
    const beforeIso = cycleRound1Iso(publicFolder, toCycle);
    const fromDate = parliamentaryBefore(publicFolder, beforeIso);
    if (!fromDate) {
      console.warn(`[prevoteFlows] no parliamentary vote before ${toCycle}.`);
      continue;
    }
    process.stdout.write(`[prevoteFlows] ${fromDate} → ${toCycle} ...`);

    const reconcile = reconcileParliamentaryToLocal({
      publicFolder,
      fromDate,
      toCycle,
      canonical,
    });
    const estimates = Object.entries(reconcile.byOblast).map(([oblast, p]) =>
      estimateOblast({
        oblast,
        sections: p.sections,
        fromTotals: p.fromTotals,
        toTotals: p.toTotals,
      }),
    );
    const scopeFiles = buildVoteFlowScopeFiles({
      fromDate,
      toDate: toCycle,
      reconcile,
      estimates,
    });

    const pairDir = path.join(outDir, `${fromDate}_${toCycle}`);
    if (!fs.existsSync(pairDir)) {
      fs.mkdirSync(pairDir, { recursive: true });
    } else {
      for (const f of fs.readdirSync(pairDir))
        if (f.endsWith(".json")) fs.unlinkSync(path.join(pairDir, f));
    }
    for (const [scope, payload] of Object.entries(scopeFiles))
      fs.writeFileSync(path.join(pairDir, `${scope}.json`), stringify(payload));
    if (scopeFiles.national.persistence) {
      const summary: VoteFlowPersistenceSummary = {
        from: fromDate,
        to: toCycle,
        national: scopeFiles.national.persistence,
        byOblast: Object.entries(scopeFiles)
          .filter(([scope, file]) => scope !== "national" && file.persistence)
          .map(([scope, file]) => ({
            oblast: scope,
            persistence: file.persistence!,
          })),
      };
      fs.writeFileSync(
        path.join(pairDir, "persistence.json"),
        stringify(summary),
      );
    }

    indexPairs.push({ from: fromDate, to: toCycle });
    const diag = scopeFiles.national.diagnostics;
    process.stdout.write(
      ` matched=${diag?.sectionsMatched} dropped=${diag?.sectionsDropped} resid=${diag?.rasResidual.toExponential(2)} stay=${(scopeFiles.national.persistence?.stayRate ?? 0).toFixed(3)}\n`,
    );
  }

  indexPairs.reverse(); // newest-first
  const indexFile: VoteFlowIndex = {
    pairs: indexPairs,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(outDir, "index.json"), stringify(indexFile));
  console.log(
    `[prevoteFlows] wrote ${indexPairs.length} cycle pairs → ${path.relative(publicFolder, outDir)}/`,
  );
};
