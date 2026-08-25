#!/usr/bin/env python3
"""
Save the latest N full articles from one registry domain as individual JSON
files under news/data/<domain>/.

Usage:
    python3 save_articles.py <domain> [N] [--delay=SECONDS] [--min-body=N]
                             [--retry-rejected] [--no-cache]
                             [--no-quarantine]
                             [--urls-file=F | --prefetched=F.jsonl]
    python3 save_articles.py <domain> --apply-quarantine [--apply]
    python3 save_articles.py <domain> --reextract [--allow-fetch]
                             [--allow-shrink] [--prune-cache] [--dedupe]
                             [--min-body=N] [--delay=S]

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
       ...and then a BODY GATE, because the article gate alone is satisfied by
       a page with valid JSON-LD, a real headline and NO extracted body at all
       (measured: 26% of the first full sweep's corpus, whole domains at 100%).
       A record whose body is missing, shorter than --min-body, or merely a
       restatement of its own headline is REJECTED rather than saved:
           title_as_body | thin_body
    4. Writes one JSON file per article, named
       <YYYYMMDD|nodate>-<url-slug>-<md5_8>.json, where the day is the
       PUBLICATION day in Europe/Sofia (the newsroom's own clock) while the
       stored `published` stays UTC — one is a calendar day, the other an
       instant, and deriving the bucket from UTC filed everything published
       00:00-02:59 local under the previous day.

    Identity is the CANONICAL url (canonical_url): scheme, host case, `www.`,
    port, trailing slash, fragment and tracking parameters are normalised away
    before anything is compared, while the stored `url` stays the real
    fetchable one. Publish dates with no offset are read as Europe/Sofia, not
    UTC, and a date more than a day in the future is refused rather than
    stored.
    5. Caches the page HTML, gzipped, under news/data/_html/<domain>/ keyed by
       a hash of the URL — written BEFORE the gates, so a rejected page is
       recoverable too.

Exit codes for --reextract: 0 whenever the pass completed (an all-unchanged
re-run included), 4 only when it could do nothing and something failed.

--reextract rebuilds stored records from that cache with NO network, and
promotes any ledgered rejection whose page now yields a real body. It is what
makes an extractor fix reach the articles it was written for: dedupe is by
stored URL, so before the cache existed every improvement to BodyExtractor
reached only articles saved after it, and the only documented remedy — delete
the folder and re-fetch — destroys articles a structurally stale source can
never list again. --allow-fetch fills the cache for records that predate it.

Files already present (matched by the "url" field inside them) are never
refetched or rewritten — re-running tops a folder up incrementally with
only the new articles. URLs the body gate rejected are remembered too, in
news/data/_rejected/<domain>.jsonl, so a nightly run does not re-fetch the
same dead page for ever; --retry-rejected ignores that ledger for one run
(use it after an extractor fix).

Prints ONE JSON summary object to stdout:
    {"domain","dir","dir_exists","requested","listed","already_present",
     "saved","rejected","skipped_rejected","rejected_ledger","min_body",
     "quarantined","quarantine_reason","newest_stored",
     "newest_stored_age_days","retry_queued","retry_exhausted",
     "failed":[{"url","detail"}],"list_method","order_confidence"}
plus the lister's "warning" when it flagged a stale/unconfirmed source.
Note "rejected" is a strict SUBSET of "failed" — a body-gate rejection is
counted in both — so the outcome counts do not sum to "listed".

DATA_BG_ROOT overrides the repository root (same convention as
analyze_articles.py and build_app_data.py); the regression suite is
scripts/test_save_articles.py.

Stdlib only. Exit codes: 0 success (partial per-article failures live in
the summary); 2/3/4 propagate the lister's meaning for the list stage; 4
also when nothing could be saved this run.
"""
import sys
import os
import re
import json
import gzip
import time
import hashlib
import csv
import subprocess
import tempfile
import urllib.request
import urllib.error
from html.parser import HTMLParser
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

SCRIPT_DIR = Path(__file__).resolve().parent
# DATA_BG_ROOT overrides the repository root, matching analyze_articles.py and
# build_app_data.py — it is what lets the regression suite point this script at
# a throwaway tree instead of the real corpus. LISTER is code rather than data,
# so it stays beside this file whatever the data root is.
REPO_ROOT = Path(os.environ.get("DATA_BG_ROOT") or SCRIPT_DIR.parents[1])
DATA_DIR = REPO_ROOT / "news" / "data"
LISTER = SCRIPT_DIR / "fetch_latest_articles.py"

sys.path.insert(0, str(SCRIPT_DIR))
import fetch_latest_articles as fla  # noqa: E402 - shared fetch/parse/date helpers

DELAY_DEFAULT = 0.4  # seconds between article-page fetches, same host

# The BODY GATE floor. Deliberately the same number as analyze_articles.py's
# MIN_CONTENT_CHARS: below it the analysis layer flags a record
# suspect_too_short and the LLM judges it `too_short`, so anything this saver
# writes under the floor is a record that costs a judgement call and can only
# ever come back "this is not an article". Measured on the first full sweep:
# 1,284 of 4,925 stored records sat under it, 600 of them holding nothing but
# their own headline. Override per run with --min-body=N for a source that
# genuinely publishes briefs.
MIN_BODY_CHARS = 400
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
        # JSON-LD lives inside a <script> block, so the HTML parser never
        # decodes it. <meta> values already go through html_unescape2 in
        # parse_metas and body paragraphs through convert_charrefs — this is
        # the third path, and it was the only one left raw. Measured before
        # the fix: 197 of 4,929 stored records (78 titles, 138 bodies) carried
        # entities like "&#8222;Ергенът&#8220;" verbatim into the LLM prompts,
        # the story-clustering keys and the app-data build, where a headline
        # spelled that way is a different string for every comparison.
        return html_unescape2(v).strip() or None
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


# Bulgarian newsrooms publish in local time and frequently emit a timestamp
# with no offset at all. Reading those as UTC shifts every one of them by the
# 2-3 hours Sofia is ahead, which moves anything published after 21:00 local
# onto the PREVIOUS day — including in article_filename, which is what the
# whole date-bucketing scheme keys on. Measured before this: 4,354 of 4,925
# stored records carried "+00:00".
SOFIA_TZ = ZoneInfo("Europe/Sofia")

# A publish date this far ahead of now is not a timezone artifact, it is a
# broken feed or a scheduled-publication placeholder. Measured: 5 stored
# records were future-dated, capital.bg by nearly two months.
MAX_FUTURE_SKEW = timedelta(days=1)

# A value with no wall clock states a DAY. parse_dt resolves it to naive
# MIDNIGHT, which in Sofia is 21:00 UTC the day BEFORE — the same off-by-one
# the timezone fix exists to end, and the reason the Cyrillic branch anchors at
# noon. Both parse paths must use the same anchor, or a sitemap <lastmod>
# (routinely date-only, and the lister's own list_published source) files under
# the previous day. A WRITTEN-OUT midnight ("2026-08-06T00:00:00") is
# deliberately left alone: the site stated a time, and we do not overrule it.
_DAY_ONLY_RE = re.compile(r"^\s*(\d{4}-\d{2}-\d{2}|\d{8})\s*$")

# RFC 5322: a -0000 offset means "UTC, sender withholding their local time".
# parsedate_to_datetime returns it NAIVE, so without this it would be read as
# Sofia local and shifted by three hours.
_RFC2822_MINUS_ZERO_RE = re.compile(r"-0000\s*$")


def normalize_date(raw, now=None):
    """Normalise a publish date to a UTC ISO-8601 string.

    Returns the site's own string unchanged when it cannot be parsed (better
    than losing it), and None when the value is a date we refuse to store."""
    if not raw:
        return None
    dt = fla.parse_dt(raw)
    naive = dt is not None and dt.tzinfo is None
    if dt is None:
        m = re.search(r"(\d{1,2})\s+([а-яё]+)\s+(\d{4})", raw.strip().lower())
        if m and m.group(2) in BG_MONTHS:
            try:
                # Anchored at NOON, not midnight. A Bulgarian date-only value
                # ("24 август 2026") states a DAY and carries no wall clock;
                # midnight Sofia converts to 21:00 UTC the day BEFORE, so the
                # article would file under the wrong day in article_filename —
                # the same off-by-one the timezone fix exists to end. Noon is
                # the only anchor for which the UTC day equals the stated day
                # in both EET and EEST.
                dt = datetime(int(m.group(3)), BG_MONTHS[m.group(2)],
                              int(m.group(1)), 12, 0)
                naive = True
            except ValueError:
                pass
    if dt is None:
        return raw.strip()  # keep the site's own string rather than losing it
    if naive:
        if _RFC2822_MINUS_ZERO_RE.search(raw):
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            if (_DAY_ONLY_RE.match(raw)
                    and (dt.hour, dt.minute, dt.second) == (0, 0, 0)):
                dt = dt.replace(hour=12)
            # The publisher's own wall clock, not UTC. ZoneInfo handles the
            # EET/EEST switch, so a fixed +02:00 (wrong all summer) is not an
            # option either. A DST fold or a nonexistent local hour is
            # resolved by ZoneInfo's default (fold=0) — an hour either way on
            # two nights a year, which no consumer here can tell apart from
            # ordinary publishing.
            dt = dt.replace(tzinfo=SOFIA_TZ)
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    if dt.astimezone(timezone.utc) - now > MAX_FUTURE_SKEW:
        # Refuse rather than store. A future publish date sorts an article to
        # the top of every "latest" view for as long as it stays in the
        # future, and the ordering is what every consumer here trusts.
        return None
    return dt.astimezone(timezone.utc).isoformat()


# The separators a Bulgarian newsroom puts between a headline and its brand
# tail. The EM-DASH is load-bearing: offnews.bg uses it exclusively, and
# without it every offnews headline kept "— OFFNews" (frozen in the
# rendered__offnews fixture, which is what surfaced it).
_TITLE_SEP_RE = re.compile(r"^(.*)\s+[-–—|·]\s+(.{1,45})$")
_TITLE_TAIL_STRIP = " -–—|·"
_NEWSWORD_RE = re.compile(
    r"(новини|news|вестник|портал|press|медиа|джърнал|portal)")


