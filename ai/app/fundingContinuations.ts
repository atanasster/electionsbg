import {
  FUNDING_FOLLOWUPS,
  fundingContinuation,
} from "../../src/lib/fundingContinuations";
import { encodeFundingQuery } from "../../src/lib/fundingQuery";
import type { Envelope } from "../tools/types";
import type { Suggestion } from "./suggestions";
export function fundingContinuations(env: Envelope): Suggestion[] {
  if (!env.funding) return [];
  const q = env.funding.query;
  return FUNDING_FOLLOWUPS.flatMap(([id, bg, en]) => {
    const r = fundingContinuation(en, q);
    if (!r) return [];
    if (r.reason && !["P01", "P11", "P15", "P16"].includes(id)) return [];
    return [
      {
        bg,
        en,
        questionId: "funding-followup-" + id,
        intent: r.query
          ? { tool: "fundingQuery", args: r.query }
          : {
              tool: "fundingQuestion",
              args: { question: en, previous: encodeFundingQuery(q) },
            },
      },
    ];
  });
}
