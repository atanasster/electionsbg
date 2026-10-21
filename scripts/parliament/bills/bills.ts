// parliament.bg bills — the undocumented JSON API behind /bg/bills.
//
//   POST /api/v1/fn-bills   the list; ⚠️ only the CURRENT assembly is reachable. The page's own
//                           filter object carries `A_ns_id`, but any value (even the current
//                           assembly's 62) makes the server answer HTTP 500 with an HTML error
//                           page, and a date window outside the current assembly returns []
//                           (measured 2026-10-21). Older assemblies are reachable only by id.
//   GET  /api/v1/bill/{id}  one bill: signature, title, ДВ promulgation (`L_Act_dv_iss` /
//                           `L_Act_dv_year`), veto, withdrawal, merged bills (`union_list`).
//
// There is no single outcome field: a bill is PROMULGATED when `L_Act_dv_iss` is set, and
// nothing here says anything about a bill without it (pending, rejected and withdrawn look
// alike until their own fields say otherwise).

export const PARLIAMENT_API = "https://www.parliament.bg/api/v1";

export interface BillListItem {
  id: number;
  sign: string;
  title: string;
  date: string;
}

export interface BillDetail extends BillListItem {
  /** The assembly folder number, e.g. "52". */
  ns: string;
  /** ДВ issue number when promulgated, else null. */
  dvIssue: string | null;
  dvYear: number | null;
  /** `L_Act_date2`: the day the plenary ADOPTED it (its second reading). Measured on the
   *  promulgated bills of the 52nd: it equals the day of their „зала второ гласуване" record. */
  adoptedOn: string | null;
  /** `L_ActL_final`: the adopted law's own title, „Закон за …". */
  finalTitle: string | null;
  withdrawn: boolean;
  vetoDate: string | null;
  /** Ids of the bills merged with this one for second reading. */
  unionIds: number[];
}

const str = (v: unknown): string => (v == null ? "" : String(v).trim());
const isoDay = (v: unknown): string => {
  const s = str(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !s.startsWith("0000") &&
    !s.startsWith("0001")
    ? s
    : "";
};

/** The list response → items. Throws on anything but a row array (the server's failure mode
 *  is an HTML 500 page, which must never read as „no bills"). */
export const parseBillList = (json: unknown): BillListItem[] => {
  if (!Array.isArray(json))
    throw new Error(
      `fn-bills is not a row array: ${JSON.stringify(json).slice(0, 160)}`,
    );
  return json.map((r: Record<string, unknown>, i) => {
    const id = Number(r.L_Act_id);
    if (!Number.isInteger(id) || id <= 0)
      throw new Error(`fn-bills row ${i} has no L_Act_id`);
    return {
      id,
      sign: str(r.L_Act_sign),
      title: str(r.L_ActL_title),
      date: isoDay(r.L_Act_date),
    };
  });
};

/** One bill's detail → the fields this repo uses. */
export const parseBillDetail = (json: unknown): BillDetail => {
  if (!json || typeof json !== "object" || Array.isArray(json))
    throw new Error(
      `bill detail is not an object: ${JSON.stringify(json).slice(0, 160)}`,
    );
  const r = json as Record<string, unknown>;
  const id = Number(r.L_Act_id);
  if (!Number.isInteger(id) || id <= 0)
    throw new Error("bill detail has no L_Act_id");
  const dvIssue = str(r.L_Act_dv_iss) || null;
  const dvYearN = Number(r.L_Act_dv_year);
  return {
    id,
    sign: str(r.L_Act_sign),
    title: str(r.L_ActL_title),
    date: isoDay(r.L_Act_date),
    ns: str(r.A_ns_folder),
    dvIssue,
    dvYear:
      dvIssue && Number.isInteger(dvYearN) && dvYearN > 0 ? dvYearN : null,
    adoptedOn: isoDay(r.L_Act_date2) || null,
    finalTitle: str(r.L_ActL_final) || null,
    withdrawn: r.withdrawn === true,
    vetoDate: isoDay(r.L_Act_veto_date) || null,
    unionIds: Array.isArray(r.union_list)
      ? (r.union_list as Record<string, unknown>[])
          .map((u) => Number(u.L_Act_id ?? u.id))
          .filter((n) => Number.isInteger(n) && n > 0)
      : [],
  };
};

/** The forms a bill title takes in the roll-call corpus's item titles, which abbreviate it
 *  („ЗИД на …") or reword it („Ратификация на …"). EXACT forms only — the stems carry typos
 *  („з 2026", „Ратифицикация") and a fuzzy match would attach a promulgation to the wrong law,
 *  so an unmatched stem stays unmatched and is counted. */
export const billStemCandidates = (title: string): string[] => {
  const t = title
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^Общ законопроект/, "Законопроект");
  const out = new Set([t]);
  const forms: [string, string[]][] = [
    ["Законопроект за изменение и допълнение на ", ["ЗИД на "]],
    ["Законопроект за изменение на ", ["ЗИ на "]],
    ["Законопроект за допълнение на ", ["ЗД на "]],
    [
      "Законопроект за ратифициране на ",
      ["Ратификация на ", "Ратифициране на "],
    ],
  ];
  for (const [prefix, abbrevs] of forms)
    if (t.startsWith(prefix))
      for (const a of abbrevs) out.add(a + t.slice(prefix.length));
  if (t.startsWith("Законопроект за "))
    out.add("Закон за " + t.slice("Законопроект за ".length));
  return [...out];
};

/** The comparison key both sides are folded to: case, whitespace, quote/punctuation variants,
 *  and spacing around a hyphen or after „№" („2021 - 2028" = „2021-2028", „№ 1" = „№1") —
 *  spacing only, never words. */
export const stemKey = (s: string): string =>
  s
    .replace(/\s*[-–]\s*/g, "-")
    .replace(/№\s*/g, "№")
    .replace(/[\s„“"”«».,]+/g, " ")
    .trim()
    .toLowerCase();
