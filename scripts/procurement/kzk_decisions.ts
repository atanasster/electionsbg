// Crawl the КЗК decisions register (Решения/Определения) — the tier-2 source for
// kzk_appeals.outcome / decision_date / suspension.
//
//   npm run kzk:decisions -- --probe
//   npm run kzk:decisions -- --year 2026 --apply
//   npm run kzk:decisions -- --year 2026 --dry-run
//   npm run kzk:decisions -- --backfill --apply     (one-off, heavy)
//
// Writing requires --apply. With neither flag the run parses and reports, exactly
// like --dry-run. No database is touched at any point — see the scope note at the
// foot of main().
//
// ⚠️ TWO CONSTRAINTS, identical to the intake crawler (kzk_appeals.ts):
//   1. HEADED Playwright — a desktop browser window opens. Never a CI step.
//   2. BULGARIAN EGRESS — reg.cpc.bg 403s non-BG IPs. There is no proxy path.
//
// WHY THIS FILE EXISTS. It is the generator that was missing for five weeks
// without anything noticing: `data/procurement/kzk_decisions.json` was produced
// interactively on 2026-07-04, is gitignored, and nothing in the repo could
// reproduce it. `max(decision_date)` sat at 2026-06-25 while the intake arm
// stayed current, and no watcher, gate or row count could see it — see
// docs/plans/kzk-decisions-freshness-v1.md.
//
// ⚠️ RUN `--probe` FIRST, ON A NEW MACHINE OR AFTER ANY SUSPECTED MARKUP CHANGE.
// The parser below is written against the SHAPE of the 2026-07-04 corpus (the six
// fields it carries) and the ASP.NET GridView conventions the intake register
// uses, but the decisions register's rendered markup has never been read by
// committed code. `--probe` reads page 1 of each `ot` variant, reports which
// labels it finds, walks to the last page to report the OLDEST reachable act, and
// says whether the parse survives validation — the three things the plan needs
// answered before the crawl is scoped.
//
// Plan §3c expects a SECOND register here: every well-formed act in the corpus is
// `АКТ-` and only 37 of 4,836 pronouncements mention временна мярка, against 1,501
// appeals that requested one. The определения (temporary-measure) register is
// almost certainly a different `ot` value that has never been crawled, and it is
// the only authoritative source for `suspension`.
//
// COLUMN-ALIGNMENT IS ASSERTED, not hoped for. 429 of the 4,836 hand-made rows
// (8.9%) are column-shifted — the act description landed in the act-number field
// with a null date. Every parsed row goes through validateDecisions() and a
// rejection RATE above REJECT_RATE_CEILING aborts the run rather than storing
// shifted rows. That is the difference between this crawler and the process that
// produced the corpus it replaces.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { command, flag, number, option, optional, run } from "cmd-ts";
import type { Browser, BrowserContext, Page } from "playwright";
import {
  DECISIONS_LIST_URL,
  DECISION_RECORD_RE,
  REJECT_RATE_CEILING,
  firstActNo,
  parseRegisterTotal,
  validateDecisions,
  summarizeRejections,
  type KzkDecision,
  type DecisionsFile,
} from "./kzk_decisions_store";
import { UA, BLOCK_HOSTS } from "./kzk_appeals";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const OUT_FILE = path.join(ROOT, "data", "procurement", "kzk_decisions.json");

/** Progress + diagnostics go to stderr; only the run's RESULT goes to stdout. */
const log = (m: string): void => console.error(m);
const result = (m: string): void => console.log(m);

