#!/usr/bin/env python3
"""
Fetch the latest N articles for one domain from news/data/bg_news_sites.csv.

Usage:
    python3 fetch_latest_articles.py <domain> [N]

Reads the domain's feed_method_*/feed_url_* columns (whatever vintage suffix
is current — matched by prefix, not a fixed name) and dispatches:

    rss / atom / homepage_link  -> fetch + parse the feed directly
    sitemap / robots_sitemap / sitemap_news
                                 -> fetch the sitemap (descending into a
                                    sitemapindex if needed), sort by date,
                                    and — if the sitemap carries no titles —
                                    fetch each of the top N article pages for
                                    its <title>/og:title
    browser_render_scrape       -> exits 3; this script cannot drive a
                                    browser. The caller (a Claude skill) must
                                    fall back to the Browser tool itself.
    blocked_captcha             -> exits 3; do not attempt to solve it.
    portal_not_newsroom         -> exits 3; not a newsroom.
    (domain not in the CSV)     -> exits 2; caller should probe it fresh
                                    per the update-news-sites skill before
                                    trying again.

Always prints ONE JSON object to stdout:
    success: {"domain", "method", "count", "articles":
              [{"title","url","published"}]}
    failure: {"domain", "error", "detail"}

No third-party dependencies — stdlib only (urllib, xml.etree, csv, email.utils).
"""
import sys
import csv
import json
import re
import urllib.request
import urllib.error
from urllib.parse import urlsplit, urlunsplit, quote
import ssl
import os
import html
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone, timedelta
from pathlib import Path
import xml.etree.ElementTree as ET
import gzip

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
TIMEOUT = 10
STALE_AFTER_DAYS = 30  # a top result older than this reads as broken sitemap data, not "latest"

# python.org macOS builds ship with no CA bundle wired up by default
# (the fix is normally "Install Certificates.command", a one-time step
# nobody runs). Point at the system bundle explicitly so this script
# works out of the box on a fresh checkout.
def _ssl_context():
    for cafile in ("/etc/ssl/cert.pem", "/private/etc/ssl/cert.pem"):
        if os.path.exists(cafile):
            return ssl.create_default_context(cafile=cafile)
    return ssl.create_default_context()

_SSL_CTX = _ssl_context()
CSV_PATH = Path(__file__).resolve().parent.parent / "data" / "bg_news_sites.csv"
NEEDS_BROWSER = {"browser_render_scrape"}
NEEDS_BROWSER_THEN_FETCH = {"browser_then_rss", "browser_then_sitemap"}
UNAVAILABLE = {"blocked_captcha", "portal_not_newsroom"}


def _normalize_url(u):
    """Some sitemaps (seen on pik.bg) store raw, non-percent-encoded Cyrillic
    text directly in <loc> — urlopen cannot send that on the request line at
    all (UnicodeEncodeError), so every fetch goes through this first. safe=
    keeps already-escaped '%xx' sequences and path separators intact rather
    than double-encoding a URL that was already properly escaped."""
    parts = urlsplit(u)
    path = quote(parts.path, safe="/%")
    query = quote(parts.query, safe="=&%")
    return urlunsplit((parts.scheme, parts.netloc, path, query, parts.fragment))


def fetch(url, accept="*/*"):
    req = urllib.request.Request(_normalize_url(url), headers={
        "User-Agent": UA,
        "Accept": accept,
        "Accept-Language": "bg-BG,bg;q=0.9,en;q=0.8",
        "Referer": "https://www.google.com/",
    })
    with urllib.request.urlopen(req, timeout=TIMEOUT, context=_SSL_CTX) as resp:
        body = resp.read()
    # Some sitemap indexes point at literal .xml.gz children; urllib does not
    # auto-decompress even when the server sets Content-Encoding, so sniff
    # the gzip magic bytes rather than trusting the header or the extension.
    if body[:2] == b"\x1f\x8b":
        body = gzip.decompress(body)
    return body


_STRAY_AMP_RE = re.compile(rb"&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)")


