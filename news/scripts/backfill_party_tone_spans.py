#!/usr/bin/env python3
"""Migrate legacy party tones (v2 `evidence`) to the v3 contract.

v3 splits the overloaded `evidence` field into `rationale` — the prose a reader
sees — and `evidence_spans` — provenance, the only thing the gate checks. See
PARTY_TONE_SPAN_FIELDS in analyze_articles for why.

⚠️⚠️ IT NEVER MANUFACTURES A SPAN, and that is the whole design. A legacy
`evidence` string was written under a prompt that asked for „дословен цитат ИЛИ
конкретна проверима перифраза", so it is prose of unknown provenance. Promoting
it to a span would stamp `located: True` on something nobody verified — a
fabricated quote wearing a verified badge, which is the exact failure the v3
contract exists to prevent. Prose migrates to prose; provenance is earned by
re-analysis under v3, never by relabelling.

⚠️ MEASURED BEFORE IT WAS WRITTEN, and the numbers are why it needs no judgement
calls. Over the 717 v2 records on disk, 1,450 tones:

    neutral       1,175   4 of them verbatim, 1,171 paraphrase
    unfavorable     152   every one a paraphrase
    favorable       110   every one a paraphrase
    mixed            13   every one a paraphrase

Not one directional tone carries a locatable quote. So:

  • `neutral` migrates to a supported v3 tone — it needs no span, because
    „no evaluative framing was found" is not a thing a quote can show. These
    1,175 pairs were withheld from every reader by a contract defect and this
    is what releases them.
  • `favorable` / `unfavorable` / `mixed` migrate to an UNSUPPORTED v3 tone and
    stay withheld, correctly. They are queued for review exactly as before, and
    only re-analysis under v3 can give them provenance.

The four verbatim `neutral` strings are reported rather than converted: v3
forbids a span on a neutral tone, so there is nowhere for them to go.

    python3 news/scripts/backfill_party_tone_spans.py            # report only
    python3 news/scripts/backfill_party_tone_spans.py --apply
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = Path(os.environ.get("DATA_BG_ROOT") or
            Path(__file__).resolve().parents[2])

# The version this migration reads. A record already at v3 is left alone.
LEGACY_VERSION = 2


def article_for(analysis: dict):
    path = analysis.get("article_path")
    if not path:
        return None
    try:
        with open(os.path.join(str(ROOT), path), encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None


class PreExistingSpans(ValueError):
    """A v2-stamped tone that already carries provenance."""


def migrate_tone(tone: dict) -> dict:
    """One tone, from v2 prose to the v3 shape — with no span invented.

    ⚠️ REFUSES A TONE THAT ALREADY HAS SPANS. A record stamped v2 whose tones
    carry `evidence_spans` is a shape this migration did not produce and cannot
    interpret — and blindly writing `[]` over it DESTROYS located provenance,
    demotes a supported tone to withheld, and reports `spans_created: 0` while
    doing it. There are none today; the guard is what keeps that true.
    """
    if tone.get("evidence_spans"):
        raise PreExistingSpans(str(tone.get("party")))
    out = {k: v for k, v in tone.items() if k != "evidence"}
    out["rationale"] = str(tone.get("evidence") or "").strip()
    out["evidence_spans"] = []
    return out


def main() -> int:
    import analyze_articles as aa

    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--apply", action="store_true",
                    help="write the migrated records (default: report only)")
    ap.add_argument("--domain", default=None, help="one outlet directory")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    stamp = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    pattern = os.path.join(str(ROOT), "news", "data", "analysis", "articles",
                           args.domain or "*", "*.json")

    scanned = migrated = unreadable = no_article = 0
    demoted = spans_created = 0
    refused: list = []
    supported: dict = {}
    withheld: dict = {}
    verbatim_neutral = 0
    for path in sorted(glob.glob(pattern)):
        try:
            with open(path, encoding="utf-8") as fh:
                analysis = json.load(fh)
        except (OSError, json.JSONDecodeError):
            unreadable += 1
            continue
        scanned += 1
        if analysis.get("party_tones_version") != LEGACY_VERSION:
            continue
        tones = analysis.get("party_tones")
        if not isinstance(tones, list) or not tones:
            continue
        record = article_for(analysis)
        if record is None:
            # ⚠️ COUNTED, NOT MIGRATED. The gate re-runs against the article,
            # so migrating without one would leave `evidence_grounded` decided
            # by nothing.
            no_article += 1
            continue
        title, body, _ = aa.evidence_snapshot(record)
        for tone in tones:
            if not isinstance(tone, dict):
                continue
            legacy = str(tone.get("evidence") or "")
            if (tone.get("tone") == "neutral" and legacy
                    and (aa.locate_evidence_span(legacy, body)
                         or aa.locate_evidence_span(legacy, title))):
                verbatim_neutral += 1
        try:
            converted = [migrate_tone(t) if isinstance(t, dict) else t
                         for t in tones]
        except PreExistingSpans as exc:
            refused.append(f"{os.path.relpath(path, str(ROOT))}: {exc}")
            continue
        # ⚠️ THE INVARIANT THAT MADE THIS SAFE, MEASURED RATHER THAN ASSUMED.
        # A migration may release a withheld tone; it may never withhold one
        # that was published. Without this the run reports success while
        # quietly removing assessments from the site.
        before = {id(t): bool(t.get("evidence_grounded"))
                  for t in tones if isinstance(t, dict)}
        analysis["party_tones"] = converted
        analysis["party_tones_version"] = aa.PARTY_TONES_VERSION
        analysis["party_tones_migrated_from"] = LEGACY_VERSION
        analysis["party_tones_migrated_at"] = stamp
        aa.gate_party_tone_evidence(analysis, record)
        for original, tone in zip(tones, analysis["party_tones"]):
            if not isinstance(tone, dict):
                continue
            if before.get(id(original)) and not tone.get("evidence_grounded"):
                demoted += 1
            spans_created += len(tone.get("evidence_spans") or [])
            bucket = supported if tone.get("evidence_grounded") else withheld
            label = str(tone.get("tone"))
            bucket[label] = bucket.get(label, 0) + 1
        migrated += 1
        if args.apply:
            aa.write_json_atomic(path, analysis)

    report = {
        "mode": "news_backfill_party_tone_spans",
        "applied": bool(args.apply),
        "migrated_at": stamp,
        "scanned": scanned,
        "records_migrated": migrated,
        "records_without_an_article": no_article,
        "unreadable": unreadable,
        # ⚠️ REPORTED SEPARATELY, because „grounded rate" alone is not
        # accuracy: a tone is supported here only in the sense that its LABEL
        # needs no span, never that anyone checked what it says.
        "supported_after_migration": dict(sorted(supported.items())),
        "withheld_after_migration": dict(sorted(withheld.items())),
        "verbatim_neutral_evidence": verbatim_neutral,
        # ⚠️ COUNTED, NOT ASSERTED. Hard-coding the zero this migration
        # promises makes the promise unfalsifiable — and the test asserting it
        # vacuous.
        "spans_created": spans_created,
        "demoted_from_grounded": demoted,
        "refused_records": refused,
    }
    if args.json:
        print(json.dumps(report, ensure_ascii=False))
    else:
        verb = "migrated" if args.apply else "would migrate"
        print(f"{verb} {migrated} of {scanned} analyses")
        print(f"  supported after migration: {report['supported_after_migration']}")
        print(f"  withheld after migration:  {report['withheld_after_migration']}")
        print(f"  verbatim neutral evidence (reported, not converted): "
              f"{verbatim_neutral}")
        if no_article:
            print(f"  skipped, no article on disk: {no_article}")
        print(f"  spans created: {spans_created} — provenance is earned by "
              "re-analysis")
        if demoted:
            print(f"  ⚠️ DEMOTED from grounded: {demoted}")
        for row in refused:
            print(f"  refused (already has spans): {row}")
        if not args.apply:
            print("dry run — pass --apply to write")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
