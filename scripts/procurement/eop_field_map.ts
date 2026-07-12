// Enrich existing contract shards with the procurement fields that only the
// ЦАИС ЕОП flat feed carries uniformly — CPV (sector), procedure type, realised
// bid count, EU-funding flag + programme — by content-joining each contract to
// the cached EOP `договори` feed on (buyer EIK, supplier EIK, signing date).
//
// Why this exists. Our base corpus mixes three feeds: legacy CSV (2011–23, no
// CPV/procedure/EU), АОП OCDS (2026, has CPV+procedure+ADDRESSES → the maps),
// and the EOP flat gap-fill (2024/25, rich). SIGMA gets uniform sector/procedure/
// EU filters by using the rich EOP feed for everything — but that feed has no
// buyer address, so SIGMA has no map. We keep OCDS-base for the addresses (the
// awarder geo is per-EIK, independent of where a contract is sourced) and ADD
// the EOP fields here. Map-safe: this only writes per-contract fields; it never
// touches the awarder rollups or `geo`.
//
// The join key. The OCDS ocid (`ocds-e82gsb-…`) carries no УНП, so we can't key
// on it. Instead we match on (buyerEik, supplierEik, date). Verified ~90% on
// 2020/2022/2023/2026. 2021 legacy rows carry a placeholder dateSigned
// (2021-12-31), so we fall back to a (buyer, supplier) pair index and pick the
// EOP row whose date is nearest the contract's publication date.
//
//   npx tsx scripts/procurement/eop_field_map.ts            # dry run (coverage report)
//   npx tsx scripts/procurement/eop_field_map.ts --apply    # write fields onto shards
//   npx tsx scripts/procurement/rebuild_from_cache.ts        # rebuild rollups/derived/index
//
// Re-runnable: idempotent (fills only missing cpv/procedure; always (re)sets the
// EU flag from the matched row). No network — reads raw_data/procurement/eop/.

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { command, run, flag, optional, boolean } from "cmd-ts";
import { canonicalEik } from "./eik";
import { canonicalJson } from "./validate";
import { deriveTextbookCpv, TEXTBOOK_CPV } from "./textbook_cpv";
import { toEur } from "@/lib/currency";
import type { Contract } from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROCUREMENT_DIR = path.resolve(__dirname, "../../data/procurement");
const CONTRACTS_DIR = path.join(PROCUREMENT_DIR, "contracts");
const EOP_CACHE_DIR = path.resolve(__dirname, "../../raw_data/procurement/eop");
// The pre-2020 РОП dossier scrape's docId→{unp,cpv} map (ingest_rop_dossier.ts).
const ROP_DOSSIER_MAP = path.resolve(
  __dirname,
  "../../raw_data/procurement/rop_dossier/_cpv_map.json",
);

// One enrichment payload pulled from a matched EOP `договори` row.
interface EopFields {
  cpv?: string;
  procurementMethod?: string;
  numberOfTenderers?: number;
  euFunded?: boolean;
  euProgram?: string;
}

const truthy = (v: unknown): boolean => {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  return s === "true" || s === "да" || s === "1" || s === "yes";
};

const toInt = (v: unknown): number | undefined => {
  if (v == null) return undefined;
  const n = Number(String(v).replace(/\s/g, ""));
  return Number.isInteger(n) && n >= 0 ? n : undefined;
};

// "DD.MM.YYYY" / ISO → "YYYY-MM-DD"; undefined when unparseable.
const isoDate = (v: unknown): string | undefined => {
  if (!v) return undefined;
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return undefined;
};

// "1 234 567,89" / "5112918,81" → number; undefined when blank/non-numeric.
const parseBgNumber = (v: unknown): number | undefined => {
  if (v == null) return undefined;
  let s = String(v).trim().replace(/\s/g, "");
  if (!s) return undefined;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

const norm = (e: string | undefined): string => canonicalEik(e) || "";

// €-value bucket (nearest €1000) for the value-date fallback that catches
// consortium contracts — the supplier EIK differs across feeds (we hold the
// ДЗЗД's EIK, EOP lists member EIKs), but the buyer + value + date agree.
const eurBucket = (eur: number | undefined): number | undefined =>
  eur != null && Number.isFinite(eur) ? Math.round(eur / 1000) : undefined;

const dayDiff = (a?: string, b?: string): number => {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000);
};

