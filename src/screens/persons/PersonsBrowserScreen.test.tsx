// The /persons head's WIRING — the ~90 lines between the facet responses and <HubHead>.
//
// WHY THIS FILE EXISTS. `personsKpiBasis.test.ts` pins the rule and pins it well; every defect
// this file was written for lived in the wiring instead, where nothing looked at it:
//
//   · the band printed „от всички 0 лица" beside a live 137 461, because the count it waits on
//     and the count in its own caption come from DIFFERENT requests — and `fetchFacets`
//     swallows a failure into `{}` at `staleTime: Infinity`, so one 500 made it permanent;
//   · it captioned an UNFILTERED count „по търсене «иван»", because the term fell back to the
//     URL when the table reported none;
//   · an evidence row counted one set and linked to another.
//
// All three render at a 200 and none moves a row count.
//
// The table and the facets are stubbed at `fetch`, which is the only seam both go through.

import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import userEvent from "@testing-library/user-event";
import { PersonsBrowserScreen } from "./PersonsBrowserScreen";
import { personsScopeCount } from "./personsBrowseConstants";
import { QUERY_MAX } from "@/ux/data_table/searchTerm";
import { NARROWING_PARAMS } from "@/data/persons/useUrlPersonFilters";

/** Facet buckets keyed the way `/api/db/facets` returns them. */
type Facets = Record<string, { value: string; count: number }[]>;

const bool = (t: number, f: number) => [
  { value: "true", count: t },
  { value: "false", count: f },
];

/** A real institution name, spelled the way the CORPUS spells it — with an EM DASH (U+2014).
 *  The hyphen-minus a keyboard produces matches 0 rows against 47 for this (measured
 *  2026-08-26); the search folds case and transliteration, not punctuation. */
const COURT = "Окръжен съд — Варна";

/** The corpus, measured 2026-08-26 on `person_browse_table`. */
const CORPUS: Facets = {
  tier: [
    { value: "P", count: 63_816 },
    { value: "V", count: 73_645 },
  ],
  has_declaration: bool(21_170, 116_291),
  is_company: bool(85_060, 52_401),
  is_mp: bool(2_118, 135_343),
  is_exec: bool(14_583, 122_878),
  is_muni: bool(6_544, 130_917),
  is_magistrate: bool(3_594, 133_867),
  is_candidate: bool(29_707, 107_754),
  is_ngo: bool(4_930, 132_531),
  is_donor: bool(0, 137_461),
  obshtina_code: Array.from({ length: 289 }, (_, i) => ({
    value: `O${i}`,
    count: 1,
  })),
  // An INT facet: the switchers card sums every bucket at 2 and above.
  parties_n: [
    { value: "0", count: 98_000 },
    { value: "1", count: 34_315 },
    { value: "2", count: 4_800 },
    { value: "3", count: 346 },
  ],
  held_office: bool(39_123, 98_338),
  primary_facet: [{ value: "politician", count: 46_139 }],
  primary_role: [],
  party_primary: [],
  oblast_code: [],
  institution: [],
};

interface Stub {
  /** Row count the table answers with. */
  total?: number;
  /** The term the table reports having used. `undefined` = none was sent. */
  global?: string;
  /** Facet payload; `null` makes every facet request fail (the `!r.ok → {}` path). */
  facets?: Facets | null;
}

const stubFetch = ({ total = 137_461, global, facets = CORPUS }: Stub = {}) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      // The screen also mounts `useCanonicalParties` (for the party pill colours),
      // `usePersonLabels` and — when an ?obshtina chip renders — `useObshtinaLabel`. None is
      // under test; each needs a well-shaped answer or the component throws before rendering a
      // single cell.
      if (url.includes("municipalities.json"))
        return {
          ok: true,
          json: async () => [
            { obshtina: "BGS04", name: "Бургас", name_en: "Burgas" },
          ],
        };
      if (!url.startsWith("/api/db/"))
        return { ok: true, json: async () => ({ parties: [] }) };
      if (url.startsWith("/api/db/facets")) {
        if (facets === null) return { ok: false, json: async () => ({}) };
        const req = JSON.parse(decodeURIComponent(url.split("?q=")[1])) as {
          columns: string[];
        };
        const out: Facets = {};
        for (const c of req.columns) out[c] = facets[c] ?? [];
        return { ok: true, json: async () => ({ facets: out }) };
      }
      return {
        ok: true,
        json: async () => ({
          rows: [],
          total,
          totalExact: true,
          page: 0,
          pageSize: 25,
          aggregates: { count: total },
          // Echoed so the screen's `handleData` sees the term the table actually used.
          __global: global,
        }),
      };
    }),
  );

