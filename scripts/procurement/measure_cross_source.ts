// READ-ONLY measurement of cross-source duplication in the contracts corpus.
//
// There is no `--apply` and no write path anywhere in this file. It exists so that every number
// in docs/plans/procurement-cross-source-dedup-v2.md can be re-derived by running one command,
// against either the shards or a database, with THE SAME CODE the reconciliation pass acts on
// (`cross_source.ts`) rather than a re-implementation.
//
// That is the whole point. v1 §6 records that the first draft's measurements were wrong because
// a lookalike `canonicalEik` was measured instead of the real one, and §11 exists because §10.8's
// headline was arrived at by inference rather than measurement and overstated the problem by 3×.
// A committed harness importing the real helpers cannot drift from what the pass does.
//
//   npx tsx scripts/procurement/measure_cross_source.ts                 # shards (what the pass sees)
//   npx tsx scripts/procurement/measure_cross_source.ts --source=pg     # the loaded database
//   npx tsx scripts/procurement/measure_cross_source.ts --json          # machine-readable
//
// Against Cloud SQL (production), via the proxy — still read-only:
//   DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg \
//     npx tsx scripts/procurement/measure_cross_source.ts --source=pg
//
// ── THE TWO SOURCES DO NOT REPORT THE SAME €, AND BOTH ARE RIGHT ────────────────────────────
//
// Row counts agree exactly; euro totals do not, because `rebuild_consortium()`
// (087_procurement_consortium.sql) runs INSIDE Postgres after the load: it moves a joint award's
// whole value onto one carrier row and zeroes the members. Measured 2026-08-04: 6 `eop` and 4
// `ocds` rows inside identity-E groups are members sitting at €0.00 in Postgres while the shards
// carry their real split, which is the entire €2,677,439.88 by which the two sources' eviction
// totals differ (all of it in the `ocds > eop` direction).
//
//   `--source=shards`  what the PASS actually removes — the number its own delta check must match
//   `--source=pg`      what the SERVED corpus currently carries — the number to compare prod against
//
// Neither is a correction of the other. Do not expect the post-reload Postgres total to fall by
// the shard delta either: 087 re-runs over the new member sets and redistributes, so that figure
// is verified after the reload, never predicted.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { feedOf, type Feed } from "./content_key";
import {
  analyzeCrossSource,
  describeRow,
  identityE,
  isSyntheticCarrier,
  signingDay,
} from "./cross_source";
import type { Contract, ContractTag } from "./types";

/** `lot_name` is NOT a shard field — 050's `enrich_contract_lot_names()` derives it inside
 *  Postgres from the tender corpus, so it exists only on the `--source=pg` path. Carried as a
 *  local widening rather than added to `Contract`, which models what the ingest writes. */
type MeasuredContract = Contract & { lotName?: string };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const MONTH_DIR = path.join(ROOT, "data/procurement/contracts");

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes("--json");
const SOURCE = argv.includes("--source=pg") ? "pg" : "shards";

// Reject anything unrecognised rather than ignoring it. This script's whole job is to be the
// number people trust, and a silently-dropped flag makes it measure something other than what
// was asked — the T6 production step was drafted with a `--read-only` flag that does not exist,
// which would have measured LOCAL SHARDS while reading as a Cloud SQL measurement. It is
// read-only unconditionally, so the flag is accepted as a no-op alias rather than removed from
// anyone's muscle memory.
const KNOWN = new Set([
  "--json",
  "--source=pg",
  "--source=shards",
  "--read-only",
]);
const unknown = argv.filter((a) => !KNOWN.has(a));
if (unknown.length) {
  console.error(
    `unknown argument(s): ${unknown.join(" ")}\n` +
      `known: ${[...KNOWN].join(" ")}  (this script never writes; --read-only is a no-op alias)`,
  );
  process.exit(2);
}

const FEEDS: Feed[] = ["ocds", "aop", "eop", "rop"];

// ── loading ──────────────────────────────────────────────────────────────────────────────────

const isYearDir = (n: string): boolean => /^\d{4}$/.test(n);

