// The ratchet replaces a floor that could never fail. Its one safety property —
// it only ever moves UP — is what stops a bad run laundering a regression into
// the new normal, so it is worth testing directly.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dir: string;
let file: string;

// The module resolves its path at import time, so each case gets a fresh temp
// file and a fresh module registry.
const load = async () => {
  vi.resetModules();
  vi.doMock("node:url", async (orig) => ({
    ...(await orig<typeof import("node:url")>()),
    fileURLToPath: () => path.join(dir, "scripts", "procurement", "x.ts"),
  }));
  return import("./kzk_baselines");
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kzk-baselines-"));
  file = path.join(dir, "data", "procurement", "derived", "kzk_baselines.json");
});

afterEach(() => {
  vi.doUnmock("node:url");
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("kzk baselines ratchet", () => {
  it("falls back to the historical floor when no file exists", async () => {
    const { readBaselines } = await load();
    const b = readBaselines();
    expect(b.outcomes).toBe(2098);
    expect(b.matched).toBe(0);
    // NOT 0. A bar of zero passes forever — the "cannot tell healthy from
    // frozen" failure this whole file replaced — so "no bar yet" has to be
    // distinguishable, and Gate D fails on null with the mint command.
    expect(b.reached).toBeNull();
  });

  it("raises each field and reports which moved", async () => {
    const { recordBaselines, readBaselines } = await load();
    const raised = recordBaselines(
      {
        outcomes: 3014,
        matched: 2860,
        reached: 4900,
        appeals: 8007,
        decisionsMerits: 4502,
      },
      "2026-08-02",
    );
    // `matched` is NOT here: it is an observation, not a bar. Re-arming a
    // `matched` ratchet reinstates the 2026-08-25 false positive.
    //
    // ⚠️ THIS ASSERTION IS ALSO THE GUARD ON `RATCHETED` ITSELF. A diagnostic
    // wrongly added there shows up here as an extra entry — verified: with
    // "appeals" in RATCHETED this reads ["appeals","outcomes","reached"] and
    // fails. That matters because `updatedAt` means "when a bar last rose" and
    // BOTH gates quote it, so a last-seen field in RATCHETED would silently
    // redefine it as "when the corpus last grew". Do not relax this to a
    // subset check.
    expect(raised.raised.sort()).toEqual(["outcomes", "reached"]);
    const b = readBaselines();
    expect(b.outcomes).toBe(3014);
    expect(b.matched).toBe(2860);
    expect(b.reached).toBe(4900);
    expect(b.updatedAt).toBe("2026-08-02");
    expect(fs.existsSync(file)).toBe(true);
  });

  it("NEVER lowers a BAR", async () => {
    const { recordBaselines, readBaselines } = await load();
    recordBaselines(
      {
        outcomes: 3014,
        matched: 2860,
        reached: 4900,
        appeals: 8007,
        decisionsMerits: 4502,
      },
      "2026-08-02",
    );
    // A run against a half-loaded database must not be able to move the bar down
    // and thereby make its own regression the new normal.
    const raised = recordBaselines(
      {
        outcomes: 12,
        matched: 5,
        reached: 9,
        appeals: 8007,
        decisionsMerits: 4502,
      },
      "2026-08-03",
    );
    expect(raised.raised).toEqual([]);
    const b = readBaselines();
    expect(b.outcomes).toBe(3014);
    expect(b.reached).toBe(4900);
    expect(b.updatedAt).toBe("2026-08-02"); // unchanged: no BAR moved
  });

  it("DOES lower `matched` — it is an observation, and that is the point", async () => {
    // The counter-test to the one above, and the distinction the Gate D swap
    // rests on. Kept as a running max, `matched` would sit at 2,860 for ever
    // while the matcher reported 2,858 — a committed number describing nothing.
    // A fall in it is how a reader SEES corpus growth withdrawing matches, which
    // is the signal the old gate mistook for a regression.
    const { recordBaselines, readBaselines } = await load();
    recordBaselines(
      {
        outcomes: 3014,
        matched: 2860,
        reached: 4900,
        appeals: 8007,
        decisionsMerits: 4502,
      },
      "2026-08-02",
    );
    const raised = recordBaselines(
      {
        outcomes: 3014,
        matched: 2858,
        reached: 4900,
        appeals: 8007,
        decisionsMerits: 4502,
      },
      "2026-09-09",
    );
    expect(raised.raised).toEqual([]); // no bar moved, so nothing is "raised"…
    const b = readBaselines();
    expect(b.matched).toBe(2858); // …but the observation was refreshed
    expect(b.updatedAt).toBe("2026-08-02"); // `updatedAt` means "bar", not "write"
  });

  it("an observation-only write is REPORTED, not silent", async () => {
    // The rejoin prints its commit instruction from this return value, and
    // kzk_baselines.json is COMMITTED — so a write nobody is told about leaves a
    // modified tracked file behind, in a repo with a concurrent auto-committer.
    // `reached` holding while `matched` drifts is the STEADY STATE after the
    // 2026-08-25 swap, not a corner case, which is why `wrote` exists apart from
    // `raised` instead of being inferred from it.
    const { recordBaselines } = await load();
    recordBaselines(
      {
        outcomes: 3078,
        matched: 2918,
        reached: 4932,
        appeals: 8007,
        decisionsMerits: 4502,
      },
      "2026-08-25",
    );
    const before = fs.readFileSync(file, "utf8");
    const res = recordBaselines(
      {
        outcomes: 3078,
        matched: 2915,
        reached: 4932,
        appeals: 8007,
        decisionsMerits: 4502,
      },
      "2026-09-01",
    );
    expect(fs.readFileSync(file, "utf8")).not.toBe(before); // the file DID move…
    expect(res.wrote).toBe(true); // …and the caller can tell…
    expect(res.raised).toEqual([]); // …without it counting as a raise
  });

  it("reports wrote:false when the file genuinely did not move", async () => {
    // The other half of the pair: `wrote` must discriminate, or the rejoin
    // prints a commit instruction after every run and the operator learns to
    // ignore it.
    const { recordBaselines } = await load();
    recordBaselines(
      {
        outcomes: 3078,
        matched: 2918,
        reached: 4932,
        appeals: 8007,
        decisionsMerits: 4502,
      },
      "2026-08-25",
    );
    const res = recordBaselines(
      {
        outcomes: 3078,
        matched: 2918,
        reached: 4932,
        appeals: 8007,
        decisionsMerits: 4502,
      },
      "2026-09-01",
    );
    expect(res.wrote).toBe(false);
    expect(res.raised).toEqual([]);
  });

  it("does not rewrite the file when nothing moved", async () => {
    const { recordBaselines } = await load();
    recordBaselines(
      {
        outcomes: 3014,
        matched: 2860,
        reached: 4900,
        appeals: 8007,
        decisionsMerits: 4502,
      },
      "2026-08-02",
    );
    const before = fs.readFileSync(file, "utf8");
    recordBaselines(
      {
        outcomes: 3014,
        matched: 2860,
        reached: 4900,
        appeals: 8007,
        decisionsMerits: 4502,
      },
      "2026-09-09",
    );
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("treats a corrupt ratchet as the floor, not as no bar at all", async () => {
    const { readBaselines } = await load();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ not json");
    expect(readBaselines().outcomes).toBe(2098);
    expect(readBaselines().reached).toBeNull();
  });

  it("reads a file written before the Gate D swap as NO BAR, not a bar of 0", async () => {
    // The realistic transition state: `kzk_baselines.json` is COMMITTED, so any
    // checkout from before 2026-08-25 carries outcomes + matched and no
    // `reached`. Read as 0 that would satisfy `report.reached >= 0` for ever on
    // every database — a gate that never looks, wearing the ratchet's name.
    const { readBaselines } = await load();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        outcomes: 3078,
        matched: 2920,
        updatedAt: "2026-08-21",
      }),
    );
    const b = readBaselines();
    expect(b.outcomes).toBe(3078);
    expect(b.reached).toBeNull();
    expect(b.reached).not.toBe(0);
  });

  it("counts the FIRST mint of a bar as raised, so the operator is told to commit", async () => {
    // null → number is the transition that ARMS Gate D. Reported as "nothing
    // moved" the rejoin prints no commit instruction, the file stays unstaged,
    // and the next run reads no bar again — the mint silently never lands.
    const { recordBaselines, readBaselines } = await load();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        outcomes: 3078,
        matched: 2920,
        updatedAt: "2026-08-21",
      }),
    );
    const raised = recordBaselines(
      {
        outcomes: 3078,
        matched: 2918,
        reached: 4932,
        appeals: 8007,
        decisionsMerits: 4502,
      },
      "2026-08-25",
    );
    expect(raised.raised).toEqual(["reached"]);
    const b = readBaselines();
    expect(b.reached).toBe(4932);
    expect(b.matched).toBe(2918); // the observation follows the matcher down
    expect(b.updatedAt).toBe("2026-08-25");
  });

  it("a null observation cannot erase an existing bar", async () => {
    // Defensive: a caller that fails to compute `reached` must hold the line
    // rather than blank it, for the same reason a half-loaded run may not lower
    // one. Ratchets fail closed.
    const { recordBaselines, readBaselines } = await load();
    recordBaselines(
      {
        outcomes: 3014,
        matched: 2860,
        reached: 4900,
        appeals: 8007,
        decisionsMerits: 4502,
      },
      "2026-08-02",
    );
    recordBaselines(
      {
        outcomes: 3014,
        matched: 2860,
        reached: null,
        appeals: 8007,
        decisionsMerits: 4502,
      },
      "2026-09-09",
    );
    expect(readBaselines().reached).toBe(4900);
  });

  it("a NON-FINITE observation cannot erase an existing bar either", async () => {
    // `??` catches null and undefined; NaN sails through Math.max, and
    // JSON.stringify(NaN) is `null` — so without a finiteness guard the bar is
    // not merely held, it is DESTROYED, and Gate D's recovery is a re-mint from
    // the current corpus. That launders whatever regression is live into the new
    // normal, the one direction this file's header forbids.
    const { recordBaselines, readBaselines } = await load();
    recordBaselines(
      {
        outcomes: 3014,
        matched: 2860,
        reached: 4900,
        appeals: 8007,
        decisionsMerits: 4502,
      },
      "2026-08-02",
    );
    recordBaselines(
      {
        outcomes: 3014,
        matched: 2858,
        reached: Number.NaN,
        appeals: 8007,
        decisionsMerits: 4502,
      },
      "2026-09-09",
    );
    expect(readBaselines().reached).toBe(4900);
  });

  it("a non-finite observation cannot MINT a bar out of nothing", async () => {
    // The same guard from the other side: with no bar yet, NaN must leave the
    // ratchet unarmed so Gate D keeps failing with the mint command, rather than
    // writing `null` and looking minted.
    const { recordBaselines, readBaselines } = await load();
    recordBaselines(
      {
        outcomes: 3014,
        matched: 2860,
        reached: Number.POSITIVE_INFINITY,
        appeals: 8007,
        decisionsMerits: 4502,
      },
      "2026-08-02",
    );
    expect(readBaselines().reached).toBeNull();
  });

  it("never ratchets handSeeded — that population is closed", async () => {
    const mod = await load();
    // The only way the observed count can rise is the laundering hazard, so the
    // floor is a CONSTANT. Raising it would make that corruption self-certifying.
    expect(mod.HAND_SEEDED_FLOOR).toBe(2098);
    expect(Object.keys(mod.readBaselines())).not.toContain("handSeeded");
  });

  it("fills a missing field from the floor rather than reading it as zero", async () => {
    const { readBaselines } = await load();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ outcomes: 3014 }));
    const b = readBaselines();
    expect(b.outcomes).toBe(3014);
    expect(b.matched).toBe(0);
  });

  it("records the corpus the bars were measured against", async () => {
    // Diagnostic only — its whole job is to let a gate failure say "the corpus
    // grew 7,998 → 8,007 since this bar was set", the sentence whose absence
    // sent an operator after an untouched matcher on 2026-08-25.
    const { recordBaselines, readBaselines } = await load();
    recordBaselines(
      {
        outcomes: 3078,
        matched: 2918,
        reached: 4932,
        appeals: 8007,
        decisionsMerits: 4502,
      },
      "2026-08-25",
    );
    const b = readBaselines();
    expect(b.appeals).toBe(8007);
    expect(b.decisionsMerits).toBe(4502);
  });

  it("tracks the corpus DOWNWARD too — it is not a bar", async () => {
    // A max here would make the diagnostic lie in exactly the case it exists to
    // explain, and it must never gate anything: "only ratchet when the corpus is
    // unchanged" is a gate that stops asserting the moment data lands.
    const { recordBaselines, readBaselines } = await load();
    recordBaselines(
      {
        outcomes: 3078,
        matched: 2918,
        reached: 4932,
        appeals: 8007,
        decisionsMerits: 4502,
      },
      "2026-08-25",
    );
    const res = recordBaselines(
      {
        outcomes: 3078,
        matched: 2918,
        reached: 4932,
        appeals: 7998,
        decisionsMerits: 4400,
      },
      "2026-09-01",
    );
    expect(readBaselines().appeals).toBe(7998);
    expect(readBaselines().reached).toBe(4932); // the BAR did not follow it down
    expect(res.raised).toEqual([]);
    expect(res.wrote).toBe(true); // a committed file moved, so say so
  });

  it("reads a pre-2026-08-25 file's corpus fields as null, not zero", async () => {
    // A consumer renders the delta conditionally; read as 0 the message would
    // say "appeals 0 → 8007", i.e. invent a corpus that never existed.
    const { readBaselines } = await load();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        outcomes: 3078,
        matched: 2920,
        updatedAt: "2026-08-21",
      }),
    );
    const b = readBaselines();
    expect(b.appeals).toBeNull();
    expect(b.decisionsMerits).toBeNull();
  });

  it("every RATCHETED field is a max, every OBSERVED one is last-seen", async () => {
    // The converse arm of the guard above: `RATCHETED` and the `next` object
    // literal in recordBaselines each declare which fields are bars, and the two
    // can drift on a one-word edit that typechecks. Feeding a uniformly LOWER
    // observation separates them by behaviour rather than by name.
    const { recordBaselines, readBaselines } = await load();
    const high = {
      outcomes: 3078,
      matched: 2918,
      reached: 4932,
      appeals: 8007,
      decisionsMerits: 4502,
    };
    recordBaselines(high, "2026-08-25");
    recordBaselines(
      { outcomes: 1, matched: 1, reached: 1, appeals: 1, decisionsMerits: 1 },
      "2026-09-01",
    );
    const b = readBaselines();
    expect(b.outcomes).toBe(3078); // bar: held
    expect(b.reached).toBe(4932); // bar: held
    expect(b.matched).toBe(1); // observation: followed it down
    expect(b.appeals).toBe(1); // observation
    expect(b.decisionsMerits).toBe(1); // observation
    expect(b.updatedAt).toBe("2026-08-25"); // no bar moved
  });

  it("names WHICH observations were refreshed, not just that one was", async () => {
    // The run that introduced appeals/decisionsMerits announced "refreshed the
    // `matched` observation" — the one field that had NOT moved. `refreshed` is
    // derived from OBSERVED so the message and the write cannot drift.
    const { recordBaselines } = await load();
    const base = {
      outcomes: 3078,
      matched: 2918,
      reached: 4932,
      appeals: 8007,
      decisionsMerits: 4502,
    };
    recordBaselines(base, "2026-08-25");
    const res = recordBaselines({ ...base, appeals: 8016 }, "2026-09-01");
    expect(res.refreshed).toEqual(["appeals"]);
    expect(res.raised).toEqual([]);
    expect(res.wrote).toBe(true);
  });

  it("a non-finite diagnostic cannot blank a recorded corpus", async () => {
    // Same rule as `reached`: NaN sails through `??` and JSON.stringify writes it
    // as null, so the diagnostic would silently blank AND rewrite the committed
    // file to say so. Ratchets fail closed in every direction.
    const { recordBaselines, readBaselines } = await load();
    const base = {
      outcomes: 3078,
      matched: 2918,
      reached: 4932,
      appeals: 8007,
      decisionsMerits: 4502,
    };
    recordBaselines(base, "2026-08-25");
    const res = recordBaselines({ ...base, appeals: Number.NaN }, "2026-09-01");
    expect(readBaselines().appeals).toBe(8007);
    expect(res.wrote).toBe(false);
  });
});