/** The router's live query string, surfaced into the DOM. `window.location` is useless here —
 *  a MemoryRouter never touches it — and the term↔`?q` seam is precisely a claim about what the
 *  router holds. */
const UrlProbe = () => {
  const { search } = useLocation();
  return <output data-url={search} />;
};
const urlOf = (c: HTMLElement): string =>
  c.querySelector("output")?.getAttribute("data-url") ?? "";

const renderAt = (search: string) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[`/persons${search}`]}>
          <PersonsBrowserScreen />
          <UrlProbe />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
};

/** Every basis line in the head band. `data-kpi-cell` is HubHead's own gate anchor. */
const bases = (c: HTMLElement): string[] =>
  [...c.querySelectorAll("[data-kpi-cell]")].map(
    (el) => el.querySelector("span:last-child")?.textContent ?? "",
  );
/** The results table, or null. Hoisted to module scope: two suites ask about it — „is there a
 *  table at all" and „nothing search-blind renders beside search results" — and the second needs
 *  it to wait for the results before asserting what is NOT beside them. */
const table = (c: HTMLElement) => c.querySelector("table");

/** The band's text ONLY — the mix bar below it legitimately prints percentages of its own. */
const bandText = (c: HTMLElement): string =>
  [...c.querySelectorAll("[data-kpi-cell]")]
    .map((el) => el.textContent ?? "")
    .join(" ");

afterEach(() => vi.unstubAllGlobals());

describe("the band never publishes a zero corpus", () => {
  it("renders nothing at all while the facets are missing", async () => {
    // `fetchFacets` returns `{}` on `!r.ok` and `useQueries` caches that at
    // `staleTime: Infinity`, so a single 500 is permanent for the session. The band's own
    // guard covers this: it waits on BOTH producers, so a failed facet leaves skeletons
    // rather than a caption computed from nothing.
    stubFetch({ facets: null });
    const { container } = renderAt("");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 80));
    expect(bases(container)).toEqual([]);
  });

  it("falls back to the count-free caption when only the TIER facet is missing", async () => {
    // The surviving hole, and the one the fallback exists for: the scope counts come from
    // their own request (`tiers`), separate from the one the band waits on (`kpis`). With that
    // one empty and the rest answered, the caption's `{{n}}` would interpolate 0 — „Лица
    // 137 461 · ОТ ВСИЧКИ 0 ЛИЦА" in the largest type on the page.
    //
    // There is no i18n instance in unit tests, so `t()` yields each key's `defaultValue` —
    // which is what makes the two captions distinguishable here at all.
    stubFetch({ facets: { ...CORPUS, tier: [] } });
    const { container } = renderAt("");
    await waitFor(() => expect(bases(container).length).toBeGreaterThan(0));
    for (const b of bases(container)) {
      expect(b).toContain("от всички лица в обхвата");
      expect(b).not.toContain("{{n}}");
    }
  });

  it("uses the COUNTED caption once the tier facet lands", async () => {
    // Non-vacuity for the clause above: a screen that had simply lost the counted caption
    // would pass it.
    stubFetch();
    const { container } = renderAt("");
    await waitFor(() => expect(bases(container).length).toBeGreaterThan(0));
    expect(bases(container)[0]).not.toContain("от всички лица в обхвата");
    expect(bases(container)[0]).toContain("лица");
  });
});

