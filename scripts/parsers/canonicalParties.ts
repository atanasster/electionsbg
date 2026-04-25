import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ElectionInfo, PartyInfo } from "@/data/dataTypes";
import {
  CanonicalParty,
  CanonicalPartiesIndex,
  CanonicalPartyHistory,
} from "@/data/parties/canonicalPartyTypes";
import { cikPartiesFileName } from "scripts/consts";
import { partyOverrides } from "./partyOverrides";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Union-Find over nickNames so we can collapse aliases into a single canonical
// lineage. Each unique nickName starts in its own set; we union sets when we
// see them treated as the same party (via commonName arrays in cik_parties or
// via manual overrides in partyOverrides.ts).
class UnionFind {
  parent = new Map<string, string>();
  add(x: string) {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }
  find(x: string): string {
    this.add(x);
    let p = this.parent.get(x)!;
    if (p === x) return x;
    p = this.find(p);
    this.parent.set(x, p);
    return p;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

const SLUG_FALLBACK_PREFIX = "p_";
const slugify = (s: string, taken: Set<string>): string => {
  // Try a transliterated lowercase ASCII slug; fall back to a counter if the
  // input is all-Cyrillic and produces an empty slug.
  const ascii = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  let candidate = ascii || `${SLUG_FALLBACK_PREFIX}${taken.size}`;
  let i = 2;
  while (taken.has(candidate)) {
    candidate = `${ascii || SLUG_FALLBACK_PREFIX + taken.size}-${i}`;
    i++;
  }
  taken.add(candidate);
  return candidate;
};

export const generateCanonicalParties = ({
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
  // Sort newest-first so when we resolve the canonical color/displayName
  // we naturally prefer the most recent election's branding.
  const elections: ElectionInfo[] = (
    JSON.parse(fs.readFileSync(electionsFile, "utf-8")) as ElectionInfo[]
  ).sort((a, b) => b.name.localeCompare(a.name));

  // Conservative grouping rules:
  //   1. Same nickName across elections = same canonical lineage.
  //   2. Manual overrides in partyOverrides.ts merge specific nicknames.
  //
  // Crucially, we do NOT union by `commonName`. The CEC `commonName` field is
  // transitive in practice (party A lists B, B lists C) and would produce
  // false merges across decades — earlier experiments collapsed ГЕРБ into
  // ПП-ДБ via the shared "ДСБ" alias.
  const uf = new UnionFind();
  type Membership = {
    election: string;
    partyNum: number;
    nickName: string;
    name?: string;
    color?: string;
  };
  const memberships: Membership[] = [];

  elections.forEach((e) => {
    const file = path.join(publicFolder, e.name, cikPartiesFileName);
    if (!fs.existsSync(file)) return;
    const parties: PartyInfo[] = JSON.parse(fs.readFileSync(file, "utf-8"));
    parties.forEach((p) => {
      if (!p.nickName) return;
      uf.add(p.nickName);
      memberships.push({
        election: e.name,
        partyNum: p.number,
        nickName: p.nickName,
        name: p.name,
        color: p.color,
      });
    });
  });

  // Apply manual overrides (curated rebrands and casing variants).
  partyOverrides.forEach((ov) => {
    if (ov.aliases.length === 0) return;
    const anchor = ov.aliases[0];
    uf.add(anchor);
    ov.aliases.slice(1).forEach((alias) => {
      uf.add(alias);
      uf.union(anchor, alias);
    });
  });

  // Step 3: group memberships by their union-find root.
  const groups = new Map<string, Membership[]>();
  memberships.forEach((m) => {
    const root = uf.find(m.nickName);
    const list = groups.get(root) ?? [];
    list.push(m);
    groups.set(root, list);
  });

  // Step 4: build CanonicalParty entries. Pick id, displayName, and color from
  // the most-recent membership (or override if one exists).
  const taken = new Set<string>();
  const overrideByAlias = new Map<string, (typeof partyOverrides)[number]>();
  partyOverrides.forEach((ov) =>
    ov.aliases.forEach((a) => overrideByAlias.set(a, ov)),
  );

  const canonicals: CanonicalParty[] = [];
  groups.forEach((members) => {
    const sorted = [...members].sort((a, b) =>
      b.election.localeCompare(a.election),
    );
    const newest = sorted[0];
    const ov = overrideByAlias.get(newest.nickName);
    const id = ov ? ov.id : slugify(newest.nickName, taken);
    if (ov) taken.add(ov.id);
    const history: CanonicalPartyHistory[] = sorted
      .slice() // copy
      .sort((a, b) => a.election.localeCompare(b.election))
      .map((m) => ({
        election: m.election,
        partyNum: m.partyNum,
        nickName: m.nickName,
        name: m.name,
      }));
    canonicals.push({
      id,
      displayName: ov ? ov.displayName : newest.nickName,
      color: newest.color || "#888",
      history,
    });
  });

  canonicals.sort((a, b) => a.id.localeCompare(b.id));

  const byNickName: Record<string, string> = {};
  canonicals.forEach((c) => {
    c.history.forEach((h) => {
      if (!byNickName[h.nickName]) byNickName[h.nickName] = c.id;
    });
  });
  // Also map override aliases that didn't appear in any election (so the
  // frontend can still resolve them if it ever sees an unfamiliar nickName).
  partyOverrides.forEach((ov) => {
    ov.aliases.forEach((a) => {
      if (!byNickName[a]) byNickName[a] = ov.id;
    });
  });

  const index: CanonicalPartiesIndex = { parties: canonicals, byNickName };
  const outFile = path.join(publicFolder, "canonical_parties.json");
  fs.writeFileSync(outFile, stringify(index), "utf-8");
  console.log(
    `Wrote ${outFile} (${canonicals.length} canonical lineages from ${memberships.length} memberships)`,
  );
};
