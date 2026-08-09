// Council ingest — Phase 1 orchestrator CLI.
//
// Reads data/council/sources.json, picks the per-município parser, runs
// it for the requested obshtina(s) within the requested time window, and
// merges results back via lib/index_writer.ts. Each obshtina key in the
// recipes file maps to ONE entry in the dispatcher below — new munis
// land here when their per-município parser ships.
//
// Usage:
//   npx tsx scripts/council/scrape.ts                           # all wired munis, since last ingest
//   npx tsx scripts/council/scrape.ts --only VTR01              # one município
//   npx tsx scripts/council/scrape.ts --only VTR01 --since-year 2025 --max 3
//   npx tsx scripts/council/scrape.ts --only VTR01 --dry        # parse, don't write index/shards
//   npx tsx scripts/council/scrape.ts --budget-min 5            # tighter per-município wall clock
//
// State watermark: state/ingest/council_<obshtina>.json carries
// `lastSuccessfulIngest` (set via scripts/stamp-ingest.ts), the `sinceDate`
// watermark this script reads to decide what's new, and a `deferred` list
// of protocols we know we are missing.
//
// The watermark is NOT "the newest date we parsed" — see lib/watermark.ts.
// Parsers filter on `date > sinceDate`, so advancing past a protocol that
// failed to download removes it from consideration for ever, and it is
// reported exactly once before disappearing.
//
// EVERY município reports a terminal status, and the run is only
// "complete" when none of them is NOT REACHED. That distinction is the
// whole point of the status table below: on 2026-08-09 obs.kazanlak.bg
// accepted connections and then never answered, the run sat on Казанлък
// for over an hour with no output, and the municipality ordered after it
// was never scraped — with nothing anywhere saying so. A truncated run
// looked exactly like a complete one in which nobody had published a new
// protocol.
//
// Three things keep that from recurring, in order of how much they carry:
//   1. per-request deadlines + a per-host circuit breaker (lib/fetch.ts),
//   2. a per-município wall-clock budget opened here, which aborts the
//      município's in-flight requests and moves on to the next one,
//   3. this status table + a non-zero exit when anything is unreached,
//      so a truncated run cannot read as a quiet one.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { command, flag, number, optional, option, run, string } from "cmd-ts";
import type { MuniRecipe, SourcesFile, MuniScrapeResult } from "./lib/types";
import { computeWatermark, type DeferredProtocol } from "./lib/watermark";
import { mergeMuniResult } from "./lib/index_writer";
import {
  beginMuniBudget,
  endMuniBudget,
  muniBudgetExpired,
  muniLookupFailureReasons,
  muniLookupFailures,
} from "./lib/fetch";
import { scrapeVTR } from "./parsers/vtr";
import { scrapeSZR } from "./parsers/szr";
import { scrapeRSE } from "./parsers/rse";
import { scrapePVN } from "./parsers/pvn";
import { scrapeVAR } from "./parsers/var";
import { scrapeBGS } from "./parsers/bgs";
import { scrapeSOF } from "./parsers/sof";
import { scrapePDV } from "./parsers/pdv";
import { scrapeSLV } from "./parsers/slv";
import { scrapeGAB } from "./parsers/gab";
import { scrapeSZRK } from "./parsers/szrk";
import { scrapeHKV } from "./parsers/hkv";
import { scrapeDOB } from "./parsers/dob";
import { scrapeHKV09 } from "./parsers/hkv09";
import { scrapeRAZ } from "./parsers/raz26";
import { scrapePER } from "./parsers/per32";

const STATE_DIR = join(process.cwd(), "state/ingest");
const SOURCES_PATH = join(process.cwd(), "data/council/sources.json");

type Dispatcher = (
  recipe: MuniRecipe,
  opts: {
    sinceYear?: number;
    sinceDate?: string;
    maxProtocols?: number;
    perCouncillor?: boolean;
    ocr?: boolean;
  },
) => Promise<MuniScrapeResult>;

/**
 * One entry per município that has a working parser. Munis present in
 * sources.json but absent here are skipped with a warning — that's the
 * signal that their parser hasn't shipped yet.
 */
