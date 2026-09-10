// Pure logic behind `polls:fetch` (Tier 2, T2a — docs/plans/polls-agency-watchers-v1.md
// §6.2, decisions 7 and 17). The CLI orchestration (network fetch, fs writes) lives in
// scripts/polls/fetch.ts; everything here is deterministic and unit-testable without
// touching the network or the filesystem.

import * as cheerio from "cheerio";
import { sha256, sha256Short } from "../../watch/fingerprint";
import { readState } from "../../watch/state";
import type { SiteArmMetaItem } from "./watcher";
import type { PressArmItem } from "./google_news_rss";
import { trend } from "../agencies/trend";
import { alphaResearch } from "../agencies/alpha_research";
import { marketLinks } from "../agencies/market_links";
import { sovaHarris } from "../agencies/sova_harris";
import { myara } from "../agencies/myara";
import { globalMetrics } from "../agencies/global_metrics";
import { gallup } from "../agencies/gallup";
import type { AgencyLister } from "../agencies/types";

/**
 * The raw_data directory slug per agency — the LISTER MODULE's own filename
 * for the seven site-having agencies, matching decision 13's own
 * `.gitignore` example (`raw_data/polls/sova_harris/**`, not `raw_data/
 * polls/sh/**`). Press-only agencies have no lister module, so they fall
 * back to their lowercased registry id — there is no established slug to
 * match.
 */
export const AGENCY_DIR_SLUG: Record<string, string> = {
  TR: "trend",
  AR: "alpha_research",
  ML: "market_links",
  SH: "sova_harris",
  MY: "myara",
  GM: "global_metrics",
  GIB: "gallup",
  MD: "md",
  AF: "af",
  CAM: "cam",
  EX: "ex",
  BB: "bb",
  IMP: "imp",
  OS: "os",
};

export const dirSlugFor = (agencyId: string): string =>
  AGENCY_DIR_SLUG[agencyId] ?? agencyId.toLowerCase();

/** `raw_data/polls/<agency-dir-slug>/<pubId>` — decision 13's directory shape. */
export const captureDir = (agencyId: string, pubId: string): string =>
  `raw_data/polls/${dirSlugFor(agencyId)}/${pubId}`;

/** The six agencies with an `AgencyLister` module — everyone except Gallup
 *  (two-armed, handled separately) and the press-only agencies (no site to
 *  list at all). */
export const SITE_LISTERS: Record<string, AgencyLister> = {
  TR: trend,
  AR: alphaResearch,
  ML: marketLinks,
  SH: sovaHarris,
  MY: myara,
  GM: globalMetrics,
};

/** `WatchSource.id` for each site-only agency's own watcher (decision 2). */
export const SITE_SOURCE_ID: Record<string, string> = {
  TR: "polls_trend",
  AR: "polls_alpha_research",
  ML: "polls_market_links",
  SH: "polls_sova_harris",
  MY: "polls_myara",
  GM: "polls_global_metrics",
};

/** Every agency `polls:fetch` can capture from directly — the six site-only
 *  agencies plus Gallup's own site arm. Excludes the press-only agencies and
 *  Gallup's press arm, which have no directly-fetchable URL (see
 *  `PENDING PRESS ITEMS` below). */
export const FETCHABLE_SITE_AGENCIES = [
  "TR",
  "AR",
  "ML",
  "SH",
  "MY",
  "GM",
  "GIB",
] as const;

export interface CaptureTarget {
  agencyId: string;
  /** Stable within the agency: the site item's own ascending id, or a
   *  content-derived hash for a `--url`/`--archive` capture. */
  pubId: string;
  /** The address `polls:fetch` actually reads bytes from. For an `--archive`
   *  capture this is the Wayback snapshot URL, not the original. */
  fetchUrl: string;
  /** The agency's own URL — always populated; for a Wayback capture, either
   *  the value the operator supplied via `--url` or recovered from the
   *  Wayback URL's own structure (decision 17: "SOURCE.json records BOTH
   *  URLs"). */
  originalUrl: string;
  archiveUrl: string | null;
  title: string | null;
  publishedAt: string | null;
}

