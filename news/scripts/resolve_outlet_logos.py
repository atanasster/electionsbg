#!/usr/bin/env python3
"""Resolve each outlet's logo ONCE and propose it for the registry.

Run:  python3 news/scripts/resolve_outlet_logos.py            # dry run, prints a table
      python3 news/scripts/resolve_outlet_logos.py --apply    # write the column
      python3 news/scripts/resolve_outlet_logos.py --fetch    # allow network for
                                                              # domains with no cache

Why this is a separate script rather than part of extract_record:

    JSON-LD `Organization.logo` is on 97% of article pages (11 of 13 cached
    domains), so reading it per article is easy — and wrong. It is a PER-OUTLET
    CONSTANT, so scraping it 4,366 times is 4,366 chances to disagree with
    itself, and the disagreement would be invisible: every record would look
    fine on its own.

Why it is not part of `update-news-sites` either:

    That skill is deliberately human-run — registry changes want a person —
    so a resolver that silently rewrote a column inside it would be a machine
    edit hiding in a manual step. This proposes; a human applies.

The fallback ladder, and why it stops where it does:

    1. JSON-LD Organization.logo  — the outlet's own declared mark (97%)
    2. <link rel="apple-touch-icon">  — a raster mark. ⚠️ NOT reliably
       large: measured across this registry, several sites point it at a
       57x57 icon, so treat step 2 and step 3 alike and let the UI render
       whatever arrives inside a fixed box.
    3. <link rel="icon"> / shortcut icon  — a favicon; small but honest (62%)
    4. nothing  — the app renders a two-letter monogram

    There is deliberately no fifth step guessing /favicon.ico by convention: a
    guessed URL that 404s renders as a broken image, which is worse than the
    monogram, and we would not know which we had.

⚠️ A logo is the outlet's trademark. It is HOTLINKED and rendered as an
attribution mark beside their own content, never copied into our bucket and
never used to imply endorsement — the same rule the article images follow.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import json
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
import save_articles as sa  # noqa: E402

DATA_DIR = sa.DATA_DIR
REGISTRY = DATA_DIR / "bg_news_sites.csv"
RETIRED = DATA_DIR / "retired_sites.csv"
# Dated like every other registry column, so a later re-resolve is a new
# column rather than a silent overwrite of somebody's hand-checked value.
LOGO_COLUMN = "logo_url_aug2026"


def logo_from_html(html_text, page_url):
    """(url, basis) for the best mark on one page, or (None, 'none')."""
    for block in sa._jsonld_blocks(html_text):
        for node in sa._jsonld_nodes(block):
            if not isinstance(node, dict):
                continue
            if not sa._jsonld_is_type(node, "Organization",
                                      "NewsMediaOrganization"):
                continue
            got = sa.absolutise(page_url, sa._jsonld_image_url(node.get("logo")))
            if got:
                return got, "jsonld_organization"
    # A publisher block on the Article node is the same claim, one level in.
    ld = sa.jsonld_article(html_text) or {}
    pub = ld.get("publisher")
    if isinstance(pub, dict):
        got = sa.absolutise(page_url, sa._jsonld_image_url(pub.get("logo")))
        if got:
            return got, "jsonld_publisher"
    for rel, basis in (("apple-touch-icon", "apple_touch_icon"),
                       ("icon", "link_icon")):
        got = sa.absolutise(page_url, sa.parse_link_rel(html_text, rel))
        if got:
            return got, basis
    return None, "none"


def cached_pages(domain, limit=3):
    """A few cached pages for one domain, newest first by mtime.

    More than one because the first page may be the outlet's own oddity — a
    listing page with no Organization node — while its siblings carry one."""
    root = DATA_DIR / "_html" / domain
    if not root.is_dir():
        return []
    out = []
    for path in sorted(root.glob("*.json.gz"),
                       key=lambda p: p.stat().st_mtime, reverse=True)[:limit]:
        try:
            blob = json.loads(gzip.decompress(path.read_bytes()).decode("utf-8"))
        except (OSError, ValueError, gzip.BadGzipFile):
            continue
        if blob.get("html"):
            out.append((blob.get("url") or f"https://{domain}/", blob["html"]))
    return out


def refuses_bots(domain):
    """Whether this outlet has told us not to crawl it.

    ⚠️ Checked in BOTH registries, retired first. Two outlets 403 an identified
    bot, and the decision to respect that is recorded in retired_sites.csv —
    which is exactly where a new script forgets to look, because the live
    registry no longer has a row for them at all. `fetch_html` honours
    robots.txt but knows nothing about this policy."""
    for path in (RETIRED, REGISTRY):
        rows, _ = read_rows(path)
        for row in rows:
            if (row.get("domain") or "").strip() != domain:
                continue
            # ⚠️ EVERY bot_policy_* column, not the first. Dated columns are
            # APPENDED (this change adds logo_url_aug2026 the same way), so a
            # later verdict sitting behind an empty earlier cell would be
            # ignored — and the failure direction is "crawl a site that told
            # us not to".
            policies = [(v or "").strip() for k, v in row.items()
                        if k and k.startswith("bot_policy_")]
            if "bot_refused" in policies:
                return True
            # retired_sites.csv records the same decision as prose. Matched on
            # whole tokens rather than as a substring, so a note reading
            # "not bot_refused, just dead" cannot flip it.
            words = re.findall(r"[a-z_]+", " ".join(
                filter(None, (row.get("reason"), row.get("detail")))).lower())
            if "bot_refused" in words:
                return True
    return False


def resolve(domain, allow_fetch=False):
    """(url, basis) for one outlet. Cache first; the homepage only if asked."""
    pages = cached_pages(domain)
    for page_url, html in pages:
        got, basis = logo_from_html(html, page_url)
        if got:
            return got, basis
    if not allow_fetch:
        return None, "no_cache" if not pages else "none"
    if refuses_bots(domain):
        return None, "bot_refused"
    home = f"https://{domain}/"
    try:
        html, final_url = fetch_home(home)
    except Exception as exc:  # noqa: BLE001 - one outlet must not stop the sweep
        return None, f"fetch_failed:{type(exc).__name__}"
    if not html:
        return None, "fetch_empty"
    # ⚠️ A homepage that redirects to a DIFFERENT publication must not donate
    # its logo. Found live: svobodnaevropa.bg 200s at svobodnatochka.bg
    # ("Свободна точка"), so the resolver wrote another outlet's mark onto the
    # RFE/RL row — an attribution error, on a screen whose whole job is
    # attribution. A cross-host CDN is normal and fine (netinfo serves
    # dariknews and telegraph, webnews serves money.bg and news.bg); this
    # compares the PAGE we ended up on, not where the image is hosted.
    landed = sa.registrable_domain(final_url)
    if landed and landed != sa.registrable_domain(home):
        return None, f"redirects_offsite:{landed}"
    return logo_from_html(html, final_url or home)


def fetch_home(url):
    """(html, final_url) for one homepage.

    sa.fetch_html discards the final URL, and the redirect target is exactly
    what the off-site check needs — so this repeats its robots gate and its
    identity rather than fetching twice or trusting the requested URL."""
    import urllib.request

    if not sa.fla.robots_allows(url):
        raise sa.fla.RobotsDisallowed(url)
    req = urllib.request.Request(sa.fla._normalize_url(url), headers={
        "User-Agent": sa.fla.UA,
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "bg-BG,bg;q=0.9,en;q=0.8",
    })
    with urllib.request.urlopen(req, timeout=sa.fla.TIMEOUT,
                                context=sa.fla._SSL_CTX) as resp:
        ctype = resp.headers.get("Content-Type", "")
        body = resp.read()
        final_url = resp.url
    if body[:2] == b"\x1f\x8b":
        body = gzip.decompress(body)
    return sa.decode_html(body, ctype), final_url


def read_rows(path):
    """(rows, fieldnames), refusing a row csv cannot round-trip.

    ⚠️ `restkey`/`restval` are set and CHECKED. Without restkey, DictReader
    silently DROPS the overflow of a row with more fields than the header —
    which for a registry whose `feed_notes_*` and `detail` columns are free
    prose means one unescaped comma truncates a hand-written note on rewrite,
    with nothing failing."""
    if not path.exists():
        return [], []
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh, restkey="__overflow__", restval="")
        rows = list(reader)
        fields = list(reader.fieldnames or [])
    for i, row in enumerate(rows, start=2):
        if row.get("__overflow__"):
            raise SystemExit(
                f"{path.name} line {i}: more fields than the header has "
                f"columns ({row['__overflow__']!r}). Rewriting would silently "
                f"truncate it — fix the quoting in the CSV first.")
        row.pop("__overflow__", None)
    return rows, fields


def write_rows(path, rows, fieldnames):
    """Rewrite a registry CSV, atomically and with its column order intact.

    ⚠️ Every existing column is preserved verbatim. The registry carries
    hand-written notes (feed_notes_*, quarantine_*, bot_policy_*) that nothing
    can regenerate, and a writer that emitted only the columns it knows about
    would destroy them silently."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    # ⚠️ lineterminator="\n". csv's default is "\r\n", so a writer that only
    # meant to add one column rewrote all 70 lines as CRLF — a whole-file diff
    # on a hand-curated file, which buries the one change that matters and
    # makes the next review of it useless.
    with tmp.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in fieldnames})
    tmp.replace(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--apply", action="store_true",
                    help="write the resolved column into the registries")
    ap.add_argument("--fetch", action="store_true",
                    help="allow one homepage fetch per domain with no cached "
                         "page. Off by default: this is a rate-limited public "
                         "register and the cache answers for most domains.")
    ap.add_argument("--overwrite", action="store_true",
                    help="replace values already in the column. Off by "
                         "default so a hand-corrected logo survives a re-run.")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    results = {}
    for path in (REGISTRY, RETIRED):
        rows, fields = read_rows(path)
        if not rows:
            continue
        if LOGO_COLUMN not in fields:
            fields = list(fields) + [LOGO_COLUMN]
        changed = 0
        for row in rows:
            domain = (row.get("domain") or "").strip()
            if not domain:
                continue
            existing = (row.get(LOGO_COLUMN) or "").strip()
            if existing and not args.overwrite:
                results[domain] = (existing, "kept")
                continue
            url, basis = resolve(domain, allow_fetch=args.fetch)
            results[domain] = (url, basis)
            if url and url != existing:
                row[LOGO_COLUMN] = url
                changed += 1
        if args.apply:
            write_rows(path, rows, fields)
        print(f"{path.name}: {len(rows)} rows, {changed} logo(s) "
              f"{'written' if args.apply else 'resolved (dry run)'}",
              file=sys.stderr)

    resolved = sum(1 for u, _ in results.values() if u)
    if args.json:
        print(json.dumps({
            "outlets": len(results), "resolved": resolved,
            "rows": {d: {"logo": u, "basis": b}
                     for d, (u, b) in sorted(results.items())},
        }, ensure_ascii=False))
    else:
        for domain, (url, basis) in sorted(results.items()):
            print(f"{domain:26} {basis:22} {url or '—'}")
        print(f"\n{resolved}/{len(results)} outlets have a logo"
              + ("" if args.apply else "  (dry run — pass --apply to write)"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
