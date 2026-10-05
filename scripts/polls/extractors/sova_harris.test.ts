import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AcquiredText } from "../lib/text_acquisition";
import { extractSovaHarris, parseVoteTable } from "./sova_harris";

// Verbatim tesseract output of the real bulletins (sovaharris.com pubs 4116
// and 4142, page 9) — including the OCR damage the parser must refuse.
const MARCH_PAGE = `СЪБРАНИЕ. СМЯТАТЕ ЛИ ДА ГЛАСУВАТЕ НА ТЕЗИ ИЗБОРИ?
Ще гласувам и вече съм решил/а за кого 468
| Ще гласувам, но още не съм решил/а за кого 19,3
Не съм решил/а дали да гласувам 16,1
| Няма да гласувам 17,0
| Без отговор 0,8
КОАЛИЦИЯ БИХТЕ ГЛАСУВАЛИ? (сред гласуващите за ПРОЦЕНТ
конкретна политическа сила)
ПРОГРЕСИВНА БЪЛГАРИЯ 30,9
| ГЕРБ - САС Г 193
| Коалиция ПРОДЪЛЖАВАМЕ ПРОМЯНАТА и | 122 |
ДЕМОКРАТИЧНА БЪЛГАРИЯ
АПС Ново Начало 74
ВЪЗРАЖДАНЕ 6,7
БСП за БЪЛГАРИЯ 4,4
МЕЧ 3,8
Коалиция "Сияние" | 292
ВЕЛИЧИЕ 25
Има Такъв Народ 2,2
АПС 1,8
| Друга партия 6,2 |
ПОЛитичеСКИ НАГЛАСИ в БЪЛГАРИЯ, МАТ 2026. Пе`;

const APRIL_PAGE = `4. ЗА КОЯ ПОЛИТИЧЕСКА СИЛА ЩЕ ГЛАСУВАТЕ НА
тата ЗА НАРОДНО СЪБРАНИЕ НА 191и
АПРИЛ? ПРОЦЕНТ

(САМО СРЕД ГЛАСУВАЩИТЕ ЗА КОНКРЕТНА
ПАРТИЯ/КОАЛИЦИЯ)
ПРОГРЕСИВНА БЪЛГАРИЯ 33,6
ГЕРБ-СДС С 190
КОАЛИЦИЯ ПРОДЪЛЖАВАМЕ ПРОМЯНАТА - па
ДЕМОКРАТИЧНА БЪЛГАРИЯ ,
| ДВИЖЕНИЕ ЗА ПРАВА И СВОБОДИ - ДПС шега
ВЪЗРАЖДАНЕ 78
ПП ВЕЛИЧИЕ 20
| Друга / Не подкрепям никого | 3,7 |
„ ПРОГРЕСИВНА БЪЛГАРИЯ пази
ГЕРБ-СДС 53
ПОЛИТИЧЕСКИ НАГЛАСИ В БЪЛГАРИЯ, АПРИЛ 206 Пот`;

const ARTICLE =
  "Данните са от представително за пълнолетното население на страната проучване, проведено от Агенция СОВА ХАРИС в периода 7 – 12 март 2026 г. сред 1000 български граждани по метода на стандартизираното face-to-face интервю в дома на респондента.";

