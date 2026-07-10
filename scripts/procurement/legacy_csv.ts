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
// records exists). For 2024 and 2025 АОП publishes ONLY a РОП (RL) annual dump
// — no ЦАИС ЕОП (CE) file — because by then almost all procurement runs on
// ЦАИС ЕОП, which АОП no longer mirrors into an annual CSV. These RL dumps are
// therefore a tiny old-register tail (contracts2024_RL ≈ 136 rows / €37.6M;
// contracts2025_RL ≈ 50 rows / €23.4M), NOT a full-year corpus. The site's
// 2024/2025 contracts are gap-filled from the ЦАИС ЕОП open-data feed (eop-
// ocids) instead; the RL dumps are at most an additive supplement (same role
// the 2022-RL/2023-RL files play next to their CE files) — do NOT swap them in
// for the eop- fill, which is vastly more complete for the ЦАИС era.
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

import { parse } from "csv-parse/sync";
import { Open as Unzip } from "unzipper";
import { canonicalEik, isValidEik } from "./eik";
import { isUnp } from "./unp";
import { overrideAmount } from "./amount_overrides";
import type { Contract } from "./types";
import { toEur } from "@/lib/currency";
import {
  disambiguateContractKeys,
  hashKey,
  legacyKeyDiscriminator,
} from "./contract_key";

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
  // УНП — the procedure's unique number ("00353-2019-0127"), our join key to
  // `tenders.unp`. MUST stay declared BEFORE `tenderId`: buildHeaderMap claims
  // columns in key order, and the РОП files carry BOTH "ID на поръчката" (a
  // bare numeric id) and "УНП". Left to `tenderId`'s looser /id.*на.*поръчк/i,
  // the numeric column was claimed first and the УНП column never bound — which
  // is why the corpus shipped for years with no usable tender lineage. These
  // patterns are strict, so they can never steal `tenderId`'s column.
  unp: [/^унп$/i, /уникален.*номер.*на.*поръчк/i, /уникален.*номер.*поръчка/i],
  // The bare numeric procedure id. Bound for column disambiguation only; never
  // emitted. It belongs to no corpus-wide id space — the ЦАИС `tender_id`
  // sequence does not cover the РОП years.
  tenderId: [/id.*на.*поръчк/i],
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
  unp?: string;
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

// BASE key. The document number groups every lot / обособена позиция of one
// procurement, so two lots awarded to the same supplier under one document
// share this key — disambiguateContractKeys (called at the end of
// parseLegacyCsv) re-keys those collisions by contractId so each lot gets its
// own /contract/:key. A document-id with a single lot keeps this bare key.
const contractKey = (
  datasetUuid: string,
  documentId: string,
  contractorEik: string,
): string => hashKey(`legacy::${datasetUuid}::${documentId}::${contractorEik}`);

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
    // Only a well-formed УНП is kept — some years leave the column blank or
    // carry a stray numeric id. A malformed value would join to nothing and
    // read as "we have lineage" downstream, which is worse than a null.
    const unpRaw = (pick("unp") ?? "").replace(/^"+|"+$/g, "").trim();
    const unp = isUnp(unpRaw) ? unpRaw : undefined;
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
    const parsedAmount = parseAmount(amountRaw);
    // The same publisher-side amount errors reach us through this feed too — the
    // legacy CSV, the ЕОП flat feed and the OCDS bundles each republish the same
    // corrupted contract value. Correct it here as well (amount_overrides.ts).
    const amount =
      overrideAmount({
        unp,
        contractId: contractIdRaw,
        amount: parsedAmount,
      }) ?? parsedAmount;
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
      unp,
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

  // Split lots that share a document number (and thus a base key) into distinct
  // keys. contractId is the per-lot id; the amount tiebreak covers blank ids.
  // Reproduced byte-for-byte by the offline re-derive (dedup_contract_keys.ts)
  // from the same stored fields, so a re-ingest never moves a URL.
  disambiguateContractKeys(rows, (i) => legacyKeyDiscriminator(rows[i]));

  return { rows, stats };
};

