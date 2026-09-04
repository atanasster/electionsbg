// The header dropdown's PERSON row — the office+place line that tells two namesakes apart.
//
// WHY THIS FILE EXISTS. Until 2026-09-04 a `p` row rendered as avatar + name + party badge
// and nothing else, so two same-named people in one party were TWO BYTE-IDENTICAL ROWS. The
// reader could not tell a real namesake — or a split the resolver deliberately refused to
// merge and filed as a review candidate — from a bug, and the case that prompted it (Боян
// Иванов Бойчев, two BSP candidacies in Sofia МИР 23 and 24) is reproduced below verbatim.
// Measured over the 63,844 active public figures carrying a tier-P browse row: 4,527 sat in
// a cluster of more than one on name + badge alone, 2,312 once this line is added.
//
// WHAT IS PINNED, and each of these fails silently in a way review does not catch:
//
//   1. THE LINE IS THERE, AND IT DISCRIMINATES. Two rows differing only in place must render
//      two DIFFERENT subtitles — a test asserting merely "a subtitle exists" passes on an
//      implementation that prints the same constant twice.
//   2. THE ROLE GOES THROUGH `roleLabel`. It arrives as a CODE (`candidate`) and must be
//      localized at render, so a language switch re-labels it without re-fetching. The `t`
//      below therefore TRANSLATES rather than echoing: an echoing stub would make the raw
//      code and its label indistinguishable, and would also send `ppOrTrRoleLabel` down its
//      `tr_role_*` fallback, which is not the path this renders.
//   3. THE EN PLACE NAME IS USED WHEN THERE IS ONE, and falls back to the Bulgarian label
//      when there is not — a judicial body carries no `name_en` by design (120), so the
//      fallback is correct behaviour rather than a gap.
//   4. A PERSON WITH NEITHER ROLE NOR PLACE RENDERS NO EMPTY LINE. `person_browse_card`
//      returns nulls for anyone the browse matview does not carry, which is a real state in
//      the window between a resolve and the declarations phase-2 that rebuilds it.
//
//   npx vitest run src/layout/search/SearchItems.test.tsx

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";

// cmdk scrolls its selected item into view from a LAYOUT EFFECT, and jsdom implements no
// `scrollIntoView`. Unstubbed the effect throws, React unwinds the subtree, and the list
// renders EMPTY — which presents as "the component produced nothing" rather than as a
// missing DOM API, so it reads like a bug in the code under test.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

// ⚠️ The language is a MUTABLE closure variable, not `vi.resetModules()` + a re-import.
// Resetting the registry hands the re-imported component a DIFFERENT `SearchContext` object
// than the Provider below, so it reads the default context and renders nothing — a green-
// looking setup that tests the empty state twice.
let lang: "bg" | "en" = "bg";

// Translates the handful of keys these rows touch and echoes everything else. It must
// translate: `ppOrTrRoleLabel` compares `t(key)` against the key itself to decide whether to
// fall back to the `tr_role_*` vocabulary, so an echoing stub silently exercises the fallback.
const DICT: Record<string, string> = {
  pp_role_candidate: "Кандидат",
  pp_role_magistrate: "Магистрат",
  search_group_persons: "Лица",
};
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) =>
      DICT[k] ?? (o && "defaultValue" in o ? (o.defaultValue ?? k) : k),
    i18n: { language: lang },
  }),
}));

import { SearchItems } from "./SearchItems";
import { SearchContext } from "./SearchContext";
import { Command, CommandList } from "@/components/ui/command";
import type { SearchIndexType } from "@/data/search/useSearchItems";

type Item = Partial<SearchIndexType> & { key: string };

const row = (item: Item, i: number) => ({
  item: { type: "p", name: "Боян Иванов Бойчев", ...item } as SearchIndexType,
  refIndex: i,
  score: 0,
});

/** cmdk's CommandGroup/CommandItem read a context the `Command` root provides, so they throw
 *  when rendered bare. The wrapper is scaffolding, not part of what is being asserted. */
