// КЗК procurement-appeals ingest. Crawls the Комисия за защита на конкуренцията
// public register (reg.cpc.bg/AllComplaints.aspx?dt=2 — ЗОП complaints) and
// joins each complaint to the tender corpus by УНП (EXACT — the register prints
// the procedure's УНП in structured form; verified 2026-07-04 against live
// records 00674-2026-0007 / 00589-2026-0026).
//
// ACCESS: reg.cpc.bg 403s non-BG egress AND non-browser clients, so this uses
// HEADED Playwright (a desktop window pops up) and MUST run from a BG connection
// — same wall + pattern as scripts/parsers_local/cik_fetch.ts. Not CI-safe; not
// in the watcher. Full-history crawl is behind --backfill per the one-off-
// backfills rule.
//
// The register list carries the whole intake record (complaint no, complainant,
// respondent/buyer, appealed act, УНП, date, status, ВМ-requested, subject) —
// no PDF scraping needed for it. The merits OUTCOME (уважена/отхвърлена,
// спиране granted) lives in the Решения/Определения registers and is a tier-2
// backfill (not done here — outcome/suspension stay null until then).
//
// ⚠ REPRODUCIBILITY GAP: the tier-2 decisions crawler is NOT in the repo. The
// ~2,098 `outcome`/`decisionDate` rows currently in kzk_appeals.json + PG were
// produced interactively and cannot be regenerated from committed code; a fresh
// clone re-ingests complaints fine but outcomes are unrecoverable (and the next
// --apply's buyer_appeal_stats rebuild would empty the upheld-appeal grade
// component). See process-watch-report SKILL.md step (2). TODO: commit the
// AllResolutions crawler as scripts/procurement/kzk_decisions.ts.
//
// CLI:
//   tsx scripts/procurement/kzk_appeals.ts [--year 2026] [--backfill] [--apply] [--dry-run]
//     --year      one year (default: current year on the page)
//     --backfill  all years 2020..present (manual, heavy; the register's data
//                 starts 2020)
//     --apply     upsert into Postgres (kzk_appeals) + resolve buyer_eik / match
//     --dry-run   parse + print counts, no writes
// Always writes data/procurement/kzk_appeals.json (merge-on-write, union by
// complaint_no) so historical rows survive if the register drops them.

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { command, run, flag, boolean, option, optional, string } from "cmd-ts";
import type { Browser, Page } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT_FILE = path.resolve(
  __dirname,
  "../../data/procurement/kzk_appeals.json",
);
// Exported (this module is import-safe via the main-guard at the bottom) so the
// watcher shares the exact register URL + UA — if КЗК moves the register, one
// side can't silently keep pointing at the old URL.
export const LIST_URL = "https://reg.cpc.bg/AllComplaints.aspx?dt=2";
export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

// Write-to-temp-then-rename: OUT_FILE is declared "the only copy" of the
// unregenerable tier-2 outcomes, so a crash mid-write must not truncate it
// (rename is atomic on the same filesystem).
const atomicWrite = (file: string, data: string): void => {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
};

export type KzkAppeal = {
  complaintNo: string;
  complaintId: string | null;
  complaintDate: string | null; // YYYY-MM-DD
  complainant: string | null;
  respondent: string | null;
  appealedAct: string | null;
  unp: string | null;
  vmRequested: boolean | null;
  status: string | null;
  subject: string | null;
  sourceUrl: string | null;
  fetchedAt: string;
};