// data.egov.bg download flow.
//
// The per-resource endpoint (/resource/download) we used to POST to broke
// around June 2026: for EVERY portal-hosted file resource (old datasets and
// new alike) it now 302-redirects back to the resource page with a Bulgarian
// flash "Грешка при вземане на метаданни за ресурс" ("error retrieving
// resource metadata"). This is NOT a CSRF/session problem on our side — the
// CSRF gate still validates correctly (a bad/absent token yields HTTP 419,
// while a correct token + session cookie yields the 302 + metadata-error
// redirect). The failure is server-side, inside the portal's download
// controller, and no client request shape gets past it.
//
// The dataset-level *bulk-zip* export is a separate endpoint that still works,
// so we route through it instead. Two requests:
//   1. GET /dataset/{datasetUuid}/resources/download/{fmt}
//        (X-Requested-With: XMLHttpRequest) → {uri, format, delete_only_zip}
//   2. GET /dataset/resources/download/zip/{format}/{uri}/{delete_only_zip}
//        → application/zip of every resource in the dataset
// Each annual АОП dump is a single dataset holding just the contracts file
// (plus, sometimes, an annexes/excl file we skip), so the zip is small. We
// unzip it in memory and return the contracts member's text — CSV for normal
// years, the JSON 2D-array export for the ~136 MB 2011-2015 bundle whose raw
// CSV historically 419'd. (This is the same flow scripts/declarations/tr's
// --bulk path uses; the broken per-resource path has no working analogue.)
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) electionsbg.com/1.0";

interface ZipPrepare {
  uri: string;
  format: string;
  delete_only_zip: boolean;
}

const prepareDatasetZip = async (
  datasetUuid: string,
  fmt: "csv" | "json",
): Promise<ZipPrepare> => {
  const url = `https://data.egov.bg/dataset/${datasetUuid}/resources/download/${fmt}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`prepare GET ${url} → ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as Partial<ZipPrepare>;
  if (!json.uri || !json.format) {
    throw new Error(
      `dataset ${datasetUuid}: malformed bulk-zip prepare payload ${JSON.stringify(json)}`,
    );
  }
  return {
    uri: json.uri,
    format: json.format,
    delete_only_zip: !!json.delete_only_zip,
  };
};

// Each annual dump ships the contracts file and, sometimes, an annexes or
// out-of-scope (excl) file. Pick the contracts member; prefer the one whose
// (slugified) name carries the dataset's year when several survive the filter.
const pickContractsEntry = (names: string[], year: string): string | null => {
  const yearOnly = year.split("-")[0];
  const candidates = names.filter(
    (n) => /contracts/i.test(n) && !/annex|excl/i.test(n),
  );
  if (candidates.length === 0) return null;
  return candidates.find((n) => n.includes(yearOnly)) ?? candidates[0];
};

export const fetchLegacyCsv = async (ds: LegacyDataset): Promise<string> => {
  // The bulk-zip export honors csv/json; mirror ds.format so what we return
  // matches the branch parseLegacyCsv takes (CSV text vs JSON 2D-array).
  const fmt: "csv" | "json" = ds.format === "JSON" ? "json" : "csv";
  const prep = await prepareDatasetZip(ds.datasetUuid, fmt);
  const zipUrl = `https://data.egov.bg/dataset/resources/download/zip/${prep.format}/${prep.uri}/${String(prep.delete_only_zip)}`;
  const res = await fetch(zipUrl, {
    headers: {
      "User-Agent": UA,
      Accept: "application/zip,application/octet-stream,*/*",
    },
  });
  if (!res.ok) {
    throw new Error(`bulk-zip GET ${zipUrl} → ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  // PK\x03\x04 / PK\x05\x06 (empty) — a non-zip body here means the portal
  // served the HTML shell or an error page instead of the archive.
  if (buf.subarray(0, 2).toString("latin1") !== "PK") {
    const head = buf.subarray(0, 160).toString("utf-8");
    throw new Error(
      `bulk-zip for dataset ${ds.datasetUuid} (${ds.year}) was not a zip ` +
        `(content-type ${res.headers.get("content-type") ?? "?"}): ${head.slice(0, 120)}`,
    );
  }
  const dir = await Unzip.buffer(buf);
  const names = dir.files.map((f) => f.path);
  const entryName = pickContractsEntry(names, ds.year);
  if (!entryName) {
    throw new Error(
      `dataset ${ds.datasetUuid} (${ds.year}): no contracts member in zip ` +
        `(members: ${names.join(", ") || "none"})`,
    );
  }
  const entry = dir.files.find((f) => f.path === entryName);
  if (!entry) {
    throw new Error(`dataset ${ds.datasetUuid}: zip entry "${entryName}" gone`);
  }
  const text = (await entry.buffer()).toString("utf-8");
  if (text.startsWith("<!DOCTYPE") || text.startsWith("<html")) {
    throw new Error(
      `dataset ${ds.datasetUuid}: contracts member "${entryName}" is HTML, not data`,
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
