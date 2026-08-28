// /topics — ranked by disagreement, not by volume.
//
// ⚠️ Every assertion here guards a rule that fails SILENTLY. A board sorted
// by article_count looks exactly like one sorted by spread; a topic with two
// positioned articles showing "2.00" looks exactly like one with two hundred;
// and a dash where a shortfall belongs reads as "these outlets agree".

import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TOPIC_MIN_POSITIONED,
  dominantAxis,
  type TaxonomyCategory,
} from "../data";

const FLOOR = TOPIC_MIN_POSITIONED;

const spread = (n: number, value: number | null) => ({
  spread: value,
  n,
  enough: n >= FLOOR,
});

const topic = (over: Partial<TaxonomyCategory> = {}): TaxonomyCategory =>
  ({
    id: "politics",
    label: { bg: "Политика", en: "Politics" },
    route: null,
    article_count: 10,
    story_count: 2,
    primary_count: 10,
    outlet_count: 4,
    leaning: {},
    russia_stance: {},
    spread: { leaning: spread(0, null), russia_stance: spread(0, null) },
    subcategories: [],
    ...over,
  }) as TaxonomyCategory;

const renderTopics = async (categories: TaxonomyCategory[]) => {
  vi.resetModules();
  vi.doMock("../data", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../data")>()),
    useTaxonomy: () => ({
      data: { version: 1, categories },
      error: null,
      loading: false,
    }),
  }));
  const { TopicsScreen } = await import("./TopicsScreen");
  render(
    <MemoryRouter>
      <TopicsScreen />
    </MemoryRouter>,
  );
};

const names = () =>
  [...document.querySelectorAll("tbody tr")].map(
    (r) => r.querySelectorAll("td")[0].textContent ?? "",
  );

const rowFor = (name: string) =>
  screen.getByText(name).closest("tr") as HTMLElement;

describe("the ranking", () => {
  beforeEach(() => vi.resetModules());

  it("puts disagreement above volume", async () => {
    // ⚠️ THE rule of the screen. The loud topic has 20x the articles and
    // nobody disagreeing; the quiet one is genuinely split.
    await renderTopics([
      topic({
        id: "loud",
        label: { bg: "Шумна", en: "Loud" },
        article_count: 400,
        leaning: { neutral: FLOOR },
        spread: { leaning: spread(FLOOR, 0.0), russia_stance: spread(0, null) },
      }),
      topic({
        id: "split",
        label: { bg: "Разделена", en: "Split" },
        article_count: 20,
        leaning: {
          strong_progressive: FLOOR / 2,
          strong_conservative: FLOOR / 2,
        },
        spread: { leaning: spread(FLOOR, 2.0), russia_stance: spread(0, null) },
      }),
    ]);
    expect(names()[0]).toContain("Разделена");
  });

  it("never lets a below-floor topic outrank a measured one", async () => {
    // A 2.00 read off two articles is the exact number a real polarised
    // topic produces. Without the guard it tops the board.
    await renderTopics([
      topic({
        id: "tiny",
        label: { bg: "Дребна", en: "Tiny" },
        article_count: 2,
        leaning: { strong_progressive: 1, strong_conservative: 1 },
        spread: { leaning: spread(2, 2.0), russia_stance: spread(0, null) },
      }),
      topic({
        id: "real",
        label: { bg: "Истинска", en: "Real" },
        article_count: 100,
        leaning: { neutral: FLOOR },
        spread: { leaning: spread(FLOOR, 0.4), russia_stance: spread(0, null) },
      }),
    ]);
    expect(names()[0]).toContain("Истинска");
  });

  it("ranks on each topic's OWN axis, not on a fixed one", async () => {
    // ⚠️ Every other ranking fixture leaves russia_stance empty, so
    // dominantAxis returns "leaning" every time and a comparator hard-coded
    // to `a.spread.leaning` passes them all. Here the two topics disagree
    // about which axis matters, and reading the wrong one inverts the order.
    await renderTopics([
      topic({
        id: "budget",
        label: { bg: "Бюджет", en: "Budget" },
        // Loud on the political axis, and mild.
        leaning: { neutral: FLOOR },
        spread: { leaning: spread(FLOOR, 0.3), russia_stance: spread(0, null) },
      }),
      topic({
        id: "ukraine",
        label: { bg: "Украйна", en: "Ukraine" },
        // Nearly silent politically, sharply split on Russia. Reading the
        // leaning axis here scores it 0.1 and sorts it last.
        leaning: { neutral: 2 },
        russia_stance: {
          strong_pro_russia: FLOOR / 2,
          strong_anti_russia: FLOOR / 2,
        },
        spread: {
          leaning: spread(2, 0.1),
          russia_stance: spread(FLOOR, 2.0),
        },
      }),
    ]);
    expect(names()[0]).toContain("Украйна");
    expect(
      within(rowFor("Украйна")).getByText("отношение към Русия"),
    ).toBeVisible();
    expect(within(rowFor("Бюджет")).getByText("политическа ос")).toBeVisible();
  });

  it("falls back to volume among below-floor topics", async () => {
    await renderTopics([
      topic({ id: "a", label: { bg: "Малка", en: "A" }, article_count: 5 }),
      topic({ id: "b", label: { bg: "Голяма", en: "B" }, article_count: 50 }),
    ]);
    expect(names()[0]).toContain("Голяма");
  });
});

