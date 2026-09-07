import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROGRAMMES,
  PROGRAMME_IDS,
  resolvedStates,
  stateAt,
  validateProgramme,
  type Programme,
} from "./index";
import { ARTICLE_CHAPTERS, TOUR_CHAPTERS } from "./tour";
import { ANCHOR_SOURCES, ANCHOR_TOLERANCE_PX, OVERVIEW } from "./anchors";
import { CAPTIONS } from "../captions";
import { LAYER_IDS } from "../types";
import { STATE_ZERO } from "../state";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

/** One reader, one shape — the two anchor tests parsed the same 34 KB file twice. */
interface FlyoverArtifact {
  frame: { w: number; h: number };
  geo: {
    cities: Record<string, [number, number, string, string]>;
    regions: Record<string, { oblast: string }>;
  };
  flows: { keys: string[] };
}
const ARTIFACT = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data/home/flyover.json"), "utf8"),
) as FlyoverArtifact;

const all = Object.values(PROGRAMMES);

describe("every programme", () => {
  it("is registered exactly once, in the rotation's order", () => {
    expect(Object.keys(PROGRAMMES).sort()).toEqual([...PROGRAMME_IDS].sort());
    expect(PROGRAMME_IDS).toHaveLength(3);
    for (const id of PROGRAMME_IDS) expect(PROGRAMMES[id].id).toBe(id);
  });

  it.each(all)("$id: loops seamlessly", (p: Programme) => {
    // A band runs for hours. A discontinuity at the wrap is a visible jolt once a loop, which
    // is the kind of defect that is obvious to a reader and invisible to a screenshot.
    expect(stateAt(p, p.duration)).toEqual(stateAt(p, 0));
    expect(stateAt(p, p.duration * 3 + 1)).toEqual(stateAt(p, 1));
    expect(stateAt(p, -1)).toEqual(stateAt(p, p.duration - 1));
  });

  it.each(all)(
    "$id: is continuous at every keyframe boundary",
    (p: Programme) => {
      for (const kf of p.keyframes) {
        const before = stateAt(p, kf.t - 1e-4);
        const after = stateAt(p, kf.t + 1e-4);
        expect(
          Math.abs(after.camera.distance - before.camera.distance),
          `distance at t=${kf.t}`,
        ).toBeLessThan(1);
        expect(
          Math.abs(after.camera.target[0] - before.camera.target[0]),
          `target at t=${kf.t}`,
        ).toBeLessThan(1);
        for (const id of LAYER_IDS) {
          expect(
            Math.abs(after.weights[id] - before.weights[id]),
            `${id} at t=${kf.t}`,
          ).toBeLessThan(0.05);
        }
        // ⚠️ YAW IS THE ONE THAT MATTERS. It is the only angle that wraps, so a keyframe pair
        // crossing 0° is where a plain lerp would spin the camera 340° the wrong way — and
        // the reading is modulo 360, so the comparison has to be too.
        // Signed, wrapped into [-180, 180) — the `- 180` is what makes this a difference
        // rather than a difference plus a half-turn.
        const dYaw =
          ((((after.camera.yaw - before.camera.yaw) % 360) + 540) % 360) - 180;
        expect(Math.abs(dYaw), `yaw at t=${kf.t}`).toBeLessThan(1);
        expect(
          Math.abs(after.camera.pitch - before.camera.pitch),
          `pitch at t=${kf.t}`,
        ).toBeLessThan(1);
        expect(
          Math.abs(after.camera.target[1] - before.camera.target[1]),
          `target z at t=${kf.t}`,
        ).toBeLessThan(1);
        expect(after.captionId, `caption at t=${kf.t}`).toBe(before.captionId);
      }
    },
  );

  it.each(all)(
    "$id: dwells, so the camera rests rather than drifting",
    (p: Programme) => {
      const dwelt = p.keyframes.filter((k) => (k.dwell ?? 0) > 0);
      expect(dwelt.length).toBeGreaterThan(0);
      for (const kf of dwelt) {
        // Held exactly, not merely nearly: an ease that starts immediately reads as a camera
        // that never looks at anything.
        expect(stateAt(p, kf.t + kf.dwell! / 2), `t=${kf.t}`).toEqual(
          stateAt(p, kf.t),
        );
      }
    },
  );

  it.each(all)(
    "$id: says something the caption table can render",
    (p: Programme) => {
      const ids = resolvedStates(p)
        .map((s) => s.captionId)
        .filter((x): x is NonNullable<typeof x> => x !== null);
      expect(
        ids.length,
        "a programme with no captions publishes numbers with no basis",
      ).toBeGreaterThan(0);
      for (const id of ids) {
        expect(Object.keys(CAPTIONS), id).toContain(id as string);
      }
    },
  );

  it.each(all)(
    "$id: keeps every weight inside [0, 1] across the whole loop",
    (p: Programme) => {
      for (let t = 0; t <= p.duration; t += 0.25) {
        const s = stateAt(p, t);
        for (const id of LAYER_IDS) {
          expect(s.weights[id], `${id} at ${t}`).toBeGreaterThanOrEqual(0);
          expect(s.weights[id], `${id} at ${t}`).toBeLessThanOrEqual(1);
        }
        expect(s.arcs).toBeGreaterThanOrEqual(0);
        expect(s.arcs).toBeLessThanOrEqual(1);
        expect(Number.isFinite(s.camera.distance)).toBe(true);
      }
    },
  );

  it.each(all)(
    "$id: never stacks two money layers on one city",
    (p: Programme) => {
      // The three are TAPS over overlapping corpora, so two columns standing on one point at
      // once reads as a stack — i.e. as a total that has no name. Cross-fades pass through a
      // moment where both are partly up; what must never happen is both near full.
      for (let t = 0; t <= p.duration; t += 0.25) {
        const w = stateAt(p, t).weights;
        const money = w.proc + w.funds + w.agri;
        expect(money, `t=${t}`).toBeLessThanOrEqual(1.05);
      }
    },
  );

  it.each(all)(
    "$id: returns a FRESH state on every path, dwell included",
    (p: Programme) => {
      // ⚠️ `blend` allocates but the dwell branch used to return the cache's own object, so
      // the band was handed a live keyframe state for whole seconds and one in-place write by
      // a host corrupted the table for the life of the process, with nothing failing.
      const cached = resolvedStates(p);
      const i = p.keyframes.findIndex((k) => (k.dwell ?? 0) > 0);
      expect(i).toBeGreaterThanOrEqual(0);
      const held = stateAt(p, p.keyframes[i].t + p.keyframes[i].dwell! / 2);
      expect(held).not.toBe(cached[i]);
      expect(held.weights).not.toBe(cached[i].weights);
      held.weights.proc = 0.123;
      expect(cached[i].weights.proc).not.toBe(0.123);
      expect(stateAt(p, p.keyframes[i].t).captionId).toBe(cached[i].captionId);
    },
  );

  it.each(all)(
    "$id: highlights only oblasts the artifact actually carries",
    (p: Programme) => {
      // ⚠️ Copied constants, exactly like the camera anchors — and `render.ts` compares them
      // by EQUALITY against `region.oblast`, so a typo is a silent no-op: the camera flies to
      // Sofia, the caption says „23,9% отиват в софийски фирми", and nothing is picked out.
      // The artifact carries both `SFO` (София) and `SOF` (София-столица), which is exactly
      // the pair a copy-out confuses.
      const oblasts = new Set(
        Object.values(ARTIFACT.geo.regions).map((r) => r.oblast),
      );
      for (const st of resolvedStates(p)) {
        if (!st.highlight) continue;
        expect(oblasts, `${p.id} highlights ${st.highlight}`).toContain(
          st.highlight,
        );
        expect(
          ARTIFACT.flows.keys,
          `${p.id} highlights ${st.highlight}`,
        ).toContain(st.highlight);
      }
    },
  );

  it("returns the first frame for a non-finite t rather than propagating it", () => {
    for (const p of all) {
      expect(stateAt(p, Number.NaN)).toEqual(stateAt(p, 0));
    }
  });
});

