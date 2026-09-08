// Presidential vote-flow pipeline: for every presidential cycle, estimate the voter transition
// from the parliamentary vote AT OR BEFORE it into each round of the presidential ballot.
// „Where did a party's voters go when the same people chose a president."
//
//   /data/transitions_presidential/<parlDate>_<cycle>_tur<round>/national.json
//   /data/transitions_presidential/<parlDate>_<cycle>_tur<round>/<oblast>.json   (PDV, S23…)
//   /data/transitions_presidential/index.json                                    (catalog)
//
// Reuses the estimator (`estimateOblast`: NNLS + RAS) and the serializer
// (`buildVoteFlowScopeFiles`) verbatim — only the reconcile differs
// (`reconcile_parl_presidential.ts`). Plan: docs/plans/presidential-vote-flow-v1.md.
//
// ⚠⚠ „AT OR BEFORE", NOT „STRICTLY BEFORE", AND THAT IS THE 2021 CASE. Its presidential and
// parliamentary ballots were the SAME DAY, so a strict predicate — which is what
// `parl_local_index.ts` uses, correctly, because a local cycle never shares its day with a
// parliamentary one — would reach back to 2021_07_11 and compare a July electorate against a
// November one when the two ballots were literally in the same hands.
//
// ⚠⚠ A COVERAGE FLOOR, NOT A CAVEAT. The estimator regresses per section inside an oblast, so
// an unjoined section is a dropped row. Measured 2026-09-08 (cascade join, see the reconcile):
// 2021 100%, 2016 97.4%, 2011 87.3% — and 2005→2006 at 66.1%. The dropped third there is not
// random (whole municipalities were renumbered between those two ballots), so the regression
// would run on a biased subset and the tile would look exactly like the good ones. Any floor
// inside (66.1, 87.3] separates the measured cases; 80% sits near the middle of that gap, so a
// future cycle drifting a few points does not flip. `sectionsMatched`/`sectionsDropped` are
// published either way.
//
// ⚠ 2001 HAS NO „FROM" AT ALL — the June 2001 parliamentary election is not in the corpus — so
// it produces nothing, and that is an absence rather than a refusal.
//
// Flag-gated operator step (not part of `--all`): `npm run data -- --presidential-flows`.

import fs from "fs";
import path from "path";
import allElections from "@/data/json/elections.json";
import { CanonicalPartiesIndex } from "@/data/parties/canonicalPartyTypes";
import {
  VoteFlowIndex,
  VoteFlowPersistenceSummary,
} from "@/data/voteFlows/voteFlowTypes";
import { reconcileParliamentaryToPresidential } from "./reconcile_parl_presidential";
import { estimateOblast } from "./estimate";
import { buildVoteFlowScopeFiles } from "./aggregate";

/** See the header. Share of presidential sections that must find a parliamentary twin. */
export const MIN_SECTION_COVERAGE = 0.8;

const PVR_RE = /^\d{4}_\d{2}_\d{2}_pvr$/;

/** "2021_11_14_pvr" → "2021-11-14"; "2014_10_05" → "2014-10-05". */
const folderToIso = (name: string): string =>
  name.replace(/^(\d{4})_(\d{2})_(\d{2}).*/, "$1-$2-$3");

/** Presidential cycles with round-1 section shards on disk, oldest-first. */
export const discoverPresidentialCycles = (publicFolder: string): string[] =>
  fs
    .readdirSync(publicFolder)
    .filter((n) => PVR_RE.test(n))
    .filter((n) => {
      const dir = path.join(publicFolder, n, "tur1", "sections");
      return (
        fs.existsSync(dir) &&
        fs.readdirSync(dir).some((f) => f.endsWith(".json"))
      );
    })
    .sort((a, b) => a.localeCompare(b));

/**
 * The latest parliamentary election held AT OR BEFORE the cycle's round-1 date — see the
 * header for why the bound is inclusive.
 */
export const parliamentaryAtOrBefore = (
  publicFolder: string,
  cycle: string,
): string | undefined =>
  allElections
    .map((e) => e.name)
    .filter((name) => folderToIso(name) <= folderToIso(cycle))
    .filter((name) =>
      fs.existsSync(path.join(publicFolder, name, "sections", "by-oblast")),
    )
    .sort((a, b) => folderToIso(b).localeCompare(folderToIso(a)))[0];

