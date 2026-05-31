// Section-level aggregation for the 2011 council ballot (mipvr2011).
//
// The 2011 bundle (el2011_t1.zip) predates the modern CSV layout and diverges
// on every axis, so it gets a dedicated reader rather than bending the modern
// parsers:
//   • folder:   "общински съветници" (not "ОС")
//   • encoding: CP1251 file CONTENT (the modern bundles are UTF-8; only the
//               zip's directory names are CP866)
//   • files:    el2011_council_{votes,protocols,sections,coalitions}.txt
//   • votes:    ";<section>;<party>;<votes>;<party>;<votes>;…"  PAIRS, no
//               admin_unit column — the OIK is the section code's first 4 digits
//   • protocol: registered = field 3 (index 2), actual voters = field 7
//               (index 6); no serials cell
//   • sections: ";<section>;<oblast>;<obshtina>;<settlement>;<ekatte>"
//   • coalitions: "<oik>;<party_num>;<name>;<order>"  → the party legend
//
// Output is the same SectionAggregation the modern aggregator emits, so the
// orchestrator's applyCouncilVotes + buildSectionShard consume it unchanged.
// Verified: per-OIK vote sums equal the HTML council totals to the vote.

import fs from "fs";
import path from "path";
import { CanonicalPartiesIndex } from "@/data/parties/canonicalPartyTypes";
import { buildByNickNameLower, resolveLocalParty } from "./local_coalitions";
import { LocalSectionResult } from "./types";
import { SectionAggregation, PartyLegendEntry } from "./augment_sections";

const cp1251 = new TextDecoder("windows-1251");

const readLines = (file: string): string[][] =>
  cp1251
    .decode(fs.readFileSync(file))
    .split(/\r?\n/)
    .filter((l) => l.length > 0)
    .map((l) => l.split(";"));

// Resolve a council file by its el2011_council_<base> name within the folder.
const resolveFile = (folder: string, base: string): string | null => {
  if (!fs.existsSync(folder)) return null;
  const re = new RegExp(`council_${base}\\.txt$`, "i");
  const f = fs.readdirSync(folder).find((x) => re.test(x));
  return f ? path.join(folder, f) : null;
};

const oikOf = (sectionCode: string): string =>
  (sectionCode ?? "").replace(/\D+/g, "").slice(0, 4).padStart(4, "0");

