// What the register's declaration FILENAME can and cannot prove about who
// filed, and therefore when the officials slug-collision check may fire.
//
// The check exists to stop two same-named people merging into one profile. Its
// failure mode ran the other way: it read a per-DOCUMENT guid as a person id, so
// one person's extra filings looked like strangers, and the warning told the
// operator to list them — which SPLIT that person into a profile per filing. 66
// of the 72 entries in ./_slug_collisions.json got there that way; the ombudsman
// Диана Ковачева ended up with four profiles.
//
// Every fixture below is a real filename from data/officials/declarations.
// Pure functions — `node` Vitest project, no network, no filesystem.

import { describe, expect, it } from "vitest";
import {
  foreignPersonGuids,
  personGuid,
  personGuidFilings,
  personGuidsOf,
} from "./slug_identity";

const URL_BASE = "https://register.cacbg.bg/register/declarations";
const url = (folder: string, xmlFile: string) =>
  `${URL_BASE}/${folder}/${xmlFile}`;

// Атанас Зафиров Зафиров, зам.-председател, ПП "Българска социалистическа
// партия" — four filings under one person id, one under a bare document id.
const ZAFIROV_PERSON = "FABC4CD0-EE60-4532-8F5A-68404AE4F910";
const ZAFIROV_FILINGS = [
  {
    folder: "2025",
    file: `${ZAFIROV_PERSON}212195.xml`,
    declarationYear: 2025,
  },
  {
    folder: "2024",
    file: `${ZAFIROV_PERSON}181432.xml`,
    declarationYear: 2024,
  },
  {
    folder: "2022",
    file: `${ZAFIROV_PERSON}136598.xml`,
    declarationYear: 2022,
  },
];
const ZAFIROV_BARE = "255f6c79-551f-4b67-87b4-77e8b1401ddb.xml";

const filing = (folder: string, file: string, declarationYear: number) => ({
  sourceUrl: url(folder, file),
  declarationYear,
});

describe("personGuid", () => {
  it("recovers the person id from <GUID><filing-seq>.xml", () => {
    expect(personGuid(`${ZAFIROV_PERSON}212195.xml`)).toBe(ZAFIROV_PERSON);
  });

  it("upper-cases it, so the same person matches across folders", () => {
    expect(personGuid(`${ZAFIROV_PERSON.toLowerCase()}212195.xml`)).toBe(
      ZAFIROV_PERSON,
    );
  });

  // The whole defect in one assertion: the first 36 characters of a bare-guid
  // filename look exactly like a person id and are not one. 138 filings in the
  // corpus have this shape.
  it("refuses a bare guid — that is a document id, not a person id", () => {
    expect(personGuid(ZAFIROV_BARE)).toBeNull();
    expect(personGuid("1cfbc7d5-1ce3-4e68-99e4-1fbfc605ac22.xml")).toBeNull();
    // Upper-case does not make it a person id either: 4 of the 138 arrive that
    // way, so case alone was never the signal — the missing sequence suffix is.
    expect(personGuid("1CFBC7D5-1CE3-4E68-99E4-1FBFC605AC22.xml")).toBeNull();
  });

  it("refuses anything that is not a guid at all", () => {
    expect(personGuid("")).toBeNull();
    expect(personGuid("declaration.xml")).toBeNull();
    expect(personGuid(`${ZAFIROV_PERSON}212195.pdf`)).toBeNull();
  });
});

describe("personGuidsOf", () => {
  it("keeps person ids and drops document ids", () => {
    const guids = personGuidsOf([
      ...ZAFIROV_FILINGS.map((f) => url(f.folder, f.file)),
      url("2023", ZAFIROV_BARE),
    ]);
    expect([...guids]).toEqual([ZAFIROV_PERSON]);
  });
});

describe("personGuidFilings — the same-run collision test", () => {
  // THE PIN. Атанас Зафиров's 2023 filing carries a re-issued (bare) guid while
  // his name, institution and position title are unchanged, so it lands on his
  // slug. One entry, not two: no collision, nothing for the operator to list.
  it("does not report a collision for a re-issued guid on an identical declarant", () => {
    const competing = personGuidFilings([
      ...ZAFIROV_FILINGS.map((f) =>
        filing(f.folder, f.file, f.declarationYear),
      ),
      filing("2023", ZAFIROV_BARE, 2023),
    ]);
    expect(competing.size).toBe(1);
    expect([...competing.keys()]).toEqual([ZAFIROV_PERSON]);
  });

  // Диана Ковачева filed three times in the 2020 folder, each under its own
  // document id. Counted as identities they were three strangers on her slug —
  // and listing them is what gave her four profiles.
  it("does not turn one person's several bare-guid filings into several people", () => {
    const competing = personGuidFilings([
      filing("2020", "5c479ffa-0e97-491d-96b2-205a38c6ddce.xml", 2020),
      filing("2020", "7a006b5b-0cf8-4e77-af1e-94cf1b64a94d.xml", 2020),
      filing("2020", "9bfe96d4-c291-40b3-bc6f-e6863b6ffe3f.xml", 2020),
    ]);
    expect(competing.size).toBe(0);
  });

  // Иван Стоянов Стоянов, "Упълномощено лице по ЗОП" under the group label
  // "Процедури по ЗОП" — two person ids, two disjoint property lists (Пловдив /
  // Хасково vs Бургас / Болярово). This is the pair the check is FOR.
  it("still reports two real person ids on one slug", () => {
    const competing = personGuidFilings([
      filing("2025", "D1245F3F-A206-40F9-BB6C-A9F0BE3D1D09313300.xml", 2025),
      filing("2018", "A0555741-4ECE-4404-BB6C-2FB9B319E145100432.xml", 2018),
    ]);
    expect(competing.size).toBe(2);
    // Each id comes back with a filing to open — the warning asks the operator
    // to compare the two declarations, which is the only thing that can tell a
    // same-named pair from a re-issued id.
    expect(
      [...competing.values()].every((f) => f.sourceUrl.startsWith(URL_BASE)),
    ).toBe(true);
  });
});

describe("foreignPersonGuids — the cross-year collision test", () => {
  const onDisk = ZAFIROV_FILINGS.map((f) => url(f.folder, f.file));

  it("is silent when this run's filings carry the id already on disk", () => {
    expect(foreignPersonGuids(onDisk, [onDisk[0]])).toEqual([]);
  });

  // Re-ingesting 2023 brings in only the bare-guid filing. It proves no
  // identity, so it cannot declare the id on disk foreign — the merge into the
  // existing shard is correct and must stay quiet.
  it("is silent when the incoming filing is bare-guid only", () => {
    expect(foreignPersonGuids(onDisk, [url("2023", ZAFIROV_BARE)])).toEqual([]);
  });

  // And the mirror: a bare-guid filing already merged into a shard is not a
  // stranger when the person files again under their real id.
  it("is silent when the shard holds a bare-guid filing", () => {
    expect(
      foreignPersonGuids([...onDisk, url("2023", ZAFIROV_BARE)], [onDisk[0]]),
    ).toEqual([]);
  });

  it("reports a second person id found only on disk", () => {
    const other = "A0555741-4ECE-4404-BB6C-2FB9B319E145100432.xml";
    expect(
      foreignPersonGuids([...onDisk, url("2018", other)], [onDisk[0]]),
    ).toEqual(["A0555741-4ECE-4404-BB6C-2FB9B319E145"]);
  });
});
