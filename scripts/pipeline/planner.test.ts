import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { IngestState } from "../lib/ingest-state";
import type { WatchState } from "../watch/types";
import { plan, type PlanInputs } from "./planner";
import { derive, ingest } from "./registry/build";
import type { Handler } from "./registry/types";
import { renderPlan } from "./render_plan";
import { loadState } from "./state";

const NOW = new Date("2026-11-12T00:00:00Z");

const w = (
  lastChanged: string,
  meta?: Record<string, unknown>,
): WatchState => ({
  fingerprint: "f",
  detail: "d",
  lastChecked: lastChanged,
  lastChanged,
  meta,
});
const mark = (skill: string, at: string): IngestState => ({
  skill,
  lastSuccessfulIngest: at,
});

const H = (over: Partial<Handler> & { id: string }): Handler => ({
  runner: "script",
  sources: [],
  steps: [ingest("a", "pnpm run a")],
  changelog: "none",
  ...over,
});

const inputs = (
  handlers: Handler[],
  watch: Record<string, WatchState>,
  ingestMarks: Record<string, IngestState>,
  over: Partial<PlanInputs> = {},
): PlanInputs => ({
  handlers,
  watch: new Map(Object.entries(watch)),
  ingest: new Map(Object.entries(ingestMarks)),
  now: NOW,
  bootstrap: "run",
  ...over,
});

describe("queuing", () => {
  const h = H({ id: "h", sources: ["s1", "s2"] });

  it("queues a handler whose source moved after its marker", () => {
    const p = plan(
      inputs(
        [h],
        { s1: w("2026-11-10T00:00:00Z") },
        {
          h: mark("h", "2026-11-01T00:00:00Z"),
        },
      ),
    );
    expect(p.entries.map((e) => e.handler)).toEqual(["h"]);
    expect(p.entries[0].reasons[0]).toMatchObject({
      source: "s1",
      lastIngest: "2026-11-01T00:00:00Z",
    });
  });

  it("does not queue when the marker is newer — the multi-day-gap rule", () => {
    const p = plan(
      inputs(
        [h],
        { s1: w("2026-11-01T00:00:00Z"), s2: w("2026-11-02T00:00:00Z") },
        { h: mark("h", "2026-11-03T00:00:00Z") },
      ),
    );
    expect(p.entries).toEqual([]);
  });

  it("still queues a change from days ago that was never ingested", () => {
    const p = plan(
      inputs(
        [h],
        { s1: w("2026-11-01T00:00:00Z") },
        {
          h: mark("h", "2026-10-01T00:00:00Z"),
        },
      ),
    );
    expect(p.entries).toHaveLength(1);
  });

  it("reads the marker by its file stem, not by the handler id", () => {
    const k = H({ id: "kzk", marker: "kzk_appeals", sources: ["s1"] });
    const p = plan(
      inputs(
        [k],
        { s1: w("2026-11-01T00:00:00Z") },
        {
          kzk_appeals: mark("kzk_appeals", "2026-11-05T00:00:00Z"),
        },
      ),
    );
    expect(p.entries).toEqual([]);
  });

  it("warns, and does not queue, on watcher state without lastChanged", () => {
    const noChange = { ...w("2026-11-01T00:00:00Z"), lastChanged: undefined };
    const p = plan(inputs([h], { s1: noChange }, {}));
    expect(p.entries).toEqual([]);
    expect(p.warnings.join()).toMatch(/s1.*lastChanged/);
  });

  it("fans one source out to several handlers", () => {
    const a = H({ id: "a", sources: ["s1"] });
    const b = H({ id: "b", sources: ["s1"] });
    const p = plan(inputs([a, b], { s1: w("2026-11-01T00:00:00Z") }, {}));
    expect(p.entries.map((e) => e.handler)).toEqual(["a", "b"]);
  });

  it("lists watcher sources no handler listens to", () => {
    const p = plan(inputs([h], { orphan: w("2026-11-01T00:00:00Z") }, {}));
    expect(p.unrouted).toEqual(["orphan"]);
  });
});