describe("the off-topic bucket", () => {
  beforeEach(() => vi.resetModules());

  it("is shown, marked and counted — never dropped", async () => {
    // ⚠️ 143 of 365 analysed articles. Hiding it makes every share on this
    // page a fraction of an invisible denominator.
    await renderTopics([
      topic({
        id: "not-site-relevant",
        label: { bg: "Не е по темата", en: "Off topic" },
        article_count: 143,
        primary_count: 143,
      }),
      topic({ id: "x", label: { bg: "Друга", en: "Other" }, article_count: 3 }),
    ]);
    const row = rowFor("Не е по темата");
    expect(row).toBeVisible();
    expect(within(row).getByText("извън обхвата")).toBeVisible();
    expect(within(row).getByText("143")).toBeVisible();
    expect(within(row).getByText("143").textContent).toBe("143");
  });

  it("sinks below real topics despite being the largest", async () => {
    await renderTopics([
      topic({
        id: "not-site-relevant",
        label: { bg: "Не е по темата", en: "Off topic" },
        article_count: 143,
        primary_count: 143,
      }),
      topic({ id: "x", label: { bg: "Друга", en: "Other" }, article_count: 3 }),
    ]);
    expect(names()[0]).toContain("Друга");
  });
});

describe("the two counts", () => {
  beforeEach(() => vi.resetModules());

  it("keeps a row whose subcategory was retired from the taxonomy", async () => {
    // ⚠️ `article_count` sums the taxonomy's DECLARED subcategories, while
    // everything the page ranks by keys on the category. Retiring a
    // subcategory from topics.json therefore leaves a topic with a real
    // spread, a real outlet and article_count 0 — filtering on article_count
    // alone drops it silently.
    await renderTopics([
      topic({
        id: "society",
        label: { bg: "Общество", en: "Society" },
        article_count: 0,
        primary_count: 3,
        outlet_count: 1,
        leaning: { progressive: 3 },
        spread: { leaning: spread(3, 0.5), russia_stance: spread(0, null) },
      }),
    ]);
    expect(rowFor("Общество")).toBeVisible();
  });

  it("drops a topic with neither count", async () => {
    await renderTopics([
      topic({
        id: "empty",
        label: { bg: "Празна", en: "Empty" },
        article_count: 0,
        primary_count: 0,
      }),
    ]);
    expect(screen.queryByText("Празна")).toBeNull();
    expect(
      screen.getByText("Няма анализирани статии по нито една тема."),
    ).toBeVisible();
  });

  it("shows no floor notice when there are no rows at all", async () => {
    // ⚠️ Otherwise an empty corpus says both „no topic clears the floor" and
    // „no analysed articles" — two messages that contradict each other about
    // whether there is anything here.
    await renderTopics([]);
    expect(screen.queryByText(/Нито една тема още не стига прага/)).toBeNull();
  });
});

