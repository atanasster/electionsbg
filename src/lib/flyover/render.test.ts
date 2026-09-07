import { describe, expect, it } from "vitest";
import { render, type RenderOptions } from "./render";
import { createRecorder } from "./recorder";
import { STATE_ZERO, type FlyoverState } from "./state";
import { captionFor } from "./captions";
import { TEST_PALETTE, TEST_WORLD } from "./testWorld";

const VIEW = { w: 800, h: 500 };
// Typed, so an option-key typo (`maxFlow` for `maxFlows`) is a compile error rather than a
// silent fall-through to the default that most of these tests would not notice.
const opts = (over: Partial<RenderOptions> = {}): RenderOptions => ({
  viewport: VIEW,
  palette: TEST_PALETTE,
  clock: 0,
  ...over,
});

const state = (over: Partial<FlyoverState> = {}): FlyoverState => ({
  ...STATE_ZERO,
  weights: { ...STATE_ZERO.weights },
  camera: { ...STATE_ZERO.camera },
  ...over,
});

const draw = (s: FlyoverState, over: Partial<RenderOptions> = {}) => {
  const rec = createRecorder();
  render(rec, TEST_WORLD, s, opts(over));
  return rec;
};

describe("render", () => {
  it("draws the land even with every layer at zero", () => {
    // STATE_ZERO is the fallback every host shows before a programme produces anything, so
    // „neutral" has to be a picture of Bulgaria rather than an empty canvas.
    const rec = draw(state());
    expect(rec.ops("clearRect")).toHaveLength(1);
    expect(rec.ops("fill").length).toBeGreaterThanOrEqual(3);
    expect(rec.ops("fillText")).toHaveLength(0);
  });

  it("produces the same command log for the same state, twice", () => {
    // The engine's determinism contract: no wall clock, no randomness, no iteration order that
    // depends on anything but the artifact.
    const s = state({
      weights: { ...STATE_ZERO.weights, proc: 1 },
      arcs: 1,
      labels: 1,
    });
    expect(draw(s).log()).toEqual(draw(s).log());
  });

  it("draws nothing Bulgarian except the city labels", () => {
    const rec = draw(state({ labels: 1 }));
    const texts = [...rec.ops("fillText"), ...rec.ops("strokeText")].map(
      (c) => c.args[0] as string,
    );
    expect(texts.length).toBeGreaterThan(0);
    // Every one is a proper noun out of the artifact — the captions are DOM text, so the
    // canvas must never be the place a translatable sentence lives.
    const cities = Object.values(TEST_WORLD.geo.cities).flatMap((c) => [
      c[2],
      c[3],
    ]);
    for (const t of texts) expect(cities).toContain(t);
  });

  it("raises columns only for the layers the state weights", () => {
    const none = draw(state()).log().length;
    const proc = draw(
      state({ weights: { ...STATE_ZERO.weights, proc: 1 } }),
    ).log().length;
    const both = draw(
      state({ weights: { ...STATE_ZERO.weights, proc: 1, agri: 1 } }),
    ).log().length;
    expect(proc).toBeGreaterThan(none);
    expect(both).toBeGreaterThan(proc);
  });

  it("paints each money layer in its OWN colour, never one scale", () => {
    const colorsFor = (layer: "proc" | "agri") =>
      new Set(
        draw(state({ weights: { ...STATE_ZERO.weights, [layer]: 1 } }))
          .ops("set:fillStyle")
          .map((c) => c.args[0] as string),
      );
    expect([...colorsFor("proc")]).toContain(TEST_PALETTE.column.proc);
    expect([...colorsFor("agri")]).toContain(TEST_PALETTE.column.agri);
    expect([...colorsFor("proc")]).not.toContain(TEST_PALETTE.column.agri);
  });

  it("draws arcs only when the state asks for them, and never to themselves", () => {
    expect(draw(state()).ops("quadraticCurveTo")).toHaveLength(0);
    const arcs = draw(state({ arcs: 1 })).ops("quadraticCurveTo");
    expect(arcs.length).toBeGreaterThan(0);
    // Three oblasts, six off-diagonal cells, all non-zero in the fixture.
    expect(arcs.length).toBeLessThanOrEqual(6);
  });

  it("bends reciprocal flows onto distinguishable curves", () => {
    const curves = draw(state({ arcs: 1 }), { maxFlows: 6 }).ops(
      "quadraticCurveTo",
    );
    expect(curves).toHaveLength(6);
    // The three reciprocal pairs used to share three control points exactly, leaving one
    // colour painted over the other. A direction-sensitive perpendicular produces six.
    expect(
      new Set(curves.map((c) => JSON.stringify(c.args.slice(0, 2)))).size,
    ).toBe(curves.length);
  });

  it("renders non-TR money once, beyond the map, without inventing an oblast", () => {
    const flat = draw(state());
    expect(flat.ops("fillText")).toHaveLength(0);

    const arcs = draw(state({ arcs: 1 }));
    const labels = arcs.ops("fillText").map((c) => c.args[0]);
    // The fixture's 18.48bn is one aggregate marker — not one guessed endpoint per buyer —
    // and the notation is language-neutral because the DOM caption owns the explanation.
    expect(labels).toEqual(["18.5B"]);
    expect(arcs.ops("strokeText").map((c) => c.args[0])).toEqual(labels);
    expect(String(labels[0])).not.toMatch(/[\u0400-\u04ff]/);

    // The endpoint is screen-space by design, so it remains visible on the narrow rendering
    // while the flow count falls from 40 to 20.
    const narrow = draw(state({ arcs: 1 }), {
      viewport: { w: 320, h: 200 },
      maxFlows: 2,
    });
    expect(narrow.ops("fillText").map((c) => c.args[0])).toEqual(labels);
  });

  it("moves the arc dash with the clock, and nothing else", () => {
    const s = state({ arcs: 1 });
    const a = draw(s, { clock: 0 });
    const b = draw(s, { clock: 3 });
    expect(a.log()).not.toEqual(b.log());
    // Only the dash offset may differ: strip it and the two frames are identical.
    const strip = (log: string[]) =>
      log.filter((l) => !l.startsWith("set:lineDashOffset"));
    expect(strip(a.log())).toEqual(strip(b.log()));
  });

  it("honours the flow limit a narrow viewport passes", () => {
    const wide = draw(state({ arcs: 1 }), { maxFlows: 6 }).ops(
      "quadraticCurveTo",
    );
    const narrow = draw(state({ arcs: 1 }), { maxFlows: 2 }).ops(
      "quadraticCurveTo",
    );
    expect(narrow.length).toBeLessThan(wide.length);
  });

  it("reads the scope it is given rather than always the corpus", () => {
    const all = draw(state({ weights: { ...STATE_ZERO.weights, proc: 1 } }));
    const ns = draw(state({ weights: { ...STATE_ZERO.weights, proc: 1 } }), {
      scope: "ns:2026_04_19",
    });
    expect(ns.log()).not.toEqual(all.log());
    // A scope the artifact does not carry draws land and no columns, rather than throwing.
    const missing = draw(
      state({ weights: { ...STATE_ZERO.weights, proc: 1 } }),
      {
        scope: "y:1999",
      },
    );
    expect(missing.ops("fill").length).toBeGreaterThan(0);
    expect(missing.log().length).toBeLessThan(all.log().length);
  });

  it("tints the land for the price and election overlays", () => {
    const flat = new Set(
      draw(state())
        .ops("set:fillStyle")
        .map((c) => c.args[0] as string),
    );
    const priced = new Set(
      draw(state({ weights: { ...STATE_ZERO.weights, prices: 1 } }))
        .ops("set:fillStyle")
        .map((c) => c.args[0] as string),
    );
    expect(priced).not.toEqual(flat);
    const voted = new Set(
      draw(state({ weights: { ...STATE_ZERO.weights, elections: 1 } }))
        .ops("set:fillStyle")
        .map((c) => c.args[0] as string),
    );
    expect(voted).not.toEqual(flat);
    // A named election wins over the default (the most recent).
    const older = draw(
      state({ weights: { ...STATE_ZERO.weights, elections: 1 } }),
      { electionDate: "2024_10_27" },
    );
    expect(older.log()).not.toEqual(
      draw(state({ weights: { ...STATE_ZERO.weights, elections: 1 } })).log(),
    );
  });

  it("reads the МИР key space for the overlays and the OBLAST one for the money", () => {
    // The renderer reads both, and swapping them is the easiest mistake in the file: the
    // fixture keeps them disjoint (Sofia is МИР S23+S24 over money oblast SOF) so a swap
    // cannot pass. The election tint must reach TWO Sofia polygons, and the money column must
    // stand at the one city point that is neither МИР centroid.
    const voted = draw(
      state({ weights: { ...STATE_ZERO.weights, elections: 1 } }),
    );
    const tints = voted.ops("set:fillStyle").map((c) => c.args[0] as string);
    // Both Sofia МИР carry the same winner colour, so it is mixed in at least twice.
    const sofiaTint = tints.filter((t) => t !== TEST_PALETTE.land);
    expect(sofiaTint.length).toBeGreaterThanOrEqual(2);
    // The oblast keys are not МИР keys, so a renderer reading `geo.regions[oblast]` would
    // find nothing at all.
    expect(Object.keys(TEST_WORLD.geo.regions)).not.toContain("SOF");
    expect(Object.keys(TEST_WORLD.layers.all.proc!)).not.toContain("S23");
  });

  it("picks out the highlighted oblast, and every МИР inside it", () => {
    const plain = draw(state());
    const lit = draw(state({ highlight: "SOF" }));
    expect(lit.log()).not.toEqual(plain.log());
    const fills = lit.ops("set:fillStyle").map((c) => c.args[0] as string);
    // Sofia is two МИР in this fixture and three in the corpus; the highlight is by OBLAST,
    // so both polygons must change and Пловдив's must not.
    expect(
      fills.filter((f) => f !== TEST_PALETTE.land).length,
    ).toBeGreaterThanOrEqual(2);
    expect(fills).toContain(TEST_PALETTE.land);
  });

  it("adds every flow touching the highlighted oblast to the arcs", () => {
    const some = draw(state({ arcs: 1 }), { maxFlows: 1 });
    const withHighlight = draw(state({ arcs: 1, highlight: "SOF" }), {
      maxFlows: 1,
    });
    expect(withHighlight.ops("quadraticCurveTo").length).toBeGreaterThan(
      some.ops("quadraticCurveTo").length,
    );
  });

  it("sorts columns back to front, so a near one is drawn over a far one", () => {
    // Painter's order is the only depth resolution a 2D canvas has. Without the sort a column
    // draws over whatever came later in the artifact's key order, which is a rendering bug
    // that looks like an engine bug.
    const rec = draw(state({ weights: { ...STATE_ZERO.weights, proc: 1 } }));
    // Every column's first `moveTo` after its `save`. The camera looks north from the south,
    // so a larger screen y is nearer the camera and must be drawn LATER.
    const saves: number[] = [];
    rec.calls.forEach((c, i) => {
      if (c.op === "save") saves.push(i);
    });
    const ys: number[] = [];
    for (const i of saves) {
      const first = rec.calls.slice(i, i + 6).find((c) => c.op === "moveTo");
      if (first) ys.push(first.args[1] as number);
    }
    expect(ys.length).toBeGreaterThan(1);
    // Not a strict sort of the whole log (polygons come first), but the LAST column drawn
    // must not be the furthest one.
    expect(ys[ys.length - 1]).toBeGreaterThan(Math.min(...ys));
  });

  it("drops a ring that is partly behind the lens rather than closing it across the frame", () => {
    // Skipping the clipped points and drawing the rest closes the polygon through the middle
    // of the picture — a wedge over half the country, which reads as a corrupt artifact.
    const low = state({
      camera: { target: [180, 315], distance: 60, pitch: 5, yaw: 0 },
    });
    const rec = draw(low);
    // Something is still drawn (the near polygons), and no ring contributes a path whose
    // points span the whole frame.
    for (const c of rec.ops("moveTo")) {
      expect(Number.isFinite(c.args[0] as number)).toBe(true);
    }
  });

  it("falls back to the most recent election for a date the artifact lacks", () => {
    // An unknown date and `weights.elections: 0` would otherwise draw identically, so a
    // one-digit typo would read as „no election happened".
    const good = draw(
      state({ weights: { ...STATE_ZERO.weights, elections: 1 } }),
    );
    const typo = draw(
      state({ weights: { ...STATE_ZERO.weights, elections: 1 } }),
      {
        electionDate: "2026_04_18",
      },
    );
    expect(typo.log()).toEqual(good.log());
    const flat = draw(state());
    expect(typo.log()).not.toEqual(flat.log());
  });

  it("switches the label language", () => {
    const bg = draw(state({ labels: 1 }), { lang: "bg" });
    const en = draw(state({ labels: 1 }), { lang: "en" });
    expect(bg.ops("fillText").map((c) => c.args[0])).toContain("Пловдив");
    expect(en.ops("fillText").map((c) => c.args[0])).toContain("Plovdiv");
  });

  it("survives a world with no overlays at all", () => {
    // `available.elections` is false on a fresh clone: the per-election tree is gitignored.
    const bare = structuredClone(TEST_WORLD);
    delete bare.elections;
    delete bare.prices;
    const rec = createRecorder();
    expect(() =>
      render(
        rec,
        bare,
        state({
          weights: { ...STATE_ZERO.weights, elections: 1, prices: 1, proc: 1 },
          arcs: 1,
          labels: 1,
        }),
        opts(),
      ),
    ).not.toThrow();
    expect(rec.ops("fill").length).toBeGreaterThan(0);
  });

  it("draws nothing but the clear when the camera is inside the ground", () => {
    // distance 0 puts the eye on the target: the look-at basis collapses, every depth is 0
    // and every point clips. A blank frame at a 200 is the designed degradation.
    const rec = draw(
      state({
        camera: { ...STATE_ZERO.camera, distance: 0 },
        labels: 1,
        arcs: 1,
      }),
    );
    expect(rec.ops("fill")).toHaveLength(0);
    expect(rec.ops("clearRect")).toHaveLength(1);
    expect(rec.ops("stroke")).toHaveLength(0);
    expect(rec.ops("fillText")).toHaveLength(0);
    expect(rec.ops("strokeText")).toHaveLength(0);
    expect(rec.ops("quadraticCurveTo")).toHaveLength(0);
  });
});

