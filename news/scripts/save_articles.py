#!/usr/bin/env python3
"""
Save the latest N full articles from one registry domain as individual JSON
files under news/data/<domain>/.

Usage:
    python3 save_articles.py <domain> [N] [--delay=SECONDS]

Pipeline:
    1. Runs fetch_latest_articles.py as a SUBPROCESS and parses its stdout
       JSON — the exact same tested list logic (feed dispatch, sitemapindex
       descent, date sort, dedupe, title backfill) the fetch-news-articles
       skill uses. Its exit code and error JSON are propagated verbatim.
    2. For each article URL not already stored, fetches the page and
       extracts title / published / author / topic / description / content,
       first source winning per field:
           JSON-LD (schema.org NewsArticle et al.)  >  <meta> og:/article:  >  DOM text
       Content = <p> paragraph text outside nav/aside/footer/ad-classed boxes
       (preferring an <article> wrapper), with a longest-contiguous-run
       fallback over free text for legacy sites that don't use <p>, and
       junk trimming at both ends (menus, share bars, calendars).
    3. Applies an ARTICLE GATE so listing/homepage pages are rejected rather
       than saved as pseudo-articles:
           JSON-LD Article node | og:type=article | >= 2 extracted paragraphs
    4. Writes one JSON file per article, named
       <YYYYMMDD|nodate>-<url-slug>-<md5_8>.json

Files already present (matched by the "url" field inside them) are never
refetched or rewritten — re-running tops a folder up incrementally with
only the new articles.

Prints ONE JSON summary object to stdout:
    {"domain","dir","requested","listed","already_present","saved",
     "failed":[{"url","detail"}],"list_method","order_confidence"}
plus the lister's "warning" when it flagged a stale/unconfirmed source.

Stdlib only. Exit codes: 0 success (partial per-article failures live in
the summary); 2/3/4 propagate the lister's meaning for the list stage; 4
also when nothing could be saved this run.
"""
import sys
import re
import json
import gzip
import time
import hashlib
import subprocess
import urllib.request
import urllib.error
from html.parser import HTMLParser
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR = SCRIPT_DIR.parent / "data"
LISTER = SCRIPT_DIR / "fetch_latest_articles.py"

sys.path.insert(0, str(SCRIPT_DIR))
import fetch_latest_articles as fla  # noqa: E402 - shared fetch/parse/date helpers

DELAY_DEFAULT = 0.4  # seconds between article-page fetches, same host
# Multi-chunk ambiguous sitemaps (measured: bird.bg, bivol.bg, bnews.bg,
# economic.bg, iskra.bg in the first full sweep) legitimately exceed 180s
# in the lister's careful candidate-by-candidate descent — 300s keeps them
# recoverable without hanging the batch on a truly dead site.
LISTER_TIMEOUT = 300

# ---------------------------------------------------------------- content DOM

VOID_TAGS = {"br", "img", "hr", "input", "meta", "link", "source", "wbr",
             "area", "base", "col", "embed", "param", "track"}

# Elements whose entire subtree is never article body. <time> is junk here
# because its text (the timestamp) would otherwise leak into the content.
JUNK_TAGS = {"script", "style", "nav", "header", "footer", "aside", "form",
             "noscript", "template", "button", "select", "svg", "iframe",
             "figure", "figcaption", "time"}

# class=/id= fragments that mark non-body boxes (related articles, share
# bars, comment threads, paywall promos...). Bulgarian sites mix Latin and
# transliterated class names, hence rek(lama) and the broad fragments.
# iubenda/cmp/consent: JS cookie-consent banners are injected into the
# RENDERED DOM the browser tier serializes — measured on glasove.com, where
# the iubenda vendor list swamped 100+ paragraphs of every article.
# ⚠️ "sidebar" is deliberately NOT here: as a substring it also matches
# layout classes like "with-sidebar container" that name the MAIN content
# column (measured on glasove.com — it silently zeroed every article);
# sidebar boxes are caught by the token check in class_is_junky instead.
JUNK_CLASS_RE = re.compile(
    r"(related|comment|share|social|newsletter|banner|popup|modal|"
    r"subscribe|promo|advert|\.ad\b|rek?lama|cookie|gdpr|menu|navigation|"
    r"breadcrumb|paging|pagination|tags?-|most.?read|read.?also|see.?also|"
    r"video.?list|gallery|autorow|hotnews|topnews|iubenda|iub|cmp|consent)", re.I)


