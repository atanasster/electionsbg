// Shared Google News RSS query helper — the discovery mechanism behind both
// the press-only agencies' watcher (`polls_press`) and Gallup's press arm
// (`polls_gallup`), per docs/plans/polls-agency-watchers-v1.md §6.1.
//
// ⚠️ THE FEED GIVES DISCOVERY, NOT THE ARTICLE. Each item's `<link>` is a
// `news.google.com/rss/articles/<token>` behind a `consent.google.com`
// redirect that no server-side client resolves (measured 2026-09-05) — so the
// fields this module surfaces are `<source url>` (the outlet), the title and
// the date. A caller wanting the actual text resolves the OUTLET's own search
// (bTV's `/search/?q=` works; mediapool's and dir.bg's 404) or a Wikipedia
// cite note — that is `update-polls` Step 4 (third-party verification), not
// this module's job.
//
// One request per agency query — the "one request per source" watcher rule
// (decision 4) applies to this feed exactly as it does to a lister's own
// listing page.

import { fetchText } from "../../watch/fingerprint";
import { decodeEntities } from "../../lib/html";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export interface GoogleNewsItem {
  title: string;
  /** The `news.google.com` redirect link — a discovery token, never fetchable
   *  server-side (see header). Kept for the fingerprint's GUID fallback and
   *  for a human to open by hand. */
  link: string;
  /** `<guid>`, or `link` when the item carries none. */
  guid: string;
  /** As printed by Google News — RFC 2822, e.g. "Wed, 09 Sep 2026 06:00:00 GMT". */
  pubDate: string;
  /** The outlet's own URL, from `<source url="…">` — the resolvable half. */
  sourceUrl: string | null;
  sourceName: string | null;
}

/**
 * Query Google News RSS, Bulgarian edition (`hl=bg&gl=BG&ceid=BG:bg`).
 *
 * An empty result set is a real, common answer (no recent coverage) and is
 * returned as `[]`, never thrown — a genuine fetch failure (network, a
 * non-2xx `fetchText` cannot recover from) still throws, which is what the
 * watcher's error branch is for.
 */
