import type { StoryMember } from "./data";

export interface AxisCompleteness {
  assessed: number;
  total: number;
  positioned: number;
  notApplicable: number;
  unavailable: number;
  outlets: number;
}

export const axisCompleteness = (
  members: StoryMember[],
  value: (member: StoryMember) => string | null | undefined,
): AxisCompleteness => {
  let assessed = 0;
  let positioned = 0;
  let notApplicable = 0;
  const outlets = new Set<string>();
  for (const member of members) {
    const label = value(member);
    if (!label) continue;
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
    unavailable: members.length - assessed,
    outlets: outlets.size,
  };
};
