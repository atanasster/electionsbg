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
import { makeGateCtx, runGates } from "./gates";
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

  it("passes every declared gate against the data on disk", () => {
    // A gate that fails on the data we already publish is mis-specified — it
    // would fail every future run. This proves only that each gate reads a
    // real file and observes a value; whether it CAN fail is gates.test.ts's
    // job (each helper has a failing case) and the reviewer's (a gate over a
    // constant the script copies into its output can never fail).
    const ctx = makeGateCtx("");
    const results = HANDLERS.flatMap((h) =>
      runGates(h.gates ?? [], new Set(h.sources), ctx).map((r) => ({
        handler: h.id,
        ...r,
      })),
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results.filter((r) => !r.ok)).toEqual([]);
  });
});

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
