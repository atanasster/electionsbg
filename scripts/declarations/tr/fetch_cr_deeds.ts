// Layer 1 crawler for the CR Deeds full-capture (docs/plans/cr-deeds-capture-v1.md).
// Fetches the complete deed body per EIK from the Registry Agency CR API and stores
// it verbatim (gzipped) in raw_data/tr/cr_deeds.sqlite. NOTHING is parsed here — the
// projection (Layer 2, parse_cr_deeds.ts) re-derives typed outputs from the cache, so
// adding a field later never costs a second fetch.
//
// ⚠️ This job SUPERSEDES scripts/procurement/fetch_company_founded.ts and shares its
// hardened fetch path (lib/crDeedsClient). NEVER run the two concurrently: they hit one
// rate-limited host from one IP, and two crawlers would throttle each other into the
// block that corrupted the 2026-07 founding-date run.
//
// The rate limit is the binding constraint (~1 req / 5s per IP ≈ 17k/day). A long run
// on one IP tightens over ~7 days; the circuit breaker makes a stalled run LOUD (exit 1)
// so it is resumed from a different egress rather than grinding for days. Everything is
// resumable: an answered EIK is skipped (unless --refresh-before), a failed one is retried.
//
//   tsx scripts/declarations/tr/fetch_cr_deeds.ts --probe 20         # measure block state
//   tsx scripts/declarations/tr/fetch_cr_deeds.ts --tier 0 --limit 50
//   tsx scripts/declarations/tr/fetch_cr_deeds.ts --tier 1           # missing-owner priority set
//   tsx scripts/declarations/tr/fetch_cr_deeds.ts --eiks 121587769,000022044
//   tsx scripts/declarations/tr/fetch_cr_deeds.ts --tier 2a          # all EOOD missing owner
//   tsx scripts/declarations/tr/fetch_cr_deeds.ts --refresh-before 2026-01-01

import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end } from "../../db/lib/pg";
import {
  fetchDeed,
  makePacer,
  sleep,
  BASE_PACE_MS,
  MAX_PACE_MS,
  PACE_GROWTH,
  MAX_RETRY,
  DEGRADED_AFTER,
  DEGRADED_MAX_RETRY,
  MAX_CONSECUTIVE_FAILURES,
  MAX_SILENCE_MS,
} from "./lib/crDeedsClient";
import { CrDeedsStore } from "./cr_deeds_store";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CR_DEEDS_DB = path.resolve(
  __dirname,
  "../../../raw_data/tr/cr_deeds.sqlite",
);

// Include leading-zero EIKs (^[0-9]{9}$, NOT the founding crawler's ^[1-9]…):
// they are disproportionately municipal hospitals / utilities — exactly the
// interesting missing-owner cases (see the plan's §3 audit note).
const EIK9 = "^[0-9]{9}$";

export type Tier = "0" | "1" | "2a" | "2b" | "3";
export const TIERS: Tier[] = ["0", "1", "2a", "2b", "3"];

/**
 * The SQL that enumerates one tier's target EIKs, newest-activity first where a
 * date exists. Pure (returns the string) so it is unit-testable without a DB.
 * `EOOD`/`OOD` cover the Latin code and the post-2021-feed BG long form both.
 */
export const tierSql = (tier: Tier): string => {
  const missingOwner = `
    SELECT c.uic FROM tr_companies c
     WHERE c.legal_form IN ('EOOD','Еднолично дружество с ограничена отговорност')
       AND NOT EXISTS (SELECT 1 FROM tr_person_roles r
                        WHERE r.uic = c.uic AND r.role IN ('sole_owner','actual_owner'))`;
  switch (tier) {
    case "0": // every contractor EIK, newest contract first
      return `SELECT contractor_eik AS eik FROM contracts
               WHERE tag='contract' AND contractor_eik ~ '${EIK9}'
               GROUP BY contractor_eik
               ORDER BY max(date) DESC, contractor_eik`;
    case "1": // missing-owner EOOD ∩ (contractor ∪ EU-funds ∪ subsidy)
      return `WITH miss AS (${missingOwner}),
               tgt AS (
                 SELECT contractor_eik AS eik FROM contracts
                   WHERE tag='contract' AND contractor_eik ~ '${EIK9}'
                 UNION SELECT eik FROM fund_beneficiaries WHERE eik ~ '${EIK9}'
                 UNION SELECT eik FROM agri_subsidies WHERE eik ~ '${EIK9}'
               )
               SELECT m.uic AS eik FROM miss m JOIN tgt t ON t.eik = m.uic
               ORDER BY m.uic`;
    case "2a": // all EOOD missing owner
      return `${missingOwner} ORDER BY c.uic`;
    case "2b": // + ООД missing partner/owner
      return `SELECT c.uic AS eik FROM tr_companies c
               WHERE c.legal_form IN
                     ('EOOD','Еднолично дружество с ограничена отговорност',
                      'OOD','Дружество с ограничена отговорност')
                 AND NOT EXISTS (SELECT 1 FROM tr_person_roles r
                                  WHERE r.uic = c.uic
                                    AND r.role IN ('sole_owner','actual_owner','partner'))
               ORDER BY c.uic`;
    case "3": // full corpus (durable-store completeness)
      return `SELECT uic AS eik FROM tr_companies WHERE uic ~ '${EIK9}' ORDER BY uic`;
  }
};

