#!/usr/bin/env python3
"""One-off: strip flattened <script> from bodies already in the corpus.

The extractor stopped storing it (`save_articles.choose_body`), but that only
governs what is saved from now on. 244 of 13,507 stored bodies were written
before the guard existed — 215 dariknews.bg carrying a `window.teads_analytics`
block and 29 pogled.info carrying a bare JS identifier spliced into a word.

⚠️ RE-EXTRACTION IS NOT AN OPTION HERE, which is why this exists at all.
`save_articles --reextract` needs the page HTML, and these pages are gone or
changed: pogled.info serves a DIFFERENT article at the same URL (checked
2026-09-22 — the stored piece is about polar icebreakers, the live one about
antimatter). Re-fetching would replace one article with another and call it a
repair.

⚠️ IT CHANGES `content`, AND THAT DETACHES STORED ANALYSES ON PURPOSE. Every
analysis carries `article_content_hash`, and the staleness guards
(`person_tones.current_for` and its siblings) treat a changed body as „no
stored claim" rather than as a stale one. That is the correct outcome: those
analyses were computed over text with an ad tag in it, and the next run
recomputes them over the article. Measured before this ran: 106 of the 244
were analysed, 37 carried a positioned axis label or a party tone, and 1
carried a person tone.

Dry run by default. `--apply` writes.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from save_articles import homoglyph_share, strip_script_residue  # noqa: E402

ROOT = HERE.parent.parent


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data-dir", type=Path, default=ROOT / "news" / "data")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    by_domain: Counter = Counter()
    removed_total = 0
    reconciled = 0
    scanned = 0
    emptied: list = []
    for path in sorted(args.data_dir.glob("*/*.json")):
        if path.parent.name.startswith("_"):
            continue
        try:
            rec = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        body = rec.get("content") or ""
        if not body:
            continue
        scanned += 1
        clean, removed = strip_script_residue(body)
        if not removed:
            # ⚠️ A SECOND PASS THE FIRST CUT NEEDED AND DID NOT HAVE. An
            # earlier run rewrote `content` without recomputing the measures
            # derived from it, leaving 9 records describing text they no
            # longer held. Reconciling here means re-running this script is
            # what fixes that, rather than a second one-off.
            want = homoglyph_share(body) or None
            if rec.get("homoglyph_share") != want:
                reconciled += 1
                if args.apply:
                    rec["homoglyph_share"] = want
                    path.write_text(json.dumps(rec, ensure_ascii=False) + "\n",
                                    encoding="utf-8")
            continue
        # ⚠️ REFUSE A BODY THE STRIP WOULD GUT. If what is left is not an
        # article any more, the record was never an article — and replacing
        # it with a plausible stub is worse than leaving it for a human.
        if not clean or len(clean) < 200:
            emptied.append({"path": str(path), "url": rec.get("url"),
                            "before": len(body), "after": len(clean or "")})
            continue
        by_domain[path.parent.name] += 1
        removed_total += removed
        if args.apply:
            rec["content"] = clean
            rec["content_chars"] = len(clean)
            rec["extraction_residue_chars"] = removed
            # ⚠️ EVERY FIELD DERIVED FROM THE BODY IS RECOMPUTED. Changing
            # `content` and leaving a measure OF that content behind is how a
            # record ends up describing text it no longer holds — and this
            # one is read as „how obfuscated is this article".
            rec["homoglyph_share"] = homoglyph_share(clean) or None
            # The saver's own format (save_articles.py:1238) — one line, no
            # indent. Rewriting 244 files in a different shape would bury the
            # one-line change this makes in a whole-file diff.
            path.write_text(json.dumps(rec, ensure_ascii=False) + "\n",
                            encoding="utf-8")

    out = {"mode": "apply" if args.apply else "dry-run",
           "scanned": scanned,
           "repaired": sum(by_domain.values()),
           "chars_removed": removed_total,
           "derived_fields_reconciled": reconciled,
           "by_domain": dict(by_domain),
           "refused_would_be_gutted": emptied}
    if args.json:
        print(json.dumps(out, ensure_ascii=False, indent=2))
    else:
        print(f"{out['mode']}: {out['repaired']} of {scanned} bodies carry "
              f"script residue ({removed_total:,} chars); "
              f"{reconciled} derived field(s) out of step with their body")
        for d, n in by_domain.most_common():
            print(f"   {d:<22}{n:>5}")
        for row in emptied:
            print(f"   REFUSED (would be gutted): {row['url']} "
                  f"{row['before']} -> {row['after']}")
        if not args.apply and (out["repaired"] or reconciled):
            print("   re-run with --apply to write")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
