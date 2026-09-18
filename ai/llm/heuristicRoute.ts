// The exact routing stage used by the Non AI provider and its offline evals.
import {
  followOnScopeNotice,
  pinElectionContext,
  resolveFollowOn,
  route,
} from "../orchestrator/router";
import type { ToolContext } from "../tools/types";
import type { RespondOpts } from "./provider";
// The deterministic steps that run BEFORE any model is consulted, in the order
// both lanes must use: a scope notice short-circuits the turn, and a bare
// follow-on ("а ДПС?") resolves by ellipsis against the previous answer.
//
// Exported because the Jev lane interleaves its own routing step in the middle
// and so cannot call `selectHeuristicRoute` wholesale — consuming the same
// helper is what makes "both lanes route in the same order" a fact about the
// code rather than about a reviewer's memory.
export function deterministicPreamble(
  question: string,
  ctx: ToolContext,
  opts?: RespondOpts,
) {
  const notice = followOnScopeNotice(question, opts?.prev, ctx.lang);
  return {
    notice,
    followOn: notice ? null : resolveFollowOn(question, opts?.prev),
  };
}

export function selectHeuristicRoute(
  question: string,
  ctx: ToolContext,
  opts?: RespondOpts,
) {
  const { notice, followOn } = deterministicPreamble(question, ctx, opts);
  return {
    notice,
    route: notice
      ? null
      : pinElectionContext(followOn ?? route(question, ctx), ctx),
  };
}
