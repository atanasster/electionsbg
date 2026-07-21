import fs from "fs";
import path from "path";

// Precompute for the "machine-only voting" what-if article.
// (/articles/2026-07-21-machine-only-sections)
//
// THE COUNTERFACTUAL
//   In every parliamentary election since 2021 each polling section recorded
//   machine votes and paper votes side by side — the same electorate, same day,
//   split by voting medium. That split is the natural experiment: within one
//   section, machine-voters and paper-voters chose parties in different
//   proportions. We ask: what if paper ballots were removed in every "large"
//   section (> N registered voters), forcing those voters onto the machine?
//
// THE MODEL (per affected section, per party p)
//   machineShare_p = machineVotes_p / Σ machineVotes           (that section's machine preference)
//   votes_p(d)     = machineVotes_p + (1 - d) · paperTotal · machineShare_p
//   where d = the "paper-voter drop-off" — the share of paper-voters who abstain
//   rather than switch to a machine (turnout realism knob; d = 0 keeps turnout).
//
// WHAT WE EMIT (so the browser can recompute votes -> seats LIVE for any d)
//   Per election × per section-size threshold, national per-party:
//     base_p         = Σ_unaffected totalVotes_p + Σ_affected machineVotes_p   (never changes with d)
//     reassignable_p = Σ_affected paperTotal · machineShare_p                  (scaled by 1 - d)
//     actualPaper_p  = Σ_affected paperVotes_p                                 (for the true baseline)
//   Identity: actual_p = base_p + actualPaper_p ; model_p(d) = base_p + (1-d)·reassignable_p.
//
// A section is "affected" only if reg > threshold AND it has machine votes
// (Σ machineVotes > 0). Large sections with a broken/absent machine are folded
// into base_p as-is (we cannot infer machine behaviour there).
//
// Output is imported directly by the article screen (bundled into its lazy
// chunk) — it is NOT written into the GCS-served data/ tree.

const ROOT = process.cwd(); // scripts are always run from the repo root
const THRESHOLDS = [100, 200, 300, 500] as const;
const ELECTIONS = [
  "2021_04_04",
  "2023_04_02",
  "2024_06_09",
  "2024_10_27",
  "2026_04_19",
] as const;
const OUT = path.join(
  ROOT,
  "src",
  "screens",
  "scenarios",
  "machineOnlyScenario.data.json",
);

type Votes = {
  partyNum: number;
  totalVotes?: number;
  paperVotes?: number;
  machineVotes?: number;
};
type SectionProtocol = {
  numRegisteredVoters?: number;
  numInvalidBallotsFound?: number; // spoiled PAPER ballots (machines can't spoil)
};
type SectionInfo = {
  oblast?: string; // 3-letter МИР code (BLG, S23, PDV-00 …) = geojson `nuts3` key
  region_name?: string; // "16. ПЛОВДИВ град"
  results?: { protocol?: SectionProtocol; votes?: Votes[] };
};
type CikParty = {
  number: number;
  name: string;
  color?: string;
  nickName?: string;
};

const round = (n: number) => Math.round(n);

const loadParties = (date: string): Map<number, CikParty> => {
  const arr: CikParty[] = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", date, "cik_parties.json"), "utf8"),
  );
  return new Map(arr.map((p) => [p.number, p]));
};

