#!/usr/bin/env python3
"""Ask each outlet's CDN whether it will serve an image to OUR referer.

Run:  python3 news/scripts/probe_hotlink.py            # dry run, prints a table
      python3 news/scripts/probe_hotlink.py --apply    # write the column

Why this exists:

    The app HOTLINKS article images — it makes no copy, the request reaches
    the publisher, and a photo they withdraw disappears here too. That is the
    right arrangement, and roughly a quarter of outlets refuse it.

    Measured 2026-08-26 over the 13 domains that carry a stored image, with
    our own bot UA and a news.electionsbg.com Referer: 10 serve normally and
    three refuse. mediapool.bg and novavarna.net answer 403; e-vestnik.bg
    answers 404 — and that 404 is a HOTLINK BLOCK, not a moved photo: the
    same URL returns 206 to e-vestnik's OWN referer. A refusal dressed as
    "not found" is why the verdict is derived from the response rather than
    from the status code's usual meaning.

    Unrecorded, those are broken images in the grid — silently, because the
    failure is per-request and per-referer and nothing at build time can see
    it.

    ⚠️ A 403 is a POLICY SIGNAL, not an obstacle. Recording it lets the grid
    go straight to the outlet's logo tile instead of re-requesting an image
    the outlet has said it will not serve us. Not sending a referer would
    "fix" the 403 by hiding who is asking, which is the opposite of what an
    attribution-carrying link is for.

What the column means, and what it does NOT:

    `yes`  a sampled image was served                → hotlink it
    `no`   the sample was refused (403) or missing   → go straight to the logo
    ``     never probed                              → hotlink it and let the
                                                       component's onError
                                                       fallback do the work

    A `no` is per-OUTLET and derived from ONE sample, so it is a hint that
    saves a doomed request, never a licence to hide the outlet: the card
    still renders, still names the outlet, still links to the article.
"""
from __future__ import annotations

import argparse
import json
import ssl  # noqa: F401 - documents that the shared SSL context is deliberate
import sys
import urllib.error
import urllib.request
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
import save_articles as sa  # noqa: E402
import resolve_outlet_logos as rol  # noqa: E402

DATA_DIR = sa.DATA_DIR
HOTLINK_COLUMN_PREFIX = "hotlink_ok"
HOTLINK_COLUMN = f"{HOTLINK_COLUMN_PREFIX}_aug2026"

# The origin the app is served from. Sent deliberately: the whole point of the
# probe is to ask the question a real page view asks.
REFERER = "https://news.electionsbg.com/"


def sample_images(limit_per_domain=3):
    """A few stored image URLs per domain, so one dead photo is not a verdict.

    ⚠️ More than one on purpose: one dead photo is not a policy.

    ⚠️ NEWEST first, not oldest. Stored filenames begin with the publish date,
    so a plain sorted(glob) samples an outlet's OLDEST photos — the ones most
    likely to have been rotated off a CDN — and manufactures `no` verdicts
    that then suppress images the outlet serves perfectly well today."""
    out: dict[str, list[str]] = {}
    if not DATA_DIR.is_dir():
        return out
    for child in sorted(DATA_DIR.iterdir()):
        if not child.is_dir() or child.name.startswith("_") \
                or child.name == "analysis":
            continue
        urls: list[str] = []
        for path in sorted(child.glob("*.json"), reverse=True):
            if len(urls) >= limit_per_domain:
                break
            try:
                rec = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                continue
            img = isinstance(rec, dict) and rec.get("image")
            if img and img not in urls:
                urls.append(img)
        if urls:
            out[child.name] = urls
    return out


