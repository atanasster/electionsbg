// ShareTransfers — the one node in the TR daily feed that names somebody LEAVING a company.
//
// The fixture is a REAL filing (АЙВИ АРХ ЕООД, 2022-09-27), reduced to one Deed and scrubbed
// of every `Indent` element: that field is a salted hash of the person's EGN, and the repo's
// standing policy treats it exactly as the EGN — never extracted, never stored, and so never
// committed to a fixture either.
//
// It is the case that motivated the parser (docs/plans/person-enrichment-v1.md): the
// transferor's stake was entered in 2019, before the 2021-01-01 feed window, so the replay
// never saw them arrive and an `Erase` had nothing to retire. Without this node they are
// absent from company_persons entirely while the filing that ended their stake sits on disk.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTrDailyFiling } from "./parse_daily_filing";
import { replayEvents } from "./state_replay";
import type { TrChangeEvent, TrShareTransferEvent } from "./types";

const fixture = JSON.parse(
  readFileSync(
    join(__dirname, "__fixtures__", "share_transfer_2022-09-27.json"),
    "utf-8",
  ),
);

const transfers = (evs: TrChangeEvent[]): TrShareTransferEvent[] =>
  evs.filter((e): e is TrShareTransferEvent => e.kind === "share_transferred");

describe("parseTrDailyFiling — ShareTransfers", () => {
  const events = parseTrDailyFiling(fixture);

  it("emits one exit event naming the transferor", () => {
    const t = transfers(events);
    expect(t).toHaveLength(1);
    expect(t[0].oldOwnerName).toBe("Иван Георгиев Такучев");
    expect(t[0].newOwnerName).toBe("Георги Иванов Такучев");
    expect(t[0].uic).toBe("205945260");
  });

  it("labels the transferor with the GENERIC shareholder role, never sole_owner", () => {
    // The node states no role and the seller's prior stake is not recoverable from it.
    // Inferring sole_owner from the BUYER ending up sole owner asserted 100% ownership for
    // ordinary ООД buy-outs where the seller held half — 34.2% of such labels, measured.
    // `partner` under-specifies a real ЕООД seller instead, which invents nothing.
    expect(transfers(events)[0].role).toBe("partner");
  });

  it("carries the registration date and the share amount", () => {
    const t = transfers(events)[0];
    expect(t.filingDate.slice(0, 10)).toBe("2022-09-27");
    expect(t.shareAmount).toBe(50);
  });

  it("does not carry an EGN hash anywhere in its output", () => {
    // Policy guard, asserted on the parser rather than trusted: `Indent` must not reach an
    // event, SQLite, or any /public output.
    expect(JSON.stringify(events)).not.toContain("Indent");
  });

  it("keeps the committed FIXTURE free of EGN hashes too", () => {
    // Asserted on the bytes, not on parser output, because those are different guarantees:
    // every real Subject in the feed carries an `Indent` (2,647/2,647 sampled), so this
    // fixture is clean only because it was scrubbed by hand. A future fixture added without
    // scrubbing would commit salted EGN hashes to the repo and the parser assertion above
    // would still pass.
    const raw = readFileSync(
      join(__dirname, "__fixtures__", "share_transfer_2022-09-27.json"),
      "utf-8",
    );
    expect(raw).not.toContain('"Indent"');
  });

  it("still parses the filing's ordinary person sections", () => {
    // The new branch is additive — it must not shadow the sibling sections in the SubDeed.
    const added = events.filter((e) => e.kind === "person_added");
    expect(added.length).toBeGreaterThan(0);
  });
});

