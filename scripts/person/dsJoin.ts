// The ДС facet's ONE attachment rule,
// shared by resolve_persons.ts and its data gate so the gate tests the query that runs.
//
// An announcement in ds_announcement (migration 203) attaches to a parliament MP only
// when the MP's folded name AND exact birth date both match the Commission's own
// document, and only when that (name, birth date) pair names exactly ONE MP. Names on
// the manual hold list ($4) never attach. The first decision that ESTABLISHED the
// person is the one cited.
//
// Parameters come from dsMpParams() below: $1 int[] mp ids, $2 text[] names, $3
// text[] birth dates — parallel, from data/parliament/index.json — and $4 text[]
// held names.

export interface DsMpMatch {
  mp_id: number;
  name: string;
  decision_id: number;
  number: string | null;
  decision_date: string | null;
  title: string;
  quality_raw: string | null;
  office: string | null;
  pseudonyms: string | null;
}

export const DS_MP_JOIN_SQL = `WITH mp AS (
         SELECT u.id AS mp_id, u.name, translit_bg_latin(u.name) AS fold, u.bd::date AS bd
         FROM unnest($1::int[], $2::text[], $3::text[]) AS u(id, name, bd)
       ),
       -- a (name, birth date) pair two MPs share is not a key; refuse it outright
       unique_mp AS (
         SELECT fold, bd FROM mp GROUP BY 1, 2 HAVING count(*) = 1
       ),
       hit AS (
         SELECT DISTINCT ON (mp.mp_id) mp.mp_id, mp.name, d.decision_id, d.number,
                to_char(d.decision_date, 'YYYY-MM-DD') AS decision_date, d.title,
                a.quality_raw, a.office, a.pseudonyms
         FROM ds_announcement a
         JOIN unique_mp u ON u.fold = a.name_fold AND u.bd = a.birth_date
         JOIN mp ON mp.fold = u.fold AND mp.bd = u.bd
         JOIN ds_decision d ON d.decision_id = a.decision_id
         WHERE NOT (translit_bg_latin(mp.name) = ANY (
           SELECT translit_bg_latin(h) FROM unnest($4::text[]) h))
         -- the FIRST decision that established the person is the one cited
         ORDER BY mp.mp_id, (a.section = 'establish') DESC, d.decision_date, d.decision_id
       )
       SELECT * FROM hit ORDER BY mp_id`;

export interface RosterMp {
  id: number;
  name: string;
  birthDate: string | null;
}

/** index.json carries placeholder birth dates („0000-00-00"); only a real calendar
 *  date can be a disambiguator, and a placeholder would raise 22008 on the cast. */
const REAL_DATE =
  /^(?:18|19|20)\d\d-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

export const dsMpParams = (
  mps: RosterMp[],
  held: string[],
): [number[], string[], string[], string[]] => {
  const usable = mps.filter(
    (m): m is RosterMp & { birthDate: string } =>
      !!m.birthDate && REAL_DATE.test(m.birthDate),
  );
  return [
    usable.map((m) => m.id),
    usable.map((m) => m.name),
    usable.map((m) => m.birthDate),
    held,
  ];
};

/** The badge label from the decision's „Качество" cell, which is free text as
 *  printed: „; агент", „Информатор; резидент;", mixed case. Lower-cased, split on
 *  its separators, de-duplicated; NULL when the cell is empty, so the badge falls
 *  back to the office rather than printing nothing. */
export const dsCategoryLabel = (raw: string | null): string | null => {
  const parts = [
    ...new Set(
      (raw ?? "")
        .split(/[;,]/)
        .map((p) => p.trim().toLocaleLowerCase("bg"))
        .filter(Boolean),
    ),
  ];
  return parts.length ? parts.join(", ") : null;
};
