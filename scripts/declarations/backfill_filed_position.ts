/**
 * Fill `declaration.filed_institution` / `filed_position` — the declarant's OWN institution
 * and job, from each filing's `<Personal><Work>` and `<Personal><Position>`.
 *
 *   npx tsx scripts/declarations/backfill_filed_position.ts --slug mp-5104 --apply
 *   npx tsx scripts/declarations/backfill_filed_position.ts --all --cache-only --apply
 *   npx tsx scripts/declarations/backfill_filed_position.ts --all --apply [--limit N]
 *
 * `--cache-only` never touches the network: it fills what raw_data/declarations already
 * holds and skips the rest. Measured 2026-08-16 that is 6,288 of 61,725 outstanding filings
 * — free and instant, so run it first and let the crawl cover only what is left.
 *
 * The full run is a ~5.4 hour crawl of a shared public register (55,437 fetches at the
 * courtesy delay below), so it is an operator action like `tr:cr-deeds`, not a pipeline
 * step. It commits in batches and skips rows that already have both columns, so it is
 * interruptible and resumes simply by being re-run.
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────────────────
 *
 * `declaration.institution` / `position_title` come from the register's LISTING page and are
 * GROUP labels, not job titles. `position_title = 'Служебен министър-председател и министър'`
 * covers TWO people — Иван Демерджиев and Лазар Лазаров — and neither was caretaker PM; both
 * were DEPUTY PM plus a minister, and the register has a separate 'Служебен заместник
 * министър-председател и министър' bucket that it did not put them in. Rendered as a person's
 * role that is a false statement about a named living person, which is exactly what reached
 * a published card on 2026-08-16.
 *
 * The filing itself has always carried the truth: Демерджиев's 2023 filing says
 * „Министерство на вътрешните работи" / „Министър", and Рашков's filings trace
 * НБКСРС → МВР (2021) → Народно събрание (2022-) — a career the listing label never shows.
 * The parser simply did not read those two fields until 2026-08-16.
 *
 * ── WHY A BACKFILL RATHER THAN A RE-INGEST ──────────────────────────────────────────────
 *
 * A full re-parse would need every filing's XML, and `raw_data/declarations/` caches 6,296
 * of 61,743 (~10%) — the rest would be a re-crawl of a rate-limited public register. So this
 * reads the cache where it exists and fetches only what is missing, one filing at a time,
 * and is safe to run scoped (`--slug`) for the people a post actually needs.
 *
 * Idempotent: it only writes rows whose columns are still NULL unless `--force` is passed.
 */

import fs from "node:fs";
import path from "node:path";
import { load } from "cheerio";
import { Agent } from "undici";
import { allRows, withTx, end } from "../db/lib/pg";

const ROOT = path.resolve(import.meta.dirname, "../..");
const CACHE = path.join(ROOT, "raw_data/declarations");
/** Courtesy delay between live fetches — a shared public register, not our server. */
const FETCH_DELAY_MS = 350;
const UA = "electionsbg.com data pipeline";

// register.cacbg.bg presents a cert chain Node's default CA bundle does not trust (Bulgarian
// government root), so a plain fetch fails UNABLE_TO_VERIFY_LEAF_SIGNATURE while curl — which
// reads the OS store — succeeds. Same scoped dispatcher scripts/declarations/index.ts uses,
// applied only to this host.
const insecureDispatcher = new Agent({
  connect: { rejectUnauthorized: false },
});