const loadNationalSummary = (date: string) => {
  const p = path.join(ROOT, "data", date, "national_summary.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
};

type PartyAgg = {
  base: number;
  reassignable: number;
  actualPaper: number;
  // Recovered spoiled paper ballots, distributed by the section's paper-vote
  // shares — machines can't spoil, so under machine-only these become valid
  // votes for the (paper-preferring) demographic that mis-marked them
  // (Fujiwara 2015 enfranchisement). Scaled by (1 − d) with the paper switchers.
  invalidRecoverable: number;
};

type RegionAgg = { name: string; agg: Map<number, PartyAgg> };

const emptyAgg = (): PartyAgg => ({
  base: 0,
  reassignable: 0,
  actualPaper: 0,
  invalidRecoverable: 0,
});
const bumpAgg = (
  m: Map<number, PartyAgg>,
  pn: number,
  k: keyof PartyAgg,
  v: number,
) => {
  let a = m.get(pn);
  if (!a) {
    a = emptyAgg();
    m.set(pn, a);
  }
  a[k] += v;
};

const buildThreshold = (
  bundles: Record<string, SectionInfo>[],
  threshold: number,
) => {
  const agg = new Map<number, PartyAgg>();
  // Per-region (per-МИР) copy of the same aggregation, keyed by the 3-letter
  // oblast code, so the map can recompute each region's model independently.
  const regions = new Map<string, RegionAgg>();

  let affectedSections = 0;
  let affectedRegistered = 0;
  let affectedPaperVoters = 0; // Σ paperVotes in affected sections (the abstention pool)
  let affectedMachineVoters = 0; // Σ machineVotes in affected sections (already-machine adoption)

  for (const bundle of bundles) {
    for (const sid of Object.keys(bundle)) {
      const info = bundle[sid];
      const res = info.results;
      if (!res || !Array.isArray(res.votes)) continue;
      const reg = res.protocol?.numRegisteredVoters ?? 0;

      // region bucket (skip the "32" abroad pseudo-region — it has no polygon)
      const oblast = info.oblast;
      let regionAgg: Map<number, PartyAgg> | undefined;
      if (oblast && oblast !== "32") {
        let r = regions.get(oblast);
        if (!r) {
          r = { name: info.region_name ?? oblast, agg: new Map() };
          regions.set(oblast, r);
        }
        regionAgg = r.agg;
      }

      let machineSum = 0;
      let paperSum = 0;
      for (const v of res.votes) {
        machineSum += v.machineVotes ?? 0;
        paperSum += v.paperVotes ?? 0;
      }

      const affected = reg > threshold && machineSum > 0;

      if (!affected) {
        // unchanged: whole section contributes to base
        for (const v of res.votes) {
          const total =
            v.totalVotes ?? (v.paperVotes ?? 0) + (v.machineVotes ?? 0);
          bumpAgg(agg, v.partyNum, "base", total);
          if (regionAgg) bumpAgg(regionAgg, v.partyNum, "base", total);
        }
        continue;
      }

      affectedSections++;
      affectedRegistered += reg;
      affectedPaperVoters += paperSum;
      affectedMachineVoters += machineSum;
      const invalid = res.protocol?.numInvalidBallotsFound ?? 0;
      for (const v of res.votes) {
        const mv = v.machineVotes ?? 0;
        const pv = v.paperVotes ?? 0;
        const share = mv / machineSum;
        // spoiled ballots recovered by the section's paper-vote shares
        const invRec = paperSum > 0 ? (pv / paperSum) * invalid : 0;
        bumpAgg(agg, v.partyNum, "base", mv);
        bumpAgg(agg, v.partyNum, "reassignable", share * paperSum);
        bumpAgg(agg, v.partyNum, "actualPaper", pv);
        bumpAgg(agg, v.partyNum, "invalidRecoverable", invRec);
        if (regionAgg) {
          bumpAgg(regionAgg, v.partyNum, "base", mv);
          bumpAgg(regionAgg, v.partyNum, "reassignable", share * paperSum);
          bumpAgg(regionAgg, v.partyNum, "actualPaper", pv);
          bumpAgg(regionAgg, v.partyNum, "invalidRecoverable", invRec);
        }
      }
    }
  }
  return {
    agg,
    regions,
    affectedSections,
    affectedRegistered,
    affectedPaperVoters,
    affectedMachineVoters,
  };
};

const run = () => {
  const elections = ELECTIONS.map((date) => {
    const dir = path.join(ROOT, "data", date, "sections", "by-oblast");
    const bundles = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map(
        (f) =>
          JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Record<
            string,
            SectionInfo
          >,
      );

    const parties = loadParties(date);
    const ns = loadNationalSummary(date);
    const officialSeats: Record<number, number> = {};
    for (const p of ns.parties ?? []) {
      if (p.seats) officialSeats[p.partyNum] = p.seats;
    }

    // Collect the union of party numbers that appear anywhere, stable order by
    // total actual votes (from the base+paper identity at the widest threshold).
    const partyMeta = new Map<
      number,
      { partyNum: number; nickName: string; name: string; color: string }
    >();

    const byThreshold: Record<string, unknown> = {};
    const rank = new Map<number, number>(); // partyNum -> actual national votes

    // Per-region data is only emitted for the latest election (the only one
    // the UI shows) to keep the embedded file small.
    const withRegions = date === ELECTIONS[ELECTIONS.length - 1];

    for (const threshold of THRESHOLDS) {
      const {
        agg,
        regions,
        affectedSections,
        affectedRegistered,
        affectedPaperVoters,
        affectedMachineVoters,
      } = buildThreshold(bundles, threshold);

      for (const [pn, a] of agg) {
        if (!partyMeta.has(pn)) {
          const cp = parties.get(pn);
          partyMeta.set(pn, {
            partyNum: pn,
            nickName: cp?.nickName ?? cp?.name ?? String(pn),
            name: cp?.name ?? String(pn),
            color: cp?.color ?? "#888888",
          });
        }
        rank.set(pn, a.base + a.actualPaper);
      }

      byThreshold[String(threshold)] = {
        affectedSections,
        affectedRegistered,
        affectedPaperVoters: round(affectedPaperVoters),
        affectedMachineVoters: round(affectedMachineVoters),
        rows: [...agg.entries()].map(([partyNum, a]) => ({
          partyNum,
          base: round(a.base),
          reassignable: round(a.reassignable),
          actualPaper: round(a.actualPaper),
          invalidRecoverable: round(a.invalidRecoverable),
        })),
        ...(withRegions
          ? {
              regions: Object.fromEntries(
                [...regions.entries()].map(([code, r]) => {
                  const regTotal = [...r.agg.values()].reduce(
                    (s, a) => s + a.base + a.actualPaper,
                    0,
                  );
                  // Keep only parties reaching ≥1% of the region's actual
                  // votes — enough for winner + gain/loss, far smaller file.
                  const rows = [...r.agg.entries()]
                    .filter(
                      ([, a]) => a.base + a.actualPaper >= 0.01 * regTotal,
                    )
                    .map(([partyNum, a]) => ({
                      partyNum,
                      base: round(a.base),
                      reassignable: round(a.reassignable),
                      actualPaper: round(a.actualPaper),
                      invalidRecoverable: round(a.invalidRecoverable),
                    }));
                  return [code, { name: r.name, rows }];
                }),
              ),
            }
          : {}),
      };
    }

    const partiesSorted = [...partyMeta.values()].sort(
      (x, y) => (rank.get(y.partyNum) ?? 0) - (rank.get(x.partyNum) ?? 0),
    );

    return {
      date,
      registered: ns.turnout?.registered ?? 0,
      actualVoters: ns.turnout?.actual ?? 0,
      officialSeats,
      parties: partiesSorted,
      byThreshold,
    };
  });

  const payload = {
    thresholds: THRESHOLDS,
    totalSeats: 240,
    partyThresholdPct: 4,
    elections,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload));
  const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
  console.log(`wrote ${OUT} (${kb} KB) — ${elections.length} elections`);
  for (const e of elections) {
    const t200 = e.byThreshold["200"] as { affectedSections: number };
    console.log(
      `  ${e.date}: ${e.parties.length} parties, ${t200.affectedSections} affected sections @>200`,
    );
  }
};

run();