const DISPATCHERS: Record<string, Dispatcher> = {
  VTR01: scrapeVTR,
  SZR01: scrapeSZR,
  RSE01: scrapeRSE,
  PVN01: scrapePVN,
  VAR01: scrapeVAR,
  BGS01: scrapeBGS,
  SOF: scrapeSOF,
  PDV01: scrapePDV,
  SLV01: scrapeSLV,
  GAB05: scrapeGAB,
  SZR12: scrapeSZRK,
  HKV34: scrapeHKV,
  DOB28: scrapeDOB,
  HKV09: scrapeHKV09,
  RAZ26: scrapeRAZ,
  PER32: scrapePER,
};

type IngestState = {
  skill: string;
  lastSuccessfulIngest: string;
  summary?: string;
  // Optional per-município date watermark; the parser uses this as
  // `sinceDate`. When absent we fall back to a one-year lookback.
  sinceDate?: string;
  // Protocols we know we are missing — see lib/watermark.ts. Absent when
  // there are none, so a healthy município's state file stays as it was.
  deferred?: DeferredProtocol[];
};

const readIngestState = async (
  obshtina: string,
): Promise<IngestState | null> => {
  const path = join(STATE_DIR, `council_${obshtina}.json`);
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as IngestState;
  } catch {
    return null;
  }
};

const writeIngestStamp = async (
  obshtina: string,
  summary: string,
  sinceDate: string,
  deferred: DeferredProtocol[],
): Promise<void> => {
  await mkdir(STATE_DIR, { recursive: true });
  const state: IngestState = {
    skill: `council_${obshtina}`,
    lastSuccessfulIngest: new Date().toISOString(),
    summary,
    sinceDate,
    ...(deferred.length > 0 ? { deferred } : {}),
  };
  await writeFile(
    join(STATE_DIR, `council_${obshtina}.json`),
    JSON.stringify(state, null, 2) + "\n",
    "utf8",
  );
};

/**
 * Default wall clock per município. Generous — Казанлък's brute-force
 * probe legitimately walks ~1,440 URLs, and Sofia drives a real browser.
 * `--ocr` raises it, because one Gemini Vision call on a 12-page scan is
 * itself 5-8 minutes.
 */
const DEFAULT_BUDGET_MIN = 20;
const OCR_BUDGET_MIN = 60;

/**
 * After the budget expires every request fails immediately, so a
 * dispatcher should unwind in seconds. This grace is the backstop for the
 * things the fetch layer cannot abort — a wedged pdftotext, a Playwright
 * page — after which we abandon the dispatcher and move on.
 */
const HARD_STOP_GRACE_MS = 60_000;

class AbandonedError extends Error {
  constructor(key: string, ms: number) {
    super(
      `${key}: still running ${Math.round(ms / 1000)}s after its budget — abandoned (a non-HTTP stall: pdftotext, Playwright, or similar)`,
    );
    this.name = "AbandonedError";
  }
}

/**
 * Terminal state per município. `not-reached` is the initial value for
 * every target and is never set explicitly — anything still carrying it
 * when the run ends is a município the loop never got to.
 */
type RunStatus =
  | "not-reached"
  | "ok"
  | "no-new"
  | "unverified"
  | "dry"
  | "failed"
  | "timed-out"
  | "abandoned"
  | "skipped";

const STATUS_LABEL: Record<RunStatus, string> = {
  "not-reached": "NOT REACHED",
  ok: "ok",
  "no-new": "no new",
  // Reached, touched zero protocols, and at least one LOOKUP failed —
  // absence of evidence, not evidence of absence, so it is neither merged
  // nor stamped. Казанлък on 2026-08-09 is the case: the Wayback index
  // 429'd and the council host refused every connection, so "0 new
  // protocols" would have been a claim we had no basis for.
  unverified: "UNVERIFIED",
  dry: "dry",
  failed: "FAILED",
  "timed-out": "TIMED OUT",
  abandoned: "ABANDONED",
  skipped: "skipped",
};

type RunRow = { key: string; name: string; status: RunStatus; detail: string };

