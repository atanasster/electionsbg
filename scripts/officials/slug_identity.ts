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

/** `PERSON_GUID_FILE` as a Postgres POSIX pattern over a whole `source_url`,
 *  for the one consumer that cannot import this module: the SQL inside
 *  `scripts/person/resolve_persons.ts`'s `registerIdByRef()`.
 *
 *  It lives HERE, beside the regex it mirrors, because the two must agree and
 *  the resolver is where disagreement is invisible. Read as a person id, a bare
 *  per-document guid makes one declarant look like two — and the resolver's
 *  guard is `HAVING count(DISTINCT guid) = 1`, so an extra id does not produce a
 *  wrong merge, it produces NO KEY AT ALL and the ref falls back to the
 *  name-based tiers with nothing logged. Measured 2026-08-11 on the naive
 *  pattern (a bare guid matched anywhere in the URL): 70 refs skipped as
 *  "two register persons", of which **2** actually were. The other 68 lost the
 *  register's own identity assertion to a filename shape.
 *
 *  Anchored on `/` … `.xml$` so it can only ever match the last path segment,
 *  which is what `personGuid` sees. `person_register_guid.data.test.ts` runs both
 *  over every `declaration.source_url` in the corpus and fails on any drift, and
 *  `slug_identity.test.ts` covers the shapes the corpus does not contain.
 *
 *  TWO DELIBERATE DIVERGENCES from `personGuid`, both of which the corpus cannot
 *  currently exercise (0 untrimmed and 0 slash-free `source_url` today) and so
 *  cannot be caught by the corpus gate alone:
 *   - **trimming is the caller's job.** `personGuid` calls `.trim()`; this does
 *     not, because a stored URL with surrounding whitespace is a load defect
 *     rather than a filename shape, and silently accepting one here would hide it.
 *   - **a `/` is required.** `personGuid` runs on a filename, this on a URL, so a
 *     bare `<GUID>123.xml` with no path yields null here. Every `source_url` is
 *     built from `REGISTER_BASE`, so a slash-free one is likewise a defect. */
export const PERSON_GUID_SQL_PATTERN =
  "/([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})[0-9]+\\.xml$";

/** The pre-2026-08 extractor: any guid, anywhere in the URL, sequence suffix not
 *  required — i.e. one that cannot tell a person id from a per-document one.
 *
 *  Exported ONLY as the baseline `PERSON_GUID_SQL_PATTERN` is measured against,
 *  so the gate can prove the narrowing still discriminates. It must never be a
 *  live extractor again; it is here precisely so a second copy stops being
 *  written by hand, which is how the original survived as long as it did. */
export const LEGACY_ANY_GUID_SQL_PATTERN =
  "([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})";

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
  /** `<Personal><Work>` — the declarant's actual EMPLOYER, which the group
   *  labels the slug is built from ("Училища", "Процедури по ЗОП") throw away.
   *  Null when the XML is not in the cache. See `workOf` below. */
  work?: string | null;
};

/** The employer named inside a declaration XML.
 *
 *  The whole collision problem is that `institution` is a GROUP label — 978
 *  declarants share "Процедури по ЗОП" — so it cannot separate two same-named
 *  people. `<Work>` is not a group: it is the school, court or unit the
 *  declarant actually serves, and in practice it settles the case outright.
 *  Иван Стоянов Стоянов / Процедури по ЗОП was one profile over an окръжен
 *  прокурор in Хасково and a командир на дивизион at военно формирование 26720;
 *  Иван Георгиев Иванов / Училища over the directors of ОУ "Климент Охридски"
 *  and ОУ "Д-р Петър Берон".
 *
 *  NOT promoted into the slug, deliberately. It is free text the declarant
 *  types — the two examples above alone carry `ОУ' Д-Р ПЕТЪР БЕРОН"` with a
 *  stray apostrophe and unbalanced quotes — so hashing it would fork one person
 *  across their own re-spellings, which is the defect _declarant_guid_aliases
 *  exists to undo. It is evidence for the operator, not an identity key.
 *
 *  Regex rather than a parse: this runs inside a warning path over a handful of
 *  filings, and must not fail on a malformed XML the ingest already tolerated. */
export const workOf = (xml: string): string | null => {
  const m = /<Work>([\s\S]*?)<\/Work>/.exec(xml);
  const work = m?.[1].trim();
  return work ? work.replace(/\s+/g, " ") : null;
};

/** Reads a filing's XML from wherever the caller has it cached. Returning null
 *  (the default) simply omits the employer line from the report. */
export type XmlReader = (sourceUrl: string) => string | null;

/** The person ids claiming one slug, each mapped to a filing the operator can
 *  open. More than one entry IS the collision. */
export const personGuidFilings = (
  filings: Iterable<FilingLike>,
  readXml: XmlReader = () => null,
): Map<string, CollisionFiling> => {
  const out = new Map<string, CollisionFiling>();
  for (const f of filings) {
    const guid = personGuidFromSourceUrl(f.sourceUrl);
    if (!guid || out.has(guid)) continue;
    const xml = readXml(f.sourceUrl);
    out.set(guid, {
      guid,
      year: f.declarationYear,
      sourceUrl: f.sourceUrl,
      work: xml ? workOf(xml) : null,
    });
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
      // The employer, when the XML is cached. Two different employers under one
      // group label is the cheapest proof that these are two people; the same
      // employer means the holdings still have to be compared by hand.
      if (f.work) out.push(`        работи: ${f.work}`);
    }
  }
  return out;
};