// The one piece of Gate D/C failure text that is computed rather than literal,
// and it returns "" on every healthy run — so without these it is live code whose
// only observable behaviour appears when something is already going wrong.
describe("corpusDelta", () => {
  const B = { appeals: 8007, decisionsMerits: 4502 };

  it("is silent when the corpus has not moved", async () => {
    const { corpusDelta } = await load();
    expect(corpusDelta(B, 8007, 4502, "reached")).toBe("");
  });

  it("is silent when the ratchet predates the fields — and invents no corpus", async () => {
    const { corpusDelta } = await load();
    const out = corpusDelta(
      { appeals: null, decisionsMerits: null },
      8007,
      4502,
      "reached",
    );
    expect(out).toBe("");
    expect(out).not.toMatch(/null|→/);
  });

  it("names the BASELINE first and the CURRENT second", async () => {
    // Pins argument order. Both params are bare numbers, so a swapped call site
    // compiles, lints clean and prints "appeals 8007 → 4502" on a red gate.
    const { corpusDelta } = await load();
    expect(corpusDelta(B, 8100, 4502, "reached")).toContain(
      "appeals 8007 → 8100",
    );
    expect(corpusDelta(B, 8007, 4600, "reached")).toContain(
      "merits-eligible decisions 4502 → 4600",
    );
  });

  it("renders half a delta when only one side is known", async () => {
    // Gate C runs without kzk_decisions and passes null for the merits side.
    const { corpusDelta } = await load();
    const out = corpusDelta(B, 8100, null, "reached");
    expect(out).toContain("appeals 8007 → 8100");
    expect(out).not.toContain("merits-eligible");
  });

  it("does NOT dismiss a decisions shrink — that is Gate D's cause 3", async () => {
    // Growth cannot lower `reached`, so there the tail is right to say "context,
    // not an excuse". A SHRINK can lower it legitimately, and the same sentence
    // would then dismiss the evidence it just produced.
    const { corpusDelta } = await load();
    expect(corpusDelta(B, 8007, 4400, "reached")).toContain("SHRANK");
    expect(corpusDelta(B, 8007, 4400, "reached")).toContain(
      "anti-shrink guard",
    );
    expect(corpusDelta(B, 8007, 4400, "reached")).not.toContain(
      "not an excuse",
    );
    expect(corpusDelta(B, 8100, 4502, "reached")).toContain("not an excuse");
    expect(corpusDelta(B, 8100, 4502, "reached")).not.toContain("SHRANK");
  });

  it("does NOT dismiss an APPEALS shrink either — reached counts appeals", async () => {
    // The asymmetric half. `reached` is a count of APPEALS, so an appeals shrink
    // lowers it just as directly as a decisions shrink does — an appeal that is
    // gone cannot be reached. Reachable because the ratchet is COMMITTED while
    // both corpora are gitignored, so a fresh clone holds fewer of each.
    const { corpusDelta } = await load();
    const out = corpusDelta(B, 7998, 4502, "reached");
    expect(out).toContain("APPEALS");
    expect(out).toContain("SHRANK");
    expect(out).not.toContain("not an excuse");
  });

  it("names BOTH sides when both shrank", async () => {
    const { corpusDelta } = await load();
    expect(corpusDelta(B, 7998, 4400, "reached")).toContain(
      "APPEALS and DECISIONS",
    );
  });

  it("speaks the CALLING gate's bar, never the other gate's", async () => {
    // Gate C asserts on `outcomes` and Gate D on `reached`; the tail is a claim
    // about monotonicity and the two are monotone for different reasons, so a
    // shared sentence naming `reached` inside Gate C's message would be an
    // assertion about a quantity that message never mentions.
    const { corpusDelta } = await load();
    expect(corpusDelta(B, 8100, 4502, "outcomes")).toContain("`outcomes`");
    expect(corpusDelta(B, 8100, 4502, "outcomes")).not.toContain("`reached`");
    expect(corpusDelta(B, 8100, 4502, "reached")).toContain("`reached`");
  });
});