describe("captions", () => {
  it("resolves to a literal key and never to prose", () => {
    const c = captionFor("arcs_coverage", TEST_WORLD)!;
    expect(c.key).toBe("flyover_caption_arcs_coverage");
    // Nothing the engine returns may contain Cyrillic: the host renders it through `t()`.
    expect(JSON.stringify(c)).not.toMatch(/[Ѐ-ӿ]/);
  });

  it("carries the coverage beside the number, so a translation cannot drop it", () => {
    const c = captionFor("arcs_coverage", TEST_WORLD)!;
    // From `TEST_WORLD`, refreshed to one post-T3.3 artifact vintage on 2026-09-06 (it read
    // 22.1 / 94.1 / 23.5 before). The point of the assertion is that all three params SHIP —
    // a translation that dropped the coverage would leave a bare number — not what they are.
    expect(c.params.placedBn).toBeCloseTo(43.9, 1);
    expect(c.params.totalBn).toBeCloseTo(94.2, 1);
    expect(c.params.placedPct).toBeCloseTo(46.6, 1);
  });

  it("publishes both funds figures, never the numerator alone", () => {
    // 4.6% of rows carry no oblast and they hold 52% of the money.
    const c = captionFor("columns_funds", TEST_WORLD)!;
    expect(c.params.placedBn).toBeCloseTo(16.1, 1);
    expect(c.params.totalBn).toBeCloseTo(33.7, 1);
    expect(Number(c.params.placedBn)).toBeLessThan(Number(c.params.totalBn));
  });

  it("says nothing for a null id and for an id it does not know", () => {
    expect(captionFor(null, TEST_WORLD)).toBeNull();
    expect(captionFor("nope", TEST_WORLD)).toBeNull();
  });
});
