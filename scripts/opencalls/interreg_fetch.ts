// Crawl the Interreg programme sites into a committed snapshot.
//
//   npm run opencalls:interreg            # crawl + write data/opencalls/interreg.json
//   npm run opencalls:interreg -- --dry   # crawl, report, write nothing
//   … -- --allow-shrink    override the per-source shrink guard (a legitimate contraction)
//   … -- --allow-partial   write even though a programme that had rows returned none
//
// ── WHAT THIS ARM IS WORTH TODAY, MEASURED 2026-08-09 ───────────────────────────────────────
// Nine calls across the two readable programmes, and NONE of them open: Greece-Bulgaria's most
// recent closed on 2026-06-22 (seven weeks ago) and Black Sea Basin's on 2024-06-28. That is not
// a reason to skip the arm — it is the arm's first result, and it is one nobody is publishing:
// a border municipality asking „is there an Interreg call I can apply to?" currently gets
// silence, and „no, the last one closed on 22 June, here is the programme page" is an answer.
//
// The closed rows are LOADED, not discarded. `open_calls` accumulates by design (142's header:
// absence is recorded, never deleted) because base rates, „затвори наскоро" and the archive all
// need closed calls. It also means the arm has real rows to verify against on a day when nothing
// is open — a crawler whose correct output is the empty set cannot be checked end to end.
//
// ── POLITENESS ──────────────────────────────────────────────────────────────────────────────
// One index GET per programme, then one GET per call, SERIAL, with a delay and an identifying
// User-Agent. At nine calls that is eleven requests. These are small programme secretariats, not
// a government API.
//
// ── ON THE PROGRAMMES THAT ARE NOT HERE ─────────────────────────────────────────────────────
// Three of Bulgaria's six cross-border programmes could not be reached at all on 2026-08-09 —
// see `PROGRAMMES` in interreg_parse.ts for the measurement. A crawler that listed them would
// report „0 calls" for a programme it never read, which is exactly the shape that makes a hole
// look like a finding. They are named in the plan and in the coverage line instead.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { OpenCall } from "./types";
import {
  PROGRAMMES,
  parseCall,
  parseIndex,
  type Programme,
} from "./interreg_parse";
import { writeSnapshot } from "./write_snapshot";

const UA = "electionsbg-opencalls/1.0 (+https://electionsbg.com)";
const DELAY_MS = 1_500;
const TIMEOUT_MS = 45_000;
/** A programme index with more links than this is a parse gone wrong, not a busy year. */
const MAX_CALLS_PER_PROGRAMME = 60;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(HERE, "../../raw_data/opencalls/interreg");
const SNAPSHOT = path.resolve(HERE, "../../data/opencalls/interreg.json");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const get = async (url: string): Promise<string> => {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return await res.text();
};

/** Keep the fetched HTML so a parse can be re-run and a regression diagnosed without re-crawling. */
const cacheRaw = (name: string, html: string): void => {
  try {
    if (!existsSync(RAW_DIR)) mkdirSync(RAW_DIR, { recursive: true });
    writeFileSync(
      path.join(RAW_DIR, name.replace(/[^a-z0-9._-]+/gi, "_")),
      html,
      "utf8",
    );
  } catch {
    // Best-effort. A read-only checkout must not fail a crawl over a debugging convenience.
  }
};

/** Per-programme row counts in the committed snapshot; empty on a first run. */
const readPreviousProgrammeCounts = (): Map<string, number> => {
  const out = new Map<string, number>();
  try {
    const prev = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as {
      calls: { programmeCode: string | null }[];
    };
    for (const c of prev.calls ?? [])
      if (c.programmeCode)
        out.set(c.programmeCode, (out.get(c.programmeCode) ?? 0) + 1);
  } catch {
    // No previous snapshot, or an unreadable one: nothing to compare against. A first run must
    // not be blocked by a guard about losing coverage it never had.
  }
  return out;
};

export interface InterregCrawlResult {
  calls: OpenCall[];
  listed: number;
  failed: number;
  failures: { url: string; why: string }[];
  /** Per-programme counts, so „this programme returned nothing" is visible per source rather
   *  than hidden in a total. */
  perProgramme: { code: string; listed: number; parsed: number }[];
}

