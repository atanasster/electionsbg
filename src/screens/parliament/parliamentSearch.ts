// The /parliament finder's sources — pure data, no JSX.
//
// The hub fronts eleven tiles over a corpus of 16,741 roll-call items and 2,120 members. A
// reader who arrives knowing what they want — a name, „бюджет 2026" — had to guess which
// tile contained it.
//
// ===========================================================================
// TWO SUBJECTS, TWO SHAPES, AND THE SAME SCOPE RULE.
//
// MEMBERS are a client index: the roster is already fetched by this hub's neighbours, it is
// 2,120 rows, and folding it once at build time makes a keystroke one indexOf.
//
// TOPICS are server-backed: topic_index.json is 8 MB and a session file is 482 KB on an
// average day, so there is nothing to download. /api/db/vote-item-search answers an
// ns-scoped title search in 182 buffers.
//
// BOTH SPLIT BY THE SELECTED PARLIAMENT, and the split RANKS rather than filters. A reader
// on the 52nd searching „Борисов" must still find him if he sat in the 44th, and a reader
// looking for a 2015 budget vote must still find it — below the current parliament's, in a
// group that says why. Each half is its own source with its own corpus and its own cap, so
// the out-of-scope group cannot be starved by an in-scope prefix.
// ===========================================================================

import { FileText, Users } from "lucide-react";
import type { SearchItem } from "@/ux/search/EntitySearchTile";
import {
  scopedSources,
  type HubSearchSource,
  type IndexSource,
  type ServerSource,
} from "@/ux/search/hubSearchSources";
import { buildEntityIndex, type EntityIndex } from "@/lib/entitySearchIndex";
import { candidateUrlForMp } from "@/data/candidates/candidateSlug";
import type { MpIndexEntry } from "@/data/parliament/useMps";

interface VoteItemHit {
  itemId: number;
  ns: number;
  date: string;
  title: string;
  topic: string | null;
}
interface VoteItemResponse {
  items?: VoteItemHit[];
  altQuery?: string | null;
}

/** Both name forms, so „Пехливанова" and "Pehlivanova" both find her — the roster carries a
 *  normalized Bulgarian and a normalized English form for exactly this. */
const mpIndex = (mps: MpIndexEntry[], bg: boolean): EntityIndex =>
  buildEntityIndex(
    mps,
    (mp) => ({
      id: String(mp.id),
      label: bg ? mp.name : mp.name_en,
      sub:
        [mp.currentPartyGroupShort, mp.currentRegion?.name]
          .filter(Boolean)
          .join(" · ") || undefined,
      href: candidateUrlForMp(mp.id),
    }),
    (mp) => [mp.name, mp.name_en, mp.normalizedName, mp.normalizedName_en],
    // Currently-seated members first. `searchIndex` stops at its cap in RANK order, so a
    // common surname shows the sitting Иванови before members who left three parliaments
    // ago — within each group, which is a different axis from the scope split below.
    (mp) => (mp.isCurrent ? 1 : 0),
  );

// NO "see all" ON THE TOPICS GROUP, deliberately.
//
// A first draft linked it to /votes?q=<query>. That page (SessionsIndexScreen) reads only
// ?topic — a text query is silently discarded and the reader lands on the undifferentiated
// list of every sitting. It is exactly the dead end the declarations hub's officials group
// had: a link that advertises a filtered destination and delivers an unfiltered one.
//
// Nothing today lists matching ITEMS across days, so there is no honest target. The rows
// themselves link to /votes/<date>, which is where a vote actually lives. Give this group a
// see-all when a cross-day item list exists — not before.

const fetchTopics = async (
  query: string,
  signal: AbortSignal,
  ns: string | null,
  scope: "in" | "out",
): Promise<SearchItem[]> => {
  // No ns means no parliament is selected, and "outside the selected parliament" is then
  // meaningless — the route answers with nothing, so do not ask.
  if (scope === "out" && !ns) return [];
  const params = new URLSearchParams({ q: query });
  if (ns) params.set("ns", ns);
  if (scope === "out") params.set("scope", "out");
  const r = await fetch(`/api/db/vote-item-search?${params}`, { signal });
  // Throw rather than return []: HubSearch tells a failed fetch apart from an empty one and
  // omits a failed group from its "searched in: …" sentence.
  if (!r.ok) throw new Error(`vote-item-search: ${r.status}`);
  const body = (await r.json()) as VoteItemResponse;
  // `altQuery` is deliberately unread: the route has already applied the rewrite to the ROWS
  // below, and with no see-all there is no link that needs the servable needle.
  return (body.items ?? []).map((it) => ({
    id: String(it.itemId),
    // The sitting, which is where a vote actually lives. `date` is already the ISO day the
    // route selected with ::text, so no client-side Date is involved and there is no
    // timezone to get wrong.
    to: `/votes/${it.date}`,
    primary: it.title,
    secondary: [`${it.ns}. НС`, it.date].filter(Boolean).join(" · "),
    icon: FileText,
  }));
};

export const parliamentSearchSources = (opts: {
  mps: MpIndexEntry[] | undefined;
  /** The selected parliament, e.g. "52". Null when the selection is not a parliamentary
   *  election, in which case nothing is out of scope and each subject renders one group. */
  ns: string | null;
  bg: boolean;
}): HubSearchSource[] => {
  const { mps, ns, bg } = opts;
  const inMps = ns ? (mps ?? []).filter((m) => m.nsFolders.includes(ns)) : mps;
  const outMps = ns ? (mps ?? []).filter((m) => !m.nsFolders.includes(ns)) : [];

  return [
    ...scopedSources<IndexSource>({
      id: "mps",
      label: {
        bg: ns ? `Депутати · ${ns}. НС` : "Депутати",
        en: ns ? `MPs · ${ns}th National Assembly` : "MPs",
      },
      // NAMES the scope it is outside. „Други" would only say that the group above mattered
      // more.
      outLabel: {
        bg: "Депутати от други НС",
        en: "MPs from other parliaments",
      },
      limit: 6,
      inSource: {
        kind: "index",
        icon: Users,
        // undefined, not null: null means "still coming" and would hold the box on a
        // spinner; the roster genuinely absent is an empty group.
        index: mps ? mpIndex(inMps ?? [], bg) : null,
        loading: !mps,
      },
      // Only when there IS a scope to be outside of. With no parliament selected the whole
      // roster is in the first group and a second heading would be empty.
      outSource:
        ns && outMps.length
          ? {
              kind: "index",
              icon: Users,
              index: mps ? mpIndex(outMps, bg) : null,
              loading: !mps,
            }
          : null,
    }),
    ...scopedSources<ServerSource>({
      id: "topics",
      label: {
        bg: ns ? `Гласувани теми · ${ns}. НС` : "Гласувани теми",
        en: ns ? `Voted items · ${ns}th Assembly` : "Voted items",
      },
      outLabel: { bg: "Теми от други НС", en: "Items from other parliaments" },
      limit: 6,
      inSource: {
        kind: "server",
        fetch: (q, s) => fetchTopics(q, s, ns, "in"),
      },
      outSource: ns
        ? { kind: "server", fetch: (q, s) => fetchTopics(q, s, ns, "out") }
        : null,
    }),
  ];
};