describe("replayEvents — a transfer of a stake we never saw arrive", () => {
  it("recovers the transferor as an exited shareholder", () => {
    const state = replayEvents(parseTrDailyFiling(fixture));
    const c = state.get("205945260")!;
    const person = [...c.persons.values()].find(
      (p) => p.nameNormalized === "ИВАН ГЕОРГИЕВ ТАКУЧЕВ",
    );
    expect(person).toBeDefined();
    expect(person!.role).toBe("partner");
    // The exit is observed; the ENTRY is not. A NULL start is what carries that, and it is
    // what stops a consumer drawing a period: PersonTimelineTile drops rows with no
    // added_at rather than rendering a zero-length bar.
    expect(person!.erasedAt?.slice(0, 10)).toBe("2022-09-27");
    expect(person!.addedAt).toBeNull();
  });

  it("stamps an EXISTING active record instead of minting a duplicate", () => {
    // When the feed DID see the shareholder arrive, the transfer is just their exit. A
    // second row would double-count them in every "companies where X held a role" lookup.
    const seen: TrChangeEvent[] = [
      {
        kind: "person_added",
        uic: "205945260",
        companyName: "АЙВИ АРХ",
        role: "sole_owner",
        personName: "Иван Георгиев Такучев",
        positionLabel: null,
        country: "БЪЛГАРИЯ",
        shareAmount: 50,
        shareCurrency: null,
        filingDate: "2021-05-04T10:00:00",
        recordId: "111",
        groupId: null,
        fieldIdent: "00230",
      },
    ];
    const state = replayEvents([...seen, ...parseTrDailyFiling(fixture)]);
    const c = state.get("205945260")!;
    const rows = [...c.persons.values()].filter(
      (p) => p.nameNormalized === "ИВАН ГЕОРГИЕВ ТАКУЧЕВ",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].addedAt?.slice(0, 10)).toBe("2021-05-04");
    expect(rows[0].erasedAt?.slice(0, 10)).toBe("2022-09-27");
  });

  it("does not mint a duplicate for a seller ERASED EARLIER IN THE SAME FILING", () => {
    // The ООД→ЕООД consolidation. A SubDeed lists its sections in fixed order and
    // Partners/Erase precedes ShareTransfers, so the seller is already erased by the time
    // the transfer replays. Matching only ACTIVE records minted 768 duplicate rows out of
    // 12,220 (6.3%) over the first 150 days of the feed.
    const priorThenErased: TrChangeEvent[] = [
      {
        kind: "person_added",
        uic: "205945260",
        companyName: "АЙВИ АРХ",
        role: "partner",
        personName: "Иван Георгиев Такучев",
        positionLabel: null,
        country: "БЪЛГАРИЯ",
        shareAmount: 50,
        shareCurrency: null,
        filingDate: "2021-05-04T10:00:00",
        recordId: "333",
        groupId: null,
        fieldIdent: "00230",
      },
    ];
    const parsed = parseTrDailyFiling(fixture);
    const transfer = transfers(parsed)[0];
    const erasedSameFiling: TrChangeEvent = {
      kind: "person_section_erased",
      uic: "205945260",
      fieldIdent: "00230",
      filingDate: transfer.filingDate,
    };
    const state = replayEvents([
      ...priorThenErased,
      erasedSameFiling,
      ...parsed,
    ]);
    const rows = [...state.get("205945260")!.persons.values()].filter(
      (p) => p.nameNormalized === "ИВАН ГЕОРГИЕВ ТАКУЧЕВ",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].addedAt?.slice(0, 10)).toBe("2021-05-04");
  });

  it("does not stamp a role that cannot hold shares", () => {
    // A manager of the same name is not the shareholder who transferred; erasing them would
    // retire a sitting director on the strength of a share sale.
    const mgr: TrChangeEvent[] = [
      {
        kind: "person_added",
        uic: "205945260",
        companyName: "АЙВИ АРХ",
        role: "manager",
        personName: "Иван Георгиев Такучев",
        positionLabel: null,
        country: "БЪЛГАРИЯ",
        shareAmount: null,
        shareCurrency: null,
        filingDate: "2021-05-04T10:00:00",
        recordId: "222",
        groupId: null,
        fieldIdent: "00070",
      },
    ];
    const state = replayEvents([...mgr, ...parseTrDailyFiling(fixture)]);
    const c = state.get("205945260")!;
    const manager = [...c.persons.values()].find((p) => p.role === "manager")!;
    expect(manager.erasedAt).toBeNull();
  });
});
