// Build-time enumeration of the /pension-fund/:slug pages, for the SEO
// prerender AND the sitemap.
//
// Unlike /court/**, this family is FILE-backed: data/budget/kfn/funds.json is a
// committed durable series store (the КФН archive retains quarters since T5a),
// so this is a plain fs read rather than a Postgres query — the buildSchoolRoutes
// template rather than the seo_settlements one.
//
// It still exists as ONE module for the same reason seo_courts.ts does: the
// prerender and the sitemap must agree on which slugs are servable, and a gate
// that lives in two copies is how a sitemap grows <loc>s with no file behind
// them. Everything family-specific — the slug, the per-fund series, the gate —
// is derived here once.

import fs from "fs";
import path from "path";
import { isCrawlableFund, kfnFundSlug } from "@/lib/kfnFundSlug";
import { byKfnPeriod } from "@/lib/kfnPeriod";

export const KFN_FUNDS_FILE = "data/budget/kfn/funds.json";

type KfnFundRow = {
  pillar: string;
  pillarLabelBg: string;
  pillarLabelEn: string;
  pillarNumber?: number;
  fundName?: string;
  companyBg: string;
  companyEn: string;
  insured: number | null;
  netAssetsBgn?: number | null;
  netAssetsEur: number | null;
};

type KfnPeriod = {
  period: string;
  periodLabel: string;
  funds: KfnFundRow[];
};

export type SeoPensionFund = {
  slug: string;
  pillar: string;
  pillarLabelBg: string;
  pillarLabelEn: string;
  companyBg: string;
  companyEn: string;
  insured: number | null;
  netAssetsEur: number | null;
  /** Share of the fund's OWN pillar — a ДПФ and a УПФ are not comparable. */
  pillarSharePct: number | null;
  /** The fund's own latest quarter, which is not necessarily the archive's: a
   *  fund that closed shows its last filing. Mirrors useKfnFund. */
  latestPeriod: string;
  latestPeriodLabel: string;
  /** Quarters this fund actually appears in — never padded. */
  quarters: number;
  firstPeriodLabel: string | null;
  /** Growth across the fund's own window. Null for TWO different reasons —
   *  fewer than two quarters (where `first` IS `latest` and the figure would
   *  read "+0.0%"), or a first quarter that reported no assets, where the
   *  percentage is undefined. Use `firstPeriodLabel == null` to tell them
   *  apart: a caller that conflates them says "only one quarter in the archive"
   *  about a fund with five. */
  growthPct: number | null;
  /** The company's other funds in the same quarter. */
  siblings: { slug: string; pillar: string }[];
};

/**
 * Every pension fund with a servable `/pension-fund/:slug` page, ordered by the
 * latest quarter's net assets (largest first).
 *
 * Returns `[]` when the archive is missing or unparseable — a fresh clone before
 * `npm run noi:kfn` — so the family is omitted rather than the build aborting,
 * matching the PG-backed readers' contract.
 */
export const readSeoPensionFunds = (projectRoot: string): SeoPensionFund[] => {
  const file = path.join(projectRoot, KFN_FUNDS_FILE);
  if (!fs.existsSync(file)) return [];
  let payload: { latestPeriod?: string; periods?: KfnPeriod[] };
  try {
    payload = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
  const periods = (payload.periods ?? []).filter((p) => p?.period);
  if (!periods.length) return [];
  // Ascending, so `series[last]` is the fund's newest filing regardless of the
  // order the ingest happened to append them in. Shared with the hook that
  // serves the live page (useKfnFund), which read array order — so a re-ingest
  // appending an older quarter would have made the prerendered description name
  // a different quarter from the page, silently.
  periods.sort(byKfnPeriod);

  // Every slug that appears anywhere in the archive, so a fund that closed
  // before the latest quarter still gets its page (its own last filing is the
  // headline) — the same rule useKfnFund applies.
  const bySlug = new Map<string, { period: KfnPeriod; row: KfnFundRow }[]>();
  const degenerate = new Set<string>();
  for (const period of periods) {
    for (const row of period.funds ?? []) {
      if (!row?.pillar || !row?.companyEn) continue;
      const slug = kfnFundSlug(row.pillar, row.companyEn);
      if (!isCrawlableFund(slug, row.pillar)) {
        degenerate.add(`${row.pillar}/${row.fundName ?? row.companyEn}`);
        continue;
      }
      const series = bySlug.get(slug) ?? [];
      series.push({ period, row });
      bySlug.set(slug, series);
    }
  }
  if (degenerate.size) {
    // A degenerate slug is two unmapped funds colliding onto one URL, which
    // would blend their series into one trend. Skipping is right; skipping
    // SILENTLY is how a fund disappears from a green build.
    console.warn(
      `[seo] pension funds: ${degenerate.size} fund(s) have no mappable company and were skipped: ${[
        ...degenerate,
      ]
        .slice(0, 10)
        .join(", ")}`,
    );
  }

  const out: SeoPensionFund[] = [];
  for (const [slug, series] of bySlug) {
    const latest = series[series.length - 1];
    const first = series[0];
    const row = latest.row;
    // A fund whose latest filing carries no assets figure has nothing to put on
    // a page: every headline, the pillar share and the trend all derive from it,
    // and coalescing to zero would publish "€0 in net assets" as a fact.
    if (row.netAssetsEur == null) continue;
    const sameQuarter = latest.period.funds ?? [];
    const pillarTotal = sameQuarter
      .filter((f) => f.pillar === row.pillar)
      .reduce((sum, f) => sum + (f.netAssetsEur ?? 0), 0);
    const firstAssets = first.row.netAssetsEur ?? 0;
    out.push({
      slug,
      pillar: row.pillar,
      pillarLabelBg: row.pillarLabelBg,
      pillarLabelEn: row.pillarLabelEn,
      companyBg: row.companyBg,
      companyEn: row.companyEn,
      insured: row.insured ?? null,
      netAssetsEur: row.netAssetsEur ?? null,
      pillarSharePct:
        pillarTotal > 0 ? ((row.netAssetsEur ?? 0) / pillarTotal) * 100 : null,
      latestPeriod: latest.period.period,
      latestPeriodLabel: latest.period.periodLabel,
      quarters: series.length,
      firstPeriodLabel: series.length >= 2 ? first.period.periodLabel : null,
      // >= 2 quarters, not merely a positive first value: on a single-quarter
      // archive `first` IS `latest` and the figure reads "+0.0% since 2026 Q1".
      growthPct:
        series.length >= 2 && firstAssets > 0
          ? ((row.netAssetsEur ?? 0) / firstAssets - 1) * 100
          : null,
      siblings: sameQuarter
        .filter((f) => f.companyEn === row.companyEn && f.pillar !== row.pillar)
        .map((f) => ({
          slug: kfnFundSlug(f.pillar, f.companyEn),
          pillar: f.pillar,
        }))
        .filter((s) => isCrawlableFund(s.slug, s.pillar)),
    });
  }
  return out.sort(
    (a, b) =>
      (b.netAssetsEur ?? 0) - (a.netAssetsEur ?? 0) ||
      a.slug.localeCompare(b.slug),
  );
};