export const googleNewsRss = async (
  query: string,
): Promise<GoogleNewsItem[]> => {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=bg&gl=BG&ceid=BG:bg`;
  const xml = await fetchText(url, {
    headers: { "User-Agent": UA, Accept: "application/rss+xml, text/xml, */*" },
  });
  if (xml === null) throw new Error(`empty response: ${url}`);

  const items: GoogleNewsItem[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const rawTitle = /<title>([\s\S]*?)<\/title>/.exec(block)?.[1] ?? "";
    const title = decodeEntities(rawTitle).trim();
    // XML requires a bare `&` in element text to be escaped as `&amp;` —
    // link/guid get the same decodeEntities pass title/source already had,
    // so a query-string `&` survives into the field a human might open.
    const link = decodeEntities(
      /<link>([\s\S]*?)<\/link>/.exec(block)?.[1]?.trim() ?? "",
    );
    const guid =
      decodeEntities(
        /<guid[^>]*>([\s\S]*?)<\/guid>/.exec(block)?.[1]?.trim() ?? "",
      ) || link;
    const pubDate =
      /<pubDate>([\s\S]*?)<\/pubDate>/.exec(block)?.[1]?.trim() ?? "";
    // Google's own feed always emits `url=` first on `<source>`; a bare
    // `<source>Outlet</source>` (no url attribute) is not ruled out by the
    // RSS spec, so a future feed shape carrying one would drop the name too
    // rather than just the url — worth knowing if `sourceName` ever goes
    // unexpectedly null on a non-empty `<source>` block.
    const sourceMatch =
      /<source\s+url="([^"]*)"[^>]*>([\s\S]*?)<\/source>/.exec(block);
    const sourceUrl = sourceMatch ? decodeEntities(sourceMatch[1]) : null;
    const sourceName = sourceMatch
      ? decodeEntities(sourceMatch[2]).trim()
      : null;
    if (!title || !guid) continue; // an unparseable item names nothing usable
    items.push({ title, link, guid, pubDate, sourceUrl, sourceName });
  }
  return items;
};

// The shared "is this headline about an electoral poll" rule for press
// discovery (decision/§6.1: "electoral-title rule"). Deliberately the same
// shape as the per-site listers' term lists (AR, GM, Gallup) rather than a
// narrower one specific to press coverage — a press headline about an
// agency's poll uses the same vocabulary the agency's own title does.
const ELECTORAL_TERMS = ["избор", "партии", "президент", "нагласи"];

export const isElectoralHeadline = (title: string): boolean => {
  const t = title.toLowerCase();
  return ELECTORAL_TERMS.some((term) => t.includes(term));
};

export interface PressArmItem {
  title: string;
  link: string;
  guid: string;
  /** ISO, when `pubDate` parsed; the raw RFC 2822 string otherwise. */
  pubDate: string;
  sourceUrl: string | null;
  sourceName: string | null;
}

export interface PressArmResult {
  /** The high-water mark — never lower than `prevLatestMs` (see
   *  `computeSiteArm`'s header for why: a bounded feed can roll off the
   *  newest item while an older one remains, one level up as time rather
   *  than an id). `0` only when neither this run nor any prior run found a
   *  timestamped electoral item. */
  latestMs: number;
  /** The GUID of the item at `latestMs` — carried forward from
   *  `prevLatestGuid` on a run that finds nothing newer, exactly as
   *  `latestMs` itself is; `""` only when neither this run nor any prior
   *  run ever established a mark. */
  latestGuid: string;
  /** Electoral items newer than `prevLatestMs` (every electoral item found
   *  when `prevLatestMs` is null — the first-run backlog), newest first. */
  items: PressArmItem[];
  detail: string;
}

/**
 * The monotonic pubDate+GUID fingerprint for one press query (decision 3:
 * "`polls_press` has no ascending id and uses `max(pubDate)` + that item's
 * GUID"). `label` names the agency in the detail line — `googleNewsRss`
 * itself carries no agency identity, since that comes from which query the
 * caller ran.
 */
export const computePressArm = (
  rawItems: GoogleNewsItem[],
  prevLatestMs: number | null,
  prevLatestGuid: string | null,
  label: string,
): PressArmResult => {
  const electoral = rawItems.filter((it) => isElectoralHeadline(it.title));
  const timestamped = electoral
    .map((it) => ({ ...it, ms: Date.parse(it.pubDate) }))
    .filter((it) => Number.isFinite(it.ms))
    .sort((a, b) => b.ms - a.ms);

  const currentMax = timestamped.length > 0 ? timestamped[0].ms : null;
  const latestMs = Math.max(prevLatestMs ?? 0, currentMax ?? 0);
  // ⚠️ Carried forward, NOT recomputed from this run's results alone — a run
  // with nothing newer (the ordinary day-to-day case) must not reset the
  // guid to "" while latestMs stays at its non-zero mark, which used to
  // desync the two and flip the fingerprint on a quiet day (see the header
  // note on latestGuid).
  const latestGuid =
    currentMax !== null && currentMax === latestMs
      ? timestamped[0].guid
      : (prevLatestGuid ?? "");

  const items = timestamped.filter(
    (it) => prevLatestMs == null || it.ms > prevLatestMs,
  );
  const toPressItem = (it: (typeof timestamped)[number]): PressArmItem => ({
    title: it.title,
    link: it.link,
    guid: it.guid,
    sourceUrl: it.sourceUrl,
    sourceName: it.sourceName,
    pubDate: new Date(it.ms).toISOString(),
  });

  return {
    latestMs,
    latestGuid,
    items: items.map(toPressItem),
    detail:
      items.length > 0
        ? `${label}: +${items.length} press item(s): ${items
            .map((it) => `${it.title} (${it.sourceName ?? "?"})`)
            .join("; ")}`
        : timestamped.length > 0
          ? `${label}: no new press coverage`
          : `${label}: no electoral coverage found`,
  };
};
