// Excise-warehouse register ingest — the licensed excise warehouse keepers
// (лицензирани складодържатели и данъчни складове) published by Агенция „Митници"
// via the BACIS REST endpoint (an HTML table). One row per warehouse; we dedup to
// one row per operator (EIK), tag the excise-goods CATEGORY from the CN commodity
// codes (22→alcohol, 24→tobacco, 15/27/29/34/38→energy), and enrich each operator
// with its public-procurement footprint from `contracts_list` so the tile can rank
// and cross-link to /company/:eik — on the site's money basis (`tag='contract'`,
// consortium carriers only), which that view does NOT apply for you; see the
// enrichment query below.
//
// Two outputs, from the same fetch:
//   - data/customs/excise_register.json — one row per OPERATOR (the register table
//     + the AI tool read this); unchanged shape.
//   - data/customs/excise_warehouses.json — one row per VALID (active) WAREHOUSE,
//     geolocated to its settlement centroid, for the /customs/warehouses count map
//     (loaded into Postgres `excise_warehouses`, schema 072).
// Served at /customs/… via the vite data middleware; prod via the GCS bucket.
// Run: `npm run customs:excise-register`.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { allRows, end } from "../db/lib/pg";
import { parseRows, isValidStatus } from "./bacis_table";

const SRC = "http://extlb.bacis.customs.bg/BACIS/seam/resource/rest/licensing";
const OUT = "data/customs/excise_register.json";
const OUT_WAREHOUSES = "data/customs/excise_warehouses.json";
const SETTLEMENTS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../data/settlements.json",
);

type ExciseCategory = "energy" | "tobacco" | "alcohol" | "other";

export const cnCategory = (code: string): ExciseCategory => {
  const p2 = code.slice(0, 2);
  if (p2 === "22") return "alcohol";
  if (p2 === "24") return "tobacco";
  if (["15", "27", "29", "34", "38"].includes(p2)) return "energy";
  return "other";
};

