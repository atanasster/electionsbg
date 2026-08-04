// НЗОК НРД pathway tariffs — the per-КП/АПр/КПр prices in the contract body
// (чл. 368/369/370, re-tabled as …б/в by each amendment agreement) on the НРД
// medical page. A flip = a new НРД or amendment PDF landed → its price tables
// may re-set the tariffs → re-run write_pathway_tariffs.ts against the new
// document (--annex, --bgn pre-2026) and reload with db:load:nzok-tariffs:pg
// (+ :cloud). See gaps plan T4 / reference_nzok_pathway_tariffs: there is NO
// separate price annex — the contract documents ARE the source.
//
// The page listing is small and the contract-era URL moves (nrd/2023-2025 →
// nrd/2026-… on renewal), so the fingerprint covers BOTH the current era page
// and the НРД hub: a renewal shows up as a new era link on the hub even before
// anyone updates ERA_PAGE here.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";

const HUB = "https://www.nhif.bg/bg/nrd";
const ERA_PAGE = "https://www.nhif.bg/bg/nrd/2023-2025/medical";
const UA = "electionsbg.com data pipeline";

/** The НРД contract/amendment PDF hrefs on the era page + the era links on the
 *  hub — DECODED and sorted, so the hash is stable against re-encoding churn.
 *  Same anchor criteria as the writer's findAnnexHrefs, deliberately: the two
 *  must agree on what counts as a contract document. */
const contractSet = async (): Promise<string[]> => {
  const out = new Set<string>();
  const eraRes = await fetch(ERA_PAGE, { headers: { "User-Agent": UA } });
  if (!eraRes.ok) throw new Error(`GET ${ERA_PAGE} → ${eraRes.status}`);
  const eraHtml = await eraRes.text();
  const linkRe = /<a[^>]+href="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(eraHtml))) {
    // Guarded decode: one malformed %-sequence in a scraped href must not kill
    // the whole fingerprint (the hazard mh_eeof_quarterly.ts documents).
    let name = m[1];
    try {
      name = decodeURIComponent(m[1]);
    } catch {
      /* keep the raw href */
    }
    if (
      /\.pdf$/i.test(name) &&
      /рамков\s+договор|изменение\s+и\s+допълнение\s+на\s+Н/i.test(name)
    )
      out.add(name);
  }
  if (out.size === 0)
    throw new Error(
      "nzok_nrd_tariffs: no НРД contract PDFs found on the era page — layout changed or the era moved",
    );
  const hubRes = await fetch(HUB, { headers: { "User-Agent": UA } });
  if (hubRes.ok) {
    const hubHtml = await hubRes.text();
    // Both era shapes: multi-year (2023-2025) and a possible single-year
    // renewal; only the modern-era pages (2019+) are signal — the historic
    // yearly pages are stable noise.
    const eraRe = /href="(\/bg\/nrd\/(20\d{2})(?:-20\d{2})?)"/gi;
    while ((m = eraRe.exec(hubHtml))) if (Number(m[2]) >= 2019) out.add(m[1]);
  }
  return [...out].sort();
};

/** The newest contract document = the one with the highest /upload/<id>/ —
 *  nhif.bg's upload ids are monotonic, unlike the lexicographic order of the
 *  decoded names. */
const newestUpload = (set: string[]): string | null => {
  let best: { id: number; href: string } | null = null;
  for (const href of set) {
    const m = /\/upload\/(\d+)\//.exec(href);
    if (m && (!best || Number(m[1]) > best.id))
      best = { id: Number(m[1]), href };
  }
  return best?.href ?? null;
};

export const nzokNrdTariffs: WatchSource = {
  id: "nzok_nrd_tariffs",
  label: "НЗОК — НРД цени на КП/АПр/КПр (договор + изменения)",
  url: ERA_PAGE,
  cadence: "monthly",
  // A new НРД lands every ~3 years, amendments roughly yearly.
  publishes: "annual",

  async fingerprint(): Promise<Fingerprint> {
    const set = await contractSet();
    return {
      value: createHash("sha256").update(set.join("\n")).digest("hex"),
      detail: `${set.length} НРД contract/era links`,
      meta: { count: set.length, newest: newestUpload(set) },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    const n = (curr.meta?.count as number) ?? 0;
    if (!prev) return `first run · ${n} НРД contract/era links`;
    const was = (prev.meta?.count as number) ?? "?";
    const newest = (curr.meta?.newest as string) ?? "?";
    return (
      `НРД contract set changed (${n} links, was ${was}; newest ${newest}) — a new ` +
      "НРД/amendment may re-set the pathway tariffs: re-run write_pathway_tariffs.ts + db:load:nzok-tariffs:pg"
    );
  },
};
