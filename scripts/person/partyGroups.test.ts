// mp-party-affiliation-v1 T1 — the crosswalk resolves every group short the
// roll-call corpus actually contains, and REFUSES anything else.
//
// Runs against the real data/canonical_parties.json rather than a fixture: the
// module's job is to agree with that file, so a stand-in would only prove it
// agrees with itself. The live `party_dim.short` list is pinned here as a
// literal (26 values, measured 2026-08-07) so this stays a unit test with no
// database — the DB-backed exhaustiveness check is gate 5.1.

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  UnmappedGroupShortError,
  ambiguousNormalizedNicknames,
  groupShortToCanonical,
  loadCanonicalIndex,
} from "./partyGroups";
import {
  INDEPENDENT_CANONICAL_ID,
  isGroupSentinel,
  resolveNicknameToId,
} from "@/data/parties/parliamentGroupAliases";
import { INDEPENDENT_CANONICAL_ID as LOCAL_INDEPENDENT_ID } from "../parsers_local/local_coalitions";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const index = loadCanonicalIndex();

// Every distinct value in party_dim.short, NS 44-52.
const LIVE_GROUP_SHORTS = [
  "АПС",
  "БВ",
  "БСП",
  "БСП - ОЛ",
  "ВЕЛИЧИЕ",
  "ВОЛЯ",
  "ВЪЗРАЖДАНЕ",
  "ГЕРБ",
  "ГЕРБ - СДС",
  "ГЕРБ-СДС",
  "ДБ",
  "ДПС",
  "ДПС - НН",
  "ИТН",
  "МЕЧ",
  "ОП",
  "ПП",
  "ПП - ДБ",
  "ПП-ДБ",
  "НЕЗ",
  "НЕЧЛ В ПГ",
  "НЕЧЛ ПГ",
  "ПБ",
  "ИБГНИ",
  "ИСМВ",
  "ДПС - ДПС",
];

