import {
  FUNDING_FOLLOWUPS,
  fundingContinuation,
} from "../../src/lib/fundingContinuations";
import {
  encodeFundingQuery,
  validateFundingQuery,
} from "../../src/lib/fundingQuery";
import type { Envelope } from "../tools/types";
import type { Suggestion } from "./suggestions";
export function fundingContinuations(env: Envelope): Suggestion[] {
  if (!env.funding) return [];
  const p = validateFundingQuery(env.funding.query);
  if (!p.ok) return [];
  const q = p.query;
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
