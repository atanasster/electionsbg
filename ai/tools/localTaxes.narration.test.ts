import { expect, it, vi } from "vitest";
import * as place from "./place";
import * as data from "./dataClient";
import { localTaxes } from "./placesGov";
import { buildNarrationPrompt } from "../orchestrator/prompts";
it.each(["bg", "en"] as const)(
  "gives narration the same tax and average values as the table in %s",
  async (lang) => {
    const resolve = vi.spyOn(place, "resolveMunicipality").mockResolvedValue({
      obshtina: "PDV22",
      name: "Примерен град",
      nameEn: "Example City",
      oblast: "PDV-00",
      nuts3: "BG421",
      ekatte: "00000",
      oblastName: { bg: "Пример", en: "Example" },
    });
    const fetch = vi
      .spyOn(data, "fetchData")
      .mockResolvedValueOnce({
        indicators: [
          {
            key: "property",
            label: { bg: "Имотен данък", en: "Property tax" },
            unit: "%",
          },
        ],
        nationalAverages: { property: 2 },
      })
      .mockResolvedValueOnce({
        ipi: { property: { latestValue: 3, nationalRank: 10 } },
      });
    try {
      const e = await localTaxes(
        { place: "Example City" },
        { lang, election: "2024_10_27" },
      );
      const prompt = buildNarrationPrompt(e, lang);
      expect(e.rows?.[0]).toMatchObject({ value: "3 %", avg: "2 %" });
      expect(Object.values(e.facts)).toContain("3 %");
      expect(Object.values(e.facts)).toContain("2 %");
      expect(prompt.user).toContain("3 %");
      expect(prompt.user).toContain("2 %");
    } finally {
      resolve.mockRestore();
      fetch.mockRestore();
    }
  },
);
