import fs from "fs";
import path from "path";
import {
  PROBLEM_NEIGHBORHOODS,
  ProblemNeighborhood,
} from "../reports/problem_sections/neighborhoods";
import {
  LocalSectionDetail,
  LocalSectionResult,
  LocalSectionShard,
} from "./types";

// Local-elections counterpart of scripts/reports/problem_sections — flags the
// curated Roma-neighborhood polling sections inside the *local* (общински)
// council data so the município dashboard can show a "Problem votes by party"
// tile (the council-ballot analogue of the parliamentary one).
//
// Source : data/<cycle>/sections/<obshtinaCode>.json        (light shard, has
//          ekatte + address) for matching, then the per-station detail file
//          data/<cycle>/sections/<obshtinaCode>/<code>.json  for full votes.
// Output : data/<cycle>/problem_sections.json
//
// The output is PRE-AGGREGATED to per-neighborhood party totals — the município
// tile only needs each party's summed council vote across the flagged sections
// (+ the prior cycle's, for ΔPP), never the per-station breakdown. Aggregating
// here keeps the file ~6× smaller (one ~23 KB file the SPA fetches once and
// caches), so no per-município sharding is needed.
//
// Why a separate matcher (can't reuse the parliamentary problem_sections.json):
// local section codes are prefixed by the NSI административна област, while
// parliamentary codes are prefixed by the многомандатен район (МИР). Those
// diverge for exactly the cities that carry these neighborhoods (Sofia 22 →
// МИР 23/24/25; Plovdiv province), so a parliamentary section code cannot be
// joined onto a local section. Matching must run against local sections
// directly, using EKATTE + address (and, where the prefix happens to coincide,
// the section prefix — true for Plovdiv where МИР=NSI=16).
//
// `localPartyNum` is OIK-scoped (per-município), NOT global, so the party
// legend (num → canonical id / name / colour) is resolved per-neighborhood from
// that obshtina's shard; each neighborhood lives in a single obshtina.

export type LocalProblemPartyTotal = {
  localPartyNum: number;
  localPartyName: string;
  primaryCanonicalId: string | null;
  color: string;
  votes: number;
};

export type LocalProblemNeighborhood = {
  id: string;
  name_bg: string;
  name_en: string;
  city_bg: string;
  city_en: string;
  source_url: string;
  obshtinaCode: string;
  obshtinaName: string;
  // The административен район the neighborhood sits in, as the 2-digit section-
  // code field (digits 5-6) shared by its flagged sections — the join key for
  // the район drill-down pages: Sofia районите (S2xxx, where S2511 → "11") and
  // Пловдив/Варна (<muni>-<code>, where VAR06-03 → "03"). "00" for общини без
  // районно деление (their município page ignores it).
  rayonCode: string;
  sectionCount: number;
  numRegisteredVoters: number;
  totalActualVoters: number;
  numValidVotes: number;
  // Council votes summed across the neighborhood's flagged sections, by party,
  // descending. The denominator for "share of problem votes" is Σ votes.
  parties: LocalProblemPartyTotal[];
};

export type LocalProblemSectionsReport = {
  cycle: string;
  neighborhoods: LocalProblemNeighborhood[];
};

// Normalise an EKATTE for cross-system comparison: drop any "-NNNN" район
// suffix (parliamentary Sofia uses the compound "68134-2511", local uses the
// bare "68134"), then strip leading zeros (local Burgas is "7079" while the
// neighborhood list carries "07079").
const normEkatte = (e: string | undefined): string =>
  (e ?? "").split("-")[0].replace(/^0+/, "");

