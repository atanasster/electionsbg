// Small constructors so a handler entry reads as a list, not as object noise.

import type { Phase, RunCtx, Step } from "./types";

type StepOpts = Omit<Step, "id" | "run" | "phase"> & { phase?: Phase };

const step =
  (phase: Phase) =>
  (id: string, run: string, opts: StepOpts = {}): Step => ({
    id,
    run,
    phase: opts.phase ?? phase,
    ...opts,
  });

export const ingest = step("ingest");
export const derive = step("derive");
export const verify = step("verify");

/** `pnpm exec tsx <path> [args]` — the path is checked by the coverage test. */
export const tsx = (file: string, ...args: string[]): string =>
  ["pnpm exec tsx", file, ...args].join(" ");

/** `pnpm run <script> [args]` — the script name is checked by the coverage test. */
export const pnpm = (script: string, ...args: string[]): string =>
  ["pnpm run", script, ...args].join(" ");

/** `meta.scope.<key>` as a string list, or null when the watcher stored none.
 *
 *  The watcher reports WHAT moved in a free-text describe-line today; the
 *  structured form lands with plan §3.2. Until a source emits it, a step scoped
 *  through this returns null and is skipped with "no scope" — which surfaces as
 *  a needs-agent item rather than an unscoped run. */
export const scopeList = (
  ctx: RunCtx,
  sourceId: string,
  key: string,
): string[] | null => {
  const scope = ctx.meta(sourceId)?.scope;
  if (!scope || typeof scope !== "object") return null;
  const v = (scope as Record<string, unknown>)[key];
  if (!Array.isArray(v) || v.length === 0) return null;
  const out = v.filter((x): x is string => typeof x === "string" && x !== "");
  return out.length ? out : null;
};

export const currentYear = (ctx: RunCtx): string =>
  String(ctx.now.getUTCFullYear());
