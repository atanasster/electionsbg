// The registry is the routing table, so drift between it and the things it
// names is the failure the prose tables used to have: a source watched daily
// and routed nowhere, a `:cloud` loader nobody runs, a command that no longer
// exists. Each of those exits 0 somewhere and reads as a quiet day.
//
// Pure — no network, no database.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isExcluded } from "../../bucket_sync_paths";
import {
  CLOUD_SKILL_EXEMPTIONS,
  ORCHESTRATOR_EXEMPTIONS,
} from "../../db/cloud_loader_coverage";
import { SOURCES } from "../../watch/sources";
import { CLOUD_ORDER, cloudSlot } from "./cloud_order";
import { HANDLERS, UNROUTED, markerOwners } from "./index";
import { makeGateCtx, runGates, type Gate, type GateCtx } from "./gates";
import { POST_STEPS } from "./post_steps";
import type { CloudSpec, Handler, RunCtx } from "./types";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const pkg = JSON.parse(
  fs.readFileSync(path.join(REPO, "package.json"), "utf8"),
) as { scripts: Record<string, string> };

const CTX: RunCtx = {
  flipped: new Set(),
  meta: () => undefined,
  detail: () => undefined,
  now: new Date("2026-11-12T00:00:00Z"),
  since: null,
};

const cloudCommands = (h: Handler): string[] =>
  (h.publish?.cloud ?? []).map((c) => {
    const spec: CloudSpec = typeof c === "string" ? { run: c } : c;
    return typeof spec.run === "string" ? spec.run : spec.run(CTX);
  });

/** Every command line the registry can emit, with where it came from. */
const allCommands = (): { where: string; run: string }[] => [
  ...HANDLERS.flatMap((h) => [
    ...h.steps.map((s) => ({ where: `${h.id} › ${s.id}`, run: s.run })),
    ...cloudCommands(h).map((run) => ({ where: `${h.id} › publish`, run })),
  ]),
  ...POST_STEPS.flatMap((p) => [
    ...p.steps.map((s) => ({ where: `post ${p.id} › ${s.id}`, run: s.run })),
    ...(p.publish?.cloud ?? []).map((run) => ({
      where: `post ${p.id} › publish`,
      run,
    })),
  ]),
];

/** Every cloud command anything in the registry can put on a manifest. */
const emittedCloud = (): string[] => [
  ...HANDLERS.flatMap((h) => cloudCommands(h)),
  ...POST_STEPS.flatMap((p) => [...(p.publish?.cloud ?? [])]),
];

describe("routing", () => {
  const ids = new Set(SOURCES.map((s) => s.id));

  it("routes every registered watcher source", () => {
    const routed = new Set(HANDLERS.flatMap((h) => h.sources));
    const missing = SOURCES.map((s) => s.id).filter(
      (id) => !routed.has(id) && !UNROUTED[id],
    );
    expect(
      missing,
      "watched daily and routed nowhere — add a handler or an UNROUTED reason",
    ).toEqual([]);
    expect(SOURCES.length).toBeGreaterThan(100);
  });

  it("names no source the watcher does not register", () => {
    const unknown = HANDLERS.flatMap((h) =>
      [
        ...h.sources,
        ...h.steps.flatMap((s) => s.on ?? []),
        ...(h.operator ?? []).flatMap((o) => o.on ?? []),
        ...(h.agent ?? []).flatMap((a) => a.on ?? []),
        ...(h.publish?.cloud ?? []).flatMap((c) =>
          typeof c === "string" ? [] : (c.on ?? []),
        ),
      ]
        .filter((s) => !ids.has(s))
        .map((s) => `${h.id}: ${s}`),
    );
    expect(unknown).toEqual([]);
  });

  it("scopes `on` only to sources its own handler listens to", () => {
    // An `on` naming a source the handler does not list can never fire: the
    // handler is not queued by it, so the item is dead while looking wired.
    const dead = HANDLERS.flatMap((h) => {
      const scoped: { what: string; on?: readonly string[] }[] = [
        ...h.steps.map((s) => ({ what: `step ${s.id}`, on: s.on })),
        ...(h.operator ?? []).map((o) => ({
          what: `operator ${o.id}`,
          on: o.on,
        })),
        ...(h.agent ?? []).map((a) => ({ what: `agent ${a.id}`, on: a.on })),
        ...(h.publish?.cloud ?? []).map((c, i) => ({
          what: `cloud #${i}`,
          on: typeof c === "string" ? undefined : c.on,
        })),
      ];
      return scoped.flatMap(({ what, on }) =>
        (on ?? [])
          .filter((src) => !h.sources.includes(src))
          .map((src) => `${h.id} › ${what}: ${src}`),
      );
    });
    expect(dead).toEqual([]);
  });

  it("carries no stale UNROUTED entry", () => {
    const routed = new Set(HANDLERS.flatMap((h) => h.sources));
    for (const id of Object.keys(UNROUTED)) {
      expect(ids.has(id), `${id} is exempted and no longer registered`).toBe(
        true,
      );
      expect(routed.has(id), `${id} is exempted and also routed`).toBe(false);
    }
  });
});

