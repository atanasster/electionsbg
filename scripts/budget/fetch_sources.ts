// Source fetchers for the budget pipeline. Downloads are cached gzipped under
// raw_data/budget/ (gitignored) so re-runs of the parsers don't re-fetch.
//
// Phase 1 sources:
//   - data.egov.bg dataset 79ce7de2-… — "State budget execution by major
//     budget indicators". One resource per monthly snapshot, each a 2D array
//     [label, law, execution, %]. This is the primary, fully machine-readable
//     source and the one Phase 1 hard-depends on.
//   - bulnao.government.bg — Сметна палата audit-report listing. Best-effort,
//     non-fatal: feeds the document index but the ingest does not require it.
//   - minfin.bg КФП statistics pages — frequently 403s automated clients;
//     fetched best-effort, never fatal. The egov feed already carries the
//     state-budget execution series Phase 1 needs.

import fs from "fs";
import zlib from "zlib";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_DIR = path.resolve(__dirname, "../../raw_data/budget");
const UA =
  "Mozilla/5.0 (compatible; electionsbg-budget/1.0; +https://electionsbg.com)";

export const EGOV_DATASET_UUID = "79ce7de2-0150-4ba7-a96c-dbacb76c95b6";
const EGOV_DATASET_URL = `https://data.egov.bg/data/view/${EGOV_DATASET_UUID}`;
const egovResourceUrl = (uuid: string): string =>
  `https://data.egov.bg/resource/download/${uuid}/json`;

export const BULNAO_AUDIT_URL =
  "https://www.bulnao.government.bg/bg/oditna-dejnost/dokladi/";

// State Budget Law promulgations on Държавен вестник, keyed by fiscal year.
// `idMat` is the DV material id; the law text + per-spending-unit appropriation
// tables are served as HTML at showMaterialDV.jsp?idMat=<id>. Hand-curated —
// add a new year when its budget law is promulgated (resolve the idMat from
// dv.parliament.bg). The 2026 law is intentionally absent until promulgated.
export const LAW_DV_MATERIALS: Record<number, string> = {
  2020: "143562", // ДВ бр.100 от 2019-12-20
  // 2021 intentionally absent — caretaker year, no adopted budget law
  2022: "170229", // ДВ бр.18 от 2022-03-04
  2023: "198020", // ДВ бр.66 от 2023-08-01 (delayed adoption due to political instability)
  2024: "202168", // ДВ бр.108 от 2023-12-30
  2025: "233694", // ДВ бр.26 от 2025-03-27
};

// Mid-year amendments to a State Budget Law ("Закон за изменение [и допълнение]
// на ЗДБ"), promulgated in Държавен вестник. Unlike the budget law itself, an
// amendment's DV HTML carries no per-spending-unit "Приема бюджета на …"
// appropriation tables — it either restates just the чл. 1 aggregate framework
// or defers the figures to an external PDF appendix. So these are catalogued in
// documents.json for provenance only; the per-ministry amended appropriation
// comes from the year-end execution report, not from re-parsing these.
// Hand-curated — resolve the idMat from dv.parliament.bg and add a row when a
// new amendment is promulgated.
export interface AmendmentDvMaterial {
  fiscalYear: number;
  seq: number; // 1..N — the amendment's ordinal within its fiscal year
  idMat: string;
  promulgationDate: string; // ISO — the Държавен вестник promulgation date
  dvIssue: string; // "ДВ бр. 52 от 2022 г." — for the source label
  title: string;
}

export const AMENDMENT_DV_MATERIALS: AmendmentDvMaterial[] = [
  {
    fiscalYear: 2022,
    seq: 1,
    idMat: "174605",
    promulgationDate: "2022-07-05",
    dvIssue: "ДВ бр. 52 от 2022 г.",
    title:
      "Закон за изменение и допълнение на Закона за държавния бюджет на " +
      "Република България за 2022 г.",
  },
  {
    fiscalYear: 2024,
    seq: 1,
    idMat: "213420",
    promulgationDate: "2024-04-30",
    dvIssue: "ДВ бр. 38 от 2024 г.",
    title:
      "Закон за изменение на Закона за държавния бюджет на Република " +
      "България за 2024 г.",
  },
];

