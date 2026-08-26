// The governance dashboard's link into /persons?obshtina= — the producer that param never had.
//
// WHAT THIS PINS, and both halves are things this codebase has already got wrong once:
//
//   · THE SOFIA FOLD. Every /governance Sofia URL carries `SOF00`; the corpus says `SFO_CITY`.
//     Measured on `person_browse_table`: `SOF00` → 0 rows, `SFO_CITY` → 1,315, the largest
//     municipality there is. A link that interpolates the route's own segment sends a reader to
//     an empty table — and it fails as an empty page, not an error.
//   · THE CAPTION. `obshtina_code` folds a court body's municipality in, so Burgas is 160
//     politicians and 152 magistrates. The link must show the composition, or „329" reads as
//     „329 in local government".

import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { MyAreaPlacePeopleLink } from "./MyAreaPlacePeopleLink";

// There is no i18n instance in unit tests, so the real `t` returns the KEY and never
// interpolates. The caption's whole job is to name the municipality, so a test that could not
// see the name could not check the thing this component exists for.
//
// ⚠️ IT RESOLVES AGAINST THE REAL BG CORPUS, not a fixture. The assertions below are about the
// copy this actually ships — a fixture would let the shipped string drift („община {{name}}"
// was wrong for Sofia's районa) while the test stayed green on a private copy of it.
vi.mock("react-i18next", async () => {
  const bg = (await import("@/locales/bg/translation.json")).default as Record<
    string,
    string
  >;
  return {
    useTranslation: () => ({
      i18n: { language: "bg" },
      t: (key: string, o?: Record<string, unknown>) => {
        const s = bg[key] ?? String(o?.defaultValue ?? key);
        return o
          ? s.replace(/\{\{(\w+)\}\}/g, (m, name) =>
              o[name] === undefined ? m : String(o[name]),
            )
          : s;
      },
    }),
  };
});

/** Burgas, measured 2026-08-26. */
const BURGAS = [
  { value: "politician", count: 160 },
  { value: "magistrate", count: 152 },
  { value: "executive", count: 15 },
  { value: "public_sector", count: 2 },
];

const stub = (facets: { value: string; count: number }[] | null) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("municipalities.json"))
        return {
          ok: true,
          json: async () => [
            { obshtina: "BGS04", name: "Бургас", name_en: "Burgas" },
          ],
        };
      if (facets === null) return { ok: false, json: async () => ({}) };
      return {
        ok: true,
        json: async () => ({ facets: { primary_facet: facets } }),
      };
    }),
  );

const mount = (obshtina: string) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MyAreaPlacePeopleLink obshtina={obshtina} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

/** The code the facet request actually asked the server for. */
const requestedCode = (): string =>
  JSON.parse(
    decodeURIComponent(
      vi
        .mocked(fetch)
        .mock.calls.map((c) => String(c[0]))
        .filter((u) => u.startsWith("/api/db/facets"))
        .at(-1)!
        .split("?q=")[1],
    ),
  ).filters[0].value[0];

afterEach(() => vi.unstubAllGlobals());

describe("the Sofia fold", () => {
  it("asks the server for SFO_CITY when the route says SOF00", async () => {
    // The one failure that renders an empty table at a 200, on the largest municipality in the
    // corpus. Asserted on the REQUEST, since the href alone would not catch a folded link over
    // an unfolded count or vice versa.
    stub([{ value: "politician", count: 1315 }]);
    mount("SOF00");
    await waitFor(() => expect(requestedCode()).toBe("SFO_CITY"));
  });

  it("links to SFO_CITY too — the count and the destination must agree", async () => {
    stub([{ value: "politician", count: 1315 }]);
    mount("SOF00");
    const link = await screen.findByRole("link");
    expect(link.getAttribute("href")).toContain("obshtina=SFO_CITY");
    expect(link.getAttribute("href")).not.toContain("SOF00");
  });

  it("leaves an ordinary code alone — the fold is Sofia-only", async () => {
    stub(BURGAS);
    mount("BGS04");
    await waitFor(() => expect(requestedCode()).toBe("BGS04"));
    const link = await screen.findByRole("link");
    expect(link.getAttribute("href")).toContain("obshtina=BGS04");
  });

  it("leaves a Sofia RAION alone — those hold their own offices", async () => {
    // obshtinaPlace.ts's rule: folding the 24 S2*** codes into the city bundle would erase 24
    // distinct offices to fix a problem that does not exist.
    stub([{ value: "politician", count: 40 }]);
    mount("S2414");
    await waitFor(() => expect(requestedCode()).toBe("S2414"));
  });
});

