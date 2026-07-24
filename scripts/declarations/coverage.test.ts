// The coverage report's job is to make an ingest that drops rows visible. Its
// tier filters must therefore match each ingest's OWN category filter exactly —
// if they drift, the report compares the wrong two numbers and reports health
// while a tier silently holds half of what upstream publishes.
//
// Pure — `node` Vitest project, no network.

import { describe, expect, it } from "vitest";
import { categoriseRaw } from "../officials/categorise";
import { MP_CATEGORY_SUBSTRING } from "../watch/sources/cacbg_declarations";

// Verbatim category names from list.xml, one per tier plus a couple the
// executive ingest deliberately does not own.
const MP_CATEGORY = "Народни представители";
const MUNICIPAL_CATEGORY =
  "Кметове, и зам.-кметове на общини, кметовете и зам.-кметовете на райони, председателите на общинските съвети, общинските съветници и гл. архитекти на общините и районите";
const EXEC_CATEGORY =
  "Министър-председател, заместник министър-председатели, министри и заместник-министри";
const JUDICIARY_CATEGORY =
  "Председатели на ВКС и на ВАС, главен прокурор, техните заместници, административните ръководители на органите на съдебната власт и техните зам., членовете на ВСС, гл. инспектор и инспекторите в Инспектората към ВСС, съдиите, прокурорите и следователите";

// The three tier predicates, mirrored from coverage.ts. Kept here rather than
// exported from it because that module runs its CLI at import.
const ownsMp = (n: string) => n.includes(MP_CATEGORY_SUBSTRING);
const ownsExec = (n: string) => categoriseRaw(n) !== null;
const ownsMunicipal = (n: string) => n.includes("Кметове");

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
});
