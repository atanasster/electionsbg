// What would run, and why — a pure function of watcher state, ingest markers,
// the registry and the environment. Plan: docs/plans/watch-pipeline-scripts-v1.md §2.2.
//
// The rule is the one process-watch-report applied by hand: a handler is due
// when any of its sources moved after its marker's lastSuccessfulIngest. What
// this adds is everything the prose could not hold reliably — per-arm steps,
// `after` ordering, unmet needs and outstanding operator items as explicit
// states, and a reason on every entry.
//
// ⚠️ A marker is ONE timestamp per handler. Stamping it says "every source
// that moved before now is ingested". So whenever a moved source could not be
// served this run — its arm blocked by an operator item — the entry is marked
// `stampable: false`, and the runner must leave the marker alone so the source
// re-queues next run. Stamping anyway would erase that debt silently.

import {
  markerOf,
  orderCloud,
  stepNeeds,
  type CloudSpec,
  type Handler,
  type Need,
  type RunCtx,
  type Step,
} from "./registry";
import type { WatchState } from "../watch/types";
import type { IngestState } from "../lib/ingest-state";

/** What to do with a handler whose marker does not exist yet. */
export type BootstrapPolicy = "run" | "seed" | "ask";

export interface PlanInputs {
  handlers: readonly Handler[];
  watch: ReadonlyMap<string, WatchState>;
  /** Keyed by MARKER file stem, not by skill. */
  ingest: ReadonlyMap<string, IngestState>;
  now: Date;
  bootstrap: BootstrapPolicy;
  /** Needs the preflight found unmet. Omitted = not checked. */
  unmet?: ReadonlyMap<Need, string>;
  /** `<handler>:<operatorStep>` → ISO time an operator acknowledged it done.
   *  An ack only covers source changes that happened before it. */
  acks?: ReadonlyMap<string, string>;
  /** Restrict the plan to these handler ids. */
  only?: ReadonlySet<string>;
  /** Watcher sources deliberately routed nowhere (registry UNROUTED). */
  exemptUnrouted?: ReadonlySet<string>;
  /** Problems reading state; carried into `warnings` so no output drops them. */
  inputErrors?: readonly string[];
}

export interface Reason {
  source: string;
  lastChanged: string;
  lastIngest: string | null;
  detail?: string;
}

export interface PlannedStep {
  id: string;
  run: string;
  phase: Step["phase"];
  status: "run" | "skip";
  why?: string;
  timeoutMin: number;
  okExit: readonly number[];
  kind: "command" | "chain";
}

export type EntryStatus =
  /** at least one step is planned to run */
  | "run"
  /** a need is unmet, or a handler it runs `after` is not running — nothing runs */
  | "blocked"
  /** an operator item blocks the handler — nothing runs */
  | "needs-operator"
  /** marker missing and the policy did not say "run" */
  | "bootstrap"
  /** queued, but every step skipped — nothing runs, nothing is stamped */
  | "nothing-to-run";

export interface PlanEntry {
  handler: string;
  marker: string;
  runner: Handler["runner"];
  skill?: string;
  status: EntryStatus;
  /** One line explaining a non-run status. */
  why?: string;
  bootstrapAction?: Exclude<BootstrapPolicy, "run">;
  reasons: Reason[];
  flipped: string[];
  /** Moved sources this run cannot serve (arm blocked). */
  deferred: string[];
  /** False when the marker must NOT be stamped even if every step succeeds. */
  stampable: boolean;
  steps: PlannedStep[];
  operator: {
    id: string;
    instruction: string;
    blocks: string;
    url?: string;
    dropDir?: string;
  }[];
  agent: { id: string; instruction: string; doc: string }[];
  cloud: string[];
  paths: string[];
  followUps: string[];
}

export interface Plan {
  schema: 1;
  generatedAt: string;
  bootstrap: BootstrapPolicy;
  entries: PlanEntry[];
  /** Union of runnable entries' follow-ups, in first-seen order. */
  followUps: string[];
  /** Cloud commands of runnable entries, in CLOUD_ORDER. */
  cloud: string[];
  /** Sources with watcher state that no handler listens to and no exemption covers. */
  unrouted: string[];
  /** Data problems the planner worked around — never silently. */
  warnings: string[];
}

const DEFAULT_TIMEOUT_MIN = 30;

export const makeCtx = (
  flipped: ReadonlySet<string>,
  watch: ReadonlyMap<string, WatchState>,
  now: Date,
): RunCtx => ({
  flipped,
  meta: (id) => watch.get(id)?.meta,
  detail: (id) => watch.get(id)?.detail,
  now,
});

const intersects = (a: readonly string[], b: ReadonlySet<string>): boolean =>
  a.some((x) => b.has(x));

