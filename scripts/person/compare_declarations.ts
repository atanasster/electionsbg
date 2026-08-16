/**
 * The comparability gate behind the `person-compare-post` skill: given two people,
 * decide whether their declarations can honestly be put side by side, and if so emit
 * the `renderVersusCard` spec for the pair.
 *
 *   npx tsx scripts/person/compare_declarations.ts --a <slug|name> --b <slug|name> \
 *     [--year N] [--class annual|inventory] [--total net|assets] [--out <path>]
 *
 * Plan: docs/plans/person-compare-post-v1.md. Exit 2 means the pair is NOT comparable, or a
 * flag was misused, and the reason is printed — a normal outcome, not a crash. Exit 1 means
 * the tool itself broke.
 *
 * ── WHY A GATE AT ALL ───────────────────────────────────────────────────────────────
 *
 * A declaration is not a wealth statement; it is one of two different instruments, and
 * the site publishes both. Measured over the whole corpus:
 *
 *   Annualy  44,615 filings · 1.41 real-estate rows avg · 93.3% carry an income table
 *   Entry     5,654 filings · 6.27 real-estate rows avg ·  0%  carry an income table
 *   Vacate    5,484 filings · 6.38 real-estate rows avg ·  0%  carry an income table
 *   Other     5,990 filings · no assets, no income — never comparable
 *
 * So matching on the YEAR alone is not enough. Иван Демерджиев and Бойко Рашков both
 * filed for 2023 — Демерджиев's a Vacate, Рашков's an Annualy — and pairing those would print
 * „17 имота срещу 0" and „66 015 € заплата срещу —", both artifacts of the form rather
 * than facts about the men. The gate matches on (period_year, form class) and takes the
 * newest year where BOTH filed the SAME form — for that pair 2023/inventory, because Рашков
 * filed an Entry and Демерджиев a Vacate covering it. (`annual` breaks a tie WITHIN a year;
 * it does not outrank a newer year. Forcing --year 2022 --class annual is the older pair.)
 *
 * Four further traps this closes, each measured rather than assumed:
 *
 *  - THE REPRESENTATIVE FILING. Рашков has four filings covering 2023. The annual one
 *    carries 0 real-estate rows; his Entry and Vacate that same year carry 24 each. Any
 *    „N имота" taken from the wrong one is false about a named living person, so the
 *    representative is picked per (person, year, CLASS) on byRecency, never per year.
 *  - `credit_limit` IS NOT A DEBT. Рашков's 2022 annual carries a 5,113 € credit LINE.
 *    089's own note: a declared limit is what the holder could draw, and subtracting it
 *    asserts a debt nobody declared. It is excluded from both arms here, exactly as the
 *    serving SQL excludes it — a `category != 'debt'` shortcut would fold it into assets.
 *  - AN UNVALUED ROW IS NOT A CHEAP ONE. Рашков's 2023 встъпителна lists 24 properties
 *    of which 19 carry NO declared price, so the money on that table sums to 409 €;
 *    Демерджиев's 17 are all priced, at 175,305 €. Rendered as money that is a 428x gap
 *    which does not exist. This is systematic rather than freak: 22.9% of filings with a
 *    real-estate table have at least one unpriced row, 20.8% have more than a fifth
 *    unpriced and 7.8% are entirely unpriced — against ~1% for bank, vehicle and
 *    investment. So the gate drops a metric whose value is substantially unstated on
 *    either side (see MAX_UNVALUED_SHARE) and reports it, rather than publishing a
 *    comparison of a number against a blank.
 *  - LATEST IS NOT DENSEST. 2026 holds 45 annual filers against 1,877 entry/exit ones,
 *    because the annuals land the following spring. Picking max(year) lands where almost
 *    no pair is comparable.
 *
 * ── WHAT IT REFUSES TO DECIDE ───────────────────────────────────────────────────────
 *
 * It does not pick a winner. `--total` selects which figure heads the card, and the gate
 * report always prints BOTH, because the ranking flips between them. On the fixture's own
 * 2023 inventory pair: on ASSETS Демерджиев leads (627,496 € vs 503,311 €), on NET Рашков
 * leads (503,311 € vs 295,192 €), the difference being 332,304 € of declared debt. The
 * winner is chosen by the basis, so the basis is stated on the card and never left implicit.
 * (Both figures here are same-class, which is the point — an earlier draft of this comment
 * quoted Рашков's 2023 ANNUAL against Демерджиев's 2023 VACATE, i.e. the very cross-class
 * comparison the gate exists to refuse.)
 */

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { allRows, end } from "../db/lib/pg";
import {
  VERSUS_METRICS,
  renderVersusCard,
  versusMetric,
  type VersusCardSpec,
  type VersusFormClass,
  type VersusMetricKey,
  type VersusRow,
  type VersusSide,
} from "../posts/cardKit";

