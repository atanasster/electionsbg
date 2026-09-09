import { describe, expect, it } from "vitest";
import { classifyRace } from "./classify_race";

describe("classifyRace", () => {
  it("classifies a real Trend title as parliamentary", () => {
    expect(
      classifyRace(
        "Електорални нагласи спрямо предстоящите парламентарни избори (Април 2026)",
      ),
    ).toBe("parliamentary");
  });

  it("classifies the real Global Metrics July 2026 title as presidential", () => {
    expect(
      classifyRace(
        "Обществени нагласи юли 2026: вотът за президентските избори е все още неясен",
      ),
    ).toBe("presidential");
  });

  it("classifies the real GM PDF question-framing sentence as presidential (body-text path)", () => {
    expect(
      classifyRace(
        "Обществени нагласи",
        "Ако президентските избори бяха следващата неделя за кандидат " +
          "президент от коя политическа сила бихте гласували?",
      ),
    ).toBe("presidential");
  });

  it("does NOT misclassify a genuinely parliamentary poll that mentions the presidency in passing", () => {
    // The real Alpha Research Feb 2026 text (raw_data/polls/alpha_research/1043):
    // discusses Radev LEAVING the presidency to run in the parliamentary
    // race — a bare "президентск" stem match would misfire here.
    expect(
      classifyRace(
        "Общественополитически и електорални нагласи, февруари 2026",
        "заявката на Румен Радев да напусне президентския пост, за да " +
          "участва в предсрочните парламентарни избори със свой " +
          "политически проект.",
      ),
    ).toBe("parliamentary");
  });

  it("prefers the title over the body when the title alone already states the race", () => {
    // Title says parliamentary; body happens to mention "президент" in an
    // unrelated context — title wins outright, body is never consulted.
    expect(
      classifyRace(
        "Електорални нагласи спрямо предстоящите парламентарни избори",
        "Президентът на републиката коментира резултатите.",
      ),
    ).toBe("parliamentary");
  });

  it("defaults to parliamentary when neither signal fires anywhere", () => {
    expect(
      classifyRace(
        "Политически нагласи в България",
        "Обичайният месечен коментар.",
      ),
    ).toBe("parliamentary");
  });

  it("recognizes 'кандидат президент' and 'избори за президент' phrasings too", () => {
    expect(classifyRace("Кой ще е кандидат президент на ГЕРБ?")).toBe(
      "presidential",
    );
    expect(classifyRace("Всичко за изборите за президент през ноември")).toBe(
      "presidential",
    );
  });

  it("recognizes the definite-plural 'парламентарните избори' form, not just the indefinite one", () => {
    expect(
      classifyRace("Резултатите от парламентарните избори вече са ясни"),
    ).toBe("parliamentary");
  });
});