def strip_site_suffix(title, site_name, domain):
    """Drop trailing ' - SiteName' / ' | Новини от X' decorations. Only strips
    when the trailing segment names the site/brand (or a generic news-word
    segment), so a headline that legitimately ends with a dash phrase is kept.

    ⚠️ The match must be RIGHTMOST-first, one segment at a time. A leftmost
    `re.search` grabs the first separator whose tail merely FITS the 45-char
    window, so on 'Трансферите в Първа лига - лято 2026 г. - Новини СЕГА' the
    segment was the whole 'лято 2026 г. - Новини СЕГА', which contains
    'новини', and the legitimate '- лято 2026 г.' was deleted along with the
    brand. Frozen in the healthy__segabg fixture. The greedy `^(.*)` is what
    anchors each pass to the LAST separator instead."""
    if not title:
        return title
    brands = {b.lower() for b in (site_name or "", domain.split(".")[0] if domain else "")
              if b and len(b) >= 3}
    while True:
        m = _TITLE_SEP_RE.match(title)
        if not m:
            break
        seg = m.group(2).lower()
        if any(b in seg for b in brands) or _NEWSWORD_RE.search(seg):
            title = m.group(1).rstrip(_TITLE_TAIL_STRIP)
        else:
            break
    return title


def extract_record(html_text, domain, url, list_published=None):
    ld = jsonld_article(html_text) or {}
    metas = parse_metas(html_text)
    site_name = metas.get("og:site_name")

    # The 4th source is the lister's raw <title>/og:title reader, which cannot
    # unescape on its own (it shadows the stdlib `html` module with a local),
    # so it is wrapped here — same convention as the three sources above it.
    title = (_jsonld_str(ld.get("headline")) or _jsonld_str(ld.get("name"))
             or metas.get("og:title")
             or html_unescape2(
                 fla.extract_title_from_html(html_text.encode("utf-8")) or "")
             or None)
    title = strip_site_suffix(title, site_name, domain)
    # Per SOURCE, first that survives — not `a or b or c` then normalise. A
    # future JSON-LD date is refused (returns None), and with the `or` chain
    # resolving first, that refusal also discarded a perfectly good
    # article:published_time and dropped the article out of every "latest"
    # view. The bad value on the page is bad; the next one may not be.
    published = next(
        (d for d in (normalize_date(src) for src in (
            _jsonld_str(ld.get("datePublished")),
            metas.get("article:published_time"),
            metas.get("datepublished"),
            list_published) if src) if d),
        None)
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


def analysis_sidecar(domain, filename, quarantined=False):
    """The analysis record analyze_articles.py stores 1:1 with a corpus file.

    Keyed by the corpus file's path RELATIVE TO news/data (that module's
    analysis_path_for), so a quarantined record's sidecar would sit under
    _quarantine/<domain>/. In practice it never does: corpus_domains() skips
    _-prefixed directories, so the analysis layer cannot reach a quarantined
    article at all. That is why relocating one DELETES its sidecar rather than
    moving it — the analysis is of an article no longer in the analysable
    corpus, and a "move" between two paths that are the same path was a silent
    no-op."""
    parts = ((QUARANTINE_DIR_NAME, domain) if quarantined else (domain,))
    return DATA_DIR.joinpath("analysis", "articles", *parts, filename)


