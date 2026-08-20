import { describe, it, expect } from "vitest";
import {
  reconcileRowLoss,
  describeReconciliation,
  chainsAccountedFor,
  cliffVerdict,
  CHAIN_COLLAPSE_SHARE,
  RESIDUE_TOLERANCE,
} from "./chain_reconcile";

/** A feed of `n` chains each filing `per` rows. */
const feed = (n: number, per: number, prefix = "c"): Map<string, number> =>
  new Map(Array.from({ length: n }, (_, i) => [`${prefix}${i}`, per]));

/** Every eik in `m`, i.e. "the archive held a file for each of these". */
const archive = (...ms: Map<string, number>[]): Set<string> =>
  new Set(ms.flatMap((m) => [...m.keys()]));

describe("reconcileRowLoss", () => {
  it("explains a drop caused by two chains going silent", () => {
    // The real 2026-08-15 shape: Кауфланд absent, Билла down to ~1%.
    const prev = new Map([
      ["kaufland", 144_211],
      ["billa", 171_275],
      ["lidl", 99_243],
      ["dm", 88_102],
    ]);
    const today = new Map([
      ["billa", 1_768],
      ["lidl", 99_243],
      ["dm", 88_102],
    ]);
    const r = reconcileRowLoss(prev, today, 0, archive(today));

    expect(r.collapsed.map((c) => c.eik).sort()).toEqual(["billa", "kaufland"]);
    expect(r.explainedLoss).toBe(144_211 + (171_275 - 1_768));
    expect(r.unexplainedLoss).toBe(0);
    expect(r.explained).toBe(true);
  });

  it("refuses a uniform slice off every chain — the parse-regression shape", () => {
    // Every chain halves. No chain is individually collapsed (50% is above the
    // 20% bar), so nothing is attributable and the whole drop is residue.
    const today = feed(10, 500);
    const r = reconcileRowLoss(feed(10, 1_000), today, 0, archive(today));

    expect(r.collapsed).toHaveLength(0);
    expect(r.explainedLoss).toBe(0);
    expect(r.unexplainedLoss).toBe(5_000);
    expect(r.residueShare).toBeCloseTo(0.5, 6);
    expect(r.explained).toBe(false);
  });

  it("tolerates ordinary churn among the survivors", () => {
    const prev = new Map([...feed(9, 1_000), ["gone", 5_000]]);
    // 'gone' vanishes (explained) and the survivors each lose 2% (churn).
    const today = feed(9, 980);
    const r = reconcileRowLoss(prev, today, 0, archive(today));

    expect(r.explainedLoss).toBe(5_000);
    expect(r.unexplainedLoss).toBe(180);
    expect(r.residueShare).toBeLessThan(RESIDUE_TOLERANCE);
    expect(r.explained).toBe(true);
  });

  it("a parse error forbids attribution however clean the arithmetic", () => {
    const prev = new Map([
      ["gone", 100_000],
      ["stays", 100_000],
    ]);
    const today = new Map([["stays", 100_000]]);

    // Identical inputs, only parseErrors differs.
    expect(reconcileRowLoss(prev, today, 0, archive(today)).explained).toBe(
      true,
    );
    expect(reconcileRowLoss(prev, today, 1, archive(today)).explained).toBe(
      false,
    );
    expect(
      reconcileRowLoss(prev, today, 1, archive(today)).unexplainedLoss,
    ).toBe(0);
  });

  // TEST-001 / FINDING-001. The case the whole `archiveEiks` argument exists
  // for, and the one a `now === 0` fallback cannot see.
  it("a chain whose file was PUBLISHED but parsed to nothing is not a collapse", () => {
    const prev = new Map([
      ["billa", 171_275],
      ["lidl", 99_243],
    ]);
    const today = new Map([["lidl", 99_243]]);

    // Билла's CSV WAS in the archive and yielded zero rows — our parse failing,
    // not the source withholding. Never attributable.
    const published = reconcileRowLoss(
      prev,
      today,
      0,
      new Set(["billa", "lidl"]),
    );
    expect(published.unreadable.map((c) => c.eik)).toEqual(["billa"]);
    expect(published.collapsed).toHaveLength(0);
    expect(published.explainedLoss).toBe(0);
    expect(published.explained).toBe(false);

    // Same numbers, file genuinely absent: the source published less. Explained.
    const absent = reconcileRowLoss(prev, today, 0, new Set(["lidl"]));
    expect(absent.unreadable).toHaveLength(0);
    expect(absent.collapsed[0]?.absentFromArchive).toBe(true);
    expect(absent.explained).toBe(true);
  });

  it("distinguishes absent-from-archive from present-but-collapsed", () => {
    const prev = new Map([
      ["absent", 10_000],
      ["emptied", 10_000],
    ]);
    // 'emptied' filed a SMALL file — a real collapse leaves a trace.
    const today = new Map([["emptied", 100]]);
    const r = reconcileRowLoss(prev, today, 0, new Set(["emptied"]));

    const byEik = new Map(r.collapsed.map((c) => [c.eik, c]));
    expect(byEik.get("absent")!.absentFromArchive).toBe(true);
    expect(byEik.get("emptied")!.absentFromArchive).toBe(false);
    // The distinction is reported, not arithmetic: both are explained loss.
    expect(r.explainedLoss).toBe(10_000 + 9_900);
    expect(r.explained).toBe(true);
  });

  // TEST-004 / FINDING-002. A net-global residue would let growth cancel a real
  // loss; a per-survivor one cannot.
  it("growth in one chain cannot cancel a real loss in another", () => {
    const prev = new Map([
      ["gone", 100_000],
      ["s1", 200_000],
      ["s2", 200_000],
    ]);
    // Survivors each lose 30% — the regression shape — while a NEW chain
    // arrives with enough volume to keep the total flat.
    const today = new Map([
      ["s1", 140_000],
      ["s2", 140_000],
      ["new", 220_000],
    ]);
    const r = reconcileRowLoss(prev, today, 0, archive(today));

    expect(r.observedLoss).toBe(0); // the total is unchanged…
    expect(r.unexplainedLoss).toBe(120_000); // …but the survivors bled
    expect(r.explained).toBe(false);
  });

  it("a chain sitting exactly at the collapse bar is not collapsed", () => {
    const prev = new Map([["c", 1_000]]);
    const today = new Map([["c", 1_000 * CHAIN_COLLAPSE_SHARE]]);
    expect(
      reconcileRowLoss(prev, today, 0, archive(today)).collapsed,
    ).toHaveLength(0);
  });

  it("a day that GREW has no unexplained loss", () => {
    const today = feed(5, 200);
    const r = reconcileRowLoss(feed(5, 100), today, 0, archive(today));
    expect(r.observedLoss).toBeLessThan(0);
    expect(r.unexplainedLoss).toBe(0);
    expect(r.residueShare).toBe(0);
    expect(r.explained).toBe(true);
  });

  it("handles an empty previous day without dividing by zero", () => {
    const r = reconcileRowLoss(new Map(), feed(3, 10), 0);
    expect(r.residueShare).toBe(0);
    expect(r.explained).toBe(true);
  });

  // MUTATION CHECK (plan T5). The suite must be satisfied by the real rule and
  // NOT by one that has stopped attributing.
  it("fails the two-chain case when attribution is defeated", () => {
    const prev = new Map([
      ["kaufland", 144_211],
      ["billa", 171_275],
      ["lidl", 99_243],
    ]);
    const today = new Map([["lidl", 99_243]]);
    expect(reconcileRowLoss(prev, today, 0, archive(today)).explained).toBe(
      true,
    );

    // Same drop, but the collapsed chains are absent from `prev` too — nothing
    // to attribute the loss to. A rule that still says "explained" is not
    // reconciling.
    const blind = reconcileRowLoss(new Map([["lidl", 414_729]]), today, 0);
    expect(blind.collapsed).toHaveLength(0);
    expect(blind.explained).toBe(false);
  });
});

