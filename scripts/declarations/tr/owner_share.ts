/**
 * Ownership percentage — the TypeScript twin of `tr_owner_share` (SQL migration 003).
 *
 * ⚠️ TWO IMPLEMENTATIONS OF ONE RULE, ON PURPOSE, AND THEY MUST AGREE. The serving
 * layer reads Postgres and cannot import TypeScript; the SQLite corpus is written
 * offline before Postgres is loaded and cannot call a Postgres function. So the rule
 * exists twice, and `scripts/db/tests/tr_owner_share.data.test.ts` compares the stored
 * value against the served one so the two cannot drift silently. Read 003's OWNERSHIP
 * SHARE header before changing anything here — it carries the measurements.
 *
 * THE RULE. A company's current cap table is its LATEST ACTIVE OWNER VINTAGE — the
 * records at `max(addedAt)` among non-erased partner/sole_owner rows — and each owner's
 * share is their amount over that vintage's total, normalised to EUR. `erasedAt === null`
 * does NOT mean current: the TR feed re-lists the whole partner set on every capital
 * change and never erases the prior vintage, so summing every non-erased record holds a
 * company's cap table once per filing it ever made. That was the defect: БИЛЯНА ООД
 * published 26% + 8% against a real 75.5% + 24.5%.
 *
 * THE REFUSALS, in precedence order. Each returns null rather than a number, because a
 * plausible wrong percentage is worse than a visible absence:
 *   1. A `sole_owner` that is the company's ONLY current owner is 100% by law, with or
 *      without a declared amount — evaluated FIRST and outranking everything below.
 *   2. Any owner in a multi-owner current set with no amount → no percentage for the
 *      whole company. Dropping just that row would inflate everyone else against a short
 *      denominator, which is the same defect wearing new clothes.
 *   3. An undated record in an otherwise-dated company: it cannot be placed in a vintage,
 *      so it is counted as missing rather than dropped (dropping inflates the survivors,
 *      invisibly — they still sum to 100%).
 *   4. ONE PERSON'S STAKE RESTATED IN BOTH лв AND EUR inside one vintage is a holding
 *      carried across the re-denomination, not two holdings. Summing them publishes a
 *      doubled position — the лв+EUR addition this rule exists to remove, one level down.
 *   5. A non-positive total.
 *
 * The grouping key is `nameNormalized`, where the SQL uses `name_fold`
 * (translit_bg_latin). They fold differently in principle — name_fold also collapses
 * hyphens — but measured 2026-08-20 across the whole corpus, ZERO current-vintage groups
 * disagree. The data test is what keeps that true.
 */

import { BGN_PER_EUR } from "../../../src/lib/currency";

/** EUR spellings the feed emits. Mirrors tr_share_eur's list in 003. */
const EUR_SPELLINGS = new Set(["EUR", "EURO", "ЕВРО", "€"]);
/** лв spellings. Anything outside BOTH sets is refused, never pegged. */
const BGN_SPELLINGS = new Set(["", "BGN", "BGL", "ЛВ", "ЛВ.", "ЛЕВА", "ЛЕВ"]);

const norm = (c: string | null | undefined): string =>
  (c ?? "").trim().toUpperCase();

export const isEurCurrency = (c: string | null | undefined): boolean =>
  EUR_SPELLINGS.has(norm(c));

/**
 * лв → EUR at the locked peg. The TS twin of `tr_share_eur`.
 *
 * A blank/NULL currency means лв — pre-2026 filings carry no currency cell at all. An
 * UNRECOGNISED spelling returns null rather than being pegged: a USD amount divided by
 * 1.95583 is a wrong percentage indistinguishable from a right one.
 */
export const shareEur = (
  amount: number | null | undefined,
  currency: string | null | undefined,
): number | null => {
  if (amount == null || !Number.isFinite(amount)) return null;
  if (isEurCurrency(currency)) return amount;
  if (!BGN_SPELLINGS.has(norm(currency))) return null;
  return amount / BGN_PER_EUR;
};

/** One owner record, as the rule needs to see it. */
export type OwnerRecord = {
  /** Caller's own identifier for the record; keys the returned map. */
  key: string;
  /** The raw registry name — read only to spot the deleted-fact placeholder. */
  name?: string | null;
  nameNormalized: string;
  role: string;
  addedAt: string | null;
  erasedAt: string | null;
  shareAmount: number | null;
  shareCurrency: string | null;
};

