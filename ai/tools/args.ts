// Small shared helpers for resolving common tool arguments.

import { isKnownElection } from "./dataset";
import type { ToolArgs, ToolContext } from "./types";

// Resolve an `election` arg, falling back to the context's selected election
// (which defaults to the latest). Unknown strings fall back too.
export const resolveElection = (args: ToolArgs, ctx: ToolContext): string => {
  const a = args.election;
  if (typeof a === "string" && a && isKnownElection(a)) return a;
  return ctx.election;
};

// Resolve a positive integer count arg (e.g. "last N elections").
export const clampCount = (
  raw: unknown,
  fallback: number,
  max = 13,
): number => {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
};
