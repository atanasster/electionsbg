// The two readers the presidential pages call for every candidate name.
//
// ⚠ ONE OF THEM DECIDES WHETHER A NAME BECOMES A LINK, and a link is a claim that this
// candidate and that profile are the same person. The other decides whether a reader is told
// the name is shared. Both are one-liners over a committed map, which is exactly why they had
// no tests and exactly why they need them: a `?? 0` in the wrong place silently stops warning.

import { describe, expect, it } from "vitest";
import { namesakeCountForTicket, personHrefForTicket } from "./ticketPersons";
import map from "../../../data/presidential/ticket_persons.json";

const LINKS = (map as { links: Record<string, Record<string, unknown>> }).links;

describe("personHrefForTicket", () => {
  it("links a name the map resolved to exactly one public figure", () => {
    expect(personHrefForTicket("Румен Георгиев Радев")).toBe("/person/mp-5142");
  });

  it("refuses a shared name, and refuses an unknown one", () => {
    // ⚠ BOTH REFUSALS RENDER THE SAME WAY and must: a link to one of fifteen people called
    // „Иван Стефанов Иванов" would attribute this candidacy to whichever the resolver picked.
    expect(personHrefForTicket("Иван Стефанов Иванов")).toBeNull();
    expect(personHrefForTicket("Няма Такъв Човек")).toBeNull();
  });

  it("tolerates whitespace and an absent name rather than throwing", () => {
    expect(personHrefForTicket("  Румен Георгиев Радев  ")).toBe(
      "/person/mp-5142",
    );
    expect(personHrefForTicket(undefined)).toBeNull();
    expect(personHrefForTicket("")).toBeNull();
  });

  it("never returns a link for an entry carrying a refusal reason", () => {
    // The invariant across the whole committed map, not one example.
    for (const [name, l] of Object.entries(LINKS))
      if (l.reason) expect(personHrefForTicket(name), name).toBeNull();
  });
});

describe("namesakeCountForTicket", () => {
  it("warns on a private namesake the LINK rule ignores", () => {
    // ⚠ THE CASE THE FIRST CUT MISSED. `candidates` counts public figures, so Костадинов —
    // one public figure, two registry people on the fold — reported 1 and rendered no mark
    // while the Commerce Registry says two humans carry that name.
    const link = LINKS["Костадин Тодоров Костадинов"] as {
      candidates: number;
      foldPeople: number | null;
    };
    expect(link.candidates).toBe(1);
    expect(link.foldPeople).toBeGreaterThan(1);
    expect(namesakeCountForTicket("Костадин Тодоров Костадинов")).toBe(
      link.foldPeople,
    );
  });

  it("reports the shared count for a refused name", () => {
    expect(namesakeCountForTicket("Иван Стефанов Иванов")).toBeGreaterThan(5);
  });

  it("treats an UNMEASURED fold count as unmeasured, never as 1", () => {
    // ⚠ `081_person_identity.sql` says `fold_people_n` NULL „must never be rendered as 1".
    // Reading it as 1 would publish „this name is unique" about a fold nobody has counted —
    // and 40 of the linked names carry a null.
    const nulls = Object.entries(LINKS).filter(
      ([, l]) => l.slug && l.foldPeople === null,
    );
    expect(nulls.length).toBeGreaterThan(10);
    for (const [name] of nulls.slice(0, 20))
      expect(namesakeCountForTicket(name), name).toBeLessThanOrEqual(1);
  });

  it("is 0 for a name the map never saw", () => {
    expect(namesakeCountForTicket("Няма Такъв Човек")).toBe(0);
    expect(namesakeCountForTicket(undefined)).toBe(0);
  });
});
