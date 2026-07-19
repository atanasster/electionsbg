// The person resolver (plan §3) — reads the PG-resident office-holder sources, parses
// + blocks + clusters them (nameParts.ts + cluster.ts), and rebuilds the person /
// person_role / person_alias tables. Idempotent: a full TRUNCATE+rebuild with
// DETERMINISTIC slugs, so re-running yields the same person_ids (like
// rebuild_ngo_board_links). Nothing consumes person_id yet, so a rebuild is safe;
// slug persistence (never renumber an active person) is a follow-up once it's served.
//
// Scope of THIS step: magistrate + officials (executive + municipal) — the clean,
// bounded, authoritative office-holder sources. Cross-source merges happen only via
// the safe Tier-2 unique-fold bridge (a globally-unique 3-part name shared by a
// magistrate and an official). TR-officer bridging, candidates, MPs, donors and the
// review-candidate persistence land in later steps.
//
//   npx tsx scripts/person/resolve_persons.ts
//   DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/person/resolve_persons.ts

import { allRows, withTx, end } from "../db/lib/pg";
import { copyRows } from "../db/lib/copy";
import { parseName } from "./nameParts";
import { clusterBlock, type Mention } from "./cluster";

type Raw = {
  id: string;
  source: string;
  ref: string;
  role: string;
  display: string;
  given: string;
  patr: string | null;
  family: string;
  nameParts: 2 | 3;
  ambiguous: boolean;
  place: string | null; // for person_role display (NOT a matching corroborant)
};

// djb2 → 6 base36 chars. Deterministic disambiguator for magistrate-only slugs.
const hash6 = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36).slice(0, 6).padStart(6, "0");
};
const kebab = (s: string): string =>
  s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

async function collect(): Promise<Raw[]> {
  const out: Raw[] = [];
  let skipped = 0;

  const mags = await allRows<{ name: string; court: string | null }>(
    `SELECT name, court FROM magistrate`,
  );
  for (const m of mags) {
    const p = parseName(m.name);
    if (!p) {
      skipped++;
      continue;
    }
    out.push({
      id: `magistrate:${m.name}`,
      source: "magistrate",
      ref: m.name,
      role: "magistrate",
      display: p.displayName,
      given: p.given,
      patr: p.patronymic,
      family: p.family,
      nameParts: p.nameParts,
      ambiguous: p.ambiguous,
      place: m.court,
    });
  }

  const offs = await allRows<{
    name: string;
    slug: string;
    role: string | null;
    tier: string | null;
  }>(`SELECT name, slug, role, tier FROM official_roster`);
  for (const o of offs) {
    const p = parseName(o.name);
    if (!p) {
      skipped++;
      continue;
    }
    out.push({
      id: `official:${o.slug}`,
      source: o.tier === "municipal" ? "official_muni" : "official_exec",
      ref: o.slug,
      role: o.role ?? "official",
      display: p.displayName,
      given: p.given,
      patr: p.patronymic,
      family: p.family,
      nameParts: p.nameParts,
      ambiguous: p.ambiguous,
      place: null,
    });
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
  console.log("resolving persons (magistrate + officials)…");
  const raw = await collect();
  const { fold, namesake } = await foldAndScore(raw);

  const mentions: M[] = raw.map((r) => ({
    id: r.id,
    source: r.source,
    hardId: null,
    givenFold: fold.get(r.given)!,
    familyFold: fold.get(r.family)!,
    patronymicFold: r.patr ? fold.get(r.patr)! : null,
    nameParts: r.nameParts,
    ambiguous: r.ambiguous,
    namesakeRisk: namesake.get(fold.get(r.display)!) ?? 0,
    corroborants: {}, // no reliable cross-source corroborant in these two sources
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
    members: M[];
  };
  const built: Built[] = groups.map((g) => {
    const members = g.ids.map((id) => byId.get(id)!);
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
    const slug = officialMember
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
      true, // is_public_figure — these are office-holder sources
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
