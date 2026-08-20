// Load data/procurement/aop_experts.json into `aop_expert` + `aop_expert_coverage`
// (migration 174, plan P4).
//
//   npm run db:load:aop-experts:pg
//   npm run db:load:aop-experts:pg:cloud
//
// The source is COMMITTED (88 rows), so this is pure-load: it works on a fresh
// clone with no network, and `npm run aop:experts` is what re-crawls.
//
// ⚠️ The register is historical — see 174's header. This loader does not filter on
// validity (that would empty the table) and does not compute „is current" itself:
// `is_current` is derived by the `aop_expert_table` view, never stored.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end, exec, vacuumAfterReload, withTx } from "./lib/pg";
import { copyRows } from "./lib/copy";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = path.resolve(__dirname, "schema/pg/174_aop_experts.sql");
const SRC = path.resolve(__dirname, "../../data/procurement/aop_experts.json");

interface Expert {
  une: string;
  name: string;
  /** DERIVED union of the per-area windows — see 174. */
  validFrom: string | null;
  validUntil: string | null;
  areas: {
    areaNo: number;
    area: string;
    validFrom: string | null;
    validUntil: string | null;
  }[];
}
interface Payload {
  coverage: Record<string, unknown>;
  experts: Expert[];
}

/** given + family, as the register prints them. A name with anything other than
 *  two usable parts yields NULLs, which excludes the row from every join rather
 *  than letting it match on a partial key. */
export const splitExpertName = (
  raw: string,
): { given: string | null; family: string | null } => {
  const parts = raw.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  return parts.length === 2
    ? { given: parts[0].toLowerCase(), family: parts[1].toLowerCase() }
    : { given: null, family: null };
};

const main = async (): Promise<void> => {
  await exec(fs.readFileSync(SCHEMA, "utf8"));

  if (!fs.existsSync(SRC)) {
    console.warn(
      `→ schema applied; no ${path.relative(process.cwd(), SRC)} — run ` +
        `\`npm run aop:experts\` first.`,
    );
    await end();
    return;
  }

  const payload = JSON.parse(fs.readFileSync(SRC, "utf8")) as Payload;
  const experts = payload.experts ?? [];
  if (experts.length === 0)
    throw new Error(
      "aop_experts.json has no experts — refusing to publish an empty register " +
        "over a populated one",
    );

  await withTx(async (c) => {
    // CASCADE takes aop_expert_area with it — the FK is ON DELETE CASCADE, and
    // truncating the parent alone would raise rather than silently orphan.
    await c.query("TRUNCATE aop_expert CASCADE");
    await copyRows(
      c,
      "aop_expert",
      [
        "une",
        "name",
        "given_fold",
        "family_fold",
        "valid_from",
        "valid_until",
        "areas",
      ],
      experts.map((e) => {
        const { given, family } = splitExpertName(e.name);
        return [
          e.une,
          e.name,
          given,
          family,
          e.validFrom,
          e.validUntil,
          JSON.stringify(e.areas ?? []),
        ];
      }),
    );
    await copyRows(
      c,
      "aop_expert_area",
      ["une", "area_no", "area", "valid_from", "valid_until"],
      experts.flatMap((e) =>
        (e.areas ?? []).map((a) => [
          e.une,
          a.areaNo,
          a.area,
          a.validFrom,
          a.validUntil,
        ]),
      ),
    );
    // The folds must be transliterated to match `person.given_fold`, which is
    // Latin. Doing it in SQL keeps ONE definition of the fold — a TS copy would be
    // a second one, which is the defect class this repo keeps re-learning.
    await c.query(
      `UPDATE aop_expert
          SET given_fold = translit_bg_latin(given_fold),
              family_fold = translit_bg_latin(family_fold)
        WHERE given_fold IS NOT NULL`,
    );

    const cv = payload.coverage as Record<string, never>;
    await c.query(
      `INSERT INTO aop_expert_coverage
         (id, crawled_at, areas_queried, areas_with_experts, expert_count,
          earliest_from, latest_from, latest_until, still_valid_on_crawl_date)
       VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         crawled_at=EXCLUDED.crawled_at, areas_queried=EXCLUDED.areas_queried,
         areas_with_experts=EXCLUDED.areas_with_experts,
         expert_count=EXCLUDED.expert_count, earliest_from=EXCLUDED.earliest_from,
         latest_from=EXCLUDED.latest_from, latest_until=EXCLUDED.latest_until,
         still_valid_on_crawl_date=EXCLUDED.still_valid_on_crawl_date`,
      [
        cv.crawledAt,
        cv.areasQueried,
        cv.areasWithExperts,
        cv.expertCount,
        cv.earliestFrom,
        cv.latestFrom,
        cv.latestUntil,
        cv.stillValidOnCrawlDate,
      ],
    );
  });

  await vacuumAfterReload("aop_expert", "aop_expert_area");

  const [stats] = await allRows<{
    experts: number;
    matched_any: number;
    unambiguous: number;
    refused_ambiguous: number;
  }>("SELECT * FROM aop_expert_link_stats()");
  const [cur] = await allRows<{ n: string }>(
    "SELECT count(*)::text n FROM aop_expert_table WHERE is_current",
  );
  console.log(
    `✓ aop_expert=${experts.length} · still valid today=${cur.n} (the register is ` +
      `historical — see 174)`,
  );
  // ⚠️ This loader sits early in db:refresh, beside the other P-series ingests,
  // while `person` is not rebuilt until db:resolve:persons ~35 steps later. On a
  // COLD chain the join therefore has nothing to match — and „0 unambiguous links"
  // reads as „the refusal found nothing" when it actually means „the person layer
  // does not exist yet". Say which.
  const [pc] = await allRows<{ n: string }>(
    "SELECT count(*)::text n FROM person WHERE status = 'active'",
  );
  if (Number(pc.n) === 0)
    console.log(
      "  person links: not computable — `person` is empty (db:resolve:persons has " +
        "not run on this database yet). This is not a link count of zero.",
    );
  else
    console.log(
      `  person links: ${stats.unambiguous} unambiguous · ${stats.refused_ambiguous} ` +
        `REFUSED as shared names · ${stats.matched_any} matched at least one person`,
    );
  await end();
};

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await end().catch(() => {});
  process.exit(1);
});