describe("kzk baselines — bars fail closed in every direction", () => {
  const base = {
    outcomes: 3078,
    matched: 2918,
    reached: 4932,
    appeals: 8007,
    decisionsMerits: 4502,
  };

  it("a non-finite `outcomes` cannot destroy Gate C's bar", async () => {
    // The sibling of the `reached` guard, and it was missing from the first cut
    // of the finite() refactor. NaN is written as JSON null, which readBaselines
    // maps to FLOOR.outcomes — dropping Gate C from 3,078 to the 2,098 HARDCODED
    // FLOOR the ratchet exists to replace, in a committed file, on a run that had
    // some other reason to rewrite it.
    const { recordBaselines, readBaselines } = await load();
    recordBaselines(base, "2026-08-25");
    recordBaselines(
      { ...base, outcomes: Number.NaN, appeals: 8016 },
      "2026-09-01",
    );
    expect(readBaselines().outcomes).toBe(3078);
    expect(readBaselines().outcomes).not.toBe(2098);
  });

  it("a non-finite `matched` cannot be reported as a refresh", async () => {
    const { recordBaselines, readBaselines } = await load();
    recordBaselines(base, "2026-08-25");
    const res = recordBaselines({ ...base, matched: Number.NaN }, "2026-09-01");
    expect(readBaselines().matched).toBe(2918);
    expect(res.refreshed).toEqual([]);
    expect(res.wrote).toBe(false);
  });
});
