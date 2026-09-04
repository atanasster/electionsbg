// The chooser is what a shared bare-name candidate URL renders INSTEAD of a page that merges
// two people, so the properties that matter are all about being usable rather than pretty: a
// row per person, a working link per row, and enough on each row to tell people apart who by
// construction share a name — and routinely share a party too.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { initTestI18n } from "@/screens/dashboard/testI18n";
import { PersonNamesakeChooser } from "./PersonNamesakeChooser";
import type { Namesake } from "@/data/candidates/useCandidatePerson";

// The МИР label comes from a react-query hook; stub it so this file needs no QueryClient for
// a lookup it does not test (the sibling tile tests do the same).
vi.mock("@/data/regions/useRegions", () => ({
  useRegions: () => ({
    findRegion: (oblast?: string) =>
      oblast === "S24"
        ? { name: "София 24", name_en: "Sofia 24" }
        : oblast === "S23"
          ? { name: "София 23", name_en: "Sofia 23" }
          : undefined,
  }),
}));

beforeAll(() => initTestI18n());

const NAME = "Боян Иванов Бойчев";

const person = (
  slug: string,
  over: Partial<Namesake["candidacies"][number]> = {},
): Namesake => ({
  personSlug: slug,
  displayName: NAME,
  latestElection: "2024_10_27",
  candidacies: [
    {
      election: "2024_10_27",
      partyNum: 28,
      partyNick: "БСП",
      partyColor: "rgb(237, 28, 36)",
      candidateSlug: `c-28-${slug}`,
      totalVotes: 18,
      oblast: "S24",
      ...over,
    },
  ],
});

const show = (people: Namesake[]) =>
  render(
    <MemoryRouter>
      <PersonNamesakeChooser name={NAME} people={people} />
    </MemoryRouter>,
  );

describe("PersonNamesakeChooser", () => {
  it("gives every person a row and a link to their PERSON page", () => {
    // /person/:slug, not /candidate/:slug — the thing being disambiguated is an identity,
    // and the candidate URL is the one that cannot express which person is meant.
    const { container } = show([person("a"), person("b", { oblast: "S23" })]);
    expect(
      screen.getAllByRole("link").map((a) => a.getAttribute("href")),
    ).toEqual(["/person/a", "/person/b"]);
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("shows the discriminating fields, not just the shared name", () => {
    // Every row's NAME is identical by construction, so a row is only usable if the cycle,
    // the ballot and the МИР are on it. Two people who share a party are separated by the
    // МИР alone — which is why it is the field promoted out of the muted colour.
    const { container } = show([person("a"), person("b", { oblast: "S23" })]);
    // The heading carries the name too, so count the ROWS — one name per person.
    expect(
      [...container.querySelectorAll("li")].filter((li) =>
        li.textContent?.includes(NAME),
      ),
    ).toHaveLength(2);
    expect(screen.getByText("София 24")).toBeInTheDocument();
    expect(screen.getByText("София 23")).toBeInTheDocument();
    expect(screen.getAllByText("БСП")).toHaveLength(2);
    expect(screen.getAllByText("27.10.2024")).toHaveLength(2);
  });

  it("says WHY the reader is being asked, in the corpus's terms", () => {
    // Not "pick one" — the reason is that the results are published by name, so a single
    // shared page would merge two records. A UI-preference phrasing hides the finding.
    show([person("a"), person("b")]);
    expect(screen.getByText(/публикуват по име/)).toBeInTheDocument();
  });

  it("survives a candidacy with no results row", () => {
    // A roster-only candidacy carries no regions, hence no МИР and no vote total. The row
    // must still render (the cycle and ballot are still discriminators) rather than blanking.
    show([
      person("a", { oblast: null, totalVotes: null, partyNick: null }),
      person("b"),
    ]);
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getAllByText("27.10.2024")).toHaveLength(2);
  });

  it("renders every candidacy it is handed — the cap is SQL's", () => {
    // `candidate_person_namesakes` already limits candidacies to 4 per person, so a second
    // slice here would silently drop rows on a payload that had been widened deliberately.
    const many: Namesake = {
      ...person("a"),
      candidacies: [
        { ...person("a").candidacies[0], election: "2026_04_19" },
        { ...person("a").candidacies[0], election: "2024_10_27" },
        { ...person("a").candidacies[0], election: "2023_04_02" },
        { ...person("a").candidacies[0], election: "2022_10_02" },
      ],
    };
    show([many, person("b")]);
    expect(screen.getByText("19.04.2026")).toBeInTheDocument();
    expect(screen.getByText("02.10.2022")).toBeInTheDocument();
  });
});