/** "25.06.2026" → "2026-06-25". Null if unparseable. */
const bgDate = (raw: string | undefined): string | null => {
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(raw ?? "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

/** The rest of the line following `label`, trimmed; null when absent/empty. */
const afterLabel = (chunk: string, label: RegExp): string | null => {
  const m = label.exec(chunk);
  if (!m) return null;
  const line = chunk
    .slice(m.index + m[0].length)
    .split("\n")[0]
    ?.trim();
  return line ? line : null;
};

// Label variants, in the order they are tried. The register's exact wording is
// unverified from a non-BG machine, so each field accepts the spellings the
// sibling register and the corpus suggest; --probe reports which actually appear.
const L_DATE = /Дата(?:\s+на\s+(?:акта|решението|определението))?:\s*/;
const L_PRON = /Произнасян[ел]:\s*/;
const L_CASE = /(?:Преписка|Дело|№\s*на\s*преписка(?:та)?|Пр\.\s*№):\s*/;
const L_INIT = /(?:Жалбоподател(?:\(и\)|и)?|Инициатор(?:\(и\))?|Страни):\s*/;
const L_RESP = /Ответник(?:\(ници\)|ци)?:\s*/;

/**
 * Pure parser — split the rendered list text into decision records.
 *
 * Exported so it can be unit-tested against a saved fixture with no browser and
 * no BG egress, which is the only way this parser gets any coverage at all from a
 * non-Bulgarian machine.
 */
export const parseDecisionsText = (
  text: string,
  fetchedAt: string,
  sourceUrl: string = DECISIONS_LIST_URL,
): KzkDecision[] => {
  // Fresh RegExp: DECISION_RECORD_RE is /g, and a shared /g regex carries
  // lastIndex between calls — reusing the object directly makes the parse
  // depend on how many times it has run.
  const parts = text
    .split(new RegExp(DECISION_RECORD_RE.source, "gm"))
    .slice(1);
  const out: KzkDecision[] = [];
  for (const part of parts) {
    const no = part.split(/[\n\r]/)[0]?.trim();
    if (!no) continue;
    out.push({
      no,
      // The act number embeds its own date ("АКТ-608-25.06.2026"); the register
      // also prints it as a field. Prefer the field, fall back to the number —
      // validateDecisions cross-checks the two and rejects a disagreement, which
      // is the tripwire for the column shift that damaged the hand-made corpus.
      ddate: bgDate(afterLabel(part, L_DATE) ?? no),
      pron: afterLabel(part, L_PRON),
      kzk: afterLabel(part, L_CASE),
      init: afterLabel(part, L_INIT),
      resp: afterLabel(part, L_RESP),
      sourceUrl,
      fetchedAt,
    });
  }
  return out;
};

/** Re-exported so the crawler's tests and callers have one name for it. */
export { parseRegisterTotal as parseTotal } from "./kzk_decisions_store";

/**
 * Merge one freshly-parsed record over its stored twin WITHOUT null-clobbering.
 *
 * A plain `{ ...prev, ...incoming }` is wrong: a missed label yields `null`, not
 * `undefined`, and null overwrites. `pron` is the SOLE input to
 * classifyOutcome(), so one label the parser fails to read would delete an
 * outcome from a corpus that has no other copy — with no row-count change and
 * nothing failing. Exported and tested for that reason; mirrors
 * `mergeAppealInto` in the sibling crawler, which exists for the same bug.
 */
export const mergeDecisionInto = (
  prev: KzkDecision | undefined,
  incoming: KzkDecision,
): KzkDecision => {
  if (!prev) return incoming;
  const defined = Object.fromEntries(
    Object.entries(incoming).filter(([, v]) => v != null),
  );
  return { ...prev, ...defined };
};

/** Newest-first, null dates last. Total order, and null-safe by construction. */
const byDateDesc = (a: KzkDecision, b: KzkDecision): number => {
  const ad = a.ddate ?? "";
  const bd = b.ddate ?? "";
  return ad === bd ? b.no.localeCompare(a.no) : bd.localeCompare(ad);
};

const readStore = (): KzkDecision[] => {
  if (!fs.existsSync(OUT_FILE)) return [];
  let doc: unknown;
  try {
    doc = JSON.parse(fs.readFileSync(OUT_FILE, "utf8"));
  } catch (e) {
    throw new Error(
      `${path.relative(ROOT, OUT_FILE)} exists but is unparseable (${(e as Error).message}). ` +
        "Refusing to touch it — it may be the only copy of the corpus.",
    );
  }
  const decisions = (doc as Partial<DecisionsFile>)?.decisions;
  if (!Array.isArray(decisions))
    throw new Error(
      `${path.relative(ROOT, OUT_FILE)} has no \`decisions\` array. Refusing to ` +
        "overwrite it — it may be the only copy of the corpus.",
    );
  return decisions;
};

/** Existing act numbers, for the incremental early-exit frontier. */
const loadKnownActs = (): Set<string> => {
  try {
    return new Set(readStore().map((d) => d.no));
  } catch {
    // Lenient HERE only: an unreadable store means a full crawl, which is safe
    // because the completeness assert still applies. The strict guard lives in
    // mergeWrite, which runs before anything is overwritten.
    return new Set();
  }
};

/**
 * Merge fresh records into the store, keeping every act already there.
 *
 * NEVER a plain overwrite: until this crawler's `--backfill` is proven to
 * reproduce the 2026-07-04 corpus, that file plus the kzk_decisions table are the
 * only copies of it.
 */
export const mergeWrite = (records: readonly KzkDecision[]): number => {
  const existing = readStore();
  const byNo = new Map<string, KzkDecision>();
  for (const d of existing) byNo.set(d.no, d);
  const existingDistinct = byNo.size;
  for (const r of records) byNo.set(r.no, mergeDecisionInto(byNo.get(r.no), r));

  const merged = [...byNo.values()].sort(byDateDesc);
  // The union is seeded from `existing`, so it can only shrink if the stored file
  // held DUPLICATE act numbers — a pre-existing condition this tool should report
  // and then repair, not refuse for ever.
  if (existing.length !== existingDistinct)
    log(
      `  note: store held ${existing.length - existingDistinct} duplicate act number(s); ` +
        "the merge de-duplicates them (last wins).",
    );
  if (merged.length < existingDistinct)
    throw new Error(
      `merge would drop acts: ${existingDistinct} distinct → ${merged.length}. ` +
        "Refusing — this store is the only copy.",
    );

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  const tmp = `${OUT_FILE}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), decisions: merged },
      null,
      2,
    ),
  );
  fs.renameSync(tmp, OUT_FILE);
  return merged.length;
};

const openBrowser = async (): Promise<{
  browser: Browser;
  ctx: BrowserContext;
  page: Page;
}> => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: false, // reg.cpc.bg needs a real headed browser + BG egress
    // Parity with the sibling crawler against the same 403-happy host.
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const ctx = await browser.newContext({ userAgent: UA, locale: "bg-BG" });
  // Route ONLY the blocked hosts. A `**/*` handler puts every request through
  // Playwright's interception path, which is both slower and a behavioural
  // difference from the sibling that works.
  await ctx.route(BLOCK_HOSTS, (route) => route.abort());
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });
  return { browser, ctx, page };
};

/** Wait until the list has actually rendered records, not merely a <body>. */
const waitForRecords = async (page: Page, ms = 15000): Promise<boolean> =>
  page
    .waitForFunction(
      (src) => new RegExp(src, "m").test(document.body.innerText),
      DECISION_RECORD_RE.source,
      { timeout: ms },
    )
    .then(() => true)
    .catch(() => false);

/**
 * Read page 1 of each register variant and report what a parser could see, plus
 * how far back the pager reaches. Writes nothing.
 */
const probe = async (page: Page, otValues: number[]): Promise<void> => {
  const base = DECISIONS_LIST_URL.replace(/([?&])ot=\d+/, "$1ot=");
  for (const ot of otValues) {
    const url = `${base}${ot}`;
    result(`\n── ot=${ot} ── ${url}`);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      const ready = await waitForRecords(page, 12000);
      const text = await page.locator("body").innerText();
      const total = parseRegisterTotal(text);
      const recs = parseDecisionsText(text, new Date().toISOString(), url);
      const { clean, rejected } = validateDecisions(recs);
      result(`   records rendered: ${ready ? "yes" : "NO"}`);
      result(`   header total: ${total ?? "NOT FOUND"}`);
      result(
        `   parsed ${recs.length} → ${clean.length} clean, ${rejected.length} rejected`,
      );
      for (const { reason, count } of summarizeRejections(rejected))
        result(`     ${count}× ${reason}`);
      if (clean[0]) result(`   first: ${JSON.stringify(clean[0])}`);

      for (const [label, re] of [
        ["record boundary (Акт №)", new RegExp(DECISION_RECORD_RE.source, "m")],
        ["Дата", L_DATE],
        ["Произнасяне", L_PRON],
        ["Преписка/Дело", L_CASE],
        ["Жалбоподател/Инициатор", L_INIT],
        ["Ответник", L_RESP],
        // The two most likely to differ between the решения and определения
        // registers — and the ones that decide whether `suspension` is reachable.
        ["временна мярка", /временн[аи]\s+мярк/i],
        ["спиране", /спира|спиране|спрян/i],
      ] as const)
        result(`   label ${label}: ${re.test(text) ? "present" : "ABSENT"}`);

      // How far back does the pager reach? The plan needs this to decide whether
      // --backfill can rebuild the corpus or whether the restore point is
      // permanent. "Последна >>" jumps to the last page in one postback.
      const last = page.getByRole("link", { name: /Последна/ }).first();
      if (await last.count()) {
        await last.click({ timeout: 12000 }).catch(() => undefined);
        await waitForRecords(page, 12000);
        const lastText = await page.locator("body").innerText();
        const oldest = parseDecisionsText(lastText, "", url).at(-1);
        result(
          `   oldest reachable act: ${oldest?.no ?? "?"} (${oldest?.ddate ?? "?"})`,
        );
      } else {
        result(
          "   oldest reachable act: no 'Последна' link — pager shape differs",
        );
      }

      if (recs.length === 0)
        result(
          "   ⚠ nothing parsed — adjust parseDecisionsText against this text:\n" +
            `     ${JSON.stringify(text.slice(0, 500))}`,
        );
    } catch (e) {
      result(`   ✗ ${(e as Error).message}`);
    }
  }
  result(
    "\nIf an ot value other than 2 carries определения (временни мерки), it is the missing\n" +
      "authoritative source for kzk_appeals.suspension — see plan §3c before scoping the crawl.\n" +
      "If the oldest reachable act does not reach 2020, --backfill cannot rebuild the corpus\n" +
      "and the db:dump restore point is permanent, not temporary.",
  );
};

/** Crawl one year (or the register default when `year` is null). */
const crawlYear = async (
  page: Page,
  year: number | null,
  fetchedAt: string,
  opts: { knownActs: Set<string>; earlyExit: boolean },
): Promise<KzkDecision[]> => {
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto(DECISIONS_LIST_URL, { waitUntil: "domcontentloaded" });
      // Wait for actual RECORDS. `body.waitFor()` resolves the moment a <body>
      // exists, which is always — it would make this retry loop protect nothing.
      if (!(await waitForRecords(page)))
        throw new Error("no records rendered within 15s");
      break;
    } catch (e) {
      if (attempt >= 3) throw e;
      await page.waitForTimeout(1000 * attempt);
    }
  }

  if (year != null) {
    if (!Number.isInteger(year) || year < 2000 || year > 2100)
      throw new Error(`kzk decisions: invalid year ${year}`);
    const yearLink = page.getByRole("link", {
      name: String(year),
      exact: true,
    });
    if (!(await yearLink.count()))
      throw new Error(
        `kzk decisions: year ${year} is not selectable — refusing to crawl the ` +
          "register's default year silently (that would store this year's acts under another label)",
      );
    await yearLink.first().click();
    // Confirm the postback landed. Poll from Node, never an in-page
    // waitForFunction: the year link is a full ASP.NET postback that destroys the
    // execution context and rejects waitForFunction mid-navigation.
    let confirmed = false;
    for (let i = 0; i < 30; i++) {
      const txt = await page
        .locator("body")
        .innerText()
        .catch(() => "");
      if (txt.includes(`за ${year} година`)) {
        confirmed = true;
        break;
      }
      await page.waitForTimeout(500);
    }
    if (!confirmed)
      throw new Error(
        `kzk decisions: year ${year} postback not confirmed after 15s — refusing to crawl the wrong year`,
      );
  }

  const headerText = await page
    .locator("body")
    .innerText()
    .catch(() => "");
  const expected = parseRegisterTotal(headerText);
  if (expected == null)
    throw new Error(
      'kzk decisions: could not read the "Намерени са общо N" total from the header ' +
        "— refusing to crawl without a completeness target (a short read would " +
        "otherwise look like a successful small year)",
    );

  const clickNext = async (): Promise<boolean> => {
    for (let a = 1; a <= 3; a++) {
      try {
        await page
          .getByRole("link", { name: /Следваща/ })
          .first()
          .click({ timeout: 12000 });
        return true;
      } catch {
        await page.waitForTimeout(1000 * a);
      }
    }
    return false;
  };

  const { knownActs, earlyExit } = opts;
  const seen = new Map<string, KzkDecision>();
  let earlyStopped = false;

  for (let guard = 0; guard < 1000; guard++) {
    const text = await page.locator("body").innerText();
    const recs = parseDecisionsText(text, fetchedAt, DECISIONS_LIST_URL);
    let newOnPage = 0;
    for (const r of recs) {
      if (!knownActs.has(r.no)) newOnPage++;
      if (!seen.has(r.no)) seen.set(r.no, r);
    }

    // Incremental early-exit: the register is date-desc, so the first page whose
    // every act we already store marks the frontier. Only stop once a WHOLE page
    // is known, so a new act ahead of the boundary is still collected.
    if (earlyExit && newOnPage === 0 && recs.length > 0) {
      earlyStopped = true;
      log(
        `  … kzk decisions: reached already-stored acts at page ${guard + 1} ` +
          `(${seen.size}/${expected} scanned) — stopping early`,
      );
      break;
    }
    if (seen.size >= expected) break;

    const prev = firstActNo(text);
    if (!(await clickNext())) break;
    const turned = await page
      .waitForFunction(
        ({ p, src }) => {
          const first = document.body.innerText.split(new RegExp(src, "gm"))[1];
          const no = first?.split(/[\n\r]/)[0]?.trim() ?? "";
          return no.length > 0 && no !== p;
        },
        { p: prev, src: DECISION_RECORD_RE.source },
        { timeout: 15000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!turned) break;
  }

  const got = [...seen.values()];
  // Completeness assertion. A pager or markup regression fails LOUD here rather
  // than silently returning a short list that then deletes the difference
  // downstream (the loader's shrink guard is the second line of defence).
  if (!earlyStopped && got.length !== expected)
    throw new Error(
      `kzk decisions: collected ${got.length} acts but the register header says ` +
        `${expected}. Refusing to store a short read — re-run, and if it persists ` +
        "the pager markup has changed (run --probe).",
    );
  log(
    `  ${year ?? "current"}: ${got.length} acts${earlyStopped ? " (early exit)" : ""}`,
  );
  return got;
};

/** Validate a batch and refuse if the damage looks like drift rather than history. */
const validateOrThrow = (recs: readonly KzkDecision[], label: string) => {
  const { clean, rejected } = validateDecisions(recs);
  log(
    `  ${label}: ${recs.length} parsed → ${clean.length} well-formed, ${rejected.length} rejected`,
  );
  for (const { reason, count } of summarizeRejections(rejected))
    log(`      ${count}× ${reason}`);
  const rate = recs.length ? rejected.length / recs.length : 0;
  if (rate > REJECT_RATE_CEILING)
    throw new Error(
      `${rejected.length}/${recs.length} parsed acts are malformed (${(rate * 100).toFixed(1)}%) ` +
        "— that is markup drift, not source noise. Run --probe and fix parseDecisionsText; " +
        "refusing to store shifted rows.",
    );
  if (clean.length === 0)
    throw new Error(
      `no well-formed acts parsed for ${label} — refusing to write`,
    );
  return clean;
};

const main = async (opts: {
  year: number | undefined;
  backfill: boolean;
  apply: boolean;
  full: boolean;
  probeOnly: boolean;
}): Promise<void> => {
  const { browser, page } = await openBrowser();
  try {
    if (opts.probeOnly) {
      await probe(page, [1, 2, 3, 4]);
      return;
    }

    const fetchedAt = new Date().toISOString();
    const knownActs =
      opts.backfill || opts.full ? new Set<string>() : loadKnownActs();
    const earlyExit =
      !opts.backfill && !opts.full && knownActs.size > 0 && opts.apply;

    const years = opts.backfill
      ? Array.from(
          { length: new Date().getFullYear() - 2019 },
          (_, i) => 2020 + i,
        )
      : [opts.year ?? null];

    let total = 0;
    let written = 0;
    for (const y of years) {
      const recs = await crawlYear(page, y, fetchedAt, {
        knownActs,
        earlyExit,
      });
      const clean = validateOrThrow(recs, String(y ?? "current"));
      total += clean.length;
      // PERSIST PER YEAR. A --backfill is a multi-hour headed crawl; batching the
      // write to the end means one slow postback in year 6 discards years 1-5.
      // mergeWrite is a union, so partial progress is always safe to keep.
      if (opts.apply) written = mergeWrite(clean);
    }

    if (!opts.apply) {
      result(
        `Parsed ${total} well-formed act(s). Nothing written — pass --apply to store.`,
      );
      return;
    }

    result(`Wrote ${path.relative(ROOT, OUT_FILE)} (${written} total).`);
    // DELIBERATE SCOPE SPLIT. This crawler's job ends at the JSON; it touches no
    // database. The loader owns the merge guards (rejection ceiling + anti-shrink)
    // and the rejoin owns the provenance rule, and invoking them from here would
    // mean this command silently writes Postgres — including, with an ambient
    // cloud DATABASE_URL, the SERVING one.
    //
    // Forgetting the follow-up is NOT silent: T6's gate compares the register's
    // newest act (recorded in state/watch/kzk_decisions.json) against the TABLE,
    // so a crawl that never reached Postgres fails it. That is the same gate that
    // exists because this arm once went five weeks stale unnoticed.
    result(
      "\nNext — publish and fold into kzk_appeals.outcome (the crawl alone changes nothing served):\n" +
        "  npm run db:load:kzk-decisions:pg   # or :pg:cloud for prod\n" +
        "  npm run kzk:rejoin -- --apply      # or kzk:rejoin:cloud -- --apply",
    );
  } finally {
    await browser.close().catch(() => undefined);
  }
};

const cmd = command({
  name: "kzk_decisions",
  description:
    "Crawl the КЗК decisions register (headed browser + Bulgarian egress).",
  args: {
    year: option({
      long: "year",
      type: optional(number),
      description: "crawl one calendar year",
    }),
    backfill: flag({
      long: "backfill",
      description: "all years 2020..present",
    }),
    apply: flag({ long: "apply", description: "write the JSON store" }),
    dryRun: flag({
      long: "dry-run",
      description: "parse + report, no writes (the default)",
    }),
    full: flag({
      long: "full",
      description: "disable the incremental early-exit",
    }),
    probeOnly: flag({
      long: "probe",
      description: "read each ot variant and report; writes nothing",
    }),
  },
  handler: async (a) => {
    if (a.backfill && a.year != null)
      throw new Error(
        "--backfill and --year are mutually exclusive (backfill crawls all years; drop one)",
      );
    if (a.dryRun && a.apply)
      throw new Error(
        "--dry-run and --apply are mutually exclusive (dry-run makes no writes; drop one)",
      );
    if (a.probeOnly && (a.apply || a.backfill || a.year != null || a.full))
      throw new Error(
        "--probe reads the register and writes nothing; it takes no other flags",
      );
    await main({ ...a, year: a.year ?? undefined });
  },
});

// Import-safe: the watch source and the tests import parseDecisionsText /
// mergeWrite without launching a headed browser.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  run(cmd, process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
