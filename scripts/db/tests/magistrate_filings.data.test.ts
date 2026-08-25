// The ИВСС filing history — `magistrate_filing` (070) and the two claims it makes.
//
// WHAT THIS GATE IS FOR. The table lists every declaration the register publishes for a
// magistrate, so a reader can open the originals. Two properties keep that honest and
// neither is constrainable in the schema:
//
//  1. `ord` is newest-first and contiguous from 0. It is a loop counter in the loader, so
//     it is unique by construction — a UNIQUE index on it would enforce nothing, and a PK
//     on (name, ord) would MASK the one corruption that matters (the same document listed
//     twice, which would then render as two identical links).
//  2. The history is a NAME's, not a person's. The register is indexed by name and carries
//     no court, no id, no discriminator at all, so two magistrates who share a name are
//     indistinguishable in it and their filings fold into one list. That is not an edge
//     case — measured 2026-08-24, 956 of 3,594 rostered names (26.6%) carry more than one
//     ANNUAL declaration in a single year, and 256 of those have two filed on the SAME DAY,
//     which one person cannot do. `magistrate.filings_name_ambiguous` marks them, and the
//     point of the gate is that the marker keeps DISCRIMINATING: a regression that sets it
//     everywhere, or nowhere, is as bad as not having it.
//
// Auto-skips when Postgres is down or the table is unloaded, like the other *.data.test.ts
// gates.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";

const reachable = async (): Promise<boolean> => {
  try {
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM magistrate_filing",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / magistrate_filing empty";
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

test("every magistrate with a filing carries the document it was parsed from", async () => {
  if (skip) return;
  // `source_url` is the provenance of the STORED figures. A magistrate with a history but
  // no provenance is one whose numbers a reader cannot check against anything.
  const [r] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM magistrate m
      WHERE EXISTS (SELECT 1 FROM magistrate_filing f WHERE f.magistrate_name = m.name)
        AND m.source_url IS NULL`,
  );
  assert.equal(Number(r.n), 0, "magistrates with filings but no source_url");
});

test("ord is contiguous from 0 and orders the history newest-first", async () => {
  if (skip) return;
  // Contiguity: max(ord) must be count-1 per magistrate, and min(ord) must be 0.
  const [gaps] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM (
       SELECT magistrate_name FROM magistrate_filing
        GROUP BY magistrate_name
       HAVING min(ord) <> 0 OR max(ord) <> count(*) - 1
     ) t`,
  );
  assert.equal(
    Number(gaps.n),
    0,
    "magistrates whose ord is not contiguous from 0",
  );

  // Newest-first: no row may be followed by a STRICTLY NEWER year. Compared on `year`
  // only — two filings of the same year are ordered by the date inside the входящ номер,
  // which is not reliably parseable in SQL and is the writer's job.
  const [unsorted] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM (
       SELECT magistrate_name, year,
              lead(year) OVER (PARTITION BY magistrate_name ORDER BY ord) AS nxt
         FROM magistrate_filing
     ) t WHERE nxt > year`,
  );
  assert.equal(Number(unsorted.n), 0, "filings not ordered newest-year-first");
});

test("no document is listed twice for one magistrate", async () => {
  if (skip) return;
  // The PK enforces this at write time; asserted anyway because the loader DEDUPES before
  // COPY, so a writer regression that started emitting duplicates would be absorbed
  // silently rather than raising. This is the assertion that would notice.
  const [r] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM (
       SELECT magistrate_name, source_url FROM magistrate_filing
        GROUP BY 1, 2 HAVING count(*) > 1
     ) t`,
  );
  assert.equal(Number(r.n), 0, "duplicate (magistrate, source_url) rows");
});