describe("validateProgramme", () => {
  const base = PROGRAMMES.arcs;
  const bad = (over: Partial<Programme>): Programme => ({ ...base, ...over });

  it("accepts the shipped programmes", () => {
    for (const p of all) expect(() => validateProgramme(p)).not.toThrow();
  });

  it("refuses a first keyframe that is not at zero", () => {
    // The loop would jump: the closing segment eases back to a state the loop never starts at.
    expect(() =>
      validateProgramme(bad({ keyframes: [{ t: 2, state: {} }] })),
    ).toThrow(/must be at t=0/);
  });

  it("refuses unsorted keyframes", () => {
    // A segment of negative length divides by a negative span, so the ease runs backwards.
    expect(() =>
      validateProgramme(
        bad({
          keyframes: [
            { t: 0, state: {} },
            { t: 5, state: {} },
            { t: 3, state: {} },
          ],
        }),
      ),
    ).toThrow(/not after/);
  });

  it("refuses a duration that does not exceed the last keyframe", () => {
    expect(() =>
      validateProgramme(
        bad({
          duration: 5,
          keyframes: [
            { t: 0, state: {} },
            { t: 5, state: {} },
          ],
        }),
      ),
    ).toThrow(/duration/);
  });

  it("refuses a dwell longer than its own segment", () => {
    // The ease never runs and the camera teleports on the next frame.
    expect(() =>
      validateProgramme(
        bad({
          duration: 10,
          keyframes: [
            { t: 0, state: {}, dwell: 9 },
            { t: 4, state: {} },
          ],
        }),
      ),
    ).toThrow(/dwells/);
  });

  it("refuses a negative or non-finite dwell", () => {
    // A negative dwell LENGTHENS the span, so the ease is already partway through at the
    // keyframe's own time — measured, a 317-unit camera jump at the very frame `dwell` exists
    // to hold. `NaN` passes `> span` and freezes the whole segment instead.
    for (const dwell of [-4, Number.NaN, -0.001]) {
      expect(
        () =>
          validateProgramme(
            bad({
              duration: 20,
              keyframes: [
                { t: 0, state: {} },
                { t: 10, state: {}, dwell },
              ],
            }),
          ),
        String(dwell),
      ).toThrow(/negative or non-finite dwell/);
    }
    expect(() =>
      validateProgramme(
        bad({
          duration: 20,
          keyframes: [
            { t: 0, state: {} },
            { t: 10, state: {}, dwell: 0 },
          ],
        }),
      ),
    ).not.toThrow();
  });

  it("refuses an empty timeline", () => {
    expect(() => validateProgramme(bad({ keyframes: [] }))).toThrow(
      /no keyframes/,
    );
  });
});

