// Fold a person's registry roles into ONE row per company.
//
// ⚠️ THIS IS A CORRECTNESS FIX, NOT A LAYOUT CHANGE, and the reason is easy to miss.
// `person_roles` (008) returns one row per (company, role) — `DISTINCT ON (r.uic, r.role)`
// — and `contracts_eur` on each of those rows is a PER-COMPANY figure:
//
//     (SELECT coalesce(sum(k.amount_eur), 0) FROM contracts k
//        WHERE k.contractor_eik = d.uic AND k.tag = 'contract')
//
// It is the company's procurement total, repeated on every role row that company produces.
// So a person who is both съдружник and управител of one firm gets two rows carrying the
// same euros — and the page used to print them in two separate tables („Собственост" and
// „Управление"), where a reader reading down the Стойност column counts that money twice
// with nothing indicating it is one company.
//
// That is not a rare shape. Measured 2026-08-25 over `tr_person_roles`: **393,411
// (person, company) pairs across 293,040 people** hold both an ownership and a management
// role — the ordinary ЕООД arrangement, where the sole owner is also the manager. The
// page's own „Фирми в портфейла" stat card was already right — `summary` in
// PersonScreen.tsx counts `new Set(roles.map(r => r.uic))` — so the two tables disagreed
// with the card above them. That `summary.companies === participations.length` is now a
// load-bearing invariant: it is what lets „Участия (N)" be re-based on companies without
// contradicting that card, and PersonScreen.test.tsx pins the two together.
//
// Folding by `uic` prints each company once, with every role it carries as a tag. The
// value is then unambiguous, and „what is this person to ИНВЕНТИКС" is answered in one
// place instead of by scanning two tables.

import { trRoleLabel } from "@/lib/trRole";
import { formatOwnerShare } from "@/lib/ownerShare";

/** Ownership roles, as opposed to management — the ONE definition.
 *
 *  Exported because three things on the person page read it and a drift would split
 *  ownership from management inconsistently within one view: this module's tag ORDER,
 *  the tag COLOUR in PersonScreen, and its „владее N · управлява M" summary. It lives
 *  HERE rather than in the screen because the dependency already runs this way —
 *  PersonScreen imports the fold — so there is no cycle to avoid. */
/*  `sole_trader` is on the OWNERSHIP side deliberately. An ЕТ and its trader are ONE legal
 *  subject, so the person owns the enterprise entirely — they simply hold no дял, because
 *  there is no капитал to hold one of. That is why `tr_owner_share` (003) refuses them a
 *  percentage while this set admits them: `formatOwnerShare` then renders the role with no
 *  figure, which is the honest output. Counting them under „управлява" instead would tell a
 *  reader that somebody MANAGES a firm they are. See TrRole in scripts/declarations/tr/types.ts. */
export const OWNS = new Set([
  "sole_owner",
  "partner",
  "actual_owner",
  "sole_trader",
]);

export interface ParticipationRole {
  uic: string;
  company: string | null;
  status: string | null;
  role: string | null;
  share: string | number | null;
  added_at: string | null;
  erased_at: string | null;
  active: boolean;
  /** ⚠️ Accepted from `person_roles` and deliberately NOT folded onto the row. It is the
   *  company's contract COUNT — and it does not share a basis with `contracts_eur` beside
   *  it: 008 filters the sum on `k.tag = 'contract'` and leaves the count unfiltered, so
   *  the count includes amendments and awards the money does not. Folding it the same way
   *  would put an all-tags count next to a contract-only sum in one row. */
  contracts: string;
  contracts_eur: number;
}

export interface ParticipationRow {
  uic: string;
  company: string | null;
  status: string | null;
  /** Every role this person holds at this company, ownership first.
   *
   *  ⚠️ `active` / `erasedAt` are PER ROLE and must be rendered, not just modelled. The
   *  row-level `active` below is an OR, so a company where the ownership ended but the
   *  management continues reads „активен" — correctly, the person is still there — and
   *  without a per-tag marker the ended съдружник tag is drawn identically to a live one.
   *  That overstates a named individual's current holding, which is the one direction
   *  this repo treats as unrecoverable (see `formatOwnerShare`'s header for the same
   *  lesson one layer down). Measured 2026-08-25: 58,771 (person, company) pairs over
   *  47,876 people mix an ended and a live role at one company — e.g. Ради Димитров
   *  Бодуров at ТЪРГОВИЯ-К (000222314), partner ended 2021-09-02, manager active. The
   *  old two-table split showed „бивш · 2021-09-02" correctly. */
  roles: {
    role: string | null;
    share: string | number | null;
    active: boolean;
    erasedAt: string | null;
  }[];
  /** True when ANY role here is current. A former partner who is still the manager is
   *  not a former participation, so the row must not be dimmed. */
  active: boolean;
  /** Earliest start across the company's roles — when this person's involvement began.
   *  The LATEST would answer "when did their current title start", which is a narrower
   *  question and reads as a shorter relationship than the reader is entitled to see. */
  addedAt: string | null;
  /** Latest end, and only meaningful when `active` is false. */
  erasedAt: string | null;
  /** The COMPANY's procurement total — carried once, which is the point of this module. */
  contractsEur: number;
  /** True when this company contributed more than one role row, i.e. this fold actually
   *  removed a duplicate. Lets a caller show the merge rather than hiding it. */
  merged: boolean;
}