// ---- the search-blind surfaces -----------------------------------------------------------
//
// WHAT THIS PINS, and it is the reason /persons stopped publishing a head band under a search.
// `/api/db/facets` has NO free-text parameter — `runDbFacets` calls buildWhere with
// `{ columns }` and no `global` — so THREE surfaces on this page are computed with the term
// ignored: the head band's three rate cells, the head's „Групи" evidence rail, and the
// „Основна принадлежност" mix bar. Measured on the live page, `?sector=all&q=yavor`: „Лица 321"
// beside „С декларация 15%" and „С фирми в ТР 62%" (21,170 and 85,060 of 137,461), a group rail
// counting 14,583 in изпълнителна власт, and a full-width bar drawing the whole corpus's mix.
//
// Captioning them („ПО ФИЛТРИТЕ, НЕ ПО ТЪРСЕНЕТО") was the first answer and it did not work — a
// 10 px uppercase line cannot outshout the largest type on the page. All three are withheld
// instead, which also lifts the results ~400 px up the page on the one view where a reader
// wants a list.
describe("nothing search-blind renders beside search results", () => {
  it("withholds the whole band under a search", async () => {
    stubFetch({ total: 321, global: "yavor" });
    const { container } = renderAt("?q=yavor");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await waitFor(() => expect(table(container)).not.toBeNull());
    expect(container.querySelectorAll("[data-kpi-cell]").length).toBe(0);
  });

  it("withholds the evidence rail and the mix bar too", async () => {
    stubFetch({ total: 321, global: "yavor" });
    const { container } = renderAt("?q=yavor");
    await waitFor(() => expect(table(container)).not.toBeNull());
    // The rail lives in the head's <aside>. The bar is found by its SEGMENTS
    // (`button[aria-pressed]`, MixBar's own markup) rather than by its heading text — the
    // „Основна принадлежност" chip carries the same words, so a text assertion would flip on a
    // fixture that merely adds `?pfacet`.
    expect(container.querySelector("aside")).toBeNull();
    expect(container.querySelector("button[aria-pressed]")).toBeNull();
  });

  it("keeps all three when a FILTER, not a search, is what opened the table", async () => {
    // Non-vacuity, and the boundary that matters: a facet-derived figure is honest under a
    // filter — that is the one dimension `/api/db/facets` does see — so `?role=mp` must not
    // lose the band. A rule keyed on `showTable` rather than on the term would.
    stubFetch({ total: 2_118 });
    const { container } = renderAt("?role=mp");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        container.querySelectorAll("[data-kpi-cell]").length,
      ).toBeGreaterThan(0),
    );
    expect(container.querySelector("aside")).not.toBeNull();
    expect(container.querySelector("button[aria-pressed]")).not.toBeNull();
  });

  it("withholds the mix bar on the LANDING too, where a sub-floor term leaves no table", async () => {
    // ⚠️ THE ONLY CASE IN THIS SUITE WITHOUT A TABLE, and it is the state the rule was missing.
    // `showTable` is `queryIsSendable || hasNarrowingFilters || browseAll`, so a sub-floor `?q`
    // with NO filter takes the landing branch — where the bar was passed through as
    // `mix={mixBar}`, ungated, while the band and the rail beside it were correctly withheld.
    // Every other case here is sendable (`?q=yavor`) or carries a filter (`?role=mp`), so the
    // suite read as though the rule were unconditional when it covered one branch of two.
    stubFetch({ total: 137_461, global: undefined });
    const { container } = renderAt("?q=%D0%B8%D0%B2");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    // Non-vacuity: assert we really are on the landing, or a future `showTable` change would
    // silently move this case onto the branch that was already covered.
    await waitFor(() =>
      expect(container.textContent).toContain("Започнете оттук"),
    );
    expect(table(container)).toBeNull();
    expect(container.querySelector("button[aria-pressed]")).toBeNull();
  });

  it("withholds them for a SUB-FLOOR term too, which the engine never applied", async () => {
    // `?q=ив` is not yet a query, so the rows below are the filter's — but the reader typed
    // something, and „2 118 Лица" under a box reading „ив" is read as 2,118 matches for „ив".
    // The gate is what the READER asked for (`?q`), never what the engine did with it.
    stubFetch({ total: 2_118, global: undefined });
    const { container } = renderAt("?role=mp&q=%D0%B8%D0%B2");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await waitFor(() => expect(table(container)).not.toBeNull());
    expect(container.querySelectorAll("[data-kpi-cell]").length).toBe(0);
  });
});

describe("the private scope publishes no tautologies", () => {
  it("withholds both rates rather than printing 0% and 100%", async () => {
    // tier V is 73,645 rows with 0 declarations and 73,645 is_company — both determined by
    // construction. „С декларация 0%" about 73,645 named people is the accusation the whole
    // basis design exists to prevent.
    stubFetch({
      total: 73_645,
      facets: {
        ...CORPUS,
        has_declaration: bool(0, 73_645),
        is_company: bool(73_645, 0),
        obshtina_code: [],
      },
    });
    const { container } = renderAt("?sector=private");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await waitFor(() =>
      expect(container.querySelectorAll("[data-kpi-cell]").length).toBe(1),
    );
    // Scoped to the BAND: the mix bar below legitimately prints a 100% segment of its own.
    expect(bandText(container)).not.toContain("0%");
    expect(bandText(container)).not.toContain("100%");
  });
});

describe("the evidence rows count the set they link to", () => {
  it("carries the active scope into every href", async () => {
    // The counts come from a filter-scoped facet while `usePreserveParams` strips every
    // persons param from a bare href — so „Бизнес 73 645" under ?sector=private used to land
    // on a page returning 85 060.
    stubFetch({
      total: 73_645,
      facets: { ...CORPUS, is_company: bool(73_645, 0) },
    });
    const { container } = renderAt("?sector=private");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const link = await waitFor(() => {
      const a = [...container.querySelectorAll("aside a[href]")].find((el) =>
        el.getAttribute("href")?.includes("facet="),
      );
      expect(a).toBeTruthy();
      return a as HTMLAnchorElement;
    });
    expect(link.getAttribute("href")).toContain("sector=private");
  });
});