describe("steps", () => {
  const h = H({
    id: "h",
    sources: ["s1", "s2"],
    steps: [
      ingest("one", "pnpm run one", { on: ["s1"] }),
      ingest("two", "pnpm run two", { on: ["s2"] }),
      derive("always", "pnpm run always"),
      ingest("scoped", "pnpm run data", {
        args: (ctx) => {
          const v = ctx.meta("s1")?.scope as { cycles?: string[] } | undefined;
          return v?.cycles ? ["--x", ...v.cycles] : null;
        },
      }),
    ],
  });

  it("runs only the arms whose sources moved", () => {
    const p = plan(inputs([h], { s1: w("2026-11-01T00:00:00Z") }, {}));
    const s = Object.fromEntries(p.entries[0].steps.map((x) => [x.id, x]));
    expect(s.one.status).toBe("run");
    expect(s.two).toMatchObject({ status: "skip", why: "only on s2" });
    expect(s.always.status).toBe("run");
  });

  it("appends args derived from watcher meta", () => {
    const p = plan(
      inputs(
        [h],
        { s1: w("2026-11-01T00:00:00Z", { scope: { cycles: ["mi2027"] } }) },
        {},
      ),
    );
    const s = p.entries[0].steps.find((x) => x.id === "scoped")!;
    expect(s).toMatchObject({ status: "run", run: "pnpm run data --x mi2027" });
  });

  it("skips a scoped step with no scope rather than running it unscoped", () => {
    const p = plan(inputs([h], { s1: w("2026-11-01T00:00:00Z") }, {}));
    const s = p.entries[0].steps.find((x) => x.id === "scoped")!;
    expect(s.status).toBe("skip");
    expect(s.why).toMatch(/no scope/);
  });

  it("skips a step whose args() throws, and says so", () => {
    const bad = H({
      id: "bad",
      sources: ["s1"],
      steps: [
        ingest("x", "pnpm run x", {
          args: () => {
            throw new Error("boom");
          },
        }),
      ],
    });
    const p = plan(inputs([bad], { s1: w("2026-11-01T00:00:00Z") }, {}));
    expect(p.entries[0].steps[0]).toMatchObject({
      status: "skip",
      why: "args() threw: boom",
    });
  });
});

