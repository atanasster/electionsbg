// Builds data/procurement/derived/mp_party.json — a compact
// `{ mpId: partyShort }` map consumed by the procurement tiles to colour the
// MP party chips.
//
// Why a sidecar rather than baking partyShort into mp_connected.json /
// by_ns/*.json directly: parliament/index.json only carries the *current*
// parliament-group short name. For former MPs (those who didn't get a seat
// in the latest parliament, or sat decades ago) that field is null. The
// fallback path walks every election folder's candidates.json looking for a
// name match and resolves partyNum via the same folder's cik_parties.json.
// That walk is heavy enough that we run it once and cache the answer.
//
// Run via: `tsx scripts/procurement/mp_party.ts`. The pipeline can also
// invoke buildMpPartyLookup() programmatically.

import fs from "fs";
import path from "path";
import { canonicalJson } from "./validate";

interface Mp {
  id: number;
  name: string;
  currentPartyGroupShort: string | null;
  nsFolders: string[];
}
interface Candidate {
  name: string;
  partyNum: number;
}
interface CikParty {
  number: number;
  nickName?: string;
  name: string;
}

export interface MpPartyFile {
  generatedAt: string;
  total: number;
  // Key is mpId stringified (JSON can't have number keys); value is the bare
  // party short label (e.g. "ГЕРБ-СДС"), already stripped of any "ПГ" / "ПГ на"
  // prefix.
  partyByMpId: Record<string, string>;
}

// "ПГ на ГЕРБ-СДС" → "ГЕРБ-СДС"; "ПГ ДПС" → "ДПС"; leaves bare names alone.
const stripPg = (s: string): string => s.replace(/^ПГ(\s+на)?\s+/, "").trim();

const normalize = (s: string): string =>
  s.toUpperCase().replace(/\s+/g, " ").trim();

export const buildMpPartyLookup = (dataRoot: string): MpPartyFile => {
  const parliament = JSON.parse(
    fs.readFileSync(path.join(dataRoot, "parliament/index.json"), "utf8"),
  ) as { mps: Mp[] };

  // Every election folder we have candidates.json for, newest first.
  const electionFolders = fs
    .readdirSync(dataRoot)
    .filter((f) => /^\d{4}_\d{2}_\d{2}$/.test(f))
    .filter((f) => fs.existsSync(path.join(dataRoot, f, "candidates.json")))
    .sort()
    .reverse();

  const candCache = new Map<string, Candidate[]>();
  const partyCache = new Map<string, Map<number, CikParty>>();
  const loadCand = (folder: string): Candidate[] => {
    const cached = candCache.get(folder);
    if (cached) return cached;
    const fp = path.join(dataRoot, folder, "candidates.json");
    const data = fs.existsSync(fp)
      ? (JSON.parse(fs.readFileSync(fp, "utf8")) as Candidate[])
      : [];
    candCache.set(folder, data);
    return data;
  };
  const loadParties = (folder: string): Map<number, CikParty> => {
    const cached = partyCache.get(folder);
    if (cached) return cached;
    const fp = path.join(dataRoot, folder, "cik_parties.json");
    const map = new Map<number, CikParty>();
    if (fs.existsSync(fp)) {
      const data = JSON.parse(fs.readFileSync(fp, "utf8")) as CikParty[];
      for (const p of data) map.set(p.number, p);
    }
    partyCache.set(folder, map);
    return map;
  };

  const partyByMpId: Record<string, string> = {};
  let viaCurrent = 0;
  let viaCikFallback = 0;
  let miss = 0;

  // CIK candidate match first (every NS folder), so we get the canonical
  // nickName ("ПрБ") that the PartyTag colour lookup knows how to resolve.
  // Falling back to the parliament-group label only when no candidacy is
  // recorded for the MP at all.
  for (const mp of parliament.mps) {
    const target = normalize(mp.name);
    let found: string | null = null;
    for (const folder of electionFolders) {
      const hit = loadCand(folder).find((c) => normalize(c.name) === target);
      if (!hit) continue;
      const p = loadParties(folder).get(hit.partyNum);
      if (p) {
        found = p.nickName ?? p.name;
        break;
      }
    }
    if (found) {
      partyByMpId[String(mp.id)] = found;
      viaCikFallback++;
      continue;
    }
    if (mp.currentPartyGroupShort) {
      partyByMpId[String(mp.id)] = stripPg(mp.currentPartyGroupShort);
      viaCurrent++;
      continue;
    }
    miss++;
  }

  console.log(`  mp_party.json lookup:`);
  console.log(`    via currentPartyGroupShort: ${viaCurrent}`);
  console.log(`    via CIK candidate fallback: ${viaCikFallback}`);
  console.log(`    no match: ${miss}`);

  return {
    generatedAt: new Date().toISOString(),
    total: Object.keys(partyByMpId).length,
    partyByMpId,
  };
};

export const writeMpPartyLookup = (
  derivedDir: string,
  lookup: MpPartyFile,
): void => {
  fs.mkdirSync(derivedDir, { recursive: true });
  fs.writeFileSync(
    path.join(derivedDir, "mp_party.json"),
    canonicalJson(lookup),
  );
};

// CLI entrypoint: regenerate the file from the current data/ root.
if (import.meta.url === `file://${process.argv[1]}`) {
  const dataRoot = path.resolve("./data");
  const derivedDir = path.join(dataRoot, "procurement/derived");
  const lookup = buildMpPartyLookup(dataRoot);
  writeMpPartyLookup(derivedDir, lookup);
  console.log(`  wrote ${path.join(derivedDir, "mp_party.json")}`);
}
