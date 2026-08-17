/**
 * Fill `declaration.filed_institution` / `filed_position` — the declarant's OWN institution
 * and job, from each filing's `<Personal><Work>` and `<Personal><Position>`.
 *
 *   npx tsx scripts/declarations/backfill_filed_position.ts --slug mp-5104 --apply
 *   npx tsx scripts/declarations/backfill_filed_position.ts --all --apply [--limit N]
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
  if (!slug && !all) throw new Error("pass --slug <person-slug> or --all");
  const apply = has("--apply");
  const force = has("--force");
  const limit = arg("--limit") ? Number(arg("--limit")) : null;

  const rows = await allRows<{ declaration_id: string; source_url: string }>(
    `SELECT d.declaration_id::text, d.source_url
       FROM declaration d
       ${slug ? "JOIN person p USING (person_id)" : ""}
      WHERE TRUE
        ${slug ? "AND p.slug = $1" : ""}
        ${force ? "" : "AND (d.filed_position IS NULL OR d.filed_institution IS NULL)"}
      ORDER BY d.declaration_id
      ${limit ? `LIMIT ${Number(limit)}` : ""}`,
    slug ? [slug] : [],
  );
  console.log(`${rows.length} filing(s) to fill${apply ? "" : "  (dry run)"}`);

  const updates: [string, string | null, string | null][] = [];
  let cache = 0;
  let fetched = 0;
  let missing = 0;
  for (const r of rows) {
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
  }
  console.log(
    `  read: ${cache} cached, ${fetched} fetched, ${missing} unreadable · ` +
      `${updates.length} carry a Work/Position`,
  );
  for (const [id, w, p] of updates.slice(0, 12))
    console.log(`    ${id}  ${p ?? "—"}  ·  ${w ?? "—"}`);
  if (updates.length > 12) console.log(`    … and ${updates.length - 12} more`);

  if (!apply) {
    console.log("dry run — pass --apply to write");
    return;
  }
  await withTx(async (c) => {
    for (const [id, w, p] of updates)
      await c.query(
        `UPDATE declaration SET filed_institution = $2, filed_position = $3
          WHERE declaration_id = $1::bigint`,
        [id, w, p],
      );
  });
  console.log(`updated ${updates.length} row(s)`);
};

main()
  .catch((e) => {
    console.error(
      `backfill_filed_position: ${e instanceof Error ? e.message : e}`,
    );
    process.exitCode = 1;
  })
  .finally(() => end());
