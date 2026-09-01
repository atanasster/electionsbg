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

  it("names the publication only for a reviewed source photo", () => {
    // ⚠️ THE PREFIX IS A CLAIM. „От публикацията на X" says a named publisher
    // ran this photograph with this article. Every one of the 40 records in
    // the corpus today is an illustration and the source_photo path has NO
    // production instance, so a fixture is the only thing that can hold it.
    expect(
      compactImageCredit(
        rights({ role: "source_photo", source_article_url: "https://ex.bg/a" }),
        { language: "bg", outlet: "Пример" },
      ),
    ).toBe("От публикацията на Пример · Снимка: OpenStreetMap");

    // An independently chosen work never names a publication.
    const illustration = compactImageCredit(rights({ role: "illustration" }), {
      language: "bg",
      outlet: "Пример",
    });
    expect(illustration).toBe("Илюстрация: OpenStreetMap");
    expect(illustration).not.toContain("Пример");

    expect(
      compactImageCredit(rights({ role: "official_image" }), {
        language: "bg",
        outlet: "Пример",
      }),
    ).toBe("Официално изображение: OpenStreetMap");
  });

  it("falls back to the neutral label when nobody stated a role", () => {
    // A bundle built before the field existed carries no role. Defaulting to
    // „Илюстрация" would state that about the first source photograph the
    // pipeline ever clears, before anybody reviewed it.
    for (const role of [undefined, null] as const)
      expect(
        compactImageCredit(rights({ role }), {
          language: "bg",
          outlet: "Пример",
        }),
      ).toBe("Изображение: OpenStreetMap");

    // And a source photo degrades to the narrower claim it can support —
    // never to a vaguer publisher one — in BOTH the ways it can lack support.
    expect(
      compactImageCredit(
        rights({ role: "source_photo", source_article_url: "https://ex.bg/a" }),
        { language: "bg", outlet: null },
      ),
      "no outlet to name",
    ).toBe("Снимка: OpenStreetMap");
    expect(
      compactImageCredit(rights({ role: "source_photo" }), {
        language: "bg",
        outlet: "Пример",
      }),
      "⚠️ no evidence — the caption must not name a publisher on the strength " +
        "of a role string alone",
    ).toBe("Снимка: OpenStreetMap");
  });

  it("keeps its own output stable when re-credited", () => {
    // The attribution cleaner strips a prefix this function itself emits, so
    // crediting an already-credited string is idempotent. Without the compound
    // forms it produced „Официално изображение: Официално изображение: X".
    for (const [role, credited] of [
      ["official_image", "Официално изображение: X"],
      ["illustration", "Илюстрация: X"],
      ["source_photo", "Снимка: X"],
    ] as const)
      expect(
        compactImageCredit(
          rights({ role, creator: null, credit_text: credited }),
          { language: "bg" },
        ),
      ).toBe(credited);
    expect(
      compactImageCredit(
        rights({
          role: "official_image",
          creator: null,
          credit_text: "Official image: X",
        }),
        { language: "en" },
      ),
    ).toBe("Official image: X");
  });

  it("is localised — it used to render Bulgarian in both languages", () => {
    // The function had no locale at all, so an English reader saw
    // „Изображение: X" on every card.
    expect(
      compactImageCredit(rights({ role: "illustration" }), {
        language: "en",
        outlet: "Example",
      }),
    ).toBe("Illustration: OpenStreetMap");
    expect(
      compactImageCredit(rights({ role: "official_image" }), {
        language: "en",
        outlet: "Example",
      }),
    ).toBe("Official image: OpenStreetMap");
    expect(
      compactImageCredit(
        rights({ role: "source_photo", source_article_url: "https://ex.bg/a" }),
        { language: "en", outlet: "Example" },
      ),
    ).toBe("From the article in Example · Photo: OpenStreetMap");
    expect(
      compactImageCredit(
        rights({ creator: " ", credit_text: "· file.png ·" }),
        {
          language: "en",
        },
      ),
    ).toBe("Image: verified source");
  });
});