const lawHtmlUrl = (idMat: string): string =>
  `https://dv.parliament.bg/DVWeb/showMaterialDV.jsp?idMat=${idMat}`;

// Per-ministry program-budget execution reports ("Отчет за изпълнението на
// програмния бюджет"). Each first-level spending unit publishes its own on its
// own website; minfin.bg's consolidated report WAF-blocks automated clients, so
// these per-ministry reports are the viable source for ministry-level execution.
// Hand-curated: `adminId` is the curated crosswalk to the classification node
// (we know which unit each URL belongs to), `url` points at the full-year
// ("31.12") report. Add a row when a ministry publishes a new fiscal year.
//
// `format` discriminates fetch + parse paths:
//   - "pdf"             — bare PDF with ruled cell borders; pdf_table.ts →
//                         execution_pdf.ts.
//   - "pdf-borderless"  — bare PDF whose tables are text-positioned only
//                         (no cell-border rectangles, e.g. MOD); pdf2array →
//                         execution_borderless_pdf.ts. `trailingValueCount`
//                         is the number of trailing numeric cells per
//                         programme row (positional column convention —
//                         typically 6 for the quarterly-cumulative layout
//                         [law, amended, Q1, H1, 9M, Y]).
//   - "xlsx-in-zip"     — ZIP at `url` containing the XLSX named in
//                         `entryName`; the fetcher pulls the ZIP, extracts
//                         the entry, and execution_xlsx.ts parses it.
//   - "manual-pdf"      — bare PDF that the pipeline CANNOT download (e.g.
//                         WAF-blocked sites like minfin.bg, mvr.bg). The
//                         operator manually saves the PDF to
//                         `raw_data/budget/exec-<adminId>-<fy>.pdf` and the
//                         pipeline reads from cache only. `url` is
//                         informational (where to fetch from in a browser);
//                         `trailingValueCount` (optional) dispatches to the
//                         borderless parser when present, else the bordered
//                         one. A missing cached file is non-fatal — the run
//                         logs a warning and skips that ministry.
export type ExecutionReportSource =
  | {
      fiscalYear: number;
      adminId: string; // data/budget/classification/admin.json node id
      unitNameBg: string;
      format: "pdf";
      url: string; // human-readable; encodeURI()'d at fetch time
    }
  | {
      fiscalYear: number;
      adminId: string;
      unitNameBg: string;
      format: "pdf-borderless";
      url: string;
      trailingValueCount: number;
    }
  | {
      fiscalYear: number;
      adminId: string;
      unitNameBg: string;
      format: "xlsx-in-zip";
      url: string;
      entryName: string; // the .xlsx path inside the archive
    }
  | {
      fiscalYear: number;
      adminId: string;
      unitNameBg: string;
      format: "manual-pdf";
      url: string; // informational only — for browser download
      trailingValueCount?: number; // present → borderless parser
    };

