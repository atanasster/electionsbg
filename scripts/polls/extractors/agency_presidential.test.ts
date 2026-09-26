import { describe, it, expect } from "vitest";
import { extractPresidentialTable } from "./agency_presidential";

describe("presidential table boundary", () => {
  it("keeps a single series under its voting heading", () => {
    const parsed = extractPresidentialTable(
      "Електорални нагласи - президентски избори\nРумен Радев 46,7%\nАнастас Герджиков 25,6%\nБаза: гласуващи\nГЕРБ-СДС 23,0%",
    );
    expect(parsed?.claims.map((c) => [c.label, c.value])).toEqual([
      ["Румен Радев", 46.7],
      ["Анастас Герджиков", 25.6],
    ]);
  });
  it("refuses Market Links' two-base chart instead of picking one column", () => {
    const parsed = extractPresidentialTable(
      "Електорални нагласи - президентски избори\nРумен Радев 39,9%\n46,7%\nАнастас Герджиков 20,9%\n25,6%\nБаза: всички 1112 и гласуващи 643",
    );
    expect(parsed?.claims).toEqual([]);
    expect(parsed?.refused[0].reason).toContain("column/base mapping");
  });
  it("stops at the next topic even when it has person percentages", () => {
    const parsed = extractPresidentialTable(
      "Електорални нагласи - президентски избори\nРумен Радев 46,7%\nДоверие в политиците\nБойко Борисов 30,1%",
    );
    expect(parsed?.claims.map((c) => c.label)).toEqual(["Румен Радев"]);
  });
  it("does not skip an unreadable vote chart to claim a later approval chart", () => {
    const parsed = extractPresidentialTable(
      "Електорални нагласи - президентски избори\n[unreadable chart]\nДоверие в политиците\nБойко Борисов 30,1%",
    );
    expect(parsed?.claims).toEqual([]);
    expect(parsed?.refused).toHaveLength(1);
  });
  it("does not turn presidential approval into vote intention", () => {
    expect(
      extractPresidentialTable(
        "Доверие в президента\nРумен Радев 60,5%\nНедоверие 20,2%",
      ),
    ).toBeNull();
  });
  it("never truncates a malformed 146% chart value into 46%", () => {
    const parsed = extractPresidentialTable(
      "Електорални нагласи - президентски избори\nРумен Радев 146%",
    );
    expect(parsed?.claims).toEqual([]);
    expect(parsed?.refused).toHaveLength(1);
  });
});
