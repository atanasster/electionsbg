// The `contract_number`s ИСУН names as delivered without a financial correction
// (migration 175), lifted out of the /api/db/company clean-delivery payload so
// `CompanyFundsTile` can mark the matching projects in place. The join is exact —
// 9,940 of 9,940 clean contracts resolve to a `fund_projects` row — so no fuzzy
// matching is involved.
//
// ⚠️ IT RETURNS `undefined`, NEVER AN EMPTY SET, WHEN THE REGISTER NAMES NOTHING,
// and that is the load-bearing part. A consumer asks two different questions of
// this value: „is THIS row named" (`has`) and „was the register consulted at all"
// (`size > 0`, which gates the caveat bounding every UNMARKED row). An empty Set
// answers the first identically and the second wrongly — it claims the register
// was consulted and named nothing, which is the „absence is a finding" reading the
// whole clean-delivery surface exists to prevent. `new Set(rows ?? [])` is the
// simplification that destroys it, invisibly, since the marks look the same.

import type { CleanContractRow } from "../components/procurement/CompanyCleanDeliveryTile";

export const cleanContractNumbersOf = (
  info: { contracts?: CleanContractRow[] | null } | null | undefined,
): ReadonlySet<string> | undefined => {
  const rows = info?.contracts;
  if (!rows?.length) return undefined;
  return new Set(rows.map((c) => c.contract_number));
};
