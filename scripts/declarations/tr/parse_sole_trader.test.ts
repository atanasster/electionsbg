// PhysicalPersonTrader — the ЕТ's owner, and the one person section the daily-feed
// allowlist did not carry.
//
// `PERSON_SECTION_TO_ROLE` is an ALLOWLIST, not a generic sweep over SubDeed keys, so an
// unmapped person section is not mis-parsed — it is silently dropped, which is why this
// survived: every ЕТ row in `tr_person_roles` simply had no person, indistinguishable
// from the ordinary pre-2021 genesis gap the CR Deeds capture exists for. Measured over
// all 1,686 daily files on 2026-08-26: 30,252 distinct ЕТ, of which 8,000 carry a
// `PhysicalPersonTrader` record already on disk, against 30,052 ЕТ rows in Postgres with
// no person at all.
//
// The fixture is a REAL filing (ЕТ „Катя Бентли-студио", 2026-06-26), reduced to one Deed
// and scrubbed three ways: `Indent`/`IndentType` (a salted hash of the person's EGN —
// repo policy treats it exactly as the EGN, so it is never committed either), `Contacts`,
// and the street-level half of the address. The last two are not policy but prudence: an
// ЕТ's седалище is a natural person's home, and no assertion here reads either.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTrDailyFiling } from "./parse_daily_filing";
import { replayEvents } from "./state_replay";
import type { TrChangeEvent, TrPersonAddedEvent } from "./types";

const fixturePath = (name: string) =>
  join(__dirname, "__fixtures__", `${name}.json`);
const load = (name: string) =>
  JSON.parse(readFileSync(fixturePath(name), "utf-8"));

const fixture = load("sole_trader_2026-06-26");
// The ONE PhysicalPersonTrader/Erase group in the whole corpus (ЕТ „СОТИР МАРКОВ",
// 2021-06-16) — see the Erase test below for why one occurrence is enough.
const eraseFixture = load("sole_trader_erase_2021-06-16");
// A WRAPPED section — Managers → Manager[] → Person — i.e. the shape the flat `Person`
// record key must never absorb a second time.
const wrappedFixture = load("wrapped_manager");

const added = (evs: TrChangeEvent[]): TrPersonAddedEvent[] =>
  evs.filter((e): e is TrPersonAddedEvent => e.kind === "person_added");