// "03.07.2026" / "03.07.2026 г." → "2026-07-03". Returns null if unparseable.
const bgDate = (raw: string | undefined): string | null => {
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(raw ?? "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

const afterLabel = (chunk: string, label: RegExp): string | null => {
  const m = label.exec(chunk);
  if (!m) return null;
  // value is the rest of that line. Do NOT strip a trailing " г." here — it would
  // mangle a subject that legitimately ends in "г." (e.g. a quoted "… 2026 г.");
  // the date path handles its own suffix via bgDate's regex.
  const line = chunk
    .slice(m.index + m[0].length)
    .split("\n")[0]
    ?.trim();
  return line ? line : null;
};

/** Pure parser — split the rendered list text into complaint records. Exported
 *  so it can be unit-tested against a saved fixture without a live crawl. The
 *  `idByNo` map (complaint no → Complaint.aspx ID) comes from the page's anchors. */
export const parseComplaintsText = (
  text: string,
  idByNo: Record<string, string>,
  fetchedAt: string,
): KzkAppeal[] => {
  // Each record starts with a "Жалба № <no>" header AT LINE START. Anchor the
  // split there (/m) so a stray "Жалба №" inside a subject line can't fracture a
  // record. Keep the no (first token after the header).
  const parts = text.split(/^Жалба\s*№\s*/gm).slice(1);
  const out: KzkAppeal[] = [];
  for (const part of parts) {
    const complaintNo = part.split(/[\n\r]/)[0]?.trim();
    if (!complaintNo) continue;
    const unp = afterLabel(part, /УНП:\s*/);
    const vmRaw = afterLabel(part, /Искани\s+временни\s+мерки:\s*/);
    out.push({
      complaintNo,
      complaintId: idByNo[complaintNo] ?? null,
      complaintDate: bgDate(afterLabel(part, /Дата\s+на\s+жалбата:\s*/) ?? ""),
      complainant: afterLabel(part, /Наименование\s+на\s+жалбоподателя:\s*/),
      respondent: afterLabel(part, /Ответник(?:\(ници\))?:\s*/),
      appealedAct: afterLabel(part, /Обжалван\s+акт\s*№\s*/),
      unp,
      // "Няма искане за ВМ" → no request; anything else → a request was made.
      vmRequested: vmRaw == null ? null : !/няма\s+искане/i.test(vmRaw),
      status: afterLabel(part, /Статус:\s*/),
      subject: afterLabel(part, /Предмет:\s*/),
      sourceUrl: idByNo[complaintNo]
        ? `https://reg.cpc.bg/Complaint.aspx?ID=${idByNo[complaintNo]}`
        : null,
      fetchedAt,
    });
  }
  return out;
};

// Scrape one page's records (rendered text + the Complaint.aspx anchors).
const scrapePage = async (
  page: Page,
  fetchedAt: string,
): Promise<KzkAppeal[]> => {
  const text = await page.locator("body").innerText();
  const anchors = await page.$$eval("a[href*='Complaint.aspx?ID=']", (els) =>
    els.map((e) => ({
      no: (e.textContent || "").replace(/^\s*Жалба\s*№\s*/, "").trim(),
      id: (e.getAttribute("href") || "").replace(/.*ID=/, ""),
    })),
  );
  const idByNo: Record<string, string> = {};
  for (const a of anchors) if (a.no) idByNo[a.no] = a.id;
  return parseComplaintsText(text, idByNo, fetchedAt);
};

// Crawl one year: select it (postback), then click "Следваща >" until the last
// page. Dedupes by complaint_no (the pager can re-render the same anchors).
const crawlYear = async (
  page: Page,
  year: number | null,
  fetchedAt: string,
): Promise<KzkAppeal[]> => {
  // Bounded retry on the initial load: a transient blip shouldn't abort a whole
  // multi-year backfill (completed years persist via merge-on-write, but the
  // in-progress + later years would be lost). A couple of quick retries suffice
  // for an operator-present run.
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto(LIST_URL, { waitUntil: "networkidle" });
      break;
    } catch (e) {
      if (attempt >= 3) throw e;
      await page.waitForTimeout(1000 * attempt);
    }
  }
  if (year != null) {
    // Fail loud on a bad/absent year rather than silently crawling the
    // register's default (current) year — under --backfill that would upsert the
    // same current-year rows N times.
    if (!Number.isInteger(year) || year < 2000 || year > 2100)
      throw new Error(`kzk: invalid year ${year}`);
    const yearLink = page.getByRole("link", {
      name: String(year),
      exact: true,
    });
    if (!(await yearLink.count()))
      throw new Error(
        `kzk: year ${year} is not selectable on the register — refusing to crawl the default year silently`,
      );
    await yearLink.first().click();
    // Verify the postback actually loaded the requested year — networkidle can
    // resolve pre-postback, which under --backfill would silently harvest the
    // default (current) year while labeling it year Y. The results header prints
    // "… за <year> година" (the same line the watcher parses).
    await page
      .waitForFunction(
        (y) => document.body.innerText.includes(`за ${y} година`),
        year,
        { timeout: 15000 },
      )
      .catch(() => {
        throw new Error(
          `kzk: year ${year} postback not confirmed (header missing "за ${year} година") — refusing to crawl the wrong year`,
        );
      });
    await page.waitForLoadState("networkidle");
  }
  // The first complaint number currently rendered — used to detect a REAL page
  // turn (the ASP.NET postback swaps the list) rather than trusting networkidle,
  // which can resolve before the postback even starts.
  const firstNo = async (): Promise<string | null> => {
    const txt = await page
      .locator("a[href*='Complaint.aspx?ID=']")
      .first()
      .textContent()
      .catch(() => null);
    return txt ? txt.replace(/^\s*Жалба\s*№\s*/, "").trim() : null;
  };
  // Wait for the list to actually turn over (the first complaint number changes)
  // rather than trusting networkidle, which can fire pre-postback. Returns
  // whether the page turned within the timeout.
  const turned = (prev: string | null): Promise<boolean> =>
    page
      .waitForFunction(
        (p) => {
          const a = document.querySelector("a[href*='Complaint.aspx?ID=']");
          const txt = (a?.textContent || "")
            .replace(/^\s*Жалба\s*№\s*/, "")
            .trim();
          return txt.length > 0 && txt !== p;
        },
        prev,
        { timeout: 15000 },
      )
      .then(() => true)
      .catch(() => false);

  const seen = new Map<string, KzkAppeal>();
  let reachedEnd = false;
  for (let guard = 0; guard < 500; guard++) {
    for (const rec of await scrapePage(page, fetchedAt)) {
      if (!seen.has(rec.complaintNo)) seen.set(rec.complaintNo, rec);
    }
    const next = page.getByRole("link", { name: /Следваща/ });
    if (!(await next.count())) {
      reachedEnd = true;
      break; // genuine end: no next-page link
    }
    const before = await firstNo();
    await next.first().click();
    // If the page didn't turn, distinguish a genuine end (next link now gone)
    // from a FAILED postback (next link still present) — retry once, then THROW
    // rather than silently truncating the year on `added === 0`.
    if (!(await turned(before))) {
      await page.waitForLoadState("networkidle").catch(() => undefined);
      // The postback may have been slow (turned past the 15s wait) rather than
      // failed. Re-read the first number: if it already advanced past `before`,
      // the first click DID turn the page — a blind re-click would skip the
      // intermediate page's records (dedupe can't recover them). Only re-click
      // when the list is genuinely still on `before`.
      const now = await firstNo();
      if (now && now !== before) {
        await page.waitForTimeout(400);
        continue;
      }
      if (!(await next.count())) {
        reachedEnd = true;
        break; // it was the last page after all
      }
      await next.first().click();
      if (!(await turned(before)))
        throw new Error(
          `kzk: pagination stalled (page did not turn after retry; first complaint still ${before ?? "?"}) — refusing to silently truncate the year`,
        );
    }
    await page.waitForLoadState("networkidle");
    // Polite inter-page delay on a rate-sensitive ASP.NET register — this is an
    // explicitly manual, operator-present tool, so a small pause is free.
    await page.waitForTimeout(400);
  }
  // The 500-page guard is a runaway backstop, not an end signal — if we hit it
  // without seeing the last page, the year is bigger than expected; fail loud
  // rather than return a silently-truncated slice.
  if (!reachedEnd)
    throw new Error(
      "kzk: page guard exhausted at 500 — year larger than expected; refusing to return partial data",
    );
  return [...seen.values()];
};