// ---- the term ⇄ ?q seam --------------------------------------------------------
//
// WHAT THIS PINS. The box holds a DRAFT and `?q` holds the COMMITTED term; nothing crosses
// between them except a submit and a URL move. Both directions are reader-visible and neither
// errors:
//
//   · typing must reach NOTHING — not the URL, not the engine — until the reader submits, which
//     is what makes this page's search a decision rather than a query per keystroke;
//   · the URL moving under the box (Back, an in-app ?q link, „Изчисти филтрите") must move the
//     box, or it goes on showing a term the page is no longer filtered by.
//
// The 350 ms URL mirror this suite used to be about is gone, and with it the two states it
// created: the ref that told „the URL is echoing our own write" from „the URL moved under us",
// and the „Изчисти филтрите" failure where deleting a `?q` that had not been written yet let
// the pending mirror put the term straight back.

describe("the term ⇄ ?q seam", () => {
  beforeEach(() => stubFetch());

  it("typing alone never reaches ?q", async () => {
    const { container } = renderAt("");
    const box = await waitFor(() => screen.getByRole("searchbox"));
    await userEvent.type(box, "явор");
    // Long enough for any surviving debounce to have fired.
    await new Promise((r) => setTimeout(r, 500));
    expect(urlOf(container)).not.toContain("q=");
    // …and the box kept every character.
    expect((box as HTMLInputElement).value).toBe("явор");
  });

  it("the submit button writes the term to ?q, once", async () => {
    const { container } = renderAt("");
    const box = await waitFor(() => screen.getByRole("searchbox"));
    await userEvent.type(box, "явор");
    await userEvent.click(screen.getByRole("button", { name: "Търси" }));
    await waitFor(() => expect(urlOf(container)).toContain("q="));
    expect(decodeURIComponent(urlOf(container))).toContain("q=явор");
  });

  it("clear-filters empties the box AND leaves ?q gone", async () => {
    // Still two halves, though no longer a race: `clearFilters` is URL-only, so a reader who
    // typed something they never submitted would otherwise watch the results clear while their
    // term sat on in the box with „Търси" beside it offering to bring it back.
    const { container } = renderAt("?role=mp");
    const box = await waitFor(() => screen.getByRole("searchbox"));
    await userEvent.type(box, "явор");
    await userEvent.click(await screen.findByText("Изчисти филтрите"));
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    await new Promise((r) => setTimeout(r, 500));
    expect(urlOf(container)).not.toContain("q=");
    expect(urlOf(container)).not.toContain("role=");
  });

  it("⚠️ a draft at the URL writer's cap cannot strand the page in a permanent pending line", async () => {
    // The end-to-end half of the field's `maxLength`, and the reason it is asserted HERE: the
    // cap lives in `useUrlPersonFilters.setQuery` (`v.slice(0, QUERY_MAX)`), so only a mounted
    // screen exercises both sides. Uncapped, typing past a `?q` already at the cap submits a
    // term the URL cannot change — the seeding effect never fires, `dirty` never clears, and the
    // pending line stands for ever beside a button that does nothing.
    const at = "и".repeat(QUERY_MAX);
    const { container } = renderAt(`?q=${at}`);
    const box = await waitFor(() => screen.getByRole("searchbox"));
    await userEvent.type(box, "ъъъ");
    // The box refused the extra characters, so there is nothing un-applied to announce.
    expect((box as HTMLInputElement).value).toHaveLength(QUERY_MAX);
    await userEvent.click(screen.getByRole("button", { name: "Търси" }));
    await new Promise((r) => setTimeout(r, 200));
    expect(container.textContent).not.toContain("Натиснете „Търси“");
  });

  it("follows the URL when it moves under the box", async () => {
    // An in-app link, a Back, a „clear" must all move the box.
    const { container } = renderAt("?q=%D1%8F%D0%B2%D0%BE%D1%80");
    const box = await waitFor(() => screen.getByRole("searchbox"));
    expect((box as HTMLInputElement).value).toBe("явор");
    expect(urlOf(container)).toContain("q=");
  });
});

