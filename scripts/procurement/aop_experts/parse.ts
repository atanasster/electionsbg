// Parser for one competence-area page of the АОП external-experts register.
//
// The page is a 1990s PHP script: the search FORM and the RESULT table are both
// plain <table>s in one document, with no id, class or wrapper separating them.
// Two consequences shape everything here.
//
// ⚠️ ANCHOR ON THE ROW, NEVER ON THE TABLE. The form's own rows are (label, input)
// pairs that parse as perfectly good two-cell rows, so „take the last table" and
// „take rows after </form>" are both one layout tweak away from silently ingesting
// „Име:" as an expert. A result row is identified by its FIRST CELL matching the
// register's own expert-number format (ЕТС-<digits>) — a shape no form label has.
//
// ⚠️ THE DECLARED TOTAL IS THE COMPLETENESS GATE, and it is the only one available.
// The page prints „Общ брой: N" beneath the rows. If N disagrees with what we
// parsed, the parse is wrong or the register paginated — either way the answer is
// incomplete, and an incomplete answer here is indistinguishable from a small
// competence area. So it throws rather than returning what it happened to find.

import { AOP_EXPERT_AREAS } from "./sources";

export interface ExpertRow {
  /** The register's own identifier, e.g. „ЕТС-49". Unique across the register. */
  une: string;
  /** As printed — given + family. The register does not publish a patronymic
   *  (its own form marks Презиме as „за служебни цели"), so this is TWO names
   *  where the person layer holds three. See the loader for what that costs. */
  name: string;
  /** ISO. Дата на включване в списъка. */
  validFrom: string | null;
  /** ISO. Срок на валидност — in this corpus ALWAYS in the past. */
  validUntil: string | null;
  /** The competence area as the register labels it, e.g. „39. Право". */
  area: string;
  /** The numeric area this row was found under. */
  areaNo: number;
}

export interface AreaPage {
  rows: ExpertRow[];
  /** „Общ брой: N" as printed. */
  declaredTotal: number;
}

const CELL_RE = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
const ROW_RE = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
/** ЕТС-<digits>, and nothing else in the cell. */
const UNE_RE = /^ЕТС-\d+$/u;
/** dd.mm.yyyy, optionally followed by the Bulgarian „г." year marker. */
const DATE_RE = /^(\d{2})\.(\d{2})\.(\d{4})\s*(?:г\.?)?$/u;

const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

/** dd.mm.yyyy → ISO, or null. Deliberately strict: a date we cannot read must not
 *  become „no expiry", which is what a lenient parse of an unexpected format would
 *  produce on a register whose whole point is that everything has expired. */
export const parseBgDate = (raw: string): string | null => {
  const m = DATE_RE.exec(raw.trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  const iso = `${y}-${mo}-${d}`;
  // Reject impossible dates rather than letting Date roll them over (31.02 → 03-03).
  const dt = new Date(`${iso}T00:00:00Z`);
  return dt.getUTCFullYear() === Number(y) &&
    dt.getUTCMonth() + 1 === Number(mo) &&
    dt.getUTCDate() === Number(d)
    ? iso
    : null;
};

const cells = (row: string): string[] => {
  const out: string[] = [];
  CELL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CELL_RE.exec(row)) !== null) out.push(text(m[1]));
  return out;
};

export const parseAreaPage = (html: string, areaNo: number): AreaPage => {
  if (!AOP_EXPERT_AREAS.includes(areaNo))
    throw new Error(`parseAreaPage: unknown competence area ${areaNo}`);

  const rows: ExpertRow[] = [];
  let declaredTotal: number | null = null;

  ROW_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ROW_RE.exec(html)) !== null) {
    const cs = cells(m[1]);
    if (cs.length === 0) continue;

    const totalM = /^Общ\s+брой:\s*(\d+)$/u.exec(cs[0]);
    if (totalM) {
      declaredTotal = Number(totalM[1]);
      continue;
    }
    if (cs.length < 5 || !UNE_RE.test(cs[0])) continue;

    rows.push({
      une: cs[0],
      name: cs[1],
      validFrom: parseBgDate(cs[2]),
      validUntil: parseBgDate(cs[3]),
      area: cs[4],
      areaNo,
    });
  }

  if (declaredTotal === null)
    throw new Error(
      `parseAreaPage(${areaNo}): no „Общ брой“ on the page — the register's own ` +
        `count is the only completeness check available, so a page without it ` +
        `cannot be trusted to be a complete result set`,
    );
  if (declaredTotal !== rows.length)
    throw new Error(
      `parseAreaPage(${areaNo}): register declares ${declaredTotal} expert(s), ` +
        `parsed ${rows.length} — the result is paginated or the layout moved. ` +
        `A partial area is indistinguishable from a small one, so this refuses.`,
    );
  return { rows, declaredTotal };
};

export interface ExpertArea {
  areaNo: number;
  area: string;
  validFrom: string | null;
  validUntil: string | null;
}
export interface FoldedExpert {
  une: string;
  name: string;
  areas: ExpertArea[];
  /** The union of the per-area windows — earliest admission, latest expiry.
   *  DERIVED, and kept here only so a consumer never has to re-derive it wrongly. */
  validFrom: string | null;
  validUntil: string | null;
}

/** Fold the per-area pages into the register. An expert holding several areas is
 *  ONE person with several areas — never several experts.
 *
 *  ⚠️ VALIDITY BELONGS TO THE (EXPERT, AREA) PAIR, NOT TO THE EXPERT. An expert
 *  admitted to a second competence area later carries a DIFFERENT window there:
 *  measured 2026-08-20, 4 of 88 do (e.g. ЕТС-49 Анна Савова is 2019→2022 in one
 *  area and 2020→2023 in another). An earlier cut of this function stored one
 *  scalar pair per expert and kept whichever area happened to be visited first —
 *  which silently published one of two true answers, chosen by loop order. The
 *  watcher's (УНЕ, validity) fingerprint is what exposed it: 92 pairs, 88 experts.
 *
 *  The expert-level window is therefore the UNION and is labelled as derived. */
export const foldExperts = (pages: readonly AreaPage[]): FoldedExpert[] => {
  const by = new Map<string, FoldedExpert>();
  for (const p of pages)
    for (const r of p.rows) {
      let cur = by.get(r.une);
      if (!cur) {
        cur = {
          une: r.une,
          name: r.name,
          areas: [],
          validFrom: null,
          validUntil: null,
        };
        by.set(r.une, cur);
      }
      if (!cur.areas.some((a) => a.areaNo === r.areaNo))
        cur.areas.push({
          areaNo: r.areaNo,
          area: r.area,
          validFrom: r.validFrom,
          validUntil: r.validUntil,
        });
    }
  for (const e of by.values()) {
    e.areas.sort((a, b) => a.areaNo - b.areaNo);
    const froms = e.areas.map((a) => a.validFrom).filter(Boolean) as string[];
    const untils = e.areas.map((a) => a.validUntil).filter(Boolean) as string[];
    e.validFrom = froms.length ? froms.slice().sort()[0] : null;
    e.validUntil = untils.length ? untils.slice().sort().at(-1)! : null;
  }
  return [...by.values()].sort((a, b) => a.une.localeCompare(b.une, "bg"));
};