export const aggregate2011Sections = (opts: {
  rawFolder: string;
  canonical: CanonicalPartiesIndex | undefined;
}): SectionAggregation | null => {
  const folder = path.join(opts.rawFolder, "ТУР1", "общински съветници");
  const votesFile = resolveFile(folder, "votes");
  if (!votesFile) return null;
  const byNickNameLower = buildByNickNameLower(opts.canonical);

  const agg: SectionAggregation = {
    councilVotesByOik: new Map(),
    validTotalByOik: new Map(),
    protocolByOik: new Map(),
    partyLegendByOik: new Map(),
    sectionsByOik: new Map(),
  };

  // 1. Votes — pairs (party; votes) from column 2; section in column 1.
  const sectionPartyVotes = new Map<string, Map<number, number>>();
  const sectionOik = new Map<string, string>();
  for (const r of readLines(votesFile)) {
    const sectionCode = (r[1] ?? "").trim();
    if (!/^\d{9}$/.test(sectionCode)) continue;
    const oik = oikOf(sectionCode);
    sectionOik.set(sectionCode, oik);
    let per = sectionPartyVotes.get(sectionCode);
    if (!per) {
      per = new Map();
      sectionPartyVotes.set(sectionCode, per);
    }
    for (let j = 2; j + 1 < r.length; j += 2) {
      const num = parseInt(r[j], 10);
      const votes = parseInt(r[j + 1] ?? "0", 10) || 0;
      if (Number.isNaN(num)) continue;
      per.set(num, (per.get(num) ?? 0) + votes);
      let perOik = agg.councilVotesByOik.get(oik);
      if (!perOik) {
        perOik = new Map();
        agg.councilVotesByOik.set(oik, perOik);
      }
      perOik.set(num, (perOik.get(num) ?? 0) + votes);
      agg.validTotalByOik.set(oik, (agg.validTotalByOik.get(oik) ?? 0) + votes);
    }
  }

  // 2. Party legend from coalitions.txt: (oik, party_num) → name.
  const coalFile = resolveFile(folder, "coalitions");
  if (coalFile) {
    for (const r of readLines(coalFile)) {
      const oik = (r[0] ?? "").trim().padStart(4, "0");
      const num = parseInt(r[1] ?? "", 10);
      const name = (r[2] ?? "").trim();
      if (Number.isNaN(num) || !name) continue;
      let legend = agg.partyLegendByOik.get(oik);
      if (!legend) {
        legend = new Map();
        agg.partyLegendByOik.set(oik, legend);
      }
      if (!legend.has(num)) {
        const resolution = resolveLocalParty(name, byNickNameLower);
        const entry: PartyLegendEntry = {
          localPartyNum: num,
          localPartyName: name,
          primaryCanonicalId: resolution.primaryCanonicalId,
          memberCanonicalIds: resolution.memberCanonicalIds,
          isIndependent: resolution.isIndependent,
        };
        legend.set(num, entry);
      }
    }
  }

  // 3. Protocols — registered = col 2, actual voters = col 6. The ~84 mobile
  // / experimental sections (a non-empty sign in col 0) use a different form
  // whose actual-voter column we don't decode, so col 6 reads 0 there; the
  // per-section floor below (actual ≥ valid) repairs those. Roll-up happens in
  // step 5, after the floor is applied.
  const protoFile = resolveFile(folder, "protocols");
  const protocolBySection = new Map<
    string,
    { numRegisteredVoters: number; totalActualVoters: number }
  >();
  if (protoFile) {
    for (const r of readLines(protoFile)) {
      const sectionCode = (r[1] ?? "").trim();
      if (!/^\d{9}$/.test(sectionCode)) continue;
      const reg = parseInt(r[2] ?? "", 10);
      const act = parseInt(r[6] ?? "", 10);
      protocolBySection.set(sectionCode, {
        numRegisteredVoters: Number.isNaN(reg) ? 0 : reg,
        totalActualVoters: Number.isNaN(act) ? 0 : act,
      });
    }
  }

  // 4. Section metadata (settlement + ekatte).
  const sectionsFile = resolveFile(folder, "sections");
  const sectionMeta = new Map<string, { settlement: string; ekatte: string }>();
  if (sectionsFile) {
    for (const r of readLines(sectionsFile)) {
      const sectionCode = (r[1] ?? "").trim();
      if (!/^\d{9}$/.test(sectionCode)) continue;
      sectionMeta.set(sectionCode, {
        settlement: (r[4] ?? "").trim(),
        ekatte: (r[5] ?? "").trim(),
      });
    }
  }

  // 5. Per-section result rows.
  for (const [sectionCode, partyVotes] of sectionPartyVotes.entries()) {
    const oik = sectionOik.get(sectionCode) ?? "";
    const meta = sectionMeta.get(sectionCode);
    const proto = protocolBySection.get(sectionCode);
    const numValidVotes = Array.from(partyVotes.values()).reduce(
      (a, b) => a + b,
      0,
    );
    const numRegisteredVoters = proto?.numRegisteredVoters ?? 0;
    // Actual voters must be ≥ valid votes; floor repairs the mobile-form rows
    // whose col-6 reads 0.
    const totalActualVoters = Math.max(
      proto?.totalActualVoters ?? 0,
      numValidVotes,
    );
    const row: LocalSectionResult = {
      sectionCode,
      settlement: meta?.settlement ?? "",
      ekatte: meta?.ekatte ?? "",
      isMobile: false,
      numRegisteredVoters,
      totalActualVoters,
      numValidVotes,
      partyVotes: Array.from(partyVotes.entries())
        .map(([localPartyNum, votes]) => ({ localPartyNum, votes }))
        .sort((a, b) => b.votes - a.votes),
    };
    // Roll up the (floored) turnout per OIK.
    const cur = agg.protocolByOik.get(oik) ?? {
      numRegisteredVoters: 0,
      totalActualVoters: 0,
    };
    cur.numRegisteredVoters += numRegisteredVoters;
    cur.totalActualVoters += totalActualVoters;
    agg.protocolByOik.set(oik, cur);
    let list = agg.sectionsByOik.get(oik);
    if (!list) {
      list = [];
      agg.sectionsByOik.set(oik, list);
    }
    list.push(row);
  }
  for (const list of agg.sectionsByOik.values()) {
    list.sort((a, b) => a.sectionCode.localeCompare(b.sectionCode));
  }

  return agg;
};
