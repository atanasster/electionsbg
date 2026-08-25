// The check is shared by two pages that hold themselves to DIFFERENT evidence standards,
// and the whole reason it is safe on the stricter one is the basis line — so that is what
// most of this file pins. The rest is the negative-result contract: a miss must say what
// was searched, in whose data, and must not claim the two people are unconnected.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) =>
      ({
        tr_role_partner: "съдружник",
        tr_role_manager: "управител",
        tr_role_ngo_board: "член на управителния съвет",
      })[k] ?? k,
    i18n: { language: "bg" },
  }),
}));

import {
  PersonConnectionCheck,
  BRIDGE_LIMIT,
  type BridgeRow,
  type ConnectionRow,
} from "./PersonConnectionCheck";

const show = (
  props: Partial<React.ComponentProps<typeof PersonConnectionCheck>> = {},
  rows: ConnectionRow[] = [],
  bridged: BridgeRow[] = [],
) =>
  render(
    <MemoryRouter>
      <PersonConnectionCheck
        personName="Иван Петров"
        fetchCheck={async () => ({ shared: rows, bridged })}
        {...props}
      />
    </MemoryRouter>,
  );

const check = async (term = "Георги Георгиев") => {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText(/друго име/), term);
  await user.click(screen.getByRole("button", { name: /Провери/ }));
};

describe("PersonConnectionCheck — the basis it declares", () => {
  it("warns about NAMESAKES on an identity-resolved page", async () => {
    // On /person/:slug every other claim is EIK-exact through person_id, while this
    // block compares two NAMES. Without the warning it reads as the same standard.
    show({ strictIdentity: true });
    expect(screen.getByText(/сравнява ДВЕ ИМЕНА/)).toBeInTheDocument();
    expect(screen.getByText(/съименник/)).toBeInTheDocument();
  });

  it("warns in BOTH directions — a false match AND a false miss", async () => {
    // The caveat covered only hits. But `tr_officers.name_fold` is whole-string equality
    // on `translit_bg_latin`, and the subject is rendered from `display_name` (the
    // most-parts mention across all sources), so a reader typing a name without the
    // patronymic gets a confident „not connected" that means only „not spelled that way".
    show({ strictIdentity: true });
    expect(screen.getByText(/липсващо бащино име/)).toBeInTheDocument();
  });

  it("does NOT claim the rest of the page uses a different standard", async () => {
    // ⚠️ It said „за разлика от останалата страница, която свързва хора по установена
    // самоличност" — contradicting `person_connections`' OWN disclaimer („Връзките са по
    // съвпадение на име и обща фирма"), which renders inches above it in the same
    // section. That contradiction only became reachable when the two were put together.
    show({ strictIdentity: true });
    expect(screen.queryByText(/за разлика от останалата страница/)).toBeNull();
  });

  it("relates itself to the partners tile on the name-matched page", async () => {
    // There the whole page is name-matched, so the useful thing to say is which OTHER
    // block shares this edge — not that names are weak, which the page already says.
    show();
    expect(screen.getByText(/Търси същото/)).toBeInTheDocument();
    expect(screen.queryByText(/съименник/)).toBeNull();
  });
});

