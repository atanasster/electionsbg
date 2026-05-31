// Local-elections vote-flow ("Where did the council votes go") pipeline.
// Estimates a transition matrix between every consecutive pair of regular
// local-election cycles (2011 → 2015 → 2019 → 2023). Council ballot only —
// the mayoral race is majoritarian, not a party-proportional transition.
//
// Output mirrors the parliamentary layout but under a separate root so the
// two indexes never collide:
//
//   /data/transitions_local/<fromCycle>_<toCycle>/national.json
//   /data/transitions_local/<fromCycle>_<toCycle>/<oblast>.json   ("01"…"28")
//   /data/transitions_local/<fromCycle>_<toCycle>/persistence.json
//   /data/transitions_local/index.json                             (catalog)
//
// Reuses the parliamentary estimator (estimateOblast: NNLS + RAS) and
// serializer (buildVoteFlowScopeFiles) verbatim — only the reconcile step
// is local-specific (see reconcile_local.ts).
//
// Flag-gated operator step (not part of `--all`): `npm run data -- --local-flows`.
// Local cycles land every ~4 years, so there's nothing to gain from running
// this on every pipeline pass.

import fs from "fs";
import path from "path";
import { CanonicalPartiesIndex } from "@/data/parties/canonicalPartyTypes";
import {
  VoteFlowIndex,
  VoteFlowPersistenceSummary,
} from "@/data/voteFlows/voteFlowTypes";
import { reconcileLocalCycles } from "./reconcile_local";
import { estimateOblast } from "./estimate";
import { buildVoteFlowScopeFiles } from "./aggregate";

// Regular local cycle folders are `YYYY_MM_DD_mi`. Extraordinary cycles
// (`*_chmi*`) carry no section bundles and are excluded.
const REGULAR_MI_RE = /^\d{4}_\d{2}_\d{2}_mi$/;

/** Discover regular local cycles that actually have section shards on disk,
 * oldest-first, so consecutive pairs run forward in time. */
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

export const generateLocalVoteFlows = ({
  publicFolder,
  stringify,
}: {
  publicFolder: string;
  stringify: (o: object) => string;
}) => {
  const canonicalPath = path.join(publicFolder, "canonical_parties.json");
  if (!fs.existsSync(canonicalPath)) {
    console.warn(
      "[localFlows] canonical_parties.json missing — run `--summary` first.",
    );
    return;
  }
  const canonical: CanonicalPartiesIndex = JSON.parse(
    fs.readFileSync(canonicalPath, "utf-8"),
  );

  const cycles = discoverLocalCycles(publicFolder);
  if (cycles.length < 2) {
    console.warn(
      `[localFlows] need ≥2 local cycles with section data, found ${cycles.length}.`,
    );
    return;
  }

  const outDir = path.join(publicFolder, "transitions_local");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const indexPairs: VoteFlowIndex["pairs"] = [];

  for (let k = 0; k < cycles.length - 1; k += 1) {
    const fromCycle = cycles[k];
    const toCycle = cycles[k + 1];
    process.stdout.write(`[localFlows] ${fromCycle} → ${toCycle} ...`);

    const reconcile = reconcileLocalCycles({
      publicFolder,
      fromCycle,
      toCycle,
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
      fromDate: fromCycle,
      toDate: toCycle,
      reconcile,
      estimates,
    });

    const pairDir = path.join(outDir, `${fromCycle}_${toCycle}`);
    if (!fs.existsSync(pairDir)) {
      fs.mkdirSync(pairDir, { recursive: true });
    } else {
      // Purge stale scope files so a re-run with a different oblast set
      // (e.g. after re-keying) never leaves orphaned scopes behind.
      for (const f of fs.readdirSync(pairDir)) {
        if (f.endsWith(".json")) fs.unlinkSync(path.join(pairDir, f));
      }
    }
    for (const [scope, payload] of Object.entries(scopeFiles)) {
      fs.writeFileSync(path.join(pairDir, `${scope}.json`), stringify(payload));
    }
    if (scopeFiles.national.persistence) {
      const summary: VoteFlowPersistenceSummary = {
        from: fromCycle,
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

    indexPairs.push({ from: fromCycle, to: toCycle });
    const diag = scopeFiles.national.diagnostics;
    process.stdout.write(
      ` matched=${diag?.sectionsMatched} dropped=${diag?.sectionsDropped} resid=${diag?.rasResidual.toExponential(2)} stay=${(scopeFiles.national.persistence?.stayRate ?? 0).toFixed(3)}\n`,
    );
  }

  indexPairs.reverse(); // newest-first, matches the rest of the site's UX
  const indexFile: VoteFlowIndex = {
    pairs: indexPairs,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(outDir, "index.json"), stringify(indexFile));
};