describe("the shortfall", () => {
  beforeEach(() => vi.resetModules());

  it("explains that neutral evaluations participate in the distribution", async () => {
    await renderTopics([topic()]);
    expect(
      screen.getByText(/Неутралната оценка участва в разпределението/),
    ).toBeVisible();
    expect(screen.queryByText(/те не влизат нито в разсейването/)).toBeNull();
  });

  it("states how far off it is, rather than showing a dash", async () => {
    // ⚠️ „—" and „0.00" both read as "these outlets agree". Neither is a
    // claim we have earned below the floor.
    await renderTopics([
      topic({
        id: "fp",
        label: { bg: "Външна политика", en: "Foreign" },
        russia_stance: { pro_russia: 15 },
        spread: { leaning: spread(4, 0.43), russia_stance: spread(15, 1.1) },
      }),
    ]);
    const row = rowFor("Външна политика");
    expect(
      within(row).getByText(`15 статии от нужните ${FLOOR}`),
    ).toBeVisible();
    expect(within(row).queryByText("1.10")).toBeNull();
  });

  it("agrees in number at n=1", async () => {
    await renderTopics([
      topic({
        id: "one",
        label: { bg: "Една", en: "One" },
        spread: { leaning: spread(1, null), russia_stance: spread(0, null) },
      }),
    ]);
    expect(
      within(rowFor("Една")).getByText(`1 статия от нужните ${FLOOR}`),
    ).toBeVisible();
  });

  it("distinguishes 'nobody takes a position' from 'too few do'", async () => {
    await renderTopics([
      topic({ id: "zero", label: { bg: "Нула", en: "Zero" } }),
      topic({
        id: "few",
        label: { bg: "Малко", en: "Few" },
        spread: { leaning: spread(3, 0.5), russia_stance: spread(0, null) },
      }),
    ]);
    expect(
      within(rowFor("Нула")).getByText(
        "нито една статия няма приложима оценка",
      ),
    ).toBeVisible();
    expect(
      within(rowFor("Малко")).getByText(`3 статии от нужните ${FLOOR}`),
    ).toBeVisible();
  });

  it("says 'secondary only' rather than 'nobody took a position'", async () => {
    // ⚠️ Two different facts, and only one of them is true of „Управление и
    // кабинет": tagged on 7 articles, the MAIN subject of 0. Saying nobody
    // took a position implies somebody was asked.
    await renderTopics([
      topic({
        id: "government",
        label: { bg: "Управление", en: "Government" },
        article_count: 7,
        primary_count: 0,
        outlet_count: 0,
      }),
      topic({
        id: "env",
        label: { bg: "Околна среда", en: "Env" },
        article_count: 11,
        primary_count: 11,
        spread: { leaning: spread(2, 0), russia_stance: spread(0, null) },
      }),
    ]);
    expect(
      within(rowFor("Управление")).getByText("само като второстепенна тема"),
    ).toBeVisible();
    expect(
      within(rowFor("Околна среда")).getByText(`2 статии от нужните ${FLOOR}`),
    ).toBeVisible();
  });

  it("shows both counts when they differ, and one when they agree", async () => {
    // The gap between them is exactly what explains an otherwise empty row.
    await renderTopics([
      topic({
        id: "government",
        label: { bg: "Управление", en: "Government" },
        article_count: 7,
        primary_count: 0,
      }),
      topic({
        id: "env",
        label: { bg: "Околна среда", en: "Env" },
        article_count: 11,
        primary_count: 11,
      }),
    ]);
    const gov = [...rowFor("Управление").querySelectorAll("td")][1];
    expect(gov.textContent).toBe("0/7");
    const env = [...rowFor("Околна среда").querySelectorAll("td")][1];
    expect(env.textContent).toBe("11");
  });

  it("says so above the table when NO topic clears the floor", async () => {
    // The corpus's actual state today. A page of dashes with no explanation
    // reads as broken rather than as honest.
    await renderTopics([topic()]);
    expect(screen.getByText(/Нито една тема още не стига прага/)).toBeVisible();
  });

  it("drops that notice once a topic does clear it", async () => {
    await renderTopics([
      topic({
        leaning: { neutral: FLOOR },
        spread: { leaning: spread(FLOOR, 0.8), russia_stance: spread(0, null) },
      }),
    ]);
    expect(screen.queryByText(/Нито една тема още не стига прага/)).toBeNull();
    expect(screen.getByText("0.80")).toBeVisible();
  });

  it("renders the sample beside a spread that DOES clear the floor", async () => {
    // ⚠️ The one branch no other fixture reaches, and the one where a bare
    // number does the most damage: the count printed next to it in the row is
    // `primary_count`, a much larger denominator (32 articles vs 15
    // positioned), so an unlabelled spread hands the reader the WRONG sample
    // rather than none.
    await renderTopics([
      topic({
        label: { bg: "Външна политика", en: "Foreign" },
        article_count: 38,
        primary_count: 32,
        leaning: { neutral: 25 },
        spread: { leaning: spread(25, 1.13), russia_stance: spread(0, null) },
      }),
    ]);
    const row = rowFor("Външна политика");
    expect(within(row).getByText("1.13")).toBeVisible();
    expect(within(row).getByText("от 25 статии")).toBeVisible();
  });

  it("agrees in number on a sample ending in 1 that is not 1", async () => {
    // ⚠️ Bulgarian agreement is on the LAST DIGIT, not the value: 21 статия,
    // but 11 статии. An `n === 1` test is right for exactly one number, and
    // 21 is reachable here — the floor is 20.
    await renderTopics([
      topic({
        label: { bg: "Двайсет и една", en: "TwentyOne" },
        primary_count: 30,
        leaning: { neutral: 21 },
        spread: { leaning: spread(21, 0.9), russia_stance: spread(0, null) },
      }),
      topic({
        id: "eleven",
        label: { bg: "Единайсет", en: "Eleven" },
        spread: { leaning: spread(11, 0.4), russia_stance: spread(0, null) },
      }),
    ]);
    expect(
      within(rowFor("Двайсет и една")).getByText("от 21 статии"),
    ).toBeVisible();
    expect(
      within(rowFor("Единайсет")).getByText(`11 статии от нужните ${FLOOR}`),
    ).toBeVisible();
  });
});

