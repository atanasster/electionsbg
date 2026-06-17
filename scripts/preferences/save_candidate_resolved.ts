import fs from "fs";
import type { MpIndexEntry } from "@/data/parliament/useMps";
import type { CandidatesInfo, PartyInfo } from "@/data/dataTypes";
import { normalizeMpName } from "@/lib/utils";
import {
  buildGroups,
  buildMpsByName,
  buildResolvedFromMp,
  partyHintTokens,
  type ResolvedCandidate,
} from "@/data/candidates/resolveCore";

// Precompute candidate → person resolution into per-candidate shards so the
// candidate page no longer downloads the full election `candidates.json`
// (~1 MB) + `parliament/index.json` (~950 KB) just to render one person.
//
// Two shard families are written under `<election>/candidates/`:
//
//   <name>/resolved.json   — array of resolved records that share this exact
//                            CIK name (the namesake list; one entry per
//                            distinct (name, partyNum) person). Fetched by
//                            bare-name /candidate/{name} URLs.
//   by-slug/<slug>.json    — single resolved record keyed by the unambiguous
//                            slug. Covers c-{partyNum}-{nameSlug} (CIK) and
//                            mp-{id} (parliament) URLs. An mp-{id} file is
//                            written for *every* MP in the index — even those
//                            who did not run this cycle — so /candidate/mp-{id}
//                            links keep resolving to the MP profile.
//
// The grouping logic is the exact same `buildGroups` the in-browser header
// search (`useCikGroups`) runs, so the shards stay consistent with it.

type MpIndexFile = { mps?: MpIndexEntry[] };

// Skip the write when the on-disk shard already matches — keeps the diff (and
// the bucket sync) minimal when this runs as a downstream rebuild after a
// parliament-index refresh, where only the handful of shards whose MP match
// actually changed need rewriting.
const writeIfChanged = (filePath: string, content: string) => {
  try {
    if (
      fs.existsSync(filePath) &&
      fs.readFileSync(filePath, "utf-8") === content
    ) {
      return;
    }
  } catch {
    // fall through to write
  }
  fs.writeFileSync(filePath, content, "utf-8");
};

export const saveCandidateResolved = ({
  publicFolder,
  year,
  stringify,
}: {
  publicFolder: string;
  year: string;
  stringify: (o: object) => string;
}) => {
  const outFolder = `${publicFolder}/${year}`;
  const candidatesPath = `${outFolder}/candidates.json`;
  const partiesPath = `${outFolder}/cik_parties.json`;
  const indexPath = `${publicFolder}/parliament/index.json`;

  if (!fs.existsSync(candidatesPath)) return;
  const candidates: CandidatesInfo[] = JSON.parse(
    fs.readFileSync(candidatesPath, "utf-8"),
  );
  if (!candidates.length) return;

  const parties: PartyInfo[] = fs.existsSync(partiesPath)
    ? JSON.parse(fs.readFileSync(partiesPath, "utf-8"))
    : [];
  const partiesByNum = new Map<number, PartyInfo>();
  for (const p of parties) partiesByNum.set(p.number, p);

  const indexFile: MpIndexFile = fs.existsSync(indexPath)
    ? JSON.parse(fs.readFileSync(indexPath, "utf-8"))
    : {};
  const mps: MpIndexEntry[] = indexFile.mps ?? [];
  // Mirror useMps's queryFn re-canonicalization so name-matching is identical
  // to the browser. (photoUrl stays the raw relative path written by the
  // scraper; the frontend resolves it through dataUrl when it reads the shard.)
  for (const mp of mps) {
    mp.normalizedName = normalizeMpName(mp.normalizedName);
    mp.normalizedName_en = normalizeMpName(mp.normalizedName_en);
  }

  const mpsByName = buildMpsByName(mps);
  const hintsFor = (partyNum: number): string[] => {
    const party = partiesByNum.get(partyNum);
    if (!party) return [];
    return partyHintTokens(
      party.nickName ?? party.name ?? null,
      party.commonName,
      party.name,
    );
  };

  const groups = buildGroups(candidates, mpsByName, hintsFor);

  const candidatesFolder = `${outFolder}/candidates`;
  if (!fs.existsSync(candidatesFolder)) {
    fs.mkdirSync(candidatesFolder, { recursive: true });
  }

  // 1) Per exact CIK name → namesake array. buildGroups groups names
  // case-insensitively, so collect every group whose normalized name matches
  // this exact name (the same set the bare-name resolver returns today).
  const groupsByNorm = new Map<string, ResolvedCandidate[]>();
  for (const g of groups) {
    const norm = normalizeMpName(g.name);
    const list = groupsByNorm.get(norm);
    if (list) list.push(g);
    else groupsByNorm.set(norm, [g]);
  }
  const exactNames = new Set(candidates.map((c) => c.name));
  for (const name of exactNames) {
    const matches = groupsByNorm.get(normalizeMpName(name)) ?? [];
    const folder = `${candidatesFolder}/${name}`;
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    writeIfChanged(`${folder}/resolved.json`, stringify(matches));
  }

  // Former MPs reachable by a bare /candidate/{name} URL but with no CIK
  // candidacy this cycle. The in-browser resolver's bare-name path tries CIK
  // groups first (by normalized name) and only then the parliament index, so
  // we mirror that precedence: emit an MP-only resolved.json only when no CIK
  // group already covers that normalized name.
  const mpsByExactName = new Map<string, MpIndexEntry[]>();
  for (const mp of mps) {
    const list = mpsByExactName.get(mp.name);
    if (list) list.push(mp);
    else mpsByExactName.set(mp.name, [mp]);
  }
  for (const [name, group] of mpsByExactName) {
    if (exactNames.has(name)) continue;
    if (groupsByNorm.has(normalizeMpName(name))) continue;
    const records = group.map((mp) => buildResolvedFromMp(mp, groups));
    const folder = `${candidatesFolder}/${name}`;
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    writeIfChanged(`${folder}/resolved.json`, stringify(records));
  }

  // 2) Per-slug single record. cik-slug + matched mp-slug come from groups;
  // then write an mp-slug file for every MP in the index (former MPs included).
  const bySlugFolder = `${candidatesFolder}/by-slug`;
  if (!fs.existsSync(bySlugFolder)) {
    fs.mkdirSync(bySlugFolder, { recursive: true });
  }
  for (const g of groups) {
    writeIfChanged(`${bySlugFolder}/${g.slug}.json`, stringify(g));
  }
  for (const mp of mps) {
    const record = buildResolvedFromMp(mp, groups);
    writeIfChanged(`${bySlugFolder}/mp-${mp.id}.json`, stringify(record));
  }
};
