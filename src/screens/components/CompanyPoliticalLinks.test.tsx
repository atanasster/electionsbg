// Component tests for the /company/:eik political-links tile.
//
// EVERY REGRESSION THIS FILE'S HEADER ENUMERATES IS A RENDERING-LAYER ONE, and until now the tile
// had no test at all — the defect and all four of its returns were caught by review, not by CI.
// They share one shape: the tile is correct whenever it has links to show, and makes an
// unsupported claim in one of the other branches. So these tests are almost entirely about the
// states where there is nothing, or not everything, to display.
//
// The fetch is stubbed rather than the hook, so the route's payload contract is exercised
// end-to-end through `useCompanyPolitical` — including the `arms` normalization that decides
// whether a missing field prints a denial.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { bgCorpus as bg } from "@/locales/allKeys";
import type { CompanyPolitical } from "@/data/procurement/useCompanyPolitical";

const dict = bg as Record<string, string>;

// The repo's standard react-i18next mock, extended to resolve `_one`/`_other`. Half this tile's
// copy is plural (suppressed folds, paths, unavailable sources), and a mock that ignored plurals
// would return the bare key — so the assertions below would be checking that the component
// renders a key name, which is exactly the failure they exist to catch.
const translate = (k: string, o?: Record<string, unknown>) => {
  const n = typeof o?.count === "number" ? o.count : undefined;
  const key =
    n != null && dict[`${k}_${n === 1 ? "one" : "other"}`] != null
      ? `${k}_${n === 1 ? "one" : "other"}`
      : k;
  const raw = dict[key] ?? k;
  return o ? raw.replace(/{{(\w+)}}/g, (_, v) => String(o[v] ?? "")) : raw;
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "bg" },
    t: (k: string, o?: Record<string, unknown>) => translate(k, o),
  }),
}));

const { CompanyPoliticalLinks } = await import("./CompanyPoliticalLinks");

const base: CompanyPolitical = {
  eik: "175155542",
  name: "МАКЕДОНСКО КУЛТУРНО-ПРОСВЕТНО ДРУЖЕСТВО ГОЦЕ ДЕЛЧЕВ",
  direct: [],
  bridged: [],
  directCount: 0,
  bridgedCount: 0,
  directTruncated: false,
  bridgedTruncated: false,
  bridgedSuppressedAsDirect: 0,
  bridgeMaxCompanies: 25,
  bridgeFoldsSuppressed: 0,
  arms: { pg: "absent", funds: "absent", personLayer: "absent" },
};

const KARAKACHANOV = {
  arm: "person_layer" as const,
  slug: "mp-2829",
  href: "/person/mp-2829",
  name: "Красимир Дончев Каракачанов",
  kind: "mp" as const,
  officeSource: "mp",
  officeRole: "mp",
  trRoles: ["ngo_board", "ngo_representative"],
  linkBasis: "name_match" as const,
};

const BRIDGED = {
  slug: "mp-2841",
  name: "Александър Маиров Сиди",
  office: "Народни представители",
  officeSource: "mp",
  officeRole: "mp",
  bridgeName: "КРАСИМИР ДОНЧЕВ КАРАКАЧАНОВ",
  bridgeCompanies: 4,
  viaEik: "000681292",
  viaCompany: "СДРУЖЕНИЕ ВМРО",
  pathCount: 5,
};

const serve = (body: unknown, ok = true) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body })),
  );