const loadShards = (): MeasuredContract[] => {
  const out: MeasuredContract[] = [];
  for (const y of fs.readdirSync(MONTH_DIR).filter(isYearDir)) {
    const dir = path.join(MONTH_DIR, y);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const rows = JSON.parse(
        fs.readFileSync(path.join(dir, f), "utf8"),
      ) as Contract[];
      if (Array.isArray(rows)) out.push(...rows);
    }
  }
  return out;
};

interface PgRow {
  key: string;
  ocid: string;
  release_id: string;
  contract_id: string | null;
  tag: string;
  date: string;
  date_signed: string | null;
  awarder_eik: string;
  awarder_name: string;
  contractor_eik: string;
  contractor_name: string;
  amount_eur: number | null;
  unp: string | null;
  title: string;
  cpv: string | null;
  procurement_method: string | null;
  category: string | null;
  lot_name: string | null;
  eu_funded: number | null;
  number_of_tenderers: number | null;
  bundle_uuid: string;
  source_url: string;
}

const loadPg = async (): Promise<MeasuredContract[]> => {
  const { allRows } = await import("../db/lib/pg");
  const rows = await allRows<PgRow>(
    `SELECT key, ocid, release_id, contract_id, tag, date, date_signed, awarder_eik,
            awarder_name, contractor_eik, contractor_name, amount_eur, unp, title, cpv,
            procurement_method, category, lot_name, eu_funded, number_of_tenderers,
            bundle_uuid, source_url
       FROM contracts`,
  );
  return rows.map((r) => ({
    key: r.key,
    ocid: r.ocid,
    releaseId: r.release_id,
    contractId: r.contract_id ?? undefined,
    tag: r.tag as ContractTag,
    date: r.date,
    dateSigned: r.date_signed ?? undefined,
    awarderEik: r.awarder_eik,
    awarderName: r.awarder_name,
    contractorEik: r.contractor_eik,
    contractorName: r.contractor_name,
    amountEur: r.amount_eur ?? undefined,
    unp: r.unp ?? undefined,
    title: r.title,
    cpv: r.cpv ?? undefined,
    procurementMethod: r.procurement_method ?? undefined,
    category: r.category ?? undefined,
    lotName: r.lot_name ?? undefined,
    euFunded: r.eu_funded == null ? undefined : !!r.eu_funded,
    numberOfTenderers: r.number_of_tenderers ?? undefined,
    bundleUuid: r.bundle_uuid,
    sourceUrl: r.source_url,
  }));
};

/** contract_key set of every row carrying a procurement_annexes link. Postgres-only, and
 *  optional: on a machine with no database the annex section is skipped with a note rather
 *  than silently reported as zero. */
const loadAnnexKeys = async (): Promise<Map<string, number> | null> => {
  try {
    const { allRows } = await import("../db/lib/pg");
    // contract_key → HOW MANY annex rows hang off it. The count matters: a contract amended
    // several times carries several rows, and it is the ROWS that are orphaned by an eviction.
    const rows = await allRows<{ contract_key: string; n: string }>(
      "SELECT contract_key, count(*) AS n FROM procurement_annexes GROUP BY 1",
    );
    return new Map(rows.map((r) => [r.contract_key, Number(r.n)]));
  } catch {
    return null;
  }
};

// ── generic lattice ──────────────────────────────────────────────────────────────────────────

/** The population every measurement runs on: real suppliers, identifiable procedure. */
const measurable = (r: Contract): boolean =>
  !isSyntheticCarrier(r) && !!r.unp && !!r.contractorEik;

const amt = (r: Contract): string =>
  r.amountEur == null ? "" : String(Math.round(r.amountEur));

interface LatticeRow {
  id: string;
  groups: number;
  rows: number;
  lesserRows: number;
  lesserEur: number;
}

/** Group by `key`, keep groups spanning >1 feed, and score the "lesser side" — the rows and €
 *  beyond the largest single feed's contribution, i.e. what would go if the group collapsed to
 *  one feed. */
