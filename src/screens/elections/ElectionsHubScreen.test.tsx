// The hub's WIRING: which cycle it is about, and what it says when it cannot tell.
//
// ⚠ EVERY CLAUSE HERE IS ABOUT A DISAGREEMENT THAT RENDERS AS A WORKING PAGE. A hub that
// ignores `?elections` still paints; a scope pill showing a folder id still reads like a label;
// a tile pinned to last cycle still navigates. §3.2 names all three, two of them because they
// shipped.

import { describe, expect, it, vi, afterEach } from "vitest";
import { render, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import { ElectionsHubScreen } from "./ElectionsHubScreen";
import { ELECTIONS_BANDS, withLocalCycle } from "./electionsRegistry";
import {
  LATEST_ELECTION_EVENT,
  LATEST_RESOLVABLE_EVENT,
} from "./electionsHubCycle";
import { LATEST_LOCAL_CYCLE } from "@/data/local/useLatestLocalCycle";

await i18n.use(initReactI18next).init({
  lng: "bg",
  fallbackLng: "bg",
  resources: {
    bg: { translation: bgCorpus },
    en: { translation: enCorpus },
  },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const mount = (search = "") => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[`/elections${search}`]}>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(<ElectionsHubScreen />, { wrapper: Wrapper });
};

afterEach(() => vi.unstubAllGlobals());

const scope = () =>
  document.querySelector("[data-elections-scope]") as HTMLElement;

/** ⚠ THE HREF CARRIES THE PRESERVED PARAM. `@/ux/Link` runs every destination through
 *  `usePreserveParams`, which appends `?elections=…` — that is the mechanism §3.2 rule 4 relies
 *  on to make the choice survive the navigation, so an exact-string match on `href` asserts the
 *  opposite of what this page is for. Compare the PATH. */
const pathOf = (el: Element | null) =>
  el?.getAttribute("href")?.split("?")[0] ?? null;

const linkTo = (path: string) =>
  [...document.querySelectorAll("a[href]")].find((a) => pathOf(a) === path) ??
  null;

/**
 * Tiles only.
 *
 * ⚠ THE SCOPE ROW RENDERS SOME OF THE SAME DESTINATIONS, so a document-wide `linkTo` passes
 * on the scope link alone and stops proving the tile is there at all: measured, deleting the
 * `/parliamentary` tile from the registry left the assertion below green. The collision was
 * already there under the old binary toggle and widened when the row gained a link per kind.
 */
const tileLinkTo = (path: string) =>
  [...document.querySelectorAll("a[href]")].find(
    (a) => pathOf(a) === path && !a.closest("[data-elections-scope]"),
  ) ?? null;

describe("the resolved cycle", () => {
  it("follows `?elections` rather than defaulting to the latest", () => {
    // ⚠ THE PARAM CAN BE FORCED BY A LINK. `usePreserveParams` carries it, so a reader
    // arriving from `/elections/2013_05_12` brings 2013 — and a hub that showed 2026 anyway
    // would disagree with every other reader of the param on the same page, at a 200.
    mount("?elections=2013_05_12");
    expect(scope().textContent).toContain("2013");
    expect(scope().textContent).not.toContain("2026");
    // …and the hand-over link goes to THAT cycle's full result.
    expect(
      pathOf(within(scope()).getByText(bgCorpus.elections_hub_full_result)),
    ).toBe("/elections/2013_05_12");
  });

  it("resolves a LOCAL cycle from the same param", () => {
    mount("?elections=2019_10_27_mi");
    expect(scope().textContent).toContain("2019");
    expect(
      pathOf(within(scope()).getByText(bgCorpus.elections_hub_full_result)),
    ).toBe("/local/2019_10_27_mi");
    // The compact adjacent links are to the OTHER kinds — §Phase 3 item 4's "one canvas,
    // never two simultaneous maps", once per kind this page is not showing.
    expect(
      pathOf(
        within(scope()).getByText(bgCorpus.elections_hub_other_parliamentary),
      ),
    ).toBe("/parliamentary");
    // ⚠ 2016, NOT THE LATEST: the reader is standing on 27.10.2019, and the presidency in
    // effect then was Радев's first term. Offering the 2021 cycle here would be the §3.2
    // disagreement — a scope pill naming one date beside a link to a later election.
    expect(
      pathOf(
        within(scope()).getByText(bgCorpus.elections_hub_other_presidential),
      ),
    ).toBe("/presidential/2016_11_06_pvr");
    // …and never a link back to the kind the reader is already on.
    expect(
      within(scope()).queryByText(bgCorpus.elections_hub_other_local),
    ).toBe(null);
  });

  it("offers EVERY other kind from the scope row, anchored to the resolved date", () => {
    // ⚠ THIS ROW WAS A BINARY TOGGLE UNTIL THE PRESIDENTIAL TILE SHIPPED, and the omission
    // was invisible: `local ? parliamentary : local` reads as "the other kind" while meaning
    // "the other of the two I know about", so the presidency was unreachable from this page
    // for every reader on a parliamentary cycle — the ordinary case.
    mount("?elections=2021_11_14");
    expect(
      pathOf(within(scope()).getByText(bgCorpus.elections_hub_other_local)),
    ).toBe("/local/2019_10_27_mi");
    // ⚠ THE SAME DAY. 14.11.2021 carried both ballots — the one date in this corpus where
    // they coincide — which is the point of the case AND its limit: because the anchored and
    // the unanchored answer are equal here, this assertion alone cannot prove the anchoring.
    // The 2019 local case above is what pins that, on both directions of the row.
    expect(
      pathOf(
        within(scope()).getByText(bgCorpus.elections_hub_other_presidential),
      ),
    ).toBe("/presidential/2021_11_14_pvr");
    expect(
      within(scope()).queryByText(bgCorpus.elections_hub_other_parliamentary),
    ).toBe(null);
  });

  it("falls back to the latest and NAMES what it could not read", () => {
    // Rule 3: an unknown value falls back AND says so, rather than rendering an empty first
    // screen the reader cannot account for.
    mount("?elections=not-a-cycle");
    const note = document.querySelector("[data-elections-fallback]")!;
    expect(note.textContent).toContain("not-a-cycle");
    // ⚠ THE SENTENCE, not just the interpolated value. Both fallback sentences carry the
    // value, so asserting only on it passes on a wholly inverted ternary — which would
    // print „не показваме тук" about a string that is not a cycle at all.
    expect(note.textContent).toContain("Не разпознахме");
    expect(note.textContent).not.toContain("още не показваме");
    expect(scope().textContent).toContain("2026");
  });

  it("OPENS a catalogued presidential cycle rather than falling back from it", () => {
    // ⚠ THIS ASSERTED THE OPPOSITE UNTIL T5, and the inversion is the step's headline. The
    // presidential kind had no screens, so a reader arriving with that id got „…още не
    // показваме" — true then, and false the moment `/presidential/:cycle` existed. What the
    // banner must never say is „Не разпознахме", because the id is in our own catalogue; that
    // branch is pinned by the test above, on a genuinely unknown value.
    mount("?elections=2021_11_14_pvr");
    expect(document.querySelector("[data-elections-fallback]")).toBeNull();
    // …and the hub is actually ON that cycle, not merely quiet about it.
    expect(scope().textContent).toContain("2021");
    // ⚠ THE FOLDER ID IS A KEY AND NEVER A LABEL — the defect that put „2026-04-19" on 31
    // surfaces, checked on the one page that now renders a `_pvr` cycle.
    expect(document.body.textContent).not.toContain("2021_11_14_pvr");
    // …and from HERE the other two kinds are the ones offered, the presidency being where
    // the reader already is.
    expect(
      pathOf(
        within(scope()).getByText(bgCorpus.elections_hub_other_parliamentary),
      ),
    ).toBe("/parliamentary");
    expect(
      within(scope()).queryByText(bgCorpus.elections_hub_other_presidential),
    ).toBe(null);
    // ⚠⚠ THE LOCAL LINK IS ANCHORED TO *THIS* CYCLE'S DATE, and it was not until 2026-09-07.
    // `useLatestLocalCycle()` reads `ElectionContext`, which validates its param against the
    // PARLIAMENTARY catalogue only — so a `_pvr` id resolved to the newest parliamentary
    // election and this link went to 2023 while the pill said 2021. The same value feeds ten
    // `cycleScoped: "local"` tiles, so the disagreement was eleven destinations wide.
    expect(
      pathOf(within(scope()).getByText(bgCorpus.elections_hub_other_local)),
    ).toBe("/local/2019_10_27_mi");
    // …and the tiles agree with it, which is where the same value does the most damage.
    expect(tileLinkTo("/local/2019_10_27_mi/municipalities")).toBeTruthy();
    expect(tileLinkTo("/local/2023_10_29_mi/municipalities")).toBeNull();
  });

  it("says nothing about a fallback when no param was given", () => {
    // ⚠ ARRIVING WITH NO PARAM IS THE ORDINARY CASE. A notice here would appear on every
    // first visit.
    mount();
    expect(document.querySelector("[data-elections-fallback]")).toBeNull();
    expect(document.querySelector("[data-elections-switch-latest]")).toBeNull();
  });

  it("offers switching to the latest as a CONTROL, never as a default", () => {
    // §3.2 rule 2: a hub showing 2013 must say 2013; it may offer the switch.
    mount("?elections=2013_05_12");
    expect(
      document.querySelector("[data-elections-switch-latest]"),
    ).toBeTruthy();
    expect(LATEST_ELECTION_EVENT.id).toBe("2026_04_19");
    // ⚠ The control writes the latest RESOLVABLE event. Writing an id `resolveHubCycle`
    // refuses would make the button a no-op that produces an apology — which is what the
    // bare latest becomes the day a presidential cycle is the newest catalogued one.
    expect(LATEST_RESOLVABLE_EVENT.id).toBe("2026_04_19");
  });
});

describe("the cycle LABEL", () => {
  it("is a formatted date, never the folder id", () => {
    // ⚠ SHIPPED ONCE, ON 31 SURFACES: `ScopeControl`'s pill read „Този парламент ·
    // 2026-04-19" — the folder id with underscores swapped for hyphens. A cycle identifier is
    // a key, not a label.
    mount("?elections=2026_04_19");
    const text = scope().textContent ?? "";
    expect(text).not.toContain("2026_04_19");
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(text).not.toContain("_mi");
  });

  it("names the same DAY as the id, west of Greenwich, in both languages", async () => {
    // ⚠ THE SECOND SHIPPED DEFECT, on 613 pages: a calendar day formatted in the viewer's
    // zone renders as the previous day for every reader west of UTC. `formatDate` pins
    // `timeZone: "UTC"` for a date-only value; this is what stops a future formatter swap
    // undoing that.
    const tz = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      for (const lang of ["bg", "en"] as const) {
        await i18n.changeLanguage(lang);
        const { unmount } = mount("?elections=2026_04_19");
        expect(scope().textContent, lang).toContain("19");
        expect(scope().textContent, lang).not.toContain("18");
        unmount();
      }
    } finally {
      await i18n.changeLanguage("bg");
      process.env.TZ = tz;
    }
  });
});