const matchesLocal = (
  section: LocalSectionResult,
  n: ProblemNeighborhood,
): boolean => {
  // Suffix pin — for махала stations the CIK local feed ships with a blank
  // address (Филиповци), so neither the prefix nor the keyword path can reach
  // them. The suffix (code minus its 2-digit МИР/NSI prefix) is shared across
  // systems and cycles. EKATTE-gated so a same-suffix section in another oblast
  // can't be dragged in (Sofia is "68134"; the suffix excludes the prefix).
  if (
    n.sectionSuffixes?.length &&
    normEkatte(section.ekatte) === normEkatte(n.ekatte) &&
    n.sectionSuffixes.includes(section.sectionCode.slice(2))
  ) {
    return true;
  }
  // Section-prefix path — only used by Stolipinovo ("162202"), and only valid
  // for local where МИР=NSI (Plovdiv city). Safe because it's the sole prefix
  // rule and it belongs to Plovdiv.
  if (n.sectionPrefix && section.sectionCode.startsWith(n.sectionPrefix)) {
    return true;
  }
  // Address path, gated on the normalised EKATTE so the keyword can't leak
  // into another settlement that happens to share the street name.
  if (!n.addressIncludes?.length) return false;
  if (normEkatte(section.ekatte) !== normEkatte(n.ekatte)) return false;
  const addr = (section.address || "").toUpperCase();
  return n.addressIncludes.some((kw) => addr.includes(kw.toUpperCase()));
};

const isLocalShard = (o: unknown): o is LocalSectionShard =>
  !!o &&
  typeof o === "object" &&
  typeof (o as LocalSectionShard).obshtinaCode === "string" &&
  Array.isArray((o as LocalSectionShard).sections);

// Read the full per-station party breakdown (the shard trims partyVotes to the
// top few). Falls back to the shard's trimmed votes if the detail file is
// missing.
const readFullPartyVotes = (
  sectionsDir: string,
  obshtinaCode: string,
  section: LocalSectionResult,
): { localPartyNum: number; votes: number }[] => {
  const detailFile = path.join(
    sectionsDir,
    obshtinaCode,
    `${section.sectionCode}.json`,
  );
  try {
    const detail: LocalSectionDetail = JSON.parse(
      fs.readFileSync(detailFile, "utf-8"),
    );
    if (Array.isArray(detail.section?.partyVotes)) {
      return detail.section.partyVotes;
    }
  } catch {
    // missing / malformed → fall back to the trimmed shard votes
  }
  return section.partyVotes;
};

type Acc = {
  obshtinaCode: string;
  obshtinaName: string;
  legend: Map<number, LocalSectionShard["parties"][number]>;
  votes: Map<number, number>;
  // Tally of the 2-digit административен район code (section digits 5-6) across
  // the neighborhood's matched sections; the modal one is emitted as rayonCode.
  rayonCounts: Map<string, number>;
  sectionCount: number;
  numRegisteredVoters: number;
  totalActualVoters: number;
  numValidVotes: number;
};