export const EXECUTION_REPORTS: ExecutionReportSource[] = [
  // FY2023 — backfilled. Three ministries confirmed parseable; others either
  // weren't published as the standard full-year programme report for 2023
  // (Tourism), have URLs that aren't in their current site listings (MOD's
  // doc archive only retains the last ~2 years), or use hash-based filenames
  // that aren't year-substitutable (МОСВ, МИР).
  {
    fiscalYear: 2023,
    adminId: "admin-ministerstvoto-na-ikonomikata-i-industriyata",
    unitNameBg: "Министерството на икономиката и индустрията",
    format: "pdf",
    url: "https://www.mi.government.bg/files/useruploads/files/budget/2000_Otchet programi 31.12.2023 MII.pdf",
  },
  {
    fiscalYear: 2023,
    adminId: "admin-ministerstvoto-na-zdraveopazvaneto",
    unitNameBg: "Министерството на здравеопазването",
    format: "pdf",
    url: "https://www.mh.government.bg/upload/11890/otchet_mz_programen_31122023.pdf",
  },
  {
    fiscalYear: 2023,
    adminId: "admin-ministerstvoto-na-truda-i-sotsialnata-politika",
    unitNameBg: "Министерството на труда и социалната политика",
    format: "xlsx-in-zip",
    url: "https://www.mlsp.government.bg/uploads/11/finansi-1/na-mtsp-za-2023-g.zip",
    entryName: "31.12.2023/1500-Otchet programi-31.12.2023.xlsx",
  },
  // FY2024
  {
    fiscalYear: 2024,
    adminId: "admin-ministerstvoto-na-ikonomikata-i-industriyata",
    unitNameBg: "Министерството на икономиката и индустрията",
    format: "pdf",
    url: "https://www.mi.government.bg/files/useruploads/files/budget/2000_Otchet programi 31.12.2024 MII.pdf",
  },
  {
    fiscalYear: 2024,
    adminId: "admin-ministerstvoto-na-zdraveopazvaneto",
    unitNameBg: "Министерството на здравеопазването",
    format: "pdf",
    url: "https://www.mh.government.bg/upload/13778/OTCHET_MZ_PROGRAMEN_31.12.2024 - публикуване.pdf",
  },
  {
    fiscalYear: 2024,
    adminId: "admin-ministerstvoto-na-inovatsiite-i-rastezha",
    unitNameBg: "Министерството на иновациите и растежа",
    format: "pdf",
    url: "https://www.mig.government.bg/wp-content/uploads/2025/02/otchet-za-izpalnenieto-na-programniya-byudzhet-na-mir-kam-31.12.2024-g.pdf",
  },
  {
    fiscalYear: 2024,
    adminId: "admin-ministerstvoto-na-okolnata-sreda-i-vodite",
    unitNameBg: "Министерството на околната среда и водите",
    format: "pdf",
    url: "https://www.moew.government.bg/static/media/ups/articles/attachments/1900_MOEW_Doklad_Otchet 202498ff9b70b3e3a3a3dc7d122afbc379df.pdf",
  },
  {
    fiscalYear: 2024,
    adminId: "admin-ministerstvoto-na-turizma",
    unitNameBg: "Министерството на туризма",
    format: "pdf",
    url: "https://www.tourism.government.bg/sites/tourism.government.bg/files/uploads/Budjet/2024/otchet_-_mt_31.12.2024_finale.pdf",
  },
  // MLSP publishes its programme report as an XLSX bundled inside a ZIP. The
  // XLSX has 4 cumulative Отчет columns (Q1, H1, 9M, Y); execution_xlsx.ts
  // picks the rightmost. The unit total is not published as a row in the
  // sheet — execution_xlsx.ts sums the policy-area ".00" rows instead.
  // `entryName` is matched as a suffix to be robust to the ZIP's filename
  // encoding (legacy ZIPs may put Cyrillic in CP1251 instead of UTF-8).
  {
    fiscalYear: 2024,
    adminId: "admin-ministerstvoto-na-truda-i-sotsialnata-politika",
    unitNameBg: "Министерството на труда и социалната политика",
    format: "xlsx-in-zip",
    url: "https://www.mlsp.government.bg/uploads/11/finansi-1/na-mtsp-za-2024-g.zip",
    entryName: "31.12.2024/1500-Otchet programi-31.12.2024.xlsx",
  },
  // MOD's PDF draws no cell borders — only row-shading bars. pdf_table.ts is
  // blind to it; pdf2array reads its text-positioned tables cleanly. Each
  // programme row carries 6 trailing numbers: [Закон, Уточнен план, Отчет к
  // 31.03, 30.06, 30.09, 31.12]; the rightmost is the year-end value.
  {
    fiscalYear: 2024,
    adminId: "admin-ministerstvoto-na-otbranata",
    unitNameBg: "Министерството на отбраната",
    format: "pdf-borderless",
    url: "https://www.mod.bg/documents/6810b54553c8a_20251504_Otchet_programi-31.12.2024.pdf",
    trailingValueCount: 6,
  },
  // ──────────────────────────────────────────────────────────────────────
  // Manual-fetch ministries — sites that WAF-block automated downloads.
  // The operator opens `url` in a real browser, saves the PDF to
  // `raw_data/budget/exec-<adminId>-<fy>.pdf`, and re-runs ingest. A
  // missing cached file is non-fatal — the run logs a warning and skips
  // that ministry, so the rest of the pipeline still completes.
  //
  // To activate any of these: uncomment the entry, manually download the
  // file, save it at the cache path above, then `npm run budget:ingest`.
  // ──────────────────────────────────────────────────────────────────────
  // {
  //   fiscalYear: 2024,
  //   adminId: "admin-ministerstvoto-na-vatreshnite-raboti",
  //   unitNameBg: "Министерството на вътрешните работи",
  //   format: "manual-pdf",
  //   url: "https://www.mvr.bg/upload/279894/1300_bu_3_122024-rezume.pdf",
  // },
  // {
  //   fiscalYear: 2024,
  //   adminId: "admin-ministerstvoto-na-finansite",
  //   unitNameBg: "Министерството на финансите",
  //   format: "manual-pdf",
  //   url: "https://www.minfin.bg/bg/725",
  // },
];

