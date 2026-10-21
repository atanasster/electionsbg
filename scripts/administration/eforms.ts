// МЕУ „Списък на заявените услуги през надградената система еФорми" (data.egov.bg dataset
// 20218): how many times each electronic administrative service was REQUESTED through the
// upgraded еФорми system, one resource per month.
//
// What it is NOT, and every consumer must say so:
//   * not all e-government — only services requested through еФорми under the „Единен модел"
//     (РМС 806/2023). A service a body runs on its own portal is absent, not zero;
//   * not completions — „заявени" counts requests, with no outcome;
//   * not a continuous series — months are MISSING (2025-01…04, 2025-07…08, 2026-02 as of
//     2026-10-21). A missing month is unpublished, never a month with no requests, so a yearly
//     total must state how many months it spans.
//
// The service id is the ИИСДА id `admin_services.service_id` (068) carries, so the two join.

export const EFORMS_DATASET_ID = 20218;
export const EFORMS_DATASET_URI = "6e8f01d1-18f7-4438-a0bb-d796adb40d67";

/** The three columns every month has carried since 2024-02. A change is a format change, and
 *  reading the counts out of a reordered table would publish the wrong service's volume. */
export const EFORMS_HEADERS = [
  "Идентификатор на услугата",
  "Наименование на услуга",
  "Брой заявени услуги",
] as const;

/** One row on disk: [serviceId, name, requests] — the keyed form repeats three keys on every
 *  one of ~3,000 rows, which is most of the file. */
export type EformsRowTuple = [string, string, number];

export interface EformsRow {
  serviceId: string;
  name: string;
  requests: number;
}

export interface EformsMonth {
  /** YYYY-MM, from the resource NAME („… еФорми( 2026-07 )"). */
  period: string;
  resourceUri: string;
  /** The portal's own stamp for the resource, as published. */
  updatedAt: string;
  rows: EformsRow[];
}

interface EformsMonthOnDisk extends Omit<EformsMonth, "rows"> {
  rows: EformsRowTuple[];
}

export interface EformsSnapshot {
  datasetId: number;
  datasetUri: string;
  fetchedAt: string;
  months: EformsMonth[];
}

/** „…еФорми( 2026-07 )" → "2026-07", or null when the name carries no month. */
export const periodOfResourceName = (name: string): string | null => {
  const m = /\(\s*(\d{4})-(\d{2})\s*\)\s*$/.exec(name);
  if (!m) return null;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12 ? `${m[1]}-${m[2]}` : null;
};

const cell = (v: unknown): string => (v == null ? "" : String(v).trim());

/** getResourceData returns either `{headers, row1, row2, …}` (this dataset) or a plain 2D
 *  array (the budget datasets). Both become [headers, ...rows]. */
export const tableOf = (data: unknown): string[][] => {
  if (Array.isArray(data)) return data.map((r) => (r as unknown[]).map(cell));
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (!Array.isArray(o.headers)) return [];
    const rows = Object.keys(o)
      .filter((k) => /^row\d+$/.test(k))
      .sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)))
      .map((k) => (o[k] as unknown[]).map(cell));
    return [(o.headers as unknown[]).map(cell), ...rows];
  }
  return [];
};

/** One month's table → rows. Throws on anything that is not the three-column shape with a
 *  non-negative integer count: a silently skipped row is a service whose requests vanish. A
 *  service listed twice in one month is SUMMED — it is the same service's requests either way,
 *  and keeping both rows would break the (period, service) key. */
export const parseEformsTable = (
  table: string[][],
  period: string,
): EformsRow[] => {
  const [headers, ...body] = table;
  if (!headers || headers.join("|") !== EFORMS_HEADERS.join("|"))
    throw new Error(
      `${period}: unexpected headers ${JSON.stringify(headers)} — the table format changed`,
    );
  const byId = new Map<string, EformsRow>();
  for (const [i, r] of body.entries()) {
    if (r.every((c) => c === "")) continue;
    const [serviceId, name, n] = r;
    if (!/^\d+$/.test(serviceId ?? "") || !name || !/^\d+$/.test(n ?? ""))
      throw new Error(
        `${period}: row ${i + 1} is malformed: ${JSON.stringify(r)}`,
      );
    const prev = byId.get(serviceId);
    if (prev) prev.requests += Number(n);
    else byId.set(serviceId, { serviceId, name, requests: Number(n) });
  }
  if (!byId.size)
    throw new Error(`${period}: no rows — refusing an empty month`);
  return [...byId.values()].sort(
    (a, b) => b.requests - a.requests || a.serviceId.localeCompare(b.serviceId),
  );
};

/** Months present in `prev` and absent from `next`. A resource withdrawn by the publisher is a
 *  real event, but it is far more often a failed fetch — the caller refuses unless told. */
export const droppedPeriods = (
  prev: readonly EformsMonth[],
  next: readonly EformsMonth[],
): string[] => {
  const have = new Set(next.map((m) => m.period));
  return prev.map((m) => m.period).filter((p) => !have.has(p));
};

/** The committed form: one line per row, so a month's change is a readable diff. */
export const serialiseEforms = (snap: EformsSnapshot): string => {
  const months = snap.months.map((m) => {
    const head = JSON.stringify({
      period: m.period,
      resourceUri: m.resourceUri,
      updatedAt: m.updatedAt,
    }).slice(0, -1);
    const rows = m.rows
      .map((r) => "    " + JSON.stringify([r.serviceId, r.name, r.requests]))
      .join(",\n");
    return `  ${head},"rows":[\n${rows}\n  ]}`;
  });
  const head = JSON.stringify({
    datasetId: snap.datasetId,
    datasetUri: snap.datasetUri,
    fetchedAt: snap.fetchedAt,
  }).slice(0, -1);
  return `${head},"months":[\n${months.join(",\n")}\n]}\n`;
};

/** The committed file → the snapshot. */
export const parseEformsSnapshot = (text: string): EformsSnapshot => {
  const raw = JSON.parse(text) as Omit<EformsSnapshot, "months"> & {
    months: EformsMonthOnDisk[];
  };
  return {
    ...raw,
    months: raw.months.map((m) => ({
      ...m,
      rows: m.rows.map(([serviceId, name, requests]) => ({
        serviceId,
        name,
        requests,
      })),
    })),
  };
};
