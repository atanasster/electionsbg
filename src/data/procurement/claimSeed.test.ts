import { describe, it, expect } from "vitest";
import { extractClaimTerms, projectFromClaim } from "./claimSeed";
import { parseProjectSpec } from "./useProjectFile";

describe("extractClaimTerms — the fact-check keyword pass (§0g.4)", () => {
  it("keeps a hyphen/en-dash proper noun as one object token, dropping filler", () => {
    const t = extractClaimTerms(
      "Видин–Ботевград взе 35% аванс и нищо не е построено",
    );
    expect(t).toBe("Видин–Ботевград");
    expect(t).not.toMatch(/аванс|нищо/);
  });
  it("also joins an em-dash proper noun", () => {
    expect(extractClaimTerms("Проблемът с Видин—Ботевград е аванса")).toBe(
      "Видин—Ботевград",
    );
  });
  it("prefers a quoted phrase and does NOT leak the sentence-initial common word", () => {
    // real capitalized prose — the prefix-AND title search must not be polluted
    const t = extractClaimTerms('Договорът за „Западна дъга" е без търг');
    expect(t).toBe("Западна дъга");
    expect(t).not.toMatch(/Договорът/);
  });
  it("returns the object, not the firm, from a multi-proper-noun sentence", () => {
    // firms aren't in contract titles, so ANDing one in would zero the search;
    // the strongest non-opener proper noun (the object) wins
    const t = extractClaimTerms("Автомагистрали ЕАД строи Хемус без конкурс");
    expect(t).toBe("Хемус");
  });
  it("keeps the meaningful content word when there is no proper noun", () => {
    const t = extractClaimTerms("Санирането на блокове струва двойно");
    expect(t).toMatch(/блокове/);
    expect(t).not.toMatch(/\bна\b/);
  });
  it("returns empty for an empty/whitespace claim", () => {
    expect(extractClaimTerms("   ")).toBe("");
    expect(extractClaimTerms("")).toBe("");
  });
});

describe("projectFromClaim", () => {
  it("builds a spec that survives the ?q= validator", () => {
    const spec = projectFromClaim("Хемус се строи без открита процедура");
    expect(spec).not.toBeNull();
    expect(parseProjectSpec(JSON.stringify(spec))).not.toBeNull();
  });
  it("returns null when nothing distinctive can be extracted", () => {
    expect(projectFromClaim("  ")).toBeNull();
  });
});
