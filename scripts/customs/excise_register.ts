// Excise-warehouse register ingest — the licensed excise warehouse keepers
// (лицензирани складодържатели и данъчни складове) published by Агенция „Митници"
// via the BACIS REST endpoint (an HTML table). One row per warehouse; we dedup to
// one row per operator (EIK), tag the excise-goods CATEGORY from the CN commodity
// codes (22→alcohol, 24→tobacco, 15/27/29/34/38→energy), and enrich each operator
// with its public-procurement footprint from `contracts_list` so the tile can rank
// and cross-link to /company/:eik.
//
// Two outputs, from the same fetch:
//   - data/customs/excise_register.json — one row per OPERATOR (the register table
//     + the AI tool read this); unchanged shape.
//   - data/customs/excise_warehouses.json — one row per VALID (active) WAREHOUSE,
//     geolocated to its settlement centroid, for the /customs/warehouses count map
//     (loaded into Postgres `excise_warehouses`, schema 072).
// Served at /customs/… via the vite data middleware; prod via the GCS bucket.
// Run: `npx tsx scripts/customs/excise_register.ts`.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end } from "../db/lib/pg";

const SRC = "http://extlb.bacis.customs.bg/BACIS/seam/resource/rest/licensing";
const OUT = "data/customs/excise_register.json";
const OUT_WAREHOUSES = "data/customs/excise_warehouses.json";
const SETTLEMENTS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../data/settlements.json",
);

type ExciseCategory = "energy" | "tobacco" | "alcohol" | "other";

const cnCategory = (code: string): ExciseCategory => {
  const p2 = code.slice(0, 2);
  if (p2 === "22") return "alcohol";
  if (p2 === "24") return "tobacco";
  if (["15", "27", "29", "34", "38"].includes(p2)) return "energy";
  return "other";
};

