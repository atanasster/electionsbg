// Legacy annual-CSV ingester for АОП procurement data pre-OCDS.
//
// АОП started publishing OCDS-standard fortnight bundles only in Jan 2026.
// Everything earlier (2011-2023) is published as annual CSV dumps. The two
// formats differ enough that a single normalizer would be ugly — this file
// is the legacy parser, separate from normalize.ts (which is OCDS-only).
//
// Coverage (one dataset per year, except 2011-2015 which is bundled):
//
//   2023: contracts2023_CE.csv + contracts2023_RL.csv
//   2022: contracts2022_CE.csv + contracts2022_RL.csv
//   2021: contracts2021_ROPL.csv        (РОП — the older system, only one
//                                        published for 2021)
//   2020: caiseop_contracts2020.csv     (CAIS EOP)
//   2019: contracts2019.csv             (older format)
//   2017: contracts2017.csv             (older format)
//   2016: contracts2016.csv             (older format)
//   2011-2015: contracts_2011-2015.csv  (one file, five years)
//
// АОП published 2022 and 2023 as two files each — a ЦАИС ЕОП (CE) file and a
// РОП (RL) file. They are near-disjoint (<0.5% of RL rows overlap a CE row by
// awarder+contractor+amount): the RL files carry tail-end activity from the
// older register, not duplicates. Both are ingested, namespaced by a "-RL"
// year token so their releaseIds never collide with the CE files'.
//
// 2018 contracts are not published by АОП (only excl2018.csv = out-of-scope
// records exists). 2024 and 2025 are not published in any form — the annual
// CSV series ends at 2023 and the OCDS fortnight bundles start at 2026-01-01.
//
// The CSV schemas drift across years:
//   - Newer CE files (2020-2023): include `Стойност при сключване`, `ДДС`,
//     `Малко или средно предприятие`, full bilingual headers
//   - Older files (2016-2019): fewer columns, no SME flag, different header
//     phrasing
//   - 2011-2015 bulk: yet another schema with multi-year `Дата` field
//
// We resolve columns by name patterns rather than position so each year's
// quirks are isolated to a small per-year config block.

import { createHash } from "crypto";
import { parse } from "csv-parse/sync";
import { canonicalEik, isValidEik } from "./eik";
import type { Contract } from "./types";
import { toEur } from "@/lib/currency";

export interface LegacyDataset {
  // Year of the file, optionally suffixed with the source system when АОП
  // published the same year twice ("2023", "2023-RL", "2011-2015"). The
  // suffix keeps the two files' releaseIds in separate namespaces.
  year: string;
  datasetUuid: string;
  // What "data source system" the file represents. CE = ЦАИС ЕОП, RL = РОП.
  // For 2022/2023 АОП published both; they are near-disjoint (the RL file is
  // tail-end old-register activity), so both are ingested rather than one
  // shadowing the other.
  system: "CE" | "RL" | "OLDER";
  // Download format. CSV works for most years, but the 2011-2015 bundle
  // (~136 MB raw) consistently 419s through the CSV endpoint — Laravel
  // gives up before streaming the file. JSON succeeds. The downloaded JSON
  // is a 2D array shape, [[headers], ...rows] — we synthesise CSV-equivalent
  // records before parsing.
  format?: "CSV" | "JSON";
}

// Hardcoded UUIDs per year. Pinning these protects us from accidentally
// picking up a republished dataset with shifted UUIDs. Re-discovery via the
// listing walker is also available; this is the curated default.
export const LEGACY_DATASETS: LegacyDataset[] = [
  {
    year: "2023",
    datasetUuid: "20b30088-7a6e-4486-a17a-02871c573783",
    system: "CE",
  },
  {
    year: "2023-RL",
    datasetUuid: "eedbb4b3-e120-4ce6-a7fb-252f59c8c491",
    system: "RL",
  },
  {
    year: "2022",
    datasetUuid: "b6ec0598-8dfd-4338-8756-a679420c2cd0",
    system: "CE",
  },
  {
    year: "2022-RL",
    datasetUuid: "db3e39ba-37f9-44bf-847f-75f36acee513",
    system: "RL",
  },
  {
    year: "2021",
    datasetUuid: "a03748c9-bb31-4cce-b350-b8e06b63c7c9",
    system: "RL",
  },
  {
    year: "2020",
    datasetUuid: "c5404069-668a-4cd2-ab43-a1cdc26e03c6",
    system: "CE",
  },
  {
    year: "2019",
    datasetUuid: "83e02856-b460-4ec8-bf5e-b23ae6e267ca",
    system: "OLDER",
  },
  {
    year: "2017",
    datasetUuid: "5a06c9b5-4db6-4213-8c7a-df9bb9c94c55",
    system: "OLDER",
  },
  {
    year: "2016",
    datasetUuid: "5d588198-c9e5-40df-86a6-698dbf69dbf7",
    system: "OLDER",
  },
  {
    year: "2011-2015",
    datasetUuid: "049115c2-6556-4171-b030-e36b3b82546d",
    system: "OLDER",
    format: "JSON",
  },
];