def write_record(path, rec):
    """Write a record atomically. A record half-written by an interrupted run
    is worse than one not written at all: every reader here (existing_urls,
    stored_records, the analysis queue) treats an unparseable file as absent,
    so a torn write silently drops the article AND leaves a file behind that
    nothing will ever clean up."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(rec, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


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
    """One article page, under the project's own identity and within whatever
    robots.txt allows. The spoofed Chrome string and the fabricated
    "Referer: https://www.google.com/" are gone: impersonating a reader
    arriving from a search result is not something this project should do, and
    measured across all 47 direct-tier domains it was not buying anything."""
    if not fla.robots_allows(url):
        raise fla.RobotsDisallowed(url)
    req = urllib.request.Request(fla._normalize_url(url), headers={
        "User-Agent": fla.UA,
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "bg-BG,bg;q=0.9,en;q=0.8",
    })
    with urllib.request.urlopen(req, timeout=fla.TIMEOUT,
                                context=fla._SSL_CTX) as resp:
        ctype = resp.headers.get("Content-Type", "")
        body = resp.read()
    if body[:2] == b"\x1f\x8b":
        body = gzip.decompress(body)
    return decode_html(body, ctype)


# ------------------------------------------------------------------- files

# ⚠️ `ref`, `source` and `amp` are the risky three: on some sites they could
# in principle address content rather than track a referral. They are stripped
# because in THIS corpus they are measurably referral markers — capital.bg
# appends `?ref=` to in-site links — and because the identity check below is
# one-sided: the only param whose removal could merge two real articles is one
# that carries the article id, and every such site in the registry uses a
# name outside this list (moreto.net's `n=`, which is kept). Re-measure before
# adding a name here; a wrong entry silently merges two articles into one.
_TRACKING_PARAM_RE = re.compile(
    r"^(utm_[a-z_]+|fbclid|gclid|msclkid|yclid|igshid|mc_[ce]id|_ga|"
    r"ref|referrer|source|amp)$", re.I)


def canonical_url(url):
    """The identity this pipeline dedupes on.

    The raw URL is not it: the same article arrives as http/https, with and
    without `www.`, with and without a trailing slash, and with whatever
    tracking parameters the referring link carried. Measured on the first
    corpus: 20 groups of stored records were the same article under two
    spellings, and 53 records carried a query string into the key.

    Deliberately conservative — it normalises SPELLING, never meaning. A
    non-tracking query parameter is kept, because plenty of Bulgarian sites
    still address an article as `novini.php?n=534254` (moreto.net), where
    dropping the query would collapse every article on the site into one."""
    parts = urlsplit(url.strip())
    scheme = "https" if parts.scheme in ("http", "https", "") else parts.scheme
    host = parts.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    if host.endswith(":80") or host.endswith(":443"):
        host = host.rsplit(":", 1)[0]
    path = parts.path or "/"
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/") or "/"
    kept = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
            if not _TRACKING_PARAM_RE.match(k)]
    query = urlencode(kept)
    return urlunsplit((scheme, host, path, query, ""))


def article_filename(url, published):
    seg = [s for s in re.split(r"/+", urlsplit(url).path) if s]
    slug = seg[-1] if seg else ""
    slug = re.sub(r"\.(html?|php|aspx?)$", "", slug, flags=re.I)
    slug = re.sub(r"[_+]", "-", slug)
    slug = re.sub(r"[^0-9A-Za-zА-Яа-яЁё\-]", "", slug)
    slug = re.sub(r"-{2,}", "-", slug).strip("-")[:60]
    h = hashlib.md5(canonical_url(url).encode()).hexdigest()[:8]
    # The DAY bucket is the publication day in the newsroom's own timezone, not
    # the UTC day. `published` itself stays UTC — it is an instant — but this is
    # a calendar day, and Bulgaria is +02:00/+03:00, so a UTC-derived bucket
    # files everything published 00:00-02:59 local under the previous day
    # (measured: 143 of 4,361 stored records sit in that window).
    date = "nodate"
    dt = fla.parse_dt(published or "")
    if dt is not None:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=SOFIA_TZ)
        date = dt.astimezone(SOFIA_TZ).strftime("%Y%m%d")
    elif published:
        m = re.search(r"(\d{4})-(\d{2})-(\d{2})", published)
        date = m.group(0).replace("-", "") if m else "nodate"
    return f"{date}-{slug or 'article'}-{h}.json"


def scan_stored(*folders):
    """One walk over the stored records: (canonical keys, newest publish day).

    Both facts come off the same read because they were two identical walks
    over the same files — at 100 files per domain per run that is a needless
    doubling, and the two could drift on what counts as a record.

    The newest day is deliberately taken over the STORED corpus rather than
    over this run's listing: a run that saved nothing does not itself
    distinguish a quiet day from a dead feed. It is a UTC day (the stored
    `published` is an instant), unlike the filename bucket, which is a Sofia
    calendar day — the two can differ by one for anything published
    00:00-02:59 local."""
    urls, newest = set(), None
    for folder in folders:
        if not folder.exists():
            continue
        for p in folder.glob("*.json"):
            try:
                d = json.loads(p.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            if d.get("url"):
                urls.add(canonical_url(d["url"]))
            pub = d.get("published")
            if isinstance(pub, str) and len(pub) >= 10:
                day = pub[:10]
                if day[:4].isdigit() and day[4:5] == "-" and (
                        newest is None or day > newest):
                    newest = day
    return urls, newest


def existing_urls(*folders):
    """CANONICAL keys of everything already stored, across every folder given.

    Takes several folders because a domain's articles can live in two places:
    the corpus and the quarantine. Reading only one would re-fetch the other's
    articles on every run, for ever."""
    return scan_stored(*folders)[0]


# ------------------------------------------------------------- the body gate

# \\s is Unicode-aware for str patterns, so it already covers NBSP (U+00A0).
# What it does NOT cover is the zero-width family Bulgarian CMS templates
# inject -- a single U+200B between two otherwise identical strings is enough
# to defeat a function whose whole job is exact-shape matching.
_ZERO_WIDTH_RE = re.compile("[\u200b-\u200f\ufeff\u00ad]")
_NORM_RE = re.compile(r"\s+")
_EDGE_PUNCT = " \t\r\n.,;:!?-\u2013\u2014|\u00b7\"'\u00ab\u00bb\u201e\u201c\u201d()[]"

# How much text may trail the headline before the body stops reading as an echo
# of it. A brand tail (" - \u041d\u043e\u0432\u0438\u043d\u0438 \u0412\u0430\u0440\u043d\u0430") is short; a lede is not.
TITLE_ECHO_SLACK = 60


def _norm_for_compare(s):
    """Both sides of the echo comparison must use ONE escaping convention: the
    body arrives decoded (HTMLParser(convert_charrefs=True)) while a JSON-LD or
    <title>-derived headline does not, so "&#8222;X&#8220;" has to fold to the
    real quotation marks before either side is compared."""
    s = _ZERO_WIDTH_RE.sub("", html_unescape2(s or ""))
    return _NORM_RE.sub(" ", s).strip(_EDGE_PUNCT).casefold()


def titles_match(stored, fresh):
    """Whether a re-fetched page is still the article the stored record names.

    A URL can be recycled, redirected, or answer 200 with an error page, and a
    character count alone cannot tell "the extractor improved" from "this is a
    different article" -- measured, a 'Страницата не е намерена' page replaced
    a good record because it happened to be longer. Compared on the same
    normalised form the echo gate uses, and forgiving of a site renaming its
    own brand tail: one being a prefix of the other is a match."""
    a, b = _norm_for_compare(stored), _norm_for_compare(fresh)
    if not a or not b:
        return True  # nothing to compare on; other guards still apply
    return a == b or a.startswith(b) or b.startswith(a)


def gate_reason(rec, is_article, min_body, slack):
    """None when the record clears the body gate, else the ledger reason.

    THE ONE DEFINITION. The save path, --reextract pass 1 and --reextract
    pass 2 all ask the same question and must not restate it — the repo's own
    convention (kzk_effective_suspension, declared_label, is_declared_holding:
    name the rule once, never restate it at a call site). Three hand-written
    copies had already diverged: the two re-extraction copies collapsed both
    reasons into one, losing the forensic breadcrumb the ledger exists for."""
    if not is_article:
        return "non_article_page"
    if body_is_title(rec.get("content"), rec.get("title"), slack=slack):
        return "title_as_body"
    if (rec.get("content_chars") or 0) < min_body:
        return "thin_body"
    return None


def echo_slack_for(min_body):
    """The echo slack must never approach the length floor the operator chose:
    at --min-body=80 a fixed 60 would reject a brief consisting of a headline
    plus 59 characters of real prose."""
    return min(TITLE_ECHO_SLACK, max(0, min_body // 4))


def body_is_title(content, title, slack=TITLE_ECHO_SLACK):
    """True when the extracted "body" is really just the headline -- the shape
    a page produces when the paragraph extractor found nothing and the only
    text left standing was the <title> or og:title. Measured across whole
    domains (24chasa.bg, novavarna.net, narod.bg, toest.bg, e-vestnik.bg):
    600 of 4,925 stored records.

    The comparison allows a trailing site decoration, because the title on the
    record has been through strip_site_suffix and the body has not -- so a body
    reading "Headline - \u041d\u043e\u0432\u0438\u043d\u0438 \u0412\u0430\u0440\u043d\u0430" must still match a title of "Headline".
    A real article whose lede repeats its own headline is NOT caught: the
    remainder after the headline is then prose, i.e. far longer than a brand
    tail.

    At the DEFAULT floor this rule changes the recorded reason and never the
    outcome -- all 606 echoes in the live corpus are also under 400 chars. Its
    only load-bearing job is the LOWERED-floor case, which is exactly where a
    fixed slack misfires: a genuine brief is its headline plus a sentence, so
    callers scale `slack` down with --min-body (see echo_slack_for) rather than
    swallowing the very population that flag exists to admit."""
    c, t = _norm_for_compare(content), _norm_for_compare(title)
    if not c or not t:
        return False
    if c == t:
        return True
    # Only ever a suffix: a body that merely STARTS with its headline and then
    # continues for a paragraph is an ordinary article, not a title echo.
    return c.startswith(t) and len(c) - len(t) <= slack


QUARANTINE_DIR_NAME = "_quarantine"


def domain_folders(domain):
    """(corpus, quarantine) — the two places a domain's articles can live.

    Reconstructed at four call sites before this existed, and one of them
    (cmd_reextract) had only the corpus half, which made --reextract report
    `records: 0` for every quarantined domain and made --prune-cache unlink
    every one of their cached pages."""
    return DATA_DIR / domain, DATA_DIR / QUARANTINE_DIR_NAME / domain


def registry_flag(domain, prefix):
    """One dated column from the registry row, matched by PREFIX — the columns
    are timestamped and renamed on each refresh (feed_method_aug2026,
    quarantine_aug2026), so nothing here may hard-code a vintage."""
    # fla resolves the registry from its OWN file location, so a test tree
    # pointed at by DATA_BG_ROOT would silently read the real committed CSV.
    csv_path = DATA_DIR / "bg_news_sites.csv"
    try:
        original, fla.CSV_PATH = fla.CSV_PATH, csv_path
        try:
            row, _, _ = fla.load_row(domain)
        finally:
            fla.CSV_PATH = original
    except (OSError, RuntimeError):
        return ""
    if not row:
        return ""
    col = next((h for h in row if h.startswith(prefix)), None)
    return (row.get(col) or "").strip() if col else ""


def quarantine_decision(domain, order_confidence):
    """Where this run's articles belong, and why.

    A structurally stale source publishes actively while its sitemap carries
    years-old dates — measured: dnes.bg stuck at 2018, iskra.bg 2019,
    bnews.bg 2020, investor.bg 2023, bgonair.bg 2025-04, bntnews.bg 2025-12.
    The lister already DETECTS this and the saver stored the articles anyway,
    where they sit indistinguishable from fresh content and enter the analysis
    queue at the same priority.

    Two inputs, deliberately: the runtime signal catches a source that goes
    stale tomorrow, and the curated registry flag settles the cases the runtime
    signal gets wrong in either direction — dnes.bg's staleness is TRANSIENT
    (it served fresh headlines early one day and 2018 URLs for hours after),
    so a runtime-only rule would shuttle its articles between two folders run
    to run."""
    flag = registry_flag(domain, "quarantine_")
    runtime = order_confidence == "stale_source_suspected"
    if flag == "never":
        return False, "registry says never quarantine"
    if flag == "stale_source":
        return True, "registry marks this source structurally stale"
    if flag:
        # An unrecognised verdict is a typo or a convention this code has not
        # learned. Falling through silently would look identical to an empty
        # cell, so the run says so and follows the runtime signal.
        reason = (f"unrecognised registry verdict {flag!r}; following the "
                  f"lister ({order_confidence})")
        return runtime, reason
    if runtime:
        return True, "the lister flagged stale_source_suspected this run"
    return False, ""


# ------------------------------------------------------------- intake state

STATE_DIR_NAME = "_state"

# A URL that has failed this many times stops being retried, and then stays
# exhausted for RETRY_EXHAUSTED_TTL_DAYS. Both halves are needed: the cap alone
# only empties the queue, so a 404 that stays in the sitemap is re-queued by
# the next run's failures and cycles 1 -> 2 -> exhausted -> 1 for ever. The
# first full sweep produced 24 such 404s in one run.
MAX_RETRY_ATTEMPTS = 3

# How often to ignore the stored validators and re-fetch a feed in full. A
# server with a buggy validator can answer 304 for ever; without this the
# source would quietly stop being collected while every run reported success.
UNCONDITIONAL_EVERY_DAYS = 7

# Lister outcomes that are STANDING FACTS about an outlet rather than failures
# to count. A browser-tier domain would otherwise accumulate a failure every
# night for ever and alert as `failing` when nothing is wrong. Everything else
# — including a lister error this code has not seen yet — counts, which is the
# safe direction: a new transient error should raise an alert, not be silently
# excused.
STANDING_LISTER_FACTS = frozenset({
    "needs_browser", "needs_browser_then_fetch", "blocked_captcha",
    "portal_not_newsroom",
    "domain_not_in_registry_and_quick_probe_failed",
    "robots_disallowed", "bot_refused",
})

# Per-article failures that are DECISIONS, not transient errors. These already
# go to the rejection ledger with its own TTL; queueing them here too would
# retry tonight what the gate refused on purpose.
_TERMINAL_FAILURE_RE = re.compile(
    r"^(non_article_page|title_as_body|thin_body|no title and no content"
    r"|robots_disallowed)")


def state_path(domain):
    """One file PER DOMAIN, not one shared file.

    save_all_direct.sh runs six domains at a time through xargs, so a single
    intake.json would have six concurrent writers and no locking — the same
    reason the rejection ledger is per-domain. Lives under news/data/_state/,
    which is already gitignored, already redirected by DATA_BG_ROOT, and
    already skipped by analyze_articles' corpus_domains() (it ignores
    _-prefixed directories)."""
    return DATA_DIR / STATE_DIR_NAME / f"{domain}.json"


def load_state(domain):
    """This domain's intake state, or a fresh one. Never raises: a corrupt
    state file must not stop the run that would have repaired it."""
    path = state_path(domain)
    if path.exists():
        try:
            d = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(d, dict):
                d.setdefault("retry_urls", [])
                return d
        except (json.JSONDecodeError, OSError):
            pass
    return {"domain": domain, "last_attempt_at": None, "last_success_at": None,
            "consecutive_failures": 0, "last_error": None,
            "newest_stored": None, "retry_urls": []}


def save_state(domain, state):
    """Persist atomically. Never raises, for the same reason record_rejection
    does not: this runs after the articles are already on disk, and an escaping
    OSError would print no summary at all."""
    try:
        path = state_path(domain)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1) + "\n",
                       encoding="utf-8")
        tmp.replace(path)
        return True
    except OSError:
        return False


def record_domain_failure(domain, state, error, detail):
    """A domain-level failure, persisted so a nightly report can see a source
    that has been down for a week rather than one that was down tonight."""
    state["last_attempt_at"] = now_iso()
    state["consecutive_failures"] = state.get("consecutive_failures", 0) + 1
    state["last_error"] = {"error": error, "detail": (detail or "")[:400],
                           "at": state["last_attempt_at"]}
    save_state(domain, state)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


# How long an exhausted URL stays exhausted. Without this the cap does NOT
# stop the nightly re-fetch it exists to stop: a 404 that stays in the sitemap
# cycles 1 -> 2 -> exhausted -> 1 for ever and re-appears in retry_exhausted
# every third night. Long enough that a permanently dead URL costs one fetch a
# month; short enough that a page fixed at the source comes back on its own.
RETRY_EXHAUSTED_TTL_DAYS = 30


def merge_retry_queue(existing, failures, stamp, attempted=None,
                      exhausted=None):
    """Next run's retry queue, plus the URLs that have given up.

    Keys on the CANONICAL url throughout. The dedupe against the fresh listing
    already did, so keying the attempt COUNTER on the raw one let a spelling
    change reset `attempts` to 1 for ever — the cap never fired — and let two
    spellings of one article take two queue slots.

    `attempted` is the set of canonical keys this run actually tried. A prior
    entry that was NOT attempted is carried forward unchanged: a --prefetched
    or --urls-file run cannot consult the queue, and rewriting it from that
    run's failures alone silently discarded the whole thing (measured: a
    seeded URL vanished with retry_queued 0 and no retry_exhausted). A prior
    entry that WAS attempted and is absent from `failures` succeeded, and
    leaves.

    A per-article failure that is a DECISION (the body gate, the article gate)
    is never queued — those have the rejection ledger and its own TTL.

    Returns (queue, newly_exhausted, exhausted_index)."""
    attempted = attempted if attempted is not None else set()
    exhausted = dict(exhausted or {})
    cutoff = (datetime.now(timezone.utc)
              - timedelta(days=RETRY_EXHAUSTED_TTL_DAYS)).isoformat()
    exhausted = {k: v for k, v in exhausted.items() if v >= cutoff}

    prior = {}
    for e in existing:
        if isinstance(e, dict) and e.get("url"):
            prior[canonical_url(e["url"])] = e

    queue, newly = {}, []
    for f in failures:
        url, detail = f.get("url"), f.get("detail") or ""
        if not url or _TERMINAL_FAILURE_RE.match(detail):
            continue
        key = canonical_url(url)
        if key in exhausted or key in queue:
            continue
        was = prior.get(key)
        attempts = (was.get("attempts", 0) if was else 0) + 1
        entry = {"url": url, "detail": detail, "attempts": attempts,
                 "first_failed_at": (was or {}).get("first_failed_at", stamp),
                 "last_failed_at": stamp}
        if attempts >= MAX_RETRY_ATTEMPTS:
            exhausted[key] = stamp
            newly.append(entry)
        else:
            queue[key] = entry

    # Carry forward anything this run never got to.
    for key, entry in prior.items():
        if key in queue or key in exhausted or key in attempted:
            continue
        queue[key] = entry

    return list(queue.values()), newly, exhausted


REJECT_DIR_NAME = "_rejected"


def rejected_path(domain):
    return DATA_DIR / REJECT_DIR_NAME / f"{domain}.jsonl"


REJECTED_TTL_DAYS = 30


def rejected_url_map(domain, max_age_days=REJECTED_TTL_DAYS):
    """canonical key -> the RAW ledgered URL.

    --reextract pass 2 promotes a rejection by re-extracting its page, and the
    record it writes must name a URL a reader (and --allow-fetch) can actually
    open. The canonical form normalises SPELLING for dedupe and is not
    guaranteed fetchable — a site that 301s the bare host, or serves only the
    www. form, would be handed a URL that does not resolve."""
    return _read_ledger(domain, max_age_days)


def rejected_urls(domain, max_age_days=REJECTED_TTL_DAYS):
    """URLs a previous run's body gate turned away. Skipping them keeps a
    nightly run from re-fetching the same dead page every night.

    Rejection is deliberately NOT permanent. A page can legitimately gain a
    body later -- a paywall lifted, a wire story fleshed out, a CMS template
    fixed, or (most often) this repo's own extractor improved -- so an entry
    older than max_age_days stops being skipped and the URL is tried again.
    Without that the nightly sweep, which passes no flags, could never recover
    from an over-firing gate on its own. Pass max_age_days=None to skip every
    ledgered URL regardless of age; --retry-rejected skips the ledger
    entirely, which is the right tool immediately after an extractor fix."""
    return set(_read_ledger(domain, max_age_days))


def _read_ledger(domain, max_age_days):
    path = rejected_path(domain)
    urls = {}
    if not path.exists():
        return urls
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max_age_days)
              if max_age_days is not None else None)
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue  # a torn line must not hide the rest of the ledger
            raw = d.get("url")
            if not raw:
                continue
            url = canonical_url(raw)
            if cutoff is not None:
                at = d.get("at")
                try:
                    stamped = datetime.fromisoformat(at) if at else None
                except (TypeError, ValueError):
                    stamped = None
                if stamped is not None:
                    if stamped.tzinfo is None:
                        stamped = stamped.replace(tzinfo=timezone.utc)
                    if stamped < cutoff:
                        # A stale rejection: let this run try the page again.
                        # discard() rather than skipping the line, because a
                        # later entry for the same URL may still be fresh.
                        urls.pop(url, None)
                        continue
            urls[url] = raw
    except OSError:
        return {}
    return urls


def record_rejection(domain, url, reason, chars, title):
    """Append one rejection to the domain ledger. `reason` and `title` are
    forensic breadcrumbs for a human reading the .jsonl -- only `url` and `at`
    are read back by rejected_urls().

    Never raises: this runs inside the per-article loop, and an unguarded
    OSError here would escape before the JSON summary is printed, breaking the
    module's one-object-on-stdout contract. save_all_direct.sh reads empty
    stdout as "skip this domain silently", so a permissions problem would make
    a whole domain vanish from the sweep log with no diagnostic anywhere. A
    failed ledger write costs a re-fetch next run; a failed summary costs the
    run's observability."""
    entry = {"url": url, "reason": reason, "content_chars": chars,
             "title": title, "at": datetime.now(timezone.utc).isoformat()}
    try:
        path = rejected_path(domain)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        return True
    except OSError:
        return False


