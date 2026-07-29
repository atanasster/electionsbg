// The "group" a person belongs to, for the /persons group filter and (in T2) the
// "Тип лице" mix bar.
//
// THESE ARE THE MEMBERSHIP FLAGS, NOT `primary_facet`. The distinction is the whole point:
//
//   `primary_facet` is the facet of the person's HIGHEST-prominence role, so it takes only
//   five values in practice (politician / executive / public_sector / magistrate /
//   regulator). It structurally CANNOT be 'company', 'ngo' or 'donor' — those sources score
//   10/20/5, below every office, so they never win the representative slot, and a person
//   whose ONLY role is one of them fails the §6 public-figure gate anyway. Filtering on it
//   would make 10,703 company-linked and 5,078 NGO-linked people unreachable — including
//   the browser's own headline use case, "a councillor who also runs a company".
//
//   The flags are true membership tests, computed with bool_or over every role, so a person
//   is correctly in several groups at once. That also makes their facet counts EXACT: the
//   column the dropdown counts is the column the filter applies.
//
// The vocabulary matches the plan's mix-bar list (§8) rather than person_source.facet.

/** URL value ⇄ registry column. The URL keeps the short name (`?facet=company`) so a link
 *  stays readable and stable even if the column is ever renamed. */
export interface PersonGroup {
  /** The `?facet` URL value. */
  key: string;
  /** The boolean column in person_browse_table / the `persons` registry resource. */
  column: string;
  /** i18n key for the label. */
  labelKey: string;
  /** Fallback label if the key is missing (also the English source of truth). */
  labelBg: string;
}

export const PERSON_GROUPS: readonly PersonGroup[] = [
  {
    key: "mp",
    column: "is_mp",
    labelKey: "persons_group_mp",
    labelBg: "Народни представители",
  },
  {
    key: "exec",
    column: "is_exec",
    labelKey: "persons_group_exec",
    labelBg: "Изпълнителна власт",
  },
  {
    key: "muni",
    column: "is_muni",
    labelKey: "persons_group_muni",
    labelBg: "Общинска администрация",
  },
  {
    key: "magistrate",
    column: "is_magistrate",
    labelKey: "persons_group_magistrate",
    labelBg: "Магистрати",
  },
  {
    key: "candidate",
    column: "is_candidate",
    labelKey: "persons_group_candidate",
    labelBg: "Кандидати",
  },
  {
    key: "ngo",
    column: "is_ngo",
    labelKey: "persons_group_ngo",
    labelBg: "ЮЛНЦ",
  },
  {
    key: "company",
    column: "is_company",
    labelKey: "persons_group_company",
    labelBg: "Бизнес",
  },
  {
    key: "donor",
    column: "is_donor",
    labelKey: "persons_group_donor",
    labelBg: "Дарители",
  },
] as const;

export const GROUP_COLUMNS: readonly string[] = PERSON_GROUPS.map(
  (g) => g.column,
);

export const groupByKey = (key: string): PersonGroup | undefined =>
  PERSON_GROUPS.find((g) => g.key === key);