describe("groupShortToCanonical", () => {
  it("the canonical index actually loaded", () => {
    expect(index.parties.length).toBeGreaterThan(100);
  });

  it.each(LIVE_GROUP_SHORTS)("resolves %s", (short) => {
    const id = groupShortToCanonical(short, index);
    expect(id, `"${short}" resolved to an empty id`).toBeTruthy();
  });

  it("resolves every live short to an id the canonical table can LABEL", () => {
    // Resolving is not enough — the id has to be one displayNameForId can find,
    // or the ПАРТИЯ column prints the id itself (§0g). `independent` counts
    // because §0g gave it a real entry.
    const ids = new Set(index.parties.map((p) => p.id));
    const unlabelled = LIVE_GROUP_SHORTS.map((s) => [
      s,
      groupShortToCanonical(s, index),
    ]).filter(([, id]) => !ids.has(id as string));
    expect(unlabelled).toEqual([]);
  });

  it("maps the four class-B aliases to their documented lineages", () => {
    // Pinned by id because these are the ones a normaliser cannot reach — a
    // regression here resolves to SOMETHING and looks fine.
    expect(groupShortToCanonical("ПБ", index)).toBe("p_20"); // Прогресивна България
    expect(groupShortToCanonical("ИБГНИ", index)).toBe("p_49"); // Изправи се.БГ! Ние идваме!
    expect(groupShortToCanonical("ИСМВ", index)).toBe("p_81"); // Изправи се! Мутри вън!
    expect(groupShortToCanonical("ДПС - ДПС", index)).toBe("p_16"); // ДПС
  });

  it("maps all three class-A sentinels to `independent`, never to a party", () => {
    for (const s of ["НЕЗ", "НЕЧЛ В ПГ", "НЕЧЛ ПГ"]) {
      expect(groupShortToCanonical(s, index)).toBe(INDEPENDENT_CANONICAL_ID);
    }
  });

  it("folds the two ГЕРБ-СДС spellings onto ONE id", () => {
    // party_dim's key is (ns, short), so these are separate rows by design.
    // Splitting them halves both counts and each half looks plausible.
    const a = groupShortToCanonical("ГЕРБ-СДС", index);
    const b = groupShortToCanonical("ГЕРБ - СДС", index);
    expect(a).toBe(b);
    expect(a).toBe("gerb");
  });

  it("folds the two ПП-ДБ spellings onto ONE id", () => {
    expect(groupShortToCanonical("ПП-ДБ", index)).toBe(
      groupShortToCanonical("ПП - ДБ", index),
    );
  });

  it("keeps the coalition fold approved on 2026-08-08", () => {
    // ГЕРБ - СДС and БСП - ОЛ fold to the LEAD PARTY; ПП - ДБ and ПБ stay as the
    // COALITION. The asymmetry is deliberate (§1a) — this test exists so a
    // future tidy-up cannot "fix" it into consistency without a decision.
    expect(groupShortToCanonical("ГЕРБ - СДС", index)).toBe("gerb");
    expect(groupShortToCanonical("БСП - ОЛ", index)).toBe("bsp");
    expect(groupShortToCanonical("ПП - ДБ", index)).toBe("p_6");
    expect(groupShortToCanonical("ПБ", index)).toBe("p_20");
  });

  it("distinguishes ПП, ДБ and ПП-ДБ — the coalition that split", () => {
    // The 52nd NS seated ПП and ДБ as SEPARATE groups while the 49th seated
    // ПП-ДБ as one. If any two of these folded together the split would be
    // invisible, which is the whole reason the column is being populated.
    const pp = groupShortToCanonical("ПП", index);
    const db = groupShortToCanonical("ДБ", index);
    const ppdb = groupShortToCanonical("ПП - ДБ", index);
    expect(new Set([pp, db, ppdb]).size).toBe(3);
  });

  it("THROWS on an unmapped short rather than returning null", () => {
    // A null would be written as NULL, which is indistinguishable from "this
    // parliament predates the roll-call corpus" — 1,559 MP roles are
    // legitimately blank, so a new group would hide among them for a whole NS.
    expect(() => groupShortToCanonical("НЯМА ТАКАВА ПГ", index)).toThrow(
      UnmappedGroupShortError,
    );
    expect(() => groupShortToCanonical("", index)).toThrow(
      UnmappedGroupShortError,
    );
  });

  it("gate 5.7 — client and server resolve every live short IDENTICALLY", () => {
    // Behavioural, not name-based. A first draft asserted "exactly one
    // declaration called PARLIAMENT_GROUP_ALIASES" — which was green while the
    // two sides genuinely disagreed on 5 of these 26, because they shared the
    // DATA and not the MATCHING RULE. What matters is that both arrive at the
    // same id, so that is what is asserted. `resolveNicknameToId` IS the client
    // path — `resolveCanonicalId` in useCanonicalParties.tsx is a one-line
    // delegation to it — so calling it here tests the real thing rather than a
    // copy that could drift from it.
    const clientResolve = (input: string): string | undefined =>
      resolveNicknameToId(input, index.byNickName);

    const divergent = LIVE_GROUP_SHORTS.filter((s) => {
      // Sentinels are server-only by design: the client has no notion of
      // „независим" as a party, so it correctly resolves nothing.
      if (isGroupSentinel(s)) return false;
      return clientResolve(s) !== groupShortToCanonical(s, index);
    }).map(
      (s) =>
        `${s}: client=${clientResolve(s)} server=${groupShortToCanonical(s, index)}`,
    );

    expect(divergent).toEqual([]);
  });

  it("gate 5.7 — the alias table is declared exactly once", () => {
    // Cheap structural companion to the behavioural check above: scoped to the
    // two directories that could hold a copy rather than walking the repo.
    const files = [
      "src/data/parties/parliamentGroupAliases.ts",
      "src/data/parties/useCanonicalParties.tsx",
      "scripts/person/partyGroups.ts",
      "scripts/parsers_local/local_coalitions.ts",
    ];
    const declaring = files.filter((f) =>
      /(const|let|var)\s+PARLIAMENT_GROUP_ALIASES\s*[:=]/.test(
        fs.readFileSync(path.join(REPO_ROOT, f), "utf-8"),
      ),
    );
    expect(declaring).toEqual(["src/data/parties/parliamentGroupAliases.ts"]);
  });

  it("INDEPENDENT_CANONICAL_ID has one source, re-exported by the parser", () => {
    // Two hand-kept copies of the sentinel id would let the local parser and
    // the MP crosswalk drift onto different values, and the loser renders as a
    // raw latin token — §0g's failure, back through a new door.
    expect(LOCAL_INDEPENDENT_ID).toBe(INDEPENDENT_CANONICAL_ID);
    const parserSrc = fs.readFileSync(
      path.join(REPO_ROOT, "scripts/parsers_local/local_coalitions.ts"),
      "utf-8",
    );
    expect(/export\s*\{\s*INDEPENDENT_CANONICAL_ID/.test(parserSrc)).toBe(true);
  });

  it("normalisation collisions are exactly the three known pairs", () => {
    // Normalising is lossy. These three collapse onto one key with DIFFERENT
    // ids, so they are treated as a MISS rather than resolved by JSON key
    // order. A fourth arriving with the next canonical regeneration must be a
    // visible decision, not a silently-picked lineage.
    expect(ambiguousNormalizedNicknames(index.byNickName)).toEqual(
      ["БНСНД", "НИЕ", "ВОЛЯ"].sort(),
    );
  });

  it("an ambiguous normalised short does not resolve by file order", () => {
    // `Воля` (p_76) and `ВОЛЯ` (p_99) normalise alike. The exact form still
    // resolves; a form that only matches after normalisation must not.
    expect(groupShortToCanonical("ВОЛЯ", index)).toBe("p_99");
    expect(() => groupShortToCanonical("В О Л Я", index)).toThrow(
      UnmappedGroupShortError,
    );
  });

  it("names the fix in the error it throws", () => {
    try {
      groupShortToCanonical("ПГ НА НЕЩО", index);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("PARLIAMENT_GROUP_ALIASES");
      expect((e as UnmappedGroupShortError).short).toBe("ПГ НА НЕЩО");
    }
  });
});