describe("handler shape", () => {
  it("has unique handler ids and unique step ids within a handler", () => {
    const seen = new Set<string>();
    for (const h of HANDLERS) {
      expect(seen.has(h.id), `duplicate handler id ${h.id}`).toBe(false);
      seen.add(h.id);
      const steps = h.steps.map((s) => s.id);
      expect(new Set(steps).size, `${h.id} repeats a step id`).toBe(
        steps.length,
      );
    }
  });

  it("shares a marker only between handlers of one skill", () => {
    for (const [marker, owners] of markerOwners()) {
      if (owners.length < 2) continue;
      const skills = new Set(owners.map((o) => o.skill ?? o.id));
      expect(
        skills.size,
        `marker ${marker} is stamped by unrelated handlers: ${owners.map((o) => o.id).join(", ")}`,
      ).toBe(1);
    }
  });

  it("orders `after` only against handlers that exist, without a cycle", () => {
    const byId = new Map(HANDLERS.map((h) => [h.id, h]));
    for (const h of HANDLERS)
      for (const a of h.after ?? [])
        expect(byId.has(a), `${h.id} runs after unknown ${a}`).toBe(true);

    const state = new Map<string, "open" | "done">();
    const visit = (id: string, trail: string[]): void => {
      if (state.get(id) === "done") return;
      expect(
        state.get(id),
        `after-cycle: ${[...trail, id].join(" → ")}`,
      ).not.toBe("open");
      state.set(id, "open");
      for (const a of byId.get(id)?.after ?? []) visit(a, [...trail, id]);
      state.set(id, "done");
    };
    for (const h of HANDLERS) visit(h.id, []);
  });

  it("gives an operator-run handler something for the operator to do", () => {
    for (const h of HANDLERS)
      if (h.runner === "operator")
        expect(h.operator?.length, `${h.id} has no operator step`).toBeTruthy();
  });

  it("gives a script-run handler at least one step", () => {
    for (const h of HANDLERS)
      if (h.runner === "script")
        expect(h.steps.length, `${h.id} runs nothing`).toBeGreaterThan(0);
  });

  it("points `skill` at a runbook that exists", () => {
    for (const h of HANDLERS)
      if (h.skill)
        expect(
          fs.existsSync(path.join(REPO, ".claude/skills", h.skill, "SKILL.md")),
          `${h.id} → missing skill ${h.skill}`,
        ).toBe(true);
  });
});

describe("commands", () => {
  it("names only package.json scripts that exist", () => {
    const missing = allCommands()
      .map(({ where, run }) => ({ where, m: run.match(/^pnpm run ([^\s]+)/) }))
      .filter(({ m }) => m && !pkg.scripts[m[1]])
      .map(({ where, m }) => `${where}: ${m![1]}`);
    expect(missing).toEqual([]);
  });

  it("names only script files and test paths that exist", () => {
    const missing = allCommands().flatMap(({ where, run }) =>
      (run.match(/\bscripts\/[^\s]+/g) ?? [])
        .filter((p) => !fs.existsSync(path.join(REPO, p)))
        .map((p) => `${where}: ${p}`),
    );
    expect(missing).toEqual([]);
  });

  it("starts every command with pnpm", () => {
    const odd = allCommands().filter(
      ({ run }) => !/^pnpm (run|exec) /.test(run),
    );
    expect(odd).toEqual([]);
  });

  it("never runs a :cloud command as an ingest step", () => {
    // Only the publish half touches production. A `:cloud` script inside
    // `steps` would run under the LOCAL DATABASE_URL pin and either fail or,
    // worse, reload the local database twice.
    const leaked = HANDLERS.flatMap((h) =>
      h.steps
        .filter((s) => /^pnpm run [^\s]+:cloud\b/.test(s.run))
        .map((s) => `${h.id} › ${s.id}`),
    );
    expect(leaked).toEqual([]);
  });
});