/** Asset categories that are neither an asset nor a debt for totalling purposes.
 *  Mirrors the serving SQL's `category NOT IN ('debt','credit_limit')` asset arm and its
 *  `= 'debt'` debt arm — `credit_limit` is in neither, by design. */
const NOT_A_METRIC = new Set(["credit_limit"]);

/** Share of a metric's rows that may lack a declared value before the metric is dropped
 *  from the card as a money comparison.
 *
 *  The threshold is doing less delicate work than it looks: measured corpus-wide, 22.9% of
 *  real-estate tables carry at least one unpriced row and 20.8% carry more than a fifth —
 *  the two are close, so filings are mostly either fine or badly affected, and any cut in
 *  that gap separates the same two groups. Below it, the shortfall is reported as a caveat
 *  rather than acted on. `--max-unvalued-pct` overrides; 100 disables the drop. */
export const MAX_UNVALUED_SHARE = 0.2;

type Availability = {
  slug: string;
  display_name: string;
  period_year: number;
  klass: VersusFormClass;
  declaration_type: string;
};

type SideRow = {
  slug: string;
  display_name: string;
  institution: string | null;
  position_title: string | null;
  declaration_type: string;
  source_url: string;
  category: string | null;
  n: number;
  unvalued: number;
  excluded_rows: number;
  eur: number;
};

/** A verdict about the DATA (not comparable, ambiguous name) or a misuse of the flags — as
 *  opposed to a crash. Exits 2, so a caller can tell "these two cannot honestly be compared"
 *  from "this tool is broken" without parsing stderr. */
class Usage extends Error {}

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** byRecency (src/lib/declarations.ts), restricted to one (person, year, class), so this
 *  picks the filing the /person page calls latest.
 *
 *  These are byRecency's LAST FOUR rungs. 090's rank list opens with two more —
 *  `has_valued_assets` then `has_assets` — which exist to demote an incompatibility shell
 *  carrying one blank asset row. They are unreachable here because the `filings` CTE below
 *  already requires a valued asset row: measured over the whole corpus, this ordering agrees
 *  with 090's on 46,459 of 46,459 (person, year, class) groups.
 *
 *  Restated in SQL rather than imported because it has to run inside the query. One knowing
 *  difference from the TS comparator: `entry_number ASC NULLS LAST` puts a null entry number
 *  last, where the TS `byRecency` sorts it first — it is the penultimate tie-break and no
 *  group in the corpus reaches it. */
const BY_RECENCY = `
  filed_at DESC NULLS LAST,
  CASE declaration_type
    WHEN 'Vacate'  THEN 3
    WHEN 'Annualy' THEN 2
    WHEN 'Entry'   THEN 0
    ELSE 1
  END DESC,
  entry_number ASC NULLS LAST,
  source_url ASC`;

/** Asset-bearing filings of both people, one representative per (person, year, class).
 *  `Other` filings are excluded at source: 5,990 of them carry no asset table at all. */
const REP_CTE = `
  people AS (
    SELECT person_id, slug, display_name
      FROM person
     WHERE slug = ANY($1::text[]) AND status = 'active' AND is_public_figure
  ),
  filings AS (
    SELECT d.declaration_id, d.person_id, p.slug, p.display_name,
           COALESCE(d.fiscal_year, d.declaration_year) AS period_year,
           CASE d.declaration_type WHEN 'Annualy' THEN 'annual' ELSE 'inventory' END AS klass,
           d.declaration_type, d.filed_at, d.entry_number, d.source_url,
           d.institution, d.position_title
      FROM declaration d
      JOIN people p USING (person_id)
     WHERE d.declaration_type IN ('Annualy', 'Entry', 'Vacate')
       AND EXISTS (SELECT 1 FROM declaration_asset a
                    WHERE a.declaration_id = d.declaration_id
                      AND a.value_eur IS NOT NULL)
  ),
  rep AS (
    SELECT DISTINCT ON (person_id, period_year, klass) *
      FROM filings
     ORDER BY person_id, period_year, klass, ${BY_RECENCY}
  )`;