describe("PersonConnectionCheck — a miss", () => {
  it("reports what was searched, never that no connection exists", async () => {
    show({}, []);
    await check();
    await waitFor(() =>
      expect(screen.getByText(/не се срещат заедно/)).toBeInTheDocument(),
    );
    // Scoped to OUR data, because tr_officers covers a minority of the registry.
    expect(screen.getByText(/В нашите данни/)).toBeInTheDocument();
    expect(
      screen.getByText(/Това не значи, че връзка няма/),
    ).toBeInTheDocument();
  });

  it("names the TRIMMED term it actually queried", async () => {
    const fetchCheck = vi.fn(async () => ({ shared: [], bridged: [] }));
    show({ fetchCheck });
    await check("  Георги Георгиев  ");
    await waitFor(() =>
      expect(screen.getByText(/не се срещат заедно/)).toBeInTheDocument(),
    );
    // The query and the sentence must agree — otherwise a claim about two named people
    // quotes a string nobody searched.
    expect(fetchCheck).toHaveBeenCalledWith("Иван Петров", "Георги Георгиев");
    expect(screen.getByText(/„Георги Георгиев“/)).toBeInTheDocument();
  });

  it("points at the political block ONLY when the page has one", async () => {
    // The legacy page carries „Политически връзки"; the resolved profile does not, and a
    // dangling in-page anchor is worse than no pointer.
    const { unmount } = show(
      { politicalAnchor: "#person-political-links" },
      [],
    );
    await check();
    await waitFor(() =>
      expect(
        document.querySelector('a[href="#person-political-links"]'),
      ).toBeInTheDocument(),
    );
    unmount();

    show({}, []);
    await check();
    await waitFor(() =>
      expect(screen.getByText(/не се срещат заедно/)).toBeInTheDocument(),
    );
    expect(document.querySelector('a[href^="#"]')).toBeNull();
  });
});

describe("PersonConnectionCheck — a request that does not answer", () => {
  it("says the check FAILED, never that the two are unconnected", async () => {
    // A rejected fetch used to land in the same `[]` as a genuine empty result, so the
    // page asserted „X and Y do not appear together at any company" about two named
    // people on the strength of a request that never ran.
    show({ fetchCheck: async () => Promise.reject(new Error("boom")) });
    await check();
    await waitFor(() =>
      expect(screen.getByText(/не можа да се изпълни/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/не се срещат заедно/)).toBeNull();
  });

  it("clears a previous failure when the next check succeeds", async () => {
    let fail = true;
    show({
      fetchCheck: async () => {
        if (fail) throw new Error("boom");
        return { shared: [], bridged: [] };
      },
    });
    await check("Първи");
    await waitFor(() =>
      expect(screen.getByText(/не можа да се изпълни/)).toBeInTheDocument(),
    );
    fail = false;
    await check("Втори");
    await waitFor(() =>
      expect(screen.getByText(/не се срещат заедно/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/не можа да се изпълни/)).toBeNull();
  });

  it("ignores a stale response that resolves after a newer one", async () => {
    // Enter is not gated on `loading`, so two submissions can be in flight. Out of order,
    // the first would paint query A's companies under query B's names — a sentence naming
    // two people, neither of whom the rows belong to.
    const gate: Array<() => void> = [];
    const rows = [
      {
        uic: "1",
        company: "ПЪРВА",
        status: null,
        a_roles: null,
        b_roles: null,
      },
      {
        uic: "2",
        company: "ВТОРА",
        status: null,
        a_roles: null,
        b_roles: null,
      },
    ];
    let call = 0;
    show({
      fetchCheck: () => {
        const i = call++;
        return new Promise((res) =>
          gate.push(() => res({ shared: [rows[i]], bridged: [] })),
        );
      },
    });
    // ⚠️ ENTER, not the button. The button carries `disabled={loading}` so it cannot
    // double-submit — the keydown handler has no such guard, which is the whole reason
    // the sequence guard exists and the only way to reach the race from the UI.
    const user = userEvent.setup();
    const box = screen.getByPlaceholderText(/друго име/);
    await user.clear(box);
    await user.type(box, "Първи{Enter}");
    await user.clear(box);
    await user.type(box, "Втори{Enter}");
    expect(gate).toHaveLength(2);

    // Resolve the SECOND request, then the stale first.
    gate[1]();
    await waitFor(() => expect(screen.getByText("ВТОРА")).toBeInTheDocument());
    gate[0]();
    await waitFor(() => expect(screen.getByText("ВТОРА")).toBeInTheDocument());
    expect(screen.queryByText("ПЪРВА")).toBeNull();
  });
});

describe("PersonConnectionCheck — a hit", () => {
  const row: ConnectionRow = {
    uic: "123456789",
    company: "АКМЕ ООД",
    status: null,
    a_roles: "partner",
    b_roles: "manager,partner",
  };

  it("lists the shared companies with TRANSLATED roles", async () => {
    show({}, [row]);
    await check();
    await waitFor(() =>
      expect(screen.getByText(/Общи фирми \(1\)/)).toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: "АКМЕ ООД" })).toHaveAttribute(
      "href",
      "/company/123456789",
    );
    // Split AND translated — a raw `manager,partner` is an English token to a Bulgarian
    // reader, which is what this page shipped before trRoleList.
    expect(document.body.textContent).toContain("управител, съдружник");
    expect(document.body.textContent).not.toContain("manager,partner");
  });

  it("does not also render the miss copy", async () => {
    show({}, [row]);
    await check();
    await waitFor(() =>
      expect(screen.getByText(/Общи фирми/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/не се срещат заедно/)).toBeNull();
  });

  it("says nothing at all before the first check", () => {
    show({}, [row]);
    expect(screen.queryByText(/Общи фирми/)).toBeNull();
    expect(screen.queryByText(/не се срещат заедно/)).toBeNull();
  });

  it("refuses an empty query rather than searching for nothing", async () => {
    const fetchCheck = vi.fn(async () => ({ shared: [], bridged: [] }));
    show({ fetchCheck });
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/друго име/), "   ");
    await user.click(screen.getByRole("button", { name: /Провери/ }));
    expect(fetchCheck).not.toHaveBeenCalled();
  });
});

