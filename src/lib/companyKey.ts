// Which supplier keys have a `/company/:eik` page, and which are dead ends.
//
// `contracts.contractor_eik` is NOT always a Bulgarian EIK. Three other kinds of
// token live in that column. Measured 2026-08-19 over every distinct contractor
// key — ⚠ BOTH COLUMNS AT `tag = 'contract'`, because the € differ by 6.9% across
// that filter (the plain bucket is €92.24bn over all tags) and a table mixing the
// two bases is the `tag`-blindness trap CLAUDE.md's same-feed-dedup note is about:
//
//   plain 9/13-digit EIK    27,531 keys   €86.30bn
//   `obed-` carriers         1,626 keys   €6.21bn
//   `ph-` / `np-`              177 keys   €87.3m
//   neither                    281 keys   €857.5m  (137 with letters, 144
//                                                   numeric odd-length)
//   the EMPTY string             1 key    €210.0m  (623 rows — see below)
//
// Unscoped, the first row is 27,553 keys and the fourth 282 (145 numeric); the
// two synthetic rows are identical either way.
//
// The empty string is a key in the SQL sense and in no other: it names no supplier,
// so those rows render as text like the rest of the bottom three buckets. It is
// listed because leaving it out under-reported the non-linkable money by a fifth
// (€857.5m against a real €1,067.6m).
//
// The synthetic namespaces are minted deliberately, each because the source id
// could not become a key (see scripts/procurement/supplier_identity.ts):
//   · `obed-` (1,626) — a consortium carrier, not one legal entity
//   · `ph-`   (91)    — the supplier's registration number was FILLER
//   · `np-`   (86)    — a natural person, keyed by name so no ЕГН is stored
//
// ⚠ „NONE OF THEM HAS A PAGE" WAS TRUE ONCE AND IS NOT TRUE NOW. This file's
// first cut (2026-08-19) said `institution_identity()` returns NULL for all 2,085
// so the page renders „Няма фирма с ЕИК … в базата.". The first half is still
// right and the second stopped being right on **2026-07-06** (8c8b9a9654,
// „render procurement body for corpus-only entities") — six weeks before this
// file was written. `/company/:eik` now falls back to a procurement-only body,
// and its dead-end branch fires only on
//
//     !company && !institution && !hasProcurement
//         — src/screens/dev/CompanyDbScreen.tsx (yes, `dev/`; it serves /company)
//
// where `hasProcurement = contracts > 0 || hadAwarder`. A key drawn out of
// `contracts.contractor_eik` has contracts by construction, so it can never reach
// that branch. Re-check it with that one grep before tightening anything here.
//
// So the rule is no longer „can the page serve this" — the page serves all of
// them. It is „is this key worth promising a page for", and the three namespaces
// answer differently:
//
// **`obed-` is IN.** Its page is the richest of the four kinds: name, an explicit
// „Няма запис от Търговския регистър…" notice, the scoped procurement history,
// top contracts, top awarders, CPV rank, geography — and a „Обединение —
// участници" block naming each member firm, which no other key kind has. Measured
// on /sector/security at the current parliament, the sector's two biggest
// contracts (€15.3m + €5.1m, 38.5% of the window) are held by one carrier; with
// it de-linked a reader had no route from the number to the three firms behind it.
//
// **`ph-`, `np-` and the 282 odd ids are OUT.** Their pages render too, but a
// `ph-` key stands for a registration number the buyer made up (several show €0),
// an `np-` key is one natural person, and neither is an identifier a reader can
// check against any register. A link promises somewhere to go; these are a name
// with a hash after it.
//
// ⚠ A PLAIN EIK IS ALWAYS LINKABLE, even when it is absent from `tr_companies`.
// That is deliberate and the boundary is measured, not assumed: 8,850 plain EIKs
// have no registry row, yet 297 of them still resolve through
// `institution_identity` (which is built from contracts and funds, not the
// registry). Narrowing the rule to "has a tr_companies row" would delete 297
// working links, and for the rest the EIK is a real, checkable identifier.
//
// Same reasoning as AwarderLink: the rule lives in ONE place because ~20 call
// sites kept re-deriving it, and every one of them got it wrong the same way.

