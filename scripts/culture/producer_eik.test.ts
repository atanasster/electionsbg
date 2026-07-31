// Guards the "overview.json is never left without EIKs" invariant on the
// COMMITTED artifact — the failure that shipped on 2026-07-31, when the ingest
// rewrote overview.json and the (then separate) EIK enrichment was not re-run:
// nothing threw, the file just lost every `eik` and the /culture producer rows
// stopped linking to /company/:eik. No network, no Postgres — it reads the file
// in the repo, so it fails on the commit rather than in production.
//
// The BEHAVIOURAL half (does linkProducerEiks throw instead of clearing?) needs a
// corpus and lives in scripts/db/tests/culture_producer_eik.data.test.ts.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { coreName } from "./producer_eik";
import { foldProducer } from "../../src/lib/foldProducer";
import type { CultureOverviewFile } from "../../src/data/culture/types";

const OVERVIEW = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../data/culture/overview.json",
);

// Read inside the tests, not at module scope: a missing artifact should fail as
// an assertion in this file, not as an import error that takes the suite down.
const readOverview = (): CultureOverviewFile =>
  JSON.parse(fs.readFileSync(OVERVIEW, "utf8")) as CultureOverviewFile;

describe("culture overview.json — producer EIK links", () => {
  it("keeps the top producers linked to a company", () => {
    const overview = readOverview();
    const linked = overview.topProducers.filter((p) => p.eik).length;
    expect(overview.topProducers.length).toBeGreaterThan(0);
    // RATCHET, not a floor-of-convenience: the committed baseline is 18/25 and
    // the deliberately-unlinked ones are ambiguous names ("Клас", "АРС") that hit
    // several companies. Lower it only with a measured reason — a loose "half"
    // bound absorbs a 6-link regression silently, which is the failure mode here.
    expect(linked).toBeGreaterThanOrEqual(18);
  });

  it("carries a well-formed 9- or 13-digit EIK wherever it links", () => {
    for (const p of readOverview().topProducers)
      if (p.eik) expect(p.eik).toMatch(/^\d{9}(\d{4})?$/);
  });

  it("has no producerFold that differs from another only by legal form", () => {
    // The ЕООД/ООД split that `\b` used to let through: two folds whose only
    // difference is a legal-form token mean one producer counted twice.
    const folds = readOverview().topProducers.map((p) => p.producerFold);
    expect(new Set(folds).size).toBe(folds.length);
    for (const f of folds)
      expect(f).not.toMatch(/(^|\s)(еоод|оод|еад|ад|ет)(\s|$)/);
  });
});

describe("coreName / foldProducer", () => {
  it("strips quotes and the legal form, and upper-cases", () => {
    expect(coreName('„Камера" ЕООД')).toBe("КАМЕРА");
    expect(coreName("Ню Бояна Филм АД")).toBe("НЮ БОЯНА ФИЛМ");
  });

  it("strips a legal form welded to the closing quote", () => {
    // The register writes it both ways; „Клас”ЕООД used to normalise to
    // КЛАСЕООД, which no TR name can equal and which forked the money into a
    // second bucket. Both spellings must land on the same key.
    expect(coreName("„Клас”ЕООД")).toBe("КЛАС");
    expect(coreName('„Клас" ЕООД')).toBe("КЛАС");
    expect(coreName("„Фронт филм”ООД")).toBe("ФРОНТ ФИЛМ");
    expect(foldProducer("„Клас”ЕООД")).toBe(foldProducer('„Клас" ЕООД'));
  });

  it("drops the Cyrillic legal form from the fold", () => {
    // `/\bЕООД\b/` never fired here — JS word boundaries are ASCII-only.
    expect(foldProducer("АДА ФИЛМ ЕООД")).toBe("ада филм");
    expect(foldProducer("Агитпроп ООД")).toBe("агитпроп");
  });

  it("does not eat a legal form embedded in a word", () => {
    // "АДА" must survive intact rather than losing a leading "АД".
    expect(coreName("АДА ФИЛМ ООД")).toBe("АДА ФИЛМ");
    expect(foldProducer("АДА ФИЛМ")).toBe("ада филм");
  });

  it("keeps punctuation in the match key but not in the fold", () => {
    // TR names carry the hyphen; the grouping key flattens it.
    expect(coreName("„Корунд-Х”ЕООД")).toBe("КОРУНД-Х");
    expect(foldProducer("„Корунд-Х”ЕООД")).toBe("корунд х");
  });
});
