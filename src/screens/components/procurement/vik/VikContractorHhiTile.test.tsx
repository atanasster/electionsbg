// This tile serves BOTH water universes — the holding group on
// /awarder/206086428 and the whole sector on /water — and unlike
// VikSubsidiaryTile it is handed suppliers rather than operators, so it has no
// way to tell which one it is rendering.
//
// That makes universe-neutral copy the only correct option, and it is a property
// worth a test rather than a comment: the Bulgarian caption was corrected to drop
// "на групата" while the English one kept "the group's contracted value", so for
// one commit /water asserted in English that a Veolia concession, an irrigation
// enterprise, a dams enterprise and 14 municipal operators were companies in
// Български ВиК холдинг. A caption cannot be checked in one language.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { VikContractorHhiTile } from "./VikContractorHhiTile";

let lang = "bg";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: {
      get language() {
        return lang;
      },
    },
  }),
}));

const suppliers = [
  { name: "Изпълнител А", eik: "111111111", totalEur: 600, contractCount: 4 },
  { name: "Изпълнител Б", eik: "222222222", totalEur: 300, contractCount: 2 },
  { name: "Изпълнител В", eik: "333333333", totalEur: 100, contractCount: 1 },
];

const renderTile = (memberEiks?: string[], stateBodyEiks?: string[]) =>
  render(
    <MemoryRouter>
      <VikContractorHhiTile
        suppliers={suppliers}
        totalEur={1000}
        memberEiks={memberEiks}
        stateBodyEiks={stateBodyEiks}
      />
    </MemoryRouter>,
  );

describe.each(["bg", "en"])("VikContractorHhiTile copy — %s", (l) => {
  it("never attributes the contracted value to a holding GROUP", () => {
    lang = l;
    const { container } = renderTile();
    // It cannot know which universe it is in, so it may not name one.
    expect(container.textContent).not.toMatch(
      /на групата|the group's|in the group/,
    );
  });

  it("still explains what the index is computed over", () => {
    lang = l;
    renderTile();
    expect(
      screen.getAllByText(
        l === "bg" ? /договорената стойност/ : /contracted value/,
      ).length,
    ).toBeGreaterThan(0);
  });
});

// The in-group label. A contractor that is itself a member of the sector is the
// state paying its own company — /sector/transport's top „изпълнител" is
// БДЖ-Пътнически превози at €980.6M, 13.5% of the sector, which is the ministry's
// rail PSO and not a supplier won on any market. Unlabelled it reads as a private
// vendor topping the sector.
//
// ⚠ Note the tension with the universe-neutrality tests above, which exist because
// this tile cannot know which universe it is rendering. The badge does assert
// membership — but only for EIKs the CALLER passed in, so the claim is the
// caller's, not the tile's. With no memberEiks the tile must stay exactly as
// neutral as it was, which is the first test here.
const IN_GROUP = /в групата|in-group/i;

describe.each(["bg", "en"])("VikContractorHhiTile in-group label — %s", (l) => {
  it("says nothing about groups when the caller passes no member set", () => {
    lang = l;
    const { container } = renderTile();
    expect(container.textContent).not.toMatch(IN_GROUP);
  });

  it("labels only the rows that are members, and explains the label", () => {
    lang = l;
    const { container } = renderTile(["222222222"]);
    // ONE of the three suppliers is a member, so exactly one badge. The count is
    // the assertion — "at least one" would pass if every row were badged, which
    // is the failure that would make the label meaningless.
    expect(screen.getAllByText(l === "bg" ? "в групата" : "in-group")).toHaveLength(1); // prettier-ignore
    // …and the badge sits on that member's row, not just anywhere in the tile.
    const badge = screen.getByText(l === "bg" ? "в групата" : "in-group");
    expect(badge.parentElement?.textContent).toContain("Изпълнител Б");
    // The footnote fires with it and says what the label means.
    expect(container.textContent).toMatch(
      l === "bg"
        ? /плаща на собственото си дружество/
        : /paying its own company/,
    );
  });

  it("shows no footnote when no displayed row is a member", () => {
    lang = l;
    // A member that exists but is not in the top-8 must not drag the note in —
    // /water is exactly this case (БВХ is a member, below the display cutoff).
    const { container } = renderTile(["999999999"]);
    expect(container.textContent).not.toMatch(IN_GROUP);
    expect(container.textContent).not.toMatch(
      l === "bg"
        ? /плаща на собственото си дружество/
        : /paying its own company/,
    );
  });

  it("does not smuggle a holding-group claim back in via the new copy", () => {
    lang = l;
    const { container } = renderTile(["222222222"]);
    // The same guard the copy tests above enforce — the label must not become a
    // statement that these contractors belong to a HOLDING.
    expect(container.textContent).not.toMatch(
      /на групата|the group's|in the group/,
    );
  });
});