interface EopIndex {
  // (buyer|supplier|date) → fields, for both the signing and publication dates.
  exact: Map<string, EopFields>;
  // (buyer|supplier) → [{ date, fields }] for the nearest-date fallback.
  pair: Map<string, Array<{ date: string; fields: EopFields }>>;
  // (buyer|date|€-bucket) → fields, for the consortium value-date fallback.
  byVal: Map<string, EopFields>;
}

const buildEopIndex = (): EopIndex => {
  const exact = new Map<string, EopFields>();
  const pair = new Map<string, Array<{ date: string; fields: EopFields }>>();
  const byVal = new Map<string, EopFields>();
  if (!fs.existsSync(EOP_CACHE_DIR)) return { exact, pair, byVal };
  const files = fs.readdirSync(EOP_CACHE_DIR).filter((f) => f.endsWith(".gz"));
  for (const f of files) {
    let rows: Record<string, unknown>[];
    try {
      rows = JSON.parse(
        zlib
          .gunzipSync(fs.readFileSync(path.join(EOP_CACHE_DIR, f)))
          .toString(),
      );
    } catch {
      continue;
    }
    if (!Array.isArray(rows)) continue;
    for (const r of rows) {
      const buyer = norm(r.buyerRegistryNumber as string);
      if (!buyer) continue;
      const cd = isoDate(r.contractDate);
      const pd = isoDate(r.publicationDate);
      const fields: EopFields = {
        cpv: (String(r.tenderMainCpv ?? "").trim() || undefined) as
          | string
          | undefined,
        procurementMethod: (String(r.procedureType ?? "").trim() ||
          undefined) as string | undefined,
        numberOfTenderers: toInt(r.offersCount),
        euFunded: truthy(r.isEuFunded),
        euProgram: (String(r.europeanProgram ?? "").trim() || undefined) as
          | string
          | undefined,
      };
      const suppliers = String(r.supplierRegisterNumber ?? "")
        .split(";")
        .map((s) => norm(s.trim()))
        .filter(Boolean);
      for (const s of suppliers) {
        const base = `${buyer}|${s}`;
        if (cd) exact.set(`${base}|${cd}`, fields);
        if (pd && pd !== cd) exact.set(`${base}|${pd}`, fields);
        const list = pair.get(base) ?? [];
        list.push({ date: cd ?? pd ?? "", fields });
        pair.set(base, list);
      }
      // Value-date key (supplier-agnostic) for consortium matching.
      const k = eurBucket(
        toEur(
          parseBgNumber(r.contractValue),
          String(r.contractCurrency ?? "").trim() || undefined,
        ) ?? undefined,
      );
      if (k != null && k > 0) {
        if (cd) byVal.set(`${buyer}|${cd}|${k}`, fields);
        if (pd && pd !== cd) byVal.set(`${buyer}|${pd}|${k}`, fields);
      }
    }
  }
  return { exact, pair, byVal };
};

