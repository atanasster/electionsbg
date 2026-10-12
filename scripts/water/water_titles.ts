// Contract-subject predicates the water hub uses, shared by the generator
// (scripts/db/gen_water/hub_stats.ts) and its gate (water_hub_figures.data.test.ts)
// so the two cannot count different rows. SQL fragments over `contracts.title`;
// no user input — inline literals.

/** Credit facilities, by contract subject. `\m` anchors at a word START: an
 *  unanchored `кредит` also matches „акредитирана лаборатория" — 8 of 17 rows
 *  on 2026-10-12 were accredited-lab analyses, not credit. */
export const CREDIT_TITLE = `title ~* '\\m(заем|кредит|овърдрафт)'`;
/** A loan, by contract subject — same word-start anchor. */
export const LOAN_TITLE = `title ~* '\\mзаем'`;