const max = (a: string | null, b: string | null): string | null =>
  !a ? b : !b ? a : a > b ? a : b;
const min = (a: string | null, b: string | null): string | null =>
  !a ? b : !b ? a : a < b ? a : b;

/** One row per company, preserving `person_roles`' own ordering.
 *
 *  Order is taken from FIRST APPEARANCE rather than re-sorted, so the SQL's
 *  `ORDER BY active DESC, added_at DESC NULLS LAST, company` still decides what a reader
 *  sees first — current participations, then most recent. Re-sorting here would put this
 *  module in the business of deciding an order the query already decided, and the two
 *  would drift. */
export const foldParticipations = (
  roles: ParticipationRole[],
): ParticipationRow[] => {
  const byUic = new Map<string, ParticipationRow>();
  for (const r of roles) {
    const found = byUic.get(r.uic);
    if (!found) {
      byUic.set(r.uic, {
        uic: r.uic,
        company: r.company,
        status: r.status,
        roles: [
          {
            role: r.role,
            share: r.share,
            active: r.active,
            erasedAt: r.erased_at,
          },
        ],
        active: r.active,
        addedAt: r.added_at,
        erasedAt: r.erased_at,
        contractsEur: r.contracts_eur ?? 0,
        merged: false,
      });
      continue;
    }
    found.roles.push({
      role: r.role,
      share: r.share,
      active: r.active,
      erasedAt: r.erased_at,
    });
    found.merged = true;
    found.active = found.active || r.active;
    found.addedAt = min(found.addedAt, r.added_at);
    found.erasedAt = max(found.erasedAt, r.erased_at);
    // NOT `+=`. Every row of one company carries that company's whole total, so summing
    // is precisely the double-count this fold exists to remove. Taking the max rather
    // than trusting them to be equal keeps a stale or partial row from zeroing the cell.
    found.contractsEur = Math.max(found.contractsEur, r.contracts_eur ?? 0);
    // A company name or status is NULL only when tr_companies has no row; keep whichever
    // arm carried one rather than letting row order decide.
    found.company = found.company ?? r.company;
    found.status = found.status ?? r.status;
  }
  return [...byUic.values()].map((row) => ({
    ...row,
    // Ownership first, so „съдружник 16% · управител" reads as the stronger claim first;
    // stable within each group, so two managers keep query order.
    roles: row.roles
      .map((x, i) => ({ x, i }))
      .sort(
        (a, b) =>
          Number(OWNS.has(b.x.role ?? "")) - Number(OWNS.has(a.x.role ?? "")) ||
          a.i - b.i,
      )
      .map(({ x }) => x),
  }));
};

/** A role rendered as its tag text — „съдружник 16%" or just „управител".
 *
 *  The share rides WITH the role rather than in its own column because it only applies to
 *  ownership: as a column it is empty on every management row, which is most of them.
 *  `formatOwnerShare` returns "—" for a share we cannot express as a fraction of current
 *  capital (tr_owner_share's documented NULL), and appending that to a role would read as
 *  a missing value rather than an inapplicable one — so it is dropped instead. */
export const participationTag = (
  role: { role: string | null; share: string | number | null },
  // The same loose signature `trRoleLabel` takes, not i18next's branded `TFunction`.
  // This function does nothing with `t` except hand it straight on, so demanding the
  // branded type would only make it untestable without a full i18next instance.
  t: (k: string) => string,
): string => {
  const label = trRoleLabel(role.role, t);
  if (!OWNS.has(role.role ?? "")) return label;
  const share = formatOwnerShare(role.share);
  return share && share !== "—" ? `${label} ${share}` : label;
};