const renderTile = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <CompanyPoliticalLinks eik="175155542" />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("the defect: a denial published about a named public figure", () => {
  it("lists the office-holder when only the person layer answered", async () => {
    // The motivating page. Both money-gated arms are empty because the NGO neither contracts nor
    // draws EU funds; the old tile printed «Няма установени връзки с политици.» here.
    serve({
      ...base,
      direct: [KARAKACHANOV],
      arms: { pg: "absent", funds: "absent", personLayer: "ok" },
    });
    renderTile();
    expect(
      await screen.findByText(/Красимир Дончев Каракачанов/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(dict.company_pol_none_direct),
    ).not.toBeInTheDocument();
  });

  it("never prints the denial while the request is still in flight", async () => {
    // `data` is undefined on first render, so a tile reading it without a loading branch asserts
    // the check failed on every page load, for every visitor.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    renderTile();
    expect(screen.getByText(dict.company_pol_loading)).toBeInTheDocument();
    expect(
      screen.queryByText(dict.company_pol_none_direct),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(dict.company_pol_unknown),
    ).not.toBeInTheDocument();
  });

  it("says the check could not run — not that nobody was found — when an arm is down", async () => {
    serve({
      ...base,
      arms: { pg: "unavailable", funds: "ok", personLayer: "ok" },
    });
    renderTile();
    expect(
      await screen.findByText(dict.company_pol_unknown),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(dict.company_pol_none_direct),
    ).not.toBeInTheDocument();
  });

  it("denies only when every arm answered and found nobody", async () => {
    serve({ ...base, arms: { pg: "ok", funds: "ok", personLayer: "ok" } });
    renderTile();
    expect(
      await screen.findByText(dict.company_pol_none_direct),
    ).toBeInTheDocument();
  });
});

/** The two card headings, in document order: direct first, bridged second when present. */
const headings = () =>
  screen.getAllByRole("heading").map((h) => h.textContent ?? "");
/** The <Card> a heading belongs to, so "is X inside the direct block" is answerable. */
const cardOf = (title: string) => {
  const h = screen
    .getAllByRole("heading")
    .find((n) => (n.textContent ?? "").includes(title));
  return h?.closest("div.rounded-xl") ?? null;
};

describe("a count is a claim", () => {
  it("shows no numeral while the verdict is unknown", async () => {
    serve({
      ...base,
      arms: { pg: "unavailable", funds: "ok", personLayer: "ok" },
    });
    const { unmount } = renderTile();
    await screen.findByText(dict.company_pol_unknown);
    // «(0)» beside «the check could not be run» is the denial in numeral form.
    expect(headings()[0]).not.toMatch(/\(/);
    unmount();
  });

  it("shows the real number once there is one", async () => {
    serve({
      ...base,
      direct: [KARAKACHANOV],
      arms: { pg: "ok", funds: "ok", personLayer: "ok" },
    });
    renderTile();
    await screen.findByText(/Красимир/);
    expect(headings()[0]).toMatch(/\(1\)/);
  });

  it("shows a supported zero when every arm answered and found nobody", async () => {
    serve({ ...base, arms: { pg: "ok", funds: "ok", personLayer: "ok" } });
    renderTile();
    await screen.findByText(dict.company_pol_none_direct);
    expect(headings()[0]).toMatch(/\(0\)/);
  });
});

describe("the two arms stay two arms", () => {
  it("renders bridged leads in their own block, never among the direct rows", async () => {
    serve({
      ...base,
      direct: [KARAKACHANOV],
      bridged: [BRIDGED],
      arms: { pg: "absent", funds: "absent", personLayer: "ok" },
    });
    renderTile();
    await screen.findByText(/Красимир Дончев Каракачанов/);

    const direct = cardOf(dict.company_pol_direct_title);
    const bridgedCard = cardOf(dict.company_pol_bridged_title);
    expect(direct).not.toBeNull();
    expect(bridgedCard).not.toBeNull();
    // Two cards, not one list: the second-degree person must be in neither the direct card nor
    // the same list as the office-holder found on the company's own filings.
    expect(direct?.textContent).toMatch(/Красимир Дончев Каракачанов/);
    expect(direct?.textContent).not.toMatch(/Александър Маиров Сиди/);
    expect(bridgedCard?.textContent).toMatch(/Александър Маиров Сиди/);
    expect(bridgedCard?.textContent).not.toMatch(
      /Красимир Дончев Каракачанов$/,
    );
    // …and the bridged block carries the sentence that limits what it claims.
    expect(bridgedCard?.textContent).toMatch(
      new RegExp(dict.company_pol_bridged_explainer.slice(0, 40)),
    );
  });

  it("shows a bridged-only company its explanation, not an empty direct list", async () => {
    // `links` is the verdict when EITHER array has rows, so keying the direct card on the verdict
    // rendered a blank <ul> under a "(0)" heading with the explanatory copy suppressed.
    serve({
      ...base,
      bridged: [BRIDGED],
      arms: { pg: "ok", funds: "ok", personLayer: "ok" },
    });
    renderTile();
    expect(
      await screen.findByText(dict.company_pol_none_direct),
    ).toBeInTheDocument();
    expect(screen.getByText(/Александър Маиров Сиди/)).toBeInTheDocument();
  });
});

describe("a refusal is not an absence", () => {
  it("discloses a cut-short bridge even when it returned no rows at all", async () => {
    // The disclosure used to live inside the bridged card, which only renders when that card has
    // rows — so a bridge suppressed in its entirety printed a flat denial.
    serve({
      ...base,
      bridgeFoldsSuppressed: 3,
      arms: { pg: "ok", funds: "ok", personLayer: "ok" },
    });
    renderTile();
    await screen.findByText(dict.company_pol_none_direct);
    await waitFor(() =>
      expect(screen.getByText(/не са проследени/)).toBeInTheDocument(),
    );
  });

  it("names which source was unavailable when links are shown anyway", async () => {
    // A found link is a fact whatever else was unreachable — but the answer must say it is
    // partial, and WHICH arm is missing, since the three are not interchangeable.
    serve({
      ...base,
      direct: [KARAKACHANOV],
      arms: { pg: "unavailable", funds: "ok", personLayer: "ok" },
    });
    renderTile();
    await screen.findByText(/Красимир/);
    expect(
      screen.getByText(new RegExp(dict.company_pol_arm_pg)),
    ).toBeInTheDocument();
  });
});

describe("labels", () => {
  it("renders registry role codes through the bilingual vocabulary, never raw", async () => {
    serve({
      ...base,
      direct: [KARAKACHANOV],
      arms: { pg: "absent", funds: "absent", personLayer: "ok" },
    });
    renderTile();
    await screen.findByText(/Красимир/);
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/ngo_board|ngo_representative/);
    expect(body).toMatch(new RegExp(dict.tr_role_ngo_board));
  });

  it("labels the weaker basis too, so it is not the unmarked default", async () => {
    serve({
      ...base,
      direct: [KARAKACHANOV],
      arms: { pg: "absent", funds: "absent", personLayer: "ok" },
    });
    renderTile();
    await screen.findByText(/Красимир/);
    expect(
      screen.getByText(dict.company_pol_basis_name_match),
    ).toBeInTheDocument();
  });
});
