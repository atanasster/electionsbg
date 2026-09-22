import { isScopedObservation, type StoryMember } from "./data";

export interface AxisCompleteness {
  /** Members with a FULL-text verdict on this axis. */
  assessed: number;
  total: number;
  positioned: number;
  notApplicable: number;
  unavailable: number;
  /**
   * T4.1c — members whose verdict was not made on the demonstrably full
   * text (a prefix, or an unrecorded read). Reported separately (plan T4.4:
   * „partial-scope counts separately"); neither assessed nor unavailable,
   * and in no rollup.
   */
  partialScope: number;
  /**
   * Distinct domains with ANY verdict, `not_applicable` included — NOT the
   * divergence rule's basis (`AxisDivergence.positionedOutlets`, which
   * counts only outlets holding a position). The two differ by design.
   */
  outlets: number;
}

export const axisCompleteness = (
  members: StoryMember[],
  value: (member: StoryMember) => string | null | undefined,
): AxisCompleteness => {
  let assessed = 0;
  let positioned = 0;
  let notApplicable = 0;
  let partialScope = 0;
  const outlets = new Set<string>();
  for (const member of members) {
    const label = value(member);
    if (!label) continue;
    if (isScopedObservation(member)) {
      partialScope += 1;
      continue;
    }
    assessed += 1;
    outlets.add(member.domain);
    if (label === "not_applicable") notApplicable += 1;
    else positioned += 1;
  }
  return {
    assessed,
    total: members.length,
    positioned,
    notApplicable,
    unavailable: members.length - assessed - partialScope,
    partialScope,
    outlets: outlets.size,
  };
};