const cleanName = (s: string) =>
  s
    .replace(/[“”„"]/g, "")
    .replace(/\s+/g, " ")
    .trim();

interface RawRow {
  name: string;
  eik: string;
  goods: string;
  status: string;
  /** Column [3] — the warehouse's OWN address (its данъчен склад location, which
   *  can differ from the operator's seat in column [1]). Feeds the map's geocode. */
  warehouseAddr: string;
}

const parse = (html: string): RawRow[] => {
  const strip = (s: string) =>
    s
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const out: RawRow[] = [];
  for (const r of html.split(/<tr[ >]/i).slice(1)) {
    const c = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      strip(m[1]),
    );
    if (c.length < 8 || !/^\d{9,13}$/.test(c[2])) continue;
    out.push({
      name: c[0],
      eik: c[2],
      goods: c[4],
      status: c[7],
      warehouseAddr: c[3],
    });
  }
  return out;
};

// ------------------------------------------------------------- geocoding ---
// One centroid per warehouse from its own address (column [3], „Населено място").
// settlements.json is the shared centroid source (as the court-load map uses). We
// match by settlement name, then disambiguate name collisions by the row's тип
// (гр./с.) and Област. Sofia is not a settlements row, so it is pinned to centre.

interface Settlement {
  name: string;
  t_v_m: string; // "гр." | "с." | …
  oblast: string; // code (BLG, S22, PDV-00 …)
  ekatte: string;
  loc: string; // "lng,lat"
}
interface Cand {
  t: string;
  oblast: string;
  loc: [number, number];
}

const geoNorm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[“”„"]/g, "")
    .replace(/\s+/g, " ")
    .trim();

interface WarehouseAddr {
  type: "гр." | "с." | null;
  name: string;
  oblast: string | null;
}

/** Pull {тип, населено място, област} out of a BACIS address cell. The тип prefix
 *  is sometimes absent or spelled out ("град"/"село"); the name can trail a comma
 *  (район / п.к.) or a parenthetical, which we drop. */
const parseWarehouseAddr = (txt: string): WarehouseAddr | null => {
  const m = txt.match(
    /Населено място:\s*(?:(гр\.|с\.|град|село)\s*)?(.+?)\s*(?:Улица:|Пощенски|$)/i,
  );
  if (!m) return null;
  const rawType = (m[1] || "").toLowerCase();
  const type = /гр|град/.test(rawType)
    ? "гр."
    : /с|село/.test(rawType)
      ? "с."
      : null;
  const name = m[2]
    .split(/[;,]/)[0]
    .replace(/\(.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) return null;
  const ob = txt.match(/Област:\s*(.+?)\s+Община:/);
  return { type, name, oblast: ob ? ob[1].trim() : null };
};

class Geocoder {
  private byName = new Map<string, Cand[]>();
  private byEkatte = new Map<string, [number, number]>();
  private oblCode = new Map<string, string>(); // oblast name → its capital's code
  private missBy = new Map<string, number>();

  constructor() {
    const list: Settlement[] = JSON.parse(readFileSync(SETTLEMENTS, "utf8"));
    for (const s of list) {
      if (!s.loc) continue;
      const [lng, lat] = s.loc.split(",").map(Number);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      const loc: [number, number] = [lng, lat];
      const k = geoNorm(s.name);
      (this.byName.get(k) ?? this.byName.set(k, []).get(k)!).push({
        t: s.t_v_m,
        oblast: s.oblast,
        loc,
      });
      if (s.ekatte) this.byEkatte.set(s.ekatte, loc);
      // A Bulgarian oblast is named after its capital town, so the town named like
      // the oblast pins the oblast→code map for the collision tiebreak.
      if (s.t_v_m === "гр." && !this.oblCode.has(geoNorm(s.name)))
        this.oblCode.set(geoNorm(s.name), s.oblast);
    }
    // Sofia (the capital) is not a settlements row; pin its centre + its oblast code.
    this.byName.set("софия", [
      { t: "гр.", oblast: "S22", loc: [23.3219, 42.6977] },
    ]);
    this.oblCode.set("софия", "S22");
  }

  /** Geocode a warehouse from its address; ekatteFallback (the operator's seat
   *  EKATTE from awarder_seats) rescues the ~3% the address parse can't place. */
  locate(
    addr: WarehouseAddr | null,
    ekatteFallback: string | null,
  ): [number, number] | null {
    if (addr) {
      let cands = this.byName.get(geoNorm(addr.name)) ?? [];
      if (cands.length > 1 && addr.type) {
        const tf = cands.filter((c) => c.t === addr.type);
        if (tf.length) cands = tf;
      }
      if (cands.length > 1 && addr.oblast) {
        const code = this.oblCode.get(geoNorm(addr.oblast));
        if (code) {
          const of = cands.filter(
            (c) =>
              c.oblast === code || c.oblast.slice(0, 3) === code.slice(0, 3),
          );
          if (of.length) cands = of;
        }
      }
      if (cands.length) return cands[0].loc;
    }
    if (ekatteFallback) {
      const loc = this.byEkatte.get(ekatteFallback);
      if (loc) return loc;
    }
    const label = addr ? `${addr.type ?? "?"} ${addr.name}` : "(unparsed)";
    this.missBy.set(label, (this.missBy.get(label) ?? 0) + 1);
    return null;
  }

  misses(): [string, number][] {
    return [...this.missBy.entries()].sort((a, b) => b[1] - a[1]);
  }
}

export interface ExciseOperator {
  eik: string;
  name: string;
  categories: ExciseCategory[];
  warehouses: number; // count of VALID (active) warehouse licences
  active: boolean;
  procurementEur: number;
  contractCount: number;
}

export interface ExciseRegisterFile {
  generatedAt: string;
  source: { publisher: string; register: string; url: string };
  totalOperators: number;
  activeOperators: number;
  operators: ExciseOperator[];
}

// One VALID (active) warehouse, geolocated — the /customs/warehouses count map.
export interface ExciseWarehouse {
  eik: string;
  name: string; // operator name
  category: ExciseCategory; // this warehouse's primary excise-goods category
  place: string | null; // display settlement, e.g. "гр. Бургас"
  oblast: string | null; // BACIS oblast name
  loc: [number, number] | null; // [lng, lat] centroid; null → dropped from the map
}

export interface ExciseWarehousesFile {
  generatedAt: string;
  source: { publisher: string; register: string; url: string };
  total: number;
  geolocated: number;
  warehouses: ExciseWarehouse[];
}

const CAT_ORDER: ExciseCategory[] = ["energy", "tobacco", "alcohol", "other"];

/** A warehouse's primary category — the first non-"other" of its goods' CN
 *  categories in draw order, else "other". */
const warehouseCategory = (goods: string): ExciseCategory => {
  const cats = new Set<ExciseCategory>();
  for (const code of goods.split(/[,;·]/)) {
    const t = code.trim();
    if (/^\d{4,}$/.test(t)) cats.add(cnCategory(t));
  }
  return CAT_ORDER.find((c) => c !== "other" && cats.has(c)) ?? "other";
};

const build = async (): Promise<{
  register: ExciseRegisterFile;
  warehouses: ExciseWarehousesFile;
}> => {
  // Fail loudly on a bad fetch — never overwrite the committed register with an
  // empty file (an error page / 5xx / moved endpoint parses to 0 rows). The full
  // BACIS table is ~800 rows; a healthy fetch is nowhere near 100.
  const res = await fetch(SRC);
  if (!res.ok) throw new Error(`BACIS fetch failed: HTTP ${res.status}`);
  const rows = parse(await res.text());
  if (rows.length < 100)
    throw new Error(
      `register too small (${rows.length} rows) — refusing to overwrite the committed file`,
    );
  const isValid = (s: string) => /Валиден/i.test(s);

  // Dedup by EIK; aggregate over the operator's rows. Categories are tracked
  // separately for valid vs all rows so an ACTIVE operator's goods reflect only
  // its still-valid warehouses (a terminated warehouse's category doesn't linger);
  // a terminated-only operator falls back to the union of all its rows.
  const byEik = new Map<
    string,
    {
      name: string;
      validCats: Set<ExciseCategory>;
      allCats: Set<ExciseCategory>;
      warehouses: number;
      active: boolean;
    }
  >();
  for (const r of rows) {
    const cur = byEik.get(r.eik) ?? {
      name: cleanName(r.name),
      validCats: new Set<ExciseCategory>(),
      allCats: new Set<ExciseCategory>(),
      warehouses: 0,
      active: false,
    };
    const valid = isValid(r.status);
    for (const code of r.goods.split(/[,;·]/)) {
      const t = code.trim();
      if (!/^\d{4,}$/.test(t)) continue;
      const cat = cnCategory(t);
      cur.allCats.add(cat);
      if (valid) cur.validCats.add(cat);
    }
    if (valid) {
      cur.active = true;
      cur.warehouses += 1;
    }
    cur.name = cleanName(r.name);
    byEik.set(r.eik, cur);
  }

  // Procurement enrichment — one grouped query over contracts_list.
  const eiks = [...byEik.keys()];
  const proc = new Map<string, { eur: number; cnt: number }>();
  if (eiks.length) {
    const pr = await allRows<{ eik: string; tot: number; cnt: number }>(
      `select contractor_eik eik, sum(amount_eur)::float tot, count(*)::int cnt
       from contracts_list
       where contractor_eik = any($1) and amount_eur is not null
       group by contractor_eik`,
      [eiks],
    );
    for (const p of pr) proc.set(p.eik, { eur: p.tot || 0, cnt: p.cnt });
  }

  const operators: ExciseOperator[] = [...byEik.entries()]
    .map(([eik, v]) => {
      // Active operators show only their valid-warehouse goods; terminated-only
      // operators fall back to the union of all their rows.
      const cats = v.active ? v.validCats : v.allCats;
      return {
        eik,
        name: v.name,
        categories: CAT_ORDER.filter((c) => cats.has(c)),
        warehouses: v.warehouses,
        active: v.active,
        procurementEur: proc.get(eik)?.eur ?? 0,
        contractCount: proc.get(eik)?.cnt ?? 0,
      };
    })
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        b.procurementEur - a.procurementEur ||
        b.warehouses - a.warehouses ||
        a.name.localeCompare(b.name, "bg"),
    );

  // ---- geolocated VALID warehouses → the /customs/warehouses map -----------
  // One point per active warehouse, placed at its own address's settlement
  // centroid; the operator's registered seat (awarder_seats EKATTE) is the
  // fallback for the ~3% the address parse can't place.
  const validRows = rows.filter((r) => isValid(r.status));
  const seatEkatte = new Map<string, string>();
  const validEiks = [...new Set(validRows.map((r) => r.eik))];
  if (validEiks.length) {
    const seats = await allRows<{ eik: string; ekatte: string | null }>(
      `select eik, ekatte from awarder_seats where eik = any($1) and ekatte is not null`,
      [validEiks],
    );
    for (const s of seats) if (s.ekatte) seatEkatte.set(s.eik, s.ekatte);
  }
  const geo = new Geocoder();
  const source = {
    publisher: "Агенция „Митници“",
    register: "Регистър на лицензираните складодържатели и данъчните складове",
    url: SRC,
  };
  const warehouses: ExciseWarehouse[] = validRows
    .map((r) => {
      const addr = parseWarehouseAddr(r.warehouseAddr);
      const loc = geo.locate(addr, seatEkatte.get(r.eik) ?? null);
      return {
        eik: r.eik,
        name: cleanName(r.name),
        category: warehouseCategory(r.goods),
        place: addr ? `${addr.type ?? ""} ${addr.name}`.trim() : null,
        oblast: addr?.oblast ?? null,
        loc,
      };
    })
    // Busiest categories drawn together; stable name order for a deterministic file.
    .sort(
      (a, b) =>
        CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category) ||
        a.name.localeCompare(b.name, "bg"),
    );
  const geolocated = warehouses.filter((w) => w.loc).length;

  // Surface the un-geocoded tail (dropped from the map), never silent.
  const misses = geo.misses();
  if (misses.length) {
    const dropped = warehouses.length - geolocated;
    console.warn(
      `${dropped}/${warehouses.length} warehouses un-geocoded; top misses: ${misses
        .slice(0, 12)
        .map(([label, n]) => `${label}×${n}`)
        .join(", ")}`,
    );
  }

  const now = new Date().toISOString();
  return {
    register: {
      generatedAt: now,
      source,
      totalOperators: operators.length,
      activeOperators: operators.filter((o) => o.active).length,
      operators,
    },
    warehouses: {
      generatedAt: now,
      source,
      total: warehouses.length,
      geolocated,
      warehouses,
    },
  };
};

const main = async () => {
  const { register, warehouses } = await build();
  mkdirSync("data/customs", { recursive: true });
  writeFileSync(OUT, JSON.stringify(register, null, 2) + "\n", "utf8");
  console.log(
    `wrote ${OUT}: ${register.totalOperators} operators (${register.activeOperators} active)`,
  );
  writeFileSync(
    OUT_WAREHOUSES,
    JSON.stringify(warehouses, null, 2) + "\n",
    "utf8",
  );
  const pct = warehouses.total
    ? ((100 * warehouses.geolocated) / warehouses.total).toFixed(1)
    : "0";
  console.log(
    `wrote ${OUT_WAREHOUSES}: ${warehouses.total} active warehouses (${warehouses.geolocated} geocoded, ${pct}%)`,
  );
  await end();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
