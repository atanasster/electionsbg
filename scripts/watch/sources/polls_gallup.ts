// Polls — Галъп Интернешънъл Болкан. TWO-ARMED (decision 2, §6.1): the site
// (gallup-international.bg, via the shared lister) and a Google News RSS
// press query, because the site's own TLS configuration has been broken
// since at least 2026-09-05 — every client (curl, Node, headless Chromium)
// rejects the handshake, not a challenge a browser could clear. A source
// that errors every day for months is the "cries wolf" failure
// municipal_fiscal_due.ts was written to avoid; the press arm (Gallup's own
// polls, as reported to the press) keeps this source useful while the site
// stays down, and the site arm resumes with no code change once it recovers.
//
// The fingerprint is the UNION of both arms. A single arm failing is
// recorded in `meta.armErrors`; the source still reports whichever arm
// answered. Only BOTH arms failing throws — the runner's ordinary error
// branch. A poll reached only through the press arm is locked
// `third_party_consensus` like any other press-verified poll, until the site
// publication itself is captured.

import type { Fingerprint, WatchSource } from "../types";
import { readState } from "../state";
import {
  computeSiteArm,
  LISTING_WINDOW,
  type SiteArmMetaItem,
} from "../../polls/lib/watcher";
import { gallup } from "../../polls/agencies/gallup";
import { agencyById } from "../../polls/lib/agencies";
import {
  googleNewsRss,
  computePressArm,
  type PressArmItem,
} from "../../polls/lib/google_news_rss";

const SOURCE_ID = "polls_gallup";

interface StoredSiteArm {
  newestId: number;
  items: SiteArmMetaItem[];
}
interface StoredPressArm {
  latestMs: number;
  latestGuid: string;
  items: PressArmItem[];
}
interface GallupMeta {
  site: StoredSiteArm | null;
  press: StoredPressArm | null;
  armErrors?: { site?: string; press?: string };
}

export const pollsGallup: WatchSource = {
  id: SOURCE_ID,
  label: "Polls — Галъп (site + press)",
  url: "https://www.gallup-international.bg",
  cadence: "daily",
  publishes: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    // Checked HERE, inside fingerprint(), rather than at module scope: a
    // module-level throw would fail the whole file's IMPORT, which
    // scripts/watch/sources/index.ts loads statically alongside every other
    // registered source — crashing the entire daily watch run on one stale
    // registry edit, instead of reporting Gallup's own line as an `error`
    // the way a bad registry entry should degrade.
    const pressQuery = agencyById("GIB")?.pressQuery;
    if (!pressQuery)
      throw new Error("GIB registry entry carries no pressQuery");

    const prev = readState(SOURCE_ID);
    const prevMeta = (prev?.meta ?? {}) as Partial<GallupMeta>;
    const rawPrevSiteNewestId = prevMeta.site?.newestId;
    const prevSiteNewestId = Number.isFinite(rawPrevSiteNewestId)
      ? (rawPrevSiteNewestId as number)
      : null;
    const rawPrevPressLatestMs = prevMeta.press?.latestMs;
    const prevPressLatestMs = Number.isFinite(rawPrevPressLatestMs)
      ? (rawPrevPressLatestMs as number)
      : null;
    const prevPressLatestGuid = prevMeta.press?.latestGuid ?? null;

    const armErrors: { site?: string; press?: string } = {};
    let site: ReturnType<typeof computeSiteArm> | null = null;
    let press: ReturnType<typeof computePressArm> | null = null;

    try {
      const listed = await gallup.listPublications({ limit: LISTING_WINDOW });
      site = computeSiteArm(listed, gallup.isElectoral, prevSiteNewestId);
    } catch (e) {
      armErrors.site = e instanceof Error ? e.message : String(e);
    }

    try {
      const rawItems = await googleNewsRss(pressQuery);
      press = computePressArm(
        rawItems,
        prevPressLatestMs,
        prevPressLatestGuid,
        "press",
      );
    } catch (e) {
      armErrors.press = e instanceof Error ? e.message : String(e);
    }

    if (site === null && press === null)
      throw new Error(
        `both arms failed — site: ${armErrors.site}; press: ${armErrors.press}`,
      );

    const siteNewestId = site?.newestId ?? prevSiteNewestId ?? 0;
    const pressLatestGuid =
      press?.latestGuid ?? prevMeta.press?.latestGuid ?? "";
    const value = `${siteNewestId}:${pressLatestGuid}`;

    const parts: string[] = [];
    if (site) parts.push(`site — ${site.detail}`);
    else parts.push(`site arm FAILED: ${armErrors.site}`);
    if (press) parts.push(press.detail);
    else parts.push(`press arm FAILED: ${armErrors.press}`);

    const meta: GallupMeta = {
      site: site
        ? { newestId: site.newestId, items: site.items }
        : (prevMeta.site ?? null),
      press: press
        ? {
            latestMs: press.latestMs,
            latestGuid: press.latestGuid,
            items: press.items,
          }
        : (prevMeta.press ?? null),
    };
    if (Object.keys(armErrors).length > 0) meta.armErrors = armErrors;

    return {
      value,
      detail: parts.join(" · "),
      meta: { ...meta },
    };
  },
};
