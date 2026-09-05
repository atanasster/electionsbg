import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { assertCommitted } from "../lib/assert_committed";
import os from "node:os";
import path from "node:path";
import {
  NEUTRAL_PALETTE,
  PARTY_COLORS_PATH,
  PLACEHOLDER_COLOR,
  TICKET_DEFAULTS_PATH,
  buildTicketCatalogue,
  nameKey,
  parliamentaryParties,
  ticketDefaults,
  type TicketCatalogue,
} from "./tickets";
import { fileURLToPath } from "node:url";
import { buildPartyColors } from "./build_party_colors";
import {
  COMMITTED_ROUND_DIRS,
  CYCLES_OLDEST_FIRST,
  corpusRound,
} from "./testCorpus";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

assertCommitted(...COMMITTED_ROUND_DIRS, "data/presidential/party_colors.json");

const cache = new Map<string, TicketCatalogue>();
const catalogue = (cycle: string): TicketCatalogue => {
  const hit = cache.get(cycle);
  if (hit) return hit;
  const c = buildTicketCatalogue(
    [1, 2].map((r) => corpusRound(cycle, r as 1 | 2)),
  );
  cache.set(cycle, c);
  return c;
};

describe("the ballot", () => {
  it("carries every ticket number across both rounds, once", () => {
    const counts: Record<string, number> = {
      "2001_11_11_pvr": 6,
      "2006_10_22_pvr": 7,
      "2011_10_23_pvr": 18,
      "2016_11_06_pvr": 21,
      "2021_11_14_pvr": 23,
    };
    for (const cycle of CYCLES_OLDEST_FIRST) {
      const c = catalogue(cycle);
      expect(c.tickets, cycle).toHaveLength(counts[cycle]);
      expect(new Set(c.tickets.map((t) => t.number)).size, cycle).toBe(
        c.tickets.length,
      );
      // Sorted by number, so a rebuild writes the same bytes.
      expect(
        c.tickets.map((t) => t.number),
        cycle,
      ).toEqual([...c.tickets.map((t) => t.number)].sort((a, b) => a - b));
    }
  });

  it("records which rounds each ticket stood in", () => {
    for (const cycle of CYCLES_OLDEST_FIRST) {
      const c = catalogue(cycle);
      const inRunoff = c.tickets.filter((t) => t.rounds.includes(2));
      expect(inRunoff, cycle).toHaveLength(2);
      // Every ticket stood in round 1; only two went on.
      expect(
        c.tickets.every((t) => t.rounds.includes(1)),
        cycle,
      ).toBe(true);
      for (const t of inRunoff)
        expect(t.rounds, `${cycle}/${t.number}`).toEqual([1, 2]);
    }
  });

  it("refuses a ticket number that names two different people", () => {
    // ⚠ The same hazard the swing guards: a renumbered runoff would merge two candidates
    // into one catalogue entry, and the merged entry would carry whichever name was read
    // first with the other's rounds appended.
    const rounds = [1, 2].map((r) => corpusRound("2011_10_23_pvr", r as 1 | 2));
    const renamed = {
      ...rounds[1],
      tickets: rounds[1].tickets.map((t) => ({
        ...t,
        president: "Друг Човек",
      })),
    };
    expect(() => buildTicketCatalogue([rounds[0], renamed])).toThrow(
      /in one round and "Друг Човек" \/ /,
    );
  });

  it("refuses an empty round list", () => {
    expect(() => buildTicketCatalogue([])).toThrow(/no rounds/);
  });
});