# ------------------------------------------------------------- the HTML cache

HTML_CACHE_DIR_NAME = "_html"


def html_cache_path(domain, url, _raw_key=False):
    """Keyed by a hash of the CANONICAL url, NOT by the article filename: the
    filename embeds the publish date, which can change between extractions,
    while the URL is the identity every other part of this pipeline dedupes on.

    _raw_key reproduces the PRE-canonicalisation key. It exists only so
    read_html_cache and the prune can still see entries written before the key
    changed — 207 of 208 live entries at the moment it changed, and the cache
    is the artifact whose whole purpose is recovering articles a structurally
    stale source can never list again. Never used for WRITING: an entry read
    through it is re-keyed on its next write."""
    key = url if _raw_key else canonical_url(url)
    h = hashlib.md5(key.encode()).hexdigest()[:16]
    return DATA_DIR / HTML_CACHE_DIR_NAME / domain / f"{h}.json.gz"


def write_html_cache(domain, url, html_text):
    """Persist the page as fetched, gzipped, self-describing.

    This runs BEFORE the body gate, deliberately: a page the gate turns away
    is exactly the page a future extractor fix is meant to rescue, and without
    its HTML on disk the only recovery is another trip to the network -- which
    for a structurally stale source means the article can never be listed
    again. Never raises, for the same reason record_rejection does not: this
    sits in the per-article loop and an escaping OSError would break the
    one-JSON-object-on-stdout contract."""
    try:
        path = html_cache_path(domain, url)
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps({"url": url, "html": html_text,
                              "cached_at": datetime.now(timezone.utc).isoformat()},
                             ensure_ascii=False)
        with gzip.open(path, "wt", encoding="utf-8") as f:
            f.write(payload)
        return True
    except OSError:
        return False


def read_html_cache(domain, url):
    """The cached page, or None when it was never cached or is unreadable.

    Tries the canonical key, then the legacy raw-URL key, so entries written
    before the key changed stay reachable with no migration step. A corrupt
    entry reads as absent rather than raising — a half-written gzip from an
    interrupted run must not stop a whole re-extraction."""
    for path in (html_cache_path(domain, url),
                 html_cache_path(domain, url, _raw_key=True)):
        if not path.exists():
            continue
        try:
            with gzip.open(path, "rt", encoding="utf-8") as f:
                return json.loads(f.read()).get("html")
        except (OSError, EOFError, json.JSONDecodeError, gzip.BadGzipFile):
            continue
    return None


# ------------------------------------------------------------- re-extraction

def stored_records(*folders, on_unreadable=None):
    """Every stored record across the given folders, as (path, dict).

    A file that will not parse is skipped rather than raising — one torn
    record must not stop a whole domain's re-extraction — but the caller may
    pass on_unreadable to be TOLD, so a skipped record is reported rather than
    vanishing from every count the caller then prints."""
    for folder in folders:
        if not folder.exists():
            continue
        for path in sorted(folder.glob("*.json")):
            try:
                yield path, json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError) as e:
                if on_unreadable is not None:
                    on_unreadable(path, e)
                continue


