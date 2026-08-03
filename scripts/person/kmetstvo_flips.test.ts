// The diff that decides which person_slug_lock rows are unsafe after a local re-parse.
//
// Getting this wrong is worse than not running it: a missed flip serves the new winner at the
// loser's /person URL (the Безмер case — `ivan-stoyanov-1xhzvh` would have become Росен Русев's
// page), and an over-eager purge needlessly 404s a URL that was correct.
// See docs/plans/village-mayor-attribution-v1.md §T1.

import { describe, it, expect } from "vitest";
import { diffSeats } from "./kmetstvo_flips";

type Seat = Parameters<typeof diffSeats>[0][number];

const seat = (
  ref: string,
  winner: string,
  place: string | null = null,
): Seat => ({
  ref,
  cycle: ref.split(":")[0],
  obshtinaCode: ref.split(":")[1],
  role: "village_mayor",
  place,
  winner,
});

/** Stand-in for `translit_bg_latin()`: the real one lives in SQL (000_search_fns.sql) and is
 *  the single normaliser. This mirrors the two behaviours the diff actually depends on —
 *  case-insensitivity and hyphen/whitespace collapsing — which is what the false-positive
 *  cases below turn on. */
const fold = (s: string): string =>
  s.toLocaleLowerCase("bg").replace(/[\s-]+/g, "");

const held = (
  rows: [string, string, string][],
  aliases: string[] = [],
  role:
    | "mayor"
    | "councillor"
    | "village_mayor"
    | "rayon_mayor" = "village_mayor",
) =>
  new Map(
    rows.map(([ref, slug, name]) => [
      ref,
      {
        slug,
        name,
        fold: fold(name),
        aliasFolds: new Set(aliases.map(fold)),
        role,
      },
    ]),
  );

