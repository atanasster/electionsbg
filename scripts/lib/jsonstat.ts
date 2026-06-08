/**
 * Minimal JSON-stat v2 reader for NSI's open-data API.
 *
 * NSI exposes regional cross-sections (health, FDI, culture, …) that the
 * static timeseries XLSX files don't carry, at:
 *   http://www.nsi.bg/opendata/getopendata_json.php?l=bg&id=<N>
 * cataloged on data.egov.bg under org_id 143. The response is JSON-stat v2
 * (`class:"dataset"`, flat `value` array indexed row-major across the
 * dimensions listed in `id`, with cardinalities in `size`) — the same shape
 * the Eurostat fetcher already parses, generalised here to N dimensions.
 *
 * The datasets are multi-dimensional (periods · units · geo · one or two
 * breakdowns like facility-type / measure), so the caller pins every
 * non-geo, non-time dimension to a single category (by key or by a
 * label/key matcher); singleton dimensions auto-pin. The reader then walks
 * geo × time and returns geoKey → year → value.
 */

const UA = "electionsbg.com data pipeline (nsi-opendata)";

export type PinSpec = string | RegExp;

export interface JsonStatDataset {
  class?: string;
  id: string[];
  size: number[];
  dimension: Record<
    string,
    {
      label?: string;
      category: {
        index: Record<string, number>;
        label?: Record<string, string>;
      };
    }
  >;
  value: number[] | Record<string, number>;
}

export interface ExtractResult {
  /** geoKey → (year → value). geoKey is the dataset's own geo category key. */
  series: Map<string, Map<number, number>>;
  /** geoKey → human label (for logging / name resolution). */
  geoLabels: Map<string, string>;
  latestYear: number;
}

/** Fetch + parse a JSON-stat dataset from NSI's open-data endpoint. */
export const fetchNsiJsonStat = async (
  id: number,
  lang: "bg" | "en" = "bg",
): Promise<JsonStatDataset> => {
  const url = `http://www.nsi.bg/opendata/getopendata_json.php?l=${lang}&id=${id}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok)
    throw new Error(
      `NSI open-data id=${id} → HTTP ${res.status} ${res.statusText}`,
    );
  const json = (await res.json()) as
    | JsonStatDataset
    | { dataset: JsonStatDataset };
  // v2 has class:"dataset" at root; some emitters wrap in { dataset: … }.
  const ds =
    "dataset" in json && json.dataset
      ? json.dataset
      : (json as JsonStatDataset);
  if (!ds.id || !ds.dimension || !ds.value)
    throw new Error(`NSI open-data id=${id}: unexpected JSON-stat shape`);
  return ds;
};

const sortedKeys = (cat: { index?: Record<string, number> }): string[] => {
  const idx = cat.index ?? {};
  return Object.keys(idx).sort((a, b) => idx[a] - idx[b]);
};

const matchPin = (
  keys: string[],
  labels: Record<string, string> | undefined,
  pin: PinSpec,
): string | undefined => {
  if (typeof pin === "string") {
    if (keys.includes(pin)) return pin; // exact key
    if (labels) {
      const hit = keys.find((k) => labels[k] === pin); // exact label
      if (hit) return hit;
    }
    return undefined;
  }
  // RegExp: try keys first, then labels.
  return (
    keys.find((k) => pin.test(k)) ??
    (labels ? keys.find((k) => pin.test(labels[k] ?? "")) : undefined)
  );
};

const parseYear = (label: string): number | undefined => {
  const m = /(19|20)\d{2}/.exec(label);
  return m ? Number(m[0]) : undefined;
};

/**
 * Extract a geo × year matrix from a JSON-stat dataset.
 *
 * @param geoDim  the geography dimension name (e.g. "NUTS", "EKATTE_Hlth").
 * @param pins    map of non-geo, non-time dimension → category to fix. Every
 *                dimension with cardinality > 1 (besides geo + time) MUST be
 *                pinned or the call throws (ambiguous). Singletons auto-pin.
 * @param timeDim defaults to "periods".
 */
export const extractJsonStat = (
  ds: JsonStatDataset,
  geoDim: string,
  pins: Record<string, PinSpec> = {},
  timeDim = "periods",
): ExtractResult => {
  if (!ds.dimension[geoDim])
    throw new Error(`geo dim "${geoDim}" not in dataset`);
  if (!ds.dimension[timeDim])
    throw new Error(`time dim "${timeDim}" not in dataset`);

  const strides = ds.size.map((_, i) =>
    ds.size.slice(i + 1).reduce((a, b) => a * b, 1),
  );

  // Resolve a fixed position for every dimension except geo + time.
  const fixed: Record<string, number> = {};
  ds.id.forEach((dim, dimIdx) => {
    if (dim === geoDim || dim === timeDim) return;
    const card = ds.size[dimIdx];
    const cat = ds.dimension[dim].category;
    const keys = sortedKeys(cat);
    if (card <= 1) {
      // Singleton — position 0. NSI's "Units" dim is size 1 with an EMPTY
      // category index, so don't rely on key count; trust ds.size.
      fixed[dim] = keys.length ? cat.index[keys[0]] : 0;
      return;
    }
    const pin = pins[dim];
    if (pin === undefined)
      throw new Error(
        `dimension "${dim}" has ${keys.length} categories — provide a pin. ` +
          `Options: ${keys
            .slice(0, 6)
            .map((k) => `${k}=${cat.label?.[k]}`)
            .join(" | ")}`,
      );
    const key = matchPin(keys, cat.label, pin);
    if (key === undefined)
      throw new Error(`pin ${pin} matched no category in dimension "${dim}"`);
    fixed[dim] = cat.index[key];
  });

  const geoCat = ds.dimension[geoDim].category;
  const timeCat = ds.dimension[timeDim].category;
  const geoKeys = sortedKeys(geoCat);
  const timeKeys = sortedKeys(timeCat);
  const value = ds.value;
  const at = (lin: number): number | undefined => {
    const v = Array.isArray(value) ? value[lin] : value[String(lin)];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };

  const series = new Map<string, Map<number, number>>();
  const geoLabels = new Map<string, string>();
  let latestYear = -Infinity;

  for (const gk of geoKeys) {
    geoLabels.set(gk, geoCat.label?.[gk] ?? gk);
    let perYear: Map<number, number> | undefined;
    for (const tk of timeKeys) {
      const year = parseYear(timeCat.label?.[tk] ?? tk);
      if (year === undefined) continue;
      // Linear index = Σ position(dim) · stride(dim).
      let lin = 0;
      ds.id.forEach((dim, i) => {
        const pos =
          dim === geoDim
            ? geoCat.index[gk]
            : dim === timeDim
              ? timeCat.index[tk]
              : fixed[dim];
        lin += pos * strides[i];
      });
      const v = at(lin);
      if (v === undefined) continue;
      if (!perYear) perYear = new Map();
      perYear.set(year, v);
      if (year > latestYear) latestYear = year;
    }
    if (perYear && perYear.size > 0) series.set(gk, perYear);
  }

  return { series, geoLabels, latestYear };
};