def cmd_reextract(domain, min_body, allow_fetch, allow_shrink, delay,
                  cache_html=True, floor_from_cli=False, prune_cache=False,
                  dedupe=False):
    """Rebuild stored records from CACHED HTML, with no network.

    This is the mode that makes extractor work compounding instead of
    one-shot. Dedupe is by the `url` field inside stored files, so before this
    existed a stored article was never re-fetched or re-extracted -- every
    improvement to BodyExtractor reached only articles saved after it, and the
    documented remedy ("rm -rf the folder and re-run") re-fetches from the
    network, which for a structurally stale source destroys articles that can
    never be listed again. Measured on two stored URLs at the time this was
    written: e-vestnik.bg 87 chars stored against 5,545 from the same page
    under the current extractor, novavarna.net 73 against 936.

    Parameters
      min_body        the gate floor for records that carry no floor of their
                      own (the pre-gate corpus). A record saved under an
                      explicit --min-body carries it as `gate_min_body` and is
                      re-judged against THAT, unless floor_from_cli says the
                      operator named a floor on this invocation.
      floor_from_cli  True when --min-body was passed explicitly, which makes
                      min_body authoritative for every record.
      allow_fetch     fill the cache from the network for records that predate
                      it. Rate-limited by `delay`, and identity-guarded.
      allow_shrink    permit replacing a good body with a shorter one.
      cache_html      persist pages fetched under --allow-fetch.
      prune_cache     delete cache entries for URLs that are in neither the
                      corpus nor the ledger.
      dedupe          collapse records that are the same article under two
                      spellings. REPORTED by default (duplicates_found) and
                      only removed with this flag — consistent with every
                      other destructive path in this module.

    Exit-code semantics live in main(): 0 whenever the pass completed, 4 only
    when it could not do anything AND something failed. Demotions and prunes
    count as work, so an identical re-run does not change the code.

    Two guards, both deliberate:
      * a record whose body would SHRINK is left alone (`shrunk_refused`)
        unless allow_shrink -- a re-extraction runs the CURRENT extractor and a
        regression in it would otherwise overwrite a corpus that was fine;
      * under --allow-fetch a re-fetched page whose headline no longer matches
        the stored one is refused (`identity_refused`). A URL can be recycled,
        redirected, or answer with a 200 error page, and a character count
        alone cannot tell "the extractor improved" from "this is a different
        article" -- measured, a 'Страницата не е намерена' page replaced a good
        record because it happened to be longer.

    Pass 2 revisits the rejection ledger, promoting any page that now yields a
    real body -- the whole point of caching the HTML before the gate."""
    # BOTH folders. A quarantined article is precisely the article a
    # structurally stale source can never list again — the population this
    # mode exists for — and resolving only the corpus made --reextract report
    # `records: 0` for all six quarantined domains while --prune-cache
    # unlinked every one of their cached pages.
    folder, quarantine_folder = domain_folders(domain)
    scan_folders = (folder, quarantine_folder)
    out = {"domain": domain, "mode": "reextract", "min_body": min_body,
           "floor_from_cli": floor_from_cli,
           "records": 0, "from_cache": 0, "fetched": 0, "no_html": 0,
           "rewritten": 0, "unchanged": 0, "shrunk_refused": 0,
           "identity_refused": 0, "promoted": 0, "demoted": 0,
           "duplicates_found": 0, "duplicates_removed": 0,
           "cache_pruned": 0, "failed": []}

    def html_for(url):
        """Cached HTML, or a fresh fetch under --allow-fetch. The pre-cache
        corpus has no entries, so without that flag a re-extraction over it
        reports no_html rather than quietly reaching for the network."""
        cached = read_html_cache(domain, url)
        if cached is not None:
            out["from_cache"] += 1
            return cached
        if not allow_fetch:
            out["no_html"] += 1
            return None
        try:
            fresh = fetch_html(url)
        except fla.RobotsDisallowed:
            out["failed"].append({"url": url, "detail":
                                  "robots_disallowed (robots.txt forbids this "
                                  f"URL for {fla.BOT_NAME}); not re-fetched"})
            return None
        except (urllib.error.URLError, urllib.error.HTTPError, OSError) as e:
            out["failed"].append({"url": url, "detail": str(e)})
            return None
        if cache_html:
            write_html_cache(domain, url, fresh)
        out["fetched"] += 1
        time.sleep(delay)
        return fresh

    def floor_for(old_rec):
        if floor_from_cli:
            return min_body
        stored = old_rec.get("gate_min_body")
        return stored if isinstance(stored, int) and stored >= 0 else min_body

    def ledger_then_unlink(url, reason, rec, path):
        """Ledger the URL BEFORE removing the record, and only remove it if the
        ledger write actually landed. Unlinking first loses the URL from the
        corpus AND the ledger at once, orphaning its cached HTML with nothing
        left that knows the page was ever seen."""
        key = canonical_url(url)
        if key not in ledgered:
            if not record_rejection(domain, url, reason,
                                    rec.get("content_chars") or 0,
                                    rec.get("title")):
                out["failed"].append({"url": url, "detail":
                                      "ledger write failed; record kept"})
                return False
            ledgered.add(key)
        try:
            path.unlink()
            analysis_sidecar(domain, path.name,
                             path.parent == quarantine_folder
                             ).unlink(missing_ok=True)
        except OSError as e:
            out["failed"].append({"url": url, "detail": f"unlink: {e}"})
            return False
        return True

    ledgered = rejected_urls(domain, max_age_days=None)
    demoted_urls = set()

    # --- pass 0: collapse records that are the same article under two
    #     spellings. canonical_url stops NEW duplicates; nothing collapsed the
    #     ones already stored, and --reextract would otherwise rewrite both
    #     members independently. Measured on the live corpus: 19 canonical keys
    #     held more than one stored URL, all same-title.
    by_key = {}
    for path, rec in stored_records(*scan_folders):
        if not rec.get("url"):
            continue
        by_key.setdefault(canonical_url(rec["url"]), []).append((path, rec))
    for key, members in by_key.items():
        if len(members) < 2:
            continue
        # Keep the fullest body; tie-break on the canonical spelling, so the
        # survivor is the one a re-fetch would produce.
        members.sort(key=lambda pr: (
            -(pr[1].get("content_chars") or 0),
            pr[1]["url"] != key,
            pr[0].name))
        out["duplicates_found"] += len(members) - 1
        if not dedupe:
            continue
        for path, _rec in members[1:]:
            try:
                path.unlink()
                analysis_sidecar(domain, path.name,
                                 path.parent == quarantine_folder
                                 ).unlink(missing_ok=True)
                out["duplicates_removed"] += 1
            except OSError as e:
                out["failed"].append({"url": key, "detail": f"dedupe: {e}"})

    # --- pass 1: every stored record
    for path, old_rec in list(stored_records(*scan_folders)):
        out["records"] += 1
        url = old_rec.get("url")
        if not url:
            out["failed"].append({"url": None, "detail":
                                  f"stored record has no url: {path.name}"})
            continue
        html_text = html_for(url)
        if html_text is None:
            continue
        try:
            rec, is_article = extract_record(html_text, domain, url,
                                             old_rec.get("published"))
        except Exception as e:  # a malformed page must not sink the pass
            out["failed"].append({"url": url,
                                  "detail": f"{type(e).__name__}: {e}"})
            continue
        record_floor = floor_for(old_rec)
        rec["gate_min_body"] = record_floor
        old_chars = old_rec.get("content_chars") or 0
        new_chars = rec.get("content_chars") or 0

        # Identity guard, --allow-fetch only: a cached page is by construction
        # the page this record came from, but a freshly fetched one is only
        # whatever the URL serves today.
        if allow_fetch and old_rec.get("title") and rec.get("title"):
            if not titles_match(old_rec["title"], rec["title"]):
                out["identity_refused"] += 1
                out["failed"].append({"url": url, "detail":
                                      "identity_refused (re-fetched page has a "
                                      f"different headline: {rec['title']!r} vs "
                                      f"stored {old_rec['title']!r})"})
                continue

        if new_chars < old_chars and not allow_shrink:
            out["shrunk_refused"] += 1
            continue
        reason = gate_reason(rec, is_article, record_floor,
                             echo_slack_for(record_floor))
        if reason:
            # The record no longer clears the gate. Ledger it and drop the
            # file, so the corpus never keeps a record the current rules would
            # refuse to create -- otherwise "what is in the corpus" depends on
            # when each article happened to be fetched.
            if ledger_then_unlink(url, f"reextract_{reason}", rec, path):
                out["demoted"] += 1
                demoted_urls.add(canonical_url(url))
            continue
        # Both timestamps move on every extraction, so compare on what a
        # consumer actually reads. Excluding only fetched_at is not enough:
        # the stored record carries reextracted_at and a freshly extracted one
        # does not, so every re-run reported every record as rewritten.
        volatile = ("fetched_at", "reextracted_at")
        comparable = {k: v for k, v in rec.items() if k not in volatile}
        old_comparable = {k: v for k, v in old_rec.items()
                          if k not in volatile}
        if comparable == old_comparable:
            out["unchanged"] += 1
            continue
        rec["fetched_at"] = old_rec.get("fetched_at") or rec["fetched_at"]
        rec["reextracted_at"] = datetime.now(timezone.utc).isoformat()
        # Back into the folder this record came from: a quarantined article
        # must not be promoted into the corpus by a re-extraction.
        new_path = path.parent / article_filename(url, rec["published"])
        try:
            write_record(new_path, rec)
            if new_path != path:
                # The publish date changed, so the filename did. Move the
                # analysis sidecar with it or the analysis tree keeps a record
                # under a corpus name that no longer exists.
                in_quarantine = path.parent == quarantine_folder
                old_side = analysis_sidecar(domain, path.name, in_quarantine)
                if old_side.exists():
                    new_side = analysis_sidecar(domain, new_path.name,
                                                in_quarantine)
                    new_side.parent.mkdir(parents=True, exist_ok=True)
                    old_side.replace(new_side)
                path.unlink()
        except OSError as e:
            out["failed"].append({"url": url, "detail": f"write: {e}"})
            continue
        out["rewritten"] += 1

    # --- pass 2: ledgered rejections whose page may now yield a body
    #
    # max_age_days=None is load-bearing: a rejection older than the ledger's
    # 30-day TTL is exactly the one most likely to predate the extractor fix
    # being applied, and reading the ledger through the TTL would skip it.
    stored_urls = {canonical_url(r["url"])
                   for _, r in stored_records(*scan_folders) if r.get("url")}
    raw_for = rejected_url_map(domain, max_age_days=None)
    for key in sorted(set(raw_for) - stored_urls - demoted_urls):
        url = raw_for[key]
        html_text = html_for(url)
        if html_text is None:
            continue
        try:
            rec, is_article = extract_record(html_text, domain, url, None)
        except Exception as e:
            out["failed"].append({"url": url,
                                  "detail": f"{type(e).__name__}: {e}"})
            continue
        rec["gate_min_body"] = min_body
        if gate_reason(rec, is_article, min_body, echo_slack_for(min_body)):
            continue
        rec["promoted_from_rejection_at"] = datetime.now(timezone.utc).isoformat()
        folder.mkdir(parents=True, exist_ok=True)
        try:
            write_record(folder / article_filename(url, rec["published"]), rec)
        except OSError as e:
            out["failed"].append({"url": url, "detail": f"write: {e}"})
            continue
        out["promoted"] += 1

    # --- optional: drop cache entries nothing refers to any more
    if prune_cache:
        keep = set()
        referenced = {r.get("url") for _, r in stored_records(*scan_folders)}
        referenced |= set(rejected_url_map(domain, max_age_days=None).values())
        for u in referenced:
            if not u:
                continue
            # BOTH keys: an entry written before the key changed is still the
            # only cached copy of that page, and pruning it would delete the
            # recovery path this cache exists to provide.
            keep.add(html_cache_path(domain, u).name)
            keep.add(html_cache_path(domain, u, _raw_key=True).name)
        cache_dir = DATA_DIR / HTML_CACHE_DIR_NAME / domain
        if cache_dir.is_dir():
            for entry in cache_dir.glob("*.json.gz"):
                if entry.name not in keep:
                    try:
                        entry.unlink()
                        out["cache_pruned"] += 1
                    except OSError as e:
                        out["failed"].append({"url": entry.name,
                                              "detail": f"prune: {e}"})

    out["dir"] = (str(folder.relative_to(Path.cwd()))
                  if _under_cwd(folder) else str(folder))
    out["dir_exists"] = folder.is_dir()
    out["quarantine_dir_exists"] = quarantine_folder.is_dir()
    return out


