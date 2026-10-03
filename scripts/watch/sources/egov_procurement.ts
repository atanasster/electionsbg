// data.egov.bg АОП (Агенция по обществени поръчки) — public-procurement
// open-data. АОП publishes in two shapes: OCDS-standard bundles (consumed by
// the OCDS ingester — one dataset per fortnight until 2026-06-03, since then
// one dataset per MONTH holding one resource per day) and annual
// contracts CSVs ("Договори и изменения на договори - YYYY" — consumed by the
// legacy ingester). We fingerprint page 1 of the org's dataset listing
// (newest-first by upload) and classify each entry by its <h2> title, so the
// report can tell a new OCDS dataset (auto-ingested) apart from a new
// annual CSV (needs the legacy-discovery path). The CKAN-style /api endpoints
// on data.egov.bg are broken (return success:false), so we parse HTML.
//
// A monthly dataset GAINS daily resources without its UUID moving, so the
// page-1 UUID set alone would flip once a month. The fingerprint therefore
// also carries the newest resource of the newest OCDS dataset (its detail
// page lists resources newest-first).

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText, sha256Short } from "../fingerprint";

const AOP_ORG_ID = 502;
const PAGE = `https://data.egov.bg/data?org%5B0%5D=${AOP_ORG_ID}&page=1`;

type DatasetKind = "ocds" | "annual" | "other";

interface ClassifiedDataset {
  uuid: string;
  kind: DatasetKind;
  // For annual CSVs: the year token ("2024", or "2024-RL" for the РОП variant).
  year?: string;
}

// Classify a dataset by its listing <h2> title. OCDS fortnight bundles read
// "...съгласно стандарт OCDS"; the annual in-scope contracts dump reads
// exactly "Договори и изменения на договори - YYYY (информация от ЦАИС ЕОП |
// РОП)". The specific phrase keeps the out-of-scope "извън приложното поле"
// and amendments-only "annexes" dumps classified as "other".
const classifyTitle = (title: string): { kind: DatasetKind; year?: string } => {
  if (/стандарт\s+OCDS/i.test(title)) return { kind: "ocds" };
  const m = title.match(
    /договори\s+и\s+изменения\s+на\s+договори\s*[-–—]\s*(20\d{2})\b/i,
  );
  if (m) {
    const year = /\bРОП\b/i.test(title) ? `${m[1]}-RL` : m[1];
    return { kind: "annual", year };
  }
  return { kind: "other" };
};

// Each listing row is <a href=".../data/view/UUID"><h2>TITLE</h2></a>.
// Social-share links carry the same UUID but no <h2>, so this skips them.
const parseDatasets = (html: string): ClassifiedDataset[] => {
  const re =
    /<a[^>]*href="https?:\/\/data\.egov\.bg\/data\/view\/([0-9a-f-]{36})"[^>]*>\s*<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  const out: ClassifiedDataset[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({
      uuid: m[1],
      ...classifyTitle(m[2].replace(/\s+/g, " ").trim()),
    });
  }
  return out;
};

// First resourceView link on a dataset detail page + its label.
export const parseTopResource = (
  html: string,
): { uuid: string; label: string } | null => {
  const m = html.match(
    /resourceView\/([0-9a-f-]{36})"[\s\S]*?class="version">([^<]*)</i,
  );
  if (!m) return null;
  return {
    uuid: m[1],
    label: m[2]
      .replace(/&nbsp;|&#8211;/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  };
};

export const egovProcurement: WatchSource = {
  id: "egov_procurement",
  label: "data.egov.bg АОП (Агенция по обществени поръчки)",
  url: PAGE,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(PAGE);
    if (!html) throw new Error("empty АОП dataset listing");
    // `value` keeps the original UUID-set hash so the change signal is
    // unaffected by the classification added below.
    const uuids = Array.from(html.matchAll(/\/data\/view\/([0-9a-f-]{36})/gi))
      .map((m) => m[1])
      .filter((u, i, arr) => arr.indexOf(u) === i);
    if (uuids.length === 0) {
      throw new Error("АОП dataset listing yielded zero dataset UUIDs");
    }
    const datasets = parseDatasets(html);
    const newestOcds = datasets.find((d) => d.kind === "ocds");
    let latestOcdsResource: { uuid: string; label: string } | null = null;
    if (newestOcds) {
      const detail = await fetchText(
        `https://data.egov.bg/data/view/${newestOcds.uuid}`,
      );
      // null is legitimate: a new month's dataset can exist before its
      // first daily resource does. The UUID set still flips on it.
      latestOcdsResource = detail ? parseTopResource(detail) : null;
    }
    const value = sha256Short(
      uuids.join(",") +
        (latestOcdsResource ? `|${latestOcdsResource.uuid}` : ""),
    );
    return {
      value,
      detail:
        `${uuids.length} datasets on page 1` +
        (latestOcdsResource
          ? `, latest OCDS resource „${latestOcdsResource.label}"`
          : "") +
        `, hash ${value}`,
      meta: {
        topUuids: uuids.slice(0, 5),
        count: uuids.length,
        datasets,
        latestOcdsResource,
      },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const currDs =
      (curr.meta?.datasets as ClassifiedDataset[] | undefined) ?? [];
    const prevDs =
      (prev.meta?.datasets as ClassifiedDataset[] | undefined) ?? [];
    // State files written before classification existed only carried
    // topUuids — fall back to those so the first run still narrates.
    const prevUuids = new Set(
      prevDs.length
        ? prevDs.map((d) => d.uuid)
        : ((prev.meta?.topUuids as string[] | undefined) ?? []),
    );
    const fresh = currDs.filter((d) => !prevUuids.has(d.uuid));
    const prevTop = prev.meta?.latestOcdsResource as
      | { uuid: string }
      | null
      | undefined;
    const currTop = curr.meta?.latestOcdsResource as
      | { uuid: string; label: string }
      | null
      | undefined;
    const newResource =
      currTop != null && prevTop?.uuid !== currTop.uuid
        ? `new OCDS daily resource(s), latest „${currTop.label}"`
        : null;
    if (fresh.length === 0)
      return newResource ?? `${curr.detail} (UUIDs rotated below the top)`;
    const parts: string[] = [];
    if (newResource) parts.push(newResource);
    const ocds = fresh.filter((d) => d.kind === "ocds");
    const annual = fresh.filter((d) => d.kind === "annual");
    const other = fresh.filter((d) => d.kind === "other");
    if (ocds.length) parts.push(`${ocds.length} new OCDS dataset(s) on top`);
    if (annual.length) {
      const years = annual.map((d) => d.year ?? "?").join(", ");
      parts.push(
        `${annual.length} new annual contracts dataset(s) [${years}] — ` +
          `needs the legacy-discovery ingest, not the OCDS path`,
      );
    }
    if (other.length)
      parts.push(`${other.length} new non-contracts dataset(s)`);
    return parts.join("; ");
  },
};