describe("what the link says", () => {
  it("does not call a Sofia raion a municipality", async () => {
    // Sofia's 24 районa are deliberately not folded and they carry rows (S2521 = 35, S2414 = 12),
    // so this link serves them — and „община Искър" would call a район of Столична община a
    // municipality. Asserted against the SHIPPED string, which is why the mock reads the corpus.
    stub([{ value: "politician", count: 12 }]);
    const { container } = mount("S2414");
    await screen.findByRole("link");
    expect(container.textContent).not.toContain("община");
  });

  it("shows every facet the mix has — four, not three", async () => {
    // The placed corpus has exactly four facets and no fifth, so a cap of three drops a REAL
    // bucket rather than a tail: on Burgas it would hide „2 public_sector" entirely.
    stub(BURGAS);
    const { container } = mount("BGS04");
    await screen.findByRole("link");
    for (const n of ["160", "152", "15", "2"])
      expect(container.textContent).toContain(n);
  });

  it("shows the composition, not only the count", async () => {
    // „329" alone reads as „329 in local government". 152 of them are a bench.
    stub(BURGAS);
    const { container } = mount("BGS04");
    await screen.findByRole("link");
    await waitFor(() => expect(container.textContent).toContain("329"));
    expect(container.textContent).toContain("160");
    expect(container.textContent).toContain("152");
  });

  it("names the municipality through the SHARED resolver", async () => {
    // Not from a prop. The card above renders Sofia as „община София"; the /persons chip one
    // click later says „Столична община". A link that agreed with the card and disagreed with
    // its own destination renames the place under a reader who follows it.
    stub(BURGAS);
    const { container } = mount("BGS04");
    await screen.findByRole("link");
    await waitFor(() => expect(container.textContent).toContain("Бургас"));
  });

  it("names SOFIA the way its destination does", async () => {
    stub([{ value: "politician", count: 1315 }]);
    const { container } = mount("SOF00");
    await screen.findByRole("link");
    await waitFor(() =>
      expect(container.textContent).toContain("Столична община"),
    );
  });
});

describe("when there is nothing to link to", () => {
  it("renders nothing while the count is still in flight", () => {
    stub(BURGAS);
    const { container } = mount("BGS04");
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the municipality has NO people", async () => {
    // Every one of the 289 municipalities in the corpus is populated today (min 4, median 61),
    // so a zero means the corpus moved — and a link promising rows a click cannot show is worse
    // than no link.
    stub([]);
    const { container } = mount("BGS04");
    // Settle on the REQUEST having been answered, then assert. A bare wall-clock wait passes
    // whether or not the component ever got its data, i.e. it is vacuous in the failing
    // direction — it would also pass on a component that never rendered anything at all.
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("link")).toBeNull());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the facet request FAILS — and does not cache the failure", async () => {
    // ⚠️ IT MUST THROW, NOT RETURN AN EMPTY RESULT. An empty return is a SUCCESS to React Query:
    // the retries never fire and `staleTime: Infinity` pins a transient 500 for the session,
    // deleting the only producer `?obshtina` has, with the page looking exactly as it does for
    // a municipality that genuinely holds nobody.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stub(null);
    const { container } = mount("BGS04");
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(screen.queryByRole("link")).toBeNull();
    expect(container).toBeEmptyDOMElement();
    // Warned once, the `psp:`/`pp:`/`ppb:` convention — so a silent degrade is greppable.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ppm:"));
    warn.mockRestore();
  });
});