// ---- the landing ⇄ results switch ------------------------------------------------
//
// WHAT THIS PINS — the requirement the whole rework is for, and the two ways it fails.
//
//   TOO CLOSED. Most links into this page are a FILTER rather than a query, so a
//   search-only gate renders a BLANK page to /parliament's „Депутати" tile, to /court/:code, to
//   the declarations search — all of which are live links today. That is the failure with no
//   error, no empty state and nothing on screen to explain it.
//
//   TOO OPEN. `?sector` must NOT open the table: it is a scope, and switching „Всички" →
//   „Във властта" to get 63,816 prominence-sorted rows IS the default-table behaviour being
//   removed. Nor may a one- or two-character term, which the engine answers with a 400.

describe("whether there is a table at all", () => {
  beforeEach(() => stubFetch());

  it("no table on a bare landing", async () => {
    const { container } = renderAt("");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(table(container)).toBeNull();
  });

  it("no table for a SCOPE alone — a scope is not a query", async () => {
    const { container } = renderAt("?sector=public");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(table(container)).toBeNull();
  });

  it("no table for a term the engine would refuse", async () => {
    // Two characters is not yet a query; opening a table on it sends the engine a term it
    // answers with a 400, i.e. the destructive „Данните не можаха да се заредят." panel.
    const { container } = renderAt("?q=%D1%8F%D0%B2");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(table(container)).toBeNull();
  });

  it("a table for a sendable term", async () => {
    const { container } = renderAt("?q=%D1%8F%D0%B2%D0%BE%D1%80");
    await waitFor(() => expect(table(container)).not.toBeNull());
  });

  it("a table for every cross-link that reaches this page", async () => {
    // Shapes real entry points produce. `fetch` is stubbed, so this asserts the ROUTING rule
    // only — that each of these opens a table — and says nothing about whether the values
    // match rows. `personsExamples.test.ts` is what checks a value against the corpus.
    for (const search of [
      "?role=mp",
      `?court=${encodeURIComponent(COURT)}`,
      "?q=%D1%8F%D0%B2%D0%BE%D1%80&decl=1",
      "?obshtina=BGS04",
      "?facet=magistrate",
    ]) {
      const { container, unmount } = renderAt(search);
      await waitFor(() =>
        expect(table(container), `${search} rendered no table`).not.toBeNull(),
      );
      unmount();
    }
  });

  it("a table for the explicit ?browse=1, with a way back", async () => {
    // The escape hatch, and its return path. `browseAll` is deliberately not an "active
    // filter", so it gets no chip and no clear button — without this affordance a reader who
    // asked to see everything has only the browser's Back.
    const { container } = renderAt("?browse=1");
    await waitFor(() => expect(table(container)).not.toBeNull());
    const back = screen.getByText(/Назад към търсенето/);
    await userEvent.click(back);
    await waitFor(() => expect(table(container)).toBeNull());
  });

  it("offers no way-back link when a real filter is what opened the table", async () => {
    // With a chip and a „Изчисти филтрите" already on screen, a third exit is noise.
    const { container } = renderAt("?browse=1&role=mp");
    await waitFor(() => expect(table(container)).not.toBeNull());
    expect(screen.queryByText(/Назад към търсенето/)).toBeNull();
  });

  it("the landing still carries the filters — they are the other way in", async () => {
    // They live outside DbDataTable for exactly this reason: inside it they would vanish with
    // the table, leaving a landing whose only control is the search box.
    const { container } = renderAt("");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(
      container.querySelectorAll('[role="combobox"]').length,
    ).toBeGreaterThan(0);
  });

  it("the landing's band counts the corpus, from the facet rather than the table", async () => {
    // There is no table to produce an aggregate, so without the facet fallback the band would
    // sit in skeletons for ever on the page a reader arrives at first.
    const { container } = renderAt("");
    await waitFor(() =>
      expect(container.querySelectorAll("[data-kpi-cell]").length).toBe(4),
    );
    expect(container.querySelector("[data-kpi-cell]")?.textContent).toContain(
      "137",
    );
  });
});

// ---- the landing's own figures ---------------------------------------------------
//
// WHAT THIS PINS. The landing publishes five numbers a reader can click, and each is a promise
// about what they will get. All five come from facets, so all five can be absent, zero, or
// scoped differently from the page they lead to — and none of those states errors.