export type StoredAppeal = KzkAppeal & Record<string, unknown>;

/** Merge one freshly-scraped record into its stored predecessor. Exported (pure)
 *  so the merge invariant is unit-testable. Two things it MUST preserve:
 *   1. enrichment-only keys the scrape never carries (buyerEik, match, outcome,
 *      decisionDate, suspension — written back by applyPg) survive, and
 *   2. a NULL scrape field (markup drift / a missing label) does NOT clobber a
 *      previously-good value — only DEFINED (non-null) scrape fields overwrite.
 *  A plain `{ ...prev, ...incoming }` fails #2 because a scrape miss yields null,
 *  not undefined, and null overwrites. */
export const mergeAppealInto = (
  prev: StoredAppeal | undefined,
  incoming: KzkAppeal,
): StoredAppeal => {
  if (!prev) return incoming as StoredAppeal;
  const defined = Object.fromEntries(
    Object.entries(incoming).filter(([, v]) => v != null),
  );
  return { ...prev, ...defined };
};

/** Apply PG-resolved enrichment onto a JSON appeal row (the --apply write-back).
 *  Exported so the harness locks the invariant: outcome/decisionDate are the
 *  UNREGENERABLE tier-2 data, so a PG that lacks them (fresh/reset DB) must NOT
 *  null the JSON's copy — keep the existing JSON value when PG is null. `a` = the
 *  JSON row (mutated), `e` = the PG row. suspension is tier-2-only + derived from
 *  status at read time, so its JSON copy is vestigial (take PG's, null-ok). */