/** Resolve a slug or a name to exactly one active public figure. */
const resolvePerson = async (needle: string): Promise<string> => {
  // Every whitespace-separated needle token must match a WHOLE WORD of the display name.
  //
  // Token-wise rather than one substring, because Bulgarian registers spell a full
  // three-part name („Иван Петев Демерджиев") while anyone typing a comparison writes first
  // + last („Иван Демерджиев"), which no single substring can match across the patronymic.
  //
  // WHOLE-WORD rather than substring-per-token, because Bulgarian given names are prefixes
  // of the surnames derived from them: „Георги" is inside „Георгиев" and „Бойко" inside
  // „Бойкова", so a substring test returned 5,584 candidates for „Георги Георгиев", none of
  // them actually called that, and buried the 41 real matches past the LIMIT. Splitting on
  // hyphens too, since „Рашкова-Цековска" is two words.
  //
  // It also removes every LIKE wildcard concern: nothing is a pattern here, so `--a "%"`
  // simply matches no word rather than the whole register.
  const tokens = needle.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) throw new Usage("empty person name");
  const rows = await allRows<{
    slug: string;
    display_name: string;
    total: string;
  }>(
    `SELECT slug, display_name, count(*) OVER () AS total FROM person p
      WHERE status = 'active' AND is_public_figure
        AND (slug = $1
             OR (SELECT bool_and(EXISTS (
                   SELECT 1
                     FROM unnest(regexp_split_to_array(lower(p.display_name), '[\\s-]+')) AS w
                    WHERE w = lower(t)))
                   FROM unnest($2::text[]) AS t))
      -- An exact full-name hit ranks first, or the person actually named „Иван Петев
      -- Демерджиев" sorts below everyone whose name merely contains those three words.
      ORDER BY (slug = $1) DESC, (lower(display_name) = lower($1)) DESC,
               length(display_name), display_name
      LIMIT 25`,
    [needle, tokens],
  );
  if (!rows.length)
    throw new Usage(`no active public figure matches "${needle}"`);
  if (rows[0].slug === needle) return needle;
  const total = Number(rows[0].total);
  if (total > 1)
    throw new Usage(
      `"${needle}" matches ${total} people — pass a slug:\n` +
        rows.map((r) => `  ${r.slug}  ${r.display_name}`).join("\n") +
        (total > rows.length
          ? `\n  … and ${total - rows.length} more. Add a middle name to narrow it, or ` +
            `look the person up on /persons and pass their slug.`
          : ""),
    );
  return rows[0].slug;
};

export type CompareOptions = {
  /** Already-resolved person slugs — see {@link resolvePerson}. */
  slugA: string;
  slugB: string;
  /** Force a (year, class) instead of taking the gate's newest common pair. */
  year?: number;
  klass?: VersusFormClass;
  /** Which figure heads the card. Default `net`. */
  totalBasis?: "net" | "assets";
  /** 0..1; default {@link MAX_UNVALUED_SHARE}. */
  maxUnvaluedShare?: number;
};

/** The gate's reasoning, and the card it licenses. */
export type CompareResult = {
  gate: Record<string, unknown>;
  card: VersusCardSpec;
};

/** The gate and the card build, with no argv and no file IO, so it is drivable from a test.
 *  Throws {@link Usage} whenever the pair cannot honestly be compared. */