def cmd_apply_quarantine(domain, apply_changes):
    """Move a domain's ALREADY-STORED records to whichever side of the
    quarantine the registry now says they belong on.

    The routing in main() only decides where a run's NEW articles land.
    Without this, flagging a source structurally stale leaves its existing
    records — 592 across six domains at the time this was written — sitting in
    the corpus indistinguishable from fresh content and entering the analysis
    queue at the same priority, which is the whole condition the flag exists
    to end.

    ⚠️ CURATED VERDICTS ONLY. main() routes on the registry flag OR the
    runtime staleness signal; this mode reads no feed, so it cannot see the
    runtime half — and acting on its absence would drag records back OUT of
    quarantine on a domain the lister had flagged but nobody had curated. An
    uncurated domain is therefore reported and left alone.

    A relocation to quarantine DELETES the record's analysis sidecar rather
    than moving it: corpus_domains() skips _-prefixed directories, so the
    analysis layer cannot reach a quarantined article at all, and the sidecar
    is an analysis of something no longer in the analysable corpus. (The
    previous "move" was a no-op — both paths it computed were the same path.)

    Dry by default."""
    flag = registry_flag(domain, "quarantine_")
    corpus, quarantine = domain_folders(domain)
    out = {"domain": domain, "mode": "apply-quarantine",
           "registry_flag": flag or None, "direction": None,
           "movable": 0, "moved": 0, "sidecars_removed": 0,
           "unreadable": 0, "applied": apply_changes, "failed": []}

    if flag == "stale_source":
        src, dst, to_quarantine = corpus, quarantine, True
    elif flag == "never":
        src, dst, to_quarantine = quarantine, corpus, False
    else:
        out["direction"] = "none (no curated verdict)"
        out["detail"] = (
            "this mode reads no feed, so it cannot see the runtime staleness "
            "signal main() also routes on. Acting on a blank verdict would "
            "drag records out of quarantine on a domain the lister had "
            "flagged. Set quarantine_<vintage> to stale_source or never.")
        out["corpus_dir_exists"] = corpus.is_dir()
        out["quarantine_dir_exists"] = quarantine.is_dir()
        return out

    out["direction"] = ("corpus -> quarantine" if to_quarantine
                        else "quarantine -> corpus")

    def _unreadable(path, exc):
        out["unreadable"] += 1
        out["failed"].append({"path": path.name,
                              "detail": f"unreadable, left in place: {exc}"})

    for path, _rec in list(stored_records(src, on_unreadable=_unreadable)):
        out["movable"] += 1
        if not apply_changes:
            continue
        try:
            dst.mkdir(parents=True, exist_ok=True)
            target = dst / path.name
            if target.exists():
                # Same filename on the far side. The name embeds a hash of the
                # canonical URL, so this is the same article — but only
                # DISCARD the source when the two are byte-identical, or a
                # newer re-extraction is silently thrown away.
                if path.read_bytes() == target.read_bytes():
                    path.unlink()
                else:
                    out["failed"].append({
                        "path": path.name,
                        "detail": "a DIFFERENT record already exists on the "
                                  "far side; left in place for a human"})
                    continue
            else:
                path.replace(target)
            # The sidecar belongs to the side the record just LEFT.
            removed = analysis_sidecar(domain, path.name,
                                       quarantined=not to_quarantine)
            if removed.exists():
                removed.unlink()
                out["sidecars_removed"] += 1
            out["moved"] += 1
        except OSError as e:
            out["failed"].append({"path": path.name, "detail": str(e)})

    if apply_changes and src.is_dir() and not any(src.iterdir()):
        # An emptied corpus folder is a ghost outlet: build_app_data lists a
        # domain directory whether or not it holds anything, so six of them
        # would render with article_count 0.
        try:
            src.rmdir()
        except OSError:
            pass

    out["corpus_dir_exists"] = corpus.is_dir()
    out["quarantine_dir_exists"] = quarantine.is_dir()
    return out


def cmd_intake_report(stale_after_days=7):
    """One JSON object describing every domain's intake health.

    This is the artifact that makes an unattended run trustworthy: nobody is
    watching, so the run has to say what it did. Reads only the per-domain
    state files and the stored corpus — no network, no listing — so it is safe
    to run at any time and cannot itself fail a sweep.

    `alerts` is the part worth reading. A domain is flagged when it has failed
    repeatedly, when its newest stored article has aged past the threshold
    while it is NOT quarantined (a quarantined source is old on purpose), or
    when it has a retry queue that is not draining."""
    state_dir = DATA_DIR / STATE_DIR_NAME
    # p.stem drops only the LAST suffix, so "x.json.tmp" has stem "x.json" and
    # never matched the *.json glob anyway — but a half-written temp file must
    # not become a domain, so filter on the full name.
    seen = {p.name[:-len(".json")] for p in state_dir.glob("*.json")
            if p.name.endswith(".json")} if state_dir.is_dir() else set()
    # ⚠️ The registry too. Enumerating state files alone made a domain that has
    # NEVER completed a run invisible — which is the original defect's exact
    # shape: the sweep silently dropped 14 of 55 domains and nothing noticed.
    registry = set()
    try:
        with open(DATA_DIR / "bg_news_sites.csv", newline="",
                  encoding="utf-8") as f:
            registry = {r["domain"] for r in csv.DictReader(f) if r.get("domain")}
    except (OSError, csv.Error, KeyError):
        pass
    domains = sorted(seen | registry)
    today = datetime.now(timezone.utc).date()
    rows, alerts = [], []
    for domain in domains:
        st = load_state(domain)
        never_ran = domain not in seen
        corpus, quarantine = domain_folders(domain)
        stored = (len(list(corpus.glob("*.json")))
                  + len(list(quarantine.glob("*.json")))
                  if corpus.is_dir() or quarantine.is_dir() else 0)
        age = None
        if st.get("newest_stored"):
            try:
                age = (today - datetime.fromisoformat(
                    st["newest_stored"]).date()).days
            except ValueError:
                age = None
        row = {"domain": domain, "never_ran": never_ran, "stored": stored,
               "newest_stored": st.get("newest_stored"),
               "newest_stored_age_days": age,
               "quarantined": bool(st.get("quarantined")),
               "consecutive_failures": st.get("consecutive_failures", 0),
               "last_success_at": st.get("last_success_at"),
               "last_error": st.get("last_error")}
        queued = st.get("retry_urls")
        row["retry_queued"] = len(queued) if isinstance(queued, list) else 0
        rows.append(row)
        if never_ran:
            alerts.append({"domain": domain, "alert": "never_ran",
                           "detail": "in the registry, but no run has ever "
                                     "completed for it"})
        elif row["consecutive_failures"] >= 3:
            alerts.append({"domain": domain, "alert": "failing",
                           "detail": f"{row['consecutive_failures']} runs in a "
                                     f"row; last: "
                                     f"{(st.get('last_error') or {}).get('error')}"})
        elif age is not None and age > stale_after_days and not row["quarantined"]:
            alerts.append({"domain": domain, "alert": "going_stale",
                           "detail": f"newest stored article is {age} days old "
                                     f"and this source is not quarantined"})
        if row["retry_queued"] >= 10:
            alerts.append({"domain": domain, "alert": "retry_backlog",
                           "detail": f"{row['retry_queued']} URLs queued for "
                                     f"retry and not draining"})
    return {"domain": None, "mode": "intake-report",
            "generated_at": now_iso(),
            "domains": len(rows), "stale_after_days": stale_after_days,
            "alerts": alerts, "rows": rows}


# --------------------------------------------------------------------- main