// A single egov resource: a 2D string array. Row 0 is the header.
export type EgovResource = string[][];

const fetchText = async (
  url: string,
  opts: { allow403?: boolean } = {},
): Promise<string | null> => {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json, text/html" },
        redirect: "follow",
      });
      if ((res.status === 403 || res.status === 404) && opts.allow403) {
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  if (opts.allow403) return null;
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
};

// Walk the dataset page and pull every resource UUID. The CKAN-style /api
// endpoints on data.egov.bg are broken (return success:false), so — same as
// the procurement watcher — we parse the HTML. The dataset is paginated
// (`?rpage=N`); we read the page-1 pagination strip to get the max page, then
// walk pages 2…N. Without this the ingest only sees the most recent ~10
// monthly resources, which silently truncates the КФП history to a few months
// (and breaks the seasonal projection — no same-month prior-year anchor).
export const fetchEgovResourceUuids = async (): Promise<string[]> => {
  const firstHtml = await fetchText(EGOV_DATASET_URL);
  if (!firstHtml) throw new Error("empty egov budget dataset page");
  const collect = (html: string): string[] =>
    Array.from(html.matchAll(/resourceView\/([0-9a-f-]{36})/gi)).map(
      (m) => m[1],
    );
  const all = new Set<string>(collect(firstHtml));
  const pageNums = Array.from(firstHtml.matchAll(/[?&]rpage=(\d+)/g))
    .map((m) => parseInt(m[1], 10))
    .filter((n) => Number.isFinite(n) && n > 1);
  const maxPage = pageNums.length > 0 ? Math.max(...pageNums) : 1;
  for (let p = 2; p <= maxPage; p++) {
    const html = await fetchText(`${EGOV_DATASET_URL}?rpage=${p}`);
    if (!html) continue;
    for (const uuid of collect(html)) all.add(uuid);
  }
  if (all.size === 0) {
    throw new Error(
      `egov budget dataset ${EGOV_DATASET_UUID} yielded zero resource UUIDs — ` +
        `the page structure likely changed`,
    );
  }
  return [...all];
};

const cachePath = (uuid: string): string =>
  path.join(CACHE_DIR, `egov-${uuid}.json.gz`);