describe("the tile bands", () => {
  it("renders every band and every tile", () => {
    mount();
    for (const b of ELECTIONS_BANDS) {
      expect(document.body.textContent).toContain(bgCorpus[b.labelKey]);
      for (const tile of b.tiles)
        expect(
          linkTo(
            tile.cycleScoped
              ? withLocalCycle(tile.to, LATEST_LOCAL_CYCLE)
              : tile.to,
          ),
          tile.id,
        ).toBeTruthy();
    }
  });

  it("re-points cycle-scoped tiles at the cycle the reader selected", () => {
    // ⚠ THE SILENT DISAGREEMENT, ONE CONTROL DOWN. A tile pinned to the latest cycle while
    // the scope pill names an older one hands the reader last cycle's município list without
    // saying so.
    mount("?elections=2019_10_27_mi");
    expect(linkTo("/local/2019_10_27_mi/runoffs")).toBeTruthy();
    expect(linkTo(`/local/${LATEST_LOCAL_CYCLE}/runoffs`)).toBeNull();
    // …and the two that carry no cycle are untouched.
    expect(linkTo("/local/chmi")).toBeTruthy();
    expect(tileLinkTo("/parliamentary")).toBeTruthy();
  });
});

describe("the head", () => {
  it("renders exactly one h1, and no second page-title component", () => {
    // §6.0: `HubHead` owns the h1 and the SEO block; a screen that also rendered the shared
    // page-title component would give the page two h1s.
    mount();
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(document.querySelector("h1")?.textContent).toBe(
      bgCorpus.elections_hub_title,
    );
  });

  it("gives every band cell a stated basis", () => {
    // §3.1 rule 2. `basis` is typed as required, which enforces PRESENCE and not content —
    // `basis: ""` compiles and renders an empty span.
    mount();
    const cells = [...document.querySelectorAll("[data-kpi-cell]")];
    expect(cells.length).toBeGreaterThanOrEqual(3);
    expect(cells.length).toBeLessThanOrEqual(5);
    for (const c of cells) expect(c.textContent?.trim()).toBeTruthy();
  });

  it("says WHOSE cycle the protocol figures describe", () => {
    // ⚠ ONLY THE PARLIAMENTARY CATALOGUE CARRIES A PROTOCOL, so on a local selection the last
    // two cells fall back to the latest parliamentary vote. Attributing a parliamentary
    // turnout to a local one under an unqualified label is the one thing a shared band must
    // never do.
    mount("?elections=2019_10_27_mi");
    expect(document.body.textContent).toContain(
      bgCorpus.elections_kpi_basis_latest_parliamentary.replace(
        " · {{date}}",
        "",
      ),
    );
  });
});