describe("statuses", () => {
  it("blocks a handler with an unmet need, naming it", () => {
    const h = H({ id: "h", sources: ["s1"], needs: ["egress:bg"] });
    const p = plan(
      inputs(
        [h],
        { s1: w("2026-11-01T00:00:00Z") },
        {},
        {
          unmet: new Map([["egress:bg", "exit IP is DE"]]),
        },
      ),
    );
    expect(p.entries[0]).toMatchObject({
      status: "blocked",
      why: "egress:bg: exit IP is DE",
    });
  });

  it("ignores the needs of a step that is not running", () => {
    const h = H({
      id: "h",
      sources: ["s1", "s2"],
      steps: [
        ingest("a", "pnpm run a", { on: ["s1"] }),
        ingest("b", "pnpm run b", { on: ["s2"], needs: ["egress:bg"] }),
      ],
    });
    const p = plan(
      inputs(
        [h],
        { s1: w("2026-11-01T00:00:00Z") },
        {},
        {
          unmet: new Map([["egress:bg", "no"]]),
        },
      ),
    );
    expect(p.entries[0].status).toBe("run");
  });

  it("holds a handler behind a handler-blocking operator item until acked", () => {
    const h = H({
      id: "h",
      sources: ["s1"],
      operator: [{ id: "drop", instruction: "download X", blocks: "handler" }],
    });
    const base = inputs([h], { s1: w("2026-11-01T00:00:00Z") }, {});
    expect(plan(base).entries[0]).toMatchObject({
      status: "needs-operator",
      why: "download X",
    });
    const acked = plan({
      ...base,
      acks: new Map([["h:drop", "2026-11-02T00:00:00Z"]]),
    });
    expect(acked.entries[0].status).toBe("run");
    expect(acked.entries[0].operator).toEqual([]);
  });

  it("does not let an old ack cover a newer change", () => {
    const h = H({
      id: "h",
      sources: ["s1"],
      operator: [{ id: "drop", instruction: "download X", blocks: "handler" }],
    });
    const p = plan(
      inputs(
        [h],
        { s1: w("2026-11-05T00:00:00Z") },
        {},
        {
          acks: new Map([["h:drop", "2026-11-02T00:00:00Z"]]),
        },
      ),
    );
    expect(p.entries[0].status).toBe("needs-operator");
  });

  it("ignores, with a warning, an ack without a valid timestamp", () => {
    const h = H({
      id: "h",
      sources: ["s1"],
      operator: [{ id: "drop", instruction: "x", blocks: "handler" }],
    });
    const p = plan(
      inputs(
        [h],
        { s1: w("2026-11-05T00:00:00Z") },
        {},
        {
          acks: new Map([["h:drop", "yes"]]),
        },
      ),
    );
    expect(p.entries[0].status).toBe("needs-operator");
    expect(p.warnings.join()).toMatch(/ack h:drop/);
  });

  it("asks the operator when nothing automated applies to what moved", () => {
    const h = H({
      id: "h",
      sources: ["auto", "human"],
      steps: [ingest("a", "pnpm run a", { on: ["auto"] })],
      operator: [
        {
          id: "read",
          on: ["human"],
          instruction: "read the PDF",
          blocks: "nothing",
        },
      ],
    });
    const p = plan(inputs([h], { human: w("2026-11-01T00:00:00Z") }, {}));
    expect(p.entries[0]).toMatchObject({
      status: "needs-operator",
      why: "read the PDF",
    });
  });

  it("runs (and so stamps) an operator handler once its edit is acknowledged", () => {
    const h = H({
      id: "gov",
      runner: "operator",
      sources: ["s1"],
      steps: [],
      operator: [{ id: "edit", instruction: "edit", blocks: "handler" }],
    });
    const p = plan(
      inputs(
        [h],
        { s1: w("2026-11-01T00:00:00Z") },
        {},
        {
          acks: new Map([["gov:edit", "2026-11-02T00:00:00Z"]]),
        },
      ),
    );
    expect(p.entries[0]).toMatchObject({ status: "run", steps: [] });
  });

  it("does not let an ack release an item whose done-check fails", () => {
    const h = H({
      id: "h",
      sources: ["s1"],
      operator: [
        {
          id: "drop",
          instruction: "drop the file",
          blocks: "handler",
          done: () => false,
        },
      ],
    });
    const p = plan(
      inputs(
        [h],
        { s1: w("2026-11-01T00:00:00Z") },
        {},
        {
          acks: new Map([["h:drop", "2026-11-02T00:00:00Z"]]),
        },
      ),
    );
    expect(p.entries[0]).toMatchObject({
      status: "needs-operator",
      why: "drop the file",
    });
  });

  it("treats a throwing done-check as not done, with a warning", () => {
    const h = H({
      id: "h",
      sources: ["s1"],
      operator: [
        {
          id: "drop",
          instruction: "x",
          blocks: "handler",
          done: () => {
            throw new Error("bad meta");
          },
        },
      ],
    });
    const p = plan(inputs([h], { s1: w("2026-11-01T00:00:00Z") }, {}));
    expect(p.entries[0].status).toBe("needs-operator");
    expect(p.warnings.join()).toMatch(/done-check drop threw \(bad meta\)/);
  });

  it("clears an operator item whose done-check passes", () => {
    const h = H({
      id: "h",
      sources: ["s1"],
      operator: [
        { id: "drop", instruction: "x", blocks: "handler", done: () => true },
      ],
    });
    const p = plan(inputs([h], { s1: w("2026-11-01T00:00:00Z") }, {}));
    expect(p.entries[0].status).toBe("run");
  });

  it("skips only the arm an arm-blocking item names", () => {
    const h = H({
      id: "h",
      sources: ["s1", "s2"],
      steps: [
        ingest("a", "pnpm run a", { on: ["s1"] }),
        ingest("b", "pnpm run b", { on: ["s2"] }),
      ],
      operator: [
        { id: "url", on: ["s2"], instruction: "add URL", blocks: "arm" },
      ],
    });
    const p = plan(
      inputs(
        [h],
        { s1: w("2026-11-01T00:00:00Z"), s2: w("2026-11-01T00:00:00Z") },
        {},
      ),
    );
    const s = Object.fromEntries(p.entries[0].steps.map((x) => [x.id, x]));
    expect(p.entries[0].status).toBe("run");
    expect(s.a.status).toBe("run");
    expect(s.b.why).toMatch(/arm blocked/);
  });

  it("reports an operator-only handler as needs-operator", () => {
    const h = H({
      id: "gov",
      runner: "operator",
      sources: ["s1"],
      steps: [],
      operator: [
        { id: "edit", instruction: "edit governments.json", blocks: "handler" },
      ],
    });
    const p = plan(inputs([h], { s1: w("2026-11-01T00:00:00Z") }, {}));
    expect(p.entries[0].status).toBe("needs-operator");
  });

  it("applies the bootstrap policy only to a missing marker", () => {
    const h = H({ id: "h", sources: ["s1"] });
    const watch = { s1: w("2026-11-01T00:00:00Z") };
    expect(
      plan(inputs([h], watch, {}, { bootstrap: "ask" })).entries[0],
    ).toMatchObject({
      status: "bootstrap",
      bootstrapAction: "ask",
    });
    expect(
      plan(inputs([h], watch, {}, { bootstrap: "seed" })).entries[0],
    ).toMatchObject({
      bootstrapAction: "seed",
    });
    expect(
      plan(inputs([h], watch, {}, { bootstrap: "run" })).entries[0].status,
    ).toBe("run");
    const marked = { h: mark("h", "2026-10-01T00:00:00Z") };
    expect(
      plan(inputs([h], watch, marked, { bootstrap: "ask" })).entries[0].status,
    ).toBe("run");
  });
});