/** A press item the watcher found but that `polls:fetch` cannot capture on
 *  its own — Google News RSS's `<link>` is a `consent.google.com`-walled
 *  redirect token, never fetchable server-side (google_news_rss.ts's own
 *  header). Surfaced for the OPERATOR to resolve on the outlet and re-run
 *  with `--url`, per decision 2/§6.2's "press" row. */
export interface PendingPressNotice {
  agencyId: string;
  title: string;
  sourceName: string | null;
  guid: string;
  pubDate: string;
}

const toTarget = (agencyId: string, it: SiteArmMetaItem): CaptureTarget => ({
  agencyId,
  pubId: String(it.id),
  fetchUrl: it.url,
  originalUrl: it.url,
  archiveUrl: null,
  title: it.title,
  publishedAt: it.publishedAt,
});

/** Site-item backlog pending capture for one agency, straight from its own
 *  watcher's last-known `meta.items` (decision 3's "new since last run"
 *  list) — or `null` when `agencyId` has no fetchable watcher at all. */
export const pendingSiteTargets = (
  agencyId: string,
): CaptureTarget[] | null => {
  if (agencyId === "GIB") {
    const meta = readState("polls_gallup")?.meta as
      | { site?: { items?: SiteArmMetaItem[] } | null }
      | undefined;
    return (meta?.site?.items ?? []).map((it) => toTarget("GIB", it));
  }
  const sourceId = SITE_SOURCE_ID[agencyId];
  if (!sourceId) return null;
  const meta = readState(sourceId)?.meta as
    | { items?: SiteArmMetaItem[] }
    | undefined;
  return (meta?.items ?? []).map((it) => toTarget(agencyId, it));
};

const toPressNotice = (
  agencyId: string,
  it: PressArmItem,
): PendingPressNotice => ({
  agencyId,
  title: it.title,
  sourceName: it.sourceName,
  guid: it.guid,
  pubDate: it.pubDate,
});

/** Every press-arm item pending manual `--url` capture — Gallup's press arm
 *  plus every press-only agency `polls_press` tracks. Not a capture target:
 *  see `PendingPressNotice`. */
export const pendingPressNotices = (): PendingPressNotice[] => {
  const out: PendingPressNotice[] = [];
  const gallupMeta = readState("polls_gallup")?.meta as
    | { press?: { items?: PressArmItem[] } | null }
    | undefined;
  for (const it of gallupMeta?.press?.items ?? [])
    out.push(toPressNotice("GIB", it));

  const pressMeta = readState("polls_press")?.meta as
    | { agencies?: Record<string, { items?: PressArmItem[] }> }
    | undefined;
  for (const [agencyId, arm] of Object.entries(pressMeta?.agencies ?? {}))
    for (const it of arm.items ?? []) out.push(toPressNotice(agencyId, it));

  return out;
};

/** A manual backlog walk past what the watcher currently tracks (`--since`),
 *  reading the agency's OWN lister directly rather than watch state. `null`
 *  when `agencyId` has no lister to walk (a press-only agency, or Gallup —
 *  whose site arm IS listed here, keyed by "GIB"). */
export const backlogTargets = async (
  agencyId: string,
  after: string,
): Promise<CaptureTarget[] | null> => {
  const lister = agencyId === "GIB" ? gallup : SITE_LISTERS[agencyId];
  if (!lister) return null;
  const listed = await lister.listPublications({ after });
  return listed.filter(lister.isElectoral).map((p) => toTarget(agencyId, p));
};

/** `https://web.archive.org/web/<timestamp>/<original>` → `<original>`, or
 *  `null` when the URL is not shaped like a Wayback snapshot address. */
