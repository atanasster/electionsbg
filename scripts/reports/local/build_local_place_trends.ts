// Per-place cross-cycle local-election trends (council party share + mayoral
// winner across regular cycles), for the settlement and район dashboards.
//
// The município level already has this (LocalCouncilTrendsTile reads each
// cycle's bundle.council). What it CANNOT show is how a single settlement or a
// single район voted, because the bundle's council is município-grain (and for
// a Sofia район it's the *city-wide* council, identical across all 24 райони).
// So we aggregate the per-section ballots — which carry an EKATTE and a 9-digit
// section code — back up to each place.
//
// Output: one file per container obshtina, data/local_place_trends/<code>.json
// (PlaceTrendsFile). It's deliberately raw (bucket ids + a fallback name, no
// display strings/colours) so the frontend resolves names/colours through
// useCanonicalParties and stays language-aware — mirroring
// useLocalMunicipalityCrossCycle.
//
// Three place kinds, all aggregated the same way (council via the section's own
// legend; the majoritarian mayor winner via the relevant bundle's candidate
// list, since the mayoral ballot has its own numbering):
//   - settlements (EKATTE)          → council + КО (община/град mayor) winner
//   - Sofia райони (S2xxx, own muni) → council + КО (city mayor) winner; the
//                                      районен-кмет history is the existing
//                                      mayor timeline, so it's not duplicated
//   - Plovdiv/Varna райони (PDV22/VAR06, derived) → council + КО + КР (районен
//                                      кмет) winners
//
// Sofia райони are only covered for cycles that ship a per-район light shard
// (2015→), so they get a 3-cycle trend; 2011 has only the pooled SOF shard.
//
// Flag-gated operator step (not part of `--all`): `npm run data -- --local-place-trends`.

import fs from "fs";
import path from "path";
import { bucketId, yearOf } from "@/data/local/crossCycleShape";
import { findCityRayonByName } from "@/data/local/cityRayonCatalog";
import type {
  PlaceCouncilSeries,
  PlaceMayorWinner,
  PlaceTrend,
  PlaceTrendFile,
} from "@/data/local/placeTrendsTypes";
import { normEkatte } from "@/data/local/placeTrendsTypes";
import type {
  LocalMayorResult,
  LocalMunicipalityBundle,
  LocalSectionDetail,
  LocalSectionResult,
  LocalSectionShard,
} from "../../parsers_local/types";

const REGULAR_MI_RE = /^\d{4}_\d{2}_\d{2}_mi$/;
const SOFIA_RAYON_RE = /^S2\d{3}$/;
const CITY_RAYON_CONTAINERS = new Set(["PDV22", "VAR06"]);
// Pre-trim the long tail of single-section slates; the chart shows ≤6 lines,
// so 8 leaves the hook headroom to re-rank by latest share.
const TOP_COUNCIL_BUCKETS = 8;

/** Round a percentage to 2 d.p. — keeps the artifact small without visibly
 *  changing a chart that renders at 1 d.p. */
const round2 = (x: number): number => Math.round(x * 100) / 100;

// --- per-cycle aggregation primitives -------------------------------------

type CouncilAgg = {
  buckets: Map<
    string,
    { canonicalId: string | null; localPartyName: string; votes: number }
  >;
  valid: number;
};
type MayorAgg = { byNum: Map<number, number>; valid: number };

const newCouncil = (): CouncilAgg => ({ buckets: new Map(), valid: 0 });
const newMayor = (): MayorAgg => ({ byNum: new Map(), valid: 0 });

const addCouncil = (
  agg: CouncilAgg,
  section: LocalSectionResult,
  legend: Map<number, { canonicalId: string | null; name: string }>,
): void => {
  for (const pv of section.partyVotes) {
    const meta = legend.get(pv.localPartyNum);
    const canonicalId = meta?.canonicalId ?? null;
    const name = meta?.name ?? `#${pv.localPartyNum}`;
    const id = bucketId(canonicalId, name);
    let b = agg.buckets.get(id);
    if (!b) {
      b = { canonicalId, localPartyName: name, votes: 0 };
      agg.buckets.set(id, b);
    }
    b.votes += pv.votes;
  }
  agg.valid += section.numValidVotes || 0;
};

const addMayor = (
  agg: MayorAgg,
  votes: { localPartyNum: number; votes: number }[] | undefined,
  validHint: number | undefined,
): void => {
  if (!votes || votes.length === 0) return;
  let sum = 0;
  for (const v of votes) {
    agg.byNum.set(
      v.localPartyNum,
      (agg.byNum.get(v.localPartyNum) ?? 0) + v.votes,
    );
    sum += v.votes;
  }
  agg.valid += validHint && validHint > 0 ? validHint : sum;
};