def _sanitize_xml(xml_bytes):
    """Real-world feeds occasionally emit a literal, unescaped '&' (seen on
    pik.bg: a URL slug for "...blood-sweat-&-tears..." breaking the whole
    document). Escape any '&' that isn't already part of a valid XML/HTML
    entity, since ElementTree refuses the entire feed over one bad byte."""
    return _STRAY_AMP_RE.sub(b"&amp;", xml_bytes)


def local_tag(el):
    """Strip XML namespace: '{ns}tag' -> 'tag'."""
    t = el.tag
    return t.split("}", 1)[1] if "}" in t else t


def find_ci(el, name):
    """Find a child by local tag name, namespace-agnostic."""
    for child in el:
        if local_tag(child).lower() == name.lower():
            return child
    return None


def find_first_ci(el, *names):
    """Like find_ci, but tries several tag names in order — Element's truth
    value is deprecated/warns in 3.13+, so this replaces `a or b` chains."""
    for name in names:
        hit = find_ci(el, name)
        if hit is not None:
            return hit
    return None


def find_all_ci(el, name):
    return [c for c in el if local_tag(c).lower() == name.lower()]


def parse_dt(s):
    if not s:
        return None
    s = s.strip()
    try:
        return parsedate_to_datetime(s)
    except (TypeError, ValueError):
        pass
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def load_row(domain):
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        headers = reader.fieldnames
        method_col = next((h for h in headers if h.startswith("feed_method_")), None)
        url_col = next((h for h in headers if h.startswith("feed_url_")), None)
        if not method_col or not url_col:
            raise RuntimeError("bg_news_sites.csv has no feed_method_*/feed_url_* columns — run update-news-sites first")
        for row in reader:
            if row["domain"] == domain:
                return row, method_col, url_col
    return None, method_col, url_col


def quick_probe(domain):
    """Lightweight ad-hoc discovery for a domain that isn't in the registry
    CSV — tries robots.txt's Sitemap: line, then a short list of common feed
    and sitemap paths. Returns (method, url) on the first hit that parses as
    real RSS/Atom/sitemap XML, or (None, None) if nothing worked. This is
    intentionally a SUBSET of the full update-news-sites discovery (no
    competitor-page snowballing, no browser fallback) — good enough for a
    one-off "just this site" ask; add the domain to the registry via that
    skill if it turns out to need the heavier treatment."""
    base = f"https://{domain}"
    try:
        robots = fetch(f"{base}/robots.txt", accept="text/plain").decode("utf-8", errors="replace")
        m = re.search(r"^Sitemap:\s*(\S+)", robots, re.I | re.M)
        candidates = [(m.group(1).strip(), "sitemap")] if m else []
    except Exception:
        candidates = []
    candidates += [
        (f"{base}/feed", "rss"), (f"{base}/feed/", "rss"), (f"{base}/rss.xml", "rss"),
        (f"{base}/sitemap.xml", "sitemap"), (f"{base}/sitemap_index.xml", "sitemap"),
    ]
    for url, method in candidates:
        try:
            body = fetch(url, accept="application/rss+xml,application/atom+xml,application/xml,text/xml,*/*")
        except Exception:
            continue
        sig = body[:800]
        if re.search(rb"<rss|<feed[ >]|xmlns=\"http://www.w3.org/2005/Atom\"", sig, re.I):
            return method, url
        if re.search(rb"<urlset|<sitemapindex", sig, re.I):
            return "sitemap", url
    return None, None