const renderItems = (items: Item[]) =>
  render(
    <SearchContext.Provider
      value={{
        arrowDown: () => {},
        arrowUp: () => {},
        items: items.map(row),
        setSearchTerm: () => {},
        setSelected: () => {},
        activate: () => {},
        searchTerm: "бойчев",
      }}
    >
      <Command shouldFilter={false}>
        <CommandList>
          <SearchItems onSelect={() => {}} />
        </CommandList>
      </Command>
    </SearchContext.Provider>,
  );

afterEach(() => {
  lang = "bg";
});

describe("header search — person rows", () => {
  it("renders the office and place, and two namesakes differ", () => {
    // The live case: one name, one party, two Sofia МИР. Before this line the two rows were
    // indistinguishable to a reader.
    renderItems([
      {
        key: "boyan-boychev-1a9q2r",
        party: "БСП",
        primaryRole: "candidate",
        placeLabel: "София 24 МИР",
      },
      {
        key: "boyan-boychev-1a9q2r-2",
        party: "БСП",
        primaryRole: "candidate",
        placeLabel: "София 23 МИР",
      },
    ]);
    expect(screen.getAllByText("Боян Иванов Бойчев")).toHaveLength(2);
    expect(screen.getByText("Кандидат · София 24 МИР")).toBeInTheDocument();
    expect(screen.getByText("Кандидат · София 23 МИР")).toBeInTheDocument();
  });

  it("renders a role-only person without a trailing separator", () => {
    // ⚠️ THIS IS THE COMMON SHAPE, not an edge case: measured over the 63,844 people this
    // surface can return, 12,961 (20.3%) carry a role and NO place. „Кандидат · " would read
    // as a missing place rather than as an absent one.
    renderItems([{ key: "x", primaryRole: "candidate" }]);
    expect(screen.getByTestId("person-meta")).toHaveTextContent("Кандидат");
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });

  it("renders a place-only person without a stray separator", () => {
    // The mirror image, and a DEFENSIVE pin rather than coverage: 0 of the 63,844 rows
    // currently take this shape. It stays because `roleSubtitle` is shared with the home
    // finder, which reads a different table where the shape is reachable.
    renderItems([{ key: "x", placeLabel: "София" }]);
    expect(screen.getByTestId("person-meta")).toHaveTextContent("София");
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });

  it("renders NO line at all when the card carried neither role nor place", () => {
    // person_browse_card returns null for a person absent from person_browse_table — real
    // between a resolve and the declarations phase-2 that rebuilds it. An empty muted line
    // there is visual noise that says nothing.
    //
    // ⚠️ Asserted on `data-testid`, never on the Tailwind classes. A negative assertion
    // coupled to a class list passes vacuously the moment somebody renames `truncate` to
    // `line-clamp-1` — the selector then matches nothing whether the line renders or not,
    // and no other test in this file would go red either. The positive assertions above use
    // the same hook, so a lost testid breaks them loudly rather than making this one silent.
    renderItems([{ key: "x", party: "БСП" }]);
    expect(screen.getByText("Боян Иванов Бойчев")).toBeInTheDocument();
    expect(screen.queryByTestId("person-meta")).not.toBeInTheDocument();
  });
});

describe("header search — person rows in English", () => {
  it("prefers the EN place name, and falls back to BG when there is none", () => {
    lang = "en";
    renderItems([
      {
        key: "a",
        primaryRole: "candidate",
        placeLabel: "София 24 МИР",
        placeLabelEn: "Sofia 24th MMC",
      },
      // A judicial body: 120 carries `name_en` only for place_dim, so this is the designed
      // absence and the BG label is the right answer, not a gap.
      { key: "b", primaryRole: "magistrate", placeLabel: "ВКС" },
    ]);
    // The stub DICT is language-blind ON PURPOSE, so the ROLE stays „Кандидат" even here —
    // this case is about the PLACE, and a language-aware stub would add a second axis to a
    // fixture whose whole value is being inert.
    expect(screen.getByText("Кандидат · Sofia 24th MMC")).toBeInTheDocument();
    expect(screen.getByText("Магистрат · ВКС")).toBeInTheDocument();
    // The Bulgarian place name must NOT leak through when an English one exists.
    expect(screen.queryByText(/София 24 МИР/)).not.toBeInTheDocument();
  });
});
