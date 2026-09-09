// Polls — press discovery, for agencies with no reachable website at all
// (Медиана, АФИС, ЦАМ, Екзакта, Барометър България, ИМП, Online Solutions —
// `AGENCY_REGISTRY` entries with `reach: "press"`). One Google News RSS
// query per agency, per decision 2/§6.1 — Gallup is DEDUPED OUT by
// construction (`PRESS_ONLY_AGENCIES` excludes it; its own two-armed
// `polls_gallup` owns that query), so no poll is ever reported twice under
// two sources.
//
// ⚠️ The feed gives discovery, not the article — see google_news_rss.ts's
// header. A flip here maps to `update-polls` Step 4 (third-party
// verification: resolve the headline on the outlet, or a Wikipedia cite
// note), never to a deterministic extractor.
//
// One agency's query failing does not fail the whole source: each is
// caught independently and a failed agency carries its PRIOR value forward
// (or nothing, on a first run with no prior state), the same "a single
// arm's outage errors its own line only" principle `polls_gallup` applies —
// generalized here to N query arms instead of two. Only every agency
// failing with no prior state at all throws (the runner's ordinary error
// branch) — which is also the shape a real Google News rate-limit takes,
// since it would hit every query in the same run.

import type { Fingerprint, WatchSource } from "../types";
import { readState } from "../state";
import { PRESS_ONLY_AGENCIES } from "../../polls/lib/agencies";
import {
  googleNewsRss,
  computePressArm,
  type PressArmItem,
} from "../../polls/lib/google_news_rss";

const SOURCE_ID = "polls_press";

interface StoredAgencyArm {
  latestMs: number;
  latestGuid: string;
  items: PressArmItem[];
}
interface PollsPressMeta {
  agencies: Record<string, StoredAgencyArm>;
  queryErrors?: Record<string, string>;
}

export const pollsPress: WatchSource = {
  id: SOURCE_ID,
  label: "Polls — press discovery (agencies without a site)",
  url: "https://news.google.com/",
  cadence: "daily",
  publishes: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const prev = readState(SOURCE_ID);
    const prevAgencies =
      ((prev?.meta as Partial<PollsPressMeta> | undefined)?.agencies as
        | Record<string, StoredAgencyArm>
        | undefined) ?? {};

    const agencies: Record<string, StoredAgencyArm> = {};
    const queryErrors: Record<string, string> = {};
    const detailParts: string[] = [];

    for (const entry of PRESS_ONLY_AGENCIES) {
      const prevArm = prevAgencies[entry.id];
      const prevLatestMs = Number.isFinite(prevArm?.latestMs)
        ? (prevArm!.latestMs as number)
        : null;
      const prevLatestGuid = prevArm?.latestGuid ?? null;
      try {
        // pressQuery is never null on a PRESS_ONLY_AGENCIES entry — that is
        // exactly the filter the registry applies — but the field's own
        // type stays `string | null` for every entry, so this narrows it.
        const query = entry.pressQuery;
        if (!query) throw new Error(`${entry.id} carries no pressQuery`);
        const rawItems = await googleNewsRss(query);
        const arm = computePressArm(
          rawItems,
          prevLatestMs,
          prevLatestGuid,
          entry.seed.name_bg,
        );
        agencies[entry.id] = {
          latestMs: arm.latestMs,
          latestGuid: arm.latestGuid,
          items: arm.items,
        };
        if (arm.items.length > 0) detailParts.push(arm.detail);
      } catch (e) {
        queryErrors[entry.id] = e instanceof Error ? e.message : String(e);
        if (prevArm) agencies[entry.id] = prevArm; // carry the prior value forward
      }
    }

    if (Object.keys(agencies).length === 0 && PRESS_ONLY_AGENCIES.length > 0)
      throw new Error(
        `every press query failed — ${Object.entries(queryErrors)
          .map(([id, msg]) => `${id}: ${msg}`)
          .join("; ")}`,
      );

    // One token per registered agency id (sorted by the registry's own
    // order, which is fixed), so a query that fails and carries its prior
    // value forward cannot itself move the fingerprint.
    const value = PRESS_ONLY_AGENCIES.map(
      (a) =>
        `${a.id}:${agencies[a.id]?.latestMs ?? 0}:${agencies[a.id]?.latestGuid ?? ""}`,
    ).join("|");

    if (Object.keys(queryErrors).length > 0)
      detailParts.push(
        `query failed for ${Object.keys(queryErrors).join(", ")}`,
      );

    const meta: PollsPressMeta = { agencies };
    if (Object.keys(queryErrors).length > 0) meta.queryErrors = queryErrors;

    return {
      value,
      detail:
        detailParts.length > 0
          ? detailParts.join(" · ")
          : "no new press coverage across any press-only agency",
      meta: { ...meta },
    };
  },
};