def main():
    args = list(sys.argv[1:])
    delay = DELAY_DEFAULT
    urls_file = None
    prefetched = None
    min_body = MIN_BODY_CHARS
    retry_rejected = False
    reextract = False
    allow_fetch = False
    allow_shrink = False
    cache_html = True
    prune_cache = False
    dedupe = False
    no_quarantine = False
    intake_report = False
    stale_after_days = 7
    stale_after_cli = False
    apply_quarantine = False
    apply_changes = False
    floor_from_cli = False
    for a in list(args):
        if a.startswith("--delay="):
            raw = a.split("=", 1)[1]
            try:
                delay = float(raw)
            except ValueError:
                print(json.dumps({"error": "usage", "detail":
                                  f"--delay needs a number of seconds, "
                                  f"got {raw!r}"}))
                sys.exit(1)
            if delay < 0:
                print(json.dumps({"error": "usage", "detail":
                                  "--delay cannot be negative"}))
                sys.exit(1)
            args.remove(a)
        elif a.startswith("--urls-file="):
            urls_file = a.split("=", 1)[1]
            args.remove(a)
        elif a.startswith("--prefetched="):
            prefetched = a.split("=", 1)[1]
            args.remove(a)
        elif a == "--prune-cache":
            prune_cache = True
            args.remove(a)
        elif a == "--dedupe":
            dedupe = True
            args.remove(a)
        elif a == "--no-quarantine":
            no_quarantine = True
            args.remove(a)
        elif a == "--intake-report":
            intake_report = True
            args.remove(a)
        elif a.startswith("--stale-after="):
            raw = a.split("=", 1)[1]
            if not raw.isdigit():
                print(json.dumps({"error": "usage", "detail":
                                  f"--stale-after needs a non-negative "
                                  f"integer, got {raw!r}"}))
                sys.exit(1)
            stale_after_days = int(raw)
            stale_after_cli = True
            args.remove(a)
        elif a == "--apply-quarantine":
            apply_quarantine = True
            args.remove(a)
        elif a == "--apply":
            apply_changes = True
            args.remove(a)
        elif a.startswith("--min-body="):
            raw = a.split("=", 1)[1]
            # .isdigit() rejects the empty string and negatives alike, so
            # --min-body=0 stays the explicit "disable the length floor"
            # spelling and a typo cannot silently disable it instead.
            if not raw.isdigit():
                print(json.dumps({"error": "usage", "detail":
                                  f"--min-body needs a non-negative integer, "
                                  f"got {raw!r}"}))
                sys.exit(1)
            min_body = int(raw)
            floor_from_cli = True
            args.remove(a)
        elif a == "--retry-rejected":
            retry_rejected = True
            args.remove(a)
        elif a == "--reextract":
            reextract = True
            args.remove(a)
        elif a == "--allow-fetch":
            allow_fetch = True
            args.remove(a)
        elif a == "--allow-shrink":
            allow_shrink = True
            args.remove(a)
        elif a == "--no-cache":
            cache_html = False
            args.remove(a)
    if intake_report:
        if args:
            print(json.dumps({"error": "usage", "detail":
                              "--intake-report covers every domain and takes "
                              f"no positional argument (got {args[0]!r})"}))
            sys.exit(1)
        print(json.dumps(cmd_intake_report(stale_after_days),
                         ensure_ascii=False))
        sys.exit(0)
    if stale_after_cli and not intake_report:
        print(json.dumps({"error": "usage", "detail":
                          "--stale-after only applies to --intake-report"}))
        sys.exit(1)
    if not args:
        print(json.dumps({"error": "usage",
                          "detail": "save_articles.py <domain> [N] [--delay=S] "
                                    "[--min-body=N] [--retry-rejected] "
                                    "[--no-cache] [--no-quarantine] "
                                    "[--urls-file=F | --prefetched=F.jsonl] | "
                                    "save_articles.py <domain> --reextract "
                                    "[--allow-fetch] [--allow-shrink] "
                                    "[--prune-cache] [--dedupe] [--no-cache] "
                                    "[--min-body=N] [--delay=S] | "
                                    "save_articles.py <domain> "
                                    "--apply-quarantine [--apply] | "
                                    "save_articles.py --intake-report "
                                    "[--stale-after=N]"}))
        sys.exit(1)
    domain = args[0]
    if len(args) > 1 and not args[1].isdigit():
        print(json.dumps({"error": "usage", "detail":
                          f"N must be a non-negative integer, got {args[1]!r}"}))
        sys.exit(1)
    want = int(args[1]) if len(args) > 1 else 5

    if apply_changes and not apply_quarantine:
        print(json.dumps({"error": "usage", "detail":
                          "--apply only applies to --apply-quarantine; every "
                          "other destructive path has its own flag "
                          "(--dedupe, --prune-cache, --allow-shrink)"}))
        sys.exit(1)

    if apply_quarantine:
        summary = cmd_apply_quarantine(domain, apply_changes)
        print(json.dumps(summary, ensure_ascii=False))
        sys.exit(4 if summary["failed"] else 0)

    if reextract:
        if urls_file or prefetched:
            print(json.dumps({"error": "usage", "detail":
                              "--reextract reads the stored corpus and its HTML "
                              "cache; it cannot be combined with --urls-file or "
                              "--prefetched"}))
            sys.exit(1)
        summary = cmd_reextract(domain, min_body, allow_fetch, allow_shrink,
                                delay, cache_html=cache_html,
                                floor_from_cli=floor_from_cli,
                                prune_cache=prune_cache, dedupe=dedupe)
        print(json.dumps(summary, ensure_ascii=False))
        # 0 whenever the pass COMPLETED, which an all-unchanged re-run does.
        # Counting only rewrites as progress made the code flip between two
        # identical runs; every outcome below is work the pass performed.
        did_work = any(summary[k] for k in ("rewritten", "promoted", "demoted",
                                            "unchanged", "shrunk_refused",
                                            "identity_refused", "cache_pruned",
                                            "duplicates_found",
                                            "duplicates_removed"))
        sys.exit(4 if summary["failed"] and not did_work else 0)

    state = load_state(domain)
    # A site that 403s an identified bot and 200s a browser string is declining
    # to be crawled. Recording that in the registry and then crawling it anyway
    # every night is worse than not recording it: the sweep hammers a source
    # that said no AND raises a permanent `failing` alert about it.
    if registry_flag(domain, "bot_policy_") == "bot_refused" and not (
            urls_file or prefetched):
        print(json.dumps({
            "domain": domain, "error": "bot_refused",
            "detail": "this site refuses an identified bot (403 to our "
                      "user-agent, 200 to a browser string). Respecting that "
                      "is the point of having an honest identity; do not work "
                      "around it. Registry: bot_policy_<vintage>."}))
        sys.exit(3)
    # Scanned BEFORE the listing, because the lister is told which URLs we
    # already hold so it can skip fetching their titles. BOTH sides: a domain
    # quarantined yesterday and fresh today must not re-fetch what it holds.
    corpus_folder, quarantine_folder = domain_folders(domain)
    have, _ = scan_stored(corpus_folder, quarantine_folder)
    on_disk = frozenset(have)  # snapshot BEFORE the loop starts adding to it

    html_map = {}  # url -> page HTML, when pages were prefetched via browser
    if prefetched:
        # Browser-fetched pages (the browser_only tier): one JSON line per
        # article, {"url", "html"} — no network happens in this mode at all.
        try:
            with open(prefetched, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        d = json.loads(line)
                    except json.JSONDecodeError:
                        continue  # one torn line must not sink the file
                    if d.get("url") and d.get("html"):
                        html_map[d["url"]] = d
        except OSError as e:
            print(json.dumps({"error": "usage",
                              "detail": f"--prefetched unreadable: {e}"}))
            sys.exit(1)
        articles = [{"url": u, "title": d.get("title"),
                     "published": d.get("published")}
                    for u, d in html_map.items()]
        list_method, order_confidence, listed_count, warning = (
            "prefetched_browser", "dom_order_unconfirmed", len(articles), None)
    elif urls_file:
        # Browser-harvested links (homepage DOM scrape) but article pages are
        # plain-HTTP fetchable: one URL per line, '#' comments allowed.
        articles = []
        try:
            with open(urls_file, encoding="utf-8") as fh:
                for line in fh:
                    u = line.strip()
                    if u and not u.startswith("#"):
                        articles.append({"url": u})
        except OSError as e:
            print(json.dumps({"error": "usage",
                              "detail": f"--urls-file unreadable: {e}"}))
            sys.exit(1)
        list_method, order_confidence, listed_count, warning = (
            "urls_file_browser_harvest", "dom_order_unconfirmed", len(articles), None)
    else:
        # Last run's transient failures, retried FIRST. Without this a domain
        # that timed out is simply absent from that night's data and nothing
        # ever notices or goes back for it — 14 of 55 domains failed the first
        # full sweep, and every one of those articles was lost silently.
        retry_first = [{"url": e["url"]} for e in state.get("retry_urls", [])
                       if isinstance(e, dict) and e.get("url")]
        try:
            lister_argv = [sys.executable, str(LISTER), domain, str(want)]
            # The lister fetches article pages to backfill missing titles.
            # Every URL we already store is one it need not fetch — measured,
            # ~95% of its fetches were of already-stored pages, each then
            # fetched a SECOND time by this script in the same night.
            known_file = None
            if have:
                try:
                    known_file = tempfile.NamedTemporaryFile(
                        "w", suffix=".urls", delete=False, encoding="utf-8")
                    known_file.write("\n".join(sorted(have)))
                    known_file.close()
                    lister_argv.append(f"--known-urls={known_file.name}")
                except OSError:
                    known_file = None
            # ⚠️ Force an UNCONDITIONAL fetch periodically. A server with a
            # buggy or over-eager validator can answer 304 for ever, and a
            # conditional-only sweep would then stop collecting that source
            # entirely while every run still reported success — the exact
            # silent-stall shape the intake state exists to make visible.
            # A stored validator belongs to a specific document. A feed_url
            # edit re-aims the request, and sending the OLD document's ETag
            # invites a 304 about a page we are no longer asking for.
            feed_url = registry_flag(domain, "feed_url_")
            if (state.get("validator_url")
                    and feed_url
                    and canonical_url(state["validator_url"])
                    != canonical_url(feed_url)):
                state.pop("etag", None)
                state.pop("last_modified", None)
                state.pop("validator_url", None)
            last_full = state.get("last_unconditional_at")
            due = True
            if last_full:
                try:
                    due = (datetime.now(timezone.utc)
                           - datetime.fromisoformat(last_full)
                           > timedelta(days=UNCONDITIONAL_EVERY_DAYS))
                except ValueError:
                    due = True
            # ⚠️ Stamped only AFTER a successful fetch, below. Stamping here
            # let a run that failed burn the 7-day slot, so a source whose
            # validator is broken could go a fortnight without a full fetch.
            # Last run's validators. The source answers 304 when nothing has
            # changed, which is the whole point of running this nightly.
            if not due and state.get("etag"):
                lister_argv.append(f"--etag={state['etag']}")
            if not due and state.get("last_modified"):
                lister_argv.append(
                    f"--if-modified-since={state['last_modified']}")
            try:
                proc = subprocess.run(lister_argv, capture_output=True,
                                      text=True, timeout=LISTER_TIMEOUT)
            finally:
                if known_file:
                    try:
                        os.unlink(known_file.name)
                    except OSError:
                        pass
        except subprocess.TimeoutExpired:
            record_domain_failure(domain, state, "fetch_failed",
                                  f"lister exceeded {LISTER_TIMEOUT}s")
            print(json.dumps({"domain": domain, "error": "fetch_failed",
                              "detail": f"lister exceeded {LISTER_TIMEOUT}s",
                              "consecutive_failures":
                                  state["consecutive_failures"]}))
            sys.exit(4)
        try:
            listed = json.loads(proc.stdout)
            if not isinstance(listed, dict):
                # Valid JSON that is not an object — `null`, `[]` — raises past
                # a JSONDecodeError guard on the very next .get().
                raise json.JSONDecodeError("not a JSON object", "", 0)
        except json.JSONDecodeError:
            detail = (f"lister printed unparseable output: "
                      f"{proc.stdout[:200]} {proc.stderr[:200]}")
            record_domain_failure(domain, state, "fetch_failed", detail)
            print(json.dumps({"domain": domain, "error": "fetch_failed",
                              "detail": detail, "consecutive_failures":
                                  state["consecutive_failures"]}))
            sys.exit(4)
        if proc.returncode != 0 or "error" in listed:
            # propagate the lister's own error JSON verbatim (needs_browser,
            # blocked_captcha, domain_not_in_registry, ...) with its exit code.
            # needs_browser and friends are STANDING facts about the outlet,
            # not failures to count — a browser-tier domain would otherwise
            # accumulate a failure every night for ever.
            err = listed.get("error", "fetch_failed")
            if err not in STANDING_LISTER_FACTS:
                record_domain_failure(domain, state, err,
                                      listed.get("detail"))
                listed["consecutive_failures"] = state["consecutive_failures"]
            print(json.dumps(listed, ensure_ascii=False))
            sys.exit(proc.returncode or 3)
        articles = listed.get("articles", [])
        # Store the fresh validators for next time. Only overwrite when the
        # source SENT one: a 304 response carries no body and often no ETag,
        # and clearing the stored value would make every subsequent run
        # unconditional again.
        for key in ("etag", "last_modified", "validator_url"):
            if listed.get(key):
                state[key] = listed[key]
        if due:
            state["last_unconditional_at"] = now_iso()
        # Retried URLs go FIRST and are deduped against the fresh listing by
        # canonical key, so a URL that reappeared in the feed is not fetched
        # twice in one run.
        if retry_first:
            listed_keys = {canonical_url(a["url"]) for a in articles
                           if a.get("url")}
            articles = [r for r in retry_first
                        if canonical_url(r["url"]) not in listed_keys] + articles
        list_method = listed.get("method")
        order_confidence = listed.get("order_confidence")
        listed_count = listed.get("count", 0)
        warning = listed.get("warning")

    quarantined, quarantine_reason = quarantine_decision(domain,
                                                         order_confidence)
    if no_quarantine:
        quarantined, quarantine_reason = False, "--no-quarantine"
    folder = quarantine_folder if quarantined else corpus_folder
    skip_rejected = set() if retry_rejected else rejected_urls(domain)
    # A URL rejected earlier in THIS run must not be appended twice, and with
    # --retry-rejected the ledger's own entries are re-appended every run --
    # measured 2 -> 4 -> 6 over three passes on the same input. Seeding the
    # guard with what the ledger already holds makes the append idempotent per
    # URL regardless of which flags are in play.
    ledgered = rejected_urls(domain, max_age_days=None)
    # A host asking for a Crawl-delay is asking politely and in the one place
    # designed for it. Measured before this: 0.0005 s between requests to a
    # host requesting 10 s.
    host_delay = delay
    if articles:
        first = next((a["url"] for a in articles if a.get("url")), None)
        if first:
            rp = fla.robots_for(first)
            try:
                asked = rp.crawl_delay(fla.BOT_NAME) if rp else None
            except Exception:
                asked = None
            if asked:
                host_delay = max(delay, float(asked))
    saved, rejected, skipped_rejected, failed = 0, 0, 0, []
    attempted = set()  # canonical keys this run actually tried to fetch
    echo_slack = echo_slack_for(min_body)

    def _reject(url, rec, reason, detail):
        """One body-gate rejection: ledger it once, count it, and report it in
        failed[] like every other per-article outcome."""
        nonlocal rejected
        key = canonical_url(url)
        if key not in ledgered:
            record_rejection(domain, url, reason,
                             rec["content_chars"], rec["title"])
            ledgered.add(key)
        rejected += 1
        failed.append({"url": url, "detail": detail})
    for art in articles:
        url = art.get("url")
        if not url:
            continue
        key = canonical_url(url)
        if key in have:
            continue
        if key in skip_rejected:
            skipped_rejected += 1
            continue
        # `have` is seeded from disk and updated as we go, so two spellings of
        # one article in the SAME listing store one file rather than two — a
        # sitemap that lists both the www. and bare form would otherwise
        # produce exactly the duplicate this canonicalisation exists to end.
        # Counted separately from `have` so already_present stays a count of
        # what was on DISK, not of what this loop added as it went.
        have.add(key)
        attempted.add(key)
        if urlsplit(url).path in ("", "/"):
            failed.append({"url": url, "detail": "non_article_page (homepage)"})
            continue
        try:
            if html_map:
                html_text = html_map[url]["html"]
            else:
                html_text = fetch_html(url)
            # Cache BEFORE the gates: a page the body gate turns away is
            # precisely the page a future extractor fix is meant to rescue,
            # and --reextract can only reach it if the HTML is on disk.
            if cache_html:
                write_html_cache(domain, url, html_text)
            rec, is_article = extract_record(html_text, domain, url,
                                             art.get("published"))
        except fla.RobotsDisallowed:
            # A policy statement by the site. Terminal, never retried.
            failed.append({"url": url, "detail":
                           f"robots_disallowed (robots.txt forbids this URL "
                           f"for {fla.BOT_NAME})"})
            continue
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
        # The BODY GATE. The article gate above is satisfied by JSON-LD alone,
        # so it passes a page whose body the extractor never found — the
        # single largest defect in the first sweep's corpus. Reject rather
        # than store: a headline-only record looks complete to every consumer
        # and to every field check.
        if body_is_title(rec["content"], rec["title"], slack=echo_slack):
            _reject(url, rec, "title_as_body",
                    "title_as_body (extracted body is the headline, "
                    "not article text)")
            continue
        if rec["content_chars"] < min_body:
            _reject(url, rec, "thin_body",
                    f"thin_body ({rec['content_chars']} chars < "
                    f"{min_body} floor)")
            continue
        # Persist the floor this record was judged against. Without it a bare
        # --reextract re-judges a corpus deliberately saved at a lowered
        # --min-body against the DEFAULT 400 and demotes all of it -- both
        # halves being documented workflows.
        rec["gate_min_body"] = min_body
        folder.mkdir(parents=True, exist_ok=True)
        write_record(folder / article_filename(url, rec["published"]), rec)
        saved += 1
        if not html_map:
            time.sleep(host_delay)

    # Counted against a SNAPSHOT of the disk taken before the loop, not the
    # set the loop grows as it goes — otherwise every URL this run stored is
    # also counted as already present, and the two are equal on a first run.
    summary_already_present = len({canonical_url(a["url"]) for a in articles
                                   if a.get("url")} & on_disk)
    summary = {
        "domain": domain,
        "dir": str(folder.relative_to(Path.cwd())) if _under_cwd(folder) else str(folder),
        "requested": want,
        # `listed` is what the SOURCE offered. Retried URLs are prepended to
        # `articles` but not counted here, so the two bases stay distinct.
        "listed": listed_count,
        "already_present": summary_already_present,
        "quarantined": quarantined,
        "dir_exists": folder.is_dir(),
        "saved": saved,
        # `rejected` is a strict SUBSET of `failed` -- both gate call sites
        # append to each -- so listed != saved + already_present + rejected +
        # len(failed). `skipped_rejected` is the number the sweep log needs to
        # tell "this source published nothing new" apart from "the extractor
        # broke and every article here is now ledgered as dead".
        "rejected": rejected,
        "skipped_rejected": skipped_rejected,
        "rejected_ledger": (str(rejected_path(domain))
                            if rejected or skipped_rejected else None),
        "min_body": min_body,
        "delay": host_delay,
        "failed": failed,
        "list_method": list_method,
        "order_confidence": order_confidence,
    }
    stamp = now_iso()
    prior_queue = state.get("retry_urls", [])
    if not isinstance(prior_queue, list):
        prior_queue = []  # a corrupt state file must not yield a bogus count
    queue, dropped, exhausted = merge_retry_queue(
        prior_queue, failed, stamp, attempted=attempted,
        exhausted=state.get("retry_exhausted_at") or {})
    # A run that listed articles and stored none of them is NOT a success. The
    # counter exists to notice a source that has stopped working, and
    # recording every completed run as a success made it unable to.
    productive = bool(saved or not articles or
                      len(articles) == summary_already_present)
    state.update({
        "domain": domain,
        "last_attempt_at": stamp,
        "consecutive_failures": (0 if productive
                                 else state.get("consecutive_failures", 0) + 1),
        "quarantined": quarantined,
        "retry_urls": queue,
        "retry_exhausted_at": exhausted,
    })
    if productive:
        state["last_success_at"] = stamp
        state["last_error"] = None
    else:
        state["last_error"] = {
            "error": "nothing_stored",
            "detail": f"listed {len(articles)}, saved 0, rejected {rejected}, "
                      f"{len(failed)} per-article failures",
            "at": stamp}
    summary["retry_queued"] = len(queue)
    if dropped:
        # Named, not silently forgotten: a URL that has burned every attempt
        # is a permanent gap in the corpus, and the run that gives up on it is
        # the only place that can say so. It then stays exhausted for
        # RETRY_EXHAUSTED_TTL_DAYS, or the cap would not stop the nightly
        # re-fetch it exists to stop.
        summary["retry_exhausted"] = [d["url"] for d in dropped]

    if quarantine_reason:
        summary["quarantine_reason"] = quarantine_reason
    # The nightly report's freshness assertion reads this: a live source whose
    # newest stored article is weeks old is either broken or quarantined, and
    # the two must be told apart by something other than silence.
    _, newest = scan_stored(corpus_folder, quarantine_folder)
    summary["newest_stored"] = newest
    if newest:
        try:
            summary["newest_stored_age_days"] = (
                datetime.now(timezone.utc).date()
                - datetime.fromisoformat(newest).date()).days
        except ValueError:
            # A malformed stored date must not raise HERE — every article has
            # already been saved, and an exception at this point would print no
            # summary at all, breaking the one-JSON-object contract after the
            # work is done.
            summary["newest_stored_age_days"] = None
    state["newest_stored"] = newest
    save_state(domain, state)
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
