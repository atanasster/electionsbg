// Build a slim КЗК-appeals summary for the AI sub-app (which reads bucket JSON,
// not Postgres). Reads the ingest artifact data/procurement/kzk_appeals.json
// (produced by kzk_appeals.ts) → writes data/procurement/derived/
// kzk_appeals_summary.json: corpus totals, per-year, outcome split, and the
// most-appealed buyers. Small + committed (like risk_feed.json) so the
// `procurementAppeals` AI tool can fetch it. This is a JSON→JSON aggregation, so
// it isn't the kind of full table serialization the no-JSON-from-PG rule targets
// — but note the input's enrichment fields (buyerEik, match, outcome) only reach
// the JSON via applyPg's PG write-back, so the summary is transitively PG-sourced.
// Do not cite it as precedent for generating a serving artifact straight from PG.
//
// Run: tsx scripts/procurement/build_kzk_summary.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IN = path.resolve(__dirname, "../../data/procurement/kzk_appeals.json");
const OUT = path.resolve(
  __dirname,
  "../../data/procurement/derived/kzk_appeals_summary.json",
);

type Appeal = {
  complaintNo: string;
  complaintDate: string | null;
  unp: string | null;
  respondent: string | null;
  status?: string | null;
  // Enrichment-only fields — present only on rows that went through applyPg's
  // PG write-back; a bare-scrape JSON won't have them, so they're optional.
  buyerEik?: string | null;
  buyerName?: string | null;
  outcome?: string | null;
  suspension?: boolean | null;
  match?: string;
};

const main = () => {
  // kzk_appeals.json is gitignored (produced by the manual, BG-only ingest), so
  // a fresh clone won't have it — skip cleanly rather than ENOENT-crash.
  if (!fs.existsSync(IN)) {
    console.warn(
      `skip: ${IN} not found (run scripts/procurement/kzk_appeals.ts first)`,
    );
    return;
  }
  const appeals: Appeal[] =
    JSON.parse(fs.readFileSync(IN, "utf8")).appeals ?? [];
  const yr = (d: string | null) => (d || "").slice(0, 4);

  const byYear: Record<string, number> = {};
  const buyer = new Map<
    string,
    { names: Map<string, number>; count: number; upheld: number }
  >();
  let resolved = 0,
    withOutcome = 0,
    upheld = 0,
    rejected = 0,
    suspended = 0;

  for (const a of appeals) {
    const y = yr(a.complaintDate);
    if (y) byYear[y] = (byYear[y] || 0) + 1;
    if (a.match === "exact") resolved++;
    // Effective suspended = tier-2 column OR fresh intake status (спрян…) —
    // mirrors tender_appeals / kzk_recent_appeals; intake no longer stores a bool.
    if (a.suspension || (a.status && /спрян/i.test(a.status))) suspended++;
    if (a.outcome) {
      withOutcome++;
      if (a.outcome === "уважена") upheld++;
      else if (a.outcome === "отхвърлена") rejected++;
    }
    // Most-appealed buyers (resolved to a tender buyer only).
    if (a.buyerEik) {
      const e = buyer.get(a.buyerEik) ?? {
        names: new Map<string, number>(),
        count: 0,
        upheld: 0,
      };
      // Tally every name spelling so we can pick the MODAL (most-frequent) one —
      // an EIK's procedures file under both the parent name (e.g. АПИ) and its
      // regional branches; first-encountered would arbitrarily label the EIK by a
      // branch. buyerName (canonical from the tenders corpus) preferred, else the
      // КЗК respondent.
      const nm = a.buyerName ?? a.respondent ?? a.buyerEik;
      e.names.set(nm, (e.names.get(nm) ?? 0) + 1);
      e.count++;
      if (a.outcome === "уважена") e.upheld++;
      buyer.set(a.buyerEik, e);
    }
  }

  // The modal name for an EIK: highest frequency, ties broken by longer string
  // (deterministic; the fuller parent name tends to be longer than a branch).
  const modalName = (names: Map<string, number>, fallback: string): string =>
    [...names.entries()].sort(
      (x, y) => y[1] - x[1] || y[0].length - x[0].length,
    )[0]?.[0] ?? fallback;

  const topBuyers = [...buyer.entries()]
    .map(([eik, v]) => ({
      eik,
      name: modalName(v.names, eik),
      count: v.count,
      upheld: v.upheld,
    }))
    // Deterministic order: count desc, then upheld desc, then eik — without the
    // tiebreak, buyers with equal counts fall back to Map insertion order, so a
    // tie straddling the top-25 cutoff could change WHICH buyer appears in the
    // committed artifact between runs (matches mergeWrite's eik tiebreak).
    .sort(
      (a, b) =>
        b.count - a.count || b.upheld - a.upheld || a.eik.localeCompare(b.eik),
    )
    .slice(0, 25);

  const summary = {
    generatedAt: new Date().toISOString(),
    totals: {
      complaints: appeals.length,
      resolvedToTender: resolved,
      withOutcome,
      upheld,
      rejected,
      suspended,
    },
    byYear,
    topBuyers,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log(
    `wrote ${OUT}: ${appeals.length} complaints, ${withOutcome} with outcome (${upheld} upheld/${rejected} rejected), ${topBuyers.length} top buyers`,
  );
};

main();
