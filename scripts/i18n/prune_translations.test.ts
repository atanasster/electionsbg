// The planner is the only thing in this repo that decides to delete translated
// copy. `key_usage.test.ts` gates the analysis that feeds it; this gates what it
// does with the verdict.
import { describe, expect, it } from "vitest";
import { planPrune } from "./prune_translations";

const bg = { a_live: "едно", zz_dead: "две", b_live: "три" };
const en = { a_live: "one", zz_dead: "two", b_live: "three" };

describe("planPrune", () => {
  it("removes the dead key and preserves each file's own order", () => {
    const plan = planPrune(bg, en, ["zz_dead"]);
    expect(plan.dead).toEqual(["zz_dead"]);
    // NOT sorted — sorting is what turns a small deletion into a whole-file
    // rewrite, so the assertion is on order, not just on membership.
    expect(Object.keys(plan.kept.bg)).toEqual(["a_live", "b_live"]);
    expect(Object.keys(plan.kept.en)).toEqual(["a_live", "b_live"]);
  });

  it("keeps the values it does not delete", () => {
    const plan = planPrune(bg, en, ["zz_dead"]);
    expect(plan.kept.bg).toEqual({ a_live: "едно", b_live: "три" });
  });

  it("prunes only the intersection when the corpora have drifted", () => {
    // `bg_only` is dead by the analysis, but en never carried it — so the
    // verdict was never rendered against en's copy and bg must keep it.
    const driftedBg = { ...bg, bg_only: "само бг" };
    const plan = planPrune(driftedBg, en, ["zz_dead", "bg_only"]);
    expect(plan.dead).toEqual(["zz_dead"]);
    expect(plan.kept.bg).toHaveProperty("bg_only");
    expect(plan.onlyBg).toEqual(["bg_only"]);
    expect(plan.onlyEn).toEqual([]);
  });

  it("reports drift in both directions", () => {
    const plan = planPrune({ ...bg, x: "x" }, { ...en, y: "y" }, []);
    expect(plan.onlyBg).toEqual(["x"]);
    expect(plan.onlyEn).toEqual(["y"]);
  });

  it("is a no-op plan when nothing is dead", () => {
    const plan = planPrune(bg, en, []);
    expect(plan.dead).toEqual([]);
    expect(plan.kept.bg).toEqual(bg);
    expect(plan.kept.en).toEqual(en);
  });

  it("never mutates its inputs", () => {
    const snapshot = JSON.stringify(bg);
    planPrune(bg, en, ["zz_dead"]);
    expect(JSON.stringify(bg)).toBe(snapshot);
  });
});
