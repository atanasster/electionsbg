import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRESIDENTIAL_CYCLES,
  PRESIDENTIAL_SOURCES,
  archivesToFetch,
  presidentialSource,
  roundFolderName,
  type RoundNumber,
  type RoundSource,
} from "./sources";
import { decodeBundleText } from "./encoding";
import { PRESIDENT_BLOCK } from "../machines_memory/index";
import {
  electionFolderIsoDate,
  electionFolderKind,
} from "../lib/electionFolders";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const RAW = path.join(PROJECT_ROOT, "raw_data");
const entries = Object.values(PRESIDENTIAL_SOURCES);

describe("the source map is internally consistent", () => {
  it("covers the five machine-readable cycles", () => {
    expect(PRESIDENTIAL_CYCLES).toEqual([
      "2021_11_14_pvr",
      "2016_11_06_pvr",
      "2011_10_23_pvr",
      "2006_10_22_pvr",
      "2001_11_11_pvr",
    ]);
  });

  it("keys every entry by its own cycle id", () => {
    for (const [key, source] of Object.entries(PRESIDENTIAL_SOURCES)) {
      expect(source.cycle, key).toBe(key);
    }
  });

  // The id IS the round-1 date, and `electionFolderKind` is what the pipeline's
  // sweeps classify it with — so a typo in either place would put a cycle in this map
  // that no sweep recognises as presidential.
  it("uses ids the folder predicate reads as presidential", () => {
    for (const source of entries) {
      expect(electionFolderKind(source.cycle), source.cycle).toBe(
        "presidential",
      );
    }
  });

  // ⚠ The one invariant that catches a copy-paste between neighbouring entries: the
  // date embedded in the folder id must be the date round 1 was actually held.
  it("agrees with its own id about when round 1 was", () => {
    for (const source of entries) {
      expect(source.rounds[1].date, source.cycle).toBe(
        electionFolderIsoDate(source.cycle),
      );
    }
  });

  it("holds round 2 a week after round 1, as the constitution requires", () => {
    for (const source of entries) {
      const r1 = Date.parse(`${source.rounds[1].date}T00:00:00Z`);
      const r2 = Date.parse(`${source.rounds[2].date}T00:00:00Z`);
      expect((r2 - r1) / 86_400_000, source.cycle).toBe(7);
    }
  });

  it("points every round at an archive that exists in its own entry", () => {
    for (const source of entries) {
      for (const round of [1, 2] as RoundNumber[]) {
        const key = source.rounds[round].archive;
        expect(
          Object.keys(source.archives),
          `${source.cycle} round ${round}`,
        ).toContain(key);
      }
    }
  });

  it("gives every archive an https url and a warm url on the same host", () => {
    for (const source of entries) {
      for (const [key, a] of Object.entries(source.archives)) {
        expect(a.url, `${source.cycle}/${key}`).toMatch(/^https:\/\//);
        expect(a.url).toMatch(/\.zip$/);
        expect(new URL(a.warmUrl).host, `${source.cycle}/${key} warm`).toBe(
          new URL(a.url).host,
        );
      }
    }
  });

  it("resolves a cycle by id and by ЦИК slug, and refuses anything else", () => {
    expect(presidentialSource("2021_11_14_pvr")?.slug).toBe("pvrns2021");
    expect(presidentialSource("pvrns2021")?.cycle).toBe("2021_11_14_pvr");
    expect(presidentialSource("pvr2006")?.era).toBe("2006");
    expect(presidentialSource("2026_04_19")).toBeNull();
    expect(presidentialSource("nonsense")).toBeNull();
    // ⚠ "anything else" includes Object.prototype's keys: a truthiness test on the
    // index returns `Function.prototype.toString` for "toString", typed as a
    // PresidentialSource, and the caller reads `.cycle` off a function.
    for (const k of [
      "toString",
      "constructor",
      "valueOf",
      "hasOwnProperty",
      "__proto__",
    ]) {
      expect(presidentialSource(k), k).toBeNull();
    }
  });
});

describe("archivesToFetch", () => {
  // ⚠ 2016 and 2001 publish ONE archive holding both rounds — 2016's `tur2/export.zip`
  // is byte-identical to `tur1`'s. A downloader iterating rounds would fetch the same
  // file twice and imply the source publishes two.
  it("collapses the cycles that ship both rounds in one archive", () => {
    for (const cycle of ["2016_11_06_pvr", "2001_11_11_pvr"]) {
      const fetched = archivesToFetch(PRESIDENTIAL_SOURCES[cycle]);
      expect(fetched, cycle).toHaveLength(1);
      expect(fetched[0].rounds, cycle).toEqual([1, 2]);
    }
  });

  it("keeps two archives where the source really publishes two", () => {
    for (const cycle of [
      "2021_11_14_pvr",
      "2011_10_23_pvr",
      "2006_10_22_pvr",
    ]) {
      const fetched = archivesToFetch(PRESIDENTIAL_SOURCES[cycle]);
      expect(fetched, cycle).toHaveLength(2);
      expect(fetched.flatMap((f) => f.rounds).sort(), cycle).toEqual([1, 2]);
    }
  });

  it("returns the archive object itself, not just its key", () => {
    const [only] = archivesToFetch(PRESIDENTIAL_SOURCES["2001_11_11_pvr"]);
    expect(only.archive.url).toContain("2001_prezident.zip");
    expect(only.archive.strategy).toBe("goto");
  });
});

describe("the map matches the trees on disk", () => {
  // The trees are committed, so this is a real check on CI as well as locally — and
  // it is what would catch a cycle added to the map with nothing behind it, or a
  // rename on disk that leaves the map pointing at a folder that is gone.
  // A plain loop rather than `it.each`, because each case needs its own `ctx` to SKIP
  // on an absent tree — `it.each`'s callback receives the tuple only.
  for (const cycle of Object.keys(PRESIDENTIAL_SOURCES)) {
    it(cycle, () => {
      const dir = path.join(RAW, cycle);
      // A real skip, not a bare return: Vitest renders a green tick for the latter, so
      // a `git mv` of a tree would turn this test PASSED rather than red — the exact
      // defect it exists to catch.
      for (const round of [1, 2] as RoundNumber[]) {
        const roundDir = path.join(dir, roundFolderName(round));
        expect(fs.existsSync(roundDir), `${cycle}/ТУР${round}`).toBe(true);
        expect(
          fs.readdirSync(roundDir).length,
          `${cycle}/ТУР${round} is empty`,
        ).toBeGreaterThan(0);
      }
    });
  }

  // `click` is not a preference — it is the only thing that works for pvrns2021, and
  // a well-meaning simplification back to `goto` would silently break the 2026 ingest
  // on the same generation of the archive.
  it("keeps the click strategy on the cycle that needs it", () => {
    const s = PRESIDENTIAL_SOURCES["2021_11_14_pvr"];
    expect(s.archives.tur1.strategy).toBe("click");
    expect(s.archives.tur2.strategy).toBe("click");
    // …and does not spread it to cycles measured to work by navigation.
    expect(PRESIDENTIAL_SOURCES["2011_10_23_pvr"].archives.tur1.strategy).toBe(
      "goto",
    );
  });

  it("declares an encoding for every era, and the non-UTF-8 ones are named", () => {
    expect(PRESIDENTIAL_SOURCES["2001_11_11_pvr"].encoding).toBe("mik");
    expect(PRESIDENTIAL_SOURCES["2006_10_22_pvr"].encoding).toBe("cp1251");
    expect(PRESIDENTIAL_SOURCES["2011_10_23_pvr"].encoding).toBe("cp1251");
    expect(PRESIDENTIAL_SOURCES["2016_11_06_pvr"].encoding).toBe("utf8");
    expect(PRESIDENTIAL_SOURCES["2021_11_14_pvr"].encoding).toBe("utf8");
  });

  // ⚠ A length check protects nothing — forty characters of any text passes. The
  // notes carry CHECKABLE content, so the two that can be checked against the
  // committed trees are checked, and the rest must at least name what makes their
  // cycle different.
  it("says how each cycle differs, in words that are in the note", () => {
    const mustMention: Record<string, RegExp> = {
      "2021_11_14_pvr": /suemg|machine/i,
      "2016_11_06_pvr": /referendum/i,
      "2011_10_23_pvr": /oblast|ОИК/i,
      "2006_10_22_pvr": /votes file|Readme/i,
      "2001_11_11_pvr": /Деметра/,
    };
    for (const source of entries) {
      expect(source.note, source.cycle).toMatch(mustMention[source.cycle]);
    }
  });

  it("is right that 2011 is on the oblast grid, not the МИР grid", () => {
    const f = path.join(
      RAW,
      "2011_10_23_pvr/ТУР1/el2011_president_sections.txt",
    );
    const prefixes = new Set(
      decodeBundleText(fs.readFileSync(f), "cp1251")
        .split(/\r\n|\n/)
        .filter((l) => l.trim())
        .map((l) => l.split(";")[1]?.slice(0, 2)),
    );
    // The note's claims: 22 is София-град and 29 is abroad …
    expect(prefixes.has("22")).toBe(true);
    expect(prefixes.has("29")).toBe(true);
    // … and 32, the МИР grid's abroad code, is NOT a section prefix here — which is
    // what "does not join parliamentary sections" means concretely.
    expect(prefixes.has("32")).toBe(false);
    expect(prefixes.size).toBe(29);
  });

  it("is right that the 2021 machine block is 256", () => {
    // The note tells a reader the presidential half of the joint export is block 256;
    // this is where that constant actually lives.
    expect(PRESIDENT_BLOCK).toBe("256");
    expect(PRESIDENTIAL_SOURCES["2021_11_14_pvr"].note).toContain("256");
  });

  // ⚠ 2006 was never migrated to results.cik.bg, and a "tidy-up" that moved it there
  // would 404 — the file's own banner warns about it and nothing held it.
  it("keeps 2006 on its own host", () => {
    for (const a of Object.values(
      PRESIDENTIAL_SOURCES["2006_10_22_pvr"].archives,
    )) {
      expect(new URL(a.url).host).toBe("pvr2006.cik.bg");
    }
    // …and the others are on the results host.
    for (const cycle of [
      "2021_11_14_pvr",
      "2016_11_06_pvr",
      "2011_10_23_pvr",
    ]) {
      for (const a of Object.values(PRESIDENTIAL_SOURCES[cycle].archives)) {
        expect(new URL(a.url).host, cycle).toBe("results.cik.bg");
      }
    }
  });

  // TEST-003: joins the declared encoding to the tree it claims to describe. Without
  // it, declaring 2006 as "utf8" — the module's stated worst case — passes every
  // other test in both files.
  for (const cycle of Object.keys(PRESIDENTIAL_SOURCES)) {
    it(`${cycle} decodes with its OWN declared encoding`, () => {
      const source = PRESIDENTIAL_SOURCES[cycle];
      const dir = path.join(RAW, cycle, roundFolderName(1));
      const file = fs
        .readdirSync(dir)
        .filter((f) => /\.(txt|201)$/i.test(f))
        .sort()[0];
      expect(file, `${cycle} has a readable file`).toBeTruthy();
      const bytes = fs.readFileSync(path.join(dir, file));
      const text = decodeBundleText(bytes, source.encoding);
      // Every one of these files is Bulgarian, so a correct decode yields Cyrillic and
      // a wrong one yields mojibake or throws.
      expect(text, `${cycle}/${file}`).toMatch(/[А-Яа-я]/);
      // The mojibake control: the WRONG decoder must not also produce Cyrillic.
      if (source.encoding !== "utf8") {
        expect(new TextDecoder("utf-8").decode(bytes)).not.toMatch(
          /[А-Яа-я]{4}/,
        );
      }
    });
  }
});

// ─── the subtree gate ───────────────────────────────────────────────────────
//
// ⚠ `subtree` decides WHICH ROUND'S DATA becomes ТУР1 and which becomes ТУР2, and
// until this block existed nothing read it. Mutation-proven: pointing 2016 round 1 at
// round 2's folder left every other test passing — and the consequence is the runoff's
// protocols published under round 1's date, with every count reconciling and the site
// stating that Радев took 66.7% in the first round.
//
// The check is per era because each one fingerprints its rounds differently, and 2011
// is deliberately absent: both of its rounds legitimately share the subtree name
// `президент` and are told apart by their ARCHIVE (el2011_t1.zip vs el2011_t2.zip),
// which the archive-key test already covers.
const escapeRe = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bgDate = (iso: string): string => {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
};

const ROUND_FINGERPRINT: Record<
  string,
  (round: RoundNumber, spec: RoundSource) => RegExp
> = {
  // the subtree name IS the round's date, and the filenames embed it
  "2016_11_06_pvr": (_r, spec) => new RegExp(escapeRe(spec.subtree)),
  // filenames embed the round date in Bulgarian order
  "2021_11_14_pvr": (_r, spec) => new RegExp(escapeRe(bgDate(spec.date))),
  // subtree ends pre2006_t1 / _t2; the files carry the same token
  "2006_10_22_pvr": (round) => new RegExp(`_t${round}_`, "i"),
  // subtree ends tur1 / tur2; round 1 is .201, round 2 is .301
  "2001_11_11_pvr": (round) => new RegExp(`\\.${round === 1 ? "2" : "3"}01$`),
};

describe("each ТУРn holds its own round, not its sibling's", () => {
  for (const cycle of Object.keys(ROUND_FINGERPRINT)) {
    it(cycle, () => {
      const source = PRESIDENTIAL_SOURCES[cycle];
      for (const round of [1, 2] as RoundNumber[]) {
        const dir = path.join(RAW, cycle, roundFolderName(round));
        const names = fs.readdirSync(dir);
        const other = (round === 1 ? 2 : 1) as RoundNumber;
        const mine = ROUND_FINGERPRINT[cycle](round, source.rounds[round]);
        const theirs = ROUND_FINGERPRINT[cycle](other, source.rounds[other]);
        expect(
          names.some((n) => mine.test(n)),
          `${cycle}/ТУР${round} carries its own round (${mine})`,
        ).toBe(true);
        expect(
          names.some((n) => theirs.test(n)),
          `${cycle}/ТУР${round} leaked round ${other} (${theirs})`,
        ).toBe(false);
      }
    });
  }

  // …and the fingerprints must actually tell the two rounds apart, or the block above
  // is two vacuous assertions.
  it("the fingerprints discriminate", () => {
    for (const cycle of Object.keys(ROUND_FINGERPRINT)) {
      const s = PRESIDENTIAL_SOURCES[cycle];
      const one = ROUND_FINGERPRINT[cycle](1, s.rounds[1]).source;
      const two = ROUND_FINGERPRINT[cycle](2, s.rounds[2]).source;
      expect(one, cycle).not.toBe(two);
    }
  });
});
