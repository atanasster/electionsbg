// THE GATE for T3.1: МК's own ДКИ register against our four-list allowlist.
//
// It does not require Postgres — `dki_register.json` already carries the EIK the
// ingest resolved — so unlike a `.data.test.ts` it can never skip itself into
// silence on a machine without a database.
//
// ⚠️ WHAT IT CANNOT SEE. It reads the COMMITTED artifact, so it notices a
// change in МК's register only after somebody re-runs the ingest; the watcher
// (`mc_dki_register`) is what notices it live. And the reconciliation covers
// the RESOLVED institutes only — the 21 that are ambiguous or unmatched never
// enter it at all, so a ДКИ we cannot identify can never surface as a
// disagreement. `resolve.data.test.ts` covers the resolver itself.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  DKI_DISAGREEMENTS,
  disagreementsIn,
  listOf,
  type DkiRegisterFile,
} from "./reconcile";
import { DKI_PAGES } from "./sources";
import { MIN_PER_PAGE } from "./ingest";

// `__dirname`, not `process.cwd()` — the cwd form passes only when vitest is
// invoked from the repo root. And a missing artifact must name the command that
// produces it rather than failing collection with a raw ENOENT.
const FILE = path.resolve(__dirname, "../../../data/culture/dki_register.json");
if (!fs.existsSync(FILE))
  throw new Error(
    `${FILE} is missing — run \`npm run culture:dki -- --apply\` (needs local Postgres).`,
  );
const reg = JSON.parse(fs.readFileSync(FILE, "utf8")) as DkiRegisterFile;