/** A CONSORTIUM carrier key — the `obed-` namespace `supplier_identity.ts` mints
 *  when an award names an обединение rather than one legal entity, keyed by the
 *  member set.
 *
 *  ⚠ DELIBERATELY NOT `!isLinkableCompanyKey(eik)`, and since 2026-08-19 not even
 *  its complement: a carrier IS linkable. That predicate answers „should this key
 *  promise a page", which is also false for `ph-` (filler registration number) and
 *  `np-` (natural person) keys, and for foreign registry ids. Those are different
 *  statements about a supplier and only this one means „this row is several
 *  firms". Deriving one from the other would put a note about consortia under a
 *  row that is one named individual.
 *
 *  The reason a surface needs to say so: the carrier is counted ONCE, which is
 *  right (crediting each member the full contract value is the double-count), but
 *  a member firm can ALSO hold its own row — so a leaderboard understates a firm
 *  that competes mainly through consortia. Measured on the e-gov group
 *  (2026-08-19): А1 България shows €17.6M standalone, 5.2% and rank 6, against a
 *  real €59.0M / 17.5% / rank 2 once its three carrier positions are included.
 *
 *  ⚠ IT DOES NOT CATCH EVERY CONSORTIUM, and a caller must not caption it as if
 *  it did. A consortium reaches the corpus in TWO forms — this synthetic carrier,
 *  and a REGISTERED ДЗЗД holding its own 9-digit EIK, which is indistinguishable
 *  from an ordinary company by key alone. Measured on the e-gov group: 14 rows
 *  are `consortium_role = 'carrier'`, only 11 of them `obed-`, and one of the
 *  three registered ones is Консорциум СисТел ДЗЗД at €31.5M — the group's
 *  SECOND-largest contractor. Closing the gap means projecting `consortium_role`
 *  out of `061_awarder_group_model.sql`'s sup CTE (it is read in `base` and
 *  dropped) into `AwarderModel`, so the client can stop inferring from the key.
 *  `sector_stats_administration.data.test.ts` keeps the blind spot measured.
 *
 *  ⚠ TS/SQL TWIN: that data test restates this rule as `LIKE 'obed-%'`, because
 *  SQL cannot import it. Change the two together. */
export const isConsortiumCarrierKey = (eik: string | undefined): boolean =>
  !!eik && eik.startsWith("obed-");

/** A supplier key worth linking to `/company/:eik` — a bare Bulgarian EIK in its
 *  9-digit (legal entity) or 13-digit (branch) form, or an `obed-` consortium
 *  carrier. Everything else (`ph-`, `np-`, foreign registry ids, malformed keys)
 *  renders as plain text: the page would load, but the key names nothing a reader
 *  can look up. See the header for the measurement behind that split. */
export const isLinkableCompanyKey = (eik: string | undefined): boolean =>
  !!eik && (/^(\d{9}|\d{13})$/.test(eik) || isConsortiumCarrierKey(eik));

/** Is this SUPPLIER ROW a consortium — several firms that won together?
 *
 *  The one predicate a surface should use, because it composes the two things
 *  that answer the question and neither does alone:
 *
 *   1. `consortiumEur` (061 → `AwarderSupplier`) — authoritative, and the only
 *      thing that sees a REGISTERED ДЗЗД, which carries an ordinary 9-digit EIK.
 *      That is 1,344 of 4,014 carrier rows and €5.63bn, 47.5% of all consortium
 *      money, so key-sniffing alone misses about half the subject.
 *   2. `isConsortiumCarrierKey` — the fallback when `consortiumEur` is `null`.
 *
 *  ⚠ THE FALLBACK IS LOAD-BEARING, NOT DEFENSIVE PADDING. `null` means „this
 *  producer could not tell" — a serving database whose 061 predates the
 *  projection, which is every database between a hosting deploy and the
 *  `apply_functions` that follows it. Treating `null` as „not a consortium"
 *  would make the note vanish site-wide for that window; the prefix still
 *  answers correctly for the `obed-` half and stays silent for the rest, so the
 *  degrade is to the PREVIOUS behaviour rather than to nothing.
 *
 *  ⚠ `consortiumEur === 0` IS AN ANSWER and must not fall through to the key —
 *  `!= null` rather than a truthiness check. 0 means „won nothing jointly", and
 *  it is the common case (27,247 of 29,615 suppliers). */
export const isConsortiumSupplier = (s: {
  eik: string;
  consortiumEur?: number | null;
}): boolean =>
  s.consortiumEur != null ? s.consortiumEur > 0 : isConsortiumCarrierKey(s.eik);