// ─── The second degree ────────────────────────────────────────────────────────────────
// The reference chain is the one that motivated the feature: Георги Винков Фърцов and
// БЛАГОЙ АНГЕЛОВ АНГЕЛОВ share no company, and ИВАН ДИМИТРОВ НЕДЕЛЧЕВ is entered alongside
// both — through РАДИО СОТ and a 7-member управителен съвет. Both bodies are over
// person_connections()'s MAX_CO_OFFICERS (6), which is exactly why the curated graph will
// never publish it and this block must.
const BRIDGE: BridgeRow = {
  bridge_name: "ИВАН ДИМИТРОВ НЕДЕЛЧЕВ",
  bridge_companies: 4,
  a_eik: "112028994",
  a_company: "РАДИО СОТ",
  a_subject_roles: "partner",
  a_bridge_roles: "manager",
  a_body: 7,
  b_eik: "112610279",
  b_company: "СДРУЖЕНИЕ НА ЧАСТНИТЕ ПРЕДПРИЕМАЧИ И РАБОТОДАТЕЛИ В ПАЗАРДЖИК",
  b_subject_roles: "ngo_board",
  b_bridge_roles: "ngo_board",
  b_body: 7,
};

describe("PersonConnectionCheck — a second-degree bridge", () => {
  it("renders the whole four-leg chain, so a reader can check it themselves", async () => {
    show({}, [], [BRIDGE]);
    await check("БЛАГОЙ АНГЕЛОВ АНГЕЛОВ");
    await waitFor(() =>
      expect(screen.getByText(/Свързани през едно лице/)).toBeInTheDocument(),
    );
    const text = document.body.textContent ?? "";
    // Both companies, both linked.
    expect(screen.getByRole("link", { name: "РАДИО СОТ" })).toHaveAttribute(
      "href",
      "/company/112028994",
    );
    expect(
      screen.getByRole("link", { name: /СДРУЖЕНИЕ НА ЧАСТНИТЕ/ }),
    ).toHaveAttribute("href", "/company/112610279");
    // The bridge person, linked to the name-matched profile.
    expect(
      screen.getByRole("link", { name: "ИВАН ДИМИТРОВ НЕДЕЛЧЕВ" }),
    ).toHaveAttribute(
      "href",
      `/person/${encodeURIComponent("ИВАН ДИМИТРОВ НЕДЕЛЧЕВ")}`,
    );
    // All four role legs, TRANSLATED — a raw `ngo_board` is an English token to a
    // Bulgarian reader, which is the defect trRoleList exists to prevent.
    expect(text).toContain("съдружник");
    expect(text).toContain("управител");
    expect(text).toContain("член на управителния съвет");
    expect(text).not.toContain("ngo_board");
    // Both endpoints named, so the chain is a statement about two people.
    expect(text).toContain("„Иван Петров“");
    expect(text).toContain("„БЛАГОЙ АНГЕЛОВ АНГЕЛОВ“");
  });

  it("prints each company's officer-body size", async () => {
    // Rule 3 in the component header: without this a seven-member управителен съвет reads
    // like a two-man firm, which would make this surface weaker than the curated graph it
    // is deliberately wider than.
    show({}, [], [BRIDGE]);
    await check("БЛАГОЙ АНГЕЛОВ АНГЕЛОВ");
    await waitFor(() =>
      expect(screen.getByText(/Свързани през едно лице/)).toBeInTheDocument(),
    );
    expect(screen.getAllByText(/7 вписани лица/)).toHaveLength(2);
  });

  it("STILL states the direct miss first", async () => {
    // The bridge is an addition to „не се срещат заедно в нито една фирма", never a
    // replacement: the direct claim is the stronger one and is still true.
    show({}, [], [BRIDGE]);
    await check("БЛАГОЙ АНГЕЛОВ АНГЕЛОВ");
    await waitFor(() =>
      expect(screen.getByText(/не се срещат заедно/)).toBeInTheDocument(),
    );
    const body = document.body.textContent ?? "";
    expect(body.indexOf("не се срещат заедно")).toBeLessThan(
      body.indexOf("Свързани през едно лице"),
    );
  });

  it("does NOT render when the direct check already answered", async () => {
    // A direct co-entry answers the question; listing weaker indirect chains underneath
    // dilutes a fact with inferences.
    show(
      {},
      [
        {
          uic: "123456789",
          company: "АКМЕ ООД",
          status: null,
          a_roles: "partner",
          b_roles: "manager",
        },
      ],
      [BRIDGE],
    );
    await check("БЛАГОЙ АНГЕЛОВ АНГЕЛОВ");
    await waitFor(() =>
      expect(screen.getByText(/Общи фирми/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Свързани през едно лице/)).toBeNull();
  });

  it("replaces the absence caveat rather than stacking it", async () => {
    // „Това не значи, че връзка няма" is the answer to a TOTAL miss. Printing it beside a
    // found bridge tells the reader nothing was found in the same breath as showing them
    // what was.
    show({ politicalAnchor: "#person-political-links" }, [], [BRIDGE]);
    await check("БЛАГОЙ АНГЕЛОВ АНГЕЛОВ");
    await waitFor(() =>
      expect(screen.getByText(/Свързани през едно лице/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Това не значи, че връзка няма/)).toBeNull();
  });

  it("warns that a link through a third person doubles the namesake risk", async () => {
    show({ strictIdentity: true });
    expect(screen.getByText(/рискът се удвоява/)).toBeInTheDocument();
  });

  it("shows the bridge's own company count only when it is high enough to matter", async () => {
    const { unmount } = show({}, [], [{ ...BRIDGE, bridge_companies: 9 }]);
    await check("Б");
    await waitFor(() =>
      expect(screen.getByText(/името е вписано в 9 фирми/)).toBeInTheDocument(),
    );
    unmount();
    // A name at one or two companies carries no namesake signal worth a line on every row.
    show({}, [], [{ ...BRIDGE, bridge_companies: 1 }]);
    await check("Б");
    await waitFor(() =>
      expect(screen.getByText(/Свързани през едно лице/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/името е вписано/)).toBeNull();
  });

  it("discloses the cap when the list is exactly full", async () => {
    // No silent caps: at the route's limit the list MAY be truncated, and an undisclosed
    // bound reads as „that is all of them".
    const rows = Array.from({ length: BRIDGE_LIMIT }, (_, i) => ({
      ...BRIDGE,
      bridge_name: `ЛИЦЕ ${i}`,
      a_eik: `1000${i}`,
    }));
    const { unmount } = show({}, [], rows);
    await check("Б");
    await waitFor(() =>
      expect(screen.getByText(/Показани са първите/)).toBeInTheDocument(),
    );
    unmount();

    show({}, [], rows.slice(0, BRIDGE_LIMIT - 1));
    await check("Б");
    await waitFor(() =>
      expect(screen.getByText(/Свързани през едно лице/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Показани са първите/)).toBeNull();
  });
});