describe("resolvedStates memoisation", () => {
  it("resolves the programme it was GIVEN, not one that shares its id", () => {
    // ⚠️ An id does not identify a timeline. Keyed on `p.id`, a variant with FEWER keyframes
    // silently got the full programme's states, and one with MORE threw „Cannot read
    // properties of undefined" inside `blend` — three modules from the cause. The validate
    // block above already mints same-id variants, and the memo is module-level, so the first
    // `stateAt` on one would have poisoned every later assertion in this file.
    const real = resolvedStates(PROGRAMMES.arcs);
    const shorter: Programme = {
      id: "arcs",
      duration: 10,
      keyframes: [
        { t: 0, state: { arcs: 0, captionId: null } },
        { t: 5, state: { arcs: 1 } },
      ],
    };
    expect(resolvedStates(shorter)).toHaveLength(2);
    expect(resolvedStates(shorter)[0].captionId).toBeNull();

    const wider: Programme = {
      id: "arcs",
      duration: 60,
      keyframes: [0, 10, 20, 30, 40, 50].map((t) => ({ t, state: {} })),
    };
    expect(() => stateAt(wider, 45)).not.toThrow();

    // …and the real programme is untouched by either.
    expect(resolvedStates(PROGRAMMES.arcs)).toBe(real);
    expect(resolvedStates(PROGRAMMES.arcs)).toHaveLength(
      PROGRAMMES.arcs.keyframes.length,
    );
  });
});

describe("keyframes accrete", () => {
  it("inherits what a keyframe does not mention", () => {
    // The rule `applyPartial` states for Remotion, applied to the loop: a keyframe that says
    // nothing about the arcs keeps them, which is what makes a camera edit one line.
    // Keyframe 4 (t=21) is a camera move only; it must inherit the layer and the caption the
    // keyframe before it set.
    const states = resolvedStates(PROGRAMMES.columns);
    expect(states[4].captionId).toBe(states[3].captionId);
    expect(states[4].weights.funds).toBe(states[3].weights.funds);
    expect(states[4].camera.target).not.toEqual(states[3].camera.target);
  });

  it("starts from STATE_ZERO, so an unset field is the neutral picture's", () => {
    const first = resolvedStates(PROGRAMMES.arcs)[0];
    expect(first.highlight).toBeNull();
    expect(first.weights.elections).toBe(STATE_ZERO.weights.elections);
  });
});

