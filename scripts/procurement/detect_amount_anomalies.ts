// Report contract rows whose published value is ~100× their own published lot
// estimate — the stotinki-into-a-leva-field data-entry error described in
// amount_overrides.ts.
//
// This is the ONLY sanctioned way to grow AMOUNT_OVERRIDES. It splits candidates
// into two classes and never edits anything:
//
//   CORRECTABLE  contractValue / 100 reproduces the row's own estimate to within
//                a stotinka. Structural proof the CONTRACT is the corrupted side.
//                Copy these into AMOUNT_OVERRIDES by hand.
//
//   AMBIGUOUS    ratio lands near 100× but ÷100 does NOT reproduce the estimate.
//                Here it is usually the ESTIMATE that is wrong, and the contract
//                is real. NEVER add these — dividing would destroy good data.
//
// Reads the cached ЦАИС ЕОП flat `договори` feed, which is the only feed carrying
// a per-row (lot-level) estimate. Rows already covered by AMOUNT_OVERRIDES are
// reported as "known" so a re-run is a clean diff.
//
//   npx tsx scripts/procurement/detect_amount_anomalies.ts
//
// No network, no writes.

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { AMOUNT_OVERRIDES } from "./amount_overrides";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EOP_CACHE_DIR = path.resolve(__dirname, "../../raw_data/procurement/eop");

// The band worth looking at at all. Wide enough to catch a dropped decimal that
// also picked up rounding noise, narrow enough to exclude real overruns.
const RATIO_LO = 99.5;
const RATIO_HI = 100.5;
// A dropped decimal point reproduces the estimate exactly; allow one stotinka of
// upstream rounding. Everything looser is ambiguous by construction.
const CORRECTABLE_TOL = 0.02;

/** Parse a Bulgarian-formatted decimal. Mirrors normalize_eop.ts::parseBgNumber. */
const parseBgNumber = (v: unknown): number | undefined => {
  if (v == null) return undefined;
  const cleaned = String(v)
    .trim()
    .replace(/[\s\u00A0]/g, "")
    .replace(/,(\d{3})(?!\d)/g, "$1")
    .replace(/,(\d{1,2})$/, ".$1");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
};

const known = new Set(
  AMOUNT_OVERRIDES.flatMap((o) =>
    [o.unp, o.ocid].filter(Boolean).map((k) => `${k}::${o.contractId}`),
  ),
);

interface Row {
  unp: string;
  contractId: string;
  buyer: string;
  currency: string;
  estimate: number;
  contract: number;
  known: boolean;
}

const correctable: Row[] = [];
const ambiguous: Row[] = [];

for (const f of fs.readdirSync(EOP_CACHE_DIR).sort()) {
  if (!f.endsWith(".json.gz")) continue;
  let recs: Array<Record<string, unknown>>;
  try {
    recs = JSON.parse(
      zlib.gunzipSync(fs.readFileSync(path.join(EOP_CACHE_DIR, f))).toString(),
    );
  } catch {
    continue;
  }
  if (!Array.isArray(recs)) continue;

  for (const r of recs) {
    const contractId = String(r.contractNumber ?? "").trim();
    if (!contractId) continue;
    const contract = parseBgNumber(r.contractValue);
    const estimate = parseBgNumber(r.estimatedValue);
    if (!contract || !estimate || estimate <= 0 || contract <= 0) continue;

    const ratio = contract / estimate;
    if (ratio < RATIO_LO || ratio > RATIO_HI) continue;

    const unp = String(r.uniqueProcurementNumber ?? "");
    const row: Row = {
      unp,
      contractId,
      buyer: String(r.buyerName ?? "").slice(0, 34),
      currency: String(r.contractCurrency ?? ""),
      estimate,
      contract,
      // ЕОП rows are keyed by unp when it is a real УНП, else by the synthetic ocid.
      known:
        known.has(`${unp}::${contractId}`) ||
        known.has(`eop-${unp}::${contractId}`),
    };
    (Math.abs(contract / 100 - estimate) <= CORRECTABLE_TOL
      ? correctable
      : ambiguous
    ).push(row);
  }
}

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2 });
const show = (rows: Row[], tagged = true) => {
  for (const r of rows.sort((a, b) => b.contract - a.contract)) {
    const tag = !tagged ? "      " : r.known ? "known " : "NEW   ";
    console.log(
      `  ${tag}${r.unp.padEnd(17)}${r.contractId.slice(0, 10).padEnd(11)}` +
        `${fmt(r.contract).padStart(18)} -> ${fmt(r.contract / 100).padStart(15)}` +
        `   est ${fmt(r.estimate).padStart(15)}  ${r.currency}  ${r.buyer}`,
    );
  }
};

console.log(
  `CORRECTABLE — contract ÷100 reproduces its own estimate (${correctable.length})`,
);
show(correctable);
console.log(
  `\nAMBIGUOUS — near 100x but ÷100 does NOT match the estimate (${ambiguous.length})`,
);
console.log(
  "  Do NOT add these to AMOUNT_OVERRIDES: the estimate is the likely error.",
);
show(ambiguous, false);

const fresh = correctable.filter((r) => !r.known);
console.log(
  `\n${correctable.length} correctable, ${correctable.length - fresh.length} already in AMOUNT_OVERRIDES, ${fresh.length} new.`,
);
if (fresh.length) {
  console.log(
    "Add the NEW rows to amount_overrides.ts after checking each one.",
  );
  process.exitCode = 1;
}
