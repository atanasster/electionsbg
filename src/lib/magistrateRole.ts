// Infer a magistrate's ROLE (judge / prosecutor / investigator / SJC / inspectorate) from the
// institution named on their Court-of-Audit declaration. The explicit `position` field is filled
// for only ~1.6% of magistrates, but the institution (court / prosecutor's office / investigation
// service) is on ~87%, and its TYPE reliably implies the role — validated at 99.6% coverage over
// the 975 distinct institution names (the ~0.4% miss are source typos → fall back to the generic
// "magistrate" label).
//
// Order matters:
//   • the Supreme Judicial Council (ВСС) and its Inspectorate contain "съд" but aren't a court seat;
//   • an investigation office ("ОСлО при ОП…", "НСлС") sits UNDER a prosecutor's office, yet its
//     holder is an investigator, not a prosecutor — so both are matched before prosecution/court.

export type MagistrateRoleKey =
  | "mag_role_judge"
  | "mag_role_prosecutor"
  | "mag_role_investigator"
  | "mag_role_vss"
  | "mag_role_inspector";

export const magistrateRoleKey = (
  institution?: string | null,
): MagistrateRoleKey | null => {
  const s = (institution ?? "").toLowerCase().trim();
  if (!s) return null;
  // Inspectorate (към ВСС) before the ВСС check — its name contains "ВСС" but the seat differs.
  if (/инспекторат/.test(s)) return "mag_role_inspector";
  if (/висш съдебен съвет|(^|[^а-я])всс([^а-я]|$)/.test(s))
    return "mag_role_vss";
  // `sep` = the separators the source uses between an abbreviation and the town: space, dot,
  // hyphen, en-dash and em-dash (e.g. "РП–Сливен").
  if (
    /следствен|следстви|национална следствена|(^|[^а-я])(нслс|осло|осо)([^а-я]|$)|(^|[^а-я])со[\s–—-]/.test(
      s,
    )
  )
    return "mag_role_investigator";
  if (
    /прокуратур|прокурор|прокур|(^|[^а-я])(вкп|вап|оп|рп|сгп|воп|ап)([\s.–—-]|$)/.test(
      s,
    )
  )
    return "mag_role_prosecutor";
  if (
    /(^|[^а-я])съд([^а-я]|$)|съдия|(^|[^а-я])(вкс|вас|асс?г|сгс|срс|рс|ос|ас)([\s.–—-]|$)/.test(
      s,
    )
  )
    return "mag_role_judge";
  return null;
};
