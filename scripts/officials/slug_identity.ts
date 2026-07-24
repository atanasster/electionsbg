// Recovering the register's per-PERSON identity from a declaration filename,
// and the slug-collision test that identity feeds.
//
// Kept out of ./index.ts on purpose: that module calls run() at import time, so
// it cannot be imported from a test. Same reason as ./merge.ts.
//
// register.cacbg.bg normally names a declaration after the DECLARANT, not after
// the document: `<PERSON-GUID><filing-seq>.xml`, e.g.
// `FABC4CD0-EE60-4532-8F5A-68404AE4F910212933.xml`. That GUID is stable across
// every filing one person ever makes, which is what makes it usable as an
// identity, and 39,677 of the 39,815 declarations in the corpus have that shape.
//
// The other 138 do not. In the 2019-2023 folders (129 of them in 2020 alone) the
// register emitted a BARE guid with no sequence suffix —
// `255f6c79-551f-4b67-87b4-77e8b1401ddb.xml`. That guid is per-DOCUMENT, not
// per-person: the ombudsman Диана Ковачева's three 2020 filings carry three
// different ones, and none equals the `068381B0…` that fronts her other nine
// filings. Read as a person id, a bare guid is therefore GUARANTEED to look like
// a stranger — one more per extra filing — which is how the collision check came
// to report one person as several, and how 66 document ids ended up in
// ./_slug_collisions.json splitting real people into orphan profiles.
//
// So: a filing whose name carries no sequence suffix proves NOTHING about who
// filed it, and the checks below abstain rather than guess.
//
// What is left is a check that fires on two real person ids — which is the
// honest limit of what a filename can prove. A person id the register RE-ISSUED
// (Николай Стефанов Петров, 2014 under FBEA081E…, 2016 under 68B238E8…, same
// house, flat and loan) is indistinguishable here from two same-named people;
// only the declared holdings tell those apart, so the warning asks the operator
// to look rather than prescribing the fix.

/** `<GUID><filing-seq>.xml` — the only filename shape that carries a person id.
 *  The sequence suffix is what distinguishes it from a bare per-document guid,
 *  so it is required, not optional. */
const PERSON_GUID_FILE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\d+\.xml$/i;

/** The register's own per-person id, or null when the filename carries a
 *  per-document guid instead (see the header). Upper-cased: the bare form
 *  arrives lower-case in the source URLs while the stable one arrives
 *  upper-case, and one person can appear in both cases across years. */
export const personGuid = (xmlFile: string): string | null => {
  const m = PERSON_GUID_FILE.exec(xmlFile.trim());
  return m ? m[1].toUpperCase() : null;
};

/** Same, from a declaration's `sourceUrl` (…/<folder>/<xmlFile>). */
export const personGuidFromSourceUrl = (url: string): string | null =>
  personGuid(url.split("/").pop() ?? "");

/** Every person id a set of filings actually proves. Filings that prove none are
 *  dropped rather than contributing a document id nothing can ever match. */
export const personGuidsOf = (sourceUrls: Iterable<string>): Set<string> => {
  const out = new Set<string>();
  for (const url of sourceUrls) {
    const g = personGuidFromSourceUrl(url);
    if (g) out.add(g);
  }
  return out;
};

/** A filing, as much of one as either collision check needs. */
export type FilingLike = { sourceUrl: string; declarationYear: number };

export type CollisionFiling = {
  guid: string;
  year: number;
  sourceUrl: string;
};

/** The person ids claiming one slug, each mapped to a filing the operator can
 *  open. More than one entry IS the collision. */
export const personGuidFilings = (
  filings: Iterable<FilingLike>,
): Map<string, CollisionFiling> => {
  const out = new Map<string, CollisionFiling>();
  for (const f of filings) {
    const guid = personGuidFromSourceUrl(f.sourceUrl);
    if (!guid || out.has(guid)) continue;
    out.set(guid, { guid, year: f.declarationYear, sourceUrl: f.sourceUrl });
  }
  return out;
};

/** Person ids in a slug's shard on disk that this run's filings for the same
 *  slug do NOT account for — the cross-year collision signal.
 *
 *  Empty when `incoming` proves no identity at all: a run whose filings for this
 *  slug are all bare-guid (a 2020 backfill) would otherwise declare every id on
 *  disk foreign. */
export const foreignPersonGuids = (
  onDisk: Iterable<string>,
  incoming: Iterable<string>,
): string[] => {
  const inc = personGuidsOf(incoming);
  if (inc.size === 0) return [];
  return [...personGuidsOf(onDisk)].filter((g) => !inc.has(g)).sort();
};

/** slug → person id → one filing to open when checking it. */
export type SlugCollisions = Map<string, Map<string, CollisionFiling>>;

export const recordCollision = (
  into: SlugCollisions,
  slug: string,
  ...filings: CollisionFiling[]
): void => {
  const byGuid = into.get(slug) ?? new Map<string, CollisionFiling>();
  for (const f of filings) if (!byGuid.has(f.guid)) byGuid.set(f.guid, f);
  into.set(slug, byGuid);
};

/** Operator-facing evidence: one block per slug, every competing id with a URL
 *  to open. The point is to make the two declarations cheap to compare, because
 *  comparing them is the only way to tell a genuine same-name pair from a
 *  re-issued id. */
export const formatCollisions = (collisions: SlugCollisions): string[] => {
  const out: string[] = [];
  for (const [slug, byGuid] of [...collisions.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    out.push(slug);
    for (const [guid, f] of [...byGuid.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      out.push(`    ${guid}  filed ${f.year}  ${f.sourceUrl}`);
    }
  }
  return out;
};