describe("ordering and publish", () => {
  it("runs a handler after the ones it names in `after`, else registry order", () => {
    const a = H({ id: "a", sources: ["s"], after: ["c"] });
    const b = H({ id: "b", sources: ["s"] });
    const c = H({ id: "c", sources: ["s"] });
    const p = plan(inputs([a, b, c], { s: w("2026-11-01T00:00:00Z") }, {}));
    expect(p.entries.map((e) => e.handler)).toEqual(["c", "a", "b"]);
  });

  it("merges cloud commands of runnable entries into CLOUD_ORDER, deduped", () => {
    const a = H({
      id: "a",
      sources: ["s"],
      publish: {
        cloud: ["pnpm run db:load:graph:pg:cloud", "pnpm run db:load:pg:cloud"],
      },
    });
    const b = H({
      id: "b",
      sources: ["s"],
      publish: {
        cloud: [
          "pnpm run db:load:place-dim:pg:cloud",
          "pnpm run db:load:graph:pg:cloud",
        ],
      },
    });
    const p = plan(inputs([a, b], { s: w("2026-11-01T00:00:00Z") }, {}));
    expect(p.cloud).toEqual([
      "pnpm run db:load:place-dim:pg:cloud",
      "pnpm run db:load:pg:cloud",
      "pnpm run db:load:graph:pg:cloud",
    ]);
  });

  it("keeps a blocked entry's cloud commands out of the publish", () => {
    const a = H({
      id: "a",
      sources: ["s"],
      needs: ["headed"],
      publish: { cloud: ["pnpm run db:load:pg:cloud"] },
    });
    const p = plan(
      inputs(
        [a],
        { s: w("2026-11-01T00:00:00Z") },
        {},
        {
          unmet: new Map([["headed", "no display"]]),
        },
      ),
    );
    expect(p.cloud).toEqual([]);
  });

  it("includes an on-scoped cloud command only when its source moved", () => {
    const a = H({
      id: "a",
      sources: ["s1", "s2"],
      publish: {
        cloud: [
          { run: "pnpm run db:load:pg:cloud", on: ["s1"] },
          { run: "pnpm run db:load:ted:pg:cloud", on: ["s2"] },
        ],
      },
    });
    const p = plan(inputs([a], { s1: w("2026-11-01T00:00:00Z") }, {}));
    expect(p.cloud).toEqual(["pnpm run db:load:pg:cloud"]);
  });

  it("renders every entry, its reason and every warning", () => {
    const h = H({ id: "h", sources: ["s1"] });
    const p = plan(
      inputs(
        [h],
        { s1: w("2026-11-01T00:00:00Z") },
        {},
        {
          inputErrors: ["state/x.json: bad json"],
        },
      ),
    );
    // The error travels in the Plan, so --json and --out carry it too.
    expect(p.warnings).toContain("state/x.json: bad json");
    const text = renderPlan(p);
    expect(text).toMatch(/## h \[run\]/);
    expect(text).toMatch(/moved: s1 at 2026-11-01T00:00:00Z/);
    expect(text).toMatch(/state\/x\.json: bad json/);
  });
});

describe("review fixes", () => {
  it("warns and does not queue on an unparseable lastChanged", () => {
    const h = H({ id: "h", sources: ["s1"] });
    const p = plan(inputs([h], { s1: w("yesterday") }, {}));
    expect(p.entries).toEqual([]);
    expect(p.warnings.join()).toMatch(
      /s1\.json lastChanged is not a timestamp/,
    );
  });

  it("warns and does not queue on an unparseable marker", () => {
    const h = H({ id: "h", sources: ["s1"] });
    const p = plan(
      inputs(
        [h],
        { s1: w("2026-11-01T00:00:00Z") },
        { h: mark("h", "garbage") },
      ),
    );
    expect(p.entries).toEqual([]);
    expect(p.warnings.join()).toMatch(
      /h\.json lastSuccessfulIngest is not a timestamp/,
    );
  });

  it("blocks a multi-source step whose only flipped source is arm-blocked", () => {
    const h = H({
      id: "h",
      sources: ["s1", "s2"],
      steps: [
        ingest("both", "pnpm run both", { on: ["s1", "s2"] }),
        derive("always", "pnpm run always"),
      ],
      operator: [{ id: "u", on: ["s2"], instruction: "x", blocks: "arm" }],
    });
    const p = plan(inputs([h], { s2: w("2026-11-01T00:00:00Z") }, {}));
    const both = p.entries[0].steps.find((s) => s.id === "both")!;
    expect(both).toMatchObject({
      status: "skip",
      why: "arm blocked by an operator item",
    });
  });

  it("never stamps, and never publishes, a deferred arm", () => {
    const h = H({
      id: "h",
      sources: ["s1", "s2"],
      steps: [
        ingest("a", "pnpm run a", { on: ["s1"] }),
        ingest("b", "pnpm run b", { on: ["s2"] }),
      ],
      operator: [{ id: "u", on: ["s2"], instruction: "x", blocks: "arm" }],
      publish: {
        cloud: [
          { run: "pnpm run db:load:pg:cloud", on: ["s1"] },
          { run: "pnpm run db:load:ted:pg:cloud", on: ["s2"] },
        ],
      },
    });
    const p = plan(
      inputs(
        [h],
        { s1: w("2026-11-01T00:00:00Z"), s2: w("2026-11-01T00:00:00Z") },
        {},
      ),
    );
    expect(p.entries[0]).toMatchObject({ stampable: false, deferred: ["s2"] });
    expect(p.cloud).toEqual(["pnpm run db:load:pg:cloud"]);
  });

  it("does not publish or follow up an entry whose every step skipped", () => {
    const h = H({
      id: "h",
      sources: ["s1"],
      steps: [ingest("scoped", "pnpm run data", { args: () => null })],
      publish: { cloud: ["pnpm run db:load:pg:cloud"] },
      followUps: ["sector-stats"],
    });
    const p = plan(inputs([h], { s1: w("2026-11-01T00:00:00Z") }, {}));
    expect(p.entries[0].status).toBe("nothing-to-run");
    expect(p.cloud).toEqual([]);
    expect(p.followUps).toEqual([]);
  });

  it("holds a handler whose `after` predecessor is queued but not running", () => {
    const pre = H({ id: "pre", sources: ["s"], needs: ["headed"] });
    const dep = H({
      id: "dep",
      sources: ["s"],
      after: ["pre"],
      publish: { cloud: ["pnpm run db:load:pg:cloud"] },
    });
    const tail = H({ id: "tail", sources: ["s"], after: ["dep"] });
    const p = plan(
      inputs(
        [pre, dep, tail],
        { s: w("2026-11-01T00:00:00Z") },
        {},
        {
          unmet: new Map([["headed", "no display"]]),
        },
      ),
    );
    const st = Object.fromEntries(p.entries.map((e) => [e.handler, e]));
    expect(st.pre.status).toBe("blocked");
    expect(st.dep).toMatchObject({
      status: "blocked",
      why: "runs after pre, which is blocked",
    });
    expect(st.tail).toMatchObject({
      status: "blocked",
      why: "runs after dep, which is blocked",
    });
    expect(p.cloud).toEqual([]);
  });

  it("does not hold a handler whose predecessor is simply not queued", () => {
    const pre = H({ id: "pre", sources: ["other"] });
    const dep = H({ id: "dep", sources: ["s"], after: ["pre"] });
    const p = plan(inputs([pre, dep], { s: w("2026-11-01T00:00:00Z") }, {}));
    expect(p.entries.map((e) => [e.handler, e.status])).toEqual([
      ["dep", "run"],
    ]);
  });

  it("leaves an exempted source out of `unrouted`", () => {
    const p = plan(
      inputs(
        [],
        { a: w("2026-11-01T00:00:00Z"), b: w("2026-11-01T00:00:00Z") },
        {},
        {
          exemptUnrouted: new Set(["a"]),
        },
      ),
    );
    expect(p.unrouted).toEqual(["b"]);
  });
});

describe("loadState", () => {
  it("reads both dirs, skips _-prefixed files and reports corrupt ones", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-state-"));
    const wd = path.join(root, "watch");
    const id = path.join(root, "ingest");
    fs.mkdirSync(wd);
    fs.mkdirSync(id);
    fs.writeFileSync(
      path.join(wd, "s1.json"),
      JSON.stringify(w("2026-11-01T00:00:00Z")),
    );
    fs.writeFileSync(path.join(wd, "_health.json"), "{}");
    fs.writeFileSync(path.join(id, "h.json"), "{not json");
    const st = loadState({
      watch: wd,
      ingest: id,
      acks: path.join(root, "acks.json"),
    });
    expect([...st.watch.keys()]).toEqual(["s1"]);
    expect(st.ingest.size).toBe(0);
    expect(st.errors.join()).toMatch(/h\.json/);
    fs.rmSync(root, { recursive: true });
  });
});
