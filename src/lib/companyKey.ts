// Which supplier keys have a `/company/:eik` page, and which are dead ends.
//
// `contracts.contractor_eik` is NOT always a Bulgarian EIK. Three other kinds of
// token live in that column, and NONE of them resolves to a company page —
// measured 2026-08-19 over every distinct contractor key in the corpus:
//
//   plain 9/13-digit EIK    27,553 keys   ← the only kind with a page
//   synthetic `<prefix>-…`   1,803 keys   0 resolve
//   neither                    282 keys   0 resolve  (137 with letters, 145
//                                                     numeric odd-length)
//
// Those are over EVERY distinct contractor key. Scoped to `tag = 'contract'` the
// first and last are 27,531 / 281; the synthetic count is identical either way.
//
// The synthetic namespaces are minted deliberately, each because the source id
// could not become a key (see scripts/procurement/supplier_identity.ts):
//   · `obed-` (1,626) — a consortium carrier, not one legal entity
//   · `ph-`   (91)    — the supplier's registration number was FILLER
//   · `np-`   (86)    — a natural person, keyed by name so no ЕГН is stored
//
// `institution_identity()` returns NULL for all 2,085 of them, so the page renders
// „Няма фирма с ЕИК … в базата." — a link that goes nowhere. Before this existed,
// every one of those was rendered as a live link at ~20 call sites.
//
// ⚠ A PLAIN EIK IS ALWAYS LINKABLE, even when it is absent from `tr_companies`.
// That is deliberate and the boundary is measured, not assumed: 8,850 plain EIKs
// have no registry row, yet 297 of them still resolve through
// `institution_identity` (which is built from contracts and funds, not the
// registry). Narrowing the rule to "has a tr_companies row" would delete 297
// working links, and for the rest the EIK is a real, checkable identifier that a
// reader can look up — the page saying we hold no registry record for it is an
// honest answer, unlike a synthetic key which is not an identifier at all.
//
// Same reasoning as AwarderLink: the rule lives in ONE place because ~20 call
// sites kept re-deriving it, and every one of them got it wrong the same way.

/** A supplier key that `/company/:eik` can actually serve — a bare Bulgarian EIK
 *  in its 9-digit (legal entity) or 13-digit (branch) form. Everything else is a
 *  synthetic carrier or a foreign registry id, neither of which has a page. */
export const isLinkableCompanyKey = (eik: string | undefined): boolean =>
  !!eik && /^(\d{9}|\d{13})$/.test(eik);

/** A CONSORTIUM carrier key — the `obed-` namespace `supplier_identity.ts` mints
 *  when an award names an обединение rather than one legal entity, keyed by the
 *  member set.
 *
 *  ⚠ DELIBERATELY NOT `!isLinkableCompanyKey(eik)`. That predicate answers „can
 *  /company serve this", which is also false for `ph-` (filler registration
 *  number) and `np-` (natural person) keys, and for foreign registry ids. Those
 *  are three different statements about a supplier and only this one means „this
 *  row is several firms". Inverting the linkability check would put a note about
 *  consortia under a row that is one named individual.
 *
 *  The reason a surface needs to say so: the carrier is counted ONCE, which is
 *  right (crediting each member the full contract value is the double-count), but
 *  a member firm can ALSO hold its own row — so a leaderboard understates a firm
 *  that competes mainly through consortia. Measured on the e-gov group
 *  (2026-08-19): А1 България shows €17.6M standalone, 5.2% and rank 6, against a
 *  real €59.0M / 17.5% / rank 2 once its three carrier positions are included. */
export const isConsortiumCarrierKey = (eik: string | undefined): boolean =>
  !!eik && eik.startsWith("obed-");