// The state-body label — the same mechanism as in-group, for a public contractor
// that is NOT one of the sector's own bodies. /sector/social's top „изпълнител" is
// „Фонд мениджър на финансови инструменти в България" ЕАД at €33.0M / ~10% of the
// whole corpus, from one ОПРЧР financing agreement: a 100%-state-owned
// fund-of-funds, filed under CPV 79420000 („управленски консултантски услуги").
// Unlabelled it reads as a private consultancy winning a tenth of the sector.
const STATE_BODY = /държавно|state body/i;

describe.each(["bg", "en"])(
  "VikContractorHhiTile state-body label — %s",
  (l) => {
    // The property the five sibling packs depend on: they pass no such prop, so the
    // tile must behave EXACTLY as it did before the prop existed.
    it("says nothing about state bodies when the caller passes no set", () => {
      lang = l;
      const { container } = renderTile();
      expect(container.textContent).not.toMatch(STATE_BODY);
      expect(container.textContent).not.toMatch(
        l === "bg" ? /не напускат държавата/ : /never leaves government/,
      );
    });

    it("labels only the rows in the set, and explains the label", () => {
      lang = l;
      const { container } = renderTile(undefined, ["111111111"]);
      expect(screen.getAllByText(l === "bg" ? "държавно" : "state body")).toHaveLength(1); // prettier-ignore
      const badge = screen.getByText(l === "bg" ? "държавно" : "state body");
      expect(badge.parentElement?.textContent).toContain("Изпълнител А");
      expect(container.textContent).toMatch(
        l === "bg" ? /не напускат държавата/ : /never leaves government/,
      );
    });

    it("shows no footnote when no displayed row is a state body", () => {
      lang = l;
      const { container } = renderTile(undefined, ["999999999"]);
      expect(container.textContent).not.toMatch(STATE_BODY);
    });

    // „В групата" is the more specific claim, so a row that is both must carry it
    // ALONE — two chips on one row would read as two separate reasons.
    it("never double-chips a row that is both a member and a state body", () => {
      lang = l;
      renderTile(["222222222"], ["222222222"]);
      expect(screen.getAllByText(l === "bg" ? "в групата" : "in-group")).toHaveLength(1); // prettier-ignore
      expect(
        screen.queryByText(l === "bg" ? "държавно" : "state body"),
      ).toBeNull();
    });

    it("keeps the row in the index rather than filtering it out", () => {
      lang = l;
      const { container } = renderTile(undefined, ["111111111"]);
      // 600/300/100 of 1000 → 3600+900+100 = 4600. Dropping the state body would
      // give 4600-3600 = a different index over a €400 denominator entirely, so
      // this number is what proves the row is still counted.
      expect(container.textContent).toContain((4600).toLocaleString(l));
    });
  },
);

// The number, not the row: one intra-government transfer can carry the headline
// across a DOJ band boundary by itself, and the chip on the row does not say so.
// Fixture: one €700 state body against ten €30 market contractors. All-in that is
// 70² + 10×3² = 4990 („силно концентриран"); over the €300 of market contracts
// alone it is 10×10² = 1000 („конкурентен пазар") — two different sentences about
// the same sector, which is exactly the case the line exists for.
const dominated = [
  { name: "Държавна структура", eik: "700000000", totalEur: 700, contractCount: 1 }, // prettier-ignore
  ...Array.from({ length: 10 }, (_, i) => ({
    name: `Пазарен ${i}`,
    eik: `1000000${String(i).padStart(2, "0")}`,
    totalEur: 30,
    contractCount: 1,
  })),
];

