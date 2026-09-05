import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  mergeStamp,
  placeSubtree,
  roundIsPresent,
  type SourceStamp,
} from "./download";
import {
  PRESIDENTIAL_SOURCES,
  roundFolderName,
  type RoundNumber,
} from "./sources";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const RAW = path.join(PROJECT_ROOT, "raw_data");
const source = PRESIDENTIAL_SOURCES["2011_10_23_pvr"];
const at = () => "2099-01-01T00:00:00.000Z";

describe("mergeStamp", () => {
  // ⚠ THE MERGE IS THE WHOLE POINT, because the ORDINARY run of this downloader
  // measures nothing: all five trees are committed, so every round is present and
  // every archive is skipped. A stamp writer that replaced would empty the provenance
  // on exactly the path that runs most often.
  const prior: SourceStamp = {
    cycle: source.cycle,
    slug: source.slug,
    stampedAt: "2026-09-05T00:00:00.000Z",
    fetchedAt: "2026-09-05T00:00:00.000Z",
    archives: {
      tur1: {
        url: "old",
        strategy: "goto",
        bytes: null,
        md5: null,
        downloadedHere: false,
        origin: "copied from the local _mi tree",
      },
      tur2: {
        url: "old",
        strategy: "goto",
        bytes: 626112,
        md5: "f9bcd5dcc0ce6d64931578bea99edd6a",
        downloadedHere: true,
      },
    },
    rounds: {},
    note: "old",
  };

  it("keeps what an earlier run measured when this one measured nothing", () => {
    const merged = mergeStamp(source, {}, prior, at);
    expect(merged.archives.tur2.bytes).toBe(626112);
    expect(merged.archives.tur2.md5).toBe("f9bcd5dcc0ce6d64931578bea99edd6a");
    expect(merged.archives.tur2.downloadedHere).toBe(true);
    // Including the free-text origin, which nothing else in the repo records.
    expect(merged.archives.tur1.origin).toBe("copied from the local _mi tree");
    expect(merged.stampedAt).toBe("2026-09-05T00:00:00.000Z");
    expect(merged.fetchedAt).toBe("2026-09-05T00:00:00.000Z");
    // …while the URL and note are re-read from the map, which is the live answer.
    expect(merged.archives.tur1.url).toBe(source.archives.tur1.url);
    expect(merged.note).toBe(source.note);
  });

  // ⚠ The mutation control for the assertion above: without it, "it merged" is
  // satisfied by any implementation that happens to produce the same values. What a
  // REPLACING implementation loses is specifically the facts that exist NOWHERE else —
  // and the digest is deliberately not among them, since `sources.ts` declares it and
  // the fallback recovers it. That is the honest boundary, and asserting more than it
  // would be a test that only looked strict.
  it("a replacing implementation loses exactly the unrecoverable facts", () => {
    const replacing = mergeStamp(source, {}, null, at);
    // Lost: who fetched it, where it came from otherwise, and both timestamps.
    expect(replacing.archives.tur2.downloadedHere).toBe(false);
    expect(replacing.archives.tur1.origin).toBeUndefined();
    expect(replacing.stampedAt).not.toBe(prior.stampedAt);
    expect(replacing.fetchedAt).toBeUndefined();
    // NOT lost, and deliberately so: the digest and size come back from the map.
    expect(replacing.archives.tur2.md5).toBe(source.archives.tur2.md5);
    expect(replacing.archives.tur2.bytes).toBe(source.archives.tur2.bytes);
    // …and where the map declares nothing, a replacement really is empty.
    expect(replacing.archives.tur1.md5).toBeNull();
    expect(replacing.archives.tur1.bytes).toBeNull();
  });

  it("lets this run's measurement win over the prior one", () => {
    const merged = mergeStamp(
      source,
      { tur2: { bytes: 999, md5: "new", downloadedHere: true } },
      prior,
      at,
    );
    expect(merged.archives.tur2.md5).toBe("new");
    expect(merged.archives.tur2.bytes).toBe(999);
    // A fresh download re-dates the fetch, but not the original stamp.
    expect(merged.fetchedAt).toBe(at());
    expect(merged.stampedAt).toBe(prior.stampedAt);
  });

  // An archive nobody has ever fetched must say so rather than borrowing a digest.
  it("records an unmeasured archive as null, not as absent or zero", () => {
    const merged = mergeStamp(source, {}, null, at);
    expect(merged.archives.tur1.bytes).toBeNull();
    expect(merged.archives.tur1.md5).toBeNull();
    expect(merged.archives.tur1.downloadedHere).toBe(false);
    expect(merged.fetchedAt).toBeUndefined();
  });

  // Where `sources.ts` carries a digest, an unmeasured stamp inherits it — that is the
  // declared expectation for the next download, not a claim that it was fetched here.
  it("falls back to the map's declared digest without claiming a download", () => {
    const s2016 = PRESIDENTIAL_SOURCES["2016_11_06_pvr"];
    const merged = mergeStamp(s2016, {}, null, at);
    expect(merged.archives.both.md5).toBe(s2016.archives.both.md5);
    expect(merged.archives.both.bytes).toBe(s2016.archives.both.bytes);
    expect(merged.archives.both.downloadedHere).toBe(false);
  });

  // `origin` answers "where did these bytes come from instead", so it is meaningless
  // — and contradictory — on something this tooling did download.
  it("drops origin from an archive that WAS downloaded here", () => {
    const merged = mergeStamp(
      source,
      {
        tur1: {
          bytes: 1,
          md5: "x",
          downloadedHere: true,
          origin: "should not survive",
        },
      },
      prior,
      at,
    );
    expect(merged.archives.tur1.downloadedHere).toBe(true);
    expect(merged.archives.tur1.origin).toBeUndefined();
  });

  it("carries every round's layout", () => {
    const merged = mergeStamp(source, {}, null, at);
    expect(Object.keys(merged.rounds)).toEqual(["1", "2"]);
    expect(merged.rounds["1"].subtree).toBe("президент");
    expect(merged.rounds["2"].date).toBe("2011-10-30");
  });
});

