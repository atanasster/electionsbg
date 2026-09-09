import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractArticleText } from "./text_acquisition";
import { extractSharesBySentenceRule } from "./sentence_rule";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const rawCapture = (agencyDir: string, pubId: string): string =>
  path.join(REPO_ROOT, "raw_data/polls", agencyDir, pubId);

describe("extractSharesBySentenceRule — synthetic cases", () => {
  it("extracts a plain '<party> ... <n>,<d>%' sentence", () => {
    expect(
      extractSharesBySentenceRule(
        "Прогресивна България остава лидер с 33,2% подкрепа.",
      ),
    ).toEqual([
      {
        label: "Прогресивна България",
        value: 33.2,
        quote: "Прогресивна България остава лидер с 33,2%",
      },
    ]);
  });

  it("extracts the parenthetical form", () => {
    expect(extractSharesBySentenceRule("ПП-ДБ (11,2%) запазва...")).toEqual([
      { label: "ПП-ДБ", value: 11.2, quote: "ПП-ДБ (11,2%" },
    ]);
  });

  it("bounds a compound sentence naming two parties, so neither number attaches to the wrong one", () => {
    const claims = extractSharesBySentenceRule(
      "ще спорят ПП-ДБ (10,9%) и ДПС-Ново начало (10,5%).",
    );
    expect(claims).toEqual([
      { label: "ПП-ДБ", value: 10.9, quote: "ПП-ДБ (10,9%" },
      {
        label: "ДПС-Ново начало",
        value: 10.5,
        quote: "ДПС-Ново начало (10,5%",
      },
    ]);
  });

  it("produces no claim for a value with no recognisable label (a periphrasis)", () => {
    expect(
      extractSharesBySentenceRule(
        "новата формация на Румен Радев събира подкрепата на 32.7% от гласуващите.",
      ),
    ).toEqual([]);
  });

  it("tolerates a dash-style/whitespace mismatch against the alias table's own spelling", () => {
    // aliases.ts's key is "ДПС - Ново Начало" (spaced dash, capital Н); the
    // real page (measured 2026-09-09) writes "ДПС-Ново начало" with neither.
    expect(extractSharesBySentenceRule("ДПС-Ново начало (10,5%)")).toEqual([
      {
        label: "ДПС-Ново начало",
        value: 10.5,
        quote: "ДПС-Ново начало (10,5%",
      },
    ]);
  });

  it("prefers the longer, more specific label over a prefix it contains", () => {
    expect(extractSharesBySentenceRule("ГЕРБ-СДС с 20,4%.")).toEqual([
      { label: "ГЕРБ-СДС", value: 20.4, quote: "ГЕРБ-СДС с 20,4%" },
    ]);
  });

  it("does not match a short label as a substring of an unrelated longer word", () => {
    // "СБ" is a recognised label ("Синя България"'s value in
    // POLL_TO_ACTUAL); it must not fire when those two letters sit inside a
    // longer word rather than standing alone.
    expect(extractSharesBySentenceRule("нещоСБтук с 5%.")).toEqual([]);
    expect(extractSharesBySentenceRule("СБ с 5%.")).toEqual([
      { label: "СБ", value: 5, quote: "СБ с 5%" },
    ]);
  });

  it("refuses to guess when a window carries more than one percent-shaped number", () => {
    // A before/after comparison — "22%" is last month's value, "20,4%" the
    // current one — and neither position is a safe general rule for which
    // one is right (the sibling case below puts the true value FIRST
    // instead). Guessing either would be a wrong value silently accepted,
    // not merely an omission — so the window is refused outright.
    expect(
      extractSharesBySentenceRule(
        "ГЕРБ-СДС отбелязва спад от 22% на 20,4% през последния месец.",
      ),
    ).toEqual([]);
    // The parliamentary-barrier threshold stated beside the party's own
    // number is the same shape: "4%" is the barrier, not БСП's own share.
    expect(
      extractSharesBySentenceRule(
        "БСП е под 4% бариера, но всъщност регистрира 3,8% подкрепа.",
      ),
    ).toEqual([]);
  });

  it("still extracts the single value when only one percent appears, even in a similarly-worded sentence", () => {
    // Same "party ... comparison" shape as the refused case above, but with
    // only ONE percent-shaped number in the window — nothing ambiguous.
    expect(
      extractSharesBySentenceRule(
        "ГЕРБ-СДС е на 20,4%, ръст спрямо миналия месец.",
      ),
    ).toEqual([
      {
        label: "ГЕРБ-СДС",
        value: 20.4,
        quote: "ГЕРБ-СДС е на 20,4%",
      },
    ]);
  });
});

describe("extractSharesBySentenceRule — real Trend captures", () => {
  it("212637: extracts every labelled mention, skipping only the unlabelled leader", () => {
    const html = fs.readFileSync(
      path.join(rawCapture("trend", "212637"), "page.html"),
      "utf8",
    );
    const claims = extractSharesBySentenceRule(extractArticleText("TR", html));
    const byLabel = Object.fromEntries(claims.map((c) => [c.label, c.value]));
    expect(byLabel).toEqual({
      "ГЕРБ-СДС": 20.4,
      "ПП-ДБ": 10.9,
      "ДПС-Ново начало": 10.5,
      Възраждане: 7.8,
      БСП: 3.8,
      МЕЧ: 3.6,
      "Има такъв народ": 2.5,
      "Алиансът за права и свободи": 1.7,
      Величие: 1.6,
    });
    // The lead formation ("новата формация на Румен Радев", 32.7%) has no
    // recognisable label in this post — correctly absent, never guessed.
    expect(claims.some((c) => c.value === 32.7)).toBe(false);
  });

  it("212732: extracts the same party under two different label spellings, deliberately without merging them", () => {
    // The headline sentence says "БСП" (4%); the body sentence separately
    // says "БСП-ОЛ" (also 4%) — the same real party under the ballot's
    // split naming (see aliases.ts's ДПС/БСП-ОЛ ambiguity comment). This
    // module does not attempt to merge same-value claims under different
    // labels — a wrong auto-merge could silently conflate two genuinely
    // different small parties that happen to poll at the same round
    // number — so both are expected here, left for a human to reconcile.
    const html = fs.readFileSync(
      path.join(rawCapture("trend", "212732"), "page.html"),
      "utf8",
    );
    const claims = extractSharesBySentenceRule(extractArticleText("TR", html));
    const byLabel = Object.fromEntries(claims.map((c) => [c.label, c.value]));
    expect(byLabel["БСП"]).toBe(4);
    expect(byLabel["БСП-ОЛ"]).toBe(4);
  });

  it("212750: extracts every labelled mention", () => {
    const html = fs.readFileSync(
      path.join(rawCapture("trend", "212750"), "page.html"),
      "utf8",
    );
    const claims = extractSharesBySentenceRule(extractArticleText("TR", html));
    const byLabel = Object.fromEntries(claims.map((c) => [c.label, c.value]));
    expect(byLabel).toEqual({
      "Прогресивна България": 33.2,
      "ГЕРБ-СДС": 19.1,
      "ПП-ДБ": 11.2,
      ДПС: 10.2,
      Възраждане: 7.1,
      БСП: 4,
      Сияние: 3.9,
      МЕЧ: 3.7,
      "Има такъв народ": 2.1,
      Величие: 1.7,
      "Алианс за права и свободи": 1.6,
      "Синя България": 1,
    });
  });
});
