// ДС / COMDOS — the Комисия по досиетата (comdos.bg) решения list (the `ds` facet on the
// person layer, plan §5 T1). The Commission publishes официални решения establishing the
// affiliation of Bulgarian citizens to State Security / БНА intelligence to public office.
//
// There is NO bulk export / API — comdos.bg exposes only a per-person search FORM and a
// per-organisation решения archive, and the person-relevant решения (МП/magistrate/media
// verdicts) are historical (e.g. решение № 14 / 04.09.2007). So, like transparency_cpi,
// data/person/ds.json is a HAND-CURATED register and this watcher is a lightweight
// best-effort fingerprint of the решения archive page — it flips when the Commission
// publishes new решения, telling the operator WHEN to look and re-review the curated
// register (the `update-persons` skill). Every attach is hand-verified per person because
// naming the WRONG same-named person a State Security collaborator is a serious accusation
// (see the skill's defamation rule).
//
// Best-effort: the archive is HTML that may be Cloudflare-walled / JS-rendered from some
// egress. A fetch failure degrades to a stable sentinel fingerprint (no false "changed"),
// so the source stays quiet rather than flapping — the register is manual regardless.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText, sha256Short } from "../fingerprint";

// The решения archive (latest решения, numbered N-MMM with a date). Cyrillic path,
// URL-encoded.
const ARCHIVE =
  "https://comdos.bg/%D0%9D%D0%B0%D1%87%D0%B0%D0%BB%D0%BE/%D0%90%D1%80%D1%85%D0%B8%D0%B2_%D0%A0%D0%B5%D1%88%D0%B5%D0%BD%D0%B8%D1%8F";

// Decision references look like "3-135", "2-1600" etc. Fingerprint the SET of решение ids
// on the archive page — robust to reordering, flips on any new решение.
const DECISION_RE = /\b\d-\d{2,4}\b/g;

export const comdosDs: WatchSource = {
  id: "comdos_ds",
  label: "Комисия по досиетата (comdos.bg) — решения (ДС facet)",
  url: ARCHIVE,
  cadence: "monthly",
  async fingerprint(): Promise<Fingerprint> {
    let html: string;
    try {
      html = await fetchText(ARCHIVE);
    } catch {
      // Unreachable from this egress (Cloudflare / geo) — stay quiet, the register is
      // manually curated anyway. A stable sentinel avoids false "changed" flips.
      return {
        value: "manual",
        detail: "comdos.bg unreachable — data/person/ds.json curated manually",
        meta: { count: 0 },
      };
    }
    const ids = [...new Set(html.match(DECISION_RE) ?? [])].sort();
    if (ids.length === 0) {
      return {
        value: "manual",
        detail: "no решения parsed — data/person/ds.json curated manually",
        meta: { count: 0 },
      };
    }
    return {
      value: `${ids.length}:${sha256Short(ids.join(","))}`,
      detail: `${ids.length} решение(я) on the comdos.bg archive`,
      meta: { count: ids.length },
    };
  },
  describe(prev: WatchState | null, curr: Fingerprint): string {
    const before = (prev?.meta?.count as number | undefined) ?? null;
    const now = (curr.meta?.count as number | undefined) ?? null;
    if (before != null && now != null && before !== now)
      return `comdos.bg решения ${before} → ${now} — review data/person/ds.json (update-persons)`;
    return `${curr.detail} — review data/person/ds.json (update-persons)`;
  },
};