describe("placeSubtree", () => {
  const tmp = (): string =>
    fs.mkdtempSync(path.join(os.tmpdir(), "pvr-place-"));

  it("copies the declared subtree and leaves the rest behind", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "staging/wanted/nested"), { recursive: true });
    fs.mkdirSync(path.join(root, "staging/other"), { recursive: true });
    fs.writeFileSync(path.join(root, "staging/wanted/a.txt"), "a");
    fs.writeFileSync(path.join(root, "staging/wanted/nested/b.txt"), "b");
    fs.writeFileSync(path.join(root, "staging/other/c.txt"), "c");
    const dest = path.join(root, "ТУР1");

    expect(placeSubtree(path.join(root, "staging"), "wanted", dest)).toBe(2);
    expect(fs.readFileSync(path.join(dest, "a.txt"), "utf-8")).toBe("a");
    expect(fs.readFileSync(path.join(dest, "nested/b.txt"), "utf-8")).toBe("b");
    expect(fs.existsSync(path.join(dest, "c.txt"))).toBe(false);
    // No scaffolding left over.
    expect(fs.existsSync(`${dest}.incoming`)).toBe(false);
    expect(fs.existsSync(`${dest}.previous`)).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("names what it found when the subtree is missing", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "staging/actual"), { recursive: true });
    expect(() =>
      placeSubtree(
        path.join(root, "staging"),
        "expected",
        path.join(root, "d"),
      ),
    ).toThrow(/no subtree "expected".*actual/s);
    fs.rmSync(root, { recursive: true, force: true });
  });

  // ⚠ THE FAILURE THIS FUNCTION IS SHAPED AROUND. `roundIsPresent` asks only whether
  // the folder is non-empty, so publishing an empty — or partial — round would mark it
  // "present" for ever and no later run would re-fetch it.
  it("refuses to publish an empty round rather than leaving one behind", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "staging/empty/deeper"), { recursive: true });
    const dest = path.join(root, "ТУР1");
    expect(() =>
      placeSubtree(path.join(root, "staging"), "empty", dest),
    ).toThrow(/contained no files/);
    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.existsSync(`${dest}.incoming`)).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("leaves the previous round untouched when the new one fails", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "staging/empty"), { recursive: true });
    const dest = path.join(root, "ТУР1");
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, "existing.txt"), "keep me");

    expect(() =>
      placeSubtree(path.join(root, "staging"), "empty", dest),
    ).toThrow();
    // The old round is still exactly where it was — the whole point of building in a
    // sibling directory and swapping at the end.
    expect(fs.readFileSync(path.join(dest, "existing.txt"), "utf-8")).toBe(
      "keep me",
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("replaces an existing round wholesale rather than merging into it", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "staging/new"), { recursive: true });
    fs.writeFileSync(path.join(root, "staging/new/fresh.txt"), "new");
    const dest = path.join(root, "ТУР1");
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, "stale.txt"), "old");

    expect(placeSubtree(path.join(root, "staging"), "new", dest)).toBe(1);
    // A file from a previous vintage must not survive into the new round.
    expect(fs.existsSync(path.join(dest, "stale.txt"))).toBe(false);
    expect(fs.readFileSync(path.join(dest, "fresh.txt"), "utf-8")).toBe("new");
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("roundIsPresent", () => {
  // This is what makes the downloader idempotent, so it must be TRUE for every
  // committed round — if it were not, an operator running the command would re-fetch
  // ~170 MB and rewrite trees that are already correct.
  for (const cycle of Object.keys(PRESIDENTIAL_SOURCES)) {
    it(`${cycle} is already on disk`, () => {
      for (const round of [1, 2] as RoundNumber[]) {
        expect(roundIsPresent(cycle, round), `${cycle}/ТУР${round}`).toBe(true);
      }
    });
  }

  it("is false for a cycle that does not exist", () => {
    expect(roundIsPresent("1999_01_01_pvr", 1)).toBe(false);
  });
});