def class_is_junky(cls):
    if any(tok.lower().startswith("sidebar") for tok in cls.split()):
        return True  # sidebar, sidebar-right, sidebar_widget — but NOT with-sidebar
    return bool(JUNK_CLASS_RE.search(cls))

MIN_PARA_CHARS = 30          # shorter <p> blocks are dek/teaser/nav residue
LINK_SOUP_RATIO = 0.6        # >60% linked text + short => "related" teaser

# Paragraphs matching this at the START read as site chrome, never prose.
NAVISH_START_RE = re.compile(
    r"^(новини от|последни новини|топ новини|виж още|още от|прочети|сподели|"
    r"абонирай|реклама|контакти|условия|поверителност|rss|обяви|начало|меню|"
    r"търсене|facebook|коментари|подобни|по темата|темата в|източник|вашето "
    r"мнение)\b", re.I)


def junkish(text):
    """True when a paragraph reads as site chrome rather than prose: pipes
    (title/menu residue), symbol or digit soup, numeric-token runs
    (calendars, counters), or a leading nav word. Used ONLY to qualify flow
    pieces and to trim paragraph lists from the ENDS — never to drop middle
    paragraphs of a <p>-based extraction. Note: there is no short-word rule —
    Bulgarian prose is ~35% two-letter function words (от, на, се, да...) and
    any such threshold misfires on real text (measured on moreto.net)."""
    if len(text) < MIN_PARA_CHARS:
        return True
    if "|" in text:
        return True
    letters = sum(ch.isalpha() or ch.isspace() for ch in text)
    if letters / max(len(text), 1) < 0.8:
        return True
    tokens = [w for w in text.split() if w]
    stripped = [w.strip(".,;:!()?\"«»„“”-–—") for w in tokens]
    numeric = sum(1 for w in stripped if w.isdigit())
    if stripped and numeric / len(stripped) > 0.5:
        return True
    if NAVISH_START_RE.match(text.strip()):
        return True
    return False


def trim_junk(paras):
    s, e = 0, len(paras)
    while s < e and junkish(paras[s]):
        s += 1
    while e > s and junkish(paras[e - 1]):
        e -= 1
    return paras[s:e]