export const compareDeclarations = async (
  opts: CompareOptions,
): Promise<CompareResult> => {
  const { slugA, slugB } = opts;
  const totalBasis = opts.totalBasis ?? "net";
  const wantYear = opts.year;
  const wantClass = opts.klass;
  const maxUnvalued = opts.maxUnvaluedShare ?? MAX_UNVALUED_SHARE;
  if (slugA === slugB)
    throw new Usage(`--a and --b resolve to the same person (${slugA})`);
  const slugs = [slugA, slugB];

  // ---- the gate: which (year, class) can both of them actually speak to? ----
  const avail = await allRows<Availability>(
    `WITH ${REP_CTE}
     SELECT slug, display_name, period_year, klass, declaration_type
       FROM rep ORDER BY period_year DESC, klass`,
    [slugs],
  );
  const missing = slugs.filter((s) => !avail.some((r) => r.slug === s));
  if (missing.length)
    throw new Usage(`no asset-bearing declaration for: ${missing.join(", ")}`);

  const keyOf = (r: Availability) => `${r.period_year}:${r.klass}`;
  const setA = new Set(avail.filter((r) => r.slug === slugA).map(keyOf));
  const common = [
    ...new Set(
      avail.filter((r) => r.slug === slugB && setA.has(keyOf(r))).map(keyOf),
    ),
  ]
    .map((k) => ({
      year: Number(k.split(":")[0]),
      klass: k.split(":")[1] as VersusFormClass,
    }))
    // Newest first; on a tie prefer `annual`, the class that carries income.
    .sort(
      (x, y) =>
        y.year - x.year ||
        (x.klass === y.klass ? 0 : x.klass === "annual" ? -1 : 1),
    );

  const picked = common.find(
    (c) =>
      (wantYear === undefined || c.year === wantYear) &&
      (wantClass === undefined || c.klass === wantClass),
  );
  if (!picked) {
    const grid = (s: string) =>
      avail
        .filter((r) => r.slug === s)
        .map((r) => `    ${r.period_year} ${r.klass} (${r.declaration_type})`)
        .join("\n");
    throw new Usage(
      `no common (year, form class)${wantYear ? ` matching --year ${wantYear}` : ""}` +
        `${wantClass ? ` --class ${wantClass}` : ""}.\n` +
        `  ${slugA}:\n${grid(slugA)}\n  ${slugB}:\n${grid(slugB)}\n` +
        `  An annual and an entry/vacate filing measure different things — see this ` +
        `file's header.`,
    );
  }

  // ---- one query, both sides, so neither is picked by a different rule ----
  const detail = await allRows<SideRow>(
    `WITH ${REP_CTE},
     chosen AS (
       SELECT * FROM rep WHERE period_year = $2 AND klass = $3
     )
     SELECT c.slug, c.display_name, c.institution, c.position_title,
            c.declaration_type, c.source_url,
            a.category,
            count(a.*)::int AS n,
            count(*) FILTER (WHERE a.value_eur IS NULL)::int AS unvalued,
            -- Not a silent cap, for the same reason 090 publishes excluded_asset_rows: a
            -- total that is knowingly incomplete must be caveatable. Latent today (0 rows
            -- corpus-wide exceed the ceiling) but it is FINDING-001's defect class exactly.
            count(*) FILTER (
              WHERE a.category NOT IN ('debt', 'credit_limit')
                AND a.value_eur > asset_row_ceiling_eur()
            )::int AS excluded_rows,
            -- The asset arm carries the share multiplier (a co-owned property is declared
            -- WHOLE, once per co-owner) and the implausible-row ceiling, exactly as
            -- person_wealth_year does. The debt arm carries neither: excluding a debt would
            -- OVERSTATE net worth, the one direction an accountability figure must not fail in.
            round(COALESCE(SUM(
              CASE WHEN a.category = 'debt' THEN a.value_eur
                   ELSE a.value_eur * asset_share_multiplier(a.share, a.category) END
            ) FILTER (
              WHERE a.category = 'debt' OR a.value_eur <= asset_row_ceiling_eur()
            ), 0))::float8 AS eur
       FROM chosen c
       LEFT JOIN declaration_asset a ON a.declaration_id = c.declaration_id
      GROUP BY c.slug, c.display_name, c.institution, c.position_title,
               c.declaration_type, c.source_url, a.category
     UNION ALL
     SELECT c.slug, c.display_name, c.institution, c.position_title,
            c.declaration_type, c.source_url,
            'income' AS category, count(i.*)::int, 0, 0,
            -- DECLARANT ONLY. Table 12 has a declarant column and a spouse column — two
            -- PEOPLE, not two halves of one figure. Summing them published EUR 163,255 for
            -- a declared EUR 104,975 once already (see incomeTotals in src/lib/declarations.ts).
            round(COALESCE(SUM(i.eur_declarant), 0))::float8
       FROM chosen c
       LEFT JOIN declaration_income i ON i.declaration_id = c.declaration_id
      GROUP BY c.slug, c.display_name, c.institution, c.position_title,
               c.declaration_type, c.source_url`,
    [slugs, picked.year, picked.klass],
  );

  /** BG thousands grouping with non-breaking spaces, so a euro figure never wraps mid-number
   *  on the card. Written as `\u00a0` escapes rather than literal characters — an invisible
   *  NBSP in source is exactly what no-irregular-whitespace exists to stop. */
  const eur = (n: number): string =>
    `${Math.round(n).toLocaleString("bg-BG").replace(/\s/g, "\u00a0")}\u00a0€`;

  // Only metrics legal on the chosen class, in a stable order, and only those either side
  // actually declared — plus the ones the card should always state even at zero.
  // Always-on rows, even at zero, so „nothing declared here" is stated rather than implied.
  // The annual set is 5 rather than plan §5's 7: `security` and `vehicle` appear only if one
  // side declared them, because the card's row budget cannot carry seven always-on stock
  // rows plus income plus the total band — the renderer refuses such a spec outright.
  const ALWAYS: VersusMetricKey[] =
    picked.klass === "annual"
      ? ["bank", "cash", "investment", "debt", "income"]
      : ["real_estate", "bank", "vehicle", "investment", "debt"];
  const declared = new Set(
    detail
      .filter((r) => r.category && !NOT_A_METRIC.has(r.category) && r.n > 0)
      .map((r) => r.category as VersusMetricKey),
  );
  const candidate = (Object.keys(VERSUS_METRICS) as VersusMetricKey[]).filter(
    (k) =>
      versusMetric(k)!.classes.includes(picked.klass) &&
      (ALWAYS.includes(k) || declared.has(k)),
  );

  // Per (side, metric): how much of the declared table carries no price at all. A metric is
  // comparable as MONEY only where both sides actually stated one; where they did not, the
  // sum is a floor over an unknown remainder, and a bar drawn from it makes a claim the
  // filing does not.
  const unvalued = detail
    .filter((r) => r.category && r.n > 0 && r.unvalued > 0)
    .map((r) => ({
      slug: r.slug,
      metric: r.category as VersusMetricKey,
      rows: r.n,
      unvalued: r.unvalued,
      share: r.unvalued / r.n,
    }));
  // `debt` is exempt from the drop, and the asymmetry is the same one 090's header states:
  // excluding an ASSET understates wealth (cautious, and visible), while excluding a DEBT
  // OVERSTATES it — silently making someone look richer than they declared, which is the one
  // direction an accountability figure must never fail in. Dropping the metric used to set
  // `debts = 0` and publish net = assets: 507,263 € against an honest 397,247 € on one real
  // pair, with 185,616 € of PRICED debt erased. The debt row therefore always shows; what an
  // unpriced debt table costs us is the NET basis, refused below.
  const droppedMetrics = unvalued.filter(
    (u) =>
      u.metric !== "debt" &&
      candidate.includes(u.metric) &&
      u.share > maxUnvalued,
  );
  const dropped = new Set(droppedMetrics.map((u) => u.metric));
  const metrics = candidate.filter((k) => !dropped.has(k));
  const debtUnpriced = unvalued.filter(
    (u) => u.metric === "debt" && u.share > maxUnvalued,
  );
  if (debtUnpriced.length && totalBasis === "net")
    throw new Usage(
      "the debt table is substantially unpriced, so a NET total would be a ceiling over an " +
        "unknown liability — i.e. it would overstate. Re-run with `--total assets`, which " +
        "does not depend on the debt figure.\n" +
        debtUnpriced
          .map(
            (u) =>
              `  ${u.slug} debt: ${u.unvalued}/${u.rows} rows carry no declared value`,
          )
          .join("\n"),
    );
  if (!metrics.length)
    throw new Usage(
      "every candidate metric was dropped for unpriced rows — nothing left to compare.\n" +
        droppedMetrics
          .map(
            (u) =>
              `  ${u.slug} ${u.metric}: ${u.unvalued}/${u.rows} rows carry no declared value`,
          )
          .join("\n"),
    );

  /** Sum an asset side. `only` restricts to the metrics the card actually shows; omitting it
   *  gives the whole filing. Written once so "what did the card leave out?" is a subtraction
   *  rather than a comparison of two hand-maintained filter chains — which is precisely where
   *  the negative-net-worth defect lived. */
  const sumAssets = (
    rows: SideRow[],
    only?: readonly VersusMetricKey[],
  ): number =>
    rows
      .filter(
        (r) =>
          r.category &&
          r.category !== "debt" &&
          r.category !== "income" &&
          !NOT_A_METRIC.has(r.category) &&
          (!only || only.includes(r.category as VersusMetricKey)),
      )
      .reduce((acc, r) => acc + r.eur, 0);

  // A category leaves the card's ROWS for two different reasons, and the TOTAL must not
  // treat them alike — conflating them is what published a negative net worth.
  //
  //  UNPRICED (`dropped`) — the money is genuinely unknown, so it can enter no total, and
  //                         it leaves BOTH sides or the comparison is uneven.
  //  NOT ON THIS FORM     — the money IS declared and IS known; it simply cannot be a
  //                         comparable ROW (`real_estate` on an annual card, trap 2.4).
  //                         It stays IN the total.
  //
  // The first cut excluded both, so an annual card subtracted the WHOLE declared debt from
  // assets that omitted the declared property: −1,251,250 € published for a man whose own
  // filing nets −152,957 €, and 1,756 person-years driven negative the same way. 090's
  // person_wealth_year counts annual real-estate value in assets_eur; so does this now.
  const inTotal = (Object.keys(VERSUS_METRICS) as VersusMetricKey[]).filter(
    (k) => k !== "debt" && k !== "income" && !dropped.has(k),
  );
  // Declared, known, inside the total, but not shown as a row — the basis says so, rather
  // than letting the rows read as an exhaustive account of the number above them.
  const inTotalNotShown = [
    ...new Set(
      slugs.flatMap((sl) =>
        detail
          .filter(
            (r) =>
              r.slug === sl &&
              r.category &&
              inTotal.includes(r.category as VersusMetricKey) &&
              !metrics.includes(r.category as VersusMetricKey) &&
              r.eur !== 0,
          )
          .map((r) => r.category as VersusMetricKey),
      ),
    ),
  ];
  const excludedEur = Object.fromEntries(
    slugs.map((sl) => {
      const mine = detail.filter((r) => r.slug === sl);
      return [sl, sumAssets(mine) - sumAssets(mine, inTotal)];
    }),
  );

  const buildSide = (slug: string): VersusSide => {
    const mine = detail.filter((r) => r.slug === slug);
    const head = mine[0];
    const get = (k: string) => mine.find((r) => r.category === k);
    // Explicit zeros for every metric: the renderer refuses a side that omits one, because
    // "nothing declared" and "the query did not ask" render identically.
    const rows: VersusRow[] = metrics.map((key) => {
      const hit = get(key);
      const value = hit?.eur ?? 0;
      // NOT clamped to zero. Clamping the bar while the total summed the raw figure made a
      // card whose own rows did not add up to its own total, with nothing saying so. A
      // negative category sum is a parse anomaly worth seeing, so it is refused instead.
      if (value < 0)
        throw new Usage(
          `${slug} declares a negative total for "${key}" (${eur(value)}) — that is a parse ` +
            `anomaly, not a comparison. Inspect the filing before publishing.`,
        );
      return {
        key,
        value: eur(value),
        note: hit && hit.n > 0 && key !== "income" ? `${hit.n} бр.` : undefined,
        magnitude: value,
      };
    });
    // Over every category whose money is KNOWN — a superset of the displayed rows, so the
    // rows are a selected view of the total rather than its decomposition. The basis states
    // both halves; the only thing missing from the total is what nobody priced.
    const assets = sumAssets(mine, inTotal);
    // The WHOLE declared debt, always. Never gated on whether the debt row is displayed:
    // that gate published net = assets. See droppedMetrics' exemption above.
    const debts = get("debt")?.eur ?? 0;
    return {
      name: head.display_name,
      role:
        [head.position_title, head.institution].filter(Boolean).join(" · ") ||
        undefined,
      formLabel:
        picked.klass === "annual"
          ? "годишна декларация"
          : head.declaration_type === "Entry"
            ? "встъпителна декларация"
            : "декларация при напускане",
      formClass: picked.klass,
      rows,
      total: {
        label:
          (totalBasis === "net" ? "нетно" : "активи") +
          (dropped.size ? " (сравними позиции)" : ""),
        value: eur(totalBasis === "net" ? assets - debts : assets),
      },
    };
  };

  const latestOf = (s: string) =>
    Math.max(...avail.filter((r) => r.slug === s).map((r) => r.period_year));
  const isLatestForBoth =
    latestOf(slugA) === picked.year && latestOf(slugB) === picked.year;

  // The total is summed over the SHOWN metrics, so when any were dropped it is no longer
  // "all declared assets" and the basis line must not say it is. Naming the excluded
  // categories is also the honest disclosure of WHY: those tables were filed without prices.
  const label = (k: VersusMetricKey) => versusMetric(k)!.label;
  const totalWord = totalBasis === "net" ? "Нетно" : "Активи";
  const basisText =
    (totalBasis === "net"
      ? `${totalWord} = декларираните активи минус задълженията. Кредитните лимити не са задължение и не се броят.`
      : `${totalWord} = декларираното без задълженията и кредитните лимити.`) +
    (dropped.size
      ? ` Извън сумата: ${[...dropped].map(label).join(", ")} — подадени без посочена цена.`
      : "") +
    (inTotalNotShown.length
      ? ` В сумата, но не като отделен ред: ${inTotalNotShown.map(label).join(", ")}.`
      : "");

  const card: VersusCardSpec = {
    versus: { left: buildSide(slugA), right: buildSide(slugB) },
    year: picked.year,
    yearNote: isLatestForBoth
      ? undefined
      : `Най-скорошната година, в която и двамата подават ${
          picked.klass === "annual"
            ? "годишна декларация"
            : "декларация при встъпване или напускане"
        }.`,
    basis: basisText,
    metrics,
    source: "Източник: Сметна палата (register.cacbg.bg)",
  };

  const sourceUrls = Object.fromEntries(
    slugs.map((s) => [s, detail.find((r) => r.slug === s)!.source_url]),
  );
  const totals = Object.fromEntries(
    slugs.map((s) => {
      const mine = detail.filter((r) => r.slug === s);
      const assets = sumAssets(mine);
      const debts = mine.find((r) => r.category === "debt")?.eur ?? 0;
      // NOTE these run over EVERY category on the filing, including any metric dropped
      // above, so they can legitimately exceed the card's own total; `droppedMetrics`
      // says by how much and why.
      // Both bases, always — the ranking flips between them often enough that publishing
      // one without the other invites a claim the corpus does not support.
      return [
        s,
        { assetsEur: assets, debtsEur: debts, netEur: assets - debts },
      ];
    }),
  );

  const out = {
    gate: {
      slugs: { a: slugA, b: slugB },
      picked,
      isLatestForBoth,
      totalBasis,
      available: avail.map((r) => ({
        slug: r.slug,
        year: r.period_year,
        klass: r.klass,
        type: r.declaration_type,
      })),
      commonYears: common,
      unvalued,
      droppedMetrics,
      inTotal,
      inTotalNotShown,
      excludedEur,
      excludedCeilingRows: Object.fromEntries(
        slugs.map((sl) => [
          sl,
          detail
            .filter((r) => r.slug === sl)
            .reduce((acc, r) => acc + r.excluded_rows, 0),
        ]),
      ),
      sourceUrls,
      totals,
    },
    card,
  };

  // Preflight the spec through the renderer BEFORE writing anything. The card has a row
  // budget the gate does not model, so an 8-metric pair used to write --out, exit 0, and
  // only fail when somebody later tried to render it ("778px but only 766px are free").
  // Rows where BOTH sides declared nothing carry no information, so they are the ones to
  // shed; only if that is not enough does the refusal stand.
  const preflight = (spec: VersusCardSpec): VersusCardSpec => {
    const attempt = (m: VersusMetricKey[]): VersusCardSpec => ({
      ...spec,
      metrics: m,
      versus: {
        left: {
          ...spec.versus.left,
          rows: spec.versus.left.rows.filter((r) => m.includes(r.key)),
        },
        right: {
          ...spec.versus.right,
          rows: spec.versus.right.rows.filter((r) => m.includes(r.key)),
        },
      },
    });
    let trial = spec;
    const empties = spec.metrics.filter(
      (k) =>
        !ALWAYS.includes(k) &&
        spec.versus.left.rows.find((r) => r.key === k)!.magnitude === 0 &&
        spec.versus.right.rows.find((r) => r.key === k)!.magnitude === 0,
    );
    for (let i = 0; ; i++) {
      try {
        renderVersusCard(trial);
        if (i > 0)
          console.error(
            `row budget: dropped ${empties.slice(0, i).join(", ")} (both sides declared nothing)`,
          );
        return trial;
      } catch (e) {
        if (i >= empties.length) throw e;
        trial = attempt(
          spec.metrics.filter((k) => !empties.slice(0, i + 1).includes(k)),
        );
      }
    }
  };
  const finalCard = preflight(card);
  out.card = finalCard;

  return out;
};

