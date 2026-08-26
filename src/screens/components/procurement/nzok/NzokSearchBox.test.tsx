// The FIFTH group — the МЗ bodies — rendered by the real component, which is the
// only place three claims can be checked at all:
//
//   1. the box actually PASSES `mzBodySearchKeys`. `mzSecondLevelBodies.test.ts`
//      imports that builder directly, so it stays green on a box that stopped
//      calling it — verified by mutation, and stated in its header. This file is
//      what closes that;
//   2. the copy quotes the INSTITUTION count (53), not the array length (55).
//      Two РЗИ ship both halves of their РИОКОЗ→РЗИ history, so the EIK count
//      would name two institutions that do not exist, and the two numbers are
//      close enough that nobody would notice;
//   3. the English strings carry no Cyrillic. The clause drawing the НЗОК
//      boundary shipped as „они take no НЗОК money" in an alphabet the reader it
//      is written for may not read — the boundary drawn in BG and silently not
//      in EN.
//
// The four НЗОК payloads are left UNRESOLVED for most of this file, and that is
// an assertion in itself: the МЗ group is a static import with no fetch and no
// `armed` gate, so it must answer on first paint, while the other four are still
// in flight. `nzok.resolved` flips them to loaded-but-empty for the one test that
// needs the empty state — with any source still loading the box says „Зареждане…"
// rather than „Няма съвпадения", which is right (it must not report our own
// pending fetch as an absence of data) and would otherwise make that test assert
// against a spinner.
//
// Plan: docs/plans/health-mz-bodies-search-v1.md (T4c).

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";

const language = { current: "bg" };
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: {
      get language() {
        return language.current;
      },
    },
  }),
}));

const nzok = { resolved: false, gated: [] as boolean[] };
vi.mock("@/data/budget/useBudget", () => ({
  useNzokHospitalPayments: () => ({
    data: nzok.resolved ? { hospitals: [] } : undefined,
  }),
  useNzokDrugQuarterly: () => ({
    data: nzok.resolved ? { top: [], allInns: [] } : undefined,
  }),
  // The two sources the pack does NOT already fetch take an `enabled` flag, and
  // recording it is the only way a test can see the R1 contract — that neither
  // is requested until the reader focuses the box.
  useNzokDrugPackIndex: (enabled: boolean) => {
    nzok.gated.push(enabled);
    return { data: nzok.resolved ? { packs: [] } : undefined };
  },
  useNzokProcedureIndex: (enabled: boolean) => {
    nzok.gated.push(enabled);
    return { data: nzok.resolved ? { procedures: [] } : undefined };
  },
  useNzokProcedureNames: () => ({ data: undefined }),
}));

import { NzokSearchBox } from "./NzokSearchBox";
import {
  MZ_SECOND_LEVEL_BODIES,
  MZ_SECOND_LEVEL_INSTITUTION_COUNT,
  type MzBodyUniverse,
} from "@/lib/mzSecondLevelBodies";

beforeEach(() => {
  language.current = "bg";
  nzok.resolved = false;
  nzok.gated = [];
  // ResizeObserver is NOT shimmed here: vitest.setup.ts sets it on globalThis,
  // which under jsdom is `window`. A local copy would be dead code that reads
  // like a requirement. `scrollIntoView` is genuinely missing and cmdk calls it
  // on every highlighted row.
  if (!Element.prototype.scrollIntoView)
    Element.prototype.scrollIntoView = () => {};
});

/** Renders the EIK it was routed to, so a test can assert WHICH body a row
 *  landed on rather than that some awarder page appeared. */
const Awarder = () => {
  const { eik } = useParams();
  return <div data-eik={eik}>ВЪЗЛОЖИТЕЛ</div>;
};

const setup = () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={["/sector/health"]}>
      <Routes>
        <Route path="/sector/health" element={<NzokSearchBox />} />
        <Route path="/awarder/:eik" element={<Awarder />} />
      </Routes>
    </MemoryRouter>,
  );
  return { user, input: screen.getByRole("combobox") };
};