// Resolve the leading mayoral ballot number to a candidate via the relevant
// bundle's candidate list (the mayoral ballot has its own numbering, distinct
// from the council legend).
const resolveMayorWinner = (
  agg: MayorAgg,
  candidates: LocalMayorResult[],
  cycle: string,
  year: string,
): PlaceMayorWinner | null => {
  if (agg.byNum.size === 0 || agg.valid <= 0) return null;
  let bestNum = -1;
  let bestVotes = -1;
  for (const [num, v] of agg.byNum)
    if (v > bestVotes) {
      bestVotes = v;
      bestNum = num;
    }
  if (bestNum < 0) return null;
  const cand = candidates.find((c) => c.localPartyNum === bestNum);
  const canonicalId = cand?.primaryCanonicalId ?? null;
  const localPartyName = cand?.localPartyName ?? `#${bestNum}`;
  return {
    cycle,
    year,
    bucketId: bucketId(canonicalId, localPartyName),
    canonicalId,
    localPartyName,
    candidateName: cand?.candidateName ?? "",
    pct: round2((bestVotes / agg.valid) * 100),
    votes: bestVotes,
  };
};

// --- cross-cycle accumulators ---------------------------------------------

type PlaceAcc = {
  council: Map<string, CouncilAgg>; // cycle → council aggregate
  mayor: PlaceMayorWinner[]; // КО winners, chronological
  rayonMayor: PlaceMayorWinner[]; // КР winners (райони only)
};
const newPlaceAcc = (): PlaceAcc => ({
  council: new Map(),
  mayor: [],
  rayonMayor: [],
});

type ContainerAcc = {
  place: PlaceAcc; // the container's own sections (used for Sofia райони)
  settlements: Map<string, PlaceAcc>; // EKATTE → trend
  rayons: Map<string, PlaceAcc>; // "PDV22-01" → trend
};
const newContainerAcc = (): ContainerAcc => ({
  place: newPlaceAcc(),
  settlements: new Map(),
  rayons: new Map(),
});

const buildCouncilSeries = (
  perCycle: Map<string, CouncilAgg>,
): { series: PlaceCouncilSeries[]; usableCycles: number } => {
  const byId = new Map<string, PlaceCouncilSeries>();
  let usableCycles = 0;
  for (const [cycle, agg] of perCycle) {
    if (agg.valid <= 0 || agg.buckets.size === 0) continue;
    usableCycles += 1;
    for (const [id, b] of agg.buckets) {
      let s = byId.get(id);
      if (!s) {
        s = {
          bucketId: id,
          canonicalId: b.canonicalId,
          localPartyName: b.localPartyName,
          pctByCycle: {},
        };
        byId.set(id, s);
      }
      s.pctByCycle[cycle] = round2(
        (s.pctByCycle[cycle] ?? 0) + (b.votes / agg.valid) * 100,
      );
    }
  }
  const arr = [...byId.values()];
  const peak = (s: PlaceCouncilSeries): number =>
    Math.max(0, ...Object.values(s.pctByCycle));
  arr.sort((a, b) => peak(b) - peak(a));
  return { series: arr.slice(0, TOP_COUNCIL_BUCKETS), usableCycles };
};

// A place is worth emitting only if it carries a real multi-cycle trend.
const finalizePlace = (acc: PlaceAcc): PlaceTrend | null => {
  const { series, usableCycles } = buildCouncilSeries(acc.council);
  const hasCouncil = usableCycles >= 2 && series.length > 0;
  const hasMayor = acc.mayor.length >= 2;
  if (!hasCouncil && !hasMayor) return null;
  const trend: PlaceTrend = {
    council: hasCouncil ? series : [],
    mayor: acc.mayor,
  };
  if (acc.rayonMayor.length >= 2) trend.rayonMayor = acc.rayonMayor;
  return trend;
};

// --- driver ----------------------------------------------------------------

const discoverCycles = (publicFolder: string): string[] =>
  fs
    .readdirSync(publicFolder)
    .filter((n) => REGULAR_MI_RE.test(n))
    .filter((n) => {
      const dir = path.join(publicFolder, n, "sections");
      return (
        fs.existsSync(dir) &&
        fs.readdirSync(dir).some((f) => f.endsWith(".json"))
      );
    })
    .sort((a, b) => a.localeCompare(b));

const cycleYear = (publicFolder: string, cycle: string): string => {
  try {
    const idx = JSON.parse(
      fs.readFileSync(path.join(publicFolder, cycle, "index.json"), "utf-8"),
    );
    if (typeof idx.round1Date === "string") return yearOf(idx.round1Date);
  } catch {
    /* fall through */
  }
  return cycle.slice(0, 4);
};