export const cleanName = (s: string) =>
  s
    .replace(/[“”„"]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// ------------------------------------------------------------- geocoding ---
// One centroid per warehouse from its own address (column [3], „Населено място").
// settlements.json is the shared centroid source (as the court-load map uses). We
// match by settlement name, then disambiguate name collisions by the row's тип
// (гр./с.) and Област. Sofia is not a settlements row, so it is pinned to centre.

interface Settlement {
  name: string;
  /** "гр." | "с." | "общ." | "ман." — and ABSENT on 88 rows, which are foreign
   *  COUNTRIES (Австралия, Австрия, … under oblast "32"). Optional on purpose:
   *  typing it `string` was a lie about the file, and those rows were being
   *  indexed as geocode candidates. */
  t_v_m?: string;
  oblast: string; // code (BLG, S23, PDV-00 …)
  ekatte: string;
  loc: string; // "lng,lat"
}
interface Cand {
  t: string;
  oblast: string;
  loc: [number, number];
}

export const geoNorm = (s: string) =>
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
export const parseWarehouseAddr = (txt: string): WarehouseAddr | null => {
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

/** Every oblast code settlements.json uses for a place inside „Област София".
 *
 *  It is a SET, not one code, because Столична община's settlements are split
 *  across three: S23 (Sofia-oblast villages — с. Лозен, с. Бистрica), S24
 *  (с. Горни Богров, с. Бусманци) and S25 (гр. Нови Искър, гр. Банкя). One code
 *  would make the tiebreak below fail CLOSED on any ambiguous S24/S25 name —
 *  cheaper than the wrong point it used to plot, but still a miss we can avoid.
 *  SOFIA_OBLAST[0] is what the capital's own pinned row carries. */
const SOFIA_OBLAST = ["S23", "S24", "S25"] as const;

export class Geocoder {
  private byName = new Map<string, Cand[]>();
  private byEkatte = new Map<string, [number, number]>();
  private oblCode = new Map<string, string>(); // oblast name → its capital's code
  /** oblast name → every code its settlements can carry. Overrides oblCode where
   *  present; only София needs one today (see SOFIA_OBLAST). */
  private oblFamily = new Map<string, Set<string>>();
  private missBy = new Map<string, number>();
  private ambiguousBy = new Map<string, number>();

  private bump(m: Map<string, number>, k: string) {
    m.set(k, (m.get(k) ?? 0) + 1);
  }

  constructor() {
    const list: Settlement[] = JSON.parse(readFileSync(SETTLEMENTS, "utf8"));
    for (const s of list) {
      // Only real settlements are places a warehouse can sit in. settlements.json
      // also carries 88 foreign COUNTRIES (oblast "32"), 21 общ. and 2 ман.; left
      // in the index, a warehouse in a village sharing a country's name would be
      // plotted abroad and nothing would report it — the тип filter below is
      // skipped whenever there is one candidate or the address states no тип.
      if (!s.loc || (s.t_v_m !== "гр." && s.t_v_m !== "с.")) continue;
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
    //
    // ⚠️ THE CODE IS S23, AND S22 IS ON NO ROW OF settlements.json. Sofia's
    // villages carry S23 (19 of them); the S-prefixed codes in that file are
    // S23/S24/S25/SFO/SHU/SLS/SLV/SML/SZR and S22 is not among them. Pinned to
    // S22 the oblast tiebreak in locate() could never match anything for a
    // „Област: София" address, so it fell through to cands[0] — с. Бистрица
    // (София) was plotted in Благоевград (~60 km) and с. Лозен (София) in
    // Велико Търново (~200 km), on a map whose whole proposition is a per-city
    // warehouse count.
    this.byName.set("софия", [
      { t: "гр.", oblast: SOFIA_OBLAST[0], loc: [23.3219, 42.6977] },
    ]);
    this.oblFamily.set("софия", new Set(SOFIA_OBLAST));
  }

  /** Geocode a warehouse from its address; ekatteFallback is the operator's seat
   *  EKATTE from `awarder_seats`.
   *
   *  ⚠️ That fallback is far thinner than it reads. `awarder_seats` is the BUYER
   *  seat table and excise warehouse keepers are SUPPLIERS, so it covers 5 of the
   *  295 active operators (1.7%) and rescued ZERO of the 5 un-geocoded warehouses
   *  on the 2026-08-19 corpus. The supplier-side crosswalk built for this shape is
   *  `tr_company_place` (migration 133, tr_companies.seat → EKATTE) at 74/295
   *  (25%) — it would not rescue the current 5 either, so this is not urgent, but
   *  do not read the present fallback as meaningful coverage. */
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
        const key = geoNorm(addr.oblast);
        const family = this.oblFamily.get(key);
        const code = this.oblCode.get(key);
        if (family || code) {
          const of = cands.filter((c) =>
            family
              ? family.has(c.oblast)
              : c.oblast === code || c.oblast.slice(0, 3) === code!.slice(0, 3),
          );
          // FAIL CLOSED. An oblast we resolved to a code that matches none of the
          // candidates means the address and the name index disagree — returning
          // cands[0] there plots an arbitrary same-named village in another
          // oblast, which is exactly how the S22 pin above stayed invisible for
          // the life of this file. A counted miss is recoverable; a confident
          // wrong point is not.
          if (!of.length) {
            this.bump(
              this.missBy,
              `${addr.name} (Област ${addr.oblast} matches no candidate)`,
            );
            return null;
          }
          cands = of;
        }
      }
      // Still ambiguous after both filters: report rather than silently first-pick.
      if (cands.length > 1)
        this.bump(this.ambiguousBy, `${addr.name} ×${cands.length}`);
      if (cands.length) return cands[0].loc;
    }
    if (ekatteFallback) {
      const loc = this.byEkatte.get(ekatteFallback);
      if (loc) return loc;
    }
    this.bump(
      this.missBy,
      addr ? `${addr.type ?? "?"} ${addr.name}` : "(unparsed)",
    );
    return null;
  }

  /** „гр. Бургас" / „с. Лозен" — the тип backfilled from the name index when the
   *  BACIS cell omits it (23 rows), so the rendered place is never a bare name.
   *  Falls back to the bare name only when the settlement is unknown to us. */
  displayPlace(addr: WarehouseAddr): string {
    const t = addr.type ?? this.byName.get(geoNorm(addr.name))?.[0]?.t ?? "";
    return `${t} ${addr.name}`.trim();
  }

  misses(): [string, number][] {
    return [...this.missBy.entries()].sort((a, b) => b[1] - a[1]);
  }

  /** Names that stayed ambiguous after both tiebreaks — the point was still
   *  plotted (cands[0]), so unlike a miss it is invisible in the output file. */
  ambiguities(): [string, number][] {
    return [...this.ambiguousBy.entries()].sort((a, b) => b[1] - a[1]);
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

/** The excise categories a „Акцизни стоки" cell names. ONE definition of the
 *  delimiter set and the CN-code shape — both the per-warehouse category below
 *  and the per-operator dedup in build() go through it, so a new BACIS separator
 *  cannot be taught to one and not the other. */
export const goodsCategories = (goods: string): Set<ExciseCategory> => {
  const out = new Set<ExciseCategory>();
  for (const code of goods.split(/[,;·]/)) {
    const t = code.trim();
    if (/^\d{4,}$/.test(t)) out.add(cnCategory(t));
  }
  return out;
};

/** A warehouse's primary category — the first non-"other" of its goods' CN
 *  categories in draw order, else "other". */
export const warehouseCategory = (goods: string): ExciseCategory => {
  const cats = goodsCategories(goods);
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
  const rows = parseRows(await res.text());
  if (rows.length < 100)
    throw new Error(
      `register too small (${rows.length} rows) — refusing to overwrite the committed file`,
    );

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
    const valid = isValidStatus(r.status);
    for (const cat of goodsCategories(r.goods)) {
      cur.allCats.add(cat);
      if (valid) cur.validCats.add(cat);
    }
    if (valid) {
      cur.active = true;
      cur.warehouses += 1;
    }
    // Prefer the name on a still-VALID row: 15 of 565 EIKs carry more than one
    // name across their rows, and several are genuine renames (825399928 is both
    // „ВИНПРОМ ПЕЩЕРА АД" and „ВП Брандс Интернешънъл АД"), so „last row wins"
    // let a pure reordering on the register's side silently change a rendered
    // operator name — and show the historical one against the live /company/:eik.
    // Same rule the categories already follow: an active operator reflects only
    // its valid rows; a terminated-only operator falls back to whatever it has.
    if (valid || !cur.active) cur.name = cleanName(r.name);
    byEik.set(r.eik, cur);
  }

  // Procurement enrichment — one grouped query, on the site-wide money basis.
  //
  // ⚠️ THE BASIS IS THREE PREDICATES AND NONE OF THEM IS OPTIONAL. Until the
  // 2026-08-19 sector audit (docs/plans/customs-sector-audit-v1.md F1) this read
  // the `contracts_list` VIEW with none of them. That view is `SELECT c.*` over
  // `contracts` plus the КЗК/risk LEFT JOINs — it narrows NOTHING — so the
  // aggregate was not the basis the rest of the site publishes:
  //
  //  · `tag = 'contract'` — the corpus carries 3,488 `contractAmendment` rows,
  //    which rollups.ts excludes from every money rollup and every serving SUM
  //    filters. Without it the register over-stated by €6,779,063 across 14 rows,
  //    concentrated on ONE rendered row: Петрол АД at €516,507,722 / „2,199
  //    обществени поръчки" against €512,950,100 / 2,191.
  //  · `consortium_role is distinct from 'member'` — a consortium's carrier row
  //    holds the whole value and each member row holds €0 (087). The member rows
  //    move no money, so they are INVISIBLE to any € check, and they inflated
  //    `contractCount` by 48: an operator that was one of three in an обединение
  //    was credited a „обществена поръчка" worth nothing to it. (Петрол АД lands
  //    at 2,176 once both filters are on.)
  //  · NO `amount_eur is not null` — it is a no-op for SUM, which already skips
  //    NULLs, so its only effect was to drop 2 real won contracts denominated in
  //    GBP/USD from the COUNT, putting it below the /company/:eik figure this
  //    register cross-links to one click away.
  //
  // The predicate is spelled `is distinct from`, not `coalesce(…) <> …`, because
  // that is the form all 26+ canonical call sites use (011, 018, 023, 024, 034,
  // 035, 038, 061, 082, 096) — grepping for it is how anyone audits „which
  // surfaces are on the money basis?", and a paraphrase is invisible to that
  // grep, which is precisely how F1 stayed hidden.
  //
  // Reads base `contracts`, not the view: the three columns wanted are stable
  // base columns, while the view's column set is rebuilt by
  // rebuild_contracts_list() at the foot of five migrations.
  //
  // ⚠️ NOT YET GATED — scripts/db/tests/sector_stats_customs.data.test.ts does
  // not exist (plan F5). Until it does, nothing pins this basis and a regression
  // here is silent.
  const eiks = [...byEik.keys()];
  const proc = new Map<string, { eur: number; cnt: number }>();
  if (eiks.length) {
    const pr = await allRows<{ eik: string; tot: number; cnt: number }>(
      // round(): a bare ::float writes IEEE-754 residue into a COMMITTED file
      // (834021116.2399999, 512950100.35999936 — 31 of 565 operators), which both
      // renders behind a figure and lets the diff churn on the last digits if
      // Postgres ever reorders the summation with no data change.
      `select contractor_eik eik,
              round(coalesce(sum(amount_eur), 0)::numeric, 2)::float tot,
              count(*)::int cnt
         from contracts
        where contractor_eik = any($1)
          and tag = 'contract'
          and consortium_role is distinct from 'member'
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
  // centroid; the operator's registered seat (awarder_seats EKATTE) is a thin
  // fallback — see the measured coverage in Geocoder.locate's doc comment.
  const validRows = rows.filter((r) => isValidStatus(r.status));
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
        // Backfill the тип from the matched settlement when BACIS omits it (23
        // rows do), so the column never mixes „гр. Бургас" with a bare „Варна" —
        // it is the map tooltip, the excise_warehouses.place column and part of
        // the loader's changelog key.
        place: addr ? geo.displayPlace(addr) : null,
        oblast: addr?.oblast ?? null,
        loc,
      };
    })
    // Busiest categories drawn together, then a TOTAL order. (category, name)
    // alone left 33 groups / 93 rows tied — 26 of them differing in place or loc
    // — so the emitted order came from BACIS's row order and a server-side
    // reshuffle churned the committed file with no data change (and moved the
    // ids, which excise_warehouses_map() re-derives from this sort).
    .sort(
      (a, b) =>
        CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category) ||
        a.name.localeCompare(b.name, "bg") ||
        (a.place ?? "").localeCompare(b.place ?? "", "bg") ||
        a.eik.localeCompare(b.eik),
    );
  const geolocated = warehouses.filter((w) => w.loc).length;

  // Surface the ambiguous names that were still first-picked — unlike a miss,
  // a wrong-but-plotted point is indistinguishable from a right one in the file.
  const ambiguous = geo.ambiguities();
  if (ambiguous.length)
    console.warn(
      `${ambiguous.length} ambiguous settlement name(s) resolved by first-match: ${ambiguous
        .slice(0, 12)
        .map(([k, n]) => `${k}×${n}`)
        .join(", ")}`,
    );

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
  // finally, not a trailing await: build() throws on a bad fetch, a short table
  // and any query error, and every one of those paths used to reach the
  // top-level catch with the pool still open — which can truncate the logged
  // error when the pool's own teardown races process.exit.
  try {
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
  } finally {
    await end();
  }
};

// Guarded so a test can import the parsers and classifiers above without firing
// a live BACIS fetch, opening a Postgres pool and possibly process.exit(1)-ing —
// the house pattern (scripts/agri/ingest.ts, scripts/db/dump.ts, …), and what
// makes excise_register.test.ts possible at all.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