describe("the landing's escape hatch", () => {
  it("names the SCOPE's count, not the corpus's", () => {
    // Under „Във властта" the button promised 137 461 and delivered 63 816. Asserted on the
    // pure rule rather than on the rendered string: `t()` does not interpolate without an i18n
    // instance, so the number never reaches the DOM in a unit test — and the VALUE, not the
    // template, is what was wrong.
    const tiers = { p: 63_816, v: 73_645 };
    expect(personsScopeCount("all", tiers)).toBe(137_461);
    expect(personsScopeCount("public", tiers)).toBe(63_816);
    expect(personsScopeCount("private", tiers)).toBe(73_645);
  });

  it("drops the count entirely rather than promising ZERO", async () => {
    // `tierCounts` reads its own facet, so before that request lands — every cold visit — the
    // button read „Разгледай всички 0 лица", and permanently after one 500 (fetchFacets caches
    // a failure at staleTime: Infinity).
    stubFetch({ facets: { ...CORPUS, tier: [] } });
    renderAt("");
    // The count-free variant is a DIFFERENT key, so the two are distinguishable even with no
    // i18n instance: the counted one renders its „{{n}}" placeholder, the fallback does not.
    const btn = await screen.findByText(/Разгледай всички/);
    expect(btn.textContent).not.toContain("{{n}}");
    expect(btn.textContent).not.toMatch(/[0-9]/);
  });

  it("uses the COUNTED variant ONCE THE TIER FACET LANDS", async () => {
    // Non-vacuity for the clause above — and note the wait: the button renders the count-free
    // variant first and swaps when the facet arrives, which is the correct order (a caption is
    // not ready until the number in it is) and the reason a bare findByText catches the
    // fallback here too.
    stubFetch();
    renderAt("");
    await waitFor(() =>
      expect(screen.getByText(/Разгледай всички/).textContent).toContain(
        "{{n}}",
      ),
    );
  });
});

describe("the landing's cards", () => {
  it("suppress a card the facet says is EMPTY, rather than dashing it for ever", async () => {
    // A bool facet emits no `true` bucket at zero, so "absent" and "none" look alike in the raw
    // payload. Live at ?sector=private, where tier V has 0 declarations and 0 held-office.
    stubFetch({
      facets: {
        ...CORPUS,
        has_declaration: bool(0, 73_645),
        held_office: bool(0, 73_645),
      },
    });
    const { container } = renderAt("?sector=private");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await waitFor(() =>
      expect(container.textContent).toContain("Започнете оттук"),
    );
    expect(container.textContent).not.toContain("Заемали длъжност");
    // …and the ones that DO have counts survive.
    expect(container.textContent).toContain("Сменили партия");
  });

  it("a card's href carries the active scope — its count is scoped, so its link must be", async () => {
    stubFetch();
    const { container } = renderAt("?sector=private");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const link = await waitFor(() => {
      const a = [...container.querySelectorAll("a[href*='switch=']")][0];
      expect(a).toBeTruthy();
      return a as HTMLAnchorElement;
    });
    expect(link.getAttribute("href")).toContain("sector=private");
  });

  it("an entry-point href never carries ?q", async () => {
    // /api/db/facets has no free-text parameter, so every count on these cards is computed with
    // the term ignored. Carrying it would send a reader to a page narrowed by something their
    // number never accounted for.
    stubFetch();
    const { container } = renderAt("?q=%D1%8F%D0%B2");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const hrefs = [...container.querySelectorAll("a[href^='/persons?']")].map(
      (a) => a.getAttribute("href") ?? "",
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) expect(h).not.toContain("q=");
  });
});

// ---- the chips ------------------------------------------------------------------
//
// WHAT THIS PINS. `PersonsActiveFilters` exists because two narrowings — `?position` and
// `?obshtina` — have NO control of any kind, so a table filtered by one of them named the
// filter nowhere and offered no way out. A dimension that stops producing a chip is that
// defect returning, and it is invisible: the table narrows correctly, nothing errors, and the
// only symptom is a page that will not say why it is short.
//
// The cases are derived from the hook's own `NARROWING_PARAMS` contract, so a dimension added
// there without a chip fails here — at compile time — rather than shipping silent.