// Column-name patterns. We tokenize the header, strip whitespace/punctuation,
// then match against these patterns. Each Contract field gets a list of
// patterns to try in order — first match wins.
// Column-name patterns. JavaScript's `\b` works only at ASCII word boundaries,
// so it's omitted for patterns that need to match against Cyrillic-ending
// headers ("Номер на договор" etc.). Where ambiguity matters between
// "договор" and "документ", we order patterns by specificity (longest first).
//
// Headers vary across the published years:
//   - Newer CE files (2020-2023): "Номер на документ", "Дата на договор", ...
//   - Older "_ROPL" / pre-CAIS files (2016-2019, 2021 RL): "ID на документ",
//     "ID на поръчката", "УНП", "ОБЕКТ", all-caps.
//   - 2011-2015 bulk: yet another shape (different column names per year).
//
// We accept either Bulgarian "номер" or "id" prefix, plus a few all-caps
// shortcuts ("ОБЕКТ", "УНП", "ИЗПЪЛНИТЕЛ").
const COLUMN_PATTERNS: Record<keyof LegacyRow, RegExp[]> = {
  documentId: [
    /номер.*на.*документ/i,
    /id.*на.*документ/i,
    /document.*number/i,
  ],
  // `договор.*номер` / `договор.*дата` catch the РОП files' reversed-word
  // headers ("ДОГОВОР НОМЕР", "ДОГОВОР ДАТА"); the `номер.*на.*договор` forms
  // cover the ЦАИС ЕОП files. Word order disambiguates — the two never collide.
  contractId: [
    /номер.*на.*договор/i,
    /id.*на.*договор/i,
    /contract.*number/i,
    /договор.*номер/i,
  ],
  contractDate: [
    /дата.*на.*договор/i,
    /дата.*на.*сключване/i,
    /signed.*date/i,
    /договор.*дата/i,
    /^дата$/i,
  ],
  publishedDate: [/публикуван/i, /дата.*на.*публикуване/i],
  tenderId: [
    /уникален.*номер.*на.*поръчк/i,
    /id.*на.*поръчк/i,
    /^унп$/i,
    /уникален.*номер.*поръчка/i,
  ],
  awarderEik: [/еик.*на.*възложител/i, /възложител.*еик/i, /^еик.*възложител/i],
  awarderName: [
    /^възложител$/i,
    /име.*на.*възложител/i,
    /наименование.*на.*възложител/i,
    /contracting.*authority/i,
  ],
  tenderSubject: [/предмет.*на.*поръчк/i, /^предмет$/i],
  category: [/обект.*на.*поръчк/i, /^обект$/i, /тип.*поръчк/i],
  contractSubject: [/предмет.*на.*договор/i, /предмет.*договор/i],
  // The 2011-2015 bulk file uses a bare "ЕИК" column right after the
  // contractor's ID column — without the qualifier "на изпълнителя". The
  // disambiguation pattern below picks bare "ЕИК" only if a fully-qualified
  // awarder/contractor column wasn't already found at a different position;
  // see buildHeaderMap for the bare-match safeguard.
  contractorEik: [
    /еик.*на.*изпълнител/i,
    /изпълнител.*еик/i,
    /^еик.*изпълнител/i,
    /^еик$/i,
  ],
  contractorName: [
    /^изпълнител$/i,
    /име.*на.*изпълнител/i,
    /наименование.*на.*изпълнител/i,
  ],
  amount: [
    /стойност.*при.*сключване/i,
    /договорена.*стойност/i,
    /стойност.*на.*договор/i,
    /^стойност$/i,
  ],
  currency: [/^валута$/i, /currency/i],
};