const arg = (f: string): string | undefined => {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (f: string): boolean => process.argv.includes(f);

/** The register stores `<year>/<guid>.xml`; the cache mirrors that, with a `_nc` suffix on
 *  at least one year's folder, so the guid is matched rather than the path rebuilt. */
const cachedPath = (sourceUrl: string): string | null => {
  const file = sourceUrl.split("/").pop();
  if (!file) return null;
  for (const dir of fs.existsSync(CACHE) ? fs.readdirSync(CACHE) : []) {
    const p = path.join(CACHE, dir, file);
    if (fs.existsSync(p)) return p;
  }
  return null;
};

const readXml = async (
  sourceUrl: string,
): Promise<{ xml: string; from: "cache" | "fetch" } | null> => {
  const hit = cachedPath(sourceUrl);
  if (hit) return { xml: fs.readFileSync(hit, "utf-8"), from: "cache" };
  try {
    const res = await fetch(sourceUrl, {
      headers: { "User-Agent": UA, Accept: "application/xml, text/xml, */*" },
      // @ts-expect-error: dispatcher is undici-only, not in fetch's standard typings
      dispatcher: insecureDispatcher,
    });
    if (!res.ok) return null;
    await new Promise((r) => setTimeout(r, FETCH_DELAY_MS));
    return { xml: await res.text(), from: "fetch" };
  } catch {
    return null;
  }
};

/** The same two selectors `parse_declaration.ts` reads, kept in step with it deliberately —
 *  a filing whose Work/Position this extracts must be the one that file would extract. */
const extract = (
  xml: string,
): { work: string | null; position: string | null } => {
  const $ = load(xml, { xmlMode: true });
  const t = (sel: string) => {
    const v = $(sel).first().text().trim();
    return v.length ? v : null;
  };
  return { work: t("Personal > Work"), position: t("Personal > Position") };
};

const main = async (): Promise<void> => {
  const slug = arg("--slug");
  const all = has("--all");
  // Targets the listing labels most likely to be individually FALSE rather than merely
  // coarse. The cabinet buckets are the ones that conflate distinct offices — „Служебен
  // министър-председател и министър" is two deputy PMs, neither a PM — while „Директор"
  // (8,078 people) and the five municipal labels are coarse but true.
  const like = arg("--like");
  if (!slug && !all && !like)
    throw new Error(
      "pass --slug <person-slug>, --like <position_title pattern>, or --all",
    );
  const apply = has("--apply");
  const force = has("--force");
  const limit = arg("--limit") ? Number(arg("--limit")) : null;
  const cacheOnly = has("--cache-only");
  // Small enough that an interrupted 5-hour crawl loses seconds of work, large enough that
  // the commit overhead disappears against a 350ms fetch.
  const BATCH = 200;

  const rows = await allRows<{ declaration_id: string; source_url: string }>(
    `SELECT d.declaration_id::text, d.source_url
       FROM declaration d
       ${slug ? "JOIN person p USING (person_id)" : ""}
      WHERE TRUE
        ${slug ? "AND p.slug = $1" : ""}
        ${like ? `AND d.position_title ILIKE ${slug ? "$2" : "$1"}` : ""}
        ${force ? "" : "AND (d.filed_position IS NULL OR d.filed_institution IS NULL)"}
      ORDER BY d.declaration_id
      ${limit ? `LIMIT ${Number(limit)}` : ""}`,
    [...(slug ? [slug] : []), ...(like ? [like] : [])],
  );
  console.log(`${rows.length} filing(s) to fill${apply ? "" : "  (dry run)"}`);

  const flush = async (batch: [string, string | null, string | null][]) => {
    if (!apply || !batch.length) return;
    await withTx(async (c) => {
      for (const [id, w, p] of batch)
        await c.query(
          `UPDATE declaration SET filed_institution = $2, filed_position = $3
            WHERE declaration_id = $1::bigint`,
          [id, w, p],
        );
    });
  };

  const updates: [string, string | null, string | null][] = [];
  let pending: [string, string | null, string | null][] = [];
  let written = 0;
  let cache = 0;
  let fetched = 0;
  let missing = 0;
  let skipped = 0;
  for (const [i, r] of rows.entries()) {
    if (cacheOnly && !cachedPath(r.source_url)) {
      skipped += 1;
      continue;
    }
    const got = await readXml(r.source_url);
    if (!got) {
      missing += 1;
      continue;
    }
    if (got.from === "cache") cache += 1;
    else fetched += 1;
    const { work, position } = extract(got.xml);
    if (!work && !position) continue;
    updates.push([r.declaration_id, work, position]);
    pending.push([r.declaration_id, work, position]);
    if (pending.length >= BATCH) {
      await flush(pending);
      written += pending.length;
      pending = [];
      console.log(
        `  … ${i + 1}/${rows.length} read, ${written} written` +
          `${fetched ? ` (${fetched} fetched)` : ""}`,
      );
    }
  }
  await flush(pending);
  written += pending.length;
  console.log(
    `  read: ${cache} cached, ${fetched} fetched, ${missing} unreadable` +
      `${cacheOnly ? `, ${skipped} skipped (not cached)` : ""} · ` +
      `${updates.length} carry a Work/Position`,
  );
  for (const [id, w, p] of updates.slice(0, 12))
    console.log(`    ${id}  ${p ?? "—"}  ·  ${w ?? "—"}`);
  if (updates.length > 12) console.log(`    … and ${updates.length - 12} more`);

  if (!apply) {
    console.log("dry run — pass --apply to write");
    return;
  }
  console.log(`updated ${written} row(s)`);
  if (cacheOnly && skipped)
    console.log(
      `${skipped} filing(s) are not cached. Re-run without --cache-only to fetch them ` +
        `(~${Math.round((skipped * FETCH_DELAY_MS) / 3600000)}h against the register).`,
    );
};

main()
  .catch((e) => {
    console.error(
      `backfill_filed_position: ${e instanceof Error ? e.message : e}`,
    );
    process.exitCode = 1;
  })
  .finally(() => end());