export const generateLocalPlaceTrends = ({
  publicFolder,
  stringify,
}: {
  publicFolder: string;
  stringify: (o: object) => string;
}): void => {
  const cycles = discoverCycles(publicFolder);
  if (cycles.length < 2) {
    console.warn(
      `[placeTrends] need ≥2 local cycles with section data, found ${cycles.length}.`,
    );
    return;
  }

  // container obshtinaCode → cross-cycle accumulator
  const containers = new Map<string, ContainerAcc>();
  const cyclesAsc: { cycle: string; year: string }[] = [];

  for (const cycle of cycles) {
    const year = cycleYear(publicFolder, cycle);
    cyclesAsc.push({ cycle, year });
    const sectionsDir = path.join(publicFolder, cycle, "sections");
    const muniDir = path.join(publicFolder, cycle, "municipalities");

    // Lazily-cached bundles (for mayoral candidate lists) per cycle.
    const bundleCache = new Map<string, LocalMunicipalityBundle | null>();
    const bundle = (code: string): LocalMunicipalityBundle | null => {
      if (bundleCache.has(code)) return bundleCache.get(code) ?? null;
      const p = path.join(muniDir, `${code}.json`);
      const b = fs.existsSync(p)
        ? (JSON.parse(fs.readFileSync(p, "utf-8")) as LocalMunicipalityBundle)
        : null;
      bundleCache.set(code, b);
      return b;
    };

    // Each top-level *.json under sections/ is one container's light shard
    // (per-obshtina, plus the Sofia per-район S2xxx shards). Skip the pooled
    // SOF shard — Sofia is covered through its per-район shards.
    const shardFiles = fs
      .readdirSync(sectionsDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .map((e) => e.name.slice(0, -5));

    let processed = 0;
    for (const code of shardFiles) {
      if (code === "SOF") continue;
      const shard: LocalSectionShard = JSON.parse(
        fs.readFileSync(path.join(sectionsDir, `${code}.json`), "utf-8"),
      );
      const isSofiaRayon = SOFIA_RAYON_RE.test(code);
      const isCityRayonContainer = CITY_RAYON_CONTAINERS.has(code);
      // КО (община/град mayor) candidate list: Sofia райони vote for the CITY
      // mayor (SOF bundle); everyone else for their own município's mayor.
      const cityCode = isSofiaRayon ? "SOF" : code;
      const koCandidates = bundle(cityCode)?.mayor.round1 ?? [];
      // КР (районен кмет) candidate lists, keyed by район id — only the two
      // derived-район cities carry a districts[] block.
      const krCandidates = new Map<string, LocalMayorResult[]>();
      if (isCityRayonContainer) {
        for (const d of bundle(code)?.districts ?? []) {
          const r = findCityRayonByName(code, d.districtName);
          if (r) krCandidates.set(r.id, d.candidates);
        }
      }
      // Detail files live under the detail dir (Sofia райони pool under SOF/).
      const detailDir = path.join(sectionsDir, isSofiaRayon ? "SOF" : code);

      const acc = containers.get(code) ?? newContainerAcc();
      containers.set(code, acc);

      // Per-cycle aggregates for this container's place + its settlements/райони.
      const placeCouncil = newCouncil();
      const placeMayor = newMayor();
      const settCouncil = new Map<string, CouncilAgg>(); // ekatte → council
      const settMayor = new Map<string, MayorAgg>();
      const rayCouncil = new Map<string, CouncilAgg>(); // rayonId → council
      const rayKo = new Map<string, MayorAgg>();
      const rayKr = new Map<string, MayorAgg>();

      for (const lite of shard.sections) {
        const dp = path.join(detailDir, `${lite.sectionCode}.json`);
        if (!fs.existsSync(dp)) continue;
        const detail: LocalSectionDetail = JSON.parse(
          fs.readFileSync(dp, "utf-8"),
        );
        const sec = detail.section;
        const legend = new Map<
          number,
          { canonicalId: string | null; name: string }
        >();
        for (const p of detail.parties)
          legend.set(p.localPartyNum, {
            canonicalId: p.primaryCanonicalId,
            name: p.localPartyName,
          });

        // Container place
        addCouncil(placeCouncil, sec, legend);
        addMayor(placeMayor, sec.mayorVotes, sec.mayorValid);

        // Settlement (EKATTE) — canonicalise (strip leading zeros) so a place
        // groups across cycles and the shard key matches what readers pass.
        const ek = sec.ekatte ? normEkatte(sec.ekatte) : "";
        if (ek) {
          let sc = settCouncil.get(ek);
          if (!sc) {
            sc = newCouncil();
            settCouncil.set(ek, sc);
          }
          addCouncil(sc, sec, legend);
          let sm = settMayor.get(ek);
          if (!sm) {
            sm = newMayor();
            settMayor.set(ek, sm);
          }
          addMayor(sm, sec.mayorVotes, sec.mayorValid);
        }

        // Derived район (Plovdiv/Varna) — район id from section-code digits 5-6.
        if (isCityRayonContainer) {
          const rcode = sec.sectionCode.slice(4, 6);
          const rayonId = `${code}-${rcode}`;
          let rc = rayCouncil.get(rayonId);
          if (!rc) {
            rc = newCouncil();
            rayCouncil.set(rayonId, rc);
          }
          addCouncil(rc, sec, legend);
          let rk = rayKo.get(rayonId);
          if (!rk) {
            rk = newMayor();
            rayKo.set(rayonId, rk);
          }
          addMayor(rk, sec.mayorVotes, sec.mayorValid);
          let rkr = rayKr.get(rayonId);
          if (!rkr) {
            rkr = newMayor();
            rayKr.set(rayonId, rkr);
          }
          addMayor(rkr, sec.rayonMayorVotes, sec.rayonMayorValid);
        }
      }

      // Fold this cycle's aggregates into the cross-cycle accumulator.
      if (isSofiaRayon) {
        acc.place.council.set(cycle, placeCouncil);
        const w = resolveMayorWinner(placeMayor, koCandidates, cycle, year);
        if (w) acc.place.mayor.push(w);
      }
      for (const [ek, sc] of settCouncil) {
        const pa = acc.settlements.get(ek) ?? newPlaceAcc();
        acc.settlements.set(ek, pa);
        pa.council.set(cycle, sc);
        const w = resolveMayorWinner(
          settMayor.get(ek) ?? newMayor(),
          koCandidates,
          cycle,
          year,
        );
        if (w) pa.mayor.push(w);
      }
      for (const [rayonId, rc] of rayCouncil) {
        const pa = acc.rayons.get(rayonId) ?? newPlaceAcc();
        acc.rayons.set(rayonId, pa);
        pa.council.set(cycle, rc);
        const ko = resolveMayorWinner(
          rayKo.get(rayonId) ?? newMayor(),
          koCandidates,
          cycle,
          year,
        );
        if (ko) pa.mayor.push(ko);
        const kr = resolveMayorWinner(
          rayKr.get(rayonId) ?? newMayor(),
          krCandidates.get(rayonId) ?? [],
          cycle,
          year,
        );
        if (kr) pa.rayonMayor.push(kr);
      }
      processed += 1;
    }
    console.log(`[placeTrends] ${cycle}: ${processed} containers`);
  }

  // Serialize ONE FILE PER PLACE so each dashboard fetches only its own trend:
  //   s/<ekatte>.json (settlement) · r/<rayonId>.json (Plovdiv/Varna район) ·
  //   p/<obshtinaCode>.json (Sofia район's own trend).
  const outDir = path.join(publicFolder, "local_place_trends");
  // Drop any stale layout (the old per-município top-level files + the subdirs).
  if (fs.existsSync(outDir)) {
    for (const e of fs.readdirSync(outDir, { withFileTypes: true })) {
      const p = path.join(outDir, e.name);
      if (e.isDirectory()) fs.rmSync(p, { recursive: true, force: true });
      else if (e.name.endsWith(".json")) fs.unlinkSync(p);
    }
  }
  for (const sub of ["s", "r", "p"])
    fs.mkdirSync(path.join(outDir, sub), { recursive: true });

  let written = 0;
  const writeOne = (sub: string, key: string, trend: PlaceTrend): void => {
    const file: PlaceTrendFile = { cyclesAsc, trend };
    fs.writeFileSync(path.join(outDir, sub, `${key}.json`), stringify(file));
    written += 1;
  };

  // гр.София's EKATTE spans all 24 Sofia райони, so its settlement slice would
  // collide across containers — skip settlement emission for Sofia райони (the
  // район's own `p/` trend already represents it).
  for (const [code, acc] of containers) {
    if (SOFIA_RAYON_RE.test(code)) {
      const place = finalizePlace(acc.place);
      if (place) writeOne("p", code, place);
      continue;
    }
    for (const [ek, pa] of acc.settlements) {
      const t = finalizePlace(pa);
      if (t) writeOne("s", ek, t);
    }
    for (const [rayonId, pa] of acc.rayons) {
      const t = finalizePlace(pa);
      if (t) writeOne("r", rayonId, t);
    }
  }
  console.log(
    `[placeTrends] wrote ${written} per-place trend files → ${path.relative(publicFolder, outDir)}/{s,r,p}/`,
  );
};
