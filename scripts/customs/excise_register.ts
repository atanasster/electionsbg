// Excise-warehouse register ingest — the licensed excise warehouse keepers
// (лицензирани складодържатели и данъчни складове) published by Агенция „Митници"
// via the BACIS REST endpoint (an HTML table). One row per warehouse; we dedup to
// one row per operator (EIK), tag the excise-goods CATEGORY from the CN commodity
// codes (22→alcohol, 24→tobacco, 15/27/29/34/38→energy), and enrich each operator
// with its public-procurement footprint from `contracts_list` so the tile can rank
// and cross-link to /company/:eik.
//
// Output: data/customs/excise_register.json (served at /customs/… via the vite
// data middleware; prod via the GCS bucket). Run: `npx tsx scripts/customs/excise_register.ts`.

import { mkdirSync, writeFileSync } from "node:fs";
import { allRows, end } from "../db/lib/pg";

const SRC = "http://extlb.bacis.customs.bg/BACIS/seam/resource/rest/licensing";
const OUT = "data/customs/excise_register.json";

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
    out.push({ name: c[0], eik: c[2], goods: c[4], status: c[7] });
  }
  return out;
};

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

const build = async (): Promise<ExciseRegisterFile> => {
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

  const CAT_ORDER: ExciseCategory[] = ["energy", "tobacco", "alcohol", "other"];
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

  return {
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Агенция „Митници“",
      register:
        "Регистър на лицензираните складодържатели и данъчните складове",
      url: SRC,
    },
    totalOperators: operators.length,
    activeOperators: operators.filter((o) => o.active).length,
    operators,
  };
};

const main = async () => {
  const file = await build();
  mkdirSync("data/customs", { recursive: true });
  writeFileSync(OUT, JSON.stringify(file, null, 2) + "\n", "utf8");
  console.log(
    `wrote ${OUT}: ${file.totalOperators} operators (${file.activeOperators} active)`,
  );
  await end();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