export const crawlInterreg = async (
  opts: { delayMs?: number; programmes?: readonly Programme[] } = {},
): Promise<InterregCrawlResult> => {
  const delay = opts.delayMs ?? DELAY_MS;
  const programmes = opts.programmes ?? PROGRAMMES;
  const calls: OpenCall[] = [];
  const failures: InterregCrawlResult["failures"] = [];
  const perProgramme: InterregCrawlResult["perProgramme"] = [];
  let listed = 0;

  for (const p of programmes) {
    let urls: string[] = [];
    try {
      const html = await get(p.indexUrl);
      cacheRaw(`${p.code}-index.html`, html);
      urls = parseIndex(html, p);
    } catch (e) {
      // NOT fatal, unlike the ИСУН crawler's listing fetch. There, one register IS the corpus,
      // so a partial read is indistinguishable from a shrunken one. Here each programme is
      // independent, and three of six are already unreachable — aborting the whole crawl
      // because a fourth went down would lose the ones that ARE readable. The shrink guard in
      // writeSnapshot() is what stops a bad day from truncating the committed snapshot.
      failures.push({
        url: p.indexUrl,
        why: `index: ${(e as Error).message}`.slice(0, 90),
      });
      perProgramme.push({ code: p.code, listed: 0, parsed: 0 });
      console.warn(`${p.code}: index unreachable — ${(e as Error).message}`);
      continue;
    }

    if (urls.length > MAX_CALLS_PER_PROGRAMME)
      throw new Error(
        `${p.code}: index returned ${urls.length} call links (cap ${MAX_CALLS_PER_PROGRAMME}) — the selector is probably matching navigation`,
      );

    console.log(`${p.code}: ${urls.length} call page(s)`);
    listed += urls.length;
    let parsed = 0;

    for (const [i, url] of urls.entries()) {
      try {
        const html = await get(url);
        cacheRaw(
          `${p.code}-${url.split("/").filter(Boolean).pop()}.html`,
          html,
        );
        const call = parseCall(html, url, p);
        // Null when the page carries no LABELLED deadline. Same posture as the ИСУН crawler: a
        // REJECTION with a reason, never a silent skip. Inventing a date, or filing the row
        // under „Очаквани приеми", would both be worse than not having it.
        if (call) {
          calls.push(call);
          parsed++;
        } else {
          failures.push({ url, why: "no labelled deadline on the page" });
        }
      } catch (e) {
        failures.push({ url, why: (e as Error).message.slice(0, 90) });
      }
      if (i < urls.length - 1) await sleep(delay);
    }
    perProgramme.push({ code: p.code, listed: urls.length, parsed });
    await sleep(delay);
  }

  return { calls, listed, failed: failures.length, failures, perProgramme };
};

const main = async (): Promise<void> => {
  const dry = process.argv.includes("--dry");
  const started = new Date().toISOString();
  const r = await crawlInterreg();

  const withDeadline = r.calls.filter((c) => c.closesAt);
  const today = new Date().toISOString().slice(0, 10);
  const open = withDeadline.filter((c) => c.closesAt! >= today);

  console.log(
    `\n${r.calls.length} call(s) from ${r.perProgramme.length} programme(s); ` +
      `${withDeadline.length} with a labelled deadline, ${open.length} still open on ${today}`,
  );
  for (const p of r.perProgramme)
    console.log(
      `  ${p.code.padEnd(18)} listed ${p.listed}, parsed ${p.parsed}`,
    );
  for (const f of r.failures) console.log(`  ✗ ${f.url}\n      ${f.why}`);

  // Every stored row has a deadline by construction (parseCall rejects the rest), so this is a
  // self-check rather than a report: if it fires, that rejection has been lost.
  if (withDeadline.length !== r.calls.length)
    throw new Error(
      `${r.calls.length - withDeadline.length} stored row(s) have no deadline — parseCall's rejection has regressed`,
    );

  if (dry) {
    console.log("\n--dry: nothing written.");
    return;
  }

  // ── THE COMPLETENESS GUARD ────────────────────────────────────────────────────────────────
  // Refuse to write when a programme that HAD rows in the committed snapshot contributed none.
  //
  // Found in review, and it had already happened: Black Sea Basin went down mid-crawl and the
  // snapshot was committed with Greece-Bulgaria only, while the page claimed to cover both. All
  // three existing defences missed it by construction — the non-fatal index handling is what
  // lets the run continue at all; `writeSnapshot`'s shrink guard is a per-SOURCE ratio, so
  // 9 → 7 is 22%, under its 25% threshold and arithmetically incapable of seeing a whole
  // programme vanish; and the data gate passes happily with one programme present.
  //
  // The guard lives HERE rather than in writeSnapshot because only this file knows the corpus
  // is partitioned by programme at all. `--allow-partial` is the escape hatch for a programme
  // that has genuinely retired its calls page.
  const dropped = [...readPreviousProgrammeCounts().entries()].filter(
    ([code, n]) => n > 0 && !r.calls.some((c) => c.programmeCode === code),
  );
  if (dropped.length && !process.argv.includes("--allow-partial")) {
    console.error(
      `\nREFUSING TO WRITE: ${dropped
        .map(([code, n]) => `${code} had ${n} call(s) and returned none`)
        .join("; ")}.\n` +
        `The snapshot would claim a coverage it no longer has. Re-run when the programme is ` +
        `reachable, or pass --allow-partial if it has genuinely retired its calls page.`,
    );
    process.exitCode = 1;
    return;
  }
  if (!r.calls.length) {
    // writeSnapshot's empty guard would refuse anyway; saying why here is friendlier than a
    // thrown guard, and an all-programmes-down day is a real thing rather than a bug.
    console.log("\nNo calls parsed — snapshot left untouched.");
    return;
  }

  // `--allow-shrink` mirrors `isun_fetch`: the guard is a per-source ratio, so a correctness fix
  // that legitimately removes rows (e.g. rejecting undated calls) trips it once.
  const out = writeSnapshot(
    "interreg",
    r.calls,
    started,
    undefined,
    process.argv.includes("--allow-shrink"),
  );
  console.log(`\nWrote ${out} (${r.calls.length}/${r.listed} parsed).`);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