describe("dominantAxis", () => {
  it("picks the axis with more positioned articles, per topic", () => {
    // ⚠️ Chosen PER TOPIC. Ukraine splits on the Russia axis, the budget on
    // the political one; one fixed axis renders the wrong disagreement.
    expect(
      dominantAxis({
        spread: { leaning: spread(4, 0.4), russia_stance: spread(15, 1.1) },
      }),
    ).toBe("russia_stance");
    expect(
      dominantAxis({
        spread: { leaning: spread(30, 0.4), russia_stance: spread(2, 1.1) },
      }),
    ).toBe("leaning");
  });

  it("prefers leaning on a tie, including the empty case", () => {
    expect(
      dominantAxis({
        spread: { leaning: spread(0, null), russia_stance: spread(0, null) },
      }),
    ).toBe("leaning");
  });
});

describe("the bar and the number describe the same thing", () => {
  beforeEach(() => vi.resetModules());

  it("draws the distribution of the axis the row is ranked by", async () => {
    // Drawing the leaning bar beside a Russia-axis spread is two different
    // claims sharing a row, and neither is labelled.
    await renderTopics([
      topic({
        id: "fp",
        label: { bg: "Външна политика", en: "Foreign" },
        leaning: { neutral: 4 },
        russia_stance: { strong_pro_russia: 10, strong_anti_russia: 10 },
        spread: {
          leaning: spread(4, 0.0),
          russia_stance: spread(20, 2.0),
        },
      }),
    ]);
    const row = rowFor("Външна политика");
    expect(within(row).getByText("отношение към Русия")).toBeVisible();
    // The bar's own screen-reader summary names its labels, so this asserts
    // on CONTENT rather than on a colour — jsdom re-serializes the hex as
    // rgb(), so an assertion on "#b91c1c" fails against a correct bar.
    expect(
      within(row).getByText("Силно проруска: 10, Силно антируска: 10"),
    ).toBeInTheDocument();
    expect(within(row).queryByText(/Център|прогресивно/i)).toBeNull();
  });
});
