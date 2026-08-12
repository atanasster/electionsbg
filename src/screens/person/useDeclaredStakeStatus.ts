// WHY a declared company stake is not linked to a Търговски регистър company, served via
// /api/db/person-declared-stake-status (096 person_declared_stake_status).
//
// The profile has always shown these under „Декларирани дялове (не в Търговския регистър)"
// as one undifferentiated list. That heading is true and reads as a single failure, when it
// is four different facts about the register — and the largest of them is not the one the
// heading names. Measured over the stake rows of active public figures (2026-08-12):
//
//   linked          2,434  15.9%
//   absent          6,124  40.1%   nothing in the register bears that name
//   unconfirmed     4,818  31.6%   a company of that name exists; the declared holder is
//                                  not recorded there
//   namesake /                     someone of that name IS recorded there, and gate C would
//   unverified      1,442   9.5%   not name a person on it — two different reasons, split
//                                  below, because 35.5% of them are `n = 0` and calling that
//                                  "the name is shared" claims something nothing supports
//   ambiguous         463   3.0%   several trading companies bear the name
//
// NOTHING HERE IS A LINK, and the payload is shaped so it cannot become one by accident:
// `candidates` carries EIKs only for `ambiguous`, where naming them all is honest and
// picking one is the defect. For `unconfirmed` and `namesake` it is empty on purpose — a
// single named company printed beside a person's name IS the assertion 096's gates declined
// to make, and the whole point of this hook is to explain a refusal, not to route around it.
//
// Keyed on the declarant's RAW declared string. The client matches it with its own
// normaliser applied to BOTH sides, so the SQL and TypeScript normalisers never have to
// agree — which is the failure a shared normalised key would invite.

import { useEffect, useState } from "react";

/** What 096 made of this declared name, for this holder. */
export type DeclaredStakeReason =
  /** Resolved to one EIK. Present here only for the family arm — see the note above. */
  | "linked"
  /** No trading company in the register bears the name at all. */
  | "absent"
  /** More than one does. `candidates` lists them; none is asserted. */
  | "ambiguous"
  /** Exactly one does, but the register does not record the declared holder there. */
  | "unconfirmed"
  /** It records someone of that name, and that name is shared by several people we hold. */
  | "namesake"
  /** It records someone of that name, and we hold no person by it — so there is nobody to
   *  identify them as. Distinct from `namesake`: absence is not ambiguity, and 096 refuses
   *  both under one gate (`n = 1`, never `n <= 1`) for two different reasons. */
  | "unverified";

/** One verdict per (declared name, declared holder) — NEVER per name alone. The same name can
 *  be refused for the filer and resolved through their spouse; collapsing the two publishes
 *  the refusal as the filer's link. */
export type DeclaredStakeStatus = {
  /** The declarant's own spelling, verbatim — half the join key. */
  declaredName: string;
  /** The other half, and the attribution: the raw holder the filing names, or null when it
   *  named none. Present for the declarant's own rows too — nulling those is what let an own
   *  row and a family row of the same company collide on one key. */
  holderName: string | null;
  /** Whether `holderName` is the filer themselves (a filing may spell out its own filer). */
  holderIsDeclarant: boolean;
  reason: DeclaredStakeReason;
  /** The resolved company, for `linked` only — null on every other reason, so a consumer
   *  cannot render an unconfirmed row as a link by reading a field that happens to be set. */
  eik: string | null;
  companyName: string | null;
  /** Populated for `ambiguous` only; empty for every other reason. */
  candidates: { eik: string; name: string | null }[];
};

export const useDeclaredStakeStatus = (
  slug: string | undefined,
): DeclaredStakeStatus[] | undefined => {
  const [rows, setRows] = useState<DeclaredStakeStatus[] | undefined>(
    undefined,
  );
  useEffect(() => {
    let live = true;
    setRows(undefined);
    if (!slug) {
      setRows([]);
      return;
    }
    fetch(
      `/api/db/person-declared-stake-status?slug=${encodeURIComponent(slug)}`,
    )
      .then((r) => r.json())
      .then((j: DeclaredStakeStatus[]) => {
        if (live) setRows(Array.isArray(j) ? j : []);
      })
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [slug]);
  return rows;
};