describe("NzokSearchBox — the МЗ bodies group", () => {
  it("finds the body whose failed search motivated the group", async () => {
    // Verbatim the query from the screenshot that opened this work. It returned
    // „Няма съвпадения" for a body with 77 contracts and a served page.
    const { user, input } = setup();
    await user.type(input, "Национален център по обществено здраве");
    const row = await screen.findByText(/НЦОЗА/);
    await user.click(row);
    // The EIK, not merely "a page rendered". Landing on the WRONG awarder is the
    // failure this whole roster exists to make impossible, and it looks identical
    // to success without this.
    expect(screen.getByText("ВЪЗЛОЖИТЕЛ").dataset.eik).toBe("176094665");
  });

  it("finds it by the acronym a reader actually types", async () => {
    // „НЦОЗА" reaches the row through its LABEL, where the previous test's query
    // reaches it through the label too but on different words — so this is the
    // acronym-led naming rule from the roster's header, asserted end to end.
    const { user, input } = setup();
    await user.type(input, "НЦОЗА");
    await user.click(await screen.findByText(/НЦОЗА/));
    expect(screen.getByText("ВЪЗЛОЖИТЕЛ").dataset.eik).toBe("176094665");
  });

  it("passes the universe keys, not just the row names", async () => {
    // ⚠ THE ASSERTION THIS FILE EXISTS FOR. „Център за спешна медицинска помощ"
    // is the register's own spelling — every ЦСМП's awarder_name — and it appears
    // in NO row label, since the labels are acronym-led. It can only match
    // through MZ_UNIVERSE_SEARCH_KEYS, so a box that stopped passing
    // `mzBodySearchKeys` finds nothing here while the roster's own unit gate
    // stays green.
    const { user, input } = setup();
    await user.type(input, "Център за спешна медицинска помощ");
    // EXACTLY the group's `limit`, not „more than one". 29 ЦСМП match this query
    // and the component sets `limit: 12` deliberately — the default 8 hid two
    // thirds of the family, always the same two thirds, since the roster is
    // alphabetical and unranked. `toBeGreaterThan(1)` passed at 12, 8 and 2
    // alike, so the one number with a measurement behind it was ungated.
    const rows = await screen.findAllByText(/^ЦСМП — /);
    expect(rows).toHaveLength(12);
  });

  it("answers on first paint, while the four НЗОК sources are still loading", async () => {
    // The МЗ group is a static import with no fetch and no `armed` gate, so it
    // must render before anything resolves. Asserted against the LOADING state
    // itself rather than against `nzok.resolved`, which beforeEach had just set
    // and which no assertion could therefore falsify.
    const { user, input } = setup();
    await user.type(input, "ЦСМП — Пловдив");
    expect(await screen.findByText("ЦСМП — Пловдив")).toBeInTheDocument();
    // …and it is the ONLY group that can answer yet: an unresolved payload gives
    // its group a null index, which `SectorEntitySearch` does not search and does
    // not render a heading for. So the МЗ heading is present and the four НЗОК
    // ones are not — which is falsifiable in a way `expect(nzok.resolved)` was
    // not, and fails the moment this group acquires a fetch or an `armed` gate.
    expect(screen.getByText("Ведомства на МЗ")).toBeInTheDocument();
    for (const heading of ["Болници", "Клинични пътеки", "Лекарства"])
      expect(screen.queryByText(heading)).toBeNull();
  });

  it("requests the pack and pathway indexes only after first focus", async () => {
    // R1, the perf rule in the component's header: the two sources the pack does
    // not already fetch are gated on `onArm`. Nothing else observes this, and it
    // is the property a later "tidy-up" would most plausibly undo.
    setup();
    expect(nzok.gated.length).toBeGreaterThan(0);
    expect(nzok.gated.every((g) => g === false)).toBe(true);
    await userEvent.setup().click(screen.getByRole("combobox"));
    expect(nzok.gated.at(-1)).toBe(true);
  });

  it("names the group so the empty state can say what was searched", async () => {
    nzok.resolved = true;
    const { user, input } = setup();
    await user.type(input, "zzzqqq");
    const empty = await screen.findByText(/Няма съвпадения/);
    // The acronym keeps its case: HubSearch lowercases only the first character,
    // because a blanket toLowerCase rendered „ведомства на мз" (and „молекули
    // (inn)" before that).
    expect(empty.textContent).toContain("ведомства на МЗ");
  });
});