def parse_rss_atom(xml_bytes):
    root = ET.fromstring(_sanitize_xml(xml_bytes))
    items = []
    channel = find_ci(root, "channel")
    if channel is not None:  # RSS 2.0 / RSS 1.0-ish
        for item in find_all_ci(channel, "item"):
            title_el = find_ci(item, "title")
            link_el = find_ci(item, "link")
            date_el = find_first_ci(item, "pubDate", "date")
            items.append({
                "title": (title_el.text or "").strip() if title_el is not None else None,
                "url": (link_el.text or "").strip() if link_el is not None else None,
                "published": (date_el.text or "").strip() if date_el is not None else None,
                "_dt": parse_dt(date_el.text) if date_el is not None else None,
            })
    else:  # Atom
        for entry in find_all_ci(root, "entry"):
            title_el = find_ci(entry, "title")
            link_url = None
            for link_el in find_all_ci(entry, "link"):
                rel = link_el.get("rel", "alternate")
                href = link_el.get("href")
                if href and (rel == "alternate" or link_url is None):
                    link_url = href
            date_el = find_first_ci(entry, "published", "updated")
            items.append({
                "title": (title_el.text or "").strip() if title_el is not None else None,
                "url": link_url,
                "published": (date_el.text or "").strip() if date_el is not None else None,
                "_dt": parse_dt(date_el.text) if date_el is not None else None,
            })
    return items


