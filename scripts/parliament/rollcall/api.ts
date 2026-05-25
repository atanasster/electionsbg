// Typed wrappers around parliament.bg's stenogram + voting CSV endpoints.
//
// Discovery model: parliament.bg has no list endpoint for stenograms. Each
// plenary day publishes one stenogram with a monotonically-increasing
// Pl_Sten_id (with gaps). We walk forward from a known starting id and stop
// after WALK_GAP_STOP consecutive non-existent ids.
//
// Per-MP votes are NOT in the JSON body — they're attached as CSV files in
// `files[]` under name "Поименно гласуване". One CSV per plenary day, with
// one row per (MP, vote-item) pair. We download those CSVs and parse them.

const API = "https://www.parliament.bg/api/v1";
const PUB = "https://www.parliament.bg";

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "X-Requested-With": "XMLHttpRequest",
  "Accept-Language": "bg,en;q=0.7",
};

const TEXT_HEADERS: Record<string, string> = {
  "User-Agent": HEADERS["User-Agent"],
  Accept: "text/csv, application/octet-stream, */*",
};

export interface StenFile {
  Pl_StenDid: number;
  Pl_StenDname: string;
  Pl_StenDfile: string;
  Pl_StenDtype: string;
}

export interface PlSten {
  Pl_Sten_id: number;
  Pl_Sten_date: string;
  Pl_Sten_sub: string;
  Pl_Sten_body: string;
  files: StenFile[];
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const fetchJsonStrict = async <T>(
  url: string,
  attempt = 0,
): Promise<T | null> => {
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      if (res.status >= 500 && attempt < 3) {
        await sleep(500 * (attempt + 1));
        return fetchJsonStrict<T>(url, attempt + 1);
      }
      return null;
    }
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      // Non-JSON body means the id doesn't exist (SPA shell HTML or error stub).
      return null;
    }
  } catch (e) {
    if (attempt < 3) {
      await sleep(500 * (attempt + 1));
      return fetchJsonStrict<T>(url, attempt + 1);
    }
    throw e;
  }
};

export const fetchStenogram = async (id: number): Promise<PlSten | null> => {
  const data = await fetchJsonStrict<PlSten>(`${API}/pl-sten/${id}`);
  if (!data || !data.Pl_Sten_id || !data.Pl_Sten_date) return null;
  return data;
};

export const findRollcallCsv = (sten: PlSten): StenFile | null => {
  // The stenogram ships PDF + XLSX + CSV variants for both
  // "Гласуване по парламентарни групи" and "Поименно гласуване". We want the
  // CSV variant of the latter (per-MP rows).
  return (
    (sten.files ?? []).find(
      (f) =>
        f.Pl_StenDname.includes("Поименно") && f.Pl_StenDfile.endsWith(".csv"),
    ) ?? null
  );
};

// "Гласуване по парламентарни групи" CSV. Same data day-shape but rows are
// per-group instead of per-MP, and the first column (textbox3) carries the
// item title ("по тема <…>"). We use it only to enrich the per-MP file with
// human-readable titles.
export const findGroupsCsv = (sten: PlSten): StenFile | null => {
  return (
    (sten.files ?? []).find(
      (f) =>
        f.Pl_StenDname.includes("парламентарни групи") &&
        f.Pl_StenDfile.endsWith(".csv"),
    ) ?? null
  );
};

// XLSX fallback for the groups file. Pre-47th NA sessions ship this format
// only; without it the SPA falls back to outcome-derived labels.
export const findGroupsXlsx = (sten: PlSten): StenFile | null => {
  return (
    (sten.files ?? []).find(
      (f) =>
        f.Pl_StenDname.includes("парламентарни групи") &&
        f.Pl_StenDfile.endsWith(".xlsx"),
    ) ?? null
  );
};

// Per-MP XLSX for the day. Used as a fallback when the CSV variant isn't
// published (45th-46th NA, and occasional gaps in 47th NA).
export const findRollcallXlsx = (sten: PlSten): StenFile | null => {
  return (
    (sten.files ?? []).find(
      (f) =>
        f.Pl_StenDname.includes("Поименно") && f.Pl_StenDfile.endsWith(".xlsx"),
    ) ?? null
  );
};

// Per-MP PDF for the day — useful as a "see source document" deep-link from
// the frontend.
export const findRollcallPdf = (sten: PlSten): StenFile | null => {
  return (
    (sten.files ?? []).find(
      (f) =>
        f.Pl_StenDname.includes("Поименно") && f.Pl_StenDfile.endsWith(".pdf"),
    ) ?? null
  );
};

// Absolute URL for a parliament.bg attachment path.
export const publicUrl = (relativeUrl: string): string =>
  relativeUrl.startsWith("http") ? relativeUrl : `${PUB}${relativeUrl}`;

export const fetchCsv = async (relativeUrl: string): Promise<string> => {
  const url = relativeUrl.startsWith("http")
    ? relativeUrl
    : `${PUB}${relativeUrl}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: TEXT_HEADERS });
      if (res.ok) return await res.text();
      if (res.status < 500) throw new Error(`HTTP ${res.status} for ${url}`);
      await sleep(500 * (attempt + 1));
    } catch (e) {
      if (attempt >= 2) throw e;
      await sleep(500 * (attempt + 1));
    }
  }
  throw new Error(`failed to fetch ${url}`);
};

export const fetchBinary = async (relativeUrl: string): Promise<Buffer> => {
  const url = relativeUrl.startsWith("http")
    ? relativeUrl
    : `${PUB}${relativeUrl}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: TEXT_HEADERS });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      if (res.status < 500) throw new Error(`HTTP ${res.status} for ${url}`);
      await sleep(500 * (attempt + 1));
    } catch (e) {
      if (attempt >= 2) throw e;
      await sleep(500 * (attempt + 1));
    }
  }
  throw new Error(`failed to fetch ${url}`);
};

// Walk pl-sten ids forward from start+1, stopping after gapStop consecutive
// misses. Returns the discovered stenograms in ascending id order.
export const walkStenogramsForward = async (
  startAfter: number,
  opts: {
    gapStop: number;
    maxScan: number;
    onProgress?: (id: number, found: number) => void;
  },
): Promise<PlSten[]> => {
  const out: PlSten[] = [];
  let gap = 0;
  for (
    let id = startAfter + 1, scanned = 0;
    scanned < opts.maxScan;
    id++, scanned++
  ) {
    const sten = await fetchStenogram(id);
    opts.onProgress?.(id, out.length);
    if (!sten) {
      gap++;
      if (gap >= opts.gapStop) return out;
      continue;
    }
    gap = 0;
    out.push(sten);
  }
  return out;
};

// Fetch every existing stenogram in [fromId, toId] inclusive. Unlike the
// forward walker, this doesn't stop on gaps — historical id ranges have lots
// of non-existent ids interleaved with valid ones. Use for backfill where the
// range is known and bounded.
export const walkStenogramsRange = async (
  fromId: number,
  toId: number,
  opts: {
    onProgress?: (id: number, found: number) => void;
  } = {},
): Promise<PlSten[]> => {
  const out: PlSten[] = [];
  for (let id = fromId; id <= toId; id++) {
    const sten = await fetchStenogram(id);
    opts.onProgress?.(id, out.length);
    if (sten) out.push(sten);
  }
  return out;
};