const isOwnerRole = (role: string): boolean =>
  role === "partner" || role === "sole_owner";

/**
 * „Заличено обстоятелство." is the register's DELETED-FACT PLACEHOLDER, not a person.
 * 4,356 owner rows carry it and not one has a share_amount, so counting it as an owner
 * refuses 4,299 companies whose lone sole owner really is the only owner — and it makes
 * a two-owner company out of a one-owner one for the lone-sole_owner guard.
 *
 * ⚠️ The SQL view applies the SAME exclusion. Changing it on one side only makes the two
 * implementations disagree about who the owners are, which is a worse defect than the
 * one it fixes.
 */
export const isDeletedFactPlaceholder = (
  name: string | null | undefined,
): boolean => /^\s*заличено обстоятелство/i.test(name ?? "");

/**
 * A record that names NOBODY, and so cannot be an owner: blank, or the deleted-fact
 * placeholder.
 *
 * ⚠️ The blank half exists to match what Postgres actually SEES. `load_tr_pg.ts` loads
 * `WHERE name IS NOT NULL AND name <> ''`, so a nameless row never reaches
 * tr_person_roles and the view cannot count it — while this side reads state.sqlite,
 * where it is present. The CR projection emits such rows (an owner field the deed leaves
 * empty), and counting one made a two-owner company out of a one-owner one: three lone
 * sole owners were refused their correct 100% because a nameless partner sat beside them.
 * Two implementations of one rule have to read the same row set, not just apply the same
 * arithmetic.
 */
const namesNobody = (name: string | null | undefined): boolean => {
  const n = (name ?? "").trim();
  return n === "" || isDeletedFactPlaceholder(n);
};

/** Match SQL `round(x, 4)` closely enough for the data test's tolerance. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/**
 * The percentage each record should carry, keyed by `record.key`.
 *
 * Every record passed in gets an entry, so a caller can write the result straight back:
 * non-owners, erased records and records outside the current vintage map to null.
 */
export const ownerSharePercents = (
  records: readonly OwnerRecord[],
): Map<string, number | null> => {
  const out = new Map<string, number | null>();
  for (const r of records) out.set(r.key, null);

  const owners = records.filter(
    (r) =>
      r.erasedAt === null &&
      isOwnerRole(r.role) &&
      !namesNobody(r.name ?? r.nameNormalized),
  );
  if (owners.length === 0) return out;

  // The vintage. max() over the non-null dates only — a company that files no dates at
  // all has latestAt null and every record is current.
  let latestAt: string | null = null;
  for (const r of owners)
    if (r.addedAt !== null && (latestAt === null || r.addedAt > latestAt))
      latestAt = r.addedAt;

  const current = owners.filter(
    (r) => latestAt === null || r.addedAt === latestAt || r.addedAt === null,
  );

  type Group = {
    keys: string[];
    role: string;
    eur: number;
    missing: boolean;
    currencies: Set<boolean>;
  };
  const groups = new Map<string, Group>();
  for (const r of current) {
    const gk = `${r.nameNormalized}\u0000${r.role}`;
    let g = groups.get(gk);
    if (!g) {
      g = {
        keys: [],
        role: r.role,
        eur: 0,
        missing: false,
        currencies: new Set(),
      };
      groups.set(gk, g);
    }
    g.keys.push(r.key);
    const eur = shareEur(r.shareAmount, r.shareCurrency);
    if (eur === null) g.missing = true;
    else {
      g.eur += eur;
      g.currencies.add(isEurCurrency(r.shareCurrency));
    }
    // Refusal 3: undated inside a dated company — cannot be placed in a vintage.
    if (r.addedAt === null && latestAt !== null) g.missing = true;
    // Refusal 4: the same stake restated across the re-denomination.
    if (g.currencies.size > 1) g.missing = true;
  }

  const list = [...groups.values()];
  const anyMissing = list.some((g) => g.missing);
  const total = list.reduce((a, g) => a + g.eur, 0);

  for (const g of list) {
    // Refusal 1 outranks the rest: a lone current sole_owner is 100% by law.
    if (g.role === "sole_owner" && list.length === 1) {
      for (const k of g.keys) out.set(k, 100);
      continue;
    }
    const pct =
      anyMissing || !Number.isFinite(total) || total <= 0
        ? null
        : round4((100 * g.eur) / total);
    for (const k of g.keys) out.set(k, pct);
  }
  return out;
};
