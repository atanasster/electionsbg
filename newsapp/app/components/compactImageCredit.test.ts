import { describe, expect, it } from "vitest";
import type { ImageRights } from "../data";
import { compactImageCredit } from "./imageCredit";

const rights = (over: Partial<ImageRights> = {}): ImageRights => ({
  status: "cc",
  creator: "OpenStreetMap",
  credit_text:
    "Илюстрация · Strait of Hormuz OSM.webp · https://www.openstreetmap.org/#map=11/26.5268/56.5109 · OpenStreetMap · CC BY 4.0",
  credit_url:
    "https://commons.wikimedia.org/wiki/File:Strait_of_Hormuz_OSM.webp",
  licence_name: "CC BY 4.0",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
  source_url:
    "https://commons.wikimedia.org/wiki/File:Strait_of_Hormuz_OSM.webp",
  checked_at: "2026-08-31",
  display_home: true,
  ...over,
});

describe("compactImageCredit", () => {
  it("prefers the reviewed creator and omits file, URL and licence noise", () => {
    const label = compactImageCredit(rights());

    expect(label).toBe("Изображение: OpenStreetMap");
    expect(label).not.toContain("http");
    expect(label).not.toContain(".webp");
    expect(label).not.toContain("CC BY 4.0");
  });

  it("cleans the recorded credit when no creator is available", () => {
    expect(
      compactImageCredit(
        rights({
          creator: null,
          credit_text:
            "Илюстрация · portrait.jpg · https://example.org/raw · Архив на автора · CC BY 4.0",
        }),
      ),
    ).toBe("Изображение: Архив на автора");
  });

  it("keeps long creator names intact instead of legally ambiguous truncation", () => {
    const creator = "A".repeat(180);
    expect(compactImageCredit(rights({ creator }))).toBe(
      `Изображение: ${creator}`,
    );
  });

  it("uses a neutral fallback when the recorded string is only payload noise", () => {
    expect(
      compactImageCredit(
        rights({
          creator: " ",
          credit_text:
            "Илюстрация · file.png · https://example.org · CC BY 4.0",
        }),
      ),
    ).toBe("Изображение: проверен източник");
  });
});
