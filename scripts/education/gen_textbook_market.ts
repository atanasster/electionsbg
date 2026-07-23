// Generate the textbook-publisher concentration payload for the МОН pack from
// the public-procurement corpus (CPV 22112 „Учебници"). Reads the committed
// contract shards (data/procurement/contracts/*/*.json) — the same source of
// truth the site already ships — so it needs no DB and runs in CI.
//
// Output: data/education/textbook_market.json, consumed by useTextbookMarket +
// the TextbookConcentrationTile. Publisher legal entities are rolled up into
// groups via src/lib/textbookPublishers.ts (the Просвета group is 3 EIKs; Klett
// is the Анубис+Булвест merge) so the concentration figure is honest.
//
// Run: `npx tsx scripts/education/gen_textbook_market.ts`

import fs from "node:fs";
import path from "node:path";
import {
  TEXTBOOK_CPV_PREFIX,
  publisherGroupOf,
  cleanPublisherName,
  type PublisherGroupId,
} from "../../src/lib/textbookPublishers";

const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);
const SHARD_DIR = path.join(PROJECT_ROOT, "data/procurement/contracts");
const OUT_DIR = path.join(PROJECT_ROOT, "data/education");
const OUT_FILE = path.join(OUT_DIR, "textbook_market.json");

type Contract = {
  tag?: string;
  cpv?: string;
  date?: string;
  amountEur?: number;
  awarderEik?: string;
  awarderName?: string;
  contractorEik?: string;
  contractorName?: string;
};

const round = (n: number) => Math.round(n);

const buyerType = (
  name: string,
): "school" | "municipality" | "ministry" | "other" => {
  const n = name.toLowerCase();
  // NB: JS `\b` is ASCII-only and never fires next to a Cyrillic letter, so a
  // standalone "ДГ" (детска градина) needs an explicit whitespace/dot token test.
  if (
    /училищ|гимназия|нву|общежити|детска градина/.test(n) ||
    /(^|\s)дг(\.|\s|$)/.test(n)
  )
    return "school";
  if (/община/.test(n)) return "municipality";
  if (/министерство/.test(n)) return "ministry";
  return "other";
};

// Reduce a set of CPV-22112 contract rows into the market summary (total,
// concentration, publisher-group table with entities, buyer split). Called ONCE
// for the whole corpus and ONCE per calendar year, so the full-corpus figures
// and every per-year slice are computed by identical code — a year slice can't
// drift from the headline. Returns null for an empty set (a year with no rows).
type SummaryInput = {
  eur: number;
  contractorEik: string;
  contractorName: string;
  awarderEik: string;
  awarderName: string;
};

const summarize = (rows: SummaryInput[]) => {
  type Agg = { eur: number; n: number };
  const byGroup = new Map<
    PublisherGroupId,
    Agg & { entities: Map<string, Agg & { name: string }> }
  >();
  const byBuyerType = new Map<string, Agg & { buyers: Set<string> }>();
  const supplierKeys = new Set<string>();
  const schoolBuyers = new Set<string>();
  let totalEur = 0;
  let totalContracts = 0;

  for (const c of rows) {
    totalEur += c.eur;
    totalContracts += 1;
    const key = c.contractorEik || c.contractorName || "—";
    supplierKeys.add(key);
    const gid = publisherGroupOf(c.contractorEik, c.contractorName);
    let g = byGroup.get(gid);
    if (!g) {
      g = { eur: 0, n: 0, entities: new Map() };
      byGroup.set(gid, g);
    }
    g.eur += c.eur;
    g.n += 1;
    let ent = g.entities.get(key);
    if (!ent) {
      ent = { eur: 0, n: 0, name: cleanPublisherName(c.contractorName) };
      g.entities.set(key, ent);
    }
    ent.eur += c.eur;
    ent.n += 1;

    const bt = buyerType(c.awarderName);
    const btAgg = byBuyerType.get(bt) ?? {
      eur: 0,
      n: 0,
      buyers: new Set<string>(),
    };
    btAgg.eur += c.eur;
    btAgg.n += 1;
    if (c.awarderEik) btAgg.buyers.add(c.awarderEik);
    byBuyerType.set(bt, btAgg);
    if (bt === "school" && c.awarderEik) schoolBuyers.add(c.awarderEik);
  }

  if (totalContracts === 0 || totalEur <= 0) return null;

  const groups = Array.from(byGroup.entries())
    .map(([id, g]) => {
      const allEnts = Array.from(g.entities.entries())
        .map(([eik, e]) => ({
          eik: /^\d+$/.test(eik) ? eik : null,
          name: e.name,
          eur: round(e.eur),
          contracts: e.n,
        }))
        .sort(
          (a, b) => b.eur - a.eur || (a.eik ?? "").localeCompare(b.eik ?? ""),
        );
      // The drill-down lists the top 6 legal entities, but `entityCount` keeps
      // the REAL count (so the "N фирми" label is honest) and `restEur` is the
      // euros in the unlisted tail — derived from the group total minus the
      // shown rows so the tile's expanded list still reconciles to the group
      // total (the "other" group has >6 EIKs; klett/prosveta/… have ≤6).
      const groupEur = round(g.eur);
      const entities = allEnts.slice(0, 6);
      const restEur =
        allEnts.length > 6
          ? groupEur - entities.reduce((s, e) => s + e.eur, 0)
          : 0;
      return {
        id,
        eur: groupEur,
        pct: Math.round((1000 * g.eur) / totalEur) / 10,
        contracts: g.n,
        entityCount: allEnts.length,
        restEur,
        entities,
      };
    })
    .sort((a, b) => b.eur - a.eur || a.id.localeCompare(b.id));

  // HHI over publisher GROUPS — sum of squared pct shares.
  const hhiGroup = round(
    groups.reduce((s, g) => s + Math.pow((100 * g.eur) / totalEur, 2), 0),
  );
  const top1Pct = groups.length
    ? Math.round((1000 * groups[0].eur) / totalEur) / 10
    : 0;
  const top2Pct =
    groups.length >= 2
      ? Math.round((1000 * (groups[0].eur + groups[1].eur)) / totalEur) / 10
      : top1Pct;
  const cr4Pct =
    Math.round(
      (1000 * groups.slice(0, 4).reduce((s, g) => s + g.eur, 0)) / totalEur,
    ) / 10;

  return {
    total: {
      eur: round(totalEur),
      contracts: totalContracts,
      suppliers: supplierKeys.size,
      schoolBuyers: schoolBuyers.size,
    },
    concentration: { hhiGroup, top1Pct, top2Pct, cr4Pct },
    groups,
    byBuyerType: Array.from(byBuyerType.entries())
      .map(([type, a]) => ({
        type,
        eur: round(a.eur),
        contracts: a.n,
        buyers: a.buyers.size,
      }))
      .sort((a, b) => b.eur - a.eur),
  };
};

