// The two accountability cells on /persons — declared net worth, and public money won by
// the person's companies. Both are figures about a NAMED LIVING PERSON, which is why each
// carries its caveat in the cell rather than in a footnote nobody reads.
//
// docs/plans/persons-browser-v1.md §3 and §9 are the rules; this file implements them.

import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatEurCompact, formatEur } from "@/lib/currency";
import type { PersonBrowseRow } from "@/data/persons/personBrowseTypes";

/** Both money columns sit side by side, so their figures must align to the same grid. */
const CELL = "block whitespace-nowrap text-right text-sm tabular-nums";

/** An empty cell that still SAYS SOMETHING. An untitled dash is the failure §9 exists to
 *  prevent: two different facts (nothing on record vs. nothing of value) rendering
 *  identically, with the reader unable to tell which they are looking at. */
export const EmptyCell: FC<{ title?: string }> = ({ title }) => (
  <span
    className={`${CELL} cursor-default text-xs text-muted-foreground`}
    title={title}
    aria-label={title}
  >
    —
  </span>
);

/** A superscript caveat marker. `aria-label` + `role="img"` because the meaning lives in
 *  the `title`, which a keyboard or screen-reader user never reaches through hover alone —
 *  and the meaning here is the difference between a figure and an allegation. */
const Marker: FC<{ mark: string; label: string; className: string }> = ({
  mark,
  label,
  className,
}) => (
  <sup
    className={`ml-0.5 cursor-help ${className}`}
    title={label}
    aria-label={label}
    role="img"
    tabIndex={0}
  >
    {mark}
  </sup>
);

/** Coerce an amount that the wire may deliver as a STRING.
 *
 *  The schema is the real fix — `numeric` columns are serialized by node-postgres as
 *  "250000.00" and the money formatters return an empty string for them, so 120 declares
 *  these columns `double precision` and person_browse.data.test.ts asserts it. This is the
 *  second line of defence: a blank money cell is indistinguishable from "no data" to a
 *  reader, so the render path must not be the thing that depends on getting the column type
 *  right. Returns null for anything that is not a finite number. */
const num = (v: number | null | undefined): number | null => {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** €-formatted, with the SIGN OUTSIDE the currency symbol.
 *
 *  formatEurCompact builds `€${n}`, so a negative lands as "€-47 млн." — and 3,725 of the
 *  17,037 declared net worths (22%) are negative, because declared liabilities routinely
 *  exceed valued assets. A malformed minus on a fifth of a sortable column is not a
 *  cosmetic issue: one click on the header puts those rows at the top. */
const eur = (value: number, lang: string): ReactNode =>
  value < 0 ? (
    <>−{formatEurCompact(Math.abs(value), lang)}</>
  ) : (
    formatEurCompact(value, lang)
  );

/** Declared net worth.
 *
 *  THREE STATES THAT MUST NOT RENDER ALIKE (§9):
 *    a figure                        — the newest filing on record
 *    hasDeclaration && no figure     — filed, and declared nothing of value
 *    !hasDeclaration                 — nothing on record at all, which for a sitting
 *                                      official is arguably the more newsworthy fact
 *
 *  And the asterisk: `excludedAssetRows > 0` means 090 could not total an implausible
 *  declared row, so the figure shown is INCOMPLETE. Presenting a partial total as whole
 *  understates a person's wealth by an unknown amount; the matview already suppresses the
 *  year-on-year delta for the same reason. */
export const PersonNetWorthCell: FC<{ row: PersonBrowseRow }> = ({ row }) => {
  const { t, i18n } = useTranslation();
  const value = num(row.netWorthEur);

  if (value == null)
    return (
      <EmptyCell
        title={
          row.hasDeclaration
            ? t("persons_declared_nothing_tip", {
                defaultValue:
                  "Подадена декларация без декларирано имущество със стойност.",
              })
            : t("persons_no_declaration_tip", {
                defaultValue: "Няма декларация в регистъра.",
              })
        }
      />
    );

  const incomplete = (row.excludedAssetRows ?? 0) > 0;
  const negative = value < 0;
  const exact = formatEur(value, i18n.language);
  const negTip = t("persons_negative_net_tip", {
    defaultValue:
      "Декларираните задължения надвишават остойностеното имущество.",
  });

  return (
    <span className={CELL}>
      <span title={negative ? `${exact} — ${negTip}` : exact}>
        {eur(value, i18n.language)}
      </span>
      {incomplete ? (
        <Marker
          mark="*"
          className="text-amber-600 dark:text-amber-400"
          label={t("persons_incomplete_total_tip", {
            defaultValue:
              "Непълна сума: един или повече декларирани редове не могат да бъдат остойностени, затова истинската стойност е по-висока.",
          })}
        />
      ) : null}
    </span>
  );
};

/** Public money won by the companies this person is linked to in the Търговски регистър.
 *
 *  NOT "money this person received", and the caveat says so. Two separate cautions apply:
 *
 *  1. The figure is the COMPANY's contract total, not a personal income. It is also not
 *     additive down the column — two co-officers of one company each carry its full sum —
 *     which is why the footer counts rows and never sums this.
 *  2. HOW the person↔company link was established decides whether a namesake could be
 *     behind it. 'declared' means every contributing company came from a curated register
 *     (declared interests, ИВСС чл.175а); anything else — including 'mixed', where ONE
 *     company is curated and the others are not — was matched at least partly by NAME, and
 *     gets the site's existing namesake disclosure, the same words the person page uses. */
export const PersonMoneyCell: FC<{ row: PersonBrowseRow }> = ({ row }) => {
  const { t, i18n } = useTranslation();
  const money = num(row.publicMoneyEur);

  if (money == null)
    // Again two facts, not one: 9,633 people hold companies that won NOTHING, and ~46,100
    // hold no company at all. An untitled dash says both are the same.
    return (
      <EmptyCell
        title={
          (row.companiesN ?? 0) > 0
            ? t("persons_no_money_tip", {
                defaultValue:
                  "Свързаните фирми не са печелили обществени поръчки.",
              })
            : t("persons_no_companies_tip", {
                defaultValue: "Няма свързани фирми в Търговския регистър.",
              })
        }
      />
    );

  const nameMatched = row.trLinkBasis !== "declared";
  const base = t("persons_money_tip", {
    defaultValue:
      "Обща стойност на обществените поръчки, спечелени от фирмите, свързани с това лице — не е личен доход.",
  });
  const caveat = nameMatched
    ? `${base}\n\n${t("person_namesake_disclosure", {
        // The only string here that lives in another feature's key space. Without a
        // fallback, dropping or renaming it renders the literal key to the reader — on the
        // one tooltip whose whole job is to qualify a claim about a named person.
        defaultValue:
          "Лицата в Търговския регистър се идентифицират само по име, затова тези записи може да обединяват различни хора с еднакво име.",
      })}`
    : base;

  return (
    <span className={CELL} title={caveat}>
      <span
        className={
          nameMatched
            ? "cursor-help border-b border-dotted border-muted-foreground"
            : undefined
        }
      >
        {eur(money, i18n.language)}
      </span>
      {nameMatched ? (
        <Marker mark="?" className="text-muted-foreground" label={caveat} />
      ) : null}
    </span>
  );
};