def probe(url, timeout=12):
    """(status, content_type) for a RANGE request, or (None, reason).

    A range request rather than a full GET: we need the response headers, not
    the photograph, and asking for a kilobyte of somebody's CDN to answer a
    policy question is the polite version."""
    req = urllib.request.Request(url, headers={
        "User-Agent": sa.fla.UA,
        "Referer": REFERER,
        "Accept": "image/*,*/*;q=0.8",
        "Range": "bytes=0-1024",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout,
                                    context=sa.fla._SSL_CTX) as resp:
            return resp.status, (resp.headers.get("Content-Type") or "").lower()
    except urllib.error.HTTPError as exc:
        return exc.code, (exc.headers.get("Content-Type") or "").lower()
    except Exception as exc:  # noqa: BLE001 - one outlet must not stop the sweep
        return None, type(exc).__name__


def verdict_for(urls):
    """`yes`/`no` for one outlet, plus the evidence.

    ANY sample serving is a yes. A CDN that refuses one photo and serves
    another is not refusing us — and the failure direction matters: a wrong
    `no` permanently suppresses images the outlet was happy to serve, while a
    wrong `yes` costs one request that the component's onError already
    handles."""
    results = []
    for url in urls:
        code, ctype = probe(url)
        served = code in (200, 206) and str(ctype).startswith("image/")
        results.append({"url": url, "code": code, "ctype": ctype,
                        "served": served})
        if served:
            return "yes", results
    return "no", results


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--apply", action="store_true",
                    help="write the verdict into the registries")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--samples", type=int, default=3,
                    help="image URLs to try per outlet before recording `no`")
    args = ap.parse_args()

    samples = sample_images(args.samples)
    verdicts = {}
    for domain, urls in sorted(samples.items()):
        # ⚠️ An outlet that has told us not to crawl it is not asked again for
        # its images either. resolve_outlet_logos' own docstring warns that
        # retired_sites.csv "is exactly where a new script forgets to look" —
        # and this script forgot, and probed the bot-refused outlet.
        if rol.refuses_bots(domain):
            verdicts[domain] = {"verdict": "no", "tried": 0,
                                "evidence": [{"url": None, "code": None,
                                              "ctype": "bot_refused",
                                              "served": False}]}
            if not args.json:
                print(f"{domain:22} no   bot_refused — not probed")
            continue
        verdict, evidence = verdict_for(urls)
        verdicts[domain] = {"verdict": verdict, "tried": len(evidence),
                            "evidence": evidence}
        if not args.json:
            first = evidence[0]
            print(f"{domain:22} {verdict:4} "
                  f"tried={len(evidence)} last={first['code']}")

    if args.apply:
        for path in (DATA_DIR / "bg_news_sites.csv",
                     DATA_DIR / "retired_sites.csv"):
            rows, fields = rol.read_rows(path)
            if not rows:
                continue
            # Reuse an existing vintage rather than appending a second: an
            # appended column starts EMPTY and this pass only reaches outlets
            # that have a stored image, so a consumer resolving by column
            # order would take the blank cell. Same rule, same reason, as the
            # logo column.
            column = next((h for h in fields
                           if h and (h.strip().lower() == HOTLINK_COLUMN_PREFIX
                                     or h.strip().lower().startswith(
                                         HOTLINK_COLUMN_PREFIX + "_"))), None)
            if column is None:
                column = HOTLINK_COLUMN
                fields = list(fields) + [column]
            written = 0
            for row in rows:
                got = verdicts.get((row.get("domain") or "").strip())
                if got:
                    row[column] = got["verdict"]
                    written += 1
            rol.write_rows(path, rows, fields)
            print(f"{path.name}: {written} verdict(s) written", file=sys.stderr)

    refused = sorted(d for d, v in verdicts.items() if v["verdict"] == "no")
    if args.json:
        print(json.dumps({"outlets": len(verdicts), "refused": refused,
                          "rows": verdicts}, ensure_ascii=False))
    else:
        print(f"\n{len(verdicts) - len(refused)}/{len(verdicts)} outlets serve "
              f"images to our referer"
              + (f"; refused: {', '.join(refused)}" if refused else "")
              + ("" if args.apply else "  (dry run — pass --apply to write)"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