const renderDominated = (stateBodyEiks?: string[]) =>
  render(
    <MemoryRouter>
      <VikContractorHhiTile
        suppliers={dominated}
        totalEur={1000}
        stateBodyEiks={stateBodyEiks}
      />
    </MemoryRouter>,
  );

describe.each(["bg", "en"])(
  "VikContractorHhiTile market-only HHI — %s",
  (l) => {
    it("states the share and the market-only index when the band changes", () => {
      lang = l;
      const { container } = renderDominated(["700000000"]);
      expect(container.textContent).toMatch(
        l === "bg"
          ? /70% от стойността отива към държавни или общински структури/
          : /70% of the value goes to state or municipal bodies/,
      );
      // The market-only index itself, and its band label — this is the number a
      // reader needs to not read „силно концентриран" as a claim about vendors.
      expect(container.textContent).toContain((1000).toLocaleString(l));
      // …while the headline still carries the all-in index: nothing is filtered.
      expect(container.textContent).toContain((4990).toLocaleString(l));
    });

    it("stays silent when the caller labels nothing", () => {
      lang = l;
      const { container } = renderDominated();
      expect(container.textContent).not.toMatch(
        l === "bg" ? /отива към държавни/ : /goes to state or municipal/,
      );
    });

    // Cosmetic differences are noise. The line is only worth its space when the two
    // numbers land in DIFFERENT bands, i.e. when they support different sentences.
    it("stays silent when removing the transfers does not change the band", () => {
      lang = l;
      // 600/300/100: all-in 4600, market-only (300/100 of 400) 6250 — both
      // „силно концентриран", so there is no second sentence to tell.
      const { container } = renderTile(undefined, ["111111111"]);
      expect(container.textContent).toMatch(STATE_BODY); // the row IS still labelled
      expect(container.textContent).not.toMatch(
        l === "bg" ? /отива към държавни/ : /goes to state or municipal/,
      );
    });
  },
);

describe("VikContractorHhiTile — consortium rows", () => {
  /** One supplier marked, by whichever signal the case is testing. */
  const renderWith = (mark: { eik?: string; consortiumEur?: number | null }) =>
    render(
      <MemoryRouter>
        <VikContractorHhiTile
          suppliers={[
            {
              ...suppliers[0],
              eik: mark.eik ?? suppliers[0].eik,
              consortiumEur: mark.consortiumEur,
            },
            suppliers[1],
            suppliers[2],
          ]}
          totalEur={1000}
        />
      </MemoryRouter>,
    );

  beforeEach(() => {
    lang = "bg";
  });

  // The case the whole change exists for: a REGISTERED ДЗЗД carries an ordinary
  // 9-digit EIK, so the obed- prefix cannot see it. Only the € can.
  it("marks a registered ДЗЗД, which the key prefix cannot see", () => {
    renderWith({ eik: "177424500", consortiumEur: 600 });
    expect(screen.getByText("консорциум")).toBeInTheDocument();
    expect(
      screen.getByText(/концентрацията по фирма е подценена/),
    ).toBeInTheDocument();
  });

  // 0 is an answer, not „unknown" — a solo supplier must not be marked.
  it("does not mark a supplier that won nothing jointly", () => {
    renderWith({ consortiumEur: 0 });
    expect(screen.queryByText("консорциум")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/концентрацията по фирма е подценена/),
    ).not.toBeInTheDocument();
  });

  // The degrade path: on a database whose 061 predates the projection the € is
  // null, and the obed- prefix still answers for its half.
  it("falls back to the key when the € is unknown", () => {
    renderWith({ eik: "obed-369bc7450c81", consortiumEur: null });
    expect(screen.getByText("консорциум")).toBeInTheDocument();
  });

  it("says nothing when no row is a consortium", () => {
    renderTile();
    expect(screen.queryByText("консорциум")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/концентрацията по фирма е подценена/),
    ).not.toBeInTheDocument();
  });

  // A caption cannot be checked in one language — the sibling tile shipped a
  // Bulgarian correction while the English text kept asserting the old thing.
  it("carries the chip and note in English", () => {
    lang = "en";
    renderWith({ eik: "177424500", consortiumEur: 600 });
    expect(screen.getByText("consortium")).toBeInTheDocument();
    expect(
      screen.getByText(/per-firm concentration is understated/),
    ).toBeInTheDocument();
  });
});
