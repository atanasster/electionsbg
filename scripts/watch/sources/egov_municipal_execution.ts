// data.egov.bg — municipal cash-execution (касово изпълнение по ЕБК).
//
// A handful of общини publish a MINFIN B3 ЕБК execution report per fiscal year
// to the portal. We track the covered set (Русе, Николаево) and fingerprint
// each muni's portal-hosted execution resources by (year → updated_at). A new
// year, or a re-upload of an existing year (year-end revision lands in T+1),
// surfaces and prompts /update-budget → the municipal_execution ingest.
//
// Unlike the per-município capital-programme watcher (which HEADs hand-curated
// município-site URLs that change every year), this reads the portal's stable
// dataset listing via the JSON API, so it doesn't break when a publisher
// reshuffles its file URLs.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { sha256Short } from "../fingerprint";
import { listDatasets } from "../../budget/lib/egov_api";

// Keep in sync with the REGISTRY in
// scripts/budget/municipal_execution/ingest.ts.
const MUNIS: Array<{ slug: string; orgId: number; pref: RegExp }> = [
  { slug: "ruse", orgId: 157, pref: /Данни за бюджет\s+20\d{2}/i },
  { slug: "nikolaevo", orgId: 281, pref: /Отчет за касово изпълнение/i },
];

const EXEC_RE = /касово изпълнение|разходването му|изпълнението на бюджета/i;

export const egovMunicipalExecution: WatchSource = {
  id: "egov_municipal_execution",
  label: "data.egov.bg общински бюджети (касово изпълнение по ЕБК)",
  url: "https://data.egov.bg/organisation/dataset",
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const signatures: Record<string, string> = {};
    for (const muni of MUNIS) {
      const datasets = await listDatasets(muni.orgId);
      for (const ds of datasets) {
        for (const r of ds.resources) {
          if (r.resource_url != null) continue;
          const hay = `${r.name} ${ds.name}`;
          if (!muni.pref.test(hay) && !EXEC_RE.test(hay)) continue;
          const ym = r.name.match(/20\d{2}/) ?? ds.name.match(/20\d{2}/);
          if (!ym) continue;
          const key = `${muni.slug}/${ym[0]}`;
          // Prefer the newest updated_at if a year has several candidates.
          if (!signatures[key] || r.updated_at > signatures[key]) {
            signatures[key] = r.updated_at;
          }
        }
      }
    }
    const keys = Object.keys(signatures).sort();
    if (keys.length === 0) {
      throw new Error("no portal-hosted municipal execution resources found");
    }
    const value = sha256Short(
      keys.map((k) => `${k}=${signatures[k]}`).join("|"),
    );
    return {
      value,
      detail: `${keys.length} muni-year execution report(s) tracked · hash ${value}`,
      meta: { signatures },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevSigs = (prev.meta?.signatures as Record<string, string>) ?? {};
    const currSigs = (curr.meta?.signatures as Record<string, string>) ?? {};
    const added = Object.keys(currSigs).filter((k) => !(k in prevSigs));
    const changed = Object.keys(currSigs).filter(
      (k) => prevSigs[k] != null && prevSigs[k] !== currSigs[k],
    );
    if (added.length > 0) {
      return (
        `${added.length} new muni-year execution report(s): ${added.join(", ")} ` +
        `— run /update-budget (tsx scripts/budget/municipal_execution/ingest.ts --all)`
      );
    }
    if (changed.length > 0) {
      return (
        `${changed.length} execution report(s) re-uploaded: ${changed.join(", ")} ` +
        `— re-run tsx scripts/budget/municipal_execution/ingest.ts --all`
      );
    }
    return `${curr.detail} (resource set unchanged)`;
  },
};