// Resolve the best EOP enrichment for one contract.
const lookup = (idx: EopIndex, c: Contract): EopFields | undefined => {
  const b = norm(c.awarderEik);
  const s = norm(c.contractorEik);
  if (!b || !s) return undefined;
  const base = `${b}|${s}`;
  // 1. exact on the signing date, then the release date.
  for (const d of [isoDate(c.dateSigned), isoDate(c.date)]) {
    if (d) {
      const hit = idx.exact.get(`${base}|${d}`);
      if (hit) return hit;
    }
  }
  // 2. value-date fallback (buyer|date|€-bucket) — catches consortium contracts
  //    whose supplier EIK differs between the OCDS and EOP feeds.
  const k = eurBucket(c.amountEur);
  if (k != null && k > 0) {
    for (const d of [isoDate(c.dateSigned), isoDate(c.date)]) {
      if (d) {
        const hit = idx.byVal.get(`${b}|${d}|${k}`);
        if (hit) return hit;
      }
    }
  }
  // 3. nearest EOP row for this (buyer, supplier) pair. A unique pair wins
  //    outright; otherwise pick the row whose date is closest to the
  //    contract's release date (real even when dateSigned is a placeholder).
  const list = idx.pair.get(base);
  if (!list || list.length === 0) return undefined;
  if (list.length === 1) return list[0].fields;
  const ref = isoDate(c.date) ?? isoDate(c.dateSigned);
  let best: { date: string; fields: EopFields } | undefined;
  let bestD = Number.POSITIVE_INFINITY;
  for (const row of list) {
    const d = dayDiff(row.date, ref);
    if (d < bestD) {
      bestD = d;
      best = row;
    }
  }
  // Guard: only accept a fuzzy pair-match within a year, so we don't graft a
  // 2026 procurement's sector onto a 2021 contract for the same pair.
  return best && bestD <= 366 ? best.fields : undefined;
};

// ---- pre-2020 РОП dossier CPV map ------------------------------------------

// The docId is the trailing numeric token of a legacy ocid; the year segment can
// itself contain a dash (`aop-legacy-2011-2015-693699`), so match the tail.
const docIdFromOcid = (ocid: string): string | undefined =>
  ocid.startsWith("aop-legacy-")
    ? (ocid.match(/-(\d+)$/)?.[1] ?? undefined)
    : undefined;

interface DossierIndex {
  byDocId: Map<string, string>; // legacy docId → CPV
  byUnp: Map<string, string>; // procedure УНП → CPV (covers id-range gap-fills)
}

// Load the dossier scrape's CPV map into docId- and УНП-keyed indices (CPV-only
// entries). Absent file → empty indices (the pass no-ops), so this stays optional.
const buildDossierIndex = (): DossierIndex => {
  const byDocId = new Map<string, string>();
  const byUnp = new Map<string, string>();
  if (fs.existsSync(ROP_DOSSIER_MAP)) {
    let map: Record<string, { unp: string | null; cpv: string | null }>;
    try {
      map = JSON.parse(fs.readFileSync(ROP_DOSSIER_MAP, "utf8"));
    } catch {
      return { byDocId, byUnp };
    }
    for (const [docId, f] of Object.entries(map)) {
      if (!f?.cpv) continue;
      byDocId.set(docId, f.cpv);
      if (f.unp && !byUnp.has(f.unp)) byUnp.set(f.unp, f.cpv);
    }
  }
  return { byDocId, byUnp };
};

// The real notice CPV for one contract: exact by legacy docId, then by УНП.
const dossierCpv = (idx: DossierIndex, c: Contract): string | undefined => {
  const docId = docIdFromOcid(c.ocid);
  if (docId) {
    const hit = idx.byDocId.get(docId);
    if (hit) return hit;
  }
  return c.unp ? idx.byUnp.get(c.unp) : undefined;
};

