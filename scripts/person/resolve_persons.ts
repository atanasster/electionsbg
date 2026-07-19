// The person resolver (plan §3) — reads the PG-resident office-holder sources, parses
// + blocks + clusters them (nameParts.ts + cluster.ts), and rebuilds the person /
// person_role / person_alias tables. Idempotent: a full TRUNCATE+rebuild with
// DETERMINISTIC slugs, so re-running yields the same person_ids (like
// rebuild_ngo_board_links). Nothing consumes person_id yet, so a rebuild is safe;
// slug persistence (never renumber an active person) is a follow-up once it's served.
//
// Scope so far: magistrate + officials (executive + municipal) + MPs + candidates (CIK,
// per-election by-slug shards) + donors (ЕРИК campaign finance). The mp id is the
// cross-source GOLD KEY — Tier 0 — carried by MPs and by any candidacy resolved to a seat
// (mpId), and is unioned across blocks so a name variant can't scatter one MP. Cross-source
// merges are the safe ones: same mp id (Tier 0), a name-independent corroborant (Tier 1:
// shared company / birth date / party+place, VETOED by a conflicting patronymic), or a
// globally-unique full name (Tier 2). Donors are 2-part and never auto-merge (privacy:
// public_default=false → internal-only). TR-officer bridging and review-candidate
// persistence land in later steps.
//
//   npx tsx scripts/person/resolve_persons.ts
//   DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/person/resolve_persons.ts

import fs, { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, withTx, end } from "../db/lib/pg";
import { copyRows } from "../db/lib/copy";
import { parseName } from "./nameParts";
import { clusterBlock, type Mention } from "./cluster";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

type Raw = {
  id: string;
  source: string;
  ref: string;
  role: string;
  hardId: string | null; // cross-source gold key (parliament MP id) — Tier 0
  display: string;
  given: string;
  patr: string | null;
  family: string;
  nameParts: 2 | 3;
  ambiguous: boolean;
  place: string | null; // for person_role display
  // Matching corroborants (kept SEPARATE from `place` display — a magistrate's court
  // is a display place but not a reliable cross-person corroborant).
  cParty: string | null;
  cPlace: string | null;
  cBirth: string | null;
};

// djb2 → 6 base36 chars. Deterministic disambiguator for magistrate-only slugs.
const hash6 = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36).slice(0, 6).padStart(6, "0");
};
const kebab = (s: string): string =>
  s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// (election, partyNum) -> canonicalId — a party corroborant that is STABLE across
// elections (partyNum is re-assigned every cycle). Lets a person's candidacies for the
// same party in the same oblast merge across elections (weak-both corroboration, §3
// Tier 1). Degrades to no-party when data/canonical_parties.json is absent.
function buildPartyMap(): Map<string, string> {
  const m = new Map<string, string>();
  const p = path.join(REPO_ROOT, "data/canonical_parties.json");
  if (!fs.existsSync(p)) return m;
  const cp = JSON.parse(fs.readFileSync(p, "utf8")) as {
    parties: {
      id: string;
      history: { election: string; partyNum: number }[];
    }[];
  };
  for (const party of cp.parties)
    for (const h of party.history)
      m.set(`${h.election}#${h.partyNum}`, party.id);
  return m;
}

// Build the parse-derived + defaulted fields shared by every source, so each source
// only spells out what differs (id/source/ref/role + any hardId/corroborants).
const fields = (
  p: NonNullable<ReturnType<typeof parseName>>,
  over: Partial<Raw>,
): Omit<Raw, "id" | "source" | "ref" | "role"> => ({
  hardId: null,
  display: p.displayName,
  given: p.given,
  patr: p.patronymic,
  family: p.family,
  nameParts: p.nameParts,
  ambiguous: p.ambiguous,
  place: null,
  cParty: null,
  cPlace: null,
  cBirth: null,
  ...over,
});

