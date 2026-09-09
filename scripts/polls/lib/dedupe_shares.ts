// Tier 2c — reconciling a label the sentence rule found more than once.
//
// `sentence_rule.ts`'s own contract deliberately leaves this to the
// caller ("a legitimate repeat ... is agency-shaped rather than
// universal"), but the RECONCILIATION policy itself is not agency-shaped
// — it is "do two claims about the same party agree", which is the same
// question for every prose-based extractor. Shared here so TR, AR, MY,
// GIB and press don't each reinvent it (decision 14's "one home" rule).
//
// Two ACCEPTED claims sharing a label either state the SAME value (safe
// to collapse to one — e.g. a headline restating a number the body also
// gives) or DISAGREE (refused outright, never resolved by picking one —
// silently choosing would be exactly the kind of guess decision 5 exists
// to rule out, and the two claims cannot both be published as separate
// rows under one label without double-counting that party).

import type { Refusal, ShareClaim } from "./evidence_gate";

export interface DedupeResult {
  accepted: ShareClaim[];
  refused: Refusal[];
}

export const dedupeAcceptedShares = (claims: ShareClaim[]): DedupeResult => {
  const byLabel = new Map<string, ShareClaim[]>();
  for (const c of claims) {
    const group = byLabel.get(c.label);
    if (group) group.push(c);
    else byLabel.set(c.label, [c]);
  }

  const accepted: ShareClaim[] = [];
  const refused: Refusal[] = [];
  for (const [label, group] of byLabel) {
    if (group.length === 1) {
      accepted.push(group[0]);
      continue;
    }
    const values = new Set(group.map((c) => c.value));
    if (values.size === 1) {
      accepted.push(group[0]);
      continue;
    }
    refused.push({
      field: `share:${label}`,
      reason: `mentioned ${group.length} times with disagreeing values (${[...values].join(", ")}%) — refusing rather than guessing which is current`,
      quote: group.map((c) => c.quote).join(" | "),
    });
  }
  return { accepted, refused };
};