describe("the committed SOURCE.json stamps", () => {
  for (const [cycle, src] of Object.entries(PRESIDENTIAL_SOURCES)) {
    it(`${cycle} records its provenance`, () => {
      const f = path.join(RAW, cycle, "SOURCE.json");
      const stamp = JSON.parse(fs.readFileSync(f, "utf-8")) as SourceStamp;
      expect(stamp.cycle).toBe(cycle);
      expect(stamp.slug).toBe(src.slug);
      expect(stamp.stampedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      // The archive keys must match the map, or the stamp describes a shape the
      // downloader no longer has.
      expect(Object.keys(stamp.archives).sort()).toEqual(
        Object.keys(src.archives).sort(),
      );
      for (const [key, a] of Object.entries(stamp.archives)) {
        // ⚠ No half-measured entries: claiming a download without recording what came
        // down is the unverifiable-claim shape this file exists to avoid.
        if (a.downloadedHere) {
          expect(a.md5, `${cycle}/${key} md5`).toMatch(/^[0-9a-f]{32}$/);
          expect(a.bytes, `${cycle}/${key} bytes`).toBeGreaterThan(0);
          expect(a.origin, `${cycle}/${key} origin`).toBeUndefined();
        } else {
          // …and the converse: something not downloaded here must either say where it
          // came from or admit it was never measured.
          expect(
            a.origin !== undefined || a.md5 === null,
            `${cycle}/${key} is neither explained nor admitted`,
          ).toBe(true);
        }
        // Where the map declares a digest, the stamp must not contradict it.
        const declared = src.archives[key].md5;
        if (declared && a.md5) expect(a.md5, `${cycle}/${key}`).toBe(declared);
      }
    });
  }

  // ⚠ THE IDEMPOTENCE THE WHOLE DESIGN RESTS ON. Re-rendering a committed stamp
  // through the merge must reproduce it byte for byte — otherwise every skipped run
  // rewrites a tracked file and the diff is noise nobody reads.
  for (const [cycle, src] of Object.entries(PRESIDENTIAL_SOURCES)) {
    it(`${cycle} is a fixed point of a skipped re-run`, () => {
      const f = path.join(RAW, cycle, "SOURCE.json");
      const onDisk = fs.readFileSync(f, "utf-8");
      const prior = JSON.parse(onDisk) as SourceStamp;
      const rendered =
        JSON.stringify(mergeStamp(src, {}, prior, at), null, 2) + "\n";
      expect(rendered).toBe(onDisk);
    });
  }

  // The one archive nobody downloaded here, recorded honestly rather than filled in
  // from its sibling. If a future run does fetch it, this flips — and the test says
  // so rather than silently passing either way.
  it("says plainly how the 2011 round-1 tree was obtained", () => {
    const f = path.join(RAW, "2011_10_23_pvr", "SOURCE.json");
    const stamp = JSON.parse(fs.readFileSync(f, "utf-8")) as SourceStamp;
    if (stamp.archives.tur1.downloadedHere) {
      expect(stamp.archives.tur1.md5).toMatch(/^[0-9a-f]{32}$/);
      return;
    }
    expect(stamp.archives.tur1.md5).toBeNull();
    expect(stamp.archives.tur1.bytes).toBeNull();
    // Not merely "we did not fetch it" — where it came from instead.
    expect(stamp.archives.tur1.origin).toMatch(/2011_10_23_mi/);
    // …while its sibling WAS fetched, so this is a real distinction and not an
    // unstamped tree.
    expect(stamp.archives.tur2.downloadedHere).toBe(true);
  });
});

describe("the digests sources.ts declares", () => {
  it("are well-formed, and paired with a byte count", () => {
    let declared = 0;
    for (const src of Object.values(PRESIDENTIAL_SOURCES)) {
      for (const [key, a] of Object.entries(src.archives)) {
        if (!a.md5) continue;
        declared++;
        expect(a.md5, `${src.cycle}/${key}`).toMatch(/^[0-9a-f]{32}$/);
        // A digest with no size is half a measurement, and the size is what makes an
        // operator's "did I get the right file" check possible before hashing.
        expect(a.bytes, `${src.cycle}/${key} bytes`).toBeGreaterThan(0);
      }
    }
    // Non-vacuity: 7 of the 8 archives carry one — the exception is 2011 round 1.
    expect(declared).toBe(7);
  });
});

describe("the round folder name", () => {
  // Cyrillic ТУР — a typo here is invisible in review and would make every reader
  // look in a folder that does not exist.
  it("is Cyrillic and matches the trees on disk", () => {
    expect(roundFolderName(1)).toBe("ТУР1");
    expect(roundFolderName(2)).toBe("ТУР2");
    const dir = path.join(RAW, "2021_11_14_pvr");
    expect(fs.readdirSync(dir)).toEqual(
      expect.arrayContaining([roundFolderName(1), roundFolderName(2)]),
    );
  });
});
