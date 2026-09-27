// @vitest-environment node
// The person share cards (news-person-sentiment-v1 §6.3): a card per
// published person page, none when the person data is held, and a card that
// carries no more than its page — no mean, the full distribution.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { buildRoutes } from "./prerenderRoutes";
import {
  buildShareCards,
  cardUrl,
  personCardSvg,
  writeShareCards,
} from "./shareCards";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "news-cards-"));

const persons = (dir: string) =>
  fs.writeFileSync(
    path.join(dir, "persons.json"),
    JSON.stringify({
      generated_at: "2026-09-27T00:00:00Z",
      persons: [
        {
          id: "mp-1",
          kind: "person",
          name_bg: "Иван <Петров>",
          role_label: { bg: "Народен представител" },
          n: 12,
          outlet_count: 4,
          eligible: 14,
          counts: { unfavorable: 2, neutral: 9, favorable: 1 },
        },
      ],
    }),
  );

describe("share cards", () => {
  it("none while the person data is held", () => {
    expect(buildShareCards(tmp())).toEqual([]);
  });

  it("every person route and the index name a card that is built", () => {
    const dir = tmp();
    persons(dir);
    const cards = new Set(buildShareCards(dir).map((c) => cardUrl(c)));
    const routes = buildRoutes(dir).filter(
      (r) => r.path === "persons" || r.path.startsWith("person/"),
    );
    expect(routes.length).toBe(2);
    for (const r of routes) expect(cards.has(r.image!)).toBe(true);
    // The /en mirror carries its own, English card.
    const en = buildRoutes(dir).find((r) => r.path === "en/person/mp-1")!;
    expect(cards.has(en.image!)).toBe(true);
    expect(en.image).toContain("/og/en/persons/mp-1.png");
  });

  it("escapes the name and carries no mean", () => {
    const svg = personCardSvg({
      name: "Иван <Петров>",
      n: 12,
      outlets: 4,
      counts: { neutral: 12 },
    });
    expect(svg).toContain("Иван &lt;Петров&gt;");
    expect(svg).not.toMatch(/средно|mean/i);
    expect(svg).toContain("неутрално 12");
    // n is (outlet, story) units — never called „материала".
    expect(svg).not.toContain("материала");
  });

  it("changes its URL only when the card changes", () => {
    const dir = tmp();
    persons(dir);
    const a = buildShareCards(dir).map(cardUrl);
    expect(buildShareCards(dir).map(cardUrl)).toEqual(a);
    expect(a[1]).toMatch(/\/og\/persons\/mp-1\.png\?v=[0-9a-f]{10}$/);
  });

  it("renders a PNG per card", async () => {
    const dir = tmp();
    persons(dir);
    const out = tmp();
    const cards = buildShareCards(dir);
    expect(await writeShareCards(out, cards)).toBe(cards.length);
    const png = fs.readFileSync(path.join(out, cards[1].file));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });
});
