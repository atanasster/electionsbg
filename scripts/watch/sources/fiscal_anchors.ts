// Bulgarian-fiscal and behavioral anchors of the budget policy simulator
// that live as sourced constants in code, not in pipeline-built JSON:
//  - src/lib/bgFiscalProjection.ts — the 2025 ESA outturn anchors (deficit/
//    debt/GDP from the НСИ EDP notification);
//  - src/lib/bgBehavioral.ts — the dynamic-mode elasticities (EC VAT gap,
//    IMF multipliers) and the dividend calibration target (Фискален съвет).
// Four probes watch their upstreams; all four map to MANUAL edits in
// process-watch-report (there is no automated ingest — the constants carry
// editorial notes that need a human). Companion to eu_policy_anchors.ts.

import { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchJson, fetchText, sha256Short } from "../fingerprint";

// ---------------------------------------------------------------------------
// 1) НСИ EDP notification — the ESA deficit/debt/GDP outturn anchors.
// The "Държавен дефицит/излишък по подсектори" content page lists every GFS
// press release with a monotonically growing numeric id in the slug; a new
// notification (April/October) appends a new id.
// ---------------------------------------------------------------------------

const NSI_GFS_URL = "https://www.nsi.bg/bg/content/2432/";
// The press-release id is the LAST numeric segment of the slug (slugs also
// carry years like "...prez-2025-godina-9533"), so the match is anchored at
// the closing quote and keyword-filtered afterwards.
const NSI_SLUG_RE = /press-release\/([a-z0-9-]+)-(\d+)["/]/g;
const NSI_KEYWORDS = /deficit|dalg|darjavno|notifikacionni/;

export const nsiEdp: WatchSource = {
  id: "nsi_edp",
  label: "НСИ EDP notification — deficit/debt outturn",
  url: NSI_GFS_URL,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(NSI_GFS_URL);
    if (!html) throw new Error("empty НСИ GFS page");
    let latestId = 0;
    let latestSlug = "";
    for (const m of html.matchAll(NSI_SLUG_RE)) {
      if (!NSI_KEYWORDS.test(m[1])) continue;
      const id = Number(m[2]);
      if (id > latestId) {
        latestId = id;
        latestSlug = `${m[1]}-${m[2]}`;
      }
    }
    if (!latestId)
      throw new Error("no EDP press-release slugs on the НСИ GFS page");
    return {
      value: String(latestId),
      detail: `latest GFS press release: ${latestSlug}`,
      meta: { slug: latestSlug },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    return `new EDP notification (${curr.meta?.slug}) — update the 2025/2026 ESA anchors (deficit, debt, GDP) in src/lib/bgFiscalProjection.ts and re-run __smoke_fiscal_projection.ts + __smoke_behavioral.ts`;
  },
};

// ---------------------------------------------------------------------------
// 2) EC VAT gap report — the level anchor of the simulator's VAT compliance
// response (VAT_GAP_RESPONSE in bgBehavioral.ts). The page names the current
// edition ("VAT Gap Report 2025"); a new year token = a new edition.
// ---------------------------------------------------------------------------

const EC_VAT_GAP_URL =
  "https://taxation-customs.ec.europa.eu/taxation/vat/fight-against-vat-fraud/vat-gap_en";

export const ecVatGap: WatchSource = {
  id: "ec_vat_gap",
  label: "EC VAT gap report",
  url: EC_VAT_GAP_URL,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(EC_VAT_GAP_URL);
    if (!html) throw new Error("empty EC VAT gap page");
    const years = [...html.matchAll(/VAT Gap Report\s+(20\d{2})/gi)].map((m) =>
      Number(m[1]),
    );
    if (!years.length)
      throw new Error("no VAT Gap Report edition token on the EC page");
    const latest = Math.max(...years);
    return {
      value: String(latest),
      detail: `latest edition: VAT Gap Report ${latest}`,
      meta: { edition: latest },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    return `${prev.fingerprint} → ${curr.value} — re-read the BG gap (level + share of VTTL) and re-verify VAT_GAP_RESPONSE in src/lib/bgBehavioral.ts; re-run __smoke_behavioral.ts`;
  },
};

// ---------------------------------------------------------------------------
// 3) IMF WEO vintage for Bulgaria — the watchable IMF signal (the country
// page and Article IV catalog are bot-blocked, the DataMapper API is open).
// A new WEO vintage (April/October) moves the projection values; that is the
// cue to re-check the IMF anchors behind the Tier-2 multipliers.
// ---------------------------------------------------------------------------

const IMF_DM_URL =
  "https://www.imf.org/external/datamapper/api/v1/NGDP_RPCH/BGR";

interface ImfDmResponse {
  values?: { NGDP_RPCH?: { BGR?: Record<string, number> } };
}

export const imfWeoBg: WatchSource = {
  id: "imf_weo_bg",
  label: "IMF WEO — Bulgaria vintage",
  url: IMF_DM_URL,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const json = await fetchJson<ImfDmResponse>(IMF_DM_URL);
    const series = json?.values?.NGDP_RPCH?.BGR;
    if (!series || !Object.keys(series).length)
      throw new Error("no BGR series in the IMF DataMapper response");
    const years = Object.keys(series).sort();
    const lastYear = years[years.length - 1];
    const value = sha256Short(JSON.stringify(series));
    return {
      value,
      detail: `BGR real-growth series through ${lastYear} (latest ${series[lastYear]}%) · ${value}`,
      meta: { lastYear, lastValue: series[lastYear] },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    return `new WEO vintage for Bulgaria (through ${curr.meta?.lastYear}) — re-verify the IMF anchors (MULT_* multipliers, WP/13/49 context) in src/lib/bgBehavioral.ts; re-run __smoke_behavioral.ts`;
  },
};

// ---------------------------------------------------------------------------
// 4) Фискален съвет — publications list. The opinions are the simulator's
// benchmark column (and the dividend lever's calibration target ≤ €50M). A
// new becoming-relevant становище should refresh the bench strings and the
// grounding doc.
// ---------------------------------------------------------------------------

const FC_URL = "https://www.fiscal-council.bg/bg/publikacii";

export const fiscalCouncilBg: WatchSource = {
  id: "fiscal_council_bg",
  label: "Фискален съвет — publications",
  url: FC_URL,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(FC_URL);
    if (!html) throw new Error("empty Фискален съвет publications page");
    const slugs = [
      ...new Set(
        [...html.matchAll(/href="\/bg\/publikacii\/([a-z0-9-]+)"/g)].map(
          (m) => m[1],
        ),
      ),
    ];
    if (!slugs.length)
      throw new Error("no publication slugs on the Фискален съвет page");
    // Page order is newest-first; the first 20 slugs are the change signal.
    const window = slugs.slice(0, 20);
    return {
      value: sha256Short(JSON.stringify(window)),
      detail: `${slugs.length} publication(s) · latest: ${window[0]}`,
      meta: { latest: window[0] },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    return `new Фискален съвет publication: ${curr.meta?.latest} — if it costs a simulator lever, refresh the benchmark table in the methodology article (public/articles/2026-06-12-tax-policy-simulator-*.md), docs/budget_simulator_grounding.md and (for dividend-style costings) the calibration target in src/lib/bgBehavioral.ts`;
  },
};
