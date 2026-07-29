// The split repair's decision core. Pure — no data tree, no fs — so it pins the
// rule rather than the corpus: ./officials_slug.data.test.ts is what checks the
// corpus.
//
// What is worth pinning here is mostly what the script must NOT do. Splitting is
// safe in one direction only: it separates, so the worst it can do is fork one
// person. Every case below is a way that could happen.

import { describe, expect, it } from "vitest";
import { findSplits } from "./split_collision_slugs";
import { officialSlug } from "./shared";
import type {
  OfficialDeclaration,
  OfficialIndexEntry,
} from "../../src/data/dataTypes";

const PROSECUTOR = "A0555741-4ECE-4404-BB6C-2FB9B319E145";
const COMMANDER = "D1245F3F-A206-40F9-BB6C-A9F0BE3D1D09";
const INSTITUTION = "Процедури по ЗОП";
const NAME = "Иван Стоянов Стоянов";

const filing = (
  slug: string,
  guid: string,
  year: number,
  seq = "1",
): OfficialDeclaration =>
  ({
    slug,
    declarantName: NAME,
    institution: INSTITUTION,
    positionTitle: "Упълномощено лице по ЗОП",
    declarationYear: year,
    fiscalYear: null,
    declarationType: "Annualy",
    filedAt: null,
    entryNumber: null,
    controlHash: null,
    sourceUrl: `https://register.cacbg.bg/${year}/${guid}${seq}.xml`,
    ownershipStakes: [],
    income: [],
  }) as OfficialDeclaration;

const entry = (slug: string): OfficialIndexEntry =>
  ({
    slug,
    name: NAME,
    normalizedName: NAME.toUpperCase(),
    category: "procurement_officer",
    categoryRaw: "",
    institution: INSTITUTION,
    positionTitle: "Упълномощено лице по ЗОП",
    isCaretaker: false,
    latestDeclarationYear: 2025,
    descriptorYear: 2025,
  }) as OfficialIndexEntry;

const BARE = officialSlug(NAME, INSTITUTION);
const FOLDED = officialSlug(NAME, `${INSTITUTION}|${COMMANDER}`);

describe("findSplits", () => {
  it("moves a listed GUID's filings off the shared shard, leaving the peer's behind", () => {
    const shard = [
      filing(BARE, PROSECUTOR, 2019),
      filing(BARE, PROSECUTOR, 2020),
      filing(BARE, COMMANDER, 2025),
    ];
    const splits = findSplits(
      [entry(BARE)],
      () => shard,
      new Set([COMMANDER]),
    );
    expect(splits).toHaveLength(1);
    expect(splits[0].from).toBe(BARE);
    expect(splits[0].to).toBe(FOLDED);
    expect(splits[0].moving.map((d) => d.declarationYear)).toEqual([2025]);
    expect(splits[0].staying.map((d) => d.declarationYear)).toEqual([
      2019, 2020,
    ]);
  });

  it("leaves the UNLISTED peer alone — only one of a pair is ever separated", () => {
    // The whole point of leaving one GUID out: it keeps the published slug. A
    // rule that moved both would 404 the profile that already ranks.
    const shard = [
      filing(BARE, PROSECUTOR, 2019),
      filing(BARE, COMMANDER, 2025),
    ];
    const splits = findSplits([entry(BARE)], () => shard, new Set([COMMANDER]));
    expect(splits.map((s) => s.guid)).toEqual([COMMANDER]);
  });

  it("is idempotent: a GUID already on its folded slug is not moved again", () => {
    // Re-running after an apply must be a no-op. Otherwise the second run would
    // compute officialSlug(name, `institution|guid`) from a shard that already
    // carries it and move the filings to themselves.
    const splits = findSplits(
      [entry(FOLDED)],
      () => [filing(FOLDED, COMMANDER, 2025)],
      new Set([COMMANDER]),
    );
    expect(splits).toEqual([]);
  });

  it("never moves a filing whose name carries a per-DOCUMENT guid", () => {
    // A bare guid (no filing-seq suffix) proves no identity — see
    // ./slug_identity.ts. Treating one as a person id is how 66 bad entries got
    // into the collisions table, and moving on it would fork a real person.
    const bare: OfficialDeclaration = {
      ...filing(BARE, PROSECUTOR, 2020),
      sourceUrl: `https://register.cacbg.bg/2020/${COMMANDER.toLowerCase()}.xml`,
    };
    const splits = findSplits(
      [entry(BARE)],
      () => [filing(BARE, PROSECUTOR, 2019), bare],
      new Set([COMMANDER]),
    );
    expect(splits).toEqual([]);
  });

  it("does nothing when no GUID on the shard is listed", () => {
    const shard = [
      filing(BARE, PROSECUTOR, 2019),
      filing(BARE, COMMANDER, 2025),
    ];
    expect(findSplits([entry(BARE)], () => shard, new Set())).toEqual([]);
  });

  it("splits each listed GUID separately when a shard holds three people", () => {
    const third = "11111111-2222-3333-4444-555555555555";
    const shard = [
      filing(BARE, PROSECUTOR, 2019),
      filing(BARE, COMMANDER, 2025),
      filing(BARE, third, 2025, "2"),
    ];
    const splits = findSplits(
      [entry(BARE)],
      () => shard,
      new Set([COMMANDER, third]),
    );
    expect(splits.map((s) => s.guid).sort()).toEqual(
      [COMMANDER, third].sort(),
    );
    // Distinct targets — folding the GUID in means two listed ids can never
    // land on one slug.
    expect(new Set(splits.map((s) => s.to)).size).toBe(2);
    // Each split reports the OTHER two filings as staying, because they are
    // computed against the shard as it is now. The apply loop is what sequences
    // them; this is the input it sequences.
    for (const s of splits) expect(s.moving).toHaveLength(1);
  });

  it("flags a shard that keeps no filings — a rename, not a split", () => {
    // Legitimate shape (every filing belongs to the listed GUID), but it means
    // the GUID was probably the ONLY person on that name — the 943A7E38 mistake.
    // findSplits still reports it; the CLI warns.
    const splits = findSplits(
      [entry(BARE)],
      () => [filing(BARE, COMMANDER, 2025)],
      new Set([COMMANDER]),
    );
    expect(splits).toHaveLength(1);
    expect(splits[0].staying).toEqual([]);
  });

  it("skips shards with no filings on disk", () => {
    expect(findSplits([entry(BARE)], () => [], new Set([COMMANDER]))).toEqual(
      [],
    );
  });
});
