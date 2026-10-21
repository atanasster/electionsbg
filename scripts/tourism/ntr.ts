// Национален туристически регистър (НТР) — the accommodation register („места за настаняване",
// МН) at ntr.tourism.government.bg, CategoryzationAll.nsf.
//
// HOW IT IS READ. The public page (mn.xsp) is an IBM XPages app whose results table is a
// DataTables widget filled from Domino's REST Data Service:
//   GET /CategoryzationAll.nsf/api/data/collections/name/vRegistarMNValid1?ps=100&page=N
// JSON rows, `Content-Range: items a-b/TOTAL`, 0-based pages, ps capped at 100 (a larger ps
// returns an error object, not rows), and no session cookie needed. So no browser and no form
// postback — measured 2026-10-21: the view's total was 41,463, of which 41,422 are served
// to an anonymous client (see checkNtrCompleteness).
//
// WHAT IT IS. One row per categorised or registered object that is CURRENTLY VALID (the view's
// name; expired certificates live in a different view, mnexpired.xsp). It is the supply side —
// rooms and beds on the certificate — not occupancy, which is Eurostat tour_occ_*.
//
// Municipality is published as a NAME only. A name resolves when exactly one real municipality
// carries it (Sofia's district shards are not municipalities), or when НТР itself disambiguates
// it by oblast („Бяла - Русе"); „Столична" maps to the city-wide `SOF`. A bare ambiguous name —
// in practice only „Бяла" — stays unresolved and is counted, never guessed.

export const NTR_ORIGIN = "https://ntr.tourism.government.bg";
export const NTR_MN_VIEW = "vRegistarMNValid1";
export const NTR_MN_URL = `${NTR_ORIGIN}/CategoryzationAll.nsf/api/data/collections/name/${NTR_MN_VIEW}`;
/** The REST service's page-size cap. */
export const NTR_PAGE_SIZE = 100;

export interface NtrObject {
  unid: string;
  certificate: string;
  /** „Хотел", „Апартаменти за гости", „Къща за гости" … */
  kind: string;
  name: string;
  municipality: string;
  /** „гр." / „с." */
  prefix: string;
  city: string;
  address: string;
  /** „1"…„5" stars, or "" for an object registered without a category. */
  category: string;
  rooms: number | null;
  beds: number | null;
}

const str = (v: unknown): string => (v == null ? "" : String(v).trim());
const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0
    ? v
    : typeof v === "string" && /^\d+$/.test(v.trim())
      ? Number(v)
      : null;

/** One REST page → objects. Throws on anything that is not a row array: an error object (the
 *  ps>100 response) or an HTML page must never be read as an empty page. */
export const parseNtrPage = (json: unknown): NtrObject[] => {
  if (!Array.isArray(json))
    throw new Error(
      `НТР page is not a row array: ${JSON.stringify(json).slice(0, 200)}`,
    );
  return json.map((r: Record<string, unknown>, i) => {
    const unid = str(r["@unid"]);
    if (!/^[0-9A-F]{32}$/.test(unid))
      throw new Error(
        `НТР row ${i} has no document id: ${JSON.stringify(r).slice(0, 200)}`,
      );
    return {
      unid,
      certificate: str(r.CNumber),
      kind: str(r.TOSubType1),
      name: str(r.TOName),
      municipality: str(r.TOMunicipality),
      prefix: str(r.Prefix),
      city: str(r.TOCity),
      address: str(r.TOAddress),
      category: str(r.CategoryGiven),
      rooms: count(r.TORoomsGiven),
      beds: count(r.TOBedsGiven),
    };
  });
};

/** „items 0-99/41457" → 41457, or null. */
export const totalOfContentRange = (h: string | null): number | null => {
  const m = /\/(\d+)\s*$/.exec(h ?? "");
  return m ? Number(m[1]) : null;
};

/** НТР's name for Sofia's municipality. `municipalities.json` holds only its 24 district shards
 *  (S2xxx), so it resolves to the repo's city-wide synthetic code `SOF` (the same convention the
 *  local-elections bundle uses) rather than staying unresolved — it is 11% of the register. */
const SOFIA_MUNICIPALITY = "Столична";
export const SOFIA_CITY_CODE = "SOF";

/** Municipality name → code. A name resolves only when exactly one municipality carries it, or
 *  when НТР itself disambiguates it by oblast („Бяла - Русе"); a bare ambiguous name („Бяла")
 *  stays null and is counted, never guessed. Sofia's districts (codes S##…) are not
 *  municipalities and are left out. */
export const municipalityIndex = (
  munis: readonly { name: string; obshtina: string; oblast?: string }[],
  oblastNameBg: Readonly<Record<string, string>> = {},
): Map<string, string | null> => {
  const idx = new Map<string, string | null>();
  const real = munis.filter((m) => !/^S\d/.test(m.obshtina));
  for (const m of real) idx.set(m.name, idx.has(m.name) ? null : m.obshtina);
  for (const m of real)
    if (idx.get(m.name) === null && m.oblast && oblastNameBg[m.oblast])
      idx.set(`${m.name} - ${oblastNameBg[m.oblast]}`, m.obshtina);
  idx.set(SOFIA_MUNICIPALITY, SOFIA_CITY_CODE);
  return idx;
};