const lattice = (
  rows: Contract[],
  id: string,
  key: (r: Contract) => string | null,
): LatticeRow => {
  const g = new Map<string, Contract[]>();
  for (const r of rows) {
    const k = key(r);
    if (k == null) continue;
    const a = g.get(k);
    if (a) a.push(r);
    else g.set(k, [r]);
  }
  let groups = 0;
  let total = 0;
  let lesserRows = 0;
  let lesserEur = 0;
  for (const rs of g.values()) {
    const byFeed = new Map<Feed, { n: number; eur: number }>();
    for (const r of rs) {
      const f = feedOf(r);
      const e = byFeed.get(f) ?? { n: 0, eur: 0 };
      e.n += 1;
      e.eur += r.amountEur ?? 0;
      byFeed.set(f, e);
    }
    if (byFeed.size < 2) continue;
    groups += 1;
    total += rs.length;
    const maxN = Math.max(...[...byFeed.values()].map((v) => v.n));
    const maxE = Math.max(...[...byFeed.values()].map((v) => v.eur));
    lesserRows += rs.length - maxN;
    lesserEur += rs.reduce((s, r) => s + (r.amountEur ?? 0), 0) - maxE;
  }
  return { id, groups, rows: total, lesserRows, lesserEur };
};

const pairLabel = (rs: Contract[]): string =>
  FEEDS.filter((f) => rs.some((r) => feedOf(r) === f)).join("+");

const eur = (n: number): string =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const pct = (n: number, d: number): string =>
  d === 0 ? "—" : `${Math.round((100 * n) / d)}%`;