test("every filing URL points at the ИВСС register and is well-formed", async () => {
  if (skip) return;
  // The register is plain HTTP on a bare IP (scripts/judiciary/sources.ts). Links must
  // point at IT and nowhere else — a URL built from anything the register NAMES would be
  // an open redirect off a page about a named judge.
  const [off] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM magistrate_filing
      WHERE source_url NOT LIKE 'http://62.176.124.194/%'`,
  );
  assert.equal(Number(off.n), 0, "filing URLs outside the ИВСС register");

  // Three register paths carry a TAB, an NBSP and an apostrophe; concatenated rather than
  // built with `new URL` they ship as hrefs no browser resolves.
  const [bad] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM magistrate_filing
      WHERE source_url ~ '[[:space:]]'`,
  );
  assert.equal(Number(bad.n), 0, "filing URLs containing whitespace");
});

test("the namesake marker still discriminates, in both directions", async () => {
  if (skip) return;
  const [r] = await allRows<{
    total: string;
    flagged: string;
    two_annuals: string;
    flagged_wrong: string;
  }>(
    // Re-derives the stored rule from magistrate_filing rather than trusting the column:
    // two annuals filed on the SAME DAY, or four or more in one year. Deliberately NOT
    // „>1 in a year" — the `annual` directory also holds встъпване/напускане filings, so
    // that would flag every magistrate who changed post (956 vs 262).
    `WITH ann AS (
       SELECT magistrate_name, year,
              substring(ref from '(\\d{2}\\.\\d{2}\\.\\d{4})') AS filed_on
         FROM magistrate_filing WHERE register_dir = 'annual'),
     per AS (
       SELECT magistrate_name,
              max(same_day) AS max_same_day,
              max(in_year)  AS max_in_year
         FROM (SELECT magistrate_name,
                      count(*) FILTER (WHERE filed_on IS NOT NULL)
                        OVER (PARTITION BY magistrate_name, filed_on) AS same_day,
                      count(*) OVER (PARTITION BY magistrate_name, year) AS in_year
                 FROM ann) w
        GROUP BY 1),
     derived AS (
       SELECT magistrate_name, (max_same_day > 1 OR max_in_year >= 4) AS want FROM per)
     SELECT (SELECT count(*) FROM magistrate)::text AS total,
            (SELECT count(*) FROM magistrate
              WHERE filings_name_ambiguous)::text AS flagged,
            (SELECT count(*) FROM derived WHERE want)::text AS two_annuals,
            (SELECT count(*) FROM magistrate m JOIN derived d
                    ON d.magistrate_name = m.name
              WHERE m.filings_name_ambiguous <> d.want)::text AS flagged_wrong`,
  );
  const total = Number(r.total);
  const flagged = Number(r.flagged);

  // The marker must be exactly the stored rule, re-derived here from the filings rather
  // than trusted: a flag computed once in the writer and never checked is a flag that can
  // silently stop matching what it claims.
  assert.equal(
    Number(r.flagged_wrong),
    0,
    "filings_name_ambiguous disagrees with the >1-annual-in-a-year rule",
  );

  // …and it must still SPLIT the corpus. Both ends are failures: 0 flagged means the rule
  // stopped firing (and 26.6% of histories are silently published as one person's), while
  // flagging everyone means it stopped distinguishing and the caveat becomes noise.
  assert.ok(
    flagged > 0,
    "no magistrate flagged as a shared name — the rule has stopped firing",
  );
  assert.ok(
    flagged < total * 0.6,
    `${flagged}/${total} flagged — the marker has stopped discriminating`,
  );
  assert.equal(
    flagged,
    Number(r.two_annuals),
    "flagged count disagrees with the count derivable from magistrate_filing",
  );
});

test("the history is not a claim to have READ the filings", async () => {
  if (skip) return;
  // Exactly ONE filing per magistrate is parsed; the rest are links. If those two ever
  // converge the pipeline has started claiming ~10x the coverage it has. The assertion is
  // that `source_url` matches AT MOST one row of the magistrate's own history.
  const [r] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM (
       SELECT m.name FROM magistrate m
         JOIN magistrate_filing f
           ON f.magistrate_name = m.name AND f.source_url = m.source_url
        GROUP BY m.name HAVING count(*) > 1
     ) t`,
  );
  assert.equal(
    Number(r.n),
    0,
    "a magistrate's source_url matches several filings",
  );
});
