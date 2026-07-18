// SEED EXAMPLE — the "scripts pure function" layer. See docs/testing-standards.md.
//
// Data-pipeline code is mostly pure transforms (parse, normalize, derive an id).
// Test them the same way as frontend utils — input -> output, no I/O — but they
// run in the `node` Vitest project (no jsdom). Co-located *.test.ts, run with
// `npm run test:unit` (or the whole scripts subtree via a namespaced runner).
import { describe, expect, it } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it("transliterates Bulgarian and prefixes the result", () => {
    expect(slugify("Данъчни приходи", "eco")).toBe("eco-danachni-prihodi");
  });

  it("is deterministic — same input, same id", () => {
    expect(slugify("Общински съвет", "vote")).toBe(
      slugify("Общински съвет", "vote"),
    );
  });

  it("collapses punctuation/whitespace runs to single hyphens, trimmed", () => {
    expect(slugify("  А, Б  —  В  ", "x")).toBe("x-a-b-v");
  });

  it("caps the slug body at 60 chars", () => {
    const body = slugify("а".repeat(100), "p").slice("p-".length);
    expect(body.length).toBe(60);
  });

  it("falls back to the bare prefix when nothing survives folding", () => {
    expect(slugify("!!!", "p")).toBe("p");
    expect(slugify("", "p")).toBe("p");
  });
});