describe("publish", () => {
  it("gives every cloud command a slot in CLOUD_ORDER", () => {
    const unranked = emittedCloud().filter((c) => cloudSlot(c) === null);
    expect(unranked).toEqual([]);
  });

  it("keeps CLOUD_ORDER free of duplicates and of dead slots", () => {
    expect(new Set(CLOUD_ORDER).size).toBe(CLOUD_ORDER.length);
    const used = new Set(emittedCloud().map((c) => cloudSlot(c)));
    const dead = CLOUD_ORDER.filter((c) => !used.has(c));
    expect(dead, "ranked but emitted by no handler").toEqual([]);
  });

  it("orders the loaders CLAUDE.md says must follow one another", () => {
    const before = (a: string, b: string): void => {
      // indexOf returns -1 for a missing entry, which would satisfy `<`.
      expect(CLOUD_ORDER).toContain(a);
      expect(CLOUD_ORDER).toContain(b);
      expect(CLOUD_ORDER.indexOf(a), `${a} must precede ${b}`).toBeLessThan(
        CLOUD_ORDER.indexOf(b),
      );
    };
    for (const [a, b] of [
      ["db:load:declarations:pg:cloud", "db:resolve:persons:cloud"],
      ["db:resolve:persons:cloud", "db:load:declarations:pg:cloud --resolve"],
      ["db:load:judicial-bodies:pg:cloud", "db:resolve:persons:cloud"],
      ["db:load:magistrates:pg:cloud", "db:load:judicial-bodies:pg:cloud"],
      ["db:load:place-dim:pg:cloud", "db:resolve:persons:cloud"],
      ["db:load:place-dim:pg:cloud", "db:load:municipal-fiscal:pg:cloud"],
      ["db:load:place-dim:pg:cloud", "db:load:interreg:pg:cloud"],
      ["db:load:ngo-board-links:cloud", "db:resolve:persons:cloud"],
      ["db:load:persons-browse:pg:cloud", "db:load:person-search:pg:cloud"],
      ["db:load:persons-browse:pg:cloud", "db:load:graph:pg:cloud"],
      ["db:load:person-elections:pg:cloud", "db:load:graph:pg:cloud"],
      ["db:load:interreg:pg:cloud", "db:load:graph:pg:cloud"],
      ["db:load:graph:pg:cloud", "db:load:tr-company-place:pg:cloud"],
      ["db:load:tr:pg:cloud", "db:load:graph:pg:cloud"],
      ["db:load:pg:cloud", "db:load:annexes:pg:cloud"],
      ["db:load:pg:cloud", "db:load:persons-browse:pg:cloud"],
      ["db:load:awarder-seats:pg:cloud", "db:load:interreg:pg:cloud"],
      [
        "db:load:awarder-seats:pg:cloud",
        "db:load:transport-facility-map:pg:cloud",
      ],
      ["db:load:rollcall:pg:cloud", "db:load:rollcall-derived:pg:cloud"],
      ["db:load:kzk-decisions:pg:cloud", "kzk:rejoin:cloud --apply"],
      ["db:load:funds:pg:cloud --full", "db:load:funds-fit:pg:cloud"],
      ["db:load:budget-muni:pg:cloud", "db:load:budget-hub:pg:cloud"],
      ["db:load:declarations:pg:cloud --resolve", "person:slugs:cloud"],
      ["db:load:council:pg:cloud", "db:load:persons-browse:pg:cloud"],
    ] as const)
      before(a, b);
  });

  it("reaches every :cloud script in package.json, or exempts it", () => {
    // Two lists already record the scripts that are deliberately not part of a
    // watcher-driven publish (operator tools, manual-trigger crawls). Anything
    // else must be emitted by a handler, or prod keeps the previous vintage.
    const emitted = new Set(
      emittedCloud()
        .map((c) => c.match(/^pnpm run ([^\s]+)/)?.[1])
        .filter((s): s is string => !!s),
    );
    const exempt = new Set([
      ...Object.keys(CLOUD_SKILL_EXEMPTIONS),
      ...Object.keys(ORCHESTRATOR_EXEMPTIONS),
      ...Object.keys(REGISTRY_CLOUD_EXEMPTIONS),
    ]);
    const unreached = Object.keys(pkg.scripts)
      .filter((k) => k.endsWith(":cloud"))
      .filter((k) => !emitted.has(k) && !exempt.has(k));
    expect(unreached).toEqual([]);
  });

  it("carries no registry cloud exemption for a script it now emits", () => {
    const emitted = new Set(
      emittedCloud()
        .map((c) => c.match(/^pnpm run ([^\s]+)/)?.[1])
        .filter((s): s is string => !!s),
    );
    for (const k of Object.keys(REGISTRY_CLOUD_EXEMPTIONS)) {
      expect(
        pkg.scripts[k],
        `${k} is exempted and no longer exists`,
      ).toBeTruthy();
      expect(emitted.has(k), `${k} is exempted and also emitted`).toBe(false);
    }
  });

  it("publishes only bucket paths the sync guard accepts and that exist", () => {
    const bad = HANDLERS.flatMap((h) =>
      (h.publish?.paths ?? []).flatMap((p) => {
        const reason = isExcluded(p);
        if (reason) return [`${h.id}: ${p} — ${reason}`];
        return fs.existsSync(path.join(REPO, "data", p))
          ? []
          : [`${h.id}: data/${p} does not exist`];
      }),
    );
    expect(bad).toEqual([]);
  });
});