def extract_title_from_html(html_bytes):
    html = html_bytes.decode("utf-8", errors="replace")
    m = re.search(r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)["\']', html, re.I)
    if m:
        return m.group(1).strip()
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    if m:
        return re.sub(r"\s+", " ", m.group(1)).strip()
    return None


NON_ARTICLE_SITEMAP_HINTS = ("image", "video", "author", "category", "tag", "static", "page")


def parse_sitemap(xml_bytes, want, depth=0):
    root = ET.fromstring(_sanitize_xml(xml_bytes))
    tag = local_tag(root).lower()

    if tag == "sitemapindex":
        if depth >= 3:
            return []
        children = find_all_ci(root, "sitemap")
        entries = []
        for c in children:
            loc_el = find_ci(c, "loc")
            lastmod_el = find_ci(c, "lastmod")
            if loc_el is not None and loc_el.text:
                entries.append((loc_el.text.strip(), parse_dt(lastmod_el.text) if lastmod_el is not None else None))
        # Drop children that are structurally never articles (images, authors,
        # tag/category archives, static pages) before picking among the rest.
        article_entries = [(u, d) for u, d in entries if not any(h in u.lower() for h in NON_ARTICLE_SITEMAP_HINTS)]
        if not article_entries:
            article_entries = entries

        # Rank every candidate cheapest-and-most-likely-fresh first, then
        # fetch them ONE AT A TIME and stop as soon as we have enough — this
        # is the difference between one fetch (the common case) and
        # exhaustively fetching every chunk (measured on chernomore.bg: 7
        # undated chunks with no naming convention, which the old
        # merge-everything strategy took 30+ seconds to exhaust). Priority:
        #   1) an explicit today/latest/recent/news name (unambiguous)
        #   2) a trailing number in the URL, descending (sitemap-7 before
        #      sitemap-1 — the usual "newest chunk has the highest number"
        #      convention, when nothing else disambiguates)
        #   3) file-level <lastmod>, descending
        #   4) as-listed order
        # A single fetch is NOT trusted blindly, though: WordPress/Jetpack
        # generators can rebalance numbered chunks as the archive grows, so
        # a chunk's rank here does not guarantee its ENTRIES are the newest
        # (measured on bivol.bg — the top-ranked chunk by every signal above
        # held only 2010-2015 articles). So after each fetch we check: do we
        # have >= want items whose newest date is NOT stale? If yes, stop.
        # If every candidate is exhausted (bounded to 8) without a fresh
        # result, return whatever was collected — the caller's staleness
        # check surfaces that honestly rather than hanging or erroring.
        def _rank_key(entry):
            u, lastmod = entry
            kw_rank = next((i for i, kw in enumerate(("today", "latest", "recent", "news")) if kw in u.lower()), 99)
            m = re.search(r"(\d+)\.xml", u)
            num = int(m.group(1)) if m else -1
            # Ascending sort: smaller = earlier. -timestamp makes the NEWEST
            # lastmod sort first; missing lastmod sorts last (lowest priority).
            lastmod_key = -lastmod.timestamp() if lastmod else float("inf")
            return (kw_rank, -num, lastmod_key)

        candidates = [u for u, _ in sorted(article_entries, key=_rank_key)][:8]

        merged = []
        for u in candidates:
            try:
                merged.extend(parse_sitemap(fetch(u, accept="application/xml,text/xml,*/*"), want, depth + 1))
            except (urllib.error.URLError, urllib.error.HTTPError, ET.ParseError):
                continue
            fresh_dated = [it for it in merged if it.get("_dt") and
                           (datetime.now(timezone.utc) - it["_dt"].astimezone(timezone.utc)).days <= STALE_AFTER_DAYS]
            if len(fresh_dated) >= want:
                break
        return merged

    if tag == "urlset":
        items = []
        for u in find_all_ci(root, "url"):
            loc_el = find_ci(u, "loc")
            lastmod_el = find_ci(u, "lastmod")
            news_el = find_ci(u, "news")
            title = None
            pub = None
            if news_el is not None:
                title_el = find_ci(news_el, "title")
                title = (title_el.text or "").strip() if title_el is not None else None
                pub_el = find_ci(news_el, "publication_date")
                pub = (pub_el.text or "").strip() if pub_el is not None else None
            dt = parse_dt(pub) or parse_dt(lastmod_el.text if lastmod_el is not None else None)
            items.append({
                "title": title,
                "url": (loc_el.text or "").strip() if loc_el is not None else None,
                "published": pub or (lastmod_el.text.strip() if lastmod_el is not None else None),
                "_dt": dt,
            })
        return items

    return []


def backfill_titles(items, want):
    """For sitemap entries with no <news:title>, fetch each page's <title>/og:title."""
    out = []
    for it in items[:want]:
        if it["title"] or not it["url"]:
            out.append(it)
            continue
        try:
            html = fetch(it["url"], accept="text/html")
            it["title"] = extract_title_from_html(html)
        except Exception:
            pass
        out.append(it)
    return out


def main():
    args = sys.argv[1:]
    stdin_mode = None  # "rss" or "sitemap", set by --stdin=<kind>
    for a in list(args):
        if a.startswith("--stdin="):
            stdin_mode = a.split("=", 1)[1]
            args.remove(a)

    if len(args) < 1:
        print(json.dumps({"error": "usage", "detail": "fetch_latest_articles.py [--stdin=rss|sitemap] <domain> [N]"}))
        sys.exit(1)
    domain = args[0]
    want = int(args[1]) if len(args) > 1 else 5

    if stdin_mode:
        # Reuses the exact same parse/sort/dedupe/staleness pipeline for XML
        # a Browser-tool fetch() already retrieved (e.g. past a Cloudflare
        # challenge this script cannot clear on its own — see
        # NEEDS_BROWSER_THEN_FETCH below). No network fetch of the PRIMARY
        # document happens here; sitemap title backfill may still fetch
        # individual article pages over the network same as the normal path.
        raw = sys.stdin.buffer.read()
        method = "sitemap" if stdin_mode == "sitemap" else "rss"
        url = f"<stdin:{stdin_mode}>"
        is_sitemap_family = stdin_mode == "sitemap"
        try:
            items = parse_sitemap(raw, want) if is_sitemap_family else parse_rss_atom(raw)
        except ET.ParseError as e:
            print(json.dumps({"domain": domain, "error": "fetch_failed", "detail": str(e)}))
            sys.exit(4)
    else:
        row, method_col, url_col = load_row(domain)
        if row is None:
            method, url = quick_probe(domain)
            if method is None:
                print(json.dumps({"domain": domain, "error": "domain_not_in_registry_and_quick_probe_failed",
                                   "detail": ("not found in bg_news_sites.csv, and a quick robots.txt/feed/sitemap probe found nothing parseable — "
                                              "the site may need a real browser (Cloudflare/JS-rendered) or a more thorough discovery pass; "
                                              "see the update-news-sites skill")}))
                sys.exit(2)
        else:
            method = row[method_col]
            url = row[url_col]

        if method in NEEDS_BROWSER:
            print(json.dumps({"domain": domain, "error": "needs_browser", "method": method,
                               "detail": "no machine feed exists; render the homepage with the Browser tool and scrape article links from the DOM"}))
            sys.exit(3)
        if method in NEEDS_BROWSER_THEN_FETCH:
            print(json.dumps({"domain": domain, "error": "needs_browser_then_fetch", "method": method, "feed_url": url,
                               "stdin_mode": "sitemap" if method == "browser_then_sitemap" else "rss",
                               "detail": "a Cloudflare JS challenge blocks a bare HTTP client; navigate here with the Browser tool, wait ~5-8s for it to clear (no CAPTCHA is expected — if one appears, stop), then call fetch(feed_url) from the page's own JS context to get the raw feed/sitemap XML text and pipe it back through this script with --stdin=<stdin_mode> to reuse the same parser"}))
            sys.exit(3)
        if method in UNAVAILABLE:
            print(json.dumps({"domain": domain, "error": method, "detail": row.get("feed_notes_aug2026") or ""}))
            sys.exit(3)

        is_sitemap_family = method in ("sitemap", "robots_sitemap", "sitemap_news")
        try:
            if method in ("rss", "atom", "homepage_link"):
                fetch_url = url if url.startswith("http") else f"https://{domain}/{url.lstrip('/')}"
                items = parse_rss_atom(fetch(fetch_url, accept="application/rss+xml,application/atom+xml,application/xml,text/xml"))
            elif is_sitemap_family:
                items = parse_sitemap(fetch(url, accept="application/xml,text/xml,*/*"), want)
            else:
                print(json.dumps({"domain": domain, "error": "unknown_method", "detail": method}))
                sys.exit(3)
        except (urllib.error.URLError, urllib.error.HTTPError, ET.ParseError) as e:
            print(json.dumps({"domain": domain, "error": "fetch_failed", "detail": str(e)}))
            sys.exit(4)

    items = [it for it in items if it.get("url")]
    seen_urls = set()
    deduped = []
    for it in items:
        if it["url"] not in seen_urls:
            seen_urls.add(it["url"])
            deduped.append(it)
    items = deduped

    dated = [it for it in items if it.get("_dt")]
    undated = [it for it in items if not it.get("_dt")]
    dated.sort(key=lambda it: it["_dt"], reverse=True)
    newest_dt = dated[0]["_dt"] if dated else None
    ordered = dated + undated
    for it in ordered:
        it.pop("_dt", None)

    # Bare sitemaps (loc + lastmod, no <news:title>) carry no headline at
    # all — this MUST run after sorting/trimming, on the actual top-N, not
    # on an arbitrary pre-sort slice (a sitemapindex is often merged from
    # several children, so "the first N items returned" is not "the N
    # newest" until after the sort above).
    top = ordered[:want]
    if is_sitemap_family:
        top = backfill_titles(top, want)
    for it in top:
        # Some sitemaps double-encode entities (title text arrives as the
        # LITERAL string "&quot;" rather than a decoded quote) — unescape
        # twice defensively; a plain string with no entities is unaffected.
        if it.get("title"):
            it["title"] = html.unescape(html.unescape(it["title"]))

    order_confidence = "date_sorted" if dated else "feed_order_unconfirmed"
    warning = None
    if newest_dt:
        age_days = (datetime.now(timezone.utc) - newest_dt.astimezone(timezone.utc)).days
        if age_days > STALE_AFTER_DAYS:
            order_confidence = "stale_source_suspected"
            warning = (f"the newest dated entry found is from {newest_dt.date()}, {age_days} days old — "
                       "this source's sitemap/feed dates look stale or broken; do not report these as the latest articles without saying so")

    result = {
        "domain": domain,
        "method": method,
        "source": url,
        "count": min(want, len(ordered)),
        "order_confidence": order_confidence,
        "articles": top,
    }
    if warning:
        result["warning"] = warning
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0)


if __name__ == "__main__":
    main()