describe("МК ДКИ register", () => {
  it("still parses to a full register on every page", () => {
    // МК hand-edits these pages. A template change parses to a handful of rows
    // and looks like a sector that closed; the ingest refuses below 5 per page
    // and this pins the shape the committed artifact was built from.
    expect(reg.coverage.listed).toBeGreaterThanOrEqual(65);
    const byPage = new Map<string, number>();
    for (const i of reg.institutes)
      byPage.set(i.pageId, (byPage.get(i.pageId) ?? 0) + 1);
    for (const p of DKI_PAGES)
      expect(
        byPage.get(p.id) ?? 0,
        `page ${p.id} parsed to nothing`,
      ).toBeGreaterThanOrEqual(MIN_PER_PAGE);
  });

  it("names a director and a seat for every institute", () => {
    // Both are the point of the ingest: the director is the independent check on
    // the declaration-derived officer layer (T2.3), and the seat is what puts a
    // ДКИ on a place surface. A parser regression shows up here first.
    const noDirector = reg.institutes
      .filter((i) => !i.director)
      .map((i) => i.name);
    const noCity = reg.institutes.filter((i) => !i.city).map((i) => i.name);
    expect(noDirector, "institutes with no director").toEqual([]);
    expect(noCity, "institutes with no seat").toEqual([]);
  });

  it("refuses an ambiguous name instead of guessing an EIK", () => {
    // Two register names are too generic to identify („ПРОФЕСИОНАЛНА ГИМНАЗИЯ ЗА
    // ПРИЛОЖНИ ИЗКУСТВА", with no town). Resolving one would attribute another
    // school's procurement to it. The count may move; it must never be that
    // every name resolved, which would mean the refusal stopped working.
    expect(reg.coverage.ambiguous).toBeGreaterThan(0);
    const resolvedEiks = reg.institutes.filter((i) => i.eik).map((i) => i.eik);
    expect(
      new Set(resolvedEiks).size,
      "one EIK claimed by two institutes",
    ).toBe(resolvedEiks.length);
  });

  it("has no disagreement with the allowlist that nobody has recorded", () => {
    // The reconciliation proper. Anything МК lists as its own ДКИ that our
    // roll-up does not carry is a live question about the sector's headline €,
    // so it must be DECLARED — with what we know — rather than discovered later
    // as a number that moved.
    const declared = new Set(DKI_DISAGREEMENTS.map((d) => d.eik));
    const live = disagreementsIn(reg);
    const undeclared = live.filter((d) => !declared.has(d.eik));
    expect(
      undeclared.map((d) => `${d.eik} (${d.list}) ${d.name}`),
      "МК lists these as its own ДКИ and our roll-up does not carry them. THREE " +
        "possible causes, and the first is NOT the likeliest-looking one: " +
        "(a) resolve.ts matched the WRONG body — check `corpusName` against the " +
        "register name before anything else; (b) our allowlist is missing a real " +
        "ДКИ; (c) МК's page is stale. Only once (a) is ruled out, add it to " +
        "DKI_DISAGREEMENTS in reconcile.ts or move it in kulturaReferenceData.ts.",
    ).toEqual([]);
  });

  it("has no stale entry in the declared disagreements", () => {
    // The other direction, and the one a growing exceptions table quietly loses:
    // an EIK that has since been moved into the roll-up must leave this list, or
    // the table stops describing the code.
    const liveEiks = new Set(disagreementsIn(reg).map((d) => d.eik));
    const stale = DKI_DISAGREEMENTS.filter((d) => !liveEiks.has(d.eik));
    expect(
      stale.map((d) => `${d.eik} ${d.name}`),
      "no longer a disagreement — remove it from DKI_DISAGREEMENTS",
    ).toEqual([]);
  });

  it("records each disagreement against the list the EIK is actually in", () => {
    for (const d of DKI_DISAGREEMENTS)
      expect(listOf(d.eik), `${d.eik} ${d.name}`).toBe(d.list);
  });

  it("resolved nothing whose corpus name is a different KIND of body", () => {
    // A cheap independent read on the resolver, from the artifact alone. Before
    // the resolver was fixed this would have caught „ДЪРЖАВНА ОПЕРА – БУРГАС"
    // resolving to Електроенергиен системен оператор ЕАД.
    //
    // ⚠️ The kind-word must be ABSENT FROM THE REGISTER NAME to mean anything.
    // Several real ДКИ art schools ARE гимназии and МК calls them that
    // („Национална гимназия за приложни изкуства «Свети Лука»"), so a flat
    // „does the corpus name say гимназия" test flags 7 correct resolutions. The
    // signal is a kind the register did NOT claim.
    const OTHER =
      /(еад|еоод|\bоод|оператор|комисия|гимназия|основно училище|болница|община)/gi;
    const kinds = (v: string) =>
      new Set((v.toLowerCase().match(OTHER) ?? []).map((m) => m.trim()));
    const suspicious = reg.institutes
      .filter((i) => i.eik && i.corpusName)
      .filter((i) => {
        const mine = kinds(i.name);
        return [...kinds(i.corpusName as string)].some((k) => !mine.has(k));
      })
      .map((i) => `${i.eik} ${i.name} -> ${i.corpusName}`);
    expect(suspicious, "resolved to a body of a different kind").toEqual([]);
  });

  it("keeps the evidence for every refusal it made", () => {
    // An `ambiguous` row exists to be adjudicated by hand; without the colliding
    // candidates the adjudicator has to re-run the resolver to see them.
    for (const i of reg.institutes.filter((x) => x.eikBasis === "ambiguous"))
      expect(
        i.ambiguousCandidates?.length ?? 0,
        `${i.name} was refused with no record of what it collided with`,
      ).toBeGreaterThan(1);
  });

  it("the disagreement gate still discriminates", () => {
    // A POSITIVE CONTROL. Both real arms are satisfied by a `disagreementsIn`
    // that returns nothing — the stale arm only catches that today because
    // DKI_DISAGREEMENTS happens to be non-empty. This pins the mechanism.
    const fake = {
      ...reg,
      institutes: [
        ...reg.institutes,
        {
          ...reg.institutes[0],
          name: "СИНТЕТИЧЕН ИНСТИТУТ",
          eik: "999999999",
          eikBasis: "exact" as const,
        },
      ],
    };
    expect(disagreementsIn(fake).map((d) => d.eik)).toContain("999999999");
    expect(listOf("999999999")).toBe("none");
  });

  it("keeps the coverage declaration honest", () => {
    // The register is a SUBSET of МК's own remit and a surface citing it must be
    // able to say so. If the three pages ever listed everything, the caveat on
    // /culture would become false in the other direction.
    expect(reg.coverage.listed).toBeLessThan(
      reg.coverage.dkiTotalPerMinistry ?? 74,
    );
    expect(reg.coverage.notListed?.length ?? 0).toBeGreaterThan(0);
  });
});