interface LegacyRow {
  documentId?: string;
  contractId?: string;
  contractDate?: string;
  publishedDate?: string;
  tenderId?: string;
  awarderEik?: string;
  awarderName?: string;
  tenderSubject?: string;
  category?: string;
  contractSubject?: string;
  contractorEik?: string;
  contractorName?: string;
  amount?: string;
  currency?: string;
}

// Returns `field → column index` for the parsed CSV header. Unmapped fields
// stay undefined; the normalizer tolerates missing fields gracefully (BG
// procurement CSVs evolved schemas year-over-year — missing fields are not
// fatal, missing-value rows are dropped).
//
// Disambiguation rule: a column is bound to at most one field. Once
// `awarderEik` has claimed a column, that index can't also be picked up by
// `contractorEik` via the bare `/^еик$/i` fallback. This matters for the
// 2011-2015 bulk file which has both "ЕИК на възложителя" (awarder, picked
// by the qualified pattern) and a later bare "ЕИК" (contractor).
const buildHeaderMap = (
  header: string[],
): Partial<Record<keyof LegacyRow, number>> => {
  const out: Partial<Record<keyof LegacyRow, number>> = {};
  const claimed = new Set<number>();
  for (const [field, patterns] of Object.entries(COLUMN_PATTERNS) as [
    keyof LegacyRow,
    RegExp[],
  ][]) {
    for (let i = 0; i < header.length; i++) {
      if (claimed.has(i)) continue;
      const h = header[i].trim();
      if (patterns.some((p) => p.test(h))) {
        out[field] = i;
        claimed.add(i);
        break;
      }
    }
  }
  return out;
};

