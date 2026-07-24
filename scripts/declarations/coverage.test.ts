// The coverage report's job is to make an ingest that drops rows visible. Its
// tier filters must therefore match each ingest's OWN category filter exactly —
// if they drift, the report compares the wrong two numbers and reports health
// while a tier silently holds half of what upstream publishes.
//
// Pure — `node` Vitest project, no network.

import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { MP_CATEGORY_SUBSTRING } from "../watch/sources/cacbg_declarations";
import { MUNICIPAL_CATEGORY_SUBSTRING } from "../watch/sources/cacbg_local";
import { heldByFolder, TIERS } from "./coverage_lib";

// Verbatim category names from list.xml, one per tier plus a couple the
// executive ingest deliberately does not own.
const MP_CATEGORY = "Народни представители";
const MUNICIPAL_CATEGORY =
  "Кметове, и зам.-кметове на общини, кметовете и зам.-кметовете на райони, председателите на общинските съвети, общинските съветници и гл. архитекти на общините и районите";
const EXEC_CATEGORY =
  "Министър-председател, заместник министър-председатели, министри и заместник-министри";
const JUDICIARY_CATEGORY =
  "Председатели на ВКС и на ВАС, главен прокурор, техните заместници, административните ръководители на органите на съдебната власт и техните зам., членовете на ВСС, гл. инспектор и инспекторите в Инспектората към ВСС, съдиите, прокурорите и следователите";

// THE predicates the report runs on — imported, not restated. A copy here
// would pass while the report drifted, which is the one failure this file
// exists to catch.
const tier = (name: string) => {
  const t = TIERS.find((x) => x.name === name);
  if (!t) throw new Error(`no such tier: ${name}`);
  return t.owns;
};
const ownsMp = tier("MPs");
const ownsExec = tier("executive");
const ownsMunicipal = tier("municipal");

describe("coverage tier filters", () => {
  it("assigns each tier exactly its own categories", () => {
    expect(ownsMp(MP_CATEGORY)).toBe(true);
    expect(ownsExec(EXEC_CATEGORY)).toBe(true);
    expect(ownsMunicipal(MUNICIPAL_CATEGORY)).toBe(true);
  });

  // A category counted by two tiers would be double-reported; one counted by
  // none would be invisible to the report entirely.
  it("does not let two tiers claim the same category", () => {
    for (const name of [MP_CATEGORY, MUNICIPAL_CATEGORY, EXEC_CATEGORY]) {
      const claims = [ownsMp(name), ownsExec(name), ownsMunicipal(name)].filter(
        Boolean,
      );
      expect(claims, `tiers claiming "${name.slice(0, 40)}…"`).toHaveLength(1);
    }
  });

  it("leaves the judiciary to the ИВСС register, not to any cacbg tier", () => {
    expect(ownsMp(JUDICIARY_CATEGORY)).toBe(false);
    expect(ownsExec(JUDICIARY_CATEGORY)).toBe(false);
    expect(ownsMunicipal(JUDICIARY_CATEGORY)).toBe(false);
  });

  // The MP watcher and the coverage report must agree on what "an MP category"
  // is, or the watcher can flip on filings the report says we hold.
  it("shares the MP category substring with the watcher", () => {
    expect(MP_CATEGORY_SUBSTRING).toBe("Народни представители");
    expect(ownsMp(MP_CATEGORY)).toBe(true);
  });

  it("shares the municipal category substring with the watcher", () => {
    expect(MUNICIPAL_CATEGORY_SUBSTRING).toBe("Кметове");
    expect(ownsMunicipal(MUNICIPAL_CATEGORY)).toBe(true);
  });
});

// The rule the report rests on: what we HOLD is a count of upstream
// declarations, not of rows on disk.
describe("heldByFolder", () => {
  const dirs: string[] = [];
  const tmpDir = (files: Record<string, unknown>): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coverage-"));
    dirs.push(dir);
    for (const [name, body] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), JSON.stringify(body), "utf-8");
    }
    return dir;
  };

  afterEach(() => {
    while (dirs.length)
      fs.rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  const decl = (folder: string, id: string) => ({
    sourceUrl: `https://register.cacbg.bg/${folder}/${id}.xml`,
  });

  // An official who holds two posts is written under both slugs, carrying the
  // same filing twice. Counting rows put the held total ABOVE the listed one,
  // and a negative gap reads as health while a real gap hides inside it.
  it("counts one upstream declaration once even when two slugs carry it", () => {
    const dir = tmpDir({
      "ivan-petrov.json": [decl("2025", "ABC123")],
      "ivan-petrov-kmet.json": [decl("2025", "ABC123")],
    });
    expect(heldByFolder(dir).get("2025")).toBe(1);
  });

  it("counts distinct filings per folder separately", () => {
    const dir = tmpDir({
      "a.json": [decl("2024", "A"), decl("2025", "B")],
      "b.json": [decl("2025", "C")],
    });
    const held = heldByFolder(dir);
    expect(held.get("2024")).toBe(1);
    expect(held.get("2025")).toBe(2);
  });

  it("ignores rows whose sourceUrl is not a register URL", () => {
    const dir = tmpDir({
      "a.json": [{ sourceUrl: "https://example.com/x.xml" }, {}],
    });
    expect(heldByFolder(dir).size).toBe(0);
  });

  // A manifest dropped into a declarations directory parses fine and is not a
  // list of filings. Before the guard it took the whole CLI down.
  it("skips a .json file that is not an array", () => {
    const dir = tmpDir({
      "index.json": { generatedAt: "2026-07-24" },
      "a.json": [decl("2025", "A")],
    });
    expect(heldByFolder(dir).get("2025")).toBe(1);
  });

  it("returns nothing for a directory that does not exist", () => {
    expect(heldByFolder(path.join(os.tmpdir(), "no-such-dir-xyz")).size).toBe(
      0,
    );
  });
});