describe("chainsAccountedFor", () => {
  it("passes when the missing chains are the ones identified", () => {
    const prev = new Map([...feed(10, 1_000)]);
    const today = feed(8, 1_000);
    const r = reconcileRowLoss(prev, today, 0, archive(today));
    // 8 today + 2 identified as collapsed = the 10 there were.
    expect(chainsAccountedFor(r, 8, 10, 0.2)).toBe(true);
  });

  it("fails when chains vanished without being identified", () => {
    // 4 of 10 chains gone but none classified collapsed (the caller passes a
    // reconciliation that explains nothing).
    const r = reconcileRowLoss(new Map(), new Map(), 0);
    expect(chainsAccountedFor(r, 6, 10, 0.2)).toBe(false);
  });

  it("is vacuously true with no previous day", () => {
    const r = reconcileRowLoss(new Map(), new Map(), 0);
    expect(chainsAccountedFor(r, 0, 0, 0.2)).toBe(true);
  });
});

// TEST-003 / FINDING-005(2). The throw is the branch that matters most and the
// hardest to reach from an integration test, so the decision is pinned here.
describe("cliffVerdict", () => {
  const explained = reconcileRowLoss(
    new Map([
      ["gone", 100_000],
      ["stays", 100_000],
    ]),
    new Map([["stays", 100_000]]),
    0,
    new Set(["stays"]),
  );
  const notExplained = reconcileRowLoss(feed(10, 1_000), feed(10, 500), 0);

  it("loads when the drop is attributable and the chains add up", () => {
    expect(cliffVerdict(explained, true, false)).toBe("load");
  });

  it("THROWS when the drop is not attributable and no bypass was passed", () => {
    expect(cliffVerdict(notExplained, true, false)).toBe("throw");
  });

  it("throws when rows reconcile but the CHAINS do not", () => {
    // The row verdict must not clear a chain-count trigger on its own.
    expect(cliffVerdict(explained, false, false)).toBe("throw");
  });

  it("downgrades to a loud bypass under --no-floor, never silence", () => {
    expect(cliffVerdict(notExplained, true, true)).toBe("warn-bypass");
    expect(cliffVerdict(explained, false, true)).toBe("warn-bypass");
  });

  it("a bypass cannot turn an attributable day into anything but a load", () => {
    expect(cliffVerdict(explained, true, true)).toBe("load");
  });
});