export const parseWaybackOriginalUrl = (waybackUrl: string): string | null => {
  const m = /^https?:\/\/web\.archive\.org\/web\/[^/]+\/(https?:\/\/.+)$/.exec(
    waybackUrl,
  );
  return m ? m[1] : null;
};

export const targetFromUrl = (
  agencyId: string,
  url: string,
): CaptureTarget => ({
  agencyId,
  pubId: sha256Short(url),
  fetchUrl: url,
  originalUrl: url,
  archiveUrl: null,
  title: null,
  publishedAt: null,
});

export const targetFromArchive = (
  agencyId: string,
  archiveUrl: string,
  explicitUrl?: string,
  explicitPub?: string,
): CaptureTarget => {
  const original =
    explicitUrl ?? parseWaybackOriginalUrl(archiveUrl) ?? archiveUrl;
  return {
    agencyId,
    pubId: explicitPub ?? sha256Short(archiveUrl),
    fetchUrl: archiveUrl,
    originalUrl: original,
    archiveUrl,
    title: null,
    publishedAt: null,
  };
};

// A relative `href` on a real listing/post page never carries this repo's own
// origin, so resolving against the PAGE's url (not the site root) is what
// makes a same-directory link ("./doc.pdf") resolve correctly too.
const resolveHref = (href: string, pageUrl: string): string | null => {
  try {
    return new URL(href, pageUrl).toString();
  } catch {
    return null;
  }
};

/** Every distinct PDF link on a captured page, absolute, in document order.
 *  Generic across agencies — Market Links and Global Metrics each link
 *  their publication's PDF this way (decision, §6.2). Only `<a href>` is
 *  recognised; a future agency embedding its PDF via `<embed>`/`<iframe>`/
 *  `<object>` would silently capture zero attachments — verify the actual
 *  markup shape before wiring a new agency in and assuming this "just
 *  works". */
export const discoverPdfLinks = (html: string, pageUrl: string): string[] => {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!/\.pdf(?:[?#]|$)/i.test(href)) return;
    const abs = resolveHref(href, pageUrl);
    if (abs) seen.add(abs);
  });
  return [...seen];
};

/**
 * Every `<img>` on the page whose `src` matches the given agency's OWN
 * image-as-primary-source pattern, resolved absolute against the page URL
 * — decision 18: three agencies now carry data ONLY inside an image, not
 * in any extractable text, so a lister-level image discoverer is a shared
 * need, not a Sova-Harris-specific one.
 *
 *  - SH: `Buletin_<slug>_page-NNNN.jpg` — a multi-page scan of party-
 *    support tables, this agency's ONLY primary (sova_harris.ts's header).
 *  - TR: `SlideN.png` — the passport (sample size, fieldwork dates) is
 *    published ONLY this way; the party shares themselves are ordinary
 *    `.et_pb_text_inner` text (measured 2026-09-09, decision 18). Also
 *    `zadl<N>.png` (bare `zadl.png` for the first) — an OLDER, pre-Slide-era
 *    chart-image naming convention TR's 2016 presidential post uses (Tier
 *    4b's historical backfill), one image per survey question including a
 *    "Други" (Others/residual) bar the article's own prose never states in
 *    words. Both patterns coexist rather than one replacing the other,
 *    since a real capture may need either depending on the post's era.
 *  - AR: `GraphN.jpg` (`N` sometimes omitted a leading zero — "Graph1.jpg"
 *    and "Graph01.jpg" both occur) — roughly half of AR's real posts carry
 *    every party share ONLY this way, no narrative text at all (decision 18).
 *
 * Absent from `AGENCY_IMAGE_PATTERNS` means "this agency has no known
 * image-as-primary-source shape" — not an error, just nothing to discover.
 *
 * Each pattern tolerates a trailing `-N` before the extension — WordPress's
 * own media-library de-duplication suffix, appended whenever an upload's
 * filename collides with one already on the site (an ordinary occurrence,
 * not a rare one: `raw_data/polls/trend/212732/page.html`, a real capture
 * already in this repo, embeds `Slide2-2.png`/`Slide3-2.png`). Without the
 * tolerance the match anchors on a bare `$` right after the extension and
 * silently returns zero images for a page that has them — no error, no
 * attachment-fetch-failure entry, because no fetch is even attempted.
 */