async function collect(): Promise<Raw[]> {
  const out: Raw[] = [];
  let skipped = 0;
  const add = (
    name: string,
    r: Omit<Raw, keyof ReturnType<typeof fields>>,
    over: Partial<Raw> = {},
  ) => {
    const p = parseName(name);
    if (!p) {
      skipped++;
      return;
    }
    out.push({ ...r, ...fields(p, over) });
  };

  const mags = await allRows<{ name: string; court: string | null }>(
    `SELECT name, court FROM magistrate`,
  );
  for (const m of mags)
    add(
      m.name,
      {
        id: `magistrate:${m.name}`,
        source: "magistrate",
        ref: m.name,
        role: "magistrate",
      },
      { place: m.court },
    );

  const offs = await allRows<{
    name: string;
    slug: string;
    role: string | null;
    tier: string | null;
  }>(`SELECT name, slug, role, tier FROM official_roster`);
  for (const o of offs)
    add(o.name, {
      id: `official:${o.slug}`,
      source: o.tier === "municipal" ? "official_muni" : "official_exec",
      ref: o.slug,
      role: o.role ?? "official",
    });

  // MPs (data/parliament/index.json) — the mp id is the cross-source GOLD KEY (Tier 0),
  // and birthDate is a strong name-independent corroborant. Degrades gracefully if the
  // file is absent (fresh clone without the parliament data).
  const mpPath = path.join(REPO_ROOT, "data/parliament/index.json");
  if (fs.existsSync(mpPath)) {
    const idx = JSON.parse(fs.readFileSync(mpPath, "utf8")) as {
      mps: {
        id: number;
        name: string;
        currentRegion: string | null;
        currentPartyGroupShort: string | null;
        birthDate: string | null;
      }[];
    };
    for (const mp of idx.mps)
      add(
        mp.name,
        { id: `mp:${mp.id}`, source: "mp", ref: String(mp.id), role: "mp" },
        {
          hardId: `mp:${mp.id}`,
          place: mp.currentRegion,
          cParty: mp.currentPartyGroupShort,
          cPlace: mp.currentRegion,
          cBirth: mp.birthDate,
        },
      );
  }

  const partyMap = buildPartyMap();

  // Candidates (data/{election}/candidates/by-slug/*.json). Each file is one candidacy in
  // one election, already resolved to an MP id when the candidate was seated (`mpId`) —
  // the Tier-0 GOLD link into the MP person. Non-MP candidacies (c-*) carry party+oblast,
  // the cross-election corroborant. ~67k files across ~10 elections; skipped on a fresh
  // clone without the candidate shards.
  for (const dir of globSync(
    path.join(REPO_ROOT, "data/2*/candidates/by-slug"),
  )) {
    const election = path.basename(path.dirname(path.dirname(dir)));
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const c = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as {
        slug: string;
        name: string;
        partyNum: number | null;
        oblasts: string[];
        mpId: number | null;
      };
      const canon =
        c.partyNum != null
          ? (partyMap.get(`${election}#${c.partyNum}`) ?? null)
          : null;
      const oblast = c.oblasts[0] ?? null;
      add(
        c.name,
        {
          id: `candidate:${election}:${c.slug}`,
          source: "candidate",
          ref: `${election}:${c.slug}`,
          role: "candidate",
        },
        {
          hardId: c.mpId != null ? `mp:${c.mpId}` : null,
          place: oblast,
          cParty: canon,
          cPlace: oblast,
        },
      );
    }
  }

  // Donors (data/{election}/parties/financing/{partyNum}/filing.json → data.fromDonors[]).
  // ЕРИК campaign-finance donors are 2-part names (§2a) with no place, so they never
  // auto-merge (Tier-2 needs a 3-part name; weak-both needs a place) — same-name donors
  // surface only as review candidates, exactly as the plan expects. public_default=false
  // (person_source), so a donor-only person is NOT public. One role per (donor, party,
  // election): a donor giving multiple times folds to one row.
  for (const fin of globSync(
    path.join(REPO_ROOT, "data/2*/parties/financing"),
  )) {
    const election = path.basename(path.dirname(path.dirname(fin)));
    for (const partyNum of fs.readdirSync(fin)) {
      const filing = path.join(fin, partyNum, "filing.json");
      if (!fs.existsSync(filing)) continue;
      const f = JSON.parse(fs.readFileSync(filing, "utf8")) as {
        data?: { fromDonors?: { name: string }[] };
      };
      const canon = partyMap.get(`${election}#${partyNum}`) ?? null;
      const seenDonor = new Set<string>();
      for (const d of f.data?.fromDonors ?? []) {
        const p = parseName(d.name);
        if (!p) {
          skipped++;
          continue;
        }
        if (seenDonor.has(p.displayName)) continue; // one role per distinct donor
        seenDonor.add(p.displayName);
        out.push({
          id: `donor:${election}:${partyNum}:${p.displayName}`,
          source: "donor",
          ref: `${election}:${partyNum}:${p.displayName}`,
          role: "donor",
          ...fields(p, { cParty: canon }),
        });
      }
    }
  }

  if (skipped) console.log(`  skipped ${skipped} un-parseable name(s)`);
  return out;
}