/** Rounds a cycle actually published. */
const roundsOf = (publicFolder: string, cycle: string): (1 | 2)[] =>
  ([1, 2] as const).filter((r) =>
    fs.existsSync(path.join(publicFolder, cycle, `tur${r}`, "sections")),
  );

export const generatePresidentialFlows = ({
  publicFolder,
  stringify,
}: {
  publicFolder: string;
  stringify: (o: object) => string;
}): void => {
  const canonicalPath = path.join(publicFolder, "canonical_parties.json");
  if (!fs.existsSync(canonicalPath)) {
    console.warn(
      "[presidentialFlows] canonical_parties.json missing — run `--summary` first.",
    );
    return;
  }
  const canonical: CanonicalPartiesIndex = JSON.parse(
    fs.readFileSync(canonicalPath, "utf-8"),
  );

  const cycles = discoverPresidentialCycles(publicFolder);
  if (!cycles.length) {
    console.warn(
      "[presidentialFlows] no presidential cycles with section data.",
    );
    return;
  }

  const outDir = path.join(publicFolder, "transitions_presidential");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const indexPairs: VoteFlowIndex["pairs"] = [];

  for (const cycle of cycles) {
    const fromDate = parliamentaryAtOrBefore(publicFolder, cycle);
    if (!fromDate) {
      console.warn(
        `[presidentialFlows] ${cycle}: no parliamentary vote at or before it — skipped.`,
      );
      continue;
    }
    for (const round of roundsOf(publicFolder, cycle)) {
      const to = `${cycle}_tur${round}`;
      process.stdout.write(`[presidentialFlows] ${fromDate} → ${to} ...`);
      const reconcile = reconcileParliamentaryToPresidential({
        publicFolder,
        fromDate,
        cycle,
        round,
        canonical,
      });
      const { sectionsMatched, sectionsDropped } = reconcile.diagnostics;
      const seen = sectionsMatched + sectionsDropped;
      const coverage = seen ? sectionsMatched / seen : 0;
      // ⚠⚠ THE FLOOR, AND IT REFUSES RATHER THAN CAVEATS — see the header.
      if (coverage < MIN_SECTION_COVERAGE) {
        process.stdout.write(
          ` REFUSED — only ${(100 * coverage).toFixed(1)}% of sections joined ` +
            `(${sectionsMatched}/${seen}), below the ${(100 * MIN_SECTION_COVERAGE).toFixed(0)}% ` +
            `floor; the dropped sections are whole renumbered municipalities, so the estimate ` +
            `would run on a biased subset\n`,
        );
        continue;
      }

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
        toDate: to,
        reconcile,
        estimates,
      });

      const pairDir = path.join(outDir, `${fromDate}_${to}`);
      if (!fs.existsSync(pairDir)) fs.mkdirSync(pairDir, { recursive: true });
      else
        for (const f of fs.readdirSync(pairDir))
          if (f.endsWith(".json")) fs.unlinkSync(path.join(pairDir, f));
      for (const [scope, payload] of Object.entries(scopeFiles))
        fs.writeFileSync(
          path.join(pairDir, `${scope}.json`),
          stringify(payload),
        );
      if (scopeFiles.national.persistence) {
        const summary: VoteFlowPersistenceSummary = {
          from: fromDate,
          to,
          national: scopeFiles.national.persistence,
          byOblast: Object.entries(scopeFiles)
            .filter(([scope, f]) => scope !== "national" && f.persistence)
            .map(([scope, f]) => ({
              oblast: scope,
              persistence: f.persistence!,
            })),
        };
        fs.writeFileSync(
          path.join(pairDir, "persistence.json"),
          stringify(summary),
        );
      }

      indexPairs.push({ from: fromDate, to });
      const diag = scopeFiles.national.diagnostics;
      process.stdout.write(
        ` matched=${diag?.sectionsMatched} dropped=${diag?.sectionsDropped}` +
          ` (${(100 * coverage).toFixed(1)}%) resid=${diag?.rasResidual.toExponential(2)}\n`,
      );
    }
  }

  indexPairs.reverse(); // newest-first
  fs.writeFileSync(
    path.join(outDir, "index.json"),
    stringify({
      pairs: indexPairs,
      generatedAt: new Date().toISOString(),
    } satisfies VoteFlowIndex),
  );
  console.log(
    `[presidentialFlows] wrote ${indexPairs.length} cycle-round pairs → ` +
      `${path.relative(publicFolder, outDir)}/`,
  );
};