/** `:cloud` scripts the registry deliberately does not emit, beyond the two
 *  exemption maps in scripts/db/cloud_loader_coverage.ts. */
const REGISTRY_CLOUD_EXEMPTIONS: Record<string, string> = {
  "db:dump:cloud": "an operator backup, not a corpus reload",
  "db:sync:cloud":
    "a destructive whole-database reconcile, run by hand — never part of a scheduled publish",
  "db:proxy:cloud":
    "opens the Cloud SQL proxy and loads nothing; the doctor checks it and the publish runner's advice names it",
};

describe("post-steps and gates", () => {
  it("resolves every handler followUp to a post-step", () => {
    const ids = new Set(POST_STEPS.map((p) => p.id));
    const dangling = HANDLERS.flatMap((h) =>
      (h.followUps ?? [])
        .filter((f) => !ids.has(f))
        .map((f) => `${h.id}: ${f}`),
    );
    expect(dangling).toEqual([]);
  });

  it("has no follow-up-only post-step that nothing triggers", () => {
    const used = new Set(HANDLERS.flatMap((h) => h.followUps ?? []));
    const orphans = POST_STEPS.filter(
      (p) => p.when === "followUp" && !used.has(p.id),
    ).map((p) => p.id);
    expect(orphans).toEqual([]);
  });

  it("keeps post-step ids unique", () => {
    const ids = POST_STEPS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /** Gates whose verdict depends on the WATCHER having moved ahead of the
   *  committed data, so "passes on disk" is legitimately false between a
   *  watcher run and the ingest it queues. Their fail/pass logic is covered by
   *  gates.test.ts against crafted watcher state. */
  const WATCHER_RELATIVE: Record<string, string> = {
    "rollcall-announced-sessions-loaded":
      "fails by design while the watcher has announced a session the next ingest has not loaded yet",
  };

  /** One line each outputLacks gate must reject — keyed by gate id, so a new
   *  outputLacks gate fails the test below until it is given one. */
  const OUTPUT_LACKS_EXAMPLES: Record<string, string> = {
    "indicators-all-matched": "matched 260 of 265, 5 unmatched",
    "social-curated-current": "  ✗ ASP curated figure differs",
    "kzk-gates-armed": "[skip] kzk gate DISARMED: no baseline",
    "culture-eik-linking": "producer→EIK linking SKIPPED (no Postgres)",
  };

  const allGates = (): { handler: string; gate: Gate }[] => [
    ...HANDLERS.flatMap((h) =>
      (h.gates ?? []).map((gate) => ({ handler: h.id, gate })),
    ),
  ];

  it("passes every declared gate against the data on disk", () => {
    // A gate that fails on the data we already publish is mis-specified — it
    // would fail every future run. The tests below prove each one CAN fail.
    const ctx = makeGateCtx("");
    const results = HANDLERS.flatMap((h) =>
      runGates(
        (h.gates ?? []).filter((g) => !WATCHER_RELATIVE[g.id]),
        new Set(h.sources),
        ctx,
      ).map((r) => ({ handler: h.id, ...r })),
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results.filter((r) => !r.ok)).toEqual([]);
  });

  it("knows how every gate was built", () => {
    const untyped = allGates()
      .filter(({ gate }) => !gate.kind)
      .map(({ handler, gate }) => `${handler} › ${gate.id}`);
    expect(untyped).toEqual([]);
  });

  it("fails every file-reading gate when nothing can be read", () => {
    // makeGateCtx("") made every outputLacks gate pass and every baseline-less
    // noShrink pass — the old test could not tell a live gate from a dead one.
    const nothing: GateCtx = {
      output: "",
      readJson: (f) => {
        throw new Error(`ENOENT ${f}`);
      },
      baselineJson: () => undefined,
    };
    const passed = allGates()
      .filter(({ gate }) => gate.kind !== "outputLacks")
      .filter(({ gate }) => gate.check(nothing).ok)
      .map(({ handler, gate }) => `${handler} › ${gate.id}`);
    expect(passed).toEqual([]);
  });

  it("fails every outputLacks gate on its marker, and passes without it", () => {
    const gates = allGates().filter(({ gate }) => gate.kind === "outputLacks");
    expect(gates.length).toBeGreaterThan(0);
    for (const { handler, gate } of gates) {
      const line = OUTPUT_LACKS_EXAMPLES[gate.id];
      expect(line, `${handler} › ${gate.id} has no example line`).toBeTruthy();
      expect(gate.marker?.test(line), `${gate.id}: example misses`).toBe(true);
      const ctx = makeGateCtx;
      expect(gate.check(ctx(`ok\n${line}\ndone`)).ok, gate.id).toBe(false);
      expect(gate.check(ctx("ok\ndone")).ok, gate.id).toBe(true);
    }
    // A stale example is a gate that was renamed or removed.
    const ids = new Set(gates.map(({ gate }) => gate.id));
    expect(
      Object.keys(OUTPUT_LACKS_EXAMPLES).filter((k) => !ids.has(k)),
    ).toEqual([]);
  });

  it("fails every noShrink gate against a larger baseline", () => {
    const gates = allGates().filter(({ gate }) => gate.kind === "noShrink");
    expect(gates.length).toBeGreaterThan(0);
    for (const { handler, gate } of gates) {
      const file = gate.baseline!;
      const real = makeGateCtx("").readJson(file);
      const measure = gate.measure!;
      const bigger = grow(real, measure);
      expect(
        bigger,
        `${handler} › ${gate.id}: no collection to grow`,
      ).toBeDefined();
      const ctx = (base: unknown): GateCtx => ({
        output: "",
        readJson: () => real,
        baselineJson: () => base,
      });
      expect(gate.check(ctx(bigger)).ok, `${gate.id} vs bigger`).toBe(false);
      expect(gate.check(ctx(real)).ok, `${gate.id} vs itself`).toBe(true);
    }
  });
});

/** A copy of `j` with ONE collection (≤3 levels deep) doubled such that
 *  `measure` grows — the baseline a shrink guard must refuse. */
const grow = (
  j: unknown,
  measure: (j: unknown) => number,
): unknown | undefined => {
  const before = measure(j);
  const paths: string[][] = [];
  const walk = (v: unknown, p: string[]): void => {
    if (p.length > 3 || !v || typeof v !== "object") return;
    paths.push(p);
    if (!Array.isArray(v))
      for (const k of Object.keys(v as object))
        walk((v as Record<string, unknown>)[k], [...p, k]);
  };
  walk(j, []);
  for (const p of paths) {
    const copy = structuredClone(j) as Record<string, unknown>;
    const parent = p
      .slice(0, -1)
      .reduce<
        Record<string, unknown>
      >((o, k) => o[k] as Record<string, unknown>, copy);
    const key = p[p.length - 1];
    const target = (key === undefined ? copy : parent[key]) as unknown;
    const doubled = Array.isArray(target)
      ? [...target, ...target]
      : Object.fromEntries(
          Object.entries(target as object).flatMap(([k, v]) => [
            [k, v],
            [`${k}__dup`, v],
          ]),
        );
    if (key === undefined) continue; // never double the root
    parent[key] = doubled;
    try {
      if (measure(copy) > before) return copy;
    } catch {
      // the selector no longer reads this shape — try the next path
    }
  }
  return undefined;
};

describe("selectPostSteps", () => {
  it("keeps POST_STEPS order, adds follow-ups, and honours skipWhen", async () => {
    const { selectPostSteps } = await import("./post_steps");
    const ids = (f: string[], flipped: string[]) =>
      selectPostSteps(f, new Set(flipped)).map((p) => p.id);
    const base = ids([], []);
    expect(base).toEqual(
      POST_STEPS.filter((p) => p.when === "always").map((p) => p.id),
    );
    expect(ids(["price-hub-payloads"], ["eurostat"])).toContain(
      "price-hub-payloads",
    );
    expect(
      ids(["price-hub-payloads"], ["kzp_prices", "eurostat"]),
    ).not.toContain("price-hub-payloads");
    const withHubs = ids(["water-hub-stats", "sector-stats"], []);
    expect(withHubs.indexOf("sector-stats")).toBeLessThan(
      withHubs.indexOf("water-hub-stats"),
    );
    expect(withHubs.indexOf("water-hub-stats")).toBeLessThan(
      withHubs.indexOf("home"),
    );
  });
});

describe("human-only arms", () => {
  it("blocks the arm of every operator item that IS its source's ingest", () => {
    // A source with no scoped ingest/verify step of its own is ingested only
    // by the human: if that item does not block its arm, another arm's
    // success stamps the marker and the human-only change never re-queues.
    const loose = HANDLERS.filter((h) => h.runner !== "skill").flatMap((h) =>
      (h.operator ?? [])
        .filter((o) => o.on && o.blocks === "nothing")
        .filter((o) =>
          (o.on ?? []).some(
            (src) =>
              !h.steps.some(
                (st) => st.phase !== "derive" && st.on?.includes(src),
              ),
          ),
        )
        .map((o) => `${h.id} › ${o.id}`),
    );
    expect(loose).toEqual([]);
  });

  it("gives every drop-a-file operator item on a script handler a done-check", () => {
    // An ack says "I did it"; for a FILE DROP the file itself is the proof.
    // Without a done-check, an ack with no file stamps work that never landed
    // (the municipal-fiscal and FTS cases, which therefore stay delegated).
    const unchecked = HANDLERS.filter((h) => h.runner === "script").flatMap(
      (h) =>
        (h.operator ?? [])
          .filter((o) => o.dropDir && !o.done)
          .map((o) => `${h.id} › ${o.id}`),
    );
    expect(unchecked).toEqual([]);
  });

  it("has no agent item standing in for a source's only ingest", () => {
    const orphaned = HANDLERS.filter((h) => h.runner !== "skill").flatMap((h) =>
      (h.agent ?? [])
        .filter((a) => a.on)
        .filter((a) =>
          (a.on ?? []).some(
            (src) =>
              !h.steps.some(
                (st) => st.phase !== "derive" && st.on?.includes(src),
              ),
          ),
        )
        .map((a) => `${h.id} › ${a.id}`),
    );
    expect(orphaned).toEqual([]);
  });
});

describe("review fixes (2026-11-13)", () => {
  const h = (id: string): Handler => {
    const found = HANDLERS.find((x) => x.id === id);
    if (!found) throw new Error(`no handler ${id}`);
    return found;
  };
  const stepIds = (id: string): string[] => h(id).steps.map((s) => s.id);
  const cloudOn = (id: string, run: string): readonly string[] | "always" => {
    for (const c of h(id).publish?.cloud ?? []) {
      const spec: CloudSpec = typeof c === "string" ? { run: c } : c;
      if (spec.run === run) return spec.on ?? "always";
    }
    throw new Error(`${id} does not publish ${run}`);
  };
  const before = (list: readonly string[], a: string, b: string): void => {
    expect(list).toContain(a);
    expect(list).toContain(b);
    expect(list.indexOf(a), `${a} must precede ${b}`).toBeLessThan(
      list.indexOf(b),
    );
  };

  it("tr-daily-refresh publishes the CR founding dates, after TR and before the risk rebuild", () => {
    expect(
      cloudOn("tr-daily-refresh", "pnpm run db:load:company-founded:pg:cloud"),
    ).toBe("always");
    before(
      CLOUD_ORDER,
      "db:load:tr:pg:cloud",
      "db:load:company-founded:pg:cloud",
    );
    before(
      CLOUD_ORDER,
      "db:load:company-founded:pg:cloud",
      "db:refresh:risk:cloud",
    );
  });

  it("runs update-rollcall after parliament-scrape (it reads the MP roster)", () => {
    expect(h("update-rollcall").after).toContain("parliament-scrape");
  });

  it("gates update-rollcall on the sessions the watcher announced", () => {
    expect(h("update-rollcall").gates?.map((g) => g.id)).toContain(
      "rollcall-announced-sessions-loaded",
    );
  });

  it("publishes the magistrate roster with update-persons when the judiciary sources move", () => {
    expect(
      cloudOn("update-persons", "pnpm run db:load:magistrates:pg:cloud"),
    ).toEqual(["ivss_declarations", "vss_court_statistics"]);
    before(
      CLOUD_ORDER,
      "db:load:magistrates:pg:cloud",
      "db:load:judicial-bodies:pg:cloud",
    );
    before(
      CLOUD_ORDER,
      "db:load:judicial-bodies:pg:cloud",
      "db:resolve:persons:cloud",
    );
  });

  it("runs the local twins of update-persons' cloud dimensions before the resolver", () => {
    const ids = stepIds("update-persons");
    before(ids, "db:load:place-dim:pg", "db:resolve:persons");
    before(ids, "db:load:judicial-bodies:pg", "db:resolve:persons");
    before(ids, "db:load:declarations:pg", "db:load:employer-links:pg");
    before(ids, "db:load:tr-name-fold-people:pg", "db:resolve:persons");
  });

  it("runs update-funds' money-basis reloads locally too, in CLAUDE.md order", () => {
    const ids = stepIds("update-funds");
    before(ids, "db:load:interreg:pg", "db:load:graph:pg");
    before(ids, "db:load:persons-browse:pg", "db:load:person-search:pg");
    before(ids, "db:load:persons-browse:pg", "db:load:graph:pg");
    before(ids, "db:load:graph:pg", "db:load:tr-company-place:pg");
    // graph and tr-company-place run on every arm, as their cloud twins do.
    const step = (id: string) =>
      h("update-funds").steps.find((s) => s.id === id)!;
    expect(step("db:load:graph:pg").on).toBeUndefined();
    expect(step("db:load:tr-company-place:pg").on).toBeUndefined();
  });

  it("loads and publishes debarred.json when only aop_debarred moved", () => {
    const steps = h("update-procurement").steps;
    const ids = steps.map((s) => s.id);
    before(ids, "debarred", "db:load:pg:debarred");
    before(ids, "debarred", "db:refresh");
    expect(steps.find((s) => s.id === "db:load:pg:debarred")?.on).toEqual([
      "aop_debarred",
    ]);
    for (const run of [
      "pnpm run db:load:pg:cloud",
      "pnpm run db:load:annexes:pg:cloud",
    ])
      expect(cloudOn("update-procurement", run)).toContain("aop_debarred");
  });

  it("declares pdftotext for the NATO table parse", () => {
    const s = h("update-defense").steps.find(
      (x) => x.id === "defense:write_nato",
    );
    expect(s?.needs).toContain("bin:pdftotext");
  });
});