const generateForCycle = ({
  publicFolder,
  cycle,
  stringify,
}: {
  publicFolder: string;
  cycle: string;
  stringify: (o: object) => string;
}): boolean => {
  const sectionsDir = path.join(publicFolder, cycle, "sections");
  if (!fs.existsSync(sectionsDir)) return false;

  const acc = new Map<string, Acc>();

  for (const f of fs.readdirSync(sectionsDir)) {
    if (!f.endsWith(".json")) continue;
    let shard: unknown;
    try {
      shard = JSON.parse(fs.readFileSync(path.join(sectionsDir, f), "utf-8"));
    } catch {
      continue;
    }
    if (!isLocalShard(shard)) continue;
    // Sofia район shards (S2xxx) would double-count — the city's stations all
    // live in the synthetic SOF bundle.
    if (/^S2\d{3}$/.test(shard.obshtinaCode)) continue;
    const legend = new Map(shard.parties.map((p) => [p.localPartyNum, p]));

    for (const section of shard.sections) {
      for (const n of PROBLEM_NEIGHBORHOODS) {
        if (!matchesLocal(section, n)) continue;
        let a = acc.get(n.id);
        if (!a) {
          a = {
            obshtinaCode: shard.obshtinaCode,
            obshtinaName: shard.obshtinaName,
            legend,
            votes: new Map(),
            rayonCounts: new Map(),
            sectionCount: 0,
            numRegisteredVoters: 0,
            totalActualVoters: 0,
            numValidVotes: 0,
          };
          acc.set(n.id, a);
        }
        a.sectionCount += 1;
        const rc = section.sectionCode.slice(4, 6);
        a.rayonCounts.set(rc, (a.rayonCounts.get(rc) ?? 0) + 1);
        a.numRegisteredVoters += section.numRegisteredVoters;
        a.totalActualVoters += section.totalActualVoters;
        a.numValidVotes += section.numValidVotes;
        for (const pv of readFullPartyVotes(
          sectionsDir,
          shard.obshtinaCode,
          section,
        )) {
          a.votes.set(
            pv.localPartyNum,
            (a.votes.get(pv.localPartyNum) ?? 0) + pv.votes,
          );
        }
        // First matching neighborhood wins this section (the rules are
        // mutually exclusive in practice — Stolipinovo by prefix, the rest by
        // distinct address keywords).
        break;
      }
    }
  }

  const neighborhoods: LocalProblemNeighborhood[] = PROBLEM_NEIGHBORHOODS.map(
    (n) => {
      const a = acc.get(n.id);
      if (!a || a.sectionCount === 0) return null;
      const parties: LocalProblemPartyTotal[] = Array.from(a.votes.entries())
        .map(([num, votes]) => {
          const L = a.legend.get(num);
          return {
            localPartyNum: num,
            localPartyName: L?.localPartyName ?? `#${num}`,
            primaryCanonicalId: L?.primaryCanonicalId ?? null,
            color: L?.color ?? "#9CA3AF",
            votes,
          };
        })
        .filter((p) => p.votes > 0)
        .sort((x, y) => y.votes - x.votes);
      // Modal район code — sections of one neighborhood share a район in
      // practice, so this is just "the" район; the tally only guards against a
      // stray mis-geocoded section dragging the key off.
      const rayonCode =
        Array.from(a.rayonCounts.entries()).sort(
          (x, y) => y[1] - x[1],
        )[0]?.[0] ?? "00";
      return {
        id: n.id,
        name_bg: n.name_bg,
        name_en: n.name_en,
        city_bg: n.city_bg,
        city_en: n.city_en,
        source_url: n.source_url,
        obshtinaCode: a.obshtinaCode,
        obshtinaName: a.obshtinaName,
        rayonCode,
        sectionCount: a.sectionCount,
        numRegisteredVoters: a.numRegisteredVoters,
        totalActualVoters: a.totalActualVoters,
        numValidVotes: a.numValidVotes,
        parties,
      };
    },
  ).filter((n): n is LocalProblemNeighborhood => n !== null);

  if (neighborhoods.length === 0) return false;

  const report: LocalProblemSectionsReport = { cycle, neighborhoods };
  fs.writeFileSync(
    path.join(publicFolder, cycle, "problem_sections.json"),
    stringify(report),
    "utf8",
  );
  const totalSections = neighborhoods.reduce((s, n) => s + n.sectionCount, 0);
  console.log(
    `  ${cycle}: ${neighborhoods.length} neighborhoods, ${totalSections} sections`,
  );
  return true;
};

// Public entry. Generates data/<cycle>/problem_sections.json for one cycle (if
// `cycle` is given) or every regular `_mi` cycle that has a sections/ dir.
// chmi partials carry no section CSV bundle, so they're skipped.
export const generateLocalProblemSections = ({
  publicFolder,
  stringify,
  cycle,
}: {
  publicFolder: string;
  stringify: (o: object) => string;
  cycle?: string;
}) => {
  const cycles = cycle
    ? [cycle]
    : fs
        .readdirSync(publicFolder, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^\d{4}_\d{2}_\d{2}_mi$/.test(d.name))
        .map((d) => d.name)
        .sort();

  console.log("generateLocalProblemSections:");
  let any = false;
  for (const c of cycles) {
    if (generateForCycle({ publicFolder, cycle: c, stringify })) any = true;
  }
  if (!any) console.log("  (no matching local sections found)");
};
