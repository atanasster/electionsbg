import { describe, expect, it } from "vitest";
import { categoriesOf, parseDecisionText } from "./parse_decision";

// A synthetic decision in the layout every decision since 2007 uses. The names
// are invented.
const DECISION = `РЕШЕНИЕ № 3-69
Народно събрание: общо 2 401 лица. Проверени са 2 389 лица.
На основание чл. 26 Комисията установява и обявява принадлежност към органите по чл. 1 от Закона на:
Три имена: Иван Петров Тестов
Дата на раждане: 3.4.1950 г.
Място на раждане: гр. Пловдив
Вербувал го служител: Петър Служителов на 12.05.1975 г.
Структури, в които е осъществявано сътрудничеството: ДС, управление VI
Качеството, в което е осъществявано сътрудничеството: секретен сътрудник – агент
Псевдоними: Орел
Данни в наличните документи, въз основа на които е установена принадлежността
Комисията разполага с данни за сътрудничество след 10.11.1989 г.
Кандидат за народен представител в 16 МИР – Пловдив, издигнат от ПП „ПРИМЕР“ На основание чл. 29, ал. 6 Комисията
обявява, че за следните лица вече е обявена принадлежност:
Три имена: Мария Георгиева Пробна
Дата на раждане: 21.11.1961
Качеството: съдържател на явочна квартира (ЯК)
Решение за установяване и обявяване: решение № 2-1100/ 10.10.2015 г.
Публична длъжност: Общински съветник Комисията
Освен това на 3 /трима/ лица, данните за които не подлежат на публикуване, е установена принадлежност.
Председател: Някой Председателски
Три имена: Не Е Лице
`;

describe("parseDecisionText", () => {
  const d = parseDecisionText(DECISION);

  it("reads the header counts and the counted-only deceased", () => {
    expect(d.total).toBe(2401);
    expect(d.checked).toBe(2389);
    expect(d.deceased).toBe(3);
  });

  it("sums „Проверени са“ across a multi-body decision instead of keeping the first", () => {
    const multi = parseDecisionText(`РЕШЕНИЕ № 2-1
„ПРИМЕР МЕДИЯ“ ЕАД – вестник „Пример“ Проверени са 11 лица. Комисията не установи принадлежност.
„ДРУГ ИЗДАТЕЛ“ АД – вестник „Друг“ Проверени са 42 лица. Комисията не установи принадлежност.
„ТРЕТИ“ ООД – вестник „Трети“ Проверени са 1 205 лица.
Председател: Някой Председателски
`);
    expect(multi.checked).toBe(1258);
  });

  it("leaves checked null when no count is stated", () => {
    expect(parseDecisionText("РЕШЕНИЕ № 1\nНяма брой.").checked).toBeNull();
  });

  it("cuts the signature block, so nothing after „Председател:“ is a person", () => {
    expect(d.persons.map((p) => p.name)).toEqual([
      "Иван Петров Тестов",
      "Мария Георгиева Пробна",
    ]);
  });

  it("parses a new finding's fields and keeps only the recruitment YEAR", () => {
    const [p] = d.persons;
    expect(p).toMatchObject({
      section: "establish",
      birthDate: "1950-04-03",
      birthPlace: "гр. Пловдив",
      // „секретен сътрудник –“ is the generic prefix, not a second category
      categories: ["agent"],
      pseudonyms: "Орел",
      recruitYear: 1975,
      afterNov1989: true,
      party: "ПП „ПРИМЕР“",
      mir: "16",
      priorDecisions: [],
    });
    // the recruiting officer is a third party and must never be stored
    expect(JSON.stringify(p)).not.toContain("Служителов");
  });

  it("marks a re-disclosure and links its prior decision", () => {
    const p = d.persons[1];
    expect(p.section).toBe("already");
    expect(p.priorDecisions).toEqual(["2-1100"]);
    expect(p.categories).toEqual(["safehouse"]);
    expect(p.office).toBe("Общински съветник");
  });
});

describe("party", () => {
  const party = (tail: string) =>
    parseDecisionText(`Три имена: А Б В\nКандидат за кмет, издигнат от ${tail}`)
      .persons[0].party;

  it("stops at the trailing notes the 2007-2012 decisions append", () => {
    expect(party("ДПС Доклад на МВР № RB2/ 22.10.2007 г.")).toBe("ДПС");
    expect(party("БСП Забележка: Документите са получени")).toBe("БСП");
    expect(party("ПП ДПС Обявен с решение № 19/ 23.11.2007 г.")).toBe("ПП ДПС");
    expect(party("ГЕРБ и при условията на чл. 28 от Закона")).toBe("ГЕРБ");
    expect(party("ДПС За Ахмед Ибрямов Контилев липсват данни")).toBe("ДПС");
    expect(
      party("ПП „X“ Установява и обявява принадлежност към органите"),
    ).toBe("ПП „X“");
  });

  it("keeps a long coalition name whole", () => {
    expect(party("КП „Х“ (ПП „А“, ПП „Б“, ВМРО – БНД)")).toBe(
      "КП „Х“ (ПП „А“, ПП „Б“, ВМРО – БНД)",
    );
  });
});

describe("categoriesOf", () => {
  it("matches the abbreviations only as whole words — JS \\b is ASCII-only", () => {
    expect(categoriesOf("ЯК", "")).toEqual(["safehouse"]);
    expect(categoriesOf("ДЛ", "")).toEqual(["trusted"]);
    // „ЯКО" / „ДЛЪЖНОСТ" contain the letters and must not match
    expect(categoriesOf("ЯКОВ ДЛЪЖНОСТ", "")).toEqual([]);
    expect(categoriesOf("", "Качество: дагент")).toEqual([]);
  });

  it("falls back to the block's opening when the quality is unlabelled", () => {
    expect(categoriesOf("", "Три имена … щатен служител на ПГУ")).toEqual([
      "staff",
    ]);
  });

  it("never lets an empty field swallow the recruiter line", () => {
    const [p] =
      parseDecisionText(`Народно събрание: общо 10 лица. Проверени са 10 лица.
Комисията установява и обявява принадлежност на:
Три имена: Стоян Иванов Празен
Дата на раждане: 01.02.1955
Място на раждане:
Вербувал го служител: Офицер Офицеров на 03.04.1980 г.
Оперативни работници: Друг Офицер, Трети Офицер
Качество: агент
`).persons;
    expect(p.birthPlace).toBeNull();
    expect(p.recruitYear).toBe(1980);
    expect(p.qualityRaw).toBe("агент");
    expect(JSON.stringify(p)).not.toMatch(/Офицер/);
  });

  it("strips interleaved label tails and the reference column", () => {
    const [p] =
      parseDecisionText(`Народно събрание: общо 10 лица. Проверени са 10 лица.
Комисията установява и обявява принадлежност на:
Три имена: Георги Тестов Колонов
Дата на раждане: 05.06.1950
Вербувал го служител: Някой Някоев на Решение № 19 / 23.11. 2007 г. 1 18.06.1987 г.
Структури, в които е осъществявано ОУ на МВР-Бургас-ДС, отдел II, сътрудничеството
Качество агент -секретен 81 сътрудник
Кандидат общ. съветник в общ. Разлог, издигнат от ПП "РЗС" Доклад по чл. 16
`).persons;
    expect(p.recruitYear).toBe(1987);
    expect(p.structures).toBe("ОУ на МВР-Бургас-ДС, отдел II");
    expect(p.qualityRaw).toBe("агент сътрудник");
    expect(p.party).toBe('ПП "РЗС"');
  });
});