describe("NzokSearchBox — the copy", () => {
  it("quotes the institution count, never the EIK count", () => {
    setup();
    const hint = screen.getByText(/Търси по име/).textContent ?? "";
    // The VALUE of the constant is T4a's business; what this file owns is that
    // the copy quotes it at all.
    expect(hint).toContain(String(MZ_SECOND_LEVEL_INSTITUTION_COUNT));
    // The trap is `MZ_SECOND_LEVEL_BODIES.length` — DefenseSearchBox interpolates
    // exactly that from its own roster, correctly, because МО has no retired EIKs.
    // Guarded: with no retired rows the two numbers coincide and the negative
    // would contradict the positive above rather than catching anything.
    if (MZ_SECOND_LEVEL_BODIES.length !== MZ_SECOND_LEVEL_INSTITUTION_COUNT)
      expect(hint).not.toContain(String(MZ_SECOND_LEVEL_BODIES.length));
  });

  it("names every МЗ universe, and every name it gives finds that family", async () => {
    // ⚠ The terms in the hint are a THIRD hand-written copy of the universe
    // names, and they are deliberately not the labels — „спешна помощ" and
    // „НЦОЗА" are substrings of no `MZ_UNIVERSE_LABEL`. So a label comparison
    // proves nothing; what must hold is that a reader who types what the hint
    // advertises gets that family. Asserted by typing them.
    const TERMS: Record<MzBodyUniverse, string> = {
      csmp: "спешна помощ",
      rzi: "здравни инспекции",
      national: "НЦОЗА",
    };
    // Exhaustive over the union at the type level; this catches a universe added
    // to the roster whose rows the hint never mentions.
    expect(Object.keys(TERMS).sort()).toEqual(
      [...new Set(MZ_SECOND_LEVEL_BODIES.map((b) => b.universe))].sort(),
    );

    const { user, input } = setup();
    const hint = screen.getByText(/Търси по име/).textContent ?? "";
    for (const [universe, term] of Object.entries(TERMS)) {
      expect(hint, `the hint stopped naming "${term}"`).toContain(term);
      await user.clear(input);
      await user.type(input, term);
      const expected = MZ_SECOND_LEVEL_BODIES.filter(
        (b) => b.universe === universe,
      ).length;
      const rows = await screen.findAllByText(/^(ЦСМП|РЗИ|СРЗИ|РИОКОЗ|НЦОЗА)/);
      expect(
        rows.length,
        `the hint advertises "${term}" but it finds ${rows.length} rows`,
      ).toBe(Math.min(expected, 12));
    }
  });

  it("says the money is not НЗОК's", () => {
    setup();
    const hint = screen.getByText(/Търси по име/).textContent ?? "";
    // The whole reason the group can sit on a health-fund page without misleading
    // anyone. Without it a reader lands on ЦСМП Пловдив's €6.9m from a page about
    // НЗОК and has no reason to think it is anything else.
    expect(hint).toMatch(/не от НЗОК/);
  });

  it("writes every English string it owns in Latin", async () => {
    // ⚠ The clause that draws the НЗОК boundary shipped in Cyrillic once, i.e.
    // the boundary existed in Bulgarian and silently not in English. The site's
    // settled renderings are NHIF and NCPHA.
    //
    // ⚠ THE GROUP LABELS ARE IN SCOPE, and the first cut missed them — they are
    // the whole text of the English empty state („No matches in: …"), so a
    // Cyrillic group label is Cyrillic in the one sentence an English reader gets
    // when the box finds nothing. `zzzqqq` with the payloads resolved renders all
    // five of them.
    language.current = "en";
    nzok.resolved = true;
    const { user, input } = setup();
    const strings: Record<string, string> = {
      title: screen.getByText(/Find in health/).textContent ?? "",
      placeholder: (input as HTMLInputElement).placeholder,
      hint: screen.getByText(/Search by name/).textContent ?? "",
    };
    await user.type(input, "zzzqqq");
    strings.emptyState =
      (await screen.findByText(/No matches in/)).textContent ?? "";

    for (const [what, text] of Object.entries(strings)) {
      expect(text, `the English ${what} is empty`).not.toBe("");
      expect(text, `the English ${what} carries Cyrillic: ${text}`).not.toMatch(
        /[\u0400-\u04FF]/,
      );
    }
    expect(strings.hint).toContain("NHIF");
    expect(strings.hint).toContain("NCPHA");
    // The МЗ group is one of the five named there, so its label went through the
    // sweep above rather than being asserted separately.
    // Lowercased first character only — so „Ministry of Health" keeps its
    // capitals, which is why the label leads with a common noun. „ministry of
    // Health bodies" is what the other order produced.
    expect(strings.emptyState).toContain("bodies under the Ministry of Health");
  });
});
