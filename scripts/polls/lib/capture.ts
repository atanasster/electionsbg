// Publication discovery and target selection for polls:fetch. Watch deltas are
// persisted before their cursor advances; capture reads the durable queue and
// supports legacy watch state until it has been reconciled.

import * as cheerio from "cheerio";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  pendingPublications,
  readPublicationLedger,
  rememberPublications,
  type PublicationDiscovery,
} from "./publication_ledger";
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

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/** Persist discoveries before the runner advances its high-water mark. */
export const rememberPollWatch = (
  sourceId: string,
  meta: Record<string, unknown> | undefined,
  at: string,
  root = REPO_ROOT,
): void => {
  if (!meta || !sourceId.startsWith("polls_")) return;
  const siteAgency = Object.entries(SITE_SOURCE_ID).find(
    ([, id]) => id === sourceId,
  )?.[0];
  const saveSite = (agency: string, arm: unknown) => {
    const items = watchItems(arm);
    const publications: PublicationDiscovery[] = [];
    for (const item of items) {
      if (
        typeof item.id !== "number" ||
        typeof item.url !== "string" ||
        typeof item.title !== "string"
      )
        throw new Error("Invalid polling site discovery");
      publications.push({
        pubId: String(item.id),
        url: item.url,
        title: item.title,
        publishedAt:
          typeof item.publishedAt === "string" ? item.publishedAt : null,
      });
    }
    rememberPublications(root, agency, publications, at);
  };
  const savePress = (agency: string, arm: unknown) => {
    const publications: PublicationDiscovery[] = [];
    for (const item of watchItems(arm)) {
      if (
        typeof item.guid !== "string" ||
        typeof item.link !== "string" ||
        typeof item.title !== "string"
      )
        throw new Error("Invalid polling press discovery");
      publications.push({
        pubId: sha256Short(item.guid),
        url: item.link,
        title: item.title,
        publishedAt: typeof item.pubDate === "string" ? item.pubDate : null,
        press: {
          guid: item.guid,
          sourceName:
            typeof item.sourceName === "string" ? item.sourceName : null,
        },
      });
    }
    rememberPublications(root, agency, publications, at);
  };
  if (siteAgency) saveSite(siteAgency, meta);
  if (sourceId === "polls_gallup") {
    saveSite("GIB", meta.site);
    savePress("GIB", meta.press);
  }
  if (sourceId === "polls_press" && isRecord(meta.agencies)) {
    for (const [agency, arm] of Object.entries(meta.agencies))
      savePress(agency, arm);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const watchItems = (arm: unknown): Record<string, unknown>[] => {
  if (arm == null) return [];
  if (!isRecord(arm) || !Array.isArray(arm.items) || !arm.items.every(isRecord))
    throw new Error("Invalid polling watch items");
  return arm.items;
};

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
  pubId?: string;
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
  root = REPO_ROOT,
): CaptureTarget[] | null => {
  const persisted = pendingPublications(root, agencyId)
    .filter((item) => !item.press || item.press.resolvedUrl)
    .map(
      (item): CaptureTarget => ({
        agencyId,
        pubId: item.pubId,
        fetchUrl: item.url,
        originalUrl: item.url,
        archiveUrl: null,
        title: item.title,
        publishedAt: item.publishedAt,
      }),
    );
  const merge = (items: SiteArmMetaItem[]) => [
    ...new Map(
      [...items.map((item) => toTarget(agencyId, item)), ...persisted].map(
        (item) => [item.pubId, item],
      ),
    ).values(),
  ];
  if (agencyId === "GIB") {
    const meta = readState("polls_gallup")?.meta as
      | { site?: { items?: SiteArmMetaItem[] } | null }
      | undefined;
    return merge(meta?.site?.items ?? []);
  }
  const sourceId = SITE_SOURCE_ID[agencyId];
  if (!sourceId) return null;
  const meta = readState(sourceId)?.meta as
    | { items?: SiteArmMetaItem[] }
    | undefined;
  return merge(meta?.items ?? []);
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
export const pendingPressNotices = (root = REPO_ROOT): PendingPressNotice[] => {
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

  const resolvedPress = new Set<string>();
  for (const agencyId of Object.keys(AGENCY_DIR_SLUG)) {
    for (const item of readPublicationLedger(root, agencyId)) {
      if (item.press?.resolvedUrl)
        resolvedPress.add(`${agencyId}:${item.press.guid}`);
    }
    for (const item of pendingPublications(root, agencyId)) {
      if (!item.press || item.press.resolvedUrl) continue;
      out.push({
        agencyId,
        title: item.title ?? item.url,
        sourceName: item.press.sourceName,
        guid: item.press.guid,
        pubDate: item.publishedAt ?? "",
        pubId: item.pubId,
      });
    }
  }
  return [
    ...new Map(
      out
        .filter((item) => !resolvedPress.has(`${item.agencyId}:${item.guid}`))
        .map((item) => [`${item.agencyId}:${item.guid}`, item]),
    ).values(),
  ];
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
    const resolved = new URL(href, pageUrl);
    return /^https?:$/.test(resolved.protocol) ? resolved.toString() : null;
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
const discoverDocuments = (
  html: string,
  pageUrl: string,
  extension: RegExp,
): string[] => {
  const $ = cheerio.load(html);
  const base =
    resolveHref($("base[href]").first().attr("href") ?? "", pageUrl) ?? pageUrl;
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!extension.test(href)) return;
    if (
      /downloadResource\.php/i.test(href) &&
      !/презентац|проучване|доклад|presentation|report/i.test($(el).text())
    )
      return;
    const abs = resolveHref(href, base);
    if (abs) seen.add(abs);
  });
  return [...seen];
};

