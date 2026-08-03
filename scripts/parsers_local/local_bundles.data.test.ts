// One tur1 page → one município bundle. The data-level twin of the runtime gate in
// `parseLocalElection`, checking the artifacts that are actually committed rather than the
// run that produced them.
//
// This is the check that would have caught the original defect without knowing to look for
// Бяла: 265 pages produced 264 bundles in 2019 and 2023, because both "Бяла" pages resolved
// to VAR05 and the second município's mayor + council were dropped by the collision merge.
// A count is all it takes; nobody was counting.
// See docs/plans/village-mayor-attribution-v1.md §T0.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const CYCLES = ["2019_10_27_mi", "2023_10_29_mi"];

const pagesDir = (cycle: string) =>
  path.join(ROOT, "raw_data", cycle, "html", "tur1");
const bundlesDir = (cycle: string) =>
  path.join(ROOT, "data", cycle, "municipalities");

const pageCount = (cycle: string): number =>
  fs.readdirSync(pagesDir(cycle)).filter((f) => /^\d{4}\.html$/.test(f)).length;

// Sofia's 24 район shards are fanned out of the single SOF bundle, not parsed from a page of
// their own, so they are not part of the one-page-one-bundle identity.
const bundleCount = (cycle: string): number =>
  fs
    .readdirSync(bundlesDir(cycle))
    .filter((f) => f.endsWith(".json") && !/^S2\d{3}\.json$/.test(f)).length;

describe.each(CYCLES)("%s", (cycle) => {
  // raw_data and data/2* are both gitignored, so a fresh clone has neither side to compare.
  const havePages = fs.existsSync(pagesDir(cycle));
  const haveBundles = fs.existsSync(bundlesDir(cycle));

  // SELF-ARMING. The committed bundles for these cycles were produced BEFORE the oblast-aware
  // resolver, so they are still short by one município and this assertion would fail on work
  // that has not happened yet — the re-parse is the plan's §T1 step 1, deliberately a separate
  // change because it renumbers refs and needs the slug-lock purge alongside it.
  //
  // `RSE04.json` is the marker: it can only exist once a re-parse has run WITH the fix, since
  // that município is precisely what the collision used to swallow. So this test skips on
  // today's data and turns into a real gate the moment the re-parse lands — including for
  // anyone who re-parses without the fix, whose run is stopped by the throw in
  // `parseLocalElection` instead.
  const reparsed =
    haveBundles && fs.existsSync(path.join(bundlesDir(cycle), "RSE04.json"));
  const skip = !havePages
    ? "raw_data/<cycle>/html/tur1 absent (fresh clone)"
    : !haveBundles
      ? "data/<cycle>/municipalities absent (fresh clone)"
      : !reparsed
        ? "cycle predates the oblast-aware resolver — re-parse pending (plan §T1 step 1)"
        : false;

  it.skipIf(skip)("emits exactly one município bundle per tur1 page", () => {
    expect(bundleCount(cycle)).toBe(pageCount(cycle));
  });

  it.skipIf(skip)(
    "holds both Бяла municipalities, each with its own mayor",
    () => {
      const read = (code: string) =>
        JSON.parse(
          fs.readFileSync(
            path.join(bundlesDir(cycle), `${code}.json`),
            "utf-8",
          ),
        );
      const varna = read("VAR05");
      const ruse = read("RSE04");
      expect(varna.oikCode).toBe("0305");
      expect(ruse.oikCode).toBe("1804");
      // The half that the collision silently discarded.
      expect(ruse.mayor?.elected?.candidateName).toBeTruthy();
      expect((ruse.council ?? []).length).toBeGreaterThan(0);
      // …and the half it mis-filed: Ruse's villages must no longer sit in the Varna bundle.
      const varnaVillages = (varna.kmetstva ?? []).map(
        (k: { kmetstvoName: string }) => k.kmetstvoName,
      );
      expect(varnaVillages).not.toContain("Ботров");
      expect(varnaVillages).not.toContain("Полско Косово");
    },
  );
});
