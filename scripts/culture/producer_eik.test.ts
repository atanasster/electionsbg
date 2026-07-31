// Guards the "overview.json is never left without EIKs" invariant on the
// COMMITTED artifact — the failure that shipped on 2026-07-31, when the ingest
// rewrote overview.json and the (then separate) EIK enrichment was not re-run:
// nothing threw, the file just lost every `eik` and the /culture producer rows
// stopped linking to /company/:eik. No network, no Postgres — it reads the file
// in the repo, so it fails on the commit rather than in production.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { coreName } from "./producer_eik";
import type { CultureOverviewFile } from "../../src/data/culture/types";

const OVERVIEW = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../data/culture/overview.json",
);

const overview = JSON.parse(
  fs.readFileSync(OVERVIEW, "utf8"),
) as CultureOverviewFile;

describe("culture overview.json — producer EIK links", () => {
  it("keeps a majority of the top producers linked to a company", () => {
    const linked = overview.topProducers.filter((p) => p.eik).length;
    // Baseline is 18/25; ambiguous names ("Клас", "АРС") are deliberately
    // unlinked, so this is a floor, not an equality.
    expect(overview.topProducers.length).toBeGreaterThan(0);
    expect(linked).toBeGreaterThanOrEqual(
      Math.ceil(overview.topProducers.length / 2),
    );
  });

  it("carries a well-formed 9- or 13-digit EIK wherever it links", () => {
    for (const p of overview.topProducers)
      if (p.eik) expect(p.eik).toMatch(/^\d{9}(\d{4})?$/);
  });
});

describe("coreName", () => {
  it("strips quotes and the legal form, and upper-cases", () => {
    expect(coreName('„Камера" ЕООД')).toBe("КАМЕРА");
    expect(coreName("Ню Бояна Филм АД")).toBe("НЮ БОЯНА ФИЛМ");
  });

  it("does not eat a legal form embedded in a word", () => {
    // `\b` does not fire around Cyrillic, hence the whitespace-delimited rule:
    // "АДА" must survive intact rather than losing a leading "АД".
    expect(coreName("АДА ФИЛМ ООД")).toBe("АДА ФИЛМ");
  });
});