// ── main ─────────────────────────────────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  const all = SOURCE === "pg" ? await loadPg() : loadShards();
  const rows = all.filter(measurable);
  const corpusEur = all.reduce((s, r) => s + (r.amountEur ?? 0), 0);

  const out: Record<string, unknown> = {};
  const say = (s = ""): void => {
    if (!JSON_OUT) console.log(s);
  };

  say(`source: ${SOURCE}`);
  say(
    `corpus: ${all.length} rows / €${eur(corpusEur)}  (measurable: ${rows.length})`,
  );
  const byFeed = new Map<Feed, number>();
  for (const r of all) byFeed.set(feedOf(r), (byFeed.get(feedOf(r)) ?? 0) + 1);
  say(
    `feeds: ${FEEDS.map((f) => `${f}=${byFeed.get(f) ?? 0}`).join("  ")}` +
      `  synthetic obed- carriers=${all.filter(isSyntheticCarrier).length}`,
  );
  out.source = SOURCE;
  out.corpusRows = all.length;
  out.corpusEur = corpusEur;

  // ── §1.1 the identity lattice
  say(`\n§1.1 identity lattice (groups spanning >1 feed)`);
  const L = [
    lattice(rows, "A unp+contract_id", (r) =>
      r.contractId ? `${r.unp} ${r.contractId} ${r.tag}` : null,
    ),
    lattice(
      rows,
      "B unp+contractor",
      (r) => `${r.unp} ${r.contractorEik} ${r.tag}`,
    ),
    lattice(rows, "C unp+contractor+amt", (r) =>
      r.amountEur == null
        ? null
        : `${r.unp} ${r.contractorEik} ${amt(r)} ${r.tag}`,
    ),
    lattice(rows, "D unp+contractor+date", (r) =>
      signingDay(r)
        ? `${r.unp} ${r.contractorEik} ${signingDay(r)} ${r.tag}`
        : null,
    ),
    lattice(rows, "E unp+contractor+amt+date", identityE),
  ];
  for (const l of L)
    say(
      `  ${l.id.padEnd(26)} groups=${String(l.groups).padStart(5)}  ` +
        `lesser rows=${String(l.lesserRows).padStart(5)}  lesser €=${eur(l.lesserEur)}`,
    );
  out.lattice = L;

  // ── §2.1 what a two-feed detector hides, on the detector's OWN key (identity A)
  say(
    `\n§2.1 detector gap — identity A (unp, contract_id, tag), the shipped gate's key`,
  );
  const aGroups = new Map<string, Contract[]>();
  for (const r of rows) {
    if (!r.contractId) continue;
    const k = `${r.unp} ${r.contractId} ${r.tag}`;
    const a = aGroups.get(k);
    if (a) a.push(r);
    else aGroups.set(k, [r]);
  }
  const aMatrix = new Map<
    string,
    { full: number; seen: number; eur: number }
  >();
  for (const rs of aGroups.values()) {
    const feeds = new Set(rs.map(feedOf));
    if (feeds.size < 2) continue;
    const label = pairLabel(rs);
    const e = aMatrix.get(label) ?? { full: 0, seen: 0, eur: 0 };
    e.full += 1;
    // The shipped detector's HAVING: at least one `eop-` row AND at least one non-`eop-` row.
    if (feeds.has("eop") && [...feeds].some((f) => f !== "eop")) e.seen += 1;
    e.eur += rs.reduce((s, r) => s + (r.amountEur ?? 0), 0);
    aMatrix.set(label, e);
  }
  let full = 0;
  let seen = 0;
  for (const [label, e] of [...aMatrix].sort((x, y) => y[1].full - x[1].full)) {
    full += e.full;
    seen += e.seen;
    say(
      `  ${label.padEnd(10)} full-matrix=${String(e.full).padStart(4)}  ` +
        `visible to the shipped 2-feed detector=${String(e.seen).padStart(4)}  €${eur(e.eur)}`,
    );
  }
  say(
    `  TOTAL      full-matrix=${full}  visible=${seen}  BLIND=${full - seen}`,
  );
  out.detectorGap = { full, seen, matrix: Object.fromEntries(aMatrix) };

  // ── §2.2 …and why widening the feed matrix ALONE on identity A would be a regression
  say(
    `\n§2.2 aop+rop on identity A — supplier-set relation (the population a naive widening adds)`,
  );
  const arBuckets = new Map<
    string,
    { n: number; sameEur: number; sameDate: number; eur: number }
  >();
  for (const rs of aGroups.values()) {
    const feeds = new Set(rs.map(feedOf));
    if (!(feeds.size === 2 && feeds.has("aop") && feeds.has("rop"))) continue;
    const a = [
      ...new Set(
        rs.filter((r) => feedOf(r) === "aop").map((r) => r.contractorEik),
      ),
    ].sort();
    const b = [
      ...new Set(
        rs.filter((r) => feedOf(r) === "rop").map((r) => r.contractorEik),
      ),
    ].sort();
    const sup = (x: string[], y: string[]): boolean =>
      y.every((v) => x.includes(v));
    const rel =
      sup(a, b) && sup(b, a)
        ? "identical-suppliers"
        : sup(b, a)
          ? "rop-superset"
          : sup(a, b)
            ? "aop-superset"
            : "divergent";
    const ae = rs
      .filter((r) => feedOf(r) === "aop")
      .reduce((s, r) => s + (r.amountEur ?? 0), 0);
    const be = rs
      .filter((r) => feedOf(r) === "rop")
      .reduce((s, r) => s + (r.amountEur ?? 0), 0);
    const e = arBuckets.get(rel) ?? { n: 0, sameEur: 0, sameDate: 0, eur: 0 };
    e.n += 1;
    if (Math.round(ae) === Math.round(be)) e.sameEur += 1;
    if (new Set(rs.map(signingDay)).size === 1) e.sameDate += 1;
    e.eur += Math.min(ae, be);
    arBuckets.set(rel, e);
  }
  for (const [rel, e] of [...arBuckets].sort((x, y) => y[1].n - x[1].n))
    say(
      `  ${rel.padEnd(20)} groups=${String(e.n).padStart(4)}  same total €=${e.sameEur}  ` +
        `single signing date=${e.sameDate}  lesser €=${eur(e.eur)}`,
    );
  const arTotal = [...arBuckets.values()].reduce((s, e) => s + e.n, 0);
  const arDup = [...arBuckets.values()].reduce(
    (s, e) => s + Math.min(e.sameEur, e.sameDate),
    0,
  );
  say(
    `  → ${arDup} of ${arTotal} share BOTH a total and a single date. The rest is contract-number ` +
      `reuse inside frameworks, not duplication.`,
  );
  out.aopRop = Object.fromEntries(arBuckets);

  // ── §3.1 why the shipped survivor check blocks everything
  say(
    `\n§3.1 survivor-check blindness — E-group rows whose OWN (unp, contract_id, tag) has no other-feed row`,
  );
  const analysis = analyzeCrossSource(all);
  const inGroups = analysis.groups.flatMap((g) => g.rows);
  const byContract = new Map<string, Set<Feed>>();
  for (const r of rows) {
    const k = `${r.unp} ${r.contractId ?? ""} ${r.tag}`;
    const s = byContract.get(k) ?? new Set<Feed>();
    s.add(feedOf(r));
    byContract.set(k, s);
  }
  const blindByFeed = new Map<Feed, { n: number; blind: number }>();
  for (const r of inGroups) {
    const f = feedOf(r);
    const e = blindByFeed.get(f) ?? { n: 0, blind: 0 };
    e.n += 1;
    const feeds =
      byContract.get(`${r.unp} ${r.contractId ?? ""} ${r.tag}`) ?? new Set();
    if (![...feeds].some((x) => x !== f)) e.blind += 1;
    blindByFeed.set(f, e);
  }
  for (const f of FEEDS) {
    const e = blindByFeed.get(f);
    if (e)
      say(
        `  ${f.padEnd(5)} ${String(e.blind).padStart(4)}/${String(e.n).padEnd(4)} blocked ` +
          `(${pct(e.blind, e.n)}) by a (unp, contract_id, tag) survivor check`,
      );
  }
  out.survivorBlindness = Object.fromEntries(blindByFeed);

  // ── §4 grading identity C by date gap — the tail this design excludes by construction
  say(
    `\n§4 identity C graded by signing-date gap (identity E keeps only the 0-day bucket)`,
  );
  const cGroups = new Map<string, Contract[]>();
  for (const r of rows) {
    if (r.amountEur == null) continue;
    const k = `${r.unp} ${r.contractorEik} ${amt(r)} ${r.tag}`;
    const a = cGroups.get(k);
    if (a) a.push(r);
    else cGroups.set(k, [r]);
  }
  const BUCKETS = [
    { id: "same date", max: 0 },
    { id: "1-7d", max: 7 },
    { id: "8-31d", max: 31 },
    { id: "1-3mo", max: 92 },
    { id: ">3mo", max: Infinity },
  ];
  const grade = new Map<string, { n: number; eur: number; fw: number }>();
  for (const rs of cGroups.values()) {
    if (new Set(rs.map(feedOf)).size < 2) continue;
    const days = rs
      .map(signingDay)
      .filter(Boolean)
      .map((d) => Date.parse(d));
    if (!days.length) continue;
    const gap = (Math.max(...days) - Math.min(...days)) / 86_400_000;
    const b = BUCKETS.find((x) => gap <= x.max)!;
    const byF = new Map<Feed, number>();
    for (const r of rs)
      byF.set(feedOf(r), (byF.get(feedOf(r)) ?? 0) + (r.amountEur ?? 0));
    const lesser =
      rs.reduce((s, r) => s + (r.amountEur ?? 0), 0) -
      Math.max(...byF.values());
    const fw = rs.some((r) =>
      `${r.title ?? ""} ${r.procurementMethod ?? ""} ${r.category ?? ""}`
        .toLocaleLowerCase("bg")
        .includes("рамк"),
    );
    const e = grade.get(b.id) ?? { n: 0, eur: 0, fw: 0 };
    e.n += 1;
    e.eur += lesser;
    if (fw) e.fw += 1;
    grade.set(b.id, e);
  }
  for (const b of BUCKETS) {
    const e = grade.get(b.id);
    if (e)
      say(
        `  ${b.id.padEnd(11)} groups=${String(e.n).padStart(4)}  lesser €=${eur(e.eur).padStart(16)}  ` +
          `framework signal=${pct(e.fw, e.n)}`,
      );
  }
  out.dateGrading = Object.fromEntries(grade);

  // ── §5.1 precedence evidence, measured on the pairs the ordering actually decides
  const annexKeys = await loadAnnexKeys();
  say(
    `\n§5.1 precedence evidence — aop↔eop twin pairs (what "richer feed" means HERE)`,
  );
  const ae: { a: MeasuredContract; e: MeasuredContract }[] = [];
  for (const g of analysis.groups) {
    const a = g.rows.find((r) => feedOf(r) === "aop");
    const e = g.rows.find((r) => feedOf(r) === "eop");
    if (a && e) ae.push({ a, e });
  }
  const only = (f: (r: MeasuredContract) => boolean) => ({
    aop: ae.filter((p) => f(p.a) && !f(p.e)).length,
    eop: ae.filter((p) => f(p.e) && !f(p.a)).length,
  });
  const has = (v: unknown): boolean =>
    v !== undefined && v !== null && v !== "";
  const prec: Record<string, { aop: number; eop: number }> = {
    "annex link": annexKeys
      ? {
          aop: ae.filter(
            (p) => annexKeys.has(p.a.key) && !annexKeys.has(p.e.key),
          ).length,
          eop: ae.filter(
            (p) => annexKeys.has(p.e.key) && !annexKeys.has(p.a.key),
          ).length,
        }
      : { aop: -1, eop: -1 },
    euFunded: only((r) => has(r.euFunded)),
    lotName: only((r) => has(r.lotName)),
    procurementMethod: only((r) => has(r.procurementMethod)),
    cpv: only((r) => has(r.cpv)),
    "longer title": {
      aop: ae.filter((p) => (p.a.title ?? "").length > (p.e.title ?? "").length)
        .length,
      eop: ae.filter((p) => (p.e.title ?? "").length > (p.a.title ?? "").length)
        .length,
    },
  };
  say(`  ${ae.length} aop↔eop twin pairs`);
  for (const [k, v] of Object.entries(prec))
    say(
      v.aop < 0
        ? `  ${k.padEnd(18)} (needs Postgres — skipped)`
        : `  ${k.padEnd(18)} aop-only=${String(v.aop).padStart(3)}  eop-only=${String(v.eop).padStart(3)}`,
    );
  say(`  → aop outranks eop. Ranking: ocds > aop > eop > rop.`);
  out.precedenceEvidence = prec;

  // ── §5.3 what the pass would do
  say(`\n§5.3 eligibility — identity-E side-pairs`);
  const dir = new Map<
    string,
    { pairs: number; ok: number; blocked: number; rows: number; eur: number }
  >();
  for (const p of analysis.sidePairs) {
    const k = `${p.winner.feed} > ${p.loser.feed}`;
    const e = dir.get(k) ?? { pairs: 0, ok: 0, blocked: 0, rows: 0, eur: 0 };
    e.pairs += 1;
    if (p.eligible) {
      e.ok += 1;
      e.rows += p.loser.rows.length;
      e.eur += p.loser.eur;
    } else e.blocked += 1;
    dir.set(k, e);
  }
  for (const [k, e] of [...dir].sort())
    say(
      `  ${k.padEnd(12)} side-pairs=${String(e.pairs).padStart(3)}  eligible=${String(e.ok).padStart(3)}  ` +
        `blocked=${String(e.blocked).padStart(2)}  rows=${String(e.rows).padStart(3)}  €${eur(e.eur)}`,
    );
  const evEur = analysis.evictions.reduce(
    (s, x) => s + (x.row.amountEur ?? 0),
    0,
  );
  say(
    `  TOTAL        eligible=${analysis.sidePairs.filter((p) => p.eligible).length}  ` +
      `blocked=${analysis.blocked.length}  rows=${analysis.evictions.length}  €${eur(evEur)}`,
  );
  say(
    `  end state:   ${all.length} → ${all.length - analysis.evictions.length} rows;  ` +
      `€${eur(corpusEur)} → €${eur(corpusEur - evEur)}`,
  );
  out.eligibility = {
    groups: analysis.groups.length,
    sidePairs: analysis.sidePairs.length,
    eligible: analysis.sidePairs.filter((p) => p.eligible).length,
    blocked: analysis.blocked.length,
    evictedRows: analysis.evictions.length,
    evictedEur: evEur,
    byDirection: Object.fromEntries(dir),
  };

  if (analysis.ambiguous.length) {
    const aRows = analysis.ambiguous.reduce((s, g) => s + g.rows.length, 0);
    const aEur = analysis.ambiguous.reduce(
      (s, g) => s + g.rows.reduce((t, r) => t + (r.amountEur ?? 0), 0),
      0,
    );
    say(
      `\n§5.3b AMBIGUOUS groups — a feed contributed >1 row, so no 1:1 twin exists (never acted on)`,
    );
    say(
      `  ${analysis.ambiguous.length} group(s), ${aRows} row(s), €${eur(aEur)} left in place`,
    );
    for (const g of analysis.ambiguous) {
      const byF = new Map<Feed, number>();
      for (const r of g.rows) byF.set(feedOf(r), (byF.get(feedOf(r)) ?? 0) + 1);
      say(
        `  ${g.rows[0].unp}  ${[...byF].map(([f, n]) => `${f}×${n}`).join(" ")}  ` +
          `eik=${g.rows[0].contractorEik} €${eur(g.rows[0].amountEur ?? 0)} ` +
          `signed=${signingDay(g.rows[0])}`,
      );
    }
  }
  out.ambiguous = analysis.ambiguous.length;

  say(`\n§5.4 blocked side-pairs (every one, never a count)`);
  for (const p of analysis.blocked)
    say(
      `  ${p.winner.unp}  keep ${p.winner.feed}:${p.winner.contractId} ` +
        `(${p.winner.rows.length} row(s), €${eur(p.winner.eur)})  vs  ` +
        `${p.loser.feed}:${p.loser.contractId} (${p.loser.rows.length} row(s), €${eur(p.loser.eur)})` +
        `\n      matched=${p.matched} — ${p.blockedReason}`,
    );
  out.blocked = analysis.blocked.map((p) => ({
    unp: p.winner.unp,
    winner: `${p.winner.feed}:${p.winner.contractId}`,
    loser: `${p.loser.feed}:${p.loser.contractId}`,
    matched: p.matched,
    reason: p.blockedReason,
  }));

  // ── §5.5 annex impact
  say(`\n§5.5 annex impact`);
  if (!annexKeys) {
    say(`  procurement_annexes unreachable — skipped (needs Postgres)`);
    out.annexOrphans = null;
  } else {
    // COUNT THE ANNEX ROWS, not the evictions. An evicted contract can carry several annexes
    // (one per amendment), so counting evictions answers "how many removed rows have at least
    // one annex" — a different, smaller number that reads as if it were the damage. The figure
    // that matters is how many `procurement_annexes` rows lose their `contract_key` target.
    const orphanKeys = new Set(
      analysis.evictions.map((x) => x.row.key).filter((k) => annexKeys.has(k)),
    );
    const orphans = [...orphanKeys].reduce(
      (s, k) => s + (annexKeys.get(k) ?? 0),
      0,
    );
    say(
      `  ${orphans} procurement_annexes row(s) across ${orphanKeys.size} contract key(s) ` +
        `reference a row this eviction set removes.` +
        (orphans
          ? `\n  → run \`npm run db:load:annexes:pg\` after the reload; it re-resolves against contracts.`
          : ""),
    );
    out.annexOrphans = orphans;
  }

  if (analysis.evictions.length) {
    say(`\nsample evictions (evicted → survivor)`);
    for (const x of analysis.evictions.slice(0, 5))
      say(`  ${describeRow(x.row)}\n    → ${describeRow(x.survivor)}`);
    if (analysis.evictions.length > 5)
      say(`  … ${analysis.evictions.length - 5} more`);
  }

  if (JSON_OUT) console.log(JSON.stringify(out, null, 2));

  if (SOURCE === "pg" || annexKeys) {
    const { end } = await import("../db/lib/pg");
    await end();
  }
};

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