describe("the tour's chapter table", () => {
  it("is the programme's own keyframes, not a parallel copy", () => {
    // The article maps scroll to these and the video takes their states; three tables would
    // show three different pictures of the same sentence.
    expect(PROGRAMMES.tour.keyframes.map((k) => k.t)).toEqual(
      TOUR_CHAPTERS.map((c) => c.t),
    );
    expect(PROGRAMMES.tour.keyframes.map((k) => k.state)).toEqual(
      TOUR_CHAPTERS.map((c) => c.state),
    );
  });

  it("has five chapters with stable, unique ids", () => {
    expect(TOUR_CHAPTERS).toHaveLength(5);
    const ids = TOUR_CHAPTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(5);
    expect(ids).toEqual(["buys", "goes", "funds", "agri", "prices"]);
  });

  it("extends the article to six chapters without putting elections on home", () => {
    expect(ARTICLE_CHAPTERS.slice(0, 5)).toEqual(TOUR_CHAPTERS);
    expect(ARTICLE_CHAPTERS.map((c) => c.id)).toEqual([
      "buys",
      "goes",
      "funds",
      "agri",
      "prices",
      "elections",
    ]);
    expect(ARTICLE_CHAPTERS.at(-1)?.state.weights?.elections).toBe(1);
  });

  it("leaves the elections overlay out of the HOME tour", () => {
    // Plan §5: it is chapter 6 of the article. A band on the entry page that ended on an
    // election result would be a claim about a party rather than about money.
    for (let t = 0; t <= PROGRAMMES.tour.duration; t += 0.5) {
      expect(stateAt(PROGRAMMES.tour, t).weights.elections, `t=${t}`).toBe(0);
    }
  });
});

describe("caption coverage, in both directions", () => {
  it("every caption the table defines is reachable from some programme", () => {
    // A caption reaches a reader ONLY through `state.captionId`, and all three surfaces take
    // their states from these tables — so a defined, translated, unit-tested caption that no
    // keyframe sets is a string nobody will ever see. A deliberate exception belongs in the
    // list below WITH its reason, so absence is a decision rather than an oversight.
    const REACHABLE_ELSEWHERE: string[] = [];
    const set = new Set<string>(
      all.flatMap((p) =>
        resolvedStates(p)
          .map((st) => st.captionId)
          .filter((x): x is NonNullable<typeof x> => x !== null),
      ),
    );
    const unreachable = Object.keys(CAPTIONS).filter(
      (id) => !set.has(id) && !REACHABLE_ELSEWHERE.includes(id),
    );
    expect(unreachable).toEqual([]);
  });
});

describe("the camera anchors", () => {
  it("still point at the cities the artifact places", () => {
    // ⚠️ The anchors are CONSTANTS because `stateAt` takes no world — a keyframe table has to
    // be static for the article and the video to reuse it. This is what moves the camera when
    // a re-projection moves the map, instead of leaving it looking at empty sea.
    const artifact = JSON.parse(
      fs.readFileSync(path.join(ROOT, "data/home/flyover.json"), "utf8"),
    ) as { geo: { cities: Record<string, [number, number, string, string]> } };
    for (const [code, anchor] of Object.entries(ANCHOR_SOURCES)) {
      const city = artifact.geo.cities[code];
      expect(city, code).toBeTruthy();
      expect(Math.abs(city[0] / 10 - anchor[0]), code).toBeLessThanOrEqual(
        ANCHOR_TOLERANCE_PX,
      );
      expect(Math.abs(city[1] / 10 - anchor[1]), code).toBeLessThanOrEqual(
        ANCHOR_TOLERANCE_PX,
      );
    }
  });

  it("centres the overview on the frame", () => {
    const artifact = JSON.parse(
      fs.readFileSync(path.join(ROOT, "data/home/flyover.json"), "utf8"),
    ) as { frame: { w: number; h: number } };
    expect(Math.abs(OVERVIEW[0] - artifact.frame.w / 2)).toBeLessThanOrEqual(
      10,
    );
    expect(Math.abs(OVERVIEW[1] - artifact.frame.h / 2)).toBeLessThanOrEqual(
      10,
    );
  });
});
