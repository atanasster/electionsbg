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
// One GET per index page, then one per call — and for the МРРБ programmes a term page or two
// plus up to MRRB_MAX_NODES news nodes per call — all SERIAL, with a delay and an identifying
// User-Agent. Measured 2026-10-21: ~31 calls, a few hundred requests, a few minutes. These are
// small programme secretariats, not a government API.
//
// ── ALL SIX PROGRAMMES, SINCE 2026-10-21 ───────────────────────────────────────────────────
// The „three programmes are unreachable" finding of 2026-08-09 was measured against their
// 2014–2020 hosts; see `PROGRAMMES` in interreg_parse.ts. The 2021–2027 sites answer, behind an
// incomplete TLS chain that `interreg_tls.ts` completes (verification stays on). A programme
// that does not answer on a given run is still a counted FAILURE, never „0 calls".
//
// The МРРБ programmes (`mrrb`) are three requests deep: home → one taxonomy term per call
// (following its `rel="next"` pager, at most MRRB_MAX_TERM_PAGES pages) → that term's news
// nodes (at most MRRB_MAX_NODES), because the deadline sits in an announcement node, often
// one older than the term's first page.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { OpenCall } from "./types";
// Side effect: completes the TLS chain for the four hosts that need it (see the module).
import "./interreg_tls";
import {
  PROGRAMMES,
  indexUrlsOf,
  listCallUrls,
  parseCall,
  parseMrrbCall,
  parseMrrbCallTerms,
  parseMrrbNextPage,
  parseMrrbNodeLinks,
  type Programme,
} from "./interreg_parse";
import { writeSnapshot } from "./write_snapshot";

const UA = "electionsbg-opencalls/1.0 (+https://electionsbg.com)";
const DELAY_MS = 1_500;
const TIMEOUT_MS = 45_000;
/** A programme index with more links than this is a parse gone wrong, not a busy year. */
const MAX_CALLS_PER_PROGRAMME = 60;
/** Pages of one МРРБ call term's node listing. Ten nodes a page; the deadline announcement has
 *  been on page 2 at most (measured 2026-10-21). */
const MRRB_MAX_TERM_PAGES = 4;
const MRRB_MAX_NODES = 40;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(HERE, "../../raw_data/opencalls/interreg");
const SNAPSHOT = path.resolve(HERE, "../../data/opencalls/interreg.json");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET + keep the raw HTML under the programme's code. */
const getCached = async (p: Programme, url: string): Promise<string> => {
  const html = await get(url);
  cacheRaw(`${p.code}-${url.split("/").filter(Boolean).pop()}.html`, html);
  return html;
};

/**
 * One МРРБ call: its term page(s), then the news nodes they list.
 *
 * ⚠️ A PARTIAL READ IS A REJECTION, never a row. The deadline is the LATEST labelled one across
 * the nodes, and an extension is just another node — so a node that failed to load, or one cut
 * off by a cap, can be exactly the notice that moved the deadline later. Publishing what was
 * read would show an open call as closed. `partial` names the cause so the crawl reports it.
 */
const crawlMrrbCall = async (
  p: Programme,
  term: { url: string; title: string },
  delay: number,
): Promise<{ call: OpenCall | null; partial: string | null }> => {
  const pages: string[] = [];
  const nodeUrls: string[] = [];
  let next: string | null = term.url;
  while (next && pages.length < MRRB_MAX_TERM_PAGES) {
    const html = await getCached(p, next);
    pages.push(html);
    for (const u of parseMrrbNodeLinks(html, p))
      if (!nodeUrls.includes(u)) nodeUrls.push(u);
    next = parseMrrbNextPage(html, next);
    await sleep(delay);
  }
  if (next)
    return {
      call: null,
      partial: `more than ${MRRB_MAX_TERM_PAGES} term pages`,
    };
  if (nodeUrls.length > MRRB_MAX_NODES)
    return {
      call: null,
      partial: `${nodeUrls.length} nodes (cap ${MRRB_MAX_NODES})`,
    };
  const nodes: { url: string; html: string }[] = [];
  for (const u of nodeUrls) {
    try {
      nodes.push({ url: u, html: await getCached(p, u) });
    } catch (e) {
      return {
        call: null,
        partial: `node ${u} failed: ${(e as Error).message}`.slice(0, 90),
      };
    }
    await sleep(delay);
  }
  return {
    call: parseMrrbCall(
      { url: term.url, title: term.title, html: pages.join("\n") },
      nodes,
      p,
    ),
    partial: null,
  };
};

/**
 * One GET, retried ONCE on a network-level failure. The МРРБ hosts drop a connection every few
 * dozen requests (measured 2026-10-21: two of ~250 term pages per crawl), and with partial reads
 * now a rejection each drop costs a whole call. An HTTP error status is NOT retried — that is
 * the server's answer, not a transport hiccup.
 */
const get = async (url: string, retry = true): Promise<string> => {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": UA },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    if (!retry) throw e;
    await sleep(DELAY_MS * 2);
    return get(url, false);
  }
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
    const urls: string[] = [];
    let terms: { url: string; title: string }[] = [];
    try {
      for (const [k, indexUrl] of indexUrlsOf(p).entries()) {
        const html = await get(indexUrl);
        cacheRaw(`${p.code}-index${k || ""}.html`, html);
        if (p.kind === "mrrb") terms = parseMrrbCallTerms(html, p);
        for (const u of listCallUrls(html, p))
          if (!urls.includes(u)) urls.push(u);
        if (k < indexUrlsOf(p).length - 1) await sleep(delay);
      }
    } catch (e) {
      // NOT fatal, unlike the ИСУН crawler's listing fetch. There, one register IS the corpus,
      // so a partial read is indistinguishable from a shrunken one. Here each programme is
      // independent, and six small secretariat sites will not all be up on every run —
      // aborting the whole crawl because one went down would lose the ones that ARE readable. The shrink guard in
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
        let call: OpenCall | null;
        if (p.kind === "mrrb") {
          const r = await crawlMrrbCall(
            p,
            terms.find((t) => t.url === url) ?? { url, title: url },
            delay,
          );
          if (r.partial) {
            failures.push({ url, why: `partial read — ${r.partial}` });
            continue;
          }
          call = r.call;
        } else call = parseCall(await getCached(p, url), url, p);
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