class BodyExtractor(HTMLParser):
    """Collects <p> paragraph text outside junk subtrees, preferring those
    inside an <article> wrapper. Legacy sites without <p> get a fallback:
    free text is accumulated per text node (tag events split pieces) and the
    LONGEST CONTIGUOUS RUN of qualifying pieces becomes the body — measured
    on moreto.net this cleanly skips an anti-adblock popup that duplicates
    the lede plus every menu, keeping only the article's own text run.
    Tolerant of unbalanced tags (implicit closes) via stack popping on the
    nearest matching open tag."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []           # [(tag, junky)]
        self.junk = 0
        self.in_article = 0
        self.in_a = 0
        self.headings = 0         # h1-h3 outside junk (article gate signal)
        self.cur = None           # current <p> pieces
        self.cur_link = 0         # chars contributed inside <a>
        self.cur_total = 0
        self.cur_in_article = False
        self.paras = []           # all accepted <p> paragraphs
        self.article_paras = []   # those opened inside <article>
        self.seen = set()
        self.flow_items = []      # [(text, total_chars, linked_chars)]
        self.flow_buf = None      # [parts, total, linked]

    # -- flow piece bookkeeping (any tag event ends the current piece)

    def _close_flow(self):
        if self.flow_buf is not None:
            self.flow_items.append(
                ("".join(self.flow_buf[0]), self.flow_buf[1], self.flow_buf[2]))
            self.flow_buf = None

    def handle_starttag(self, tag, attrs):
        self._close_flow()
        if tag == "br":
            if self.cur is not None:
                self.cur.append("\n")
            return
        if tag in VOID_TAGS:
            return
        ad = dict(attrs)
        cls = f"{ad.get('class') or ''} {ad.get('id') or ''}"
        junky = (tag in JUNK_TAGS
                 or class_is_junky(cls)
                 or ad.get("role") in ("navigation", "complementary",
                                       "contentinfo", "banner", "search"))
        if tag in ("h1", "h2", "h3") and not junky and self.junk == 0:
            self.headings += 1
        if tag == "article":
            self.in_article += 1
        if tag == "a":
            self.in_a += 1
        if tag == "p" and self.cur is None and self.junk == 0:
            self.cur = []
            self.cur_link = 0
            self.cur_total = 0
            self.cur_in_article = self.in_article > 0
        self.stack.append((tag, junky))
        if junky:
            self.junk += 1

    def handle_endtag(self, tag):
        self._close_flow()
        if tag in VOID_TAGS:
            return
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                popped = self.stack[i:]
                del self.stack[i:]
                for t, j in popped:
                    if j:
                        self.junk -= 1
                    if t == "article" and self.in_article:
                        self.in_article -= 1
                    if t == "a" and self.in_a:
                        self.in_a -= 1
                    if t == "p":
                        self._close_para()
                return
        # unmatched close: ignore

    def handle_data(self, data):
        if self.cur is not None:
            if self.junk == 0:
                self.cur.append(data)
                self.cur_total += len(data)
                if self.in_a:
                    self.cur_link += len(data)
            return
        if self.junk == 0:
            if self.flow_buf is None:
                self.flow_buf = [[], 0, 0]
            self.flow_buf[0].append(data)
            self.flow_buf[1] += len(data)
            if self.in_a:
                self.flow_buf[2] += len(data)

    def _close_para(self):
        if self.cur is None:
            return
        text = re.sub(r"\s+", " ", "".join(self.cur)).strip()
        ok = (len(text) >= MIN_PARA_CHARS
              and not (self.cur_total
                       and self.cur_link / self.cur_total > LINK_SOUP_RATIO
                       and len(text) < 250)
              and text not in self.seen)
        if ok:
            self.seen.add(text)
            (self.article_paras if self.cur_in_article else self.paras).append(text)
        self.cur = None

    def close(self):
        self._close_flow()
        super().close()
        self._close_para()

    def _flow_paragraphs(self):
        runs, cur = [], []
        for text, total, linked in self.flow_items:
            t = re.sub(r"\s+", " ", text).strip()
            if not t:
                continue  # whitespace-only pieces never break a run
            if (len(t) >= MIN_PARA_CHARS and not junkish(t)
                    and (not total or linked / total <= LINK_SOUP_RATIO)
                    and t not in self.seen):
                cur.append(t)
            elif cur:
                runs.append(cur)
                cur = []
        if cur:
            runs.append(cur)
        if not runs:
            return []
        best = max(runs, key=lambda r: sum(len(x) for x in r))
        return best

    def paragraphs(self):
        if self.article_paras:
            paras = self.article_paras
        elif self.paras:
            paras = self.paras
        else:
            paras = self._flow_paragraphs()
        return trim_junk(paras)


def extract_body(html_text):
    ex = BodyExtractor()
    try:
        ex.feed(html_text)
        ex.close()
    except Exception:
        pass
    return ex.paragraphs(), ex.headings


# ----------------------------------------------------------------- metadata

JSONLD_TYPES = {"newsarticle", "article", "blogposting", "reportagenewsarticle",
                "backgroundnewsarticle", "opinionnewsarticle",
                "analysisnewsarticle", "satiricalarticle"}


def _jsonld_blocks(html_text):
    blocks = []
    for m in re.finditer(
            r"<script[^>]*type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>",
            html_text, re.S | re.I):
        raw = m.group(1).strip()
        dec = json.JSONDecoder()
        idx = 0
        while idx < len(raw):
            while idx < len(raw) and raw[idx] not in "{[":
                idx += 1
            if idx >= len(raw):
                break
            try:
                obj, end = dec.raw_decode(raw, idx)
                blocks.append(obj)
                idx = end
            except ValueError:
                idx += 1
    return blocks


def _jsonld_nodes(obj):
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            yield from _jsonld_nodes(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _jsonld_nodes(v)


def _jsonld_str(v):
    if v is None:
        return None
    if isinstance(v, str):
        return v.strip() or None
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, dict):
        return _jsonld_str(v.get("name") or v.get("@id"))
    if isinstance(v, list):
        parts = [s for s in (_jsonld_str(x) for x in v) if s]
        return ", ".join(parts) or None
    return None


def jsonld_article(html_text):
    """The highest-scoring Article-ish node across all JSON-LD blocks
    (pages often carry several — BreadcrumbList, Organization, ItemList)."""
    best, best_score = None, -1
    for block in _jsonld_blocks(html_text):
        for node in _jsonld_nodes(block):
            if not isinstance(node, dict):
                continue
            t = node.get("@type", "")
            types = t if isinstance(t, list) else [t]
            if not any(str(x).lower() in JSONLD_TYPES for x in types):
                continue
            score = sum(k in node for k in
                        ("headline", "datePublished", "author",
                         "articleSection", "articleBody", "description"))
            if score > best_score:
                best, best_score = node, score
    return best


def html_unescape2(s):
    import html
    return html.unescape(html.unescape(s))


def parse_metas(html_text):
    metas = {}
    for m in re.finditer(r"<meta\s[^>]*>", html_text, re.I):
        tag = m.group(0)

        def attr(name):
            am = re.search(rf'{name}\s*=\s*"([^"]*)"|{name}\s*=\s*\'([^\']*)\'',
                           tag, re.I)
            return (am.group(1) or am.group(2)) if am else None

        key = attr("property") or attr("itemprop") or attr("name")
        val = attr("content")
        if key and val:
            k = key.strip().lower()
            if k not in metas:
                metas[k] = html_unescape2(val.strip())
    return metas


BG_MONTHS = {
    "януари": 1, "февруари": 2, "март": 3, "април": 4, "май": 5, "юни": 6,
    "юли": 7, "август": 8, "септември": 9, "октомври": 10, "ноември": 11,
    "декември": 12,
}


def normalize_date(raw):
    if not raw:
        return None
    dt = fla.parse_dt(raw)
    if dt is None:
        m = re.search(r"(\d{1,2})\s+([а-яё]+)\s+(\d{4})", raw.strip().lower())
        if m and m.group(2) in BG_MONTHS:
            try:
                dt = datetime(int(m.group(3)), BG_MONTHS[m.group(2)],
                              int(m.group(1)), tzinfo=timezone.utc)
            except ValueError:
                pass
    if dt is None:
        return raw.strip()  # keep the site's own string rather than losing it
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def strip_site_suffix(title, site_name, domain):
    """Drop trailing ' - SiteName' / ' | Новини от X' decorations. Only strips
    when the trailing segment names the site/brand (or a generic news-word
    segment), so a headline that legitimately ends with a dash phrase is kept."""
    if not title:
        return title
    brands = {b.lower() for b in (site_name or "", domain.split(".")[0] if domain else "")
              if b and len(b) >= 3}
    m = re.search(r"\s+[-–|·]\s+(.{1,45})$", title)
    while m:
        seg = m.group(1).lower()
        if any(b in seg for b in brands) or re.search(
                r"(новини|news|вестник|портал|press|медиа|джърнал|portal)", seg):
            title = title[:m.start()].rstrip(" -–|·")
            m = re.search(r"\s+[-–|·]\s+(.{1,45})$", title)
        else:
            break
    return title


def extract_record(html_text, domain, url, list_published=None):
    ld = jsonld_article(html_text) or {}
    metas = parse_metas(html_text)
    site_name = metas.get("og:site_name")

    title = (_jsonld_str(ld.get("headline")) or _jsonld_str(ld.get("name"))
             or metas.get("og:title")
             or fla.extract_title_from_html(html_text.encode("utf-8")))
    title = strip_site_suffix(title, site_name, domain)
    published = normalize_date(
        _jsonld_str(ld.get("datePublished"))
        or metas.get("article:published_time")
        or metas.get("datepublished")
        or list_published)
    author = (_jsonld_str(ld.get("author"))
              or metas.get("article:author") or metas.get("author"))
    topic = (_jsonld_str(ld.get("articleSection"))
             or metas.get("article:section")
             or metas.get("parsely-section") or metas.get("section"))
    keywords = _jsonld_str(ld.get("keywords")) or metas.get("keywords")
    description = (_jsonld_str(ld.get("description"))
                   or metas.get("og:description") or metas.get("description"))

    paras, headings = extract_body(html_text)
    content = _jsonld_str(ld.get("articleBody")) or ("\n\n".join(paras) or None)

    # Listing/homepage protection: real article bodies yield >= 2 qualifying
    # paragraphs, while listing pages' teaser text is link-soup (dropped by
    # the extractor) and their menus fall under junkish(). Heading counts
    # turned out NOT to discriminate (measured: a dnes.bg article carries 36
    # h1-h3 vs 58-89 on listing pages) so they're tracked but not gating.
    is_article = bool(ld) or metas.get("og:type") == "article" or len(paras) >= 2

    rec = {
        "domain": domain,
        "url": url,
        "title": title,
        "published": published,
        "author": author or None,
        "topic": topic or None,
        "keywords": keywords or None,
        "description": description or None,
        "site_name": site_name or None,
        "content": content,
        "content_chars": len(content) if content else 0,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
    return rec, is_article


# ------------------------------------------------------------------- fetch

def decode_html(body, content_type=""):
    ct = (content_type or "").lower()
    m = re.search(r"charset=([\w\-]+)", ct)
    if m:
        try:
            return body.decode(m.group(1))
        except (LookupError, UnicodeDecodeError):
            pass
    head = body[:2048].decode("ascii", errors="ignore")
    m = re.search(r'charset=["\']?([\w\-]+)', head, re.I)
    if m:
        try:
            return body.decode(m.group(1))
        except (LookupError, UnicodeDecodeError):
            pass
    try:
        return body.decode("utf-8")
    except UnicodeDecodeError:
        # older BG sites still serve windows-1251
        return body.decode("cp1251", errors="replace")


def fetch_html(url):
    req = urllib.request.Request(fla._normalize_url(url), headers={
        "User-Agent": fla.UA,
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "bg-BG,bg;q=0.9,en;q=0.8",
        "Referer": "https://www.google.com/",
    })
    with urllib.request.urlopen(req, timeout=fla.TIMEOUT,
                                context=fla._SSL_CTX) as resp:
        ctype = resp.headers.get("Content-Type", "")
        body = resp.read()
    if body[:2] == b"\x1f\x8b":
        body = gzip.decompress(body)
    return decode_html(body, ctype)


# ------------------------------------------------------------------- files

def article_filename(url, published):
    seg = [s for s in re.split(r"/+", urlsplit(url).path) if s]
    slug = seg[-1] if seg else ""
    slug = re.sub(r"\.(html?|php|aspx?)$", "", slug, flags=re.I)
    slug = re.sub(r"[_+]", "-", slug)
    slug = re.sub(r"[^0-9A-Za-zА-Яа-яЁё\-]", "", slug)
    slug = re.sub(r"-{2,}", "-", slug).strip("-")[:60]
    h = hashlib.md5(url.encode()).hexdigest()[:8]
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", published or "")
    date = m.group(0).replace("-", "") if m else "nodate"
    return f"{date}-{slug or 'article'}-{h}.json"


def existing_urls(folder):
    urls = set()
    if not folder.exists():
        return urls
    for p in folder.glob("*.json"):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            if d.get("url"):
                urls.add(d["url"])
        except (json.JSONDecodeError, OSError):
            continue
    return urls


# --------------------------------------------------------------------- main

def main():
    args = list(sys.argv[1:])
    delay = DELAY_DEFAULT
    urls_file = None
    prefetched = None
    for a in list(args):
        if a.startswith("--delay="):
            delay = float(a.split("=", 1)[1])
            args.remove(a)
        elif a.startswith("--urls-file="):
            urls_file = a.split("=", 1)[1]
            args.remove(a)
        elif a.startswith("--prefetched="):
            prefetched = a.split("=", 1)[1]
            args.remove(a)
    if not args:
        print(json.dumps({"error": "usage",
                          "detail": "save_articles.py <domain> [N] [--delay=S] "
                                    "[--urls-file=F | --prefetched=F.jsonl]"}))
        sys.exit(1)
    domain = args[0]
    want = int(args[1]) if len(args) > 1 else 5

    html_map = {}  # url -> page HTML, when pages were prefetched via browser
    if prefetched:
        # Browser-fetched pages (the browser_only tier): one JSON line per
        # article, {"url", "html"} — no network happens in this mode at all.
        with open(prefetched, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                d = json.loads(line)
                if d.get("url") and d.get("html"):
                    html_map[d["url"]] = d
        articles = [{"url": u, "title": d.get("title"),
                     "published": d.get("published")}
                    for u, d in html_map.items()]
        list_method, order_confidence, listed_count, warning = (
            "prefetched_browser", "dom_order_unconfirmed", len(articles), None)
    elif urls_file:
        # Browser-harvested links (homepage DOM scrape) but article pages are
        # plain-HTTP fetchable: one URL per line, '#' comments allowed.
        articles = []
        for line in open(urls_file, encoding="utf-8"):
            u = line.strip()
            if u and not u.startswith("#"):
                articles.append({"url": u})
        list_method, order_confidence, listed_count, warning = (
            "urls_file_browser_harvest", "dom_order_unconfirmed", len(articles), None)
    else:
        try:
            proc = subprocess.run(
                [sys.executable, str(LISTER), domain, str(want)],
                capture_output=True, text=True, timeout=LISTER_TIMEOUT)
        except subprocess.TimeoutExpired:
            print(json.dumps({"domain": domain, "error": "fetch_failed",
                              "detail": f"lister exceeded {LISTER_TIMEOUT}s"}))
            sys.exit(4)
        try:
            listed = json.loads(proc.stdout)
        except json.JSONDecodeError:
            print(json.dumps({"domain": domain, "error": "fetch_failed",
                              "detail": f"lister printed unparseable output: "
                                        f"{proc.stdout[:200]} {proc.stderr[:200]}"}))
            sys.exit(4)
        if proc.returncode != 0 or "error" in listed:
            # propagate the lister's own error JSON verbatim (needs_browser,
            # blocked_captcha, domain_not_in_registry, ...) with its exit code
            print(json.dumps(listed, ensure_ascii=False))
            sys.exit(proc.returncode or 3)
        articles = listed.get("articles", [])
        list_method = listed.get("method")
        order_confidence = listed.get("order_confidence")
        listed_count = listed.get("count", 0)
        warning = listed.get("warning")

    folder = DATA_DIR / domain
    have = existing_urls(folder)
    saved, failed = 0, []
    for art in articles:
        url = art.get("url")
        if not url:
            continue
        if url in have:
            continue
        if urlsplit(url).path in ("", "/"):
            failed.append({"url": url, "detail": "non_article_page (homepage)"})
            continue
        try:
            if html_map:
                html_text = html_map[url]["html"]
            else:
                html_text = fetch_html(url)
            rec, is_article = extract_record(html_text, domain, url,
                                             art.get("published"))
        except (urllib.error.URLError, urllib.error.HTTPError) as e:
            failed.append({"url": url, "detail": str(e)})
            continue
        except Exception as e:  # a malformed page must not sink the batch
            failed.append({"url": url, "detail": f"{type(e).__name__}: {e}"})
            continue
        if not is_article:
            failed.append({"url": url, "detail": "non_article_page "
                                                 "(no Article JSON-LD, og:type != article, "
                                                 "and body failed the paragraph gate)"})
            continue
        if not rec["title"] and not rec["content"]:
            failed.append({"url": url, "detail": "no title and no content extracted"})
            continue
        folder.mkdir(parents=True, exist_ok=True)
        (folder / article_filename(url, rec["published"])).write_text(
            json.dumps(rec, ensure_ascii=False) + "\n", encoding="utf-8")
        saved += 1
        if not html_map:
            time.sleep(delay)

    summary = {
        "domain": domain,
        "dir": str(folder.relative_to(Path.cwd())) if _under_cwd(folder) else str(folder),
        "requested": want,
        "listed": listed_count,
        "already_present": sum(1 for a in articles if a.get("url") in have),
        "saved": saved,
        "failed": failed,
        "list_method": list_method,
        "order_confidence": order_confidence,
    }
    if warning:
        summary["warning"] = warning
    print(json.dumps(summary, ensure_ascii=False))
    if saved == 0 and failed:
        sys.exit(4)
    sys.exit(0)


def _under_cwd(folder):
    try:
        folder.relative_to(Path.cwd())
        return True
    except ValueError:
        return False


if __name__ == "__main__":
    main()
