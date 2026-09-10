// The exact routing stage used by the Non AI provider and its offline evals.
import {
  followOnScopeNotice,
  pinElectionContext,
  resolveFollowOn,
  route,
} from "../orchestrator/router";
import type { ToolContext } from "../tools/types";
import type { RespondOpts } from "./provider";
export function selectHeuristicRoute(
  question: string,
  ctx: ToolContext,
  opts?: RespondOpts,
) {
  const notice = followOnScopeNotice(question, opts?.prev, ctx.lang);
  return {
    notice,
    route: notice
      ? null
      : pinElectionContext(
          resolveFollowOn(question, opts?.prev) ?? route(question, ctx),
          ctx,
        ),
  };
}
