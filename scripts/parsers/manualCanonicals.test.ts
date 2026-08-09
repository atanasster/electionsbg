// The `independent` sentinel must stay labelled AND lineage-free.
//
// WHY this is a plain unit test rather than a *.data.test.ts. It asserts a
// property of two FILES — the hand-curated source and the generated artifact —
// and touches no database. Its first home was inside
// scripts/db/tests/party_labels.data.test.ts, behind that file's
// `if (!haveDb) return t.skip()`; CI provisions no Postgres ("Hermetic — no
// browser, emulator or database"), so the single invariant this design rests on
// skipped on every push and only ever ran on a machine with docker up.
//
// WHAT it protects. `independent` is not a party — it is the marker for
// "stood without one", minted by local_coalitions.ts for every „Инициативен
// комитет". It carries an EMPTY history on purpose: every consumer of
// CanonicalParty.history is cross-election (fullNameFor, usePartyScope,
// ChmiPartyBadge, PartyPollingDeltaTile), so a fake election row would enter
// „Независим" into party-vs-party series as though it had contested them.
//
// Asserting the SOURCE and the ARTIFACT together is the point: the generator is
// what could reintroduce a history, and the pair is what proves the artifact was
// regenerated after the source last changed.

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { manualCanonicals } from "./manualCanonicals";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const artifact = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "data/canonical_parties.json"), "utf-8"),
) as {
  parties: {
    id: string;
    displayName: string;
    displayNameEn?: string;
    color: string;
    history: unknown[];
  }[];
};

describe("the independent sentinel", () => {
  it("is declared in the source with a Bulgarian label and no lineage", () => {
    const src = manualCanonicals.find((m) => m.id === "independent");
    expect(src, "`independent` missing from manualCanonicals").toBeDefined();
    expect(src!.displayName).toBe("Независим");
    expect(src!.displayNameEn).toBe("Independent");
    expect(
      src!.history,
      "the sentinel is the ABSENCE of a party — a history entry would put it into cross-election party series",
    ).toEqual([]);
  });

  it("reached the generated artifact unchanged", () => {
    // Catches the other half: a source edit that was never regenerated, or a
    // generator change that dropped/rewrote the entry.
    const built = artifact.parties.find((p) => p.id === "independent");
    expect(
      built,
      "`independent` missing from data/canonical_parties.json — regenerate it",
    ).toBeDefined();
    const src = manualCanonicals.find((m) => m.id === "independent")!;
    expect(built!.displayName).toBe(src.displayName);
    expect(built!.displayNameEn).toBe(src.displayNameEn);
    expect(built!.color).toBe(src.color);
    expect(built!.history).toEqual([]);
  });

  it("keeps the colour the local pipeline already baked", () => {
    // Not a free choice: 392 committed local bundles carry this exact value for
    // `independent`, so changing it here would make colorFor disagree with the
    // artifacts rather than restyle anything.
    const src = manualCanonicals.find((m) => m.id === "independent")!;
    expect(src.color).toBe("rgb(148, 163, 184)");
  });

  it("no manual canonical collides with a generated lineage id", () => {
    // The generator warns and SKIPS on a collision, so a colliding entry is
    // silently absent from the artifact rather than an error.
    const built = new Map(artifact.parties.map((p) => [p.id, p]));
    const missing = manualCanonicals
      .filter((m) => !built.has(m.id))
      .map((m) => m.id);
    expect(
      missing,
      "manual canonicals absent from the artifact — the generator skipped them (id collision) or it was not regenerated",
    ).toEqual([]);
  });
});