export type ParsedArgs = {
  eiks?: string[];
  tier: Tier;
  limit?: number;
  probe?: number;
  refreshBefore?: string;
  basePace: number;
};

const DEFAULT_PROBE = 20;

const rawArg = (argv: string[], name: string): string | null | undefined => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const next = argv[i + 1];
  return next === undefined || next.startsWith("--") ? null : next;
};

export const parseArgs = (argv: string[]): ParsedArgs => {
  const num = (name: string, onBare?: number): number | undefined => {
    const raw = rawArg(argv, name);
    if (raw === undefined) return undefined;
    if (raw === null) {
      if (onBare !== undefined) return onBare;
      throw new Error(`--${name} needs a positive number (got nothing)`);
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0)
      throw new Error(
        `--${name} needs a positive number (got ${JSON.stringify(raw)})`,
      );
    return n;
  };

  const probe = num("probe", DEFAULT_PROBE);
  const limit = num("limit");
  if (probe !== undefined && limit !== undefined)
    throw new Error("--probe and --limit both cap the run; pass only one");

  // Floor the pace at the measured token-bucket rate so no typo becomes a hammer.
  const paceArg = num("pace");
  const basePace = Math.max(BASE_PACE_MS, paceArg ?? BASE_PACE_MS);

  const tierRaw = rawArg(argv, "tier");
  const tier = (typeof tierRaw === "string" ? tierRaw : "0") as Tier;
  if (!TIERS.includes(tier))
    throw new Error(
      `--tier must be one of ${TIERS.join(", ")} (got ${tierRaw})`,
    );

  const eiksRaw = rawArg(argv, "eiks");
  // De-dupe: --eiks 111,111 must not spend two rate-limited requests on one EIK.
  const eiks =
    typeof eiksRaw === "string"
      ? [
          ...new Set(
            eiksRaw
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          ),
        ]
      : undefined;

  // --probe is a read-only, block-state check of the TIER set; combining it with
  // an explicit --eiks list silently ran the WRITE path instead. Reject it, the
  // same way --probe + --limit is rejected.
  if (probe !== undefined && eiks?.length)
    throw new Error(
      "--probe measures the tier set; do not combine it with --eiks",
    );

  // Validate the refresh boundary the way the numeric flags are validated: it
  // feeds a lexicographic comparison, so a typo ("yesterday", "2026-13-99")
  // silently no-ops the refresh or re-crawls the entire corpus. Normalize to a
  // full ISO timestamp so the comparison basis is explicit.
  const refreshRaw = rawArg(argv, "refresh-before");
  let refreshBefore: string | undefined;
  if (typeof refreshRaw === "string") {
    const t = Date.parse(refreshRaw);
    if (Number.isNaN(t))
      throw new Error(
        `--refresh-before needs an ISO date (got ${JSON.stringify(refreshRaw)})`,
      );
    refreshBefore = new Date(t).toISOString();
  }

  return {
    eiks: eiks?.length ? eiks : undefined,
    tier,
    limit,
    probe,
    refreshBefore,
    basePace,
  };
};

/** ISO timestamp — passed in so the module has no ambient clock (testable, resumable). */
const nowIso = (): string => new Date().toISOString();

// Module-scoped so the top-level catch can close it too, symmetric with the
// in-band exits (the SQLite handle is WAL-committed per .run(), so this is
// cleanup hygiene, not data-loss prevention).
let store: CrDeedsStore | undefined;