// Parse a DD/MM/YYYY or DD.MM.YYYY date into ISO YYYY-MM-DD. Returns empty
// string on malformed input — the caller checks before using.
const parseDate = (raw: string | undefined, fallbackYear?: string): string => {
  if (!raw) return fallbackYear ? `${fallbackYear}-12-31` : "";
  const trimmed = raw.trim();
  // DD/MM/YYYY or DD.MM.YYYY
  const m1 = trimmed.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (m1) {
    const [, d, mo, y] = m1;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // ISO-like YYYY-MM-DD
  const m2 = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m2) {
    const [, y, mo, d] = m2;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return fallbackYear ? `${fallbackYear}-12-31` : "";
};

const parseAmount = (raw: string | undefined): number | undefined => {
  if (!raw) return undefined;
  // Strip thousands separators (space, comma) and convert decimal comma to dot.
  // BG CSVs are inconsistent: some use "12 345.67", some "12345,67", some "12345.67".
  const cleaned = raw
    .trim()
    .replace(/\s+/g, "")
    // Replace trailing decimal comma with dot. This is a heuristic — "1,000"
    // is ambiguous between 1.000 and 1000. We treat comma+exactly-three-digits
    // as a thousands separator, anything else as a decimal point.
    .replace(/,(\d{3})(?!\d)/g, "$1")
    .replace(/,(\d{1,2})$/, ".$1");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
};

const CATEGORY_MAP: Record<string, string> = {
  Доставки: "goods",
  Услуги: "services",
  Строителство: "works",
};

const contractKey = (
  datasetUuid: string,
  documentId: string,
  contractorEik: string,
): string =>
  createHash("sha256")
    .update(`legacy::${datasetUuid}::${documentId}::${contractorEik}`)
    .digest("hex")
    .slice(0, 12);

export interface LegacyNormalizeStats {
  rowsSeen: number;
  rowsEmitted: number;
  droppedNoBuyer: number;
  droppedNoContractor: number;
  droppedNoAmount: number;
  unmappedHeaders: string[];
}

export const parseLegacyCsv = (
  csvText: string,
  ds: LegacyDataset,
): { rows: Contract[]; stats: LegacyNormalizeStats } => {
  const stats: LegacyNormalizeStats = {
    rowsSeen: 0,
    rowsEmitted: 0,
    droppedNoBuyer: 0,
    droppedNoContractor: 0,
    droppedNoAmount: 0,
    unmappedHeaders: [],
  };

  // Two paths: CSV (most years) or JSON 2D array ([[headers], [row], ...]).
  // The JSON payload is what the server returns when ds.format === "JSON"
  // — used for years whose CSV endpoint 419s on download (2011-2015 bundle).
  let records: string[][];
  if (ds.format === "JSON") {
    try {
      const parsed = JSON.parse(csvText) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error("legacy JSON payload is not an array");
      }
      records = (parsed as unknown[][]).map((row) =>
        row.map((cell) => (cell == null ? "" : String(cell))),
      );
    } catch (e) {
      throw new Error(
        `legacy JSON parse failed for ${ds.year}: ${(e as Error).message}`,
      );
    }
  } else {
    // csv-parse strips the UTF-8 BOM automatically when bom: true. The 2023 CE
    // file confirms BOM presence; older files vary, so this is defensive.
    records = parse(csvText, {
      bom: true,
      columns: false,
      skip_empty_lines: true,
      relax_column_count: true,
      relax_quotes: true,
    }) as string[][];
  }
  if (records.length === 0) return { rows: [], stats };

  const header = records[0];
  const colMap = buildHeaderMap(header);
  // Track headers that didn't map — useful for diagnosing schema drift.
  for (const h of header) {
    const trimmed = h.trim();
    const matched = Object.entries(colMap).some(([, idx]) =>
      idx !== undefined ? header[idx] === h : false,
    );
    if (!matched && trimmed) stats.unmappedHeaders.push(trimmed);
  }

  const sourceUrl = `https://data.egov.bg/data/view/${ds.datasetUuid}`;
  const yearOnly = ds.year.split("-")[0];
  const fallbackYear = ds.year.includes("-") ? undefined : yearOnly;

  const rows: Contract[] = [];
  for (let i = 1; i < records.length; i++) {
    stats.rowsSeen++;
    const r = records[i];
    if (!r || r.length === 0) continue;
    const pick = (k: keyof LegacyRow): string | undefined => {
      const idx = colMap[k];
      return idx === undefined ? undefined : r[idx];
    };

    const documentId = (pick("documentId") ?? "")
      .replace(/^"+|"+$/g, "")
      .trim();
    const contractIdRaw = (pick("contractId") ?? "")
      .replace(/^"+|"+$/g, "")
      .trim();
    const awarderEikRaw = (pick("awarderEik") ?? "")
      .replace(/^"+|"+$/g, "")
      .trim();
    const contractorEikRaw = (pick("contractorEik") ?? "")
      .replace(/^"+|"+$/g, "")
      .trim();
    const awarderName = (pick("awarderName") ?? "")
      .replace(/^"+|"+$/g, "")
      .trim();
    const contractorName = (pick("contractorName") ?? "")
      .replace(/^"+|"+$/g, "")
      .trim();
    const tenderSubject = (pick("tenderSubject") ?? "")
      .replace(/^"+|"+$/g, "")
      .trim();
    const contractSubject = (pick("contractSubject") ?? "")
      .replace(/^"+|"+$/g, "")
      .trim();
    const amountRaw = pick("amount");
    const currencyRaw = (pick("currency") ?? "").trim() || "BGN";
    const contractDate = parseDate(pick("contractDate"), fallbackYear);
    const publishedDate = parseDate(pick("publishedDate"), fallbackYear);
    const categoryRaw = (pick("category") ?? "").trim();
    const category = CATEGORY_MAP[categoryRaw] ?? categoryRaw;

    const awarderEik = canonicalEik(awarderEikRaw);
    if (!isValidEik(awarderEik)) {
      stats.droppedNoBuyer++;
      continue;
    }
    const contractorEik = canonicalEik(contractorEikRaw);
    if (!isValidEik(contractorEik)) {
      stats.droppedNoContractor++;
      continue;
    }
    const amount = parseAmount(amountRaw);
    if (amount === undefined || amount <= 0) {
      stats.droppedNoAmount++;
      continue;
    }

    // The row's calendar date is the publication date when available (when
    // the spend became public), falling back to the signing date. The year
    // implied by ds.year is the safety net for malformed legacy rows.
    const rowDate = publishedDate || contractDate || `${yearOnly}-12-31`;

    rows.push({
      key: contractKey(ds.datasetUuid, documentId, contractorEik),
      ocid: `aop-legacy-${ds.year}-${documentId || "x"}`,
      releaseId: `aop-legacy-${ds.year}-${documentId || "x"}-${contractorEik}`,
      contractId: contractIdRaw || undefined,
      tag: "contract",
      date: rowDate,
      dateSigned: contractDate || undefined,
      awarderEik,
      awarderName,
      contractorEik,
      contractorEikFull:
        contractorEikRaw && contractorEikRaw !== contractorEik
          ? contractorEikRaw
          : undefined,
      contractorName,
      amount,
      currency: currencyRaw || "BGN",
      amountEur: toEur(amount, currencyRaw || "BGN") ?? undefined,
      title: contractSubject || tenderSubject || "",
      category: category || undefined,
      bundleUuid: ds.datasetUuid,
      sourceUrl,
    });
    stats.rowsEmitted++;
  }

  return { rows, stats };
};