const AGENCY_IMAGE_PATTERNS: Record<string, RegExp> = {
  SH: /Buletin_[^/?#]*?page-\d+(?:-\d+)?\.jpe?g$/i,
  TR: /(?:Slide\d+|zadl\d*)(?:-\d+)?\.png$/i,
  AR: /Graph\d*(?:-\d+)?\.jpe?g$/i,
};

export const discoverAgencyImages = (
  agencyId: string,
  html: string,
  pageUrl: string,
): string[] => {
  const pattern = AGENCY_IMAGE_PATTERNS[agencyId];
  if (!pattern) return [];
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  $("img[src]").each((_, el) => {
    const src = $(el).attr("src") ?? "";
    if (!pattern.test(src)) return;
    const abs = resolveHref(src, pageUrl);
    if (abs) seen.add(abs);
  });
  return [...seen];
};

/** A single hash over the page plus every attachment, in a stable order —
 *  "has anything about this capture changed" (decision 7), rather than
 *  hashing only the page while an agency's PDF silently changes underneath
 *  it, or vice-versa.
 *
 *  ⚠️ Hashes the RAW page byte-for-byte, with no normalization. Five of the
 *  seven fetchable agencies publish through WordPress, whose rendered pages
 *  routinely embed content unrelated to the poll itself (related-post
 *  widgets, form nonces, cache-busting query strings on unrelated assets)
 *  that can churn between two fetches of the "same" logical page. That only
 *  matters on an explicit `--force` re-check (the default path never
 *  re-fetches an already-captured pubId at all) — but a re-check could mint
 *  a content-free `.v2` into a directory tree decision 13 designates as
 *  TRACKED provenance, not a disposable cache. If that turns out to matter
 *  in practice, hash a normalized extraction of the page instead (e.g. the
 *  same content-container selector the Tier 2b extractor will use). */
export const combinedSha256 = (
  pageHtml: string,
  attachments: Uint8Array[],
): string => {
  const parts: (string | Uint8Array)[] = [pageHtml, ...attachments];
  const hash = parts.map((p) => sha256(p)).join("|");
  return sha256(hash);
};

/**
 * The suffix of the MOST RECENT existing capture — `""`, `".v2"`, `".v3"`,
 * … — given a probe for "does this directory already exist", or `null`
 * when no capture exists at all yet. The caller reads THAT version's
 * `SOURCE.json` to decide whether today's content is genuinely new.
 */
export const latestVersionSuffix = (
  exists: (suffix: string) => boolean,
): string | null => {
  if (!exists("")) return null;
  let n = 2;
  let latest = "";
  while (exists(`.v${n}`)) {
    latest = `.v${n}`;
    n++;
  }
  return latest;
};

/**
 * The next UNUSED suffix past every version the probe reports existing —
 * where a changed capture gets written. Decision 7 names only `.v2`
 * explicitly ("an agency re-issuing a corrected PDF at the same URL"); this
 * generalises to a THIRD change rather than silently overwriting or
 * refusing outright, which the decision does not rule out.
 *
 * Derived from `latestVersionSuffix` rather than re-walking the same probe
 * sequence a second time.
 */
export const nextVersionSuffix = (
  exists: (suffix: string) => boolean,
): string => {
  const latest = latestVersionSuffix(exists);
  if (latest === null) return "";
  const n = latest === "" ? 1 : Number(/^\.v(\d+)$/.exec(latest)![1]);
  return `.v${n + 1}`;
};