const main = (apply: boolean): void => {
  console.log("→ indexing EOP flat cache…");
  const idx = buildEopIndex();
  console.log(
    `  ${idx.exact.size.toLocaleString()} exact keys, ` +
      `${idx.pair.size.toLocaleString()} (buyer,supplier) pairs`,
  );
  const dossier = buildDossierIndex();
  console.log(
    `→ РОП dossier CPV map: ${dossier.byDocId.size.toLocaleString()} docId(s), ` +
      `${dossier.byUnp.size.toLocaleString()} УНП(s)`,
  );

  const years = fs
    .readdirSync(CONTRACTS_DIR)
    .filter((y) => /^\d{4}$/.test(y))
    .sort();
  let total = 0;
  let matched = 0;
  let setCpv = 0;
  let setDossierCpv = 0;
  let setTextbookCpv = 0;
  let setProc = 0;
  let setBids = 0;
  let setEu = 0;
  let filesChanged = 0;

  for (const y of years) {
    const dir = path.join(CONTRACTS_DIR, y);
    for (const file of fs.readdirSync(dir).filter((f) => /\.json$/.test(f))) {
      const full = path.join(dir, file);
      const rows = JSON.parse(fs.readFileSync(full, "utf8")) as Contract[];
      let changed = false;
      for (const c of rows) {
        total++;
        const f = lookup(idx, c);
        if (f) {
          matched++;
          if (!c.cpv && f.cpv) {
            c.cpv = f.cpv;
            setCpv++;
            changed = true;
          }
          if (!c.procurementMethod && f.procurementMethod) {
            c.procurementMethod = f.procurementMethod;
            setProc++;
            changed = true;
          }
          if (c.numberOfTenderers == null && f.numberOfTenderers != null) {
            c.numberOfTenderers = f.numberOfTenderers;
            setBids++;
            changed = true;
          }
          // EU flag is EOP-only and tri-state: a matched contract has a KNOWN
          // status (true/false); an unmatched one is left undefined ("unknown",
          // not "no") so the entity EU-share denominator is the known set.
          if (c.euFunded !== f.euFunded) {
            c.euFunded = !!f.euFunded;
            changed = true;
          }
          if (f.euFunded) setEu++;
          if (f.euProgram && c.euProgram !== f.euProgram) {
            c.euProgram = f.euProgram;
            changed = true;
          }
        }
        // Real pre-2020 CPV from the РОП dossier scrape (ingest_rop_dossier.ts).
        // The flat-feed join above finds nothing pre-2020, so this is the only
        // real CPV those years get. Fill an empty CPV, and PREFER the real notice
        // CPV over the textbook heuristic — replace a previously textbook-derived
        // 22112000 (see below) with the dossier value. Never touches a real CPV
        // set from the EOP feed above (that path leaves c.cpv non-empty and
        // non-textbook, so the guard skips it).
        const dcpv = dossierCpv(dossier, c);
        if (dcpv && dcpv !== c.cpv && (!c.cpv || c.cpv === TEXTBOOK_CPV)) {
          c.cpv = dcpv;
          setDossierCpv++;
          changed = true;
        }
        // Last-resort CPV gap-fill (runs for matched AND unmatched rows): the
        // flat-feed join finds nothing for pre-2020 rows, so legacy/РОП textbook
        // contracts stay CPV-less and vanish from the textbook market. Derive
        // 22112 from the subject ONLY when no real CPV survived above. See
        // textbook_cpv.ts.
        if (!c.cpv) {
          const tb = deriveTextbookCpv(c.title);
          if (tb) {
            c.cpv = tb;
            setTextbookCpv++;
            changed = true;
          }
        }
      }
      if (apply && changed) {
        fs.writeFileSync(full, canonicalJson(rows));
        filesChanged++;
      }
    }
  }

  console.log(
    `→ ${total.toLocaleString()} contracts; matched ${matched.toLocaleString()} ` +
      `(${((matched / total) * 100).toFixed(0)}%)`,
  );
  console.log(
    `  filled cpv ${setCpv.toLocaleString()} ` +
      `(+${setDossierCpv.toLocaleString()} РОП-dossier, +${setTextbookCpv.toLocaleString()} textbook-derived), ` +
      `procedure ${setProc.toLocaleString()}, ` +
      `bids ${setBids.toLocaleString()}; EU-funded ${setEu.toLocaleString()}`,
  );
  if (!apply) {
    console.log("✓ dry run — pass --apply to write fields onto the shards");
    return;
  }
  console.log(`→ wrote ${filesChanged} shard(s)`);
  console.log(
    "✓ done. Now rebuild: npx tsx scripts/procurement/rebuild_from_cache.ts",
  );
};

const cli = command({
  name: "eop_field_map",
  args: {
    apply: flag({
      type: optional(boolean),
      long: "apply",
      description: "Write enriched fields onto the month-shards (default dry).",
      defaultValue: () => false,
    }),
  },
  handler: (args) => main(!!args.apply),
});

run(cli, process.argv.slice(2));