export const discoverPdfLinks = (html: string, pageUrl: string): string[] =>
  discoverDocuments(html, pageUrl, /\.pdf(?:[?#]|$)/i);

/** Older Alpha Research releases link Word reports as well as PDFs. */
export const discoverReportLinks = (html: string, pageUrl: string): string[] =>
  discoverDocuments(
    html,
    pageUrl,
    /(?:\.(?:pdf|docx?)(?:[?#]|$)|modules\/downloadResource\.php\?resource=\d+&hash=)/i,
  );

/** Agency chart and methodology images, including historical naming schemes.
 * Prefer the largest observed srcset image so OCR receives the original scan. */
const AGENCY_IMAGE_PATTERNS: Record<string, RegExp> = {
  ML: /(?:^|\/)storage1\/images\/articles\/item\d+\/pic\d+\/C\.(?:png|jpe?g)(?:[?#]|$)/i,
  SH: /\/(?:Buletin_|publ|page\d)[^/?#]*\.jpe?g(?:[?#]|$)/i,
  TR: /\/(?:Slide\d+|zadl\d*|Presentation-TREND-[^/?#]+|Trend-[^/?#]+)(?:-\d+)?\.png(?:[?#]|$)/i,
  AR: /(?:\/userfiles\/image\/\d+_\d+\.gif(?:[?#]|$)|\/(?:Graph\d*(?:_?final)?|Chart_?\d+|G\d+|\d+_(?:President|Pravitelstvo|Ochakvaniya|Izbori_data|Electoral|Izbori_chestnost))(?:-\d+)?\.jpe?g(?:[?#]|$))/i,
};

export const discoverAgencyImages = (
  agencyId: string,
  html: string,
  pageUrl: string,
): string[] => {
  const pattern = AGENCY_IMAGE_PATTERNS[agencyId];
  if (!pattern) return [];
  const $ = cheerio.load(html);
  const base =
    resolveHref($("base[href]").first().attr("href") ?? "", pageUrl) ?? pageUrl;
  const seen = new Set<string>();
  $("img[src]").each((_, el) => {
    const src = $(el).attr("src") ?? "";
    if (!pattern.test(src)) return;
    const candidates = ($(el).attr("srcset") ?? "")
      .split(",")
      .map((entry) => /^\s*(\S+)\s+(\d+)w\s*$/.exec(entry))
      .filter(
        (entry): entry is RegExpExecArray => !!entry && pattern.test(entry[1]),
      )
      .sort((a, b) => Number(b[2]) - Number(a[2]));
    const abs = resolveHref(candidates[0]?.[1] ?? src, base);
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