const main = async (): Promise<void> => {
  const rawA = arg("--a");
  const rawB = arg("--b");
  if (!rawA || !rawB)
    throw new Usage("need --a and --b (a person slug or name)");

  const totalBasis = (arg("--total") ?? "net") as "net" | "assets";
  if (totalBasis !== "net" && totalBasis !== "assets")
    throw new Usage("--total must be `net` or `assets`");

  const rawYear = arg("--year");
  const year = rawYear === undefined ? undefined : Number(rawYear);
  if (year !== undefined && !Number.isInteger(year))
    throw new Usage(`--year must be a year, got "${rawYear}"`);

  const rawClass = arg("--class");
  if (
    rawClass !== undefined &&
    rawClass !== "annual" &&
    rawClass !== "inventory"
  )
    throw new Usage(
      `--class must be \`annual\` or \`inventory\`, got "${rawClass}"`,
    );

  // Validated rather than coerced: `Number("abc")/100` is NaN, every `share > NaN` is false,
  // and the whole unpriced-row gate turns itself off while reporting `dropped: []` — which
  // republished the fixture's 428x phantom property gap under a clean-looking basis line.
  const rawMax = arg("--max-unvalued-pct");
  const maxNum = Number(rawMax);
  if (
    rawMax !== undefined &&
    !(Number.isFinite(maxNum) && maxNum >= 0 && maxNum <= 100)
  )
    throw new Usage(
      `--max-unvalued-pct must be a number 0-100, got "${rawMax}"`,
    );

  const { gate, card } = await compareDeclarations({
    slugA: await resolvePerson(rawA),
    slugB: await resolvePerson(rawB),
    year,
    klass: rawClass as VersusFormClass | undefined,
    totalBasis,
    maxUnvaluedShare: rawMax === undefined ? undefined : maxNum / 100,
  });

  const json = JSON.stringify({ gate, card }, null, 2);
  const dest = arg("--out");
  if (dest) fs.writeFileSync(dest, `${json}\n`);
  else console.log(json);

  const g = gate as {
    picked: { year: number; klass: string };
    isLatestForBoth: boolean;
    droppedMetrics: {
      metric: string;
      slug: string;
      unvalued: number;
      rows: number;
    }[];
    inTotalNotShown: string[];
    excludedEur: Record<string, number>;
    totals: Record<
      string,
      { assetsEur: number; debtsEur: number; netEur: number }
    >;
  };
  const money = (n: number): string =>
    `${Math.round(n).toLocaleString("bg-BG").replace(/\s/g, "\u00a0")}\u00a0€`;
  if (g.droppedMetrics.length)
    console.error(
      "dropped for unpriced rows: " +
        g.droppedMetrics
          .map((u) => `${u.metric} (${u.slug} ${u.unvalued}/${u.rows})`)
          .join(", ") +
        " — total excludes " +
        Object.entries(g.excludedEur)
          .map(([sl, v]) => `${sl} ${money(v)}`)
          .join(", "),
    );
  if (g.inTotalNotShown.length)
    console.error(
      `in the total but not a row: ${g.inTotalNotShown.join(", ")}`,
    );
  console.error(
    `gate: ${g.picked.year} / ${g.picked.klass}` +
      `${g.isLatestForBoth ? "" : "  (NOT the latest year for both — the card says so)"}\n` +
      Object.entries(g.totals)
        .map(
          ([sl, t]) =>
            `  ${sl}  активи ${money(t.assetsEur)} · задължения ${money(t.debtsEur)} · нетно ${money(t.netEur)}`,
        )
        .join("\n"),
  );
};

// Only when run as the CLI — importing this module (the data test does) must not execute it.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .catch((e) => {
      console.error(
        `compare_declarations: ${e instanceof Error ? e.message : e}`,
      );
      // 2 = a verdict about the data or a misuse of the flags; 1 = the tool broke.
      process.exitCode = e instanceof Usage ? 2 : 1;
    })
    .finally(() => end());
}