/** Handlers in `after` order, ties kept in input order. Only edges between
 *  two queued handlers matter; the registry test forbids cycles. */
export const orderByAfter = <T extends { handler: string }>(
  entries: readonly T[],
  handlers: readonly Handler[],
): T[] => {
  const byId = new Map(handlers.map((h) => [h.id, h]));
  const queued = new Map(entries.map((e) => [e.handler, e]));
  const out: T[] = [];
  const done = new Set<string>();
  const visit = (id: string): void => {
    if (done.has(id) || !queued.has(id)) return;
    done.add(id);
    for (const dep of byId.get(id)?.after ?? []) visit(dep);
    out.push(queued.get(id)!);
  };
  for (const e of entries) visit(e.handler);
  return out;
};

const cloudOf = (h: Handler, ctx: RunCtx): string[] =>
  (h.publish?.cloud ?? [])
    .map((c): CloudSpec => (typeof c === "string" ? { run: c } : c))
    .filter((c) => !c.on || intersects(c.on, ctx.flipped))
    .map((c) => (typeof c.run === "string" ? c.run : c.run(ctx)));

/** Epoch ms, or null — with a warning — for a missing or unparseable stamp. */
const parseStamp = (
  value: string | undefined,
  label: string,
  warnings: string[],
): number | null => {
  if (!value) {
    warnings.push(
      `${label} is missing — cannot tell whether it moved; not queued`,
    );
    return null;
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    warnings.push(
      `${label} is not a timestamp (${JSON.stringify(value)}); not queued`,
    );
    return null;
  }
  return ms;
};

