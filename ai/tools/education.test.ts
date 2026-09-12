import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanSchoolQuery, schoolMatura } from "./education";
import { fetchDb } from "./dataClient";

vi.mock("./dataClient", () => ({ fetchDb: vi.fn() }));

afterEach(() => vi.resetAllMocks());

const ctx = { lang: "bg", election: "2026_04_19" } as const;
const schools = [
  {
    id: "105001",
    name: 'Средно училище "Свети Свети Кирил и Методий"',
    address: "гр. Белица",
    obshtinaName: "Белица",
    latestYear: 2026,
    latestScore: 4.5,
    latestN: 20,
    ses: null,
    mathLatest: null,
  },
  {
    id: "107090",
    name: 'Средно училище "Свети Свети Кирил и Методий"',
    address: "гр. Якоруда",
    obshtinaName: "Якоруда",
    latestYear: 2026,
    latestScore: 4.2,
    latestN: 18,
    ses: null,
    mathLatest: null,
  },
  {
    id: "300121",
    name: 'Профилирана хуманитарна гимназия "Свети Свети Кирил и Методий"',
    address: "гр. Велико Търново",
    obshtinaName: "Велико Търново",
    latestYear: 2026,
    latestScore: 5.1,
    latestN: 40,
    ses: null,
    mathLatest: null,
  },
  {
    id: "200205",
    name: 'СУ "Св. Св. Кирил и Методий"',
    address: "гр. Пловдив",
    obshtinaName: "Пловдив",
    latestYear: 2026,
    latestScore: 4.8,
    latestN: 30,
    ses: null,
    mathLatest: null,
  },
];

describe("schoolMatura lookup", () => {
  it.each([
    ['училище " Свети Свети Кирил и Методий"', "Свети Свети Кирил и Методий"],
    ['гимназия "Пейо Яворов"', "Пейо Яворов"],
  ])("cleans school and gymnasium prompts: %s", (raw, expected) => {
    expect(cleanSchoolQuery(raw)).toBe(expected);
  });

  it("offers every matching school as a stable selectable option", async () => {
    vi.mocked(fetchDb).mockResolvedValue({ schools });

    const env = await schoolMatura(
      { school: 'училище " Свети Свети Кирил и Методий"' },
      ctx,
    );

    expect(env.clarify?.options).toHaveLength(4);
    expect(env.clarify?.options.map((option) => option.args)).toEqual([
      { school: "school-id:300121" },
      { school: "school-id:200205" },
      { school: "school-id:105001" },
      { school: "school-id:107090" },
    ]);
    expect(env.clarify?.options[0].sublabel).toContain("Велико Търново");
  });

  it("loads exactly the selected school by its stable id", async () => {
    vi.mocked(fetchDb).mockResolvedValue({ schools });

    const env = await schoolMatura({ school: "school-id:107090" }, ctx);

    expect(env.clarify).toBeUndefined();
    expect(env.facts.school).toBe(
      'Средно училище "Свети Свети Кирил и Методий"',
    );
    expect(env.facts.school_id).toBe("107090");
    expect(env.subtitle).toContain("Якоруда");
  });
});
