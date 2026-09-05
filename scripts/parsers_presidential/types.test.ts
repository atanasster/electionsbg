import { describe, expect, it } from "vitest";
import {
  NOMINATOR_KIND_OVERRIDES,
  addTicketVotes,
  canonicalTicketKey,
  nominatorKind,
  normaliseEkatte,
  splitTicketNames,
} from "./types";
import type { Votes } from "@/data/dataTypes";

describe("splitTicketNames", () => {
  // ⚠ Real pairs from the 2016 and 2021 files only. The other three eras do NOT use
  // this separator: 2006 joins the pair with a COMMA („Георги Първанов, Ангел Марин")
  // and 2011 publishes the two names in separate columns, so each reader decides
  // whether a null here is an error for its own era.
  it("splits the real ballots", () => {
    expect(
      splitTicketNames("Румен Георгиев Радев и Илияна Малинова Йотова"),
    ).toEqual({
      president: "Румен Георгиев Радев",
      vicePresident: "Илияна Малинова Йотова",
    });
    expect(
      splitTicketNames("Цецка Цачева Данговска и Пламен Иванов Манушев"),
    ).toEqual({
      president: "Цецка Цачева Данговска",
      vicePresident: "Пламен Иванов Манушев",
    });
  });

  // ⚠ A hyphenated compound surname is ONE token. „Митева-Матеева" and
  // „Касимова-Моасе" are real 2021 vice-presidents, and a splitter that treated the
  // hyphen as a separator would invent a third name.
  it("keeps a hyphenated compound surname whole", () => {
    expect(
      splitTicketNames(
        "Анастас Георгиев Герджиков и Невяна Михайлова Митева-Матеева",
      ),
    ).toEqual({
      president: "Анастас Георгиев Герджиков",
      vicePresident: "Невяна Михайлова Митева-Матеева",
    });
    expect(
      splitTicketNames("Лозан Йорданов Панов и Мария Хиндова Касимова-Моасе")
        ?.vicePresident,
    ).toBe("Мария Хиндова Касимова-Моасе");
  });

  // ⚠ THE SEPARATOR IS A WORD. A bare `и` occurs inside „Илияна", „Христов",
  // „Кирилов" and most Bulgarian names, so an unbounded split shreds the string.
  it("does not split on the letter и inside a name", () => {
    const r = splitTicketNames("Мария Петрова Колева и Ганчо Иванов Попов");
    expect(r?.president).toBe("Мария Петрова Колева");
    expect(r?.vicePresident).toBe("Ганчо Иванов Попов");
    // „Иванов" contains и and must survive intact.
    expect(r?.vicePresident).toContain("Иванов");
  });

  it("returns null rather than guessing when there is no pair", () => {
    expect(splitTicketNames("Георги Първанов")).toBeNull();
    expect(splitTicketNames("")).toBeNull();
    // Three names joined by и is not a ticket either.
    expect(splitTicketNames("Аз и ти и той")).toBeNull();
  });
});

describe("nominatorKind", () => {
  it("reads a kind the label states explicitly", () => {
    // „ПП" is „Политическа партия" — the register declaring it, not an inference.
    expect(nominatorKind("ПП ГЕРБ")).toBe("party");
    expect(
      nominatorKind("Политическа партия Балканска демократична лига"),
    ).toBe("party");
    expect(nominatorKind("Инициативен комитет")).toBe("committee");
    expect(
      nominatorKind(
        "Инициативен комитет представляван от Стефан Ламбов Данаилов",
      ),
    ).toBe("committee");
    expect(nominatorKind("ИК за Румен Радев и Илияна Йотова")).toBe(
      "committee",
    );
    expect(
      nominatorKind(
        "КП СЪЮЗ НА ДЕСНИТЕ СИЛИ - СДС, Обединени Земеделци, ДП, Движение Гергьовден",
      ),
    ).toBe("coalition");
    expect(nominatorKind("Коалиция КАЛФИН-ПРЕЗИДЕНТ")).toBe("coalition");
  });

  // ⚠ THE FOUR THE OLD DEFAULT GOT WRONG. Not one 2016/2021 label carries a `КП `
  // prefix and exactly one contains „Коалиция", so a `return "party"` fallback
  // published these as parties — three of them while naming their own member parties
  // in the label. They are covered by explicit overrides, not by a shape rule.
  it("does not call a real coalition a party", () => {
    for (const label of [
      "РЕФОРМАТОРСКИ БЛОК",
      "ПП Движение 21 – ПП НДСВ",
      "ОБЕДИНЕНИ ПАТРИОТИ – НФСБ, АТАКА и ВМРО",
      "ПАТРИОТИЧЕН ФРОНТ – НФСБ, БДС РАДИКАЛИ И БНДС ЦЕЛОКУПНА БЪЛГАРИЯ",
    ]) {
      expect(nominatorKind(label), label).toBe("coalition");
    }
  });

  // ⚠ „not a committee and not marked a coalition" is NOT evidence of a party. A
  // label that says nothing gets `unknown`, and a surface must render it that way
  // rather than asserting a legal form the register never stated.
  it("refuses rather than defaulting to party", () => {
    expect(nominatorKind("НЯКАКВА НОВА ФОРМАЦИЯ")).toBe("unknown");
    expect(nominatorKind("")).toBe("unknown");
    // ⚠ Real labels that genuinely say nothing about their legal form. These ARE
    // parties, and this function still does not claim so — the register did not, and
    // a curated roster of "things I believe are parties" would look identical whether
    // it was right or wrong.
    expect(nominatorKind("ВЪЗРАЖДАНЕ")).toBe("unknown");
    expect(nominatorKind("АТАКА")).toBe("unknown");
    expect(nominatorKind("Движение за права и свободи – ДПС")).toBe("unknown");
    // …and the override table is what turns a known one into an answer, so an entry
    // removed from it degrades to `unknown` rather than to a wrong claim.
    expect(NOMINATOR_KIND_OVERRIDES["РЕФОРМАТОРСКИ БЛОК"]).toBe("coalition");
  });
});

