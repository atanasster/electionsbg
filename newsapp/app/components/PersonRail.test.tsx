import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  JevArticleSentiment,
  JevScore,
  JevSubject,
  PersonBaselines,
} from "../data";
import { NewsLocaleProvider } from "../i18n";

const baselines: { current: PersonBaselines | null } = { current: null };
vi.mock("../data", async (orig) => ({
  ...(await orig<typeof import("../data")>()),
  usePersonBaselines: () => ({ data: baselines.current }),
}));

const { PersonRail } = await import("./PersonRail");

const score = (value: number): JevScore => ({
  value,
  normalized: value / 2,
  spread: 0.3,
  confidence: 0.9,
  levels: 5,
  both_directions: false,
  bucket_index: value <= -0.5 ? 1 : value >= 0.5 ? 3 : 2,
});

const jev = (subjects: JevSubject[]) =>
  ({
    rubric_version: "r",
    model: "m",
    assessed_at: null,
    axes: {},
    text_scope: { kind: "full" },
    person_rail: true,
    person_baselines: true,
    subjects,
  }) as Extract<JevArticleSentiment, { withheld?: undefined }>;

const radev: JevSubject = {
  name: "Радев",
  kind: "person",
  subject_role: "primary",
  mentions: 4,
  tone: score(-0.9),
  identity: {
    kind: "person",
    id: "mp-5142",
    basis: "surname_alias",
    canonical: "Румен Георгиев Радев",
    role: "president",
    role_current: false,
    role_label: {
      bg: "Президент / вицепрезидент",
      en: "President / vice-president",
    },
  },
};

const draw = (subjects: JevSubject[]) =>
  render(
    <MemoryRouter>
      <NewsLocaleProvider language="bg">
        <PersonRail jev={jev(subjects)} articlePath="/article/a.bg/1" />
      </NewsLocaleProvider>
    </MemoryRouter>,
  );

describe("PersonRail", () => {
  it("names the register's person, the article's spelling and a former office", () => {
    baselines.current = null;
    draw([radev]);
    const row = screen.getByTestId("person-rail-row");
    expect(within(row).getByText("Румен Георгиев Радев")).toBeInTheDocument();
    expect(row.textContent).toContain("в текста: „Радев“");
    // First and last name — never the patronymic.
    expect(row.textContent).toContain("РР");
    // ⚠️ A role that has ended never renders without „бивш".
    expect(row.textContent).toContain("бивш: Президент / вицепрезидент");
    expect(row.textContent).toContain("основен субект");
    expect(row.textContent).toContain("негативен");
    expect(
      within(row).getByRole("link", { name: /профил в Наясно/ }),
    ).toHaveAttribute("href", "https://naiasno.bg/person/mp-5142");
  });

  it("links to the person page and prints the baseline only when there is a page", () => {
    baselines.current = null;
    draw([radev]);
    expect(screen.queryByTestId("person-rail-baseline")).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Румен Георгиев Радев" }),
    ).toBeNull();
  });

  it("with a page: the baseline in words, over the OTHER articles", () => {
    baselines.current = {
      generated_at: "t",
      persons: { "mp-5142": { n: 11, sum: -0.9, levels: 5 } },
    };
    draw([radev]);
    expect(screen.getByTestId("person-rail-baseline").textContent).toContain(
      "в други материали: обикновено неутрален · 10",
    );
    expect(
      screen.getByRole("link", { name: "Румен Георгиев Радев" }),
    ).toHaveAttribute("href", "/person/mp-5142");
    // Words, not a second marker on the same bar.
    expect(screen.getAllByTestId("scale-marker")).toHaveLength(1);
  });

  it("shows a person with no profile, and folds the ambiguous and the passing", () => {
    baselines.current = null;
    draw([
      {
        name: "Доналд Тръмп",
        kind: "person",
        subject_role: "secondary",
        mentions: 2,
        tone: score(0),
        identity: null,
        refused_reason: "no_match",
      },
      {
        name: "Костадин Костадинов",
        kind: "person",
        subject_role: "secondary",
        mentions: 2,
        tone: score(0),
        identity: null,
        refused_reason: "ambiguous",
      },
      {
        name: "Делян Пеевски",
        kind: "person",
        subject_role: "incidental",
        mentions: 1,
      },
    ]);
    const row = screen.getByTestId("person-rail-row");
    expect(row.textContent).toContain("без профил");
    expect(within(row).queryByRole("link")).toBeNull();
    expect(screen.getByTestId("person-rail-unresolved").textContent).toContain(
      "Костадин Костадинов*",
    );
    expect(screen.getByTestId("person-rail-passing").textContent).toContain(
      "Делян Пеевски",
    );
  });

  it("marks a conflict and never renders one identity twice", () => {
    baselines.current = null;
    draw([
      { ...radev, conflict: true },
      { ...radev, name: "Румен Радев" },
    ]);
    expect(screen.getAllByTestId("person-rail-row")).toHaveLength(1);
    expect(screen.getByTestId("person-rail-conflict")).toBeInTheDocument();
  });

  it("each row has a correction link naming the person", () => {
    baselines.current = null;
    draw([radev]);
    const link = screen.getByRole("link", { name: /сигнализирай/ });
    const body = new URL(link.getAttribute("href")!).searchParams.get("body")!;
    expect(body).toContain("Румен Георгиев Радев (mp-5142)");
    expect(body).toContain("https://news.electionsbg.com/article/a.bg/1");
  });

  it("renders nothing for an article that names no person", () => {
    const { container } = draw([]);
    expect(container.textContent).toBe("");
  });
});