// data.egov.bg's CSV download is CSRF-protected: a GET to /resource/download/
// /UUID/csv returns a redirect to the homepage. The actual download is a POST
// to /resource/download with form fields (_token, resource id, version, name,
// format=CSV) and a session cookie established by visiting the resource page
// first. We replicate that flow:
//   1. GET dataset page → extract the resource UUID
//   2. GET resource page → extract CSRF token + form fields, capture session cookie
//   3. POST /resource/download with the form payload + cookie → CSV bytes
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) electionsbg.com/1.0";

const collectSetCookies = (res: Response): string => {
  // Some Node versions expose getSetCookie(); fall back to the raw header.
  // Either way, fold into a single Cookie value (name=value pairs separated
  // by "; ").
  const headers =
    typeof (res.headers as { getSetCookie?: () => string[] }).getSetCookie ===
    "function"
      ? (res.headers as { getSetCookie: () => string[] }).getSetCookie()
      : (res.headers.get("set-cookie")?.split(/,(?=\s*\w+=)/) ?? []);
  return headers
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
};

interface DownloadForm {
  token: string;
  resourceId: string;
  version: string;
  name: string;
  cookie: string;
}

const fetchDownloadForm = async (
  resourceUuid: string,
): Promise<DownloadForm> => {
  const url = `https://data.egov.bg/organisation/datasets/resourceView/${resourceUuid}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
  });
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  }
  const cookie = collectSetCookies(res);
  const html = await res.text();
  const token = html.match(/name="_token"\s+value="([^"]+)"/)?.[1];
  const resourceId = html.match(/name="resource"[\s\S]*?value="([^"]+)"/)?.[1];
  const version = html.match(/name="version"[\s\S]*?value="([^"]+)"/)?.[1];
  const name = html.match(/name="name"[\s\S]*?value="([^"]+)"/)?.[1] ?? "";
  if (!token || !resourceId || !version) {
    throw new Error(
      `resource ${resourceUuid}: download form fields missing (token=${!!token} resource=${!!resourceId} version=${!!version})`,
    );
  }
  return { token, resourceId, version, name, cookie };
};

const fetchResourceUuidForDataset = async (
  datasetUuid: string,
): Promise<string> => {
  const url = `https://data.egov.bg/organisation/dataset/${datasetUuid}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
  });
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const m = html.match(/\/resourceView\/([0-9a-f-]{36})/i);
  if (!m) throw new Error(`dataset ${datasetUuid}: no resource link found`);
  return m[1];
};

