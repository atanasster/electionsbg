// Tier V (money-linked private owners) — the ONE list of identity_confidence values a
// minted Tier-V person may be SERVED and given companies under.
//
// It lives here, apart from the resolver, for the reason bridgeB.ts states: two consumers
// must not be allowed to disagree. `resolve_persons.ts` decides which minted people get
// their Commerce-Registry footprint attached, and
// `scripts/db/tests/person_resolve.data.test.ts` asserts that every tr/ngo role in the
// table is a licensed attribution. That gate is the defamation-sensitive invariant on the
// whole TR layer, so a near-copy of the rule in the test can go on passing against a rule
// the writer no longer applies — or, as happened here, go RED against a rule the writer
// applies deliberately.
//
// WHAT WENT WRONG ONCE. Tier V minted every person 'verified' until 2026-08-12, when
// 'shared_name' was added for a fold the REGISTRY itself records as several people
// (tr-attribution-basis-v1 §2.6). §2.6 chose to KEEP those people and LABEL them rather
// than exclude them — this table is rebuilt from scratch every resolve, so dropping them
// would delete ~4.4k person rows and orphan their /person URLs with no redirect target.
// The resolver's role INSERT was widened to match; the gate's copy was not, and it read
// 20,399 deliberately-attached roles (4,405 people) as unlicensed attributions.
//
// So the list is the LICENCE, not a convenience: adding a value here says those people may
// hold companies on a public page. 081's CHECK constraint bounds the column to
// ('resolved', 'verified', 'shared_name'); 'resolved' is deliberately absent below — it is
// the default for the ordinary resolved population, which reaches its roles through Bridge
// A or B and never through the name-only Tier-V mint.
//
// ⚠️ THE SQL SIDE HAS ITS OWN COPIES and cannot import this: 082 (person_by_slug's privacy
// gate), 120 (the browse arm) and 150 (mp_tr_roles) each spell `identity_confidence IN
// ('verified', 'shared_name')`. A new value must be added there too, or the person exists,
// holds roles, and 404s.
export const TIER_V_SERVED_IDENTITIES = ["verified", "shared_name"] as const;

/** The same list as a SQL literal list — `IN (${TIER_V_SERVED_IDENTITIES_SQL})`. */
export const TIER_V_SERVED_IDENTITIES_SQL = TIER_V_SERVED_IDENTITIES.map(
  (v) => `'${v}'`,
).join(", ");
