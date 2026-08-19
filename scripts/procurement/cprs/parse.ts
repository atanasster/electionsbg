// Parser for one ЦПРС `listFirms.php` result page. Pure: HTML in, rows out.

export type CprsRow = {
  /** As printed. 9- or 13-digit ЕИК; the register also holds a few foreign
   *  builders whose id is not an ЕИК at all — kept verbatim, judged downstream. */
  eik: string;
  name: string;
  /** „0872/17.12.2015" — the КСБ protocol that entered the firm in the register
   *  for this class. The DATE is the load-bearing half: it is what makes „did
   *  they hold this class on the award date?" answerable. */
  protocolNo: string | null;
  protocolDate: string | null; // ISO
  note: string | null;
};

const clean = (s: string): string =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/\s+/g, " ")
    .trim();

/** „0872/17.12.2015" → { no: "0872", date: "2015-12-17" }. Returns nulls rather
 *  than guessing: a protocol cell is sometimes blank and sometimes carries a
 *  free-text remark instead. */
export const parseProtocol = (
  cell: string,
): { no: string | null; date: string | null } => {
  // ⚠️ THREE SPELLINGS, and a strict dd.mm.yyyy regex silently loses two of them:
  // „1999/24.04.2025г." (the trailing „г." Bulgarians write after a year),
  // „…2025 г." with a space, and „…/1.9.2018" with unpadded parts. Measured:
  // the strict form left 38,626 of 106,508 licences undated — 36% — and the DATE
  // is the whole reason this register is worth having, since „did they hold the
  // class on the award date?" is unanswerable without it.
  const m = cell.match(
    /^\s*([\w-]+)\s*\/\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*(?:г\.?)?\s*$/i,
  );
  if (!m) return { no: cell.trim() || null, date: null };
  const pad = (v: string) => v.padStart(2, "0");
  return { no: m[1], date: `${m[4]}-${pad(m[3])}-${pad(m[2])}` };
};

/** ЕИК-shaped? The register mixes in foreign builders and the occasional typo,
 *  and a row whose id is not an ЕИК cannot join `contracts.contractor_eik` — so
 *  it is KEPT and FLAGGED rather than dropped, the same way the supplier-identity
 *  layer keeps its unclassifiable ids. */
export const isEikShaped = (v: string): boolean => /^\d{9}(\d{4})?$/.test(v);

export const parseFirmList = (html: string): CprsRow[] => {
  const out: CprsRow[] = [];
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(
      (c) => clean(c[1]),
    );
    // The result table is No · ЕИК · Строител · Протокол · заб. Anything with a
    // different arity is the search form's own table or the header row.
    if (cells.length < 4) continue;
    const [no, eik, name, protocol] = cells;
    // The ordinal is „1." / „12." — the only reliable way to tell a data row
    // from the „No | ЕИК | Строител" header, which has the same arity.
    if (!/^\d+\.?$/.test(no)) continue;
    if (!eik || !name) continue;
    const p = parseProtocol(protocol ?? "");
    out.push({
      eik,
      name,
      protocolNo: p.no,
      protocolDate: p.date,
      note: cells[4]?.trim() || null,
    });
  }
  return out;
};