export interface NtrMunicipalityRow {
  municipality: string;
  /** null when the name is ambiguous or unknown — never guessed. */
  obshtina: string | null;
  objects: number;
  rooms: number;
  beds: number;
  /** Objects by kind. */
  byKind: Record<string, number>;
  /** Objects by category; "" = registered without a category. */
  byCategory: Record<string, number>;
}

export interface NtrSummary {
  source: { url: string; view: string };
  fetchedAt: string;
  objects: number;
  rooms: number;
  beds: number;
  /** Objects whose municipality name did not resolve to exactly one code. */
  unresolvedObjects: number;
  /** Objects whose certificate states no bed / room count — counted as 0 in the sums above,
   *  so the sums are a floor and these say by how much. */
  objectsWithoutBeds: number;
  objectsWithoutRooms: number;
  municipalities: NtrMunicipalityRow[];
}

const bump = (o: Record<string, number>, k: string) => {
  o[k] = (o[k] ?? 0) + 1;
};

/** Objects → the committed per-municipality summary. */
export const summariseNtr = (
  objects: readonly NtrObject[],
  idx: ReadonlyMap<string, string | null>,
  fetchedAt: string,
): NtrSummary => {
  const by = new Map<string, NtrMunicipalityRow>();
  for (const o of objects) {
    let row = by.get(o.municipality);
    if (!row) {
      row = {
        municipality: o.municipality,
        obshtina: idx.get(o.municipality) ?? null,
        objects: 0,
        rooms: 0,
        beds: 0,
        byKind: {},
        byCategory: {},
      };
      by.set(o.municipality, row);
    }
    row.objects++;
    row.rooms += o.rooms ?? 0;
    row.beds += o.beds ?? 0;
    bump(row.byKind, o.kind);
    bump(row.byCategory, o.category);
  }
  const municipalities = [...by.values()].sort(
    (a, b) => b.beds - a.beds || a.municipality.localeCompare(b.municipality),
  );
  return {
    source: { url: NTR_MN_URL, view: NTR_MN_VIEW },
    fetchedAt,
    objects: objects.length,
    rooms: municipalities.reduce((s, m) => s + m.rooms, 0),
    beds: municipalities.reduce((s, m) => s + m.beds, 0),
    objectsWithoutBeds: objects.filter((o) => o.beds === null).length,
    objectsWithoutRooms: objects.filter((o) => o.rooms === null).length,
    unresolvedObjects: municipalities
      .filter((m) => !m.obshtina)
      .reduce((s, m) => s + m.objects, 0),
    municipalities,
  };
};

/** The last row's `@position` on a REST page, or null. */
export const lastPositionOf = (json: unknown): number | null => {
  if (!Array.isArray(json) || !json.length) return null;
  const p = Number((json.at(-1) as Record<string, unknown>)["@position"]);
  return Number.isInteger(p) ? p : null;
};

/** Whether a crawl read the WHOLE readable view.
 *
 *  The view's `Content-Range` total is NOT the number of rows a crawl can read: it also counts
 *  entries the REST service never serves to an anonymous client. Measured 2026-10-21: total
 *  41,463, readable 41,422 in two crawls and a probe — `page=413` (offset 41,300) returns
 *  `@position` 41,342–41,441, i.e. positions run 41 ahead of offsets, and the last page reports
 *  „items 41400-41462" while returning 22 rows. So „rows === total" can never hold. The real
 *  test: every page before the last is full, and the last row sits at position === total (the
 *  view's end was reached). The difference is reported as hidden, never treated as loss. */
export const checkNtrCompleteness = (
  requested: readonly { rows: number; lastPosition: number | null }[],
  total: number,
  pageSize: number,
): { readable: number; hidden: number } => {
  // `ceil(total / ps)` pages are requested, and the total includes the hidden entries, so the
  // last page(s) can lie past the readable end and come back empty. Those are not short pages.
  let end = requested.length;
  while (end > 0 && requested[end - 1].rows === 0) end--;
  const pages = requested.slice(0, end);
  if (!pages.length) throw new Error("НТР: no pages read");
  pages.slice(0, -1).forEach((p, i) => {
    if (p.rows !== pageSize)
      throw new Error(
        `НТР: page ${i} returned ${p.rows} of ${pageSize} rows before the last page — a broken crawl`,
      );
  });
  const last = pages.at(-1)!;
  if (last.lastPosition !== total)
    throw new Error(
      `НТР: the last row is at position ${last.lastPosition}, the view ends at ${total} — the crawl stopped short`,
    );
  const readable = pages.reduce((s, p) => s + p.rows, 0);
  return { readable, hidden: total - readable };
};