const main = async () => {
  const opts = parseArgs(process.argv.slice(2));

  // Resolve the candidate EIK list (explicit --eiks, or the tier query).
  let candidates: string[];
  if (opts.eiks) {
    candidates = opts.eiks;
  } else {
    const cap = opts.probe ?? opts.limit;
    const sql = tierSql(opts.tier) + (cap !== undefined ? ` LIMIT ${cap}` : "");
    const rows = await allRows<{ eik: string }>(sql);
    candidates = rows.map((r) => r.eik);
  }

  const deeds = (store = new CrDeedsStore(CR_DEEDS_DB));

  // --probe: read-only block-state check, near-zero retry budget, no writes.
  // parseArgs rejects --probe + --eiks, so a probe here is always the tier set.
  if (opts.probe != null) {
    console.log(
      `→ probing ${candidates.length} EIK(s) (read-only, no writes)…`,
    );
    let answered = 0;
    const reasons = new Map<string, number>();
    const started = Date.now();
    for (const eik of candidates) {
      const r = await fetchDeed(eik, {
        pace: opts.basePace,
        maxRetry: DEGRADED_MAX_RETRY,
      });
      if (r.ok) answered++;
      else reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
      await sleep(opts.basePace);
    }
    const secs = Math.round((Date.now() - started) / 1000);
    console.log(
      `✓ probe: ${answered}/${candidates.length} answered in ${secs}s`,
    );
    if (reasons.size)
      console.log(
        `  failures: ${[...reasons].map(([k, v]) => `${k}×${v}`).join(", ")}`,
      );
    deeds.close();
    await end();
    return;
  }

  // Skip EIKs already captured (unless a --refresh-before boundary re-opens them).
  // An explicit --eiks list is a force-fetch of those specific firms and bypasses
  // the skip. For a tier, read the whole fresh set in ONE query, not one
  // hasFresh() per candidate — the difference is N SELECTs before a tier-3 run
  // even starts.
  const eiks = opts.eiks
    ? candidates
    : (() => {
        const fresh = deeds.freshSet(opts.refreshBefore);
        return candidates.filter((e) => !fresh.has(e));
      })();
  const skipped = candidates.length - eiks.length;

  console.log(
    `→ capturing ${eiks.length} EIK(s) for tier ${opts.tier}` +
      (skipped ? ` (${skipped} already captured, skipped)` : "") +
      "…",
  );

  let captured = 0;
  let empty = 0;
  let failed = 0;
  let consecutiveFailures = 0;
  let lastOkAt = Date.now();
  const pacer = makePacer(opts.basePace, MAX_PACE_MS, PACE_GROWTH);

  for (let i = 0; i < eiks.length; i++) {
    const eik = eiks[i];
    const r = await fetchDeed(eik, {
      pace: pacer.current,
      maxRetry:
        consecutiveFailures >= DEGRADED_AFTER ? DEGRADED_MAX_RETRY : MAX_RETRY,
    });

    if (r.ok) {
      // r.body === null is the confirmed empty-200 "no such company" — a real
      // answer, stored with byte_len 0 so resume never re-asks about it.
      deeds.putAnswer(eik, r.body, r.status, nowIso());
      if (r.body === null) empty++;
      else captured++;
      consecutiveFailures = 0;
      lastOkAt = Date.now();
      pacer.onOk();
    } else {
      // NOT written to cr_deeds — recorded as a failure so the next run retries it.
      deeds.putFailure(eik, r.reason, r.status, r.attempts, nowIso());
      failed++;
      consecutiveFailures++;
      pacer.onFail();
      const silentMs = Date.now() - lastOkAt;
      if (
        consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ||
        silentMs > MAX_SILENCE_MS
      ) {
        console.error(
          `✗ circuit breaker: ${consecutiveFailures} consecutive failures, ` +
            `${Math.round(silentMs / 60_000)} min since the last answer ` +
            `(last: ${r.reason}, status ${r.status ?? "n/a"}). The source is ` +
            `refusing this IP — nothing was captured for them. Resume from a ` +
            `different egress; the run is fully resumable.`,
        );
        console.error(
          `  progress: ${i + 1}/${eiks.length} attempted — ${captured} captured, ${empty} empty, ${failed} failed`,
        );
        deeds.close();
        await end();
        process.exit(1);
      }
    }

    if ((i + 1) % 10 === 0 || i === eiks.length - 1)
      console.log(
        `  ${i + 1}/${eiks.length} (${captured} captured, ${empty} empty, ${failed} failed, pace ${pacer.current}ms)`,
      );
    if (i < eiks.length - 1) await sleep(pacer.current);
  }

  const s = deeds.stats();
  console.log(
    `✓ done — ${captured} captured, ${empty} empty, ${failed} failed this run ` +
      `(store now: ${s.captures} captures, ${s.failures} pending failures)`,
  );
  deeds.close();
  await end();
};

// Only run when invoked as a script, so the exported helpers stay unit-testable.
if (process.argv[1]?.includes("fetch_cr_deeds"))
  main().catch(async (e) => {
    console.error(
      "✗ fetch_cr_deeds failed:",
      e instanceof Error ? e.message : e,
    );
    store?.close();
    await end().catch(() => {});
    process.exit(1);
  });
