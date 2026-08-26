// A prerendered link must not name a narrower population than the URL it points at.
//
// `/companies?political=1` filters `company_browse_table.is_official_linked` — 188's "linked to a
// person in public LIFE" arm, which is `person_role` at source tr/ngo joined to any ACTIVE public
// figure. Measured 2026-08-26 on the local corpus: the URL returns **17,675** companies, and the
// MP-specific subset is **1,209** — so copy reading „с поне един депутат-собственик или
// ръководител" / "with at least one MP owner or director" overstated it by 14.6x, on a prerendered
// page (i.e. in the HTML a crawler and an LLM read, not merely on screen).
//
// ⚠️ „ЛИЦА НА ПУБЛИЧНА ДЛЪЖНОСТ" IS ALSO WRONG HERE, which is the part that is easy to get half
// right. Election CANDIDATES are the single largest group in that population — 7,301 people
// against 749 MPs — and a candidate who ran and lost holds no office at all. The accurate phrase
// is the one 188's own header uses: a person in public LIFE.
//
// The composition, measured the same day (people, deduped, one person can hold several):
//   candidate 7,301 · local 4,562 · official_exec 2,651 · official_muni 1,642
//   public_sector 1,155 · mp 749 · magistrate 268 · diplomat 25 · mep 9 · ds 5 · regulator 3
//   president 1
//
// WHY A GATE RATHER THAN JUST THE FIX. This is not a typo class — it is the reflex of describing a
// link by the page it sits on. All four occurrences were on MP pages, where „фирмите, свързани с
// депутати" reads perfectly naturally and is false. The next MP page to link this filter will read
// just as naturally.
//
// ⚠️ THE FILTER IS NOT THE FIX. There is no MP-only arm on /companies to point at instead:
// `is_mp_tied` exists on the matview but comes from `contractor_rank` (122), so it covers only
// companies that have WON A CONTRACT — 106 rows, a different question. Narrowing the copy is the
// whole remedy; do not build a filter to justify the old wording.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("./routes.ts", import.meta.url), "utf8").split(
  "\n",
);

/** Phrases that correctly name the WIDE population. One must appear in the same block. */
const WIDE = [/публичния живот/, /public life/i];

/** Words that claim the population is MPs. Allowed only alongside a WIDE phrase — „по-широк от
 *  депутатите" is the honest form and necessarily contains one. */
const MP_ONLY = [/депутат/i, /\bMPs?\b/];

describe("/companies?political=1 links", () => {
  const lines = SRC.map((text, i) => ({ text, line: i + 1 })).filter((l) =>
    l.text.includes("companies?political=1"),
  );

  it("exist — a gate over nothing is not a gate", () => {
    expect(lines.length).toBeGreaterThanOrEqual(4);
  });

  for (const { text, line } of lines) {
    it(`routes.ts:${line} names the population the filter returns`, () => {
      // The whole line is the block: each of these lives on its own `<li>`/`<p>` line.
      const claimsMp = MP_ONLY.some((r) => r.test(text));
      const namesWide = WIDE.some((r) => r.test(text));
      expect(
        namesWide,
        `routes.ts:${line} links ?political=1 (17,675 companies, any person in public life) ` +
          `without saying so. Use „лица в публичния живот" / "people in public life".\n${text}`,
      ).toBe(true);
      // Naming MPs is fine — preferable, even, on an MP page — but only beside the wide phrase,
      // so the reader learns the set is bigger rather than being told it is not.
      if (claimsMp)
        expect(
          namesWide,
          `routes.ts:${line} calls this an MP set. The MP subset is 1,209 of 17,675.\n${text}`,
        ).toBe(true);
    });
  }
});