describe("every narrowing gets a chip", () => {
  beforeEach(() => stubFetch());

  // ⚠️ ONE VALID VALUE PER PARAM, KEYED BY THE HOOK'S OWN CONTRACT. The cases are not a
  // hand-written list of dimensions — that list drifts, and a dimension added to
  // `NARROWING_PARAMS` without a chip would then ship silent. The `satisfies` below is what
  // makes it fail at COMPILE time instead: a new narrowing param with no sample here is a type
  // error, and a sample for a param that is no longer a narrowing is one too.
  const SAMPLE = {
    facet: "mp",
    pfacet: "politician",
    role: "mp",
    party: "gerb",
    oblast: "VAR",
    obshtina: "BGS04",
    court: COURT,
    decl: "1",
    held: "1",
    switch: "1",
  } satisfies Record<(typeof NARROWING_PARAMS)[number], string>;

  const NARROWINGS: [string, string][] = NARROWING_PARAMS.map((p) => [
    `?${p}=${encodeURIComponent(SAMPLE[p])}`,
    p,
  ]);

  it("covers every narrowing the hook declares — checked at RUNTIME, not only by the type", () => {
    // ⚠️ THE TYPE GATE ALONE IS NOT ENOUGH. `satisfies` catches a missing sample (TS1360) and an
    // extra one (TS2353) — but it widens to nothing useful the moment `NARROWING_PARAMS` loses
    // its `as const`, and so does the production `Record` it guards. Both would then accept a
    // contract missing a dimension, which silently stops unlocking the table. This assertion
    // survives that, because it compares the key SETS as values.
    //
    // (`NARROWINGS.length === NARROWING_PARAMS.length` cannot fail — `.map` preserves length —
    // so it is deliberately not the check.)
    expect([...Object.keys(SAMPLE)].sort()).toEqual(
      [...NARROWING_PARAMS].sort(),
    );
    // …and the contract is not empty, which would make the whole loop below vanish silently.
    expect(NARROWING_PARAMS.length).toBeGreaterThan(5);
  });

  for (const [search, what] of NARROWINGS)
    it(`${what}`, async () => {
      const { container } = renderAt(search);
      await waitFor(() => expect(fetch).toHaveBeenCalled());
      const group = await waitFor(() => {
        const g = container.querySelector('[role="group"]');
        expect(g, `${search} rendered no chip row`).not.toBeNull();
        return g!;
      });
      // One chip, plus the „Изчисти филтрите" link and the export button.
      const chips = [...group.querySelectorAll("button[aria-label]")];
      expect(chips.length, `${search}`).toBe(1);
      expect(chips[0].textContent?.trim().length).toBeGreaterThan(0);
    });

  it("renders no chip row when nothing is narrowed", () => {
    const { container } = renderAt("");
    expect(
      container.querySelector('[role="group"][aria-labelledby]'),
    ).toBeNull();
  });

  it("an obshtina chip is READABLE — a name, never a bare code", async () => {
    // This chip is the ONLY surface where `?obshtina` exists; it has no picker. „Община: BGS04"
    // tells a reader a filter is applied and not which municipality it named.
    const { container } = renderAt("?obshtina=BGS04");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    // Assert the chip EXISTS before reading it, matching the ?position sibling below: without
    // it a missing chip fails as „expected undefined to contain «Бургас»", which sends the next
    // reader to the label resolver when nothing rendered at all.
    const chip = await waitFor(() => {
      const c = container.querySelector('[role="group"] button[aria-label]');
      expect(c).not.toBeNull();
      return c!;
    });
    await waitFor(() => expect(chip.textContent).toContain("Бургас"));
    expect(chip.textContent).not.toContain("BGS04");
  });

  it("sends the FOLDED code to the server, not just the folded label", async () => {
    // ⚠️ THE HALF-FIX IS WORSE THAN NO FIX. Canonicalising only the chip renders „Община:
    // Столична община" over an empty table — a confident sentence saying the capital contains
    // nobody — where the raw code at least read as a failure. Asserted on the REQUEST, because
    // that is the half a label assertion cannot see.
    renderAt("?obshtina=SOF00");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const req = [...vi.mocked(fetch).mock.calls]
      .map((c) => String(c[0]))
      .find((u) => u.startsWith("/api/db/table"));
    expect(req).toBeTruthy();
    const decoded = decodeURIComponent(req!.split("?q=")[1]);
    expect(decoded).toContain("SFO_CITY");
    expect(decoded).not.toContain("SOF00");
  });

  it("names SOFIA, whose code municipalities.json structurally cannot carry", async () => {
    // `SFO_CITY` is a synthetic bundle rather than an EKATTE municipality — and it is the
    // LARGEST in the corpus (1,315 of 23,469 placed people), so a resolver reading only that
    // file fails on exactly the biggest case.
    const { container } = renderAt("?obshtina=SFO_CITY");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const chip = await waitFor(() => {
      const c = container.querySelector('[role="group"] button[aria-label]');
      expect(c).not.toBeNull();
      return c!;
    });
    expect(chip.textContent).toContain("Столична община");
    expect(chip.textContent).not.toContain("SFO_CITY");
  });

  it("the retired ?position yields ONE chip, and it is the pfacet's", async () => {
    // `?position` is a pure alias of `?pfacet` and folds on read, so an inbound link keeps
    // working — but it must produce one chip naming the live dimension, not two, and not a
    // dimension the page no longer has a control for.
    const { container } = renderAt("?position=private_sector");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const chips = await waitFor(() => {
      const c = [
        ...container.querySelectorAll('[role="group"] button[aria-label]'),
      ];
      expect(c.length).toBeGreaterThan(0);
      return c;
    });
    expect(chips).toHaveLength(1);
    // BOTH halves. The negative alone passes on a chip that renders nothing readable at all,
    // which is the state the chips exist to end.
    //
    // The positive is asserted on the DIMENSION rather than the value: there is no i18n
    // instance here, so `facetLabel` falls through to the raw code („company"), while in
    // production `pp_facet_company` ships as „Бизнес" — `personLabels.test.ts` is what pins
    // that. What this can prove is that the chip names the LIVE dimension and not the retired
    // param's, which is the thing the fold could get wrong.
    expect(chips[0].textContent).toContain("Основна принадлежност");
    expect(chips[0].textContent).not.toContain("private_sector");
  });
});

