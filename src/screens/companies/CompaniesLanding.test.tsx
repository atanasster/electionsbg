// The /companies landing — its two browse actions, and the three-state count contract.
//
// ⚠️ `t` ECHOES THE KEY, so every assertion here is about the key rather than the rendered
// string. Without that these are vacuous in the way the review proved for the filter-bar
// wrapper: react-i18next's no-instance `t` returns `defaultValue` and never reads the key, and
// several fallbacks are byte-identical to their /persons twins („Започнете оттук", „зарежда
// се"), so a component wired to the wrong label set renders identically.
//
// The interpolated `{{n}}` is echoed alongside the key, so a test can also see WHICH label form
// was chosen — the counted one or the countless one.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { CompaniesLanding } from "./CompaniesLanding";
import { companyCardHref } from "./companyCardHref";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && "n" in o ? `${k}:${o.n}` : k,
    i18n: { language: "bg", changeLanguage: () => {} },
  }),
}));

const fmtInt = (n: number) => n.toLocaleString("bg-BG");
/** Any of the grouping separators ICU may emit for bg-BG. */
const SEP = "[\\s\\u00a0\\u202f]";

const CARDS = [
  {
    key: "political",
    label: "Свързани",
    hint: "h",
    count: 17_675,
    to: "/companies?political=1",
  },
  {
    key: "money",
    label: "Средства",
    hint: "h",
    count: 59_884,
    to: "/companies?money=1",
  },
];

const renderLanding = (
  props: Partial<Parameters<typeof CompaniesLanding>[0]> = {},
) =>
  render(
    <MemoryRouter>
      <CompaniesLanding
        cards={CARDS}
        counts={{ all: 1_022_592, signal: 98_737 }}
        onBrowse={() => {}}
        fmtInt={fmtInt}
        {...props}
      />
    </MemoryRouter>,
  );

describe("the two browse actions", () => {
  it("⚠️ offers BOTH, and names each scope's own size", () => {
    // The floor stops being an invisible client-side filter and becomes a deliberate act with
    // its size on the label. Two actions, two different numbers — a single „разгледай всички"
    // could not express it.
    //
    // ⚠️ `SEP`, not a plain space: `toLocaleString("bg-BG")` groups with a NON-BREAKING space
    // (U+00A0), so „98 737" typed from a keyboard matches nothing. Same trap as the option
    // counts in `registryFilterRules.test`, and the exact codepoint is an ICU implementation
    // detail — match the class, never the literal.
    renderLanding();
    expect(
      screen.getByRole("button", {
        name: new RegExp(`^companies_browse_signal:98${SEP}737`),
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: new RegExp(`^companies_browse_all:1${SEP}022${SEP}592`),
      }),
    ).toBeInTheDocument();
  });

  it("⚠️ the FLOORED browse is the primary one, and the whole registry is secondary", () => {
    // Not in conflict with `?scope` defaulting to `all`: the DEFAULT must be `all` or the
    // search box goes on lying about reaching the whole registry, while the RECOMMENDED browse
    // is the floored one, because the other 90.34% is a phone book — four of the table's five
    // columns render „—" for a hidden row.
    const { container } = renderLanding();
    const [first, second] = Array.from(container.querySelectorAll("button"));
    expect(first.className).toMatch(/font-semibold/);
    expect(second.className).not.toMatch(/font-semibold/);
    expect(first.textContent).toMatch(/companies_browse_signal/);
  });

  it("each action carries its OWN hint, announced with its button", () => {
    // The two promise different things — „фирмите, за които този сайт има какво да каже" vs
    // „всяко вписване" — so one shared hint would misdescribe whichever it was not written for.
    const { container } = renderLanding();
    for (const b of Array.from(container.querySelectorAll("button"))) {
      const id = b.getAttribute("aria-describedby")!;
      expect(id).toMatch(/^companies-browse-/);
      expect(
        container.querySelector(`#${CSS.escape(id)}`)!.textContent,
      ).toMatch(/companies_browse_.*_hint/);
    }
  });

  it("⚠️ omits the count rather than inventing a zero while the facets are in flight", () => {
    // „Разгледай 0 фирми с публична следа" is a sentence and it is false. Same rule as the KPI
    // band's scope basis, whose producer is the same facet request.
    renderLanding({ counts: {} });
    expect(
      screen.getByRole("button", { name: "companies_browse_signal_short" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "companies_browse_all_short" }),
    ).toBeInTheDocument();
  });

  it("⚠️ each button calls ONE callback with its own SCOPE", () => {
    // One parameterised callback rather than two, so both arms are the same code path. With a
    // pair, only the primary's `browseScope` requirement was documented and the secondary
    // quietly needed it too: reached from an inbound `?scope=signal`, a plain
    // `setBrowseAll(true)` would leave „…или целия регистър (1 022 592)" opening 98,737 rows.
    return (async () => {
      const onBrowse = vi.fn();
      renderLanding({ onBrowse });
      await userEvent.click(
        screen.getByRole("button", { name: /companies_browse_signal:/ }),
      );
      expect(onBrowse).toHaveBeenCalledWith("signal");
      await userEvent.click(
        screen.getByRole("button", { name: /companies_browse_all:/ }),
      );
      expect(onBrowse).toHaveBeenLastCalledWith("all");
      expect(onBrowse).toHaveBeenCalledTimes(2);
    })();
  });
});