describe("parseTrDailyFiling — PhysicalPersonTrader", () => {
  const events = parseTrDailyFiling(fixture);

  it("emits the trader as a person on the ЕТ", () => {
    const people = added(events);
    expect(people).toHaveLength(1);
    expect(people[0].personName).toBe("КАТЯ ХРИСТОВА БЕНТЛИ");
    expect(people[0].uic).toBe("201581603");
  });

  it("labels them `sole_trader`, never `sole_owner`", () => {
    // Not a cosmetic distinction. `sole_owner` is едноличен собственик НА КАПИТАЛА —
    // a share of a capital an ЕТ does not have — and it is the one role
    // `tr_owner_share` grants a bare 100% to when it stands alone. Reusing it here
    // would publish a capital share for a firm that has filed none.
    expect(added(events)[0].role).toBe("sole_trader");
  });

  it("carries the registration date and the person's jurisdiction", () => {
    const p = added(events)[0];
    expect(p.filingDate.slice(0, 10)).toBe("2026-06-26");
    expect(p.country).toBe("БЪЛГАРИЯ");
  });

  it("declares no capital share for the trader", () => {
    // An ЕТ files no дял. A zero would read as „owns nothing"; NULL is the only
    // honest answer, and it is what keeps the row out of any share arithmetic.
    const p = added(events)[0];
    expect(p.shareAmount).toBeNull();
    expect(p.shareCurrency).toBeNull();
  });

  it("takes its record id from the GROUP, the trader carrying none of its own", () => {
    // Measured over all 1,686 daily files: 0 of 8,043 PhysicalPersonTrader `Person` nodes
    // carry a per-record RecordID, so the `|| groupAttrs?.RecordID` fallback is what makes
    // the whole section land — not a defensive default. Without it every one of the ~8,000
    // traders is dropped by the `if (!recordId) continue` guard.
    const p = added(events)[0];
    expect(p.recordId).toBe("204247150"); // the group's, not the person's
    expect(p.groupId).toBe("49839259");
    expect(p.positionLabel).toBeNull(); // the source carries Position: ""
  });

  it("does not carry an EGN hash anywhere in its output", () => {
    // Policy guard, asserted on the parser rather than trusted — the same one
    // parse_share_transfer.test.ts holds for the ShareTransfers node.
    expect(JSON.stringify(events)).not.toContain("Indent");
  });

  it("keeps the committed fixtures free of the EGN hash", () => {
    // The parser never READS `Indent`, so the output-side guard above would pass even
    // against a fixture that leaked the hash. This is the check that survives a fixture
    // refresh — it reads the committed bytes, which is where the policy actually binds.
    for (const name of [
      "sole_trader_2026-06-26",
      "sole_trader_erase_2021-06-16",
      "wrapped_manager",
    ]) {
      expect(readFileSync(fixturePath(name), "utf-8")).not.toMatch(/Indent/);
    }
  });

  it("survives the replay into company_persons", () => {
    // The parser emitting the event is only half of it: the row has to reach the state
    // the SQLite writer persists, or `tr_person_roles` stays empty and nothing on
    // /company changes. The replay is generic over role, so this is a regression guard
    // against a future role-filter, not a second implementation.
    const company = replayEvents(events).get("201581603");
    const people = [...(company?.persons.values() ?? [])];
    expect(people).toHaveLength(1);
    expect(people[0].role).toBe("sole_trader");
    expect(people[0].name).toBe("КАТЯ ХРИСТОВА БЕНТЛИ");
    expect(people[0].erasedAt).toBeNull();
  });

  it("erases the trader section on an Erase filing, stamping rather than deleting", () => {
    // Mapping the section enabled the ERASE path as well as the Add path. Exactly ONE such
    // group exists in the corpus (20210616.json, ЕТ „СОТИР МАРКОВ", FieldIdent 00180) — and
    // that rarity is the argument FOR the test, not against it: a regression here would
    // never be noticed. Note the Erase group carries a Person node with a name, which the
    // parser must ignore: an Erase is section-level, so treating its record as an Add would
    // RESURRECT the trader it exists to retire.
    const erased = parseTrDailyFiling(eraseFixture);
    expect(erased).toContainEqual(
      expect.objectContaining({
        kind: "person_section_erased",
        fieldIdent: "00180",
      }),
    );
    expect(added(erased)).toHaveLength(0);

    // Stamp, never delete — the historical link has to survive the ЕТ's закриване, or a
    // person who ran a firm for twenty years vanishes from it the day it closes. The prior
    // state is built explicitly because the Add and Erase filings name different companies.
    const prior = replayEvents([
      {
        kind: "person_added",
        uic: "101527775",
        companyName: "СОТИР МАРКОВ",
        role: "sole_trader",
        personName: "СОТИР ПЕТРОВ МАРКОВ",
        positionLabel: null,
        country: "БЪЛГАРИЯ",
        shareAmount: null,
        shareCurrency: null,
        filingDate: "2021-01-04T00:00:00",
        recordId: "17487912",
        groupId: "33572711",
        fieldIdent: "00180",
      },
    ]);
    const after = replayEvents(erased, prior).get("101527775");
    const trader = [...(after?.persons.values() ?? [])];
    expect(trader).toHaveLength(1);
    expect(trader[0].name).toBe("СОТИР ПЕТРОВ МАРКОВ");
    expect(trader[0].erasedAt).not.toBeNull();
  });

  it("still parses a wrapped section normally", () => {
    // A real Managers group — Manager[] → Person — one manager in, one out. This is the
    // baseline the scoping must not disturb; it is NOT the guard (see the next test).
    const managers = parseTrDailyFiling(wrappedFixture).filter(
      (e) => e.kind === "person_added" && e.role === "manager",
    );
    expect(managers).toHaveLength(1);
  });

  it("counts only the OUTER record when a wrapped section also carries a group-level Person", () => {
    // ⚠️ THE GROUP BELOW IS SYNTHETIC ON PURPOSE, and that is the whole point of the test.
    // No such group exists in today's feed — measured, 0 of 1,686 files — so a test built
    // from real data cannot discriminate here: it passes identically whether `Person` is
    // scoped to `sole_trader` or sitting in the global PERSON_RECORD_KEYS. Verified by
    // mutation: with the scoping removed, the real-fixture test above still passes and this
    // one goes to 2.
    //
    // What it defends is the future TR flattens another section, or adds a group-level
    // Person beside an existing wrapper. Un-scoped, that emits TWO `person_added` events
    // for one human — and they do not collapse in the replay either, because the wrapper
    // record carries its own RecordID while the flat one falls back to the group's, so the
    // `${recordId}|${fieldIdent}` keys differ and both survive as officer rows. Scoped, the
    // extra node is ignored, which is the fail-closed direction.
    const hazard = {
      Message: [
        {
          Body: [
            {
              Deeds: [
                {
                  Deed: [
                    {
                      $: {
                        UIC: "999999999",
                        CompanyName: "ТЕСТ",
                        LegalForm: "EOOD",
                      },
                      SubDeed: [
                        {
                          Managers: [
                            {
                              $: {
                                FieldOperation: "Add",
                                FieldIdent: "00070",
                                RecordID: "g1",
                                GroupID: "g1",
                                FieldActionDate: "2026-01-01T00:00:00",
                              },
                              // The wrapper record — the only one that may be counted.
                              Manager: [
                                {
                                  $: { RecordID: "r1" },
                                  Person: [
                                    { Name: [{ _: "ИВАН ИВАНОВ ИВАНОВ" }] },
                                  ],
                                },
                              ],
                              // …and the same human hanging off the GROUP as well.
                              Person: [{ Name: [{ _: "ИВАН ИВАНОВ ИВАНОВ" }] }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const managers = added(parseTrDailyFiling(hazard)).filter(
      (e) => e.role === "manager",
    );
    expect(managers).toHaveLength(1);
    expect(managers[0].recordId).toBe("r1"); // the wrapper's, not the group's
  });
});