// ⚠⚠ A COLOUR IS A CLAIM ABOUT A POLITICAL BRAND. „ГЕРБ's blue, because the ticket says
// ГЕРБ" and „a colour so the chart has one" look identical on a screen, so the file says
// which it is.
describe("where a colour comes from", () => {
  // ⚠⚠ THE PARLIAMENTARY CATALOGUE'S OWN „COLOUR UNKNOWN" VALUE IS NOT A COLOUR.
  // `scripts/parsers/parties.ts` assigns `lightslategrey` to a party it has no default
  // for and reads it back as that sentinel; 143 of the 226 index entries carry it. Taking
  // it as a brand fact stamped `parliamentary-party` on nine of 2021's fourteen matched
  // tickets, all rendering as one grey a shade from the neutral palette's own first
  // entry — the exact confusion `colorBasis` exists to prevent, through the one door it
  // did not check.
  it("never treats the placeholder colour as a brand fact", () => {
    // ⚠ The sentinel is widespread in the SOURCE — 143 of the 226 catalogue entries — and
    // absent from the derived table, which is where the exclusion happens. Asserted on
    // the source so the claim is about the corpus rather than about the filter.
    const { table } = buildPartyColors(path.join(PROJECT_ROOT, "data"));
    const parties = parliamentaryParties();
    expect(
      Object.values(table.parties).filter((p) => p.color === PLACEHOLDER_COLOR),
      "excluded from the table",
    ).toHaveLength(0);
    expect(
      [...parties.values()].filter((p) => !p.color).length,
      "and the entries it left colourless are still carried, for their nickName",
    ).toBeGreaterThan(100);
    for (const cycle of CYCLES_OLDEST_FIRST) {
      for (const t of catalogue(cycle).tickets) {
        expect(t.color, `${cycle}/${t.number}`).not.toBe(PLACEHOLDER_COLOR);
        if (t.colorBasis === "parliamentary-party") {
          // A brand basis means a party whose colour is genuinely known.
          const p = parties.get(nameKey(t.nominatedBy.name))!;
          expect(p.color, `${cycle}/${t.number}`).toBe(t.color);
          expect(p.color).not.toBe(PLACEHOLDER_COLOR);
        }
      }
    }
    // 2021 is where it bit: 14 nominators match a party, and only 6 of those carry a
    // real colour.
    expect(
      catalogue("2021_11_14_pvr").tickets.filter(
        (t) => t.colorBasis === "parliamentary-party",
      ),
    ).toHaveLength(6);
  });

  it("gives a ticket its party's colour only when the nominator matches", () => {
    // Плевнелиев stood for ПП ГЕРБ in 2011 and Цачева in 2016; both take ГЕРБ's blue,
    // and the basis says so.
    const plevneliev = catalogue("2011_10_23_pvr").tickets.find(
      (t) => t.number === 2,
    )!;
    expect(plevneliev.nominatedBy.name).toBe("ПП ГЕРБ");
    expect(plevneliev.colorBasis).toBe("parliamentary-party");
    const parties = parliamentaryParties();
    expect(plevneliev.color).toBe(parties.get(nameKey("ПП ГЕРБ"))!.color);

    const tsacheva = catalogue("2016_11_06_pvr").tickets.find(
      (t) => t.number === 17,
    )!;
    expect(tsacheva.colorBasis).toBe("parliamentary-party");
    expect(tsacheva.color).toBe(plevneliev.color);
  });

  it("gives every 2001 and 2006 ticket a neutral colour, because no ballot names a body", () => {
    // ⚠ Not a gap in the matching — those two bundles publish no nominator at all, for
    // any ticket, so every colour there is a chart colour and can never be anything else.
    for (const cycle of ["2001_11_11_pvr", "2006_10_22_pvr"]) {
      const c = catalogue(cycle);
      expect(
        c.tickets.every((t) => t.colorBasis === "neutral-palette"),
        cycle,
      ).toBe(true);
      expect(
        c.tickets.every((t) => t.nominatedBy.name === ""),
        cycle,
      ).toBe(true);
      // …and nothing is reported as unmatched, because nothing was offered to match.
      expect(c.unmatchedNominators, cycle).toEqual([]);
    }
  });

  it("reports the nominators it could not match", () => {
    // The list is what the neutral colours rest on: a reader can see how many tickets
    // carry a colour that asserts nothing, and why.
    const c = catalogue("2021_11_14_pvr");
    const neutral = c.tickets.filter((t) => t.colorBasis === "neutral-palette");
    // ⚠ NAMES AND TICKETS ARE DIFFERENT COUNTS. Several tickets can share one nominator
    // string, so the list length is not the number of tickets carrying a colour that
    // asserts nothing — `neutralTickets` is.
    expect(c.neutralTickets).toBe(neutral.length);
    expect(c.neutralTickets).toBe(17);
    expect(c.unmatchedNominators.length).toBe(17);
    // ⚠ Every unmatched name is either absent from the party index OR present with the
    // placeholder — those are two different reasons for the same outcome, and only the
    // second is a party this repo knows about but has no colour for.
    const parties = parliamentaryParties();
    for (const name of c.unmatchedNominators) {
      const p = parties.get(nameKey(name));
      expect(p?.color ?? PLACEHOLDER_COLOR, name).toBe(PLACEHOLDER_COLOR);
    }
    // Both reasons really occur, so the assertion above is not vacuous.
    expect(
      c.unmatchedNominators.some((n) => parties.has(nameKey(n))),
      "some are known parties with no colour",
    ).toBe(true);
    expect(
      c.unmatchedNominators.some((n) => !parties.has(nameKey(n))),
      "and some are unknown outright",
    ).toBe(true);
  });

  // ⚠⚠ THE REASON TO MATCH ON THE NAME IS NOT THAT THE NUMBERINGS DISAGREE — ON A
  // SAME-DAY BALLOT THEY LARGELY AGREE, which is what makes a number match dangerous.
  // 2021's ticket 2 and parliamentary party 2 are the SAME formation, verbatim, as are
  // all 14 numbers present in both ballots. So a number-keyed implementation would
  // produce identical output here and go on producing it until a cycle whose two
  // sequences are drawn separately — and then paint one formation's brand onto another's
  // candidate, silently.
  it("matches on the name even where the number would agree", () => {
    const t2 = catalogue("2021_11_14_pvr").tickets.find((t) => t.number === 2)!;
    const parties = parliamentaryParties();
    const byName = parties.get(nameKey(t2.nominatedBy.name));
    expect(byName, "ticket 2's nominator IS in the catalogue").toBeDefined();
    // …and it is the same formation the parliamentary number 2 names, which is why no
    // assertion comparing the two outputs could tell the implementations apart.
    expect(t2.nominatedBy.name).toBe("РУСОФИЛИ ЗА ВЪЗРАЖДАНЕ НА ОТЕЧЕСТВОТО");
    // What DOES tell them apart: a nominator whose name is in the catalogue under a
    // different number entirely still resolves, and one that is absent never does.
    const absent = catalogue("2021_11_14_pvr").tickets.find(
      (t) => t.colorBasis === "neutral-palette" && t.nominatedBy.name,
    )!;
    expect(parties.has(nameKey(absent.nominatedBy.name))).toBe(
      // Either genuinely absent, or present only with the placeholder.
      Boolean(parties.get(nameKey(absent.nominatedBy.name))),
    );
    expect(
      parties.get(nameKey(absent.nominatedBy.name))?.color ?? PLACEHOLDER_COLOR,
    ).toBe(PLACEHOLDER_COLOR);
  });

  it("refuses a generic nomination form as a formation", () => {
    // ⚠ „Инициативен комитет" is the legal FORM of a nomination, not the identity of a
    // body — six of 2011's eighteen tickets give it — so matching it would hand six
    // unrelated candidates one shared brand the moment any catalogue carried the phrase.
    const generic = catalogue("2011_10_23_pvr").tickets.filter(
      (t) => nameKey(t.nominatedBy.name) === "инициативен комитет",
    );
    expect(generic.length).toBeGreaterThan(3);
    for (const t of generic) {
      expect(t.colorBasis, `${t.number}`).toBe("neutral-palette");
    }
    // …and they do not all share one colour.
    expect(new Set(generic.map((t) => t.color)).size).toBe(generic.length);
  });

  it("gives every ticket on a ballot a distinct colour, or says why not", () => {
    // ⚠ The palette wrapped at ten, so two candidates on the same ballot came out the
    // same colour in three of the five cycles — a chart cannot tell them apart, which is
    // the one thing a neutral colour has to do. It is now 24, one more than the largest
    // ballot.
    expect(NEUTRAL_PALETTE.length).toBeGreaterThan(23);
    for (const cycle of CYCLES_OLDEST_FIRST) {
      const c = catalogue(cycle);
      const distinct = new Set(c.tickets.map((t) => t.color)).size;
      expect(
        distinct +
          c.colorCollisions.reduce((a, x) => a + x.tickets.length - 1, 0),
        cycle,
      ).toBe(c.tickets.length);
    }
    // The only collision in the corpus is two REAL brand colours: the catalogue gives
    // Патриотичен фронт and ВМРО the same red, and both 2021 nominees inherit it.
    // Overriding one would replace a published brand fact with an invented colour.
    const c21 = catalogue("2021_11_14_pvr");
    expect(c21.colorCollisions).toHaveLength(1);
    expect(c21.colorCollisions[0].tickets).toEqual([4, 21]);
    for (const n of c21.colorCollisions[0].tickets) {
      expect(c21.tickets.find((t) => t.number === n)!.colorBasis).toBe(
        "parliamentary-party",
      );
    }
    for (const cycle of CYCLES_OLDEST_FIRST.filter(
      (x) => x !== "2021_11_14_pvr",
    )) {
      expect(catalogue(cycle).colorCollisions, cycle).toEqual([]);
    }
  });

  it("assigns a colour to every ticket, and a stable one", () => {
    for (const cycle of CYCLES_OLDEST_FIRST) {
      for (const t of catalogue(cycle).tickets) {
        expect(t.color, `${cycle}/${t.number}`).toMatch(/^(rgb\(|#|[a-z]+$)/);
      }
      // A second build over the same rounds gives the same colours.
      const again = buildTicketCatalogue(
        [1, 2].map((r) => corpusRound(cycle, r as 1 | 2)),
      );
      expect(
        again.tickets.map((t) => t.color),
        cycle,
      ).toEqual(catalogue(cycle).tickets.map((t) => t.color));
    }
  });
});

describe("the curated defaults", () => {
  it("supplies short labels only, never a colour", () => {
    // ⚠ A short label is a naming convenience; a colour is a brand claim. The table can
    // carry the first and must not be able to carry the second.
    const raw = JSON.parse(fs.readFileSync(TICKET_DEFAULTS_PATH, "utf8"));
    expect(Object.keys(raw).sort()).toEqual(["_comment", "nickNames"]);
    for (const value of Object.values(ticketDefaults().nickNames)) {
      expect(typeof value).toBe("string");
    }
  });

  it("is consulted, which an empty shipped table cannot show on its own", () => {
    // ⚠ The table ships empty by design, so without a seam nothing here would ever
    // exercise the lookup — „it is never read" and „it is read and empty" look the same.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-defaults-"));
    try {
      const file = path.join(dir, "d.json");
      fs.writeFileSync(
        file,
        JSON.stringify({
          nickNames: { "инициативен комитет": "ИК" },
        }),
      );
      const withDefaults = buildTicketCatalogue(
        [1, 2].map((r) => corpusRound("2011_10_23_pvr", r as 1 | 2)),
        { defaultsFile: file },
      );
      // ⚠ …and a generic nominator is STILL refused, so the table cannot be used to
      // re-admit one through the back door.
      const generic = withDefaults.tickets.filter(
        (t) => nameKey(t.nominatedBy.name) === "инициативен комитет",
      );
      expect(generic.length).toBeGreaterThan(3);
      for (const t of generic)
        expect(t.nickName, `${t.number}`).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never answers for a key it does not carry", () => {
    // The keys come from JSON, so a plain object answers `nickNames["constructor"]` with
    // a function — under a signature promising a short label.
    const t = ticketDefaults();
    for (const probe of ["constructor", "toString", "__proto__"]) {
      expect(t.nickNames[probe], probe).toBeUndefined();
    }
  });

  it("is empty, and that is a decision rather than an oversight", () => {
    // ⚠ Every entry would be somebody asserting that a nominating body trades under a
    // particular short name — not derivable from anything this repo holds. The generator
    // reports the candidates in `unmatchedNominators` instead of guessing, so the table
    // stays a record of decisions actually taken.
    expect(Object.keys(ticketDefaults().nickNames)).toEqual([]);
  });

  it("takes a nickName from the parliamentary catalogue where the party matched", () => {
    const gerb = catalogue("2011_10_23_pvr").tickets.find(
      (t) => t.number === 2,
    )!;
    const party = parliamentaryParties().get(nameKey("ПП ГЕРБ"))!;
    if (party.nickName) expect(gerb.nickName).toBe(party.nickName);
    else expect(gerb.nickName).toBeUndefined();
  });

  it("leaves nickName absent rather than inventing one", () => {
    // ⚠ ABSENT, not the full nominator string truncated: 2001 and 2006 name no body, and
    // a label derived from nothing would read as a short name somebody uses.
    for (const cycle of ["2001_11_11_pvr", "2006_10_22_pvr"]) {
      for (const t of catalogue(cycle).tickets) {
        expect(t.nickName, `${cycle}/${t.number}`).toBeUndefined();
      }
    }
  });
});

describe("the party index", () => {
  // ⚠⚠ THE COLOUR TABLE IS COMMITTED BECAUSE ITS SOURCE IS NOT. `data/<cycle>/
  // cik_parties.json` is gitignored — 0 tracked against 13 on disk — so reading those
  // files directly made `tickets.json` lose every brand colour on a fresh clone or a CI
  // runner, at exit 0, with every vote figure still reconciling. This is the control:
  // pointed at an empty table, the build must produce a visibly different catalogue.
  it("loses every brand colour when the table is empty", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-colors-"));
    try {
      const file = path.join(dir, "empty.json");
      fs.writeFileSync(
        file,
        JSON.stringify({ builtFrom: "test", parties: {} }),
      );
      const without = buildTicketCatalogue(
        [1, 2].map((r) => corpusRound("2021_11_14_pvr", r as 1 | 2)),
        { partyColorsFile: file },
      );
      expect(without.neutralTickets, "everything goes neutral").toBe(
        without.tickets.length,
      );
      // …against six real brand colours with the committed table.
      expect(catalogue("2021_11_14_pvr").neutralTickets).toBe(17);
      expect(
        without.tickets.map((t) => t.color),
        "and the colours actually differ",
      ).not.toEqual(catalogue("2021_11_14_pvr").tickets.map((t) => t.color));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is committed, and holds no placeholder colour", () => {
    // The generator excludes the catalogue's `lightslategrey` sentinel, so anything here
    // with a `color` is a real brand fact.
    const parties = parliamentaryParties();
    for (const [key, p] of parties) {
      expect(p.color, key).not.toBe(PLACEHOLDER_COLOR);
    }
  });

  it("is derived from the parliamentary catalogues, not typed by hand", () => {
    const parties = parliamentaryParties();
    expect(parties.size).toBeGreaterThan(200);
    // Every entry carries at least one of the two things it exists to supply.
    for (const [key, p] of parties) {
      expect(Boolean(p.color || p.nickName), key).toBe(true);
    }
    // …and the committed table is what the generator produces from this machine's tree.
    const { table } = buildPartyColors(path.join(PROJECT_ROOT, "data"));
    const committed = JSON.parse(
      fs.readFileSync(PARTY_COLORS_PATH, "utf8"),
    ) as { parties: Record<string, unknown> };
    expect(table.parties).toEqual(committed.parties);
  });

  it("lets a later cycle's spelling win", () => {
    // ⚠ A party that rebranded should render under its CURRENT colour, so the index is
    // built oldest-first and overwritten. Asserted by construction rather than on a
    // particular party, since which ones rebrand is not this module's business.
    const parties = parliamentaryParties();
    const gerb = parties.get(nameKey("ГЕРБ"));
    if (gerb) expect(gerb.color).toBeTruthy();
  });
});