const main = () => {
  const yearDirs = fs
    .readdirSync(SHARD_DIR)
    .filter((d) => /^\d{4}$/.test(d))
    .sort();

  // First pass: pull every CPV-22112 contract into a flat list tagged with its
  // calendar year, so both the full corpus and the per-year slices reduce
  // through the same summarize().
  const all: SummaryInput[] = [];
  const byYearRows = new Map<number, SummaryInput[]>();
  for (const y of yearDirs) {
    const dir = path.join(SHARD_DIR, y);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const rows: Contract[] = JSON.parse(
        fs.readFileSync(path.join(dir, f), "utf8"),
      );
      for (const c of rows) {
        if (c.tag !== "contract") continue;
        if (!String(c.cpv ?? "").startsWith(TEXTBOOK_CPV_PREFIX)) continue;
        const eur = typeof c.amountEur === "number" ? c.amountEur : 0;
        if (!(eur > 0)) continue;
        const row: SummaryInput = {
          eur,
          contractorEik: (c.contractorEik ?? "").trim(),
          contractorName: (c.contractorName ?? "").trim(),
          awarderEik: c.awarderEik ?? "",
          awarderName: c.awarderName ?? "",
        };
        all.push(row);
        const yr = Number((c.date ?? "").slice(0, 4) || y);
        let bucket = byYearRows.get(yr);
        if (!bucket) {
          bucket = [];
          byYearRows.set(yr, bucket);
        }
        bucket.push(row);
      }
    }
  }

  const full = summarize(all);
  // Fail fast on an empty slice — otherwise every share divides by 0 (→ NaN) and
  // latestYear = Math.max(...[]) = -Infinity, shipping a poisoned payload.
  if (!full) {
    throw new Error(
      "gen_textbook_market: no CPV-22112 contracts parsed — refusing to write an empty/NaN payload (has the CPV prefix or corpus changed?)",
    );
  }

  // Per-calendar-year slices — the same structure as the headline, keyed by year
  // (string, for JSON), so the tile can honour the "Години" scope pill by swapping
  // the whole view to yearly[selectedYear]. Only years with real spend are kept.
  const yearly: Record<string, ReturnType<typeof summarize>> = {};
  for (const [yr, rows] of byYearRows) {
    const s = summarize(rows);
    if (s) yearly[String(yr)] = s;
  }

  const byYear = Array.from(byYearRows.entries())
    .map(([year, rows]) => ({
      year,
      eur: round(rows.reduce((s, r) => s + r.eur, 0)),
      contracts: rows.length,
    }))
    .sort((a, b) => a.year - b.year);

  // Invariant the shared summarize() exists to guarantee: every contract lands
  // in exactly one calendar-year bucket, so the corpus and the union of the year
  // buckets must cover the identical rows. Compare the RAW euro sums (not the
  // per-slice ROUNDED totals — rounding each of 14 slices then summing drifts a
  // few euros from rounding the whole, which is not a real defect). A mismatch
  // here means a row was dropped or double-counted between the two code paths.
  const rawSum = (rows: SummaryInput[]) => rows.reduce((s, r) => s + r.eur, 0);
  const rawAll = rawSum(all);
  const rawYearly = Array.from(byYearRows.values()).reduce(
    (s, rows) => s + rawSum(rows),
    0,
  );
  if (Math.round(rawAll) !== Math.round(rawYearly)) {
    throw new Error(
      `gen_textbook_market: year buckets (Σ €${Math.round(rawYearly).toLocaleString()}) do not reconcile to the corpus (€${Math.round(rawAll).toLocaleString()}) — a contract was dropped or double-counted.`,
    );
  }

  const payload = {
    // No generatedAt timestamp — it would churn git on every run with no data
    // change (the payload is otherwise fully deterministic from the corpus).
    source: {
      publisher: "АОП / ЦАИС ЕОП (регистър на обществените поръчки)",
      cpv: `${TEXTBOOK_CPV_PREFIX}xxx`,
      note: "Textbooks are awarded under чл.79, ал.1, т.3 ЗОП (direct award to the copyright holder) — every contract is single-bidder by law; the concentration signal is upstream market share, not the tender.",
    },
    latestYear: Math.max(...byYear.map((b) => b.year)),
    ...full,
    byYear,
    yearly,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + "\n");
  console.log(
    `Wrote ${OUT_FILE} — €${full.total.eur.toLocaleString()} · ${full.total.contracts} contracts · ${full.total.suppliers} suppliers · HHI(group) ${full.concentration.hhiGroup} · top2 ${full.concentration.top2Pct}% · ${Object.keys(yearly).length} year slices`,
  );
};

main();