describe("the three-state count contract", () => {
  it("renders a card's count", () => {
    renderLanding();
    expect(screen.getByText(new RegExp(`^17${SEP}675$`))).toBeInTheDocument();
  });

  it("⚠️ an UNRESOLVED count renders an em dash and keeps its grid slot", () => {
    // `undefined` is „not loaded". Suppressing it would paint the grid and then reflow as each
    // facet lands, which is what a placeholder exists to prevent.
    renderLanding({
      cards: [{ ...CARDS[0], count: undefined }, CARDS[1]],
    });
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("⚠️ a ZERO count SUPPRESSES the card — it would promise rows a click cannot show", () => {
    renderLanding({ cards: [{ ...CARDS[0], count: 0 }, CARDS[1]] });
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByText("Свързани")).toBeNull();
  });

  it("an unresolved count is announced as loading, not as an em dash", () => {
    // „—" is a glyph a screen reader reads as an em dash or skips entirely, so the state it
    // stands for is announced as nothing at all.
    renderLanding({ cards: [{ ...CARDS[0], count: undefined }] });
    const el = screen.getByLabelText("companies_card_loading");
    expect(el.getAttribute("aria-busy")).toBe("true");
  });

  it("uses the COMPANIES section heading key, not the persons one", () => {
    renderLanding();
    expect(screen.getByText("companies_start_here")).toBeInTheDocument();
  });

  it("renders no card section at all when every card is zero", () => {
    renderLanding({ cards: CARDS.map((c) => ({ ...c, count: 0 })) });
    expect(screen.queryByText("companies_start_here")).toBeNull();
    // …and the browse actions survive, because they are the escape hatch.
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
});

describe("companyCardHref", () => {
  it("⚠️ MERGES into the live query string — a card must not drop ?elections", () => {
    // A static `to: "/companies?money=1"` REPLACES the search, so it silently drops every
    // usePreserveParams global the reader is carrying. `?elections` is live on this page: the
    // OG capture shoots `companies?political=1&elections=2026_04_19`.
    const href = companyCardHref(
      new URLSearchParams("elections=2026_04_19&area=SOF"),
      "money",
      "1",
    );
    const p = new URLSearchParams(href.split("?")[1]);
    expect(p.get("elections")).toBe("2026_04_19");
    expect(p.get("area")).toBe("SOF");
    expect(p.get("money")).toBe("1");
  });

  it("⚠️ DROPS ?scope, because a card's count was computed without the floor", () => {
    // A card is a cross-cutting question about the whole registry, and its number comes from a
    // facet computed unfloored. Answering it inside `?scope=signal` would show fewer rows than
    // the card promised — the „count and link name different sets" trap.
    const href = companyCardHref(
      new URLSearchParams("scope=signal"),
      "money",
      "1",
    );
    expect(new URLSearchParams(href.split("?")[1]).get("scope")).toBeNull();
  });

  it("drops ?browse — the narrowing is what opens the table now", () => {
    const href = companyCardHref(new URLSearchParams("browse=1"), "money", "1");
    expect(new URLSearchParams(href.split("?")[1]).get("browse")).toBeNull();
  });

  it("replaces an existing value for its own param rather than appending", () => {
    // URLSearchParams.append would produce `?class=coop&class=chitalishte`, which the hook
    // reads as the FIRST one — a card that appears to do nothing.
    const href = companyCardHref(
      new URLSearchParams("class=coop"),
      "class",
      "chitalishte",
    );
    expect(new URLSearchParams(href.split("?")[1]).getAll("class")).toEqual([
      "chitalishte",
    ]);
  });

  it("always targets /companies", () => {
    expect(companyCardHref(new URLSearchParams(), "money", "1")).toMatch(
      /^\/companies\?/,
    );
  });
});