export const applyEnrichment = (
  a: Record<string, unknown>,
  e: Record<string, unknown>,
): void => {
  a.buyerEik = e.buyer_eik ?? null;
  a.match = e.match ?? "unresolved";
  a.outcome = e.outcome ?? a.outcome ?? null;
  a.decisionDate = e.decision_date ?? a.decisionDate ?? null;
  a.suspension = e.suspension ?? null;
  a.buyerName = e.buyer_name ?? a.respondent ?? null;
};

const mergeWrite = (records: KzkAppeal[]): number => {
  let existing: StoredAppeal[] = [];
  if (fs.existsSync(OUT_FILE)) {
    let doc: unknown;
    try {
      doc = JSON.parse(fs.readFileSync(OUT_FILE, "utf8"));
    } catch (e) {
      // The file exists but is unparseable (truncated/corrupt) — it holds the
      // ONLY copy of the unregenerable tier-2 outcomes, so REFUSE to overwrite it
      // with scrape-only rows. Restore/fix the file, then re-run. (A genuinely
      // absent file is fine — that's the fresh-start case handled above.)
      throw new Error(
        `${OUT_FILE} exists but is not valid JSON — refusing to overwrite the only copy of the tier-2 enrichment: ${(e as Error).message}`,
      );
    }
    // Parseable but WRONG SHAPE (a bare array, {Appeals:[]} after a manual edit)
    // would read as empty and get replaced with scrape-only rows — same data loss
    // the corrupt-file guard prevents. Require the { appeals: [...] } shape.
    const appeals = (doc as { appeals?: unknown }).appeals;
    if (!Array.isArray(appeals))
      throw new Error(
        `${OUT_FILE}: unexpected shape (expected { appeals: [...] }) — refusing to overwrite the only copy of the tier-2 enrichment`,
      );
    existing = appeals as StoredAppeal[];
  }
  const byNo = new Map<string, StoredAppeal>(
    existing.map((r) => [r.complaintNo, r]),
  );
  for (const r of records) {
    byNo.set(r.complaintNo, mergeAppealInto(byNo.get(r.complaintNo), r));
  }
  const merged = [...byNo.values()].sort(
    (a, b) =>
      (b.complaintDate ?? "").localeCompare(a.complaintDate ?? "") ||
      // complaint_no tiebreak — same-date rows stay stably ordered across runs
      // (deterministic diff), mirroring the PG payload-determinism convention.
      (b.complaintNo ?? "").localeCompare(a.complaintNo ?? ""),
  );
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  atomicWrite(
    OUT_FILE,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), appeals: merged },
      null,
      2,
    ),
  );
  return merged.length;
};