// Download one egov resource. Reads the gzipped cache when present.
export const fetchEgovResource = async (
  uuid: string,
  opts: { refresh?: boolean } = {},
): Promise<EgovResource> => {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cache = cachePath(uuid);
  if (!opts.refresh && fs.existsSync(cache)) {
    const text = zlib.gunzipSync(fs.readFileSync(cache)).toString("utf8");
    return JSON.parse(text) as EgovResource;
  }
  const text = await fetchText(egovResourceUrl(uuid));
  if (!text) throw new Error(`empty response for egov resource ${uuid}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `egov resource ${uuid} did not return JSON: ${text.slice(0, 120)}`,
    );
  }
  if (!Array.isArray(parsed) || !Array.isArray(parsed[0])) {
    throw new Error(`egov resource ${uuid} is not a 2D array`);
  }
  try {
    fs.writeFileSync(cache, zlib.gzipSync(text, { level: 9 }));
  } catch (e) {
    console.warn(`  cache write failed for ${uuid}: ${(e as Error).message}`);
  }
  return parsed as EgovResource;
};

// Fetch a State Budget Law's promulgated HTML from Държавен вестник. The page
// is large (~6 MB) and rarely changes once promulgated, so it is gzip-cached
// under raw_data/budget/ like the egov resources.
export const fetchLawHtml = async (
  fiscalYear: number,
  idMat: string,
  opts: { refresh?: boolean } = {},
): Promise<string> => {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cache = path.join(CACHE_DIR, `law-${fiscalYear}.html.gz`);
  if (!opts.refresh && fs.existsSync(cache)) {
    return zlib.gunzipSync(fs.readFileSync(cache)).toString("utf8");
  }
  const html = await fetchText(lawHtmlUrl(idMat));
  if (!html || html.length < 10000) {
    throw new Error(
      `budget law ${fiscalYear} (idMat=${idMat}): empty or too-small response`,
    );
  }
  try {
    fs.writeFileSync(cache, zlib.gzipSync(html, { level: 9 }));
  } catch (e) {
    console.warn(
      `  cache write failed for law-${fiscalYear}: ${(e as Error).message}`,
    );
  }
  return html;
};

export const lawDvUrl = lawHtmlUrl;

// Fetch a ministry's program-budget execution report PDF. Cached raw under
// raw_data/budget/ (PDFs are already compressed — no gzip). The report changes
// only when a new fiscal year is published, so the cache is effectively
// permanent per (unit, year).
export const fetchExecutionPdf = async (
  adminId: string,
  fiscalYear: number,
  url: string,
  opts: { refresh?: boolean } = {},
): Promise<Uint8Array> => {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cache = path.join(CACHE_DIR, `exec-${adminId}-${fiscalYear}.pdf`);
  if (!opts.refresh && fs.existsSync(cache)) {
    return new Uint8Array(fs.readFileSync(cache));
  }
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(encodeURI(url), {
        headers: { "User-Agent": UA, Accept: "application/pdf,*/*" },
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      // %PDF magic — guards against a CMS serving an HTML error page with 200
      if (
        bytes.length < 10000 ||
        bytes[0] !== 0x25 ||
        bytes[1] !== 0x50 ||
        bytes[2] !== 0x44 ||
        bytes[3] !== 0x46
      ) {
        throw new Error(
          `response is not a PDF (${bytes.length} bytes, starts ` +
            `"${Buffer.from(bytes.slice(0, 8)).toString("latin1")}")`,
        );
      }
      try {
        fs.writeFileSync(cache, bytes);
      } catch (e) {
        console.warn(
          `  cache write failed for exec-${adminId}-${fiscalYear}: ${(e as Error).message}`,
        );
      }
      return bytes;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  throw new Error(
    `execution report ${adminId} ${fiscalYear}: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
};

// Download a ministry's execution-report ZIP and extract the named XLSX
// entry. The XLSX bytes are cached under raw_data/budget/ (the source ZIP is
// not — we don't need it once the entry is extracted). `entryNameSuffix` is
// matched as a suffix against every entry path because legacy ZIPs sometimes
// encode filenames in CP1251 instead of UTF-8; ASCII-suffix matching is
// encoding-agnostic.
export const fetchExecutionZipXlsx = async (
  adminId: string,
  fiscalYear: number,
  zipUrl: string,
  entryNameSuffix: string,
  opts: { refresh?: boolean } = {},
): Promise<Uint8Array> => {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cache = path.join(CACHE_DIR, `exec-${adminId}-${fiscalYear}.xlsx`);
  if (!opts.refresh && fs.existsSync(cache)) {
    return new Uint8Array(fs.readFileSync(cache));
  }
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(encodeURI(zipUrl), {
        headers: { "User-Agent": UA, Accept: "application/zip,*/*" },
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const zipBytes = Buffer.from(await res.arrayBuffer());
      // PK\x03\x04 magic
      if (
        zipBytes.length < 100 ||
        zipBytes[0] !== 0x50 ||
        zipBytes[1] !== 0x4b
      ) {
        throw new Error(
          `response is not a ZIP (${zipBytes.length} bytes, starts ` +
            `"${zipBytes.subarray(0, 8).toString("latin1")}")`,
        );
      }
      // unzipper is a streaming API, but the file is small (~12 MB) so we
      // buffer in memory.
      const unzipper = (await import("unzipper")) as unknown as {
        Open: { buffer: (b: Buffer) => Promise<{ files: ZipEntry[] }> };
      };
      const directory = await unzipper.Open.buffer(zipBytes);
      const entry = directory.files.find((f) =>
        f.path.endsWith(entryNameSuffix),
      );
      if (!entry) {
        const names = directory.files
          .filter((f) => f.path.toLowerCase().endsWith(".xlsx"))
          .map((f) => f.path)
          .slice(0, 8);
        throw new Error(
          `entry ending "${entryNameSuffix}" not found in ${zipUrl}. ` +
            `Available .xlsx entries: ${JSON.stringify(names)}`,
        );
      }
      const xlsxBytes = new Uint8Array(await entry.buffer());
      // PK magic (XLSX is itself a ZIP)
      if (
        xlsxBytes.length < 1000 ||
        xlsxBytes[0] !== 0x50 ||
        xlsxBytes[1] !== 0x4b
      ) {
        throw new Error(
          `extracted entry is not a valid XLSX (${xlsxBytes.length} bytes)`,
        );
      }
      try {
        fs.writeFileSync(cache, xlsxBytes);
      } catch (e) {
        console.warn(
          `  cache write failed for exec-${adminId}-${fiscalYear}.xlsx: ${(e as Error).message}`,
        );
      }
      return xlsxBytes;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  throw new Error(
    `execution report ${adminId} ${fiscalYear} (xlsx-in-zip): ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
};

// Minimal shape of an unzipper entry — only the bits we use.
interface ZipEntry {
  path: string;
  buffer: () => Promise<Buffer>;
}

// Read a manually-saved execution-report PDF from the cache directory. The
// caller is the operator: they download the file in a browser (the source
// site WAF-blocks automated clients) and save it at the cache path returned
// in the error message. Throws `ManualFetchMissing` when the file is absent
// so the ingest loop can skip that ministry non-fatally.
export class ManualFetchMissing extends Error {
  constructor(
    public readonly adminId: string,
    public readonly fiscalYear: number,
    public readonly cachePath: string,
    public readonly sourceUrl: string,
  ) {
    super(
      `manual-pdf cache file missing for ${adminId} ${fiscalYear}. ` +
        `Open ${sourceUrl} in a browser, save the PDF to ${cachePath}, ` +
        `then re-run ingest.`,
    );
    this.name = "ManualFetchMissing";
  }
}

export const readManualExecutionPdf = (
  adminId: string,
  fiscalYear: number,
  sourceUrl: string,
): Uint8Array => {
  const cache = path.join(CACHE_DIR, `exec-${adminId}-${fiscalYear}.pdf`);
  if (!fs.existsSync(cache)) {
    throw new ManualFetchMissing(adminId, fiscalYear, cache, sourceUrl);
  }
  const bytes = new Uint8Array(fs.readFileSync(cache));
  // %PDF magic
  if (
    bytes.length < 1000 ||
    bytes[0] !== 0x25 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x44 ||
    bytes[3] !== 0x46
  ) {
    throw new Error(
      `manual-pdf cache file at ${cache} is not a valid PDF ` +
        `(${bytes.length} bytes, starts ` +
        `"${Buffer.from(bytes.slice(0, 8)).toString("latin1")}")`,
    );
  }
  return bytes;
};

// Best-effort fetch of the bulnao audit-report listing HTML. Non-fatal:
// returns null on any failure so the ingest still completes.
export const fetchBulnaoAuditHtml = async (): Promise<string | null> => {
  try {
    return await fetchText(BULNAO_AUDIT_URL, { allow403: true });
  } catch (e) {
    console.warn(
      `  bulnao audit listing fetch failed: ${(e as Error).message}`,
    );
    return null;
  }
};