export const fetchLegacyCsv = async (ds: LegacyDataset): Promise<string> => {
  const resourceUuid = await fetchResourceUuidForDataset(ds.datasetUuid);
  const form = await fetchDownloadForm(resourceUuid);
  const format = ds.format ?? "CSV";
  const body = new URLSearchParams();
  body.set("_token", form.token);
  body.set("resource", form.resourceId);
  body.set("version", form.version);
  body.set("name", form.name);
  body.set("format", format);
  body.set("download", "");
  const downloadUrl = "https://data.egov.bg/resource/download";
  const res = await fetch(downloadUrl, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Accept:
        format === "JSON"
          ? "application/json,text/json,*/*"
          : "text/csv,application/octet-stream,text/plain,*/*",
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `https://data.egov.bg/organisation/datasets/resourceView/${resourceUuid}`,
      Origin: "https://data.egov.bg",
      Cookie: form.cookie,
    },
    body: body.toString(),
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`POST ${downloadUrl} → ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  if (text.startsWith("<!DOCTYPE") || text.startsWith("<html")) {
    throw new Error(
      `POST ${downloadUrl} returned HTML — CSRF/session flow may have changed`,
    );
  }
  return text;
};

// ---- Auto-discovery of new annual-CSV datasets -----------------------------
//
// LEGACY_DATASETS is hand-pinned, so a newly-published year (e.g. АОП posting
// the 2024 contracts dump) would otherwise sit uningested until someone edits
// this file. The OCDS ingester skips annual CSVs (they fail its period
// regex), so nothing picks them up automatically. discoverLegacyDatasets
// walks the АОП org listing, reads each dataset's <h2> title, and returns the
// annual-contracts datasets whose year is NOT already covered by
// LEGACY_DATASETS — the legacy ingester consumes those via `--discover`.

const AOP_ORG_ID = 502;

// АОП titles its annual dump "Договори и изменения на договори - YYYY", but
// the listing title alone is NOT reliable: the 2018 dataset carries that
// exact title yet its resource is the out-of-scope `excl2018.csv`. So a title
// match only nominates a candidate — discovery then reads the detail page's
// resource filename, and only a `contracts<YYYY>*.csv` resource is accepted
// (`excl*` / `annexes*` are rejected).
const annualYearFromTitle = (title: string): string | null => {
  const m = title.match(
    /договори\s+и\s+изменения\s+на\s+договори\s*[-–—]\s*(20\d{2})\b/i,
  );
  return m ? m[1] : null;
};

// Fetch a dataset's detail page and return its resource label — the text
// carrying the actual .csv filename, e.g.
// "Договори, сключени … (contracts2023_CE.csv - данни от ЦАИС ЕОП)".
const fetchResourceLabel = async (datasetUuid: string): Promise<string> => {
  const url = `https://data.egov.bg/data/view/${datasetUuid}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const m = html.match(
    /resourceView\/[0-9a-f-]{36}"[^>]*>[\s\S]*?<span[^>]*class="version"[^>]*>([\s\S]*?)<\/span>/i,
  );
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
};

export const discoverLegacyDatasets = async (): Promise<LegacyDataset[]> => {
  // Dedupe against the pinned list by BOTH year token and UUID: the year
  // guard skips a year already ingested (even if АОП republished it under a
  // fresh UUID — avoids double-counting); the UUID guard skips a pinned
  // dataset before the (network) detail-page check.
  const knownYears = new Set(LEGACY_DATASETS.map((d) => d.year));
  const knownUuids = new Set(LEGACY_DATASETS.map((d) => d.datasetUuid));
  const found = new Map<string, LegacyDataset>();
  for (let page = 1; page <= 15; page++) {
    const url = `https://data.egov.bg/data?org%5B0%5D=${AOP_ORG_ID}&page=${page}`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) {
      throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
    }
    const html = await res.text();
    const re =
      /<a[^>]*href="https?:\/\/data\.egov\.bg\/data\/view\/([0-9a-f-]{36})"[^>]*>\s*<h2[^>]*>([\s\S]*?)<\/h2>/gi;
    let m: RegExpExecArray | null;
    let rows = 0;
    while ((m = re.exec(html))) {
      rows++;
      const uuid = m[1];
      if (knownUuids.has(uuid)) continue;
      const year = annualYearFromTitle(m[2].replace(/\s+/g, " ").trim());
      if (!year) continue;
      // Title nominates it; the resource filename decides.
      const label = await fetchResourceLabel(uuid);
      if (!/\bcontracts[_-]?\d{4}[^()\s]*\.csv/i.test(label)) {
        console.log(
          `  skipping ${uuid}: titled like an annual dump but its resource ` +
            `is not contracts*.csv (${label.slice(0, 70) || "no resource label"})`,
        );
        continue;
      }
      const system: "CE" | "RL" = /_RL|_ROPL|\bРОП\b/i.test(label)
        ? "RL"
        : "CE";
      const yearToken = system === "RL" ? `${year}-RL` : year;
      if (knownYears.has(yearToken) || found.has(yearToken)) continue;
      found.set(yearToken, { year: yearToken, datasetUuid: uuid, system });
    }
    if (rows === 0) break; // past the last page of the listing
  }
  return [...found.values()];
};