describe("the head renders exactly one h1, and it matches the prerendered shell", () => {
  beforeEach(() => stubFetch());

  it("uses the head title, not the breadcrumb one", async () => {
    // The prerendered page a crawler indexes emits „Хора във властта"; a hydrated h1 that
    // differs from the served one is a page that says two things. „Хора" stays the breadcrumb.
    renderAt("");
    const h1s = await waitFor(() => {
      const found = screen.getAllByRole("heading", { level: 1 });
      expect(found).toHaveLength(1);
      return found;
    });
    expect(h1s[0].textContent).toContain("Хора във властта");
  });
});

// ---- what the page ASKS FOR under a search ----------------------------------------------
//
// `useRegistryFacets` issues ONE HTTP REQUEST PER SPEC, so a spec whose only consumers are
// withheld is a request computed server-side and thrown away. Two of them are: `kpis` (the head
// band's denominators, plus the landing cards) and `primary` (the mix bar's partition). Under a
// search with a table up, neither consumer renders — and `kpis` carries `obshtina_code`, a
// 289-value facet over the filtered corpus.
//
// This is asserted on the REQUESTED COLUMNS rather than on a request count, because the count
// alone cannot tell „we stopped asking" from „the specs were merged".
describe("no facet is fetched for a surface the search withholds", () => {
  /** Every column named across every /api/db/facets request so far. */
  const facetColumns = (): string[] =>
    vi
      .mocked(fetch)
      .mock.calls.map(([u]) => String(u))
      .filter((u) => u.startsWith("/api/db/facets"))
      .flatMap(
        (u) =>
          (
            JSON.parse(decodeURIComponent(u.split("?q=")[1])) as {
              columns: string[];
            }
          ).columns,
      );

  it("drops the band's and the mix bar's specs once a search has a table", async () => {
    stubFetch({ total: 321, global: "yavor" });
    const { container } = renderAt("?q=yavor");
    await waitFor(() => expect(table(container)).not.toBeNull());
    const cols = facetColumns();
    // `kpis` — every column of it, including the 289-value one.
    expect(cols).not.toContain("obshtina_code");
    expect(cols).not.toContain("has_declaration");
    expect(cols).not.toContain("parties_n");
    // `primary` — the mix bar's partition.
    expect(cols).not.toContain("primary_facet");
    // …and the specs that still have a visible consumer are STILL asked for: the Група picker
    // and the institution picker outlive a search, so this is not „we stopped faceting".
    expect(cols).toContain("is_mp");
    expect(cols).toContain("institution");
  });

  it("⚠️ KEEPS the kpis spec on the LANDING, where the cards still read it", async () => {
    // The half the obvious `searching ? {} : …` gate gets wrong. A sub-floor `?q` with no
    // filter renders the landing, whose four cards come from THIS spec — gating on `searching`
    // alone blanks them while the band they were confused with is withheld anyway.
    stubFetch({ total: 137_461, global: undefined });
    const { container } = renderAt("?q=%D0%B8%D0%B2");
    await waitFor(() =>
      expect(container.textContent).toContain("Започнете оттук"),
    );
    const cols = facetColumns();
    expect(cols).toContain("has_declaration");
    expect(cols).toContain("parties_n");
    // The mix bar is hidden on this branch too, so its spec goes either way.
    expect(cols).not.toContain("primary_facet");
  });

  it("asks for everything when nothing is searched", async () => {
    // Non-vacuity for both cases above.
    stubFetch();
    const { container } = renderAt("");
    await waitFor(() =>
      expect(container.textContent).toContain("Започнете оттук"),
    );
    const cols = facetColumns();
    expect(cols).toContain("obshtina_code");
    expect(cols).toContain("primary_facet");
  });
});