describe("addTicketVotes", () => {
  // ⚠ THE 2021 TRAP IN ONE ASSERTION. A section's paper protocol and each of its
  // machines are separate rows carrying the same ticket numbers; assigning rather
  // than adding keeps the last machine and drops the rest — 84% of the 2021 corpus.
  it("sums repeated rows for one ticket rather than replacing", () => {
    const votes: Votes[] = [];
    addTicketVotes(votes, 6, { paper: 10 });
    addTicketVotes(votes, 6, { machine: 111 });
    addTicketVotes(votes, 6, { machine: 99 });
    expect(votes).toHaveLength(1);
    expect(votes[0]).toEqual({
      partyNum: 6,
      paperVotes: 10,
      machineVotes: 210,
      totalVotes: 220,
    });
  });

  it("keeps tickets apart", () => {
    const votes: Votes[] = [];
    addTicketVotes(votes, 6, { machine: 99 });
    addTicketVotes(votes, 15, { machine: 42 });
    expect(votes.map((v) => [v.partyNum, v.totalVotes])).toEqual([
      [6, 99],
      [15, 42],
    ]);
  });

  it("keeps total equal to paper plus machine", () => {
    const votes: Votes[] = [];
    addTicketVotes(votes, 1, { paper: 3, machine: 4 });
    addTicketVotes(votes, 1, { paper: 1 });
    expect(votes[0].totalVotes).toBe(
      (votes[0].paperVotes ?? 0) + (votes[0].machineVotes ?? 0),
    );
    expect(votes[0].totalVotes).toBe(8);
  });
});

describe("canonicalTicketKey", () => {
  // Links one person's tickets across cycles — Радев stood in 2016 as ticket 13 and
  // in 2021 as ticket 6, so the ballot number cannot do it.
  it("folds case and spacing so the same person matches across cycles", () => {
    expect(canonicalTicketKey("Румен Георгиев Радев")).toBe(
      canonicalTicketKey("РУМЕН  ГЕОРГИЕВ РАДЕВ"),
    );
    expect(canonicalTicketKey("Волен Николов Сидеров")).toBe(
      "волен николов сидеров",
    );
  });

  it("does not fold two different people together", () => {
    expect(canonicalTicketKey("Румен Георгиев Радев")).not.toBe(
      canonicalTicketKey("Румен Димитров Христов"),
    );
  });
});

describe("normaliseEkatte", () => {
  // The 2021 file strips leading zeros; the settlement catalogue does not.
  it("pads a domestic code to the catalogue's width", () => {
    expect(normaliseEkatte("2676")).toBe("02676");
    expect(normaliseEkatte("14")).toBe("00014");
    expect(normaliseEkatte("00014")).toBe("00014");
  });

  // ⚠ Abroad codes are legitimately 6 digits and padding must not touch them.
  it("leaves a wider code alone", () => {
    expect(normaliseEkatte("100001")).toBe("100001");
  });

  it("returns undefined for an empty field rather than a zero-string", () => {
    expect(normaliseEkatte("")).toBeUndefined();
    expect(normaliseEkatte("   ")).toBeUndefined();
  });
});