describe("parseVoteTable", () => {
  it("accepts only comma-formatted values and refuses every damaged row", () => {
    const t = parseVoteTable(MARCH_PAGE)!;
    expect(t.claims.map((c) => [c.label, c.value])).toEqual([
      ["ПРОГРЕСИВНА БЪЛГАРИЯ", 30.9],
      ["ВЪЗРАЖДАНЕ", 6.7],
      ["БСП за БЪЛГАРИЯ", 4.4],
      ["МЕЧ", 3.8],
      ["Има Такъв Народ", 2.2],
      ["АПС", 1.8],
    ]);
    // „193", „122", „74", „292", „25" lost their comma — never repaired.
    expect(t.refused.map((r) => r.quote)).toEqual([
      "| ГЕРБ - САС Г 193",
      "| Коалиция ПРОДЪЛЖАВАМЕ ПРОМЯНАТА и | 122 | ДЕМОКРАТИЧНА БЪЛГАРИЯ",
      "АПС Ново Начало 74",
      'Коалиция "Сияние" | 292',
      "ВЕЛИЧИЕ 25",
    ]);
  });

  it('reads „Друга партия" as the other-parties residual, and the base phrase', () => {
    const t = parseVoteTable(MARCH_PAGE)!;
    expect(t.other?.value).toBe(6.2);
    expect(t.basePhrase).toBe("сред гласуващите за конкретна политическа сила");
  });

  it("ignores the turnout question above the vote table", () => {
    const labels = parseVoteTable(MARCH_PAGE)!.claims.map((c) => c.label);
    expect(labels.join()).not.toMatch(/гласувам/i);
  });

  it("drops no row: a row whose value OCR turned to letters is refused", () => {
    const t = parseVoteTable(APRIL_PAGE)!;
    expect(t.claims.map((c) => c.label)).toEqual(["ПРОГРЕСИВНА БЪЛГАРИЯ"]);
    const refusedQuotes = t.refused.map((r) => r.quote).join("\n");
    for (const q of [
      "ГЕРБ-СДС С 190",
      "ПРОМЯНАТА - па",
      "ДПС шега",
      "ВЪЗРАЖДАНЕ 78",
      "ПП ВЕЛИЧИЕ 20",
    ])
      expect(refusedQuotes).toContain(q);
  });

  it('refuses a pooled „Друга / Не подкрепям никого" row and stops at it', () => {
    const t = parseVoteTable(APRIL_PAGE)!;
    expect(t.other).toBeNull();
    expect(t.refused.some((r) => /Не подкрепям никого/.test(r.field))).toBe(
      true,
    );
    // The second (previous-wave) table below it is never read.
    expect(t.claims.some((c) => c.value === 53)).toBe(false);
  });

  it("reads the April heading wording and its base", () => {
    expect(parseVoteTable(APRIL_PAGE)!.basePhrase).toMatch(
      /САМО СРЕД ГЛАСУВАЩИТЕ ЗА КОНКРЕТНА ПАРТИЯ\/КОАЛИЦИЯ/,
    );
  });

  it("returns null for a page with no vote question", () => {
    expect(
      parseVoteTable("МЕТОДИКА НА ИЗСЛЕДВАНЕТО\nПериод: 7-12 март"),
    ).toBeNull();
  });
});

describe("extractSovaHarris", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sh-"));
    fs.writeFileSync(
      path.join(dir, "SOURCE.json"),
      JSON.stringify({
        url: "https://sovaharris.com/x/",
        fetchedAt: "2026-10-05T19:00:00.000Z",
        sha256: "c".repeat(64),
      }),
    );
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const acquired = (page: string): AcquiredText => ({
    articleText: ARTICLE,
    pdfTexts: [],
    imageTexts: [
      {
        file: "Buletin_Pol0326_page-0002.jpg",
        text: "МЕТОДИКА",
        looksLikeTable: true,
      },
      {
        file: "Buletin_Pol0326_page-0009.jpg",
        text: page,
        looksLikeTable: true,
      },
    ],
  });

  it("builds a fieldwork-keyed parliamentary draft from the article and the bulletin", async () => {
    const d = await extractSovaHarris(dir, "4116", acquired(MARCH_PAGE));
    expect(d.race).toBe("parliamentary");
    expect(d.poll.id).toBe("sh-2026-03-12");
    expect(d.poll.fieldwork).toBe("Mar 7-12 2026");
    expect(d.poll.respondents).toBe(1000);
    expect(d.residual?.otherNamedMinor).toBe(6.2);
    expect(d.poll.provenance?.basePhrase).toMatch(/сред гласуващите/);
    // The evidence gate keeps only rows whose quote states the value; short
    // labels („МЕЧ 3,8") are refused like Trend's — conservative, never wrong.
    expect(d.details.map((r) => r.nickName_bg)).toContain(
      "ПРОГРЕСИВНА БЪЛГАРИЯ",
    );
    expect(d.details.every((r) => Number.isFinite(r.support))).toBe(true);
    expect(d.refused.some((r) => r.field === "share:ГЕРБ - САС")).toBe(true);
  });

  it("refuses rather than guesses when the bulletin has no vote table", async () => {
    const d = await extractSovaHarris(dir, "4116", acquired("nothing here"));
    expect(d.details).toEqual([]);
    expect(d.refused.map((r) => r.field)).toContain("questions");
  });
});