// The kzk_appeals upsert. Exported so the harness locks the null-protection
// COALESCE directions (F-001/F-002) against the EXACT SQL applyPg runs — not a
// hand-written copy that could silently drift. Params $1..$13 follow the column
// order in the INSERT.
export const KZK_UPSERT_SQL = `INSERT INTO kzk_appeals
           (complaint_no, complaint_id, complaint_date, complainant, respondent,
            appealed_act, unp, vm_requested, status, subject, suspension,
            source_url, fetched_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (complaint_no) DO UPDATE SET
           -- complaint_id: an anchor-extraction miss (empty idByNo on selector
           -- drift) yields NULL — keep the known id rather than wiping it.
           complaint_id=COALESCE(EXCLUDED.complaint_id, kzk_appeals.complaint_id),
           -- Nullable scrape fields: a re-scrape that MISSED a label (markup
           -- drift) carries NULL — COALESCE so a miss never clobbers a
           -- previously-good value, mirroring mergeAppealInto for the JSON store.
           -- Without this, a dropped УНП label would NULL the УНП, flip the
           -- row to unresolved, drop it from appealed_ocids/upheld_ocids, and
           -- desync PG from the JSON (which keeps the old УНП).
           complaint_date=COALESCE(EXCLUDED.complaint_date, kzk_appeals.complaint_date),
           complainant=COALESCE(EXCLUDED.complainant, kzk_appeals.complainant),
           respondent=COALESCE(EXCLUDED.respondent, kzk_appeals.respondent),
           appealed_act=COALESCE(EXCLUDED.appealed_act, kzk_appeals.appealed_act),
           unp=COALESCE(EXCLUDED.unp, kzk_appeals.unp),
           vm_requested=COALESCE(EXCLUDED.vm_requested, kzk_appeals.vm_requested),
           -- status: COALESCE too. It transitions over a case's life (иницииран →
           -- приключено) so a captured status must win — but a markup-drift MISS
           -- yields NULL, and clobbering a known status to NULL would desync the
           -- JSON (mergeAppealInto protects it) and flip isAppealOpen back to
           -- "Under appeal". COALESCE = freshest-when-captured, no-op on a miss.
           status=COALESCE(EXCLUDED.status, kzk_appeals.status),
           subject=COALESCE(EXCLUDED.subject, kzk_appeals.subject),
           -- suspension can be set authoritatively by the tier-2 decisions
           -- backfill (спиране lives in the Решения registers). The intake value
           -- (/спрян/ on status) is non-null on nearly every row, so EXISTING
           -- must win — only let an intake re-scrape fill it when it isn't already
           -- known (existing IS NULL). COALESCE(existing, EXCLUDED), NOT the
           -- reverse (which clobbered tier-2 true with intake false every run).
           suspension=COALESCE(kzk_appeals.suspension, EXCLUDED.suspension),
           -- source_url: only overwrite when this scrape actually resolved an
           -- anchor id; otherwise keep the known URL rather than downgrading it
           -- to the bare list URL.
           source_url=CASE WHEN EXCLUDED.complaint_id IS NOT NULL
                           THEN EXCLUDED.source_url ELSE kzk_appeals.source_url END,
           fetched_at=EXCLUDED.fetched_at`;