const planHandler = (
  h: Handler,
  inp: PlanInputs,
  warnings: string[],
): PlanEntry | null => {
  const marker = markerOf(h);
  const mark = inp.ingest.get(marker) ?? null;
  const last = mark?.lastSuccessfulIngest ?? null;
  let lastMs: number | null = null;
  if (mark) {
    lastMs = parseStamp(
      last ?? undefined,
      `state/ingest/${marker}.json lastSuccessfulIngest`,
      warnings,
    );
    if (lastMs === null) return null;
  }

  const reasons: Reason[] = [];
  for (const src of h.sources) {
    const w = inp.watch.get(src);
    if (!w) continue; // never probed yet: nothing to ingest
    const changed = parseStamp(
      w.lastChanged,
      `state/watch/${src}.json lastChanged`,
      warnings,
    );
    if (changed === null) continue;
    if (lastMs === null || changed > lastMs)
      reasons.push({
        source: src,
        lastChanged: w.lastChanged!,
        lastIngest: last,
        detail: w.detail,
      });
  }
  if (reasons.length === 0) return null;

  const flipped = new Set(reasons.map((r) => r.source));
  const changedAt = new Map(
    reasons.map((r) => [r.source, Date.parse(r.lastChanged)]),
  );
  // An ack covers the change it was given for, never a later one: it must be
  // at least as new as every flipped source the item is about.
  const isAck = (id: string, on: readonly string[] | undefined): boolean => {
    const at = inp.acks?.get(`${h.id}:${id}`);
    if (at === undefined) return false;
    const ackMs = Date.parse(at);
    if (Number.isNaN(ackMs)) {
      warnings.push(
        `ack ${h.id}:${id} has no valid timestamp (${JSON.stringify(at)}); ignored`,
      );
      return false;
    }
    const relevant = (on ?? [...flipped]).filter((s) => flipped.has(s));
    return relevant.every((s) => ackMs >= (changedAt.get(s) ?? 0));
  };
  const fullCtx = makeCtx(flipped, inp.watch, inp.now);

  const operator = (h.operator ?? []).filter(
    (o) =>
      (!o.on || intersects(o.on, flipped)) &&
      !isAck(o.id, o.on) &&
      !(o.done?.(fullCtx) ?? false),
  );
  const deferred = new Set(
    operator
      .filter((o) => o.blocks === "arm")
      .flatMap((o) => o.on ?? [])
      .filter((s) => flipped.has(s)),
  );
  // Everything downstream of the operator check sees only the sources this
  // run can actually serve — cloud loaders included.
  const served = new Set([...flipped].filter((s) => !deferred.has(s)));
  const ctx = makeCtx(served, inp.watch, inp.now);

  const steps: PlannedStep[] = h.steps.map((s) => {
    const base = {
      id: s.id,
      phase: s.phase,
      timeoutMin: s.timeoutMin ?? DEFAULT_TIMEOUT_MIN,
      okExit: s.okExit ?? [],
      kind: s.kind ?? "command",
    } as const;
    const skip = (why: string): PlannedStep => ({
      ...base,
      run: s.run,
      status: "skip",
      why,
    });
    if (s.on && !intersects(s.on, served))
      return skip(
        intersects(s.on, flipped)
          ? "arm blocked by an operator item"
          : `only on ${s.on.join(", ")}`,
      );
    let args: string[] | null = [];
    try {
      args = s.args ? s.args(ctx) : [];
    } catch (e) {
      return skip(
        `args() threw: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (args === null)
      return skip("no scope — the watcher stored no structured scope");
    return { ...base, run: [s.run, ...args].join(" "), status: "run" };
  });

  const unmet = [
    ...new Set(
      steps
        .filter((p) => p.status === "run")
        .flatMap((p) => stepNeeds(h, h.steps.find((s) => s.id === p.id)!)),
    ),
  ].filter((n) => inp.unmet?.has(n));

  const runnable = steps.some((s) => s.status === "run");
  // A skip that is not an `on`/arm decision means a step that SHOULD have run
  // could not be scoped — a failure to report, not "nothing applies".
  const scopeFailed = steps.some(
    (s) =>
      s.status === "skip" && /^(no scope|args\(\) threw)/.test(s.why ?? ""),
  );

  let status: EntryStatus = "run";
  let why: string | undefined;
  let bootstrapAction: PlanEntry["bootstrapAction"];
  const handlerBlock = operator.find((o) => o.blocks === "handler");
  if (handlerBlock || (!runnable && operator.length > 0)) {
    // Either an item blocks the whole handler, or nothing automated applies
    // to what moved and the ingest IS the human step.
    status = "needs-operator";
    why = (handlerBlock ?? operator[0]).instruction;
  } else if (unmet.length) {
    status = "blocked";
    why = unmet.map((n) => `${n}: ${inp.unmet?.get(n) ?? "unmet"}`).join("; ");
  } else if (mark === null && inp.bootstrap !== "run") {
    status = "bootstrap";
    bootstrapAction = inp.bootstrap;
    why =
      inp.bootstrap === "seed"
        ? "no marker yet — seed it without running"
        : "no marker yet — choose run or seed";
  } else if (!runnable && scopeFailed) {
    status = "nothing-to-run";
    why = "every step skipped and at least one could not be scoped";
  }
  // Otherwise "run", even with zero runnable steps: nothing automated applies
  // to what moved and no human item is outstanding (an operator handler whose
  // edit was acknowledged), so stamping records that the change is handled.

  return {
    handler: h.id,
    marker,
    runner: h.runner,
    skill: h.skill,
    status,
    why,
    bootstrapAction,
    reasons,
    flipped: [...flipped],
    deferred: [...deferred],
    stampable: deferred.size === 0,
    steps,
    operator: operator.map((o) => ({
      id: o.id,
      instruction: o.instruction,
      blocks: o.blocks,
      url: o.url,
      dropDir: o.dropDir,
    })),
    agent: (h.agent ?? [])
      .filter((a) => !a.on || intersects(a.on, served))
      .map((a) => ({ id: a.id, instruction: a.instruction, doc: a.doc })),
    cloud: cloudOf(h, ctx),
    paths: [...(h.publish?.paths ?? [])],
    followUps: [...(h.followUps ?? [])],
  };
};

export const plan = (inp: PlanInputs): Plan => {
  const warnings: string[] = [...(inp.inputErrors ?? [])];
  const entries: PlanEntry[] = [];
  for (const h of inp.handlers) {
    if (inp.only && !inp.only.has(h.id)) continue;
    const e = planHandler(h, inp, warnings);
    if (e) entries.push(e);
  }

  // A handler that runs `after` another must not run when that one is queued
  // and not running: it would consume the predecessor's previous output and
  // publish it as fresh. Walk in order so a hold propagates down a chain.
  const ordered = orderByAfter(entries, inp.handlers);
  const byId = new Map(inp.handlers.map((h) => [h.id, h]));
  const statusOf = new Map<string, PlanEntry>();
  for (const e of ordered) {
    if (e.status === "run") {
      const held = (byId.get(e.handler)?.after ?? [])
        .map((a) => statusOf.get(a))
        .find((p) => p && p.status !== "run");
      if (held) {
        e.status = "blocked";
        e.why = `runs after ${held.handler}, which is ${held.status}`;
      }
    }
    statusOf.set(e.handler, e);
  }

  const runnable = ordered.filter((e) => e.status === "run");
  const routed = new Set(inp.handlers.flatMap((h) => h.sources));
  return {
    schema: 1,
    generatedAt: inp.now.toISOString(),
    bootstrap: inp.bootstrap,
    entries: ordered,
    followUps: [...new Set(runnable.flatMap((e) => e.followUps))],
    cloud: orderCloud(runnable.flatMap((e) => e.cloud)),
    unrouted: [...inp.watch.keys()]
      .filter((id) => !routed.has(id) && !inp.exemptUnrouted?.has(id))
      .sort(),
    warnings,
  };
};
