// The ONE definition of the BACIS licensing table's shape — Агенция „Митници"
// publishes the licensed excise warehouse keepers as an HTML table at the REST
// endpoint below, and TWO consumers read it: the ingest
// (scripts/customs/excise_register.ts, which decides what is ingested) and the
// watcher (scripts/watch/sources/customs_excise_register.ts, which decides
// WHETHER to re-ingest).
//
// ⚠️ They must not each carry their own copy of the column map. Until 2026-08-19
// they did — the same `<tr>` split, the same `c.length < 8` guard, the same
// `/^\d{9,13}$/` EIK probe, the same magic indices — and a column shift on the
// register's side would have drifted them SILENTLY AND ASYMMETRICALLY: the
// watcher can keep reporting „no change" (its `EIK|status` fingerprint reading
// the wrong two cells, but reading them consistently) while the ingest
// mis-parses everything. Neither would fail, because the ingest's only
// structural guard is a row COUNT and a column shift does not move it.
//
// Adding a column here therefore breaks BOTH readers at once, which is the point.

/** The BACIS table's column positions. Index into the stripped `<td>` array. */
export const BACIS_COLS = {
  name: 0,
  eik: 2,
  /** The WAREHOUSE's own address („Област/Община/Населено място/Улица"), which
   *  can differ from the operator's seat in column [1]. Feeds the map's geocode. */
  warehouseAddr: 3,
  goods: 4,
  status: 7,
} as const;

/** One licence row, as published. */
export interface RawRow {
  name: string;
  eik: string;
  /** CN commodity codes, comma/semicolon/·-separated. */
  goods: string;
  status: string;
  warehouseAddr: string;
}

/** Minimum `<td>` count for a row to be a data row rather than a header/spacer. */
const MIN_CELLS = Math.max(...Object.values(BACIS_COLS)) + 1;

const strip = (s: string): string =>
  s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Parse the BACIS licensing table. Rows whose cell [eik] is not a 9–13 digit
 *  number are headers or spacers and are dropped. */
export const parseRows = (html: string): RawRow[] => {
  const out: RawRow[] = [];
  for (const r of html.split(/<tr[ >]/i).slice(1)) {
    const c = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      strip(m[1]),
    );
    if (c.length < MIN_CELLS || !/^\d{9,13}$/.test(c[BACIS_COLS.eik])) continue;
    out.push({
      name: c[BACIS_COLS.name],
      eik: c[BACIS_COLS.eik],
      goods: c[BACIS_COLS.goods],
      status: c[BACIS_COLS.status],
      warehouseAddr: c[BACIS_COLS.warehouseAddr],
    });
  }
  return out;
};

// ------------------------------------------------------------ licence status ---
// BACIS emits THREE statuses, measured on the live register 2026-08-19:
//   Прекратен (447) · Валиден (356) · Издадено решение за прекратяване (4)
//
// The third — „a termination decision has been issued" — is read as TERMINATED:
// the licence is on its way out, and counting it would over-state the active
// corpus and put a closing warehouse on the map. Deliberate, and recorded here
// because nothing else would tell you the reading was a decision.
//
// ⚠️ The test is ANCHORED and the vocabulary CLOSED, deliberately. A substring
// `/Валиден/i` would read a future „Невалиден" or „Валиден до 31.12.2026" as
// active with no error anywhere: the fetch guard only checks row count, and the
// watcher fingerprints `EIK|status`, so a new value simply flips the fingerprint
// and the ingest re-runs with the wrong reading. The blast radius is the whole
// `active` / `warehouses` / map corpus, so an unknown status throws instead.
const VALID = /^Валиден$/i;
const TERMINATED = /^(Прекратен|Издадено решение за прекратяване)$/i;

/** True for a still-valid licence; throws on a status BACIS has not emitted before. */
export const isValidStatus = (s: string): boolean => {
  const t = s.trim();
  if (VALID.test(t)) return true;
  if (TERMINATED.test(t)) return false;
  throw new Error(
    `unknown BACIS licence status: ${JSON.stringify(s)} — read scripts/customs/bacis_table.ts before widening the vocabulary`,
  );
};