const applyPg = async (records: KzkAppeal[]): Promise<void> => {
  const { withClient, end } = await import("../db/lib/pg");
  const { recordIngestBatch } = await import("../db/lib/ingest_changelog");
  await withClient(async (c) => {
    try {
      await c.query("BEGIN");
      for (const r of records) {
        // suspension is TIER-2-ONLY (the Решения/Определения decisions register).
        // Intake writes NULL — never a status-derived bool — so the effective
        // suspended state is derived fresh from `status` at read time (see
        // tender_appeals / kzk_recent_appeals in 042). Storing an intake bool here
        // would freeze false→true forever under the COALESCE(existing,…) guard.
        await c.query(KZK_UPSERT_SQL, [
          r.complaintNo,
          r.complaintId,
          r.complaintDate,
          r.complainant,
          r.respondent,
          r.appealedAct,
          r.unp,
          r.vmRequested,
          r.status,
          r.subject,
          null, // suspension — tier-2-only; intake never writes it (see above)
          r.sourceUrl ?? LIST_URL,
          r.fetchedAt,
        ]);
      }
      // Resolve buyer_eik from tenders by УНП, and flag rows whose УНП isn't in
      // the corpus as 'unresolved'. NOT rare: ~1,320/7,782 (17%) don't resolve —
      // only ~118 lack a УНП outright; the rest carry valid УНПs that predate or
      // otherwise escape the tenders table (mostly pre-2020). Treat 17% as normal.
      await c.query(
        `UPDATE kzk_appeals a SET buyer_eik = t.buyer_eik
         FROM tenders t WHERE t.unp = a.unp AND a.buyer_eik IS DISTINCT FROM t.buyer_eik`,
      );
      await c.query(
        `UPDATE kzk_appeals a SET match = CASE
          WHEN a.unp IS NULL THEN 'unresolved'
          WHEN EXISTS (SELECT 1 FROM tenders t WHERE t.unp = a.unp) THEN 'exact'
          ELSE 'unresolved' END`,
      );
      // Seed PG's tier-2 columns (outcome/decision_date) FROM the JSON — the only
      // source of these ~2,098 interactively-produced rows. On a fresh/reset DB
      // the intake upsert leaves them null; without this, buyer_appeal_stats +
      // upheld_ocids + the grade's upheld component rebuild to zero (FINDING-001/
      // 007). COALESCE fills ONLY where PG is null — never overwrites a live value.
      if (fs.existsSync(OUT_FILE)) {
        const seed = (
          (JSON.parse(fs.readFileSync(OUT_FILE, "utf8")).appeals ??
            []) as Array<Record<string, unknown>>
        )
          .filter(
            (a) =>
              a.complaintNo && (a.outcome != null || a.decisionDate != null),
          )
          .map((a) => [
            a.complaintNo,
            a.outcome ?? null,
            a.decisionDate ?? null,
          ]);
        for (let i = 0; i < seed.length; i += 500) {
          const chunk = seed.slice(i, i + 500);
          const values = chunk
            .map((_, j) => `($${j * 3 + 1},$${j * 3 + 2},$${j * 3 + 3})`)
            .join(",");
          await c.query(
            `UPDATE kzk_appeals a SET
               outcome = COALESCE(a.outcome, v.outcome),
               decision_date = COALESCE(a.decision_date, v.decision_date)
             FROM (VALUES ${values}) AS v(complaint_no, outcome, decision_date)
             WHERE a.complaint_no = v.complaint_no
               AND (a.outcome IS NULL OR a.decision_date IS NULL)`,
            chunk.flat(),
          );
        }
      }
      // "What changed" changelog — atomic with the load; per-row on small daily
      // deltas, one summary line on a bulk backfill (>500). Key on the complaint
      // number (stable across re-scrapes). See [[feedback_pg_changelog_required]].
      const { rows } = await c.query(
        "SELECT count(*)::int AS n FROM kzk_appeals",
      );
      await recordIngestBatch(c, {
        source: "kzk_appeals",
        table: "kzk_appeals",
        keyExpr: "t.complaint_no",
        nameExpr: "t.respondent",
        detailExpr: "t.subject",
        rowsTotal: rows[0].n as number,
      });
      await c.query("COMMIT");
    } catch (e) {
      // Roll back so the client isn't returned to the pool mid-transaction.
      await c.query("ROLLBACK").catch(() => undefined);
      throw e;
    }
  });
  // Post-commit refreshes + JSON write-back. Wrapped in try/finally so a rethrow
  // from tryExec (a real, non-missing-migration error) still runs end() — else
  // the pool leaks. Each object below is guarded as absent on a DB predating its
  // migration:
  //  · appealed_ocids / upheld_ocids (042) → contracts-browser badge + the
  //    procedureAppealUpheld contract-CRI flag,
  //  · buyer_appeal_stats (041) → the upheld-appeal component of the awarder
  //    A–F grade, then REFRESH the leaderboard so it reflects the new rulings.
  try {
    const { exec: execPg } = await import("../db/lib/pg");
    // Skip ONLY when the object's migration isn't applied on this DB (42P01 =
    // undefined_table, 42883 = undefined_function). Any other error (permissions,
    // disk, a real SQL fault) must surface — a swallowed REFRESH failure is how the
    // 2026-07-02 stale-matview bug happened.
    const tryExec = (sql: string) =>
      execPg(sql).catch((e: unknown) => {
        const code = (e as { code?: string } | null)?.code;
        if (code === "42P01" || code === "42883") return undefined;
        throw e;
      });
    await tryExec("REFRESH MATERIALIZED VIEW appealed_ocids");
    await tryExec("REFRESH MATERIALIZED VIEW upheld_ocids");
    await tryExec(
      `DELETE FROM buyer_appeal_stats;
     INSERT INTO buyer_appeal_stats (buyer_eik, decided, upheld)
       SELECT buyer_eik,
         count(*) FILTER (WHERE outcome IN ('уважена','отхвърлена')),
         count(*) FILTER (WHERE outcome = 'уважена')
       FROM kzk_appeals WHERE buyer_eik IS NOT NULL AND outcome IS NOT NULL
       GROUP BY buyer_eik`,
    );
    await tryExec("REFRESH MATERIALIZED VIEW awarder_risk_grade_ranking");
    // Repopulate the per-scope leaderboard table so it reflects the fresh
    // buyer_appeal_stats (upheld-appeal grade component) — otherwise the served
    // /procurement leaderboard stays stale until the next contract load (F-007).
    // Guarded on the 041 schema being present on this DB.
    {
      const { getPool: pool, withClient: wc } = await import("../db/lib/pg");
      const { rebuildRiskGradeScoped } = await import(
        "../db/lib/riskGradeScoped"
      );
      // No blanket .catch: to_regclass returns NULL (not an error) for a missing
      // table, so a thrown query here is a real PG fault — let it surface rather
      // than silently skip the rebuild and serve a stale leaderboard.
      const hasScoped = await pool()
        .query("SELECT to_regclass('public.awarder_risk_grade_scoped') AS t")
        .then((r) => r.rows[0]?.t != null);
      if (hasScoped) await wc((c) => rebuildRiskGradeScoped(c));
    }

    // Write the PG-resolved enrichment (buyer_eik, match, outcome, decision_date,
    // suspension) BACK into the ingest JSON so it is self-describing — otherwise
    // `npm run kzk:summary` (which reads this JSON) would silently zero the
    // resolved/outcome totals on a machine whose local JSON was never enriched.
    // This is the write-back mergeWrite's field-merge relies on; PG is the source.
    try {
      const { getPool } = await import("../db/lib/pg");
      // Pull the CANONICAL buyer name from the tenders corpus (COALESCE onto the
      // respondent) so the summary doesn't label an EIK by an arbitrary branch
      // spelling — mirrors kzk_recent_appeals(). A per-row subquery (unp is
      // indexed) avoids any join row-multiplication.
      const { rows: enr } = await getPool().query(
        `SELECT a.complaint_no, a.buyer_eik, a.match, a.outcome, a.decision_date,
              a.suspension,
              COALESCE(
                (SELECT t.buyer_name FROM tenders t WHERE t.unp = a.unp LIMIT 1),
                a.respondent
              ) AS buyer_name
         FROM kzk_appeals a`,
      );
      const byNo = new Map<string, Record<string, unknown>>(
        enr.map((r) => [r.complaint_no as string, r]),
      );
      if (fs.existsSync(OUT_FILE)) {
        const doc = JSON.parse(fs.readFileSync(OUT_FILE, "utf8"));
        for (const a of doc.appeals ?? []) {
          const e = byNo.get(a.complaintNo);
          if (e) applyEnrichment(a, e);
        }
        atomicWrite(OUT_FILE, JSON.stringify(doc, null, 2));
      }
    } catch (e) {
      // Do NOT swallow silently: the summary builder reads this JSON, so a failed
      // write-back → the next `kzk:summary` produces a zeroed artifact that gets
      // committed + served. Warn loudly (this is a manual headed run; the operator
      // is present). PG remains authoritative regardless of the JSON mirror.
      console.warn(
        "kzk: JSON enrichment write-back FAILED —",
        (e as Error).message,
      );
    }
  } finally {
    await end();
  }
};

