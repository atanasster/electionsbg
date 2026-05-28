// Thin client for the data.egov.bg JSON API.
//
// Two endpoints we rely on, both POST + JSON body (NOT GET query-string):
//   POST /api/listDatasets    { criteria: { org_ids:[N] }, records_per_page, page_number }
//   POST /api/getResourceData { resource_uri }
//
// Note: the GET-style "searchDataset"/"getOrganisations" routes return
// {success:false, status:404} ("Непознат метод"), which is why other egov
// integrations in this repo (procurement, declarations, the budget-execution
// watcher) scrape the HTML listing instead. The two POST methods below DO
// work and return structured JSON — do NOT "fix" this back to HTML scraping.
//
// getResourceData returns the resource as a 2D row array (data: unknown[][]),
// the same shape XLSX.utils.sheet_to_json(..., { header: 1 }) produces, so a
// portal-hosted CSV feeds straight into the município capital-programme
// parsers with no XLSX round-trip.

const BASE = "https://data.egov.bg/api";
const UA = "electionsbg.com data pipeline (egov)";

export interface EgovResource {
  id: number;
  uri: string;
  name: string;
  file_format: number | null; // 1 ≈ CSV; null for external-link resources
  resource_type: number | null;
  resource_url: string | null; // null = portal-hosted; set = link to publisher site
  updated_at: string; // "YYYY-MM-DD HH:MM:SS"
  created_at: string;
}

export interface EgovDataset {
  id: number;
  uri: string;
  org_id: number;
  name: string;
  category_id: number;
  updated_at: string;
  created_at: string;
  resources: EgovResource[];
}

interface RawDataset extends Omit<EgovDataset, "resources"> {
  resource?: Record<string, EgovResource> | EgovResource[];
}

const post = async <T>(method: string, body: unknown): Promise<T> => {
  const res = await fetch(`${BASE}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${method} → ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { success?: boolean } & Record<
    string,
    unknown
  >;
  if (json.success === false) {
    throw new Error(
      `egov ${method} returned success:false — ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json as T;
};

// The API nests resources as an object keyed by resource-uri; normalise to an
// array so callers don't care about the wire shape.
const normaliseResources = (raw: RawDataset): EgovResource[] => {
  const r = raw.resource;
  if (!r) return [];
  return Array.isArray(r) ? r : Object.values(r);
};

export const listDatasets = async (
  orgId: number,
  opts: { recordsPerPage?: number } = {},
): Promise<EgovDataset[]> => {
  const json = await post<{ datasets?: RawDataset[] }>("listDatasets", {
    criteria: { org_ids: [orgId] },
    records_per_page: opts.recordsPerPage ?? 100,
    page_number: 1,
  });
  return (json.datasets ?? []).map((d) => ({
    id: d.id,
    uri: d.uri,
    org_id: d.org_id,
    name: d.name,
    category_id: d.category_id,
    updated_at: d.updated_at,
    created_at: d.created_at,
    resources: normaliseResources(d),
  }));
};

export const getResourceData = async (
  resourceUri: string,
): Promise<unknown[][]> => {
  const json = await post<{ data?: unknown[][] }>("getResourceData", {
    resource_uri: resourceUri,
  });
  return json.data ?? [];
};

const NORM_RE = new RegExp("[\\s\\u00a0\\u2007\\u202f]+", "g");
const norm = (s: string): string =>
  s.toLowerCase().replace(NORM_RE, " ").trim();

export type BudgetDatasetKind = "capital" | "revenue" | "expense" | "execution";

const KIND_KEYWORDS: Record<BudgetDatasetKind, RegExp> = {
  // Приложение №3 / "Разчет за финансиране на капиталовите разходи" /
  // "Капиталова програма".
  capital: /капиталов|капиталова програма|разчет за финансиране/i,
  revenue: /за приходите|приходи/i,
  expense: /за разходите|разходи(?!те за финансиране)/i,
  // "Отчети за касово изпълнение" / "Данни за бюджет ... и разходването му".
  execution: /касово изпълнение|отчет.*изпълнение|разходването му/i,
};

// Find the dataset+resource for a given fiscal year and document kind. Returns
// the single best resource match (portal-hosted preferred over link-outs).
export const findBudgetResource = (
  datasets: EgovDataset[],
  year: number,
  kind: BudgetDatasetKind,
): { dataset: EgovDataset; resource: EgovResource } | null => {
  const yr = String(year);
  const kindRe = KIND_KEYWORDS[kind];
  const candidates: Array<{ dataset: EgovDataset; resource: EgovResource }> =
    [];
  for (const ds of datasets) {
    const dsName = norm(ds.name);
    const dsHasYear = dsName.includes(yr);
    for (const r of ds.resources) {
      const rName = norm(r.name);
      // The year may appear on either the dataset or the resource.
      if (!dsHasYear && !rName.includes(yr)) continue;
      if (!kindRe.test(rName) && !kindRe.test(dsName)) continue;
      candidates.push({ dataset: ds, resource: r });
    }
  }
  if (candidates.length === 0) return null;
  // Prefer portal-hosted resources (resource_url null) — those return data via
  // getResourceData. Among those, prefer the most recently updated.
  candidates.sort((a, b) => {
    const aHosted = a.resource.resource_url == null ? 0 : 1;
    const bHosted = b.resource.resource_url == null ? 0 : 1;
    if (aHosted !== bHosted) return aHosted - bHosted;
    return a.resource.updated_at < b.resource.updated_at ? 1 : -1;
  });
  return candidates[0];
};
