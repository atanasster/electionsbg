// Small constructors so a handler entry reads as a list, not as object noise.

import fs from "node:fs";
import path from "node:path";
import { REPO } from "../state";
import { scopeSince } from "../../watch/scope_log";
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

/** What moved under `key` for `sourceId` since this handler's marker — the
 *  union of every scope-log entry newer than `ctx.since` (plan §3.2) — or
 *  null when that cannot be known COMPLETELY: the handler never ran, the
 *  source logs no scope, or the marker predates what the log still holds.
 *
 *  Null skips the step with "no scope", which surfaces as a needs-agent item:
 *  a partial scope would run, succeed, advance the marker and lose the
 *  change it left out — the one outcome worse than not running. */
export const scopeList = (
  ctx: RunCtx,
  sourceId: string,
  key: string,
): string[] | null => scopeSince(ctx.meta(sourceId), key, ctx.since);

export const currentYear = (ctx: RunCtx): string =>
  String(ctx.now.getUTCFullYear());

/** The file names in a repo-relative directory ([] when it does not exist).
 *  An operator's file drop is proven by what is here — an ack is a claim. */
export const listDir = (dir: string): string[] => {
  try {
    return fs.readdirSync(path.join(REPO, dir));
  } catch {
    return [];
  }
};