describe("diffSeats", () => {
  // The seat that started this: 2019 Безмер went to a балотаж, the bundle carried no round-2
  // table, so the round-1 leader was published as кмет. Ingesting the runoff hands the seat to
  // the man who actually won it — and his mention would inherit the loser's locked slug.
  it("flags a seat that changed hands, carrying the lock that must go", () => {
    const { flips, moves } = diffSeats(
      [
        seat(
          "2019_10_27_mi:JAM25:kmetstvo:16",
          "Росен Господинов Русев",
          "Безмер",
        ),
      ],
      held([
        [
          "2019_10_27_mi:JAM25:kmetstvo:16",
          "ivan-stoyanov-1xhzvh",
          "Иван Стоилов Стоянов",
        ],
      ]),
      new Set(["2019_10_27_mi:JAM25:kmetstvo:16"]),
      fold,
    );
    expect(moves).toEqual([]);
    expect(flips).toHaveLength(1);
    expect(flips[0].fromSlug).toBe("ivan-stoyanov-1xhzvh");
    expect(flips[0].winner).toBe("Росен Господинов Русев");
    expect(flips[0].place).toBe("Безмер");
  });

  it("leaves an unchanged seat alone", () => {
    const { flips, moves } = diffSeats(
      [seat("2023_10_29_mi:JAM25:kmetstvo:0", "Росен Господинов Русев")],
      held([
        [
          "2023_10_29_mi:JAM25:kmetstvo:0",
          "rosen-rusev-a0a8lm",
          "Росен Господинов Русев",
        ],
      ]),
      new Set(["2023_10_29_mi:JAM25:kmetstvo:0"]),
      fold,
    );
    expect(flips).toEqual([]);
    expect(moves).toEqual([]);
  });

  // REGRESSION. The first live run of the emitter reported 33 "flips" that were nothing of the
  // sort: the bundles carry CIK's spelling while `person.display_name` carries the resolver's
  // canonical form. Comparing raw strings would have purged the locks of 33 people — two of
  // them sitting MPs (`mp-3210`, `mp-5214`) — over capitalisation and hyphen spacing.
  it.each([
    ["ЙОНКО ЙОРДАНОВ ГЕРГОВ", "Йонко Йорданов Гергов"],
    [
      "Светлана Димитрова Парашкевова - Узунова",
      "Светлана Димитрова Парашкевова-Узунова",
    ],
    [
      "Данка Евстатиева Зидарова - Люртова",
      "Данка Евстатиева Зидарова-Люртова",
    ],
  ])(
    "does not flag a re-spelling of the same person (%s)",
    (bundle, stored) => {
      const { flips } = diffSeats(
        [seat("2023_10_29_mi:KNL48:26:101", bundle)],
        held([["2023_10_29_mi:KNL48:26:101", "some-slug-0ffd0b", stored]]),
        new Set(["2023_10_29_mi:KNL48:26:101"]),
        fold,
      );
      expect(flips).toEqual([]);
    },
  );

  // The live run's last two "flips" were two MPs whose local mention merged into their MP
  // record under a married vs maiden surname (Петкова/Минева, Желязкова/Василева). The
  // cluster's display_name differs from the bundle's spelling, but `person_alias` holds both
  // — so the alias set, not the display name, answers "same human?".
  //
  // NOT solved by skipping anchored people: `chooseStableSlug` consults the lock of the
  // INCOMING winner, whose anchoring is not a property of the outgoing holder. 231 locked
  // village_mayor seats are anchored-held (12 on an `mp-*` slug); skipping them would let a
  // genuine change of hands there hand a village mayor an MP's URL.
  it("ignores a name change that is an alias of the same person", () => {
    const { flips } = diffSeats(
      [seat("2023_10_29_mi:GAB05:7:104", "Невена Евстатиева Минева")],
      held(
        [["2023_10_29_mi:GAB05:7:104", "mp-3142", "Невена Евстатиева Петкова"]],
        ["Невена Евстатиева Минева"],
        "councillor",
      ),
      new Set(["2023_10_29_mi:GAB05:7:104"]),
      fold,
    );
    expect(flips).toEqual([]);
  });

  // The converse, and the reason the anchored shortcut was wrong: a REAL change of hands on a
  // seat whose previous holder is an MP must still be purged, or the new winner inherits
  // `mp-*` as their /person URL.
  it("still flags a real change of hands on an MP-held seat", () => {
    const { flips } = diffSeats(
      [seat("2023_10_29_mi:GAB05:7:104", "Съвсем Друг Човек")],
      held(
        [["2023_10_29_mi:GAB05:7:104", "mp-3142", "Невена Евстатиева Петкова"]],
        ["Невена Евстатиева Минева"],
        "councillor",
      ),
      new Set(["2023_10_29_mi:GAB05:7:104"]),
      fold,
    );
    expect(flips).toHaveLength(1);
    expect(flips[0].fromSlug).toBe("mp-3142");
  });

  // A changed winner on a ref nothing is locked to cannot hand anyone a wrong URL — purging it
  // would be a no-op DELETE, and reporting it would pad the audit file with non-events.
  it("ignores a changed seat with no lock behind it", () => {
    const { flips } = diffSeats(
      [seat("2023_10_29_mi:JAM25:kmetstvo:1", "Татяна Димитрова Йовчева")],
      held([
        [
          "2023_10_29_mi:JAM25:kmetstvo:1",
          "georgi-tanev-aaa111",
          "Георги Иванов Танев",
        ],
      ]),
      new Set(),
      fold,
    );
    expect(flips).toEqual([]);
  });

  it("ignores a brand-new ref — nothing is locked to it yet", () => {
    const { flips, moves } = diffSeats(
      [seat("2023_10_29_mi:RSE04:kmetstvo:0", "Иван Иванов")],
      held([]),
      new Set(),
      fold,
    );
    expect(flips).toEqual([]);
    expect(moves).toEqual([]);
  });

  // The §T0 re-split: Ruse's villages leave VAR05 for RSE04. Same person, new address — the
  // lock is rekeyed so their /person URL survives instead of 404-ing for no reason.
  it("rekeys a seat whose holder is unchanged but whose ref moved", () => {
    const { flips, moves } = diffSeats(
      [seat("2023_10_29_mi:RSE04:kmetstvo:0", "Петър Петров", "Ботров")],
      held([
        [
          "2023_10_29_mi:VAR05:kmetstvo:3",
          "petar-petrov-bbb222",
          "Петър Петров",
        ],
      ]),
      new Set(["2023_10_29_mi:VAR05:kmetstvo:3"]),
      fold,
    );
    expect(flips).toEqual([]);
    expect(moves).toEqual([
      {
        fromRef: "2023_10_29_mi:VAR05:kmetstvo:3",
        toRef: "2023_10_29_mi:RSE04:kmetstvo:0",
        slug: "petar-petrov-bbb222",
        winner: "Петър Петров",
      },
    ]);
  });

  // Ambiguity is left alone deliberately: two destinations means we cannot say which seat the
  // URL belongs to, and guessing would move a person's page to the wrong village.
  it("does not rekey when the same name won two new seats in one cycle", () => {
    const { moves } = diffSeats(
      [
        seat("2023_10_29_mi:RSE04:kmetstvo:0", "Петър Петров"),
        seat("2023_10_29_mi:RSE04:kmetstvo:1", "Петър Петров"),
      ],
      held([
        [
          "2023_10_29_mi:VAR05:kmetstvo:3",
          "petar-petrov-bbb222",
          "Петър Петров",
        ],
      ]),
      new Set(["2023_10_29_mi:VAR05:kmetstvo:3"]),
      fold,
    );
    expect(moves).toEqual([]);
  });

  // A man who was a councillor and is now his village's mayor is not one seat that moved.
  // Rekeying across office kinds would re-address the wrong lock.
  it("does not rekey across office kinds", () => {
    const councillorSeat = {
      ...seat("2023_10_29_mi:RSE04:kmetstvo:0", "Петър Петров"),
      role: "village_mayor" as const,
    };
    const { moves } = diffSeats(
      [councillorSeat],
      held(
        [["2023_10_29_mi:VAR05:26:101", "petar-petrov-bbb222", "Петър Петров"]],
        [],
        "councillor",
      ),
      new Set(["2023_10_29_mi:VAR05:26:101"]),
      fold,
    );
    expect(moves).toEqual([]);
  });

  // A namesake in a DIFFERENT cycle is a different seat, not a move.
  it("does not rekey across cycles", () => {
    const { moves } = diffSeats(
      [seat("2019_10_27_mi:RSE04:kmetstvo:0", "Петър Петров")],
      held([
        [
          "2023_10_29_mi:VAR05:kmetstvo:3",
          "petar-petrov-bbb222",
          "Петър Петров",
        ],
      ]),
      new Set(["2023_10_29_mi:VAR05:kmetstvo:3"]),
      fold,
    );
    expect(moves).toEqual([]);
  });

  // A vanished seat with nobody to move to needs no action: the mention id simply stops being
  // claimed, and the person's own slug retirement is the existing machinery's job.
  it("ignores a vanished ref with no destination", () => {
    const { flips, moves } = diffSeats(
      [],
      held([
        ["2023_10_29_mi:VAR05:kmetstvo:9", "someone-ccc333", "Никой Никой"],
      ]),
      new Set(["2023_10_29_mi:VAR05:kmetstvo:9"]),
      fold,
    );
    expect(flips).toEqual([]);
    expect(moves).toEqual([]);
  });
});