// Fold the raw name parts and full names with the ONE normalizer (SQL), and look up
// the namesake company-count — one round trip each, keyed by the distinct strings.
async function foldAndScore(
  raw: Raw[],
): Promise<{ fold: Map<string, string>; namesake: Map<string, number> }> {
  const strs = new Set<string>();
  for (const r of raw) {
    strs.add(r.given);
    strs.add(r.family);
    strs.add(r.display);
    if (r.patr) strs.add(r.patr);
  }
  const foldRows = await allRows<{ s: string; f: string }>(
    `SELECT s, translit_bg_latin(s) AS f FROM unnest($1::text[]) AS s`,
    [[...strs]],
  );
  const fold = new Map(foldRows.map((r) => [r.s, r.f]));

  const fullFolds = [...new Set(raw.map((r) => fold.get(r.display)!))];
  const ncRows = await allRows<{ name_fold: string; company_count: string }>(
    `SELECT name_fold, company_count FROM officer_name_counts WHERE name_fold = ANY($1::text[])`,
    [fullFolds],
  );
  const namesake = new Map(
    ncRows.map((r) => [r.name_fold, Number(r.company_count)]),
  );
  return { fold, namesake };
}

type M = Mention & { raw: Raw };

async function main(): Promise<void> {
  console.log(
    "resolving persons (magistrate + officials + MPs + candidates + donors)…",
  );
  const raw = await collect();
  const { fold, namesake } = await foldAndScore(raw);

  // §6 privacy gate: a person is public only if some source they hold defaults public
  // (person_source.public_default). All current sources are public, but tr/donor/ngo
  // (public_default=false) must NOT mint a public page for a private individual.
  const publicDefault = new Map(
    (
      await allRows<{ key: string; public_default: boolean }>(
        `SELECT key, public_default FROM person_source`,
      )
    ).map((r) => [r.key, r.public_default]),
  );

  const mentions: M[] = raw.map((r) => ({
    id: r.id,
    source: r.source,
    hardId: r.hardId,
    givenFold: fold.get(r.given)!,
    familyFold: fold.get(r.family)!,
    patronymicFold: r.patr ? fold.get(r.patr)! : null,
    nameParts: r.nameParts,
    ambiguous: r.ambiguous,
    namesakeRisk: namesake.get(fold.get(r.display)!) ?? 0,
    corroborants: {
      party: r.cParty,
      place: r.cPlace,
      birthDate: r.cBirth,
    },
    raw: r,
  }));

  // Block on (given_fold, family_fold); cluster each block.
  const blocks = new Map<string, M[]>();
  for (const m of mentions) {
    const k = `${m.givenFold}\t${m.familyFold}`;
    const arr = blocks.get(k) ?? blocks.set(k, []).get(k)!;
    arr.push(m);
  }

  type Group = { ids: string[]; confidence: "exact_id" | "high" };
  const groups: Group[] = [];
  let reviewCandidates = 0;
  for (const block of blocks.values()) {
    const res = clusterBlock(block);
    const merged = new Set<string>();
    for (const mg of res.merges) {
      groups.push({ ids: mg.memberIds, confidence: mg.confidence });
      mg.memberIds.forEach((id) => merged.add(id));
    }
    for (const m of block)
      if (!merged.has(m.id)) groups.push({ ids: [m.id], confidence: "high" });
    reviewCandidates += res.reviewCandidates.length;
  }

  const byId = new Map(mentions.map((m) => [m.id, m]));

  // Global GOLD-KEY union (Tier 0, cross-block). A parliament MP id is the same person
  // under ANY name spelling, but blocking is on (given_fold, family_fold) — so a name
  // variant (marriage, transliteration) can scatter one MP's candidacies across blocks.
  // Merge any groups that share a hardId, regardless of block; a shared gold key ⇒
  // exact_id. (Within-block same-hardId mentions already merged in clusterBlock; this
  // only stitches the cross-block remainder.)
  const gp = groups.map((_, i) => i);
  const gfind = (x: number): number =>
    gp[x] === x ? x : (gp[x] = gfind(gp[x]));
  const firstByHard = new Map<string, number>();
  groups.forEach((g, i) => {
    const hard = new Set<string>();
    for (const id of g.ids) {
      const h = byId.get(id)!.hardId;
      if (h) hard.add(h);
    }
    for (const h of hard) {
      const seen = firstByHard.get(h);
      if (seen === undefined) firstByHard.set(h, i);
      else {
        const a = gfind(seen);
        const b = gfind(i);
        if (a !== b) gp[a] = b;
      }
    }
  });
  const unionComps = new Map<number, string[]>();
  groups.forEach((g, i) => {
    const r = gfind(i);
    (unionComps.get(r) ?? unionComps.set(r, []).get(r)!).push(...g.ids);
  });
  const mergedGroups: Group[] = [...unionComps.values()].map((ids) => {
    // exact_id iff a gold key is shared by >=2 members of the final group.
    const hs = ids
      .map((id) => byId.get(id)!.hardId)
      .filter((h): h is string => h != null);
    return {
      ids,
      confidence: new Set(hs).size < hs.length ? "exact_id" : "high",
    };
  });

  // Build person rows with deterministic slugs, then sort by slug and assign ids so a
  // rebuild is stable.
  type Built = {
    slug: string;
    display: string;
    given: string;
    patr: string | null;
    family: string;
    nameParts: number;
    namesake: number;
    confidence: "exact_id" | "high";
    isPublic: boolean;
    members: M[];
  };
  const built: Built[] = mergedGroups.map((g) => {
    const members = g.ids.map((id) => byId.get(id)!);
    // Slug priority: the mp id gold key (stable, /candidate/mp-{id} lineage) > an
    // official's existing slug > a derived name+hash. Deterministic across runs.
    const mpMember = members
      .filter((m) => m.source === "mp")
      .sort((a, b) => Number(a.raw.ref) - Number(b.raw.ref))[0];
    const officialMember = members
      .filter((m) => m.source.startsWith("official"))
      .sort((a, b) => a.raw.ref.localeCompare(b.raw.ref))[0];
    const key = members[0];
    const best = members
      .map((m) => m.raw)
      .sort(
        (a, b) =>
          b.nameParts - a.nameParts || b.display.length - a.display.length,
      )[0];
    const slug = mpMember
      ? `mp-${mpMember.raw.ref}`
      : officialMember
        ? officialMember.raw.ref
        : `${kebab(`${key.givenFold}-${key.familyFold}`)}-${hash6(
            g.ids.slice().sort().join("|"),
          )}`;
    return {
      slug,
      display: best.display,
      given: key.givenFold,
      patr: members.find((m) => m.patronymicFold)?.patronymicFold ?? null,
      family: key.familyFold,
      nameParts: members.some((m) => m.nameParts === 3) ? 3 : 2,
      namesake: Math.max(...members.map((m) => m.namesakeRisk)),
      confidence: g.confidence,
      isPublic: members.some((m) => publicDefault.get(m.source) ?? false),
      members,
    };
  });

  // Guarantee slug uniqueness (belt-and-suspenders — a magistrate slug could in theory
  // collide with an official slug).
  const seen = new Set<string>();
  for (const b of built) {
    let s = b.slug;
    let i = 2;
    while (seen.has(s)) s = `${b.slug}-${i++}`;
    b.slug = s;
    seen.add(s);
  }
  built.sort((a, b) => a.slug.localeCompare(b.slug));

  const personRows: unknown[][] = [];
  const roleRows: unknown[][] = [];
  const aliasRows: unknown[][] = [];
  const aliasSeen = new Set<string>();
  built.forEach((b, idx) => {
    const pid = idx + 1;
    personRows.push([
      pid,
      b.display,
      b.given,
      b.patr,
      b.family,
      b.nameParts,
      b.slug,
      b.isPublic, // §6 privacy gate — derived from person_source.public_default
      b.namesake,
      "active",
    ]);
    for (const m of b.members) {
      roleRows.push([
        pid,
        m.source,
        m.raw.ref,
        m.raw.role,
        null, // party
        m.raw.place,
        null, // start_date
        null, // end_date
        b.confidence,
        null, // source_row
      ]);
      const ak = `${pid}\t${m.raw.display}\t${m.source}`;
      if (!aliasSeen.has(ak)) {
        aliasSeen.add(ak);
        aliasRows.push([pid, m.raw.display, m.source]);
      }
    }
  });

  await withTx(async (c) => {
    // Rebuild only the derived tables. CASCADE clears the FK-linked person_link_evidence;
    // person_link_override is human-authored (fold-keyed, no FK) and MUST survive rebuilds.
    await c.query(
      `TRUNCATE person, person_role, person_alias RESTART IDENTITY CASCADE`,
    );
    await copyRows(
      c,
      "person",
      [
        "person_id",
        "display_name",
        "given_fold",
        "patronymic_fold",
        "family_fold",
        "name_parts",
        "slug",
        "is_public_figure",
        "namesake_risk",
        "status",
      ],
      personRows,
    );
    await copyRows(
      c,
      "person_role",
      [
        "person_id",
        "source",
        "ref",
        "role",
        "party",
        "place",
        "start_date",
        "end_date",
        "confidence",
        "source_row",
      ],
      roleRows,
    );
    await copyRows(
      c,
      "person_alias",
      ["person_id", "alias_raw", "source"],
      aliasRows,
    );
    await c.query(
      `SELECT setval(pg_get_serial_sequence('person','person_id'), (SELECT COALESCE(max(person_id),1) FROM person))`,
    );
  });

  console.log(
    `  ${personRows.length} persons, ${roleRows.length} roles, ${aliasRows.length} aliases; ${reviewCandidates} review candidate group(s)`,
  );
  await end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
