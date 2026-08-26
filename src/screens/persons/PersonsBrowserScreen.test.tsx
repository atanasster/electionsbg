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
import { PersonsBrowserScreen, URL_MIRROR_MS } from "./PersonsBrowserScreen";

/** Facet buckets keyed the way `/api/db/facets` returns them. */
type Facets = Record<string, { value: string; count: number }[]>;

const bool = (t: number, f: number) => [
  { value: "true", count: t },
  { value: "false", count: f },
];

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
      // The screen also mounts `useCanonicalParties` (for the party pill colours) and
      // `usePersonLabels`. Neither is under test; both need a well-shaped answer or the
      // component throws before rendering a single cell.
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

describe("the band never captions a count with a search that did not produce it", () => {
  it("drops the search caption when the table reports no term", async () => {
    // Reachable by arriving on ?q=иван and clearing the box, and by any deep link under the
    // engine's floor (?q=ив). The count jumps to the whole corpus while the caption still
    // names the term.
    stubFetch({ total: 137_461, global: undefined });
    const { container } = renderAt("?q=%D0%B8%D0%B2");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await waitFor(() => expect(bases(container).length).toBeGreaterThan(0));
    for (const b of bases(container))
      expect(b).not.toMatch(/търсене|matching/i);
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
// WHAT THIS PINS. The box is local state and the URL is written on a debounce, which buys
// instant typing at the cost of two states that can disagree. Both ways of getting that wrong
// are reader-visible and neither errors:
//
//   · the URL echoing back OUR OWN write must not touch the box (a keystroke landing in that
//     window would be silently reverted), while the URL moving under us — Back, „Изчисти", an
//     in-app ?q link — must;
//   · „Изчисти филтрите" is URL-only, so within the debounce window it deletes a `?q` that was
//     never written, the box keeps the term, and the pending mirror puts it straight back.

describe("the term ⇄ ?q seam", () => {
  beforeEach(() => stubFetch());

  it("writes the term to ?q after the mirror interval, and only once", async () => {
    const { container } = renderAt("");
    const box = await waitFor(() => screen.getByRole("searchbox"));
    await userEvent.type(box, "явор");
    await waitFor(() => expect(urlOf(container)).toContain("q="), {
      timeout: URL_MIRROR_MS * 4,
    });
    // The whole point of the debounce: a four-character word is ONE write, and the term that
    // lands is the finished one rather than the first keystroke.
    expect(decodeURIComponent(urlOf(container))).toContain("q=явор");
    // …and the box kept every character — the echo coming back must not revert one.
    expect((box as HTMLInputElement).value).toBe("явор");
  });

  it("clear-filters empties the box AND leaves ?q gone", async () => {
    // The deterministic four-step failure this guards: arrive filtered, type, clear WITHIN the
    // debounce window, and watch the term reappear in the URL with the button that clears it.
    // `clearFilters` is URL-only, and for 350 ms after a keystroke there is no `?q` to delete.
    const { container } = renderAt("?role=mp");
    const box = await waitFor(() => screen.getByRole("searchbox"));
    await userEvent.type(box, "явор");
    await userEvent.click(await screen.findByText("Изчисти филтрите"));
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    // Long enough for a pending mirror to have fired if one survived the clear.
    await new Promise((r) => setTimeout(r, URL_MIRROR_MS * 2));
    expect(urlOf(container)).not.toContain("q=");
    expect(urlOf(container)).not.toContain("role=");
  });

  it("follows the URL when it moves under the box", async () => {
    // The other half of the same ref: an in-app link, a Back, a „clear" must all move the box.
    // A guard that suppressed every echo would freeze it instead.
    const { container } = renderAt("?q=%D1%8F%D0%B2%D0%BE%D1%80");
    const box = await waitFor(() => screen.getByRole("searchbox"));
    expect((box as HTMLInputElement).value).toBe("явор");
    expect(urlOf(container)).toContain("q=");
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