const cmd = command({
  name: "kzk_appeals",
  args: {
    year: option({ type: optional(string), long: "year" }),
    backfill: flag({ type: boolean, long: "backfill" }),
    apply: flag({ type: boolean, long: "apply" }),
    dryRun: flag({ type: boolean, long: "dry-run" }),
  },
  handler: async ({ year, backfill, apply, dryRun }) => {
    if (backfill && year)
      throw new Error(
        "--backfill and --year are mutually exclusive (backfill crawls all years; drop one)",
      );
    if (dryRun && apply)
      throw new Error(
        "--dry-run and --apply are mutually exclusive (dry-run makes no writes; drop one)",
      );
    // Full ISO (not a UTC date slice) so a 00:00–03:00 Sofia run doesn't stamp
    // "yesterday" — matches the generatedAt timestamp.
    const fetchedAt = new Date().toISOString();
    const { chromium } = await import("playwright");
    const browser: Browser = await chromium.launch({
      headless: false, // reg.cpc.bg needs a real headed browser + BG egress
      args: ["--disable-blink-features=AutomationControlled"],
    });

    const nowYear = new Date().getFullYear();
    // The register's data starts 2020 — backfilling earlier years just re-crawls
    // the default page (and now throws, per crawlYear's year guard).
    const years = backfill
      ? Array.from({ length: nowYear - 2019 }, (_, i) => 2020 + i)
      : [year ? Number(year) : null];

    const all: KzkAppeal[] = [];
    try {
      const ctx = await browser.newContext({ userAgent: UA, locale: "bg-BG" });
      const page = await ctx.newPage();
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
      });
      for (const y of years) {
        const recs = await crawlYear(page, y, fetchedAt);
        console.log(`  ${y ?? "current"}: ${recs.length} complaints`);
        all.push(...recs);
      }
    } finally {
      await browser.close();
    }

    const resolved = all.filter((r) => r.unp).length;
    console.log(
      `Parsed ${all.length} complaints (${resolved} with УНП, ${all.length - resolved} without).`,
    );
    if (dryRun) return;
    const total = mergeWrite(all);
    console.log(`Wrote ${OUT_FILE} (${total} total).`);
    if (apply) {
      await applyPg(all);
      console.log(
        `Upserted ${all.length} into kzk_appeals + resolved buyer_eik.`,
      );
    }
  },
});

// Guard so importing this module (e.g. to unit-test parseComplaintsText) does
// NOT launch the headed crawl.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run(cmd, process.argv.slice(2));
}
