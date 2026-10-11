import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
} from "d3-force";
import { preSettle } from "./preSettle";

/** A fake simulation whose alpha decays by `decay` per tick and whose ticks cost `msPerTick`
 *  on a fake clock — so chunking and the budget are checkable deterministically. */
const fakeSim = (decay: number, clock: { t: number }, msPerTick: number) => {
  let a = 1;
  const sim = {
    ticks: 0,
    stopped: false,
    alpha: () => a,
    alphaMin: () => 0.001,
    tick() {
      a *= 1 - decay;
      sim.ticks++;
      clock.t += msPerTick;
    },
    stop() {
      sim.stopped = true;
    },
  };
  return sim;
};

describe("preSettle", () => {
  afterEach(() => vi.useRealTimers());

  it("stops the sim's own timer and reveals once alpha has cooled", async () => {
    vi.useFakeTimers();
    const clock = { t: 0 };
    const sim = fakeSim(0.025, clock, 1);
    const onSettled = vi.fn();
    preSettle(sim, { revealAlpha: 0.05 }, onSettled, () => clock.t);
    expect(sim.stopped).toBe(true);
    await vi.runAllTimersAsync();
    expect(onSettled).toHaveBeenCalledOnce();
    expect(sim.alpha()).toBeLessThanOrEqual(0.05);
  });

  it("never ticks longer than one chunk at a time — no long task", async () => {
    vi.useFakeTimers();
    const clock = { t: 0 };
    const sim = fakeSim(0.025, clock, 1);
    preSettle(sim, { revealAlpha: 0.05, chunkMs: 8 }, vi.fn(), () => clock.t);
    await vi.advanceTimersByTimeAsync(0); // first chunk only
    expect(sim.ticks).toBeLessThanOrEqual(8);
    expect(sim.ticks).toBeGreaterThan(0);
  });

  it("reveals at the budget even if the layout is still hot", async () => {
    vi.useFakeTimers();
    const clock = { t: 0 };
    const sim = fakeSim(0.0001, clock, 1); // effectively never cools
    const onSettled = vi.fn();
    preSettle(
      sim,
      { revealAlpha: 0.05, budgetMs: 100 },
      onSettled,
      () => clock.t,
    );
    await vi.runAllTimersAsync();
    expect(onSettled).toHaveBeenCalledOnce();
    expect(sim.alpha()).toBeGreaterThan(0.05);
  });

  it("does nothing more once cancelled", async () => {
    vi.useFakeTimers();
    const clock = { t: 0 };
    const sim = fakeSim(0.025, clock, 1);
    const onSettled = vi.fn();
    const cancel = preSettle(
      sim,
      { revealAlpha: 0.05 },
      onSettled,
      () => clock.t,
    );
    cancel();
    await vi.runAllTimersAsync();
    expect(onSettled).not.toHaveBeenCalled();
    expect(sim.ticks).toBe(0);
  });

  it("settles a real d3 layout", async () => {
    const nodes: SimulationNodeDatum[] = Array.from({ length: 40 }, () => ({}));
    // forceLink's default id is the node index.
    const links = nodes.slice(1).map((_, i) => ({ source: i, target: i + 1 }));
    const sim = forceSimulation(nodes)
      .force("link", forceLink(links))
      .force("charge", forceManyBody())
      .alphaDecay(0.025);
    await new Promise<void>((resolve) =>
      preSettle(sim, { revealAlpha: 0.05 }, resolve),
    );
    expect(sim.alpha()).toBeLessThanOrEqual(0.05);
  });
});