const cli = command({
  name: "council-scrape",
  description: "Council resolutions + vote tally ingest (Phase 1)",
  args: {
    only: option({
      type: optional(string),
      long: "only",
      description:
        "Run a single município key from sources.json (e.g. VTR01). Default: all wired munis.",
    }),
    sinceYear: option({
      type: optional(number),
      long: "since-year",
      description:
        "Earliest year of protocols to consider (default: prev year + current).",
    }),
    sinceDate: option({
      type: optional(string),
      long: "since-date",
      description:
        "ISO date filter (YYYY-MM-DD); only protocols newer than this are touched. Defaults to watermark from state/ingest/council_{muni}.json.",
    }),
    max: option({
      type: optional(number),
      long: "max",
      description: "Cap protocols per município (testing aid).",
    }),
    perCouncillor: flag({
      long: "per-councillor",
      description:
        "Phase 2 — extract per-councillor named-vote blocks and join to the data/officials/municipal/ roster. Slower; adds tally.perCouncillor[].",
    }),
    ocr: flag({
      long: "ocr",
      description:
        "Phase 3 — opt in to Gemini Vision OCR fallback for scanned PDFs. Costs real money per page; only used when pdftotext returns near-zero text. Requires GEMINI_API_KEY in .env.local.",
    }),
    dry: flag({
      long: "dry",
      description:
        "Parse and report — do NOT write index/shards or stamp ingest state.",
    }),
    budgetMin: option({
      type: optional(number),
      long: "budget-min",
      description: `Wall-clock minutes per município before it is abandoned and the run moves on (default ${DEFAULT_BUDGET_MIN}, ${OCR_BUDGET_MIN} with --ocr).`,
    }),
  },
  handler: async (args) => {
    const raw = await readFile(SOURCES_PATH, "utf8");
    const sources = JSON.parse(raw) as SourcesFile;

    const allKeys = Object.keys(sources.munisByObshtina);
    const targets = args.only ? [args.only] : allKeys;

    const budgetMin =
      args.budgetMin ?? (args.ocr ? OCR_BUDGET_MIN : DEFAULT_BUDGET_MIN);
    const budgetMs = Math.max(1, budgetMin) * 60_000;

    let totalAdded = 0;
    let totalUpdated = 0;
    let totalTouched = 0;
    let abandoned = 0;
    let totalDeferred = 0;
    const deferredByMuni = new Map<string, DeferredProtocol[]>();
    const errors: Array<{ key: string; url: string; message: string }> = [];

    // Seeded as `not-reached` for every target BEFORE the loop, so the row
    // for a município the loop never gets to already exists and says so.
    const rows = new Map<string, RunRow>(
      targets.map((key) => [
        key,
        {
          key,
          name: sources.munisByObshtina[key]?.name ?? "(unknown key)",
          status: "not-reached" as RunStatus,
          detail: "",
        },
      ]),
    );
    const setStatus = (key: string, status: RunStatus, detail = "") => {
      const row = rows.get(key);
      if (row) {
        row.status = status;
        row.detail = detail;
      }
    };

    let reported = false;
    const printReport = () => {
      if (reported) return;
      reported = true;
      const notReached = targets.filter(
        (k) => rows.get(k)?.status === "not-reached",
      );
      const keyWidth = Math.max(...targets.map((k) => k.length), 5);
      console.log("\n→ per-município status");
      for (const key of targets) {
        const row = rows.get(key);
        if (!row) continue;
        console.log(
          `    ${STATUS_LABEL[row.status].padEnd(11)} ${row.key.padEnd(keyWidth)}  ${row.name}${row.detail ? ` — ${row.detail}` : ""}`,
        );
      }
      console.log(
        `\n→ done · ${totalAdded} new · ${totalUpdated} updated · ${totalTouched} protocol(s) touched · ${
          targets.filter((k) => rows.get(k)?.status === "skipped").length
        } skipped · ${notReached.length} not reached · ${errors.length} fetch error(s) · ${totalDeferred} deferred`,
      );
      if (errors.length > 0) {
        console.log("  errors:");
        for (const e of errors) {
          // Most messages already lead with the URL — don't print it twice.
          const where = e.message.includes(e.url) ? "" : ` ${e.url}:`;
          console.log(`    ${e.key}${where} ${e.message}`);
        }
      }
      if (deferredByMuni.size > 0) {
        console.log(
          "\n  deferred — protocols we know are missing (state/ingest/council_<key>.json):",
        );
        for (const [key, list] of deferredByMuni) {
          for (const d of list.slice(0, 3))
            console.log(
              `    ${key} ${d.date ?? "(undated)"} ${d.url}${
                d.givenUp ? " [given up]" : ""
              } — ${d.message} (attempt ${d.attempts}, since ${d.firstSeen.slice(0, 10)})`,
            );
          if (list.length > 3)
            console.log(`    ${key} … and ${list.length - 3} more`);
        }
      }
      if (notReached.length > 0) {
        console.log(
          `\n!! run TRUNCATED — ${notReached.length} município(s) were never reached: ${notReached.join(", ")}.` +
            `\n   Their data is UNCHANGED and UNCHECKED — this is NOT "no new protocols". Re-run with --only <key>.`,
        );
      }
      return notReached.length;
    };

    // A manual kill is exactly the case the status table exists for, so
    // print it on the way out rather than leaving the operator to guess
    // how far the run got.
    for (const sig of ["SIGINT", "SIGTERM"] as const) {
      process.on(sig, () => {
        console.log(`\n! ${sig} — stopping`);
        printReport();
        process.exit(130);
      });
    }

    console.log(
      `→ council scrape · ${targets.length} município(s) · budget ${budgetMin}m each`,
    );

    let index = 0;
    for (const key of targets) {
      index++;
      const recipe = sources.munisByObshtina[key];
      if (!recipe) {
        console.warn(`! unknown município key: ${key}`);
        setStatus(key, "failed", "unknown município key");
        continue;
      }
      if (recipe.phase1Defer) {
        console.log(
          `- skip ${key} (${recipe.name}) — phase1Defer: ${recipe.deferReason ?? ""}`,
        );
        setStatus(key, "skipped", `phase1Defer: ${recipe.deferReason ?? ""}`);
        continue;
      }
      const dispatcher = DISPATCHERS[key];
      if (!dispatcher) {
        console.log(
          `- skip ${key} (${recipe.name}) — parser not yet shipped (tier ${recipe.tier})`,
        );
        setStatus(key, "skipped", `parser not shipped (tier ${recipe.tier})`);
        continue;
      }

      const prev = await readIngestState(key);
      const sinceDate = args.sinceDate ?? prev?.sinceDate;
      console.log(
        `→ [${index}/${targets.length}] ${key} ${recipe.name} (sinceDate=${sinceDate ?? "n/a"}, sinceYear=${args.sinceYear ?? "auto"})`,
      );

      const startedAt = Date.now();
      let hardTimer: NodeJS.Timeout | undefined;
      beginMuniBudget(key, budgetMs);
      try {
        const hardStop = new Promise<never>((_, reject) => {
          hardTimer = setTimeout(
            () =>
              reject(new AbandonedError(key, budgetMs + HARD_STOP_GRACE_MS)),
            budgetMs + HARD_STOP_GRACE_MS,
          );
          hardTimer.unref?.();
        });
        const result = await Promise.race([
          dispatcher(recipe, {
            sinceYear: args.sinceYear,
            sinceDate,
            maxProtocols: args.max,
            perCouncillor: args.perCouncillor,
            ocr: args.ocr,
          }),
          hardStop,
        ]);
        for (const e of result.errors) errors.push({ key, ...e });
        const errNote =
          result.errors.length > 0
            ? ` · ${result.errors.length} fetch error(s)`
            : "";
        // Asked of the fetch layer, not counted from result.errors — that
        // array also carries a parser's deliberate skips ("PDF variant
        // skipped"), which are not a failure to look.
        const lookupFailures = muniLookupFailures();
        if (args.dry) {
          console.log(
            `  [DRY] ${key}: ${result.resolutions.length} resolution(s) parsed across ${result.protocolsTouched} protocol(s); index/shards NOT written`,
          );
          setStatus(
            key,
            "dry",
            `${result.resolutions.length} resolution(s) across ${result.protocolsTouched} protocol(s)${errNote}`,
          );
          continue;
        }
        if (result.protocolsTouched === 0 && lookupFailures > 0) {
          // Neither merged nor stamped. `lastSuccessfulIngest` is what the
          // orchestrator reads to decide whether this município still owes
          // a run — stamping it here would record "checked, nothing new"
          // for a município whose source we never managed to read, and the
          // retry would never happen. There is nothing to merge either:
          // zero protocols touched means zero resolutions.
          // Print the REASONS, not just the count. On 2026-08-09 ten
          // municipalities each reported "1 failed lookup" and those ten
          // were three unrelated faults — four council hosts blackholing
          // TCP, two Cloudflare 520s, and an IP-level 429 from
          // web.archive.org shared by the rest. The count cannot tell them
          // apart, and which one it is decides whether you fix code, wait,
          // or back off.
          const why = muniLookupFailureReasons();
          console.log(
            `  ${key}: source unreadable (${lookupFailures} failed lookup(s)) — NOT stamping lastSuccessfulIngest`,
          );
          for (const line of why) console.log(`      ${line}`);
          setStatus(
            key,
            "unverified",
            `reached, but ${lookupFailures} lookup(s) failed — 0 protocol(s) is NOT a finding${errNote}` +
              (why.length > 0
                ? `\n${" ".repeat(16)}${why.join(`\n${" ".repeat(16)}`)}`
                : ""),
          );
          continue;
        }
        const merge = await mergeMuniResult(result, recipe.name);
        // NOT "the newest date we parsed". A protocol that failed to
        // download caps the watermark below its own date, or the next run
        // filters it out (`date > sinceDate`) and it is lost for good.
        const mark = computeWatermark({
          previous: sinceDate,
          resolutions: result.resolutions,
          errors: result.errors,
          previousDeferred: prev?.deferred,
          now: new Date().toISOString(),
        });
        if (mark.heldBy) {
          console.log(
            `  ${key}: watermark held at ${mark.next || "(start)"} by ${
              mark.heldBy.date ?? "an un-enumerated index"
            } — ${mark.heldBy.url}`,
          );
        }
        for (const d of mark.resolved)
          console.log(`  ${key}: recovered deferred protocol ${d.url}`);
        for (const d of mark.gaveUp)
          console.log(
            `  ! ${key}: giving up on ${d.url} after ${d.attempts} attempts since ${d.firstSeen.slice(0, 10)} — it no longer holds the watermark, but stays on the deferred list`,
          );
        await writeIngestStamp(
          key,
          `${result.protocolsTouched} prot(s) → ${merge.added}+/${merge.updated}=/${merge.total} total`,
          mark.next,
          mark.deferred,
        );
        totalAdded += merge.added;
        totalUpdated += merge.updated;
        totalTouched += result.protocolsTouched;
        console.log(
          `  ${key}: +${merge.added} new, ${merge.updated} updated, ${merge.total} total`,
        );
        totalDeferred += mark.deferred.length;
        if (mark.deferred.length > 0) deferredByMuni.set(key, mark.deferred);
        const deferNote =
          mark.deferred.length > 0 ? ` · ${mark.deferred.length} deferred` : "";
        const heldNote = mark.heldBy
          ? ` · watermark held at ${mark.next || "(start)"}`
          : "";
        setStatus(
          key,
          result.protocolsTouched > 0 ? "ok" : "no-new",
          (result.protocolsTouched > 0
            ? `+${merge.added} new · ${merge.updated} updated · ${result.protocolsTouched} protocol(s)`
            : `reached · 0 new protocol(s)`) +
            errNote +
            deferNote +
            heldNote,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const secs = Math.round((Date.now() - startedAt) / 1000);
        // muniBudgetExpired() is still readable here — endMuniBudget()
        // runs in the finally, which is after this catch.
        const status: RunStatus =
          err instanceof AbandonedError
            ? "abandoned"
            : muniBudgetExpired()
              ? "timed-out"
              : "failed";
        if (err instanceof AbandonedError) abandoned++;
        console.error(
          `! ${key} ${STATUS_LABEL[status]} after ${secs}s: ${msg}`,
        );
        errors.push({ key, url: recipe.indexUrl, message: msg });
        setStatus(key, status, `after ${secs}s — ${msg}`);
      } finally {
        if (hardTimer) clearTimeout(hardTimer);
        endMuniBudget();
      }
    }

    const notReached = printReport() ?? 0;
    const code = notReached > 0 ? 1 : 0;
    if (abandoned > 0) {
      // An abandoned dispatcher's promise is still pending and can hold
      // the event loop open indefinitely. Every write above is awaited, so
      // nothing is in flight — flush stdout and go.
      process.stdout.write("", () => process.exit(code));
      return;
    }
    process.exitCode = code;
  },
});

run(cli, process.argv.slice(2));