describe("describeReconciliation", () => {
  it("names the chains rather than counting them", () => {
    const prev = new Map([
      ["130007884", 171_275],
      ["131129282", 144_211],
      ["keep", 50_000],
    ]);
    const today = new Map([["keep", 50_000]]);
    const msg = describeReconciliation(
      reconcileRowLoss(prev, today, 0, new Set(["keep"])),
      (eik) => ({ "130007884": "Билла", "131129282": "Кауфланд" })[eik] ?? eik,
    );

    expect(msg).toContain("Билла");
    expect(msg).toContain("Кауфланд");
    expect(msg).toContain("2 collapsed chain(s)");
  });

  it("says plainly when nothing is attributable", () => {
    const today = feed(10, 500);
    const msg = describeReconciliation(
      reconcileRowLoss(feed(10, 1_000), today, 0, archive(today)),
    );
    expect(msg).toContain("no chain individually collapsed");
  });

  it("calls out a published file that parsed to nothing", () => {
    const msg = describeReconciliation(
      reconcileRowLoss(
        new Map([["billa", 171_275]]),
        new Map(),
        0,
        new Set(["billa"]),
      ),
      () => "Билла",
    );
    expect(msg).toContain("parsed to");
    expect(msg).toContain("NOTHING");
  });

  // FINDING-007: no "−0".
  it("never renders a signed zero, and shows growth as a gain", () => {
    const flat = describeReconciliation(
      reconcileRowLoss(feed(3, 100), feed(3, 100), 0, archive(feed(3, 100))),
    );
    expect(flat).not.toContain("−0");
    expect(flat).toContain("0 rows");

    const grew = describeReconciliation(
      reconcileRowLoss(feed(3, 100), feed(3, 200), 0, archive(feed(3, 200))),
    );
    expect(grew).toContain("+300 rows");
    expect(grew).not.toContain("−0");
  });
});
