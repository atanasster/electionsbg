#!/usr/bin/env python3
"""Re-stamp `party_tones[].party_id` from the current gazetteer.

`enrich_party_tones` runs once, at save time, so a gazetteer change is INERT
over every analysis already on disk: the party resolves today and the stored
record still says `party_id: None`, its tone never publishes, and the party
never enters an aggregate. This is the pass that makes such a change reach the
corpus.

⚠️ WHY IT EXISTS AT ALL. `MIN_PARTY_SURFACE_CHARS` admitted the three-letter
acronyms that are most Bulgarian party names — ДПС, БСП, ДСБ, ИТН, АБВ — which
a four-character floor had removed from the gazetteer entirely. Measured
2026-09-21, before this ran: 602 unresolved party-identity review items over
133 surfaces had no claim of any kind. The gazetteer rebuild fixes the
registry; only this fixes the records.

⚠️⚠️ IT FILLS ONLY THE SURFACES YOU NAME, AND THE DEFAULT IS NOTHING. A blanket
fill is not safe and the corpus proves it twice over: „ХДС" is claimed by the
Bulgarian „Християн-Социален Съюз" and is also the ordinary rendering of the
German CDU (45 records, all German coverage), and „ПСД" is claimed by a
Bulgarian party while the article carrying it is about Romania — PSD is the
Romanian Social Democratic Party. The gazetteer's own two-pass rule cannot see
either, because it compares Bulgarian parties with each other; the
cross-country refusal added to `build_gazetteer` catches only the surfaces
`party_identity_v2.json` has already declared foreign, and no list of every
foreign acronym exists. So the identity decision is made per surface, by a
human, in the command that runs this — not by whatever the registry happens to
claim.

⚠️ IT FILLS, IT NEVER OVERWRITES. A stored `party_id` was stamped by the
gazetteer of its day and may encode a claim that has since become contested.
Replacing it here would silently move an attribution between two real parties
on a page that names them, with nothing to review — so a disagreement is
REPORTED and left alone. Fill is safe in a way re-attribution is not: it can
only add an identity the registry currently claims uniquely.

⚠️ AND IT IS A ONE-OFF, DRY BY DEFAULT. It belongs to no chain: a pipeline step
that silently re-stamped identities on every run would make an identity change
untraceable to the decision that caused it.

    python3 news/scripts/backfill_party_ids.py                    # survey only
    python3 news/scripts/backfill_party_ids.py --surface ДПС --surface БСП
    python3 news/scripts/backfill_party_ids.py --surface ДПС --apply
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = Path(os.environ.get("DATA_BG_ROOT") or
            Path(__file__).resolve().parents[2])


def analyses(domain: str | None) -> list:
    pattern = os.path.join(str(ROOT), "news", "data", "analysis", "articles",
                           domain or "*", "*.json")
    return sorted(glob.glob(pattern))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--apply", action="store_true",
                    help="write the re-stamped records (default: report only)")
    ap.add_argument("--surface", action="append", default=[],
                    help="a party surface to fill; repeatable. Nothing is "
                         "filled unless named — see the module docstring")
    ap.add_argument("--domain", default=None, help="one outlet directory")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    import analyze_articles as aa

    # ⚠️ FOLDED THE SAME WAY `party_id_for_name` FOLDS. Compared raw, the
    # records spelled „ дпс " resolve but are reported as a different,
    # un-named surface — safe (it under-fills) and confusing.
    def fold(value: str) -> str:
        return " ".join(str(value or "").casefold().split()).strip('"\u201e\u201d')

    allowed = frozenset(fold(x) for x in args.surface)
    filled: dict = {}
    candidates: dict = {}
    disagreed: dict = {}
    unresolved: dict = {}
    scanned = touched = unreadable = 0
    for path in analyses(args.domain):
        try:
            with open(path, encoding="utf-8") as fh:
                analysis = json.load(fh)
        except (OSError, json.JSONDecodeError):
            unreadable += 1
            continue
        scanned += 1
        tones = analysis.get("party_tones")
        if not isinstance(tones, list) or not tones:
            continue
        changed = False
        for tone in tones:
            if not isinstance(tone, dict):
                continue
            surface = tone.get("party") or ""
            current = tone.get("party_id")
            resolved = aa.party_id_for_name(surface)
            if resolved is None:
                if current is None:
                    unresolved[surface] = unresolved.get(surface, 0) + 1
                continue
            if current is None:
                if fold(surface) not in allowed:
                    # Named nowhere, so nobody has decided it is the Bulgarian
                    # reading. Reported as a candidate, never written.
                    candidates[surface] = candidates.get(surface, 0) + 1
                    continue
                tone["party_id"] = resolved
                filled[surface] = filled.get(surface, 0) + 1
                changed = True
            elif str(current) != str(resolved):
                # ⚠️ REPORTED, NEVER REWRITTEN. See the module docstring.
                key = f"{surface}: {current} -> {resolved}"
                disagreed[key] = disagreed.get(key, 0) + 1
        if changed:
            touched += 1
            if args.apply:
                # ⚠️ THE SHARED WRITER, not a second copy. `write_json_atomic`
                # fsyncs and scopes its temp name by pid; a hand-rolled
                # `path.tmp` loses both, and two runs in the same directory
                # would race on one temp file.
                aa.write_json_atomic(path, analysis)

    report = {
        "mode": "news_backfill_party_ids",
        "applied": bool(args.apply),
        "scanned": scanned,
        # ⚠️ COUNTED, not skipped in silence: a corpus that stopped parsing
        # looks exactly like a corpus with nothing to fill.
        "unreadable": unreadable,
        "records_touched": touched,
        "entries_filled": sum(filled.values()),
        "filled_by_surface": dict(sorted(filled.items(),
                                         key=lambda kv: -kv[1])[:25]),
        # Resolvable today and NOT named on the command line: each one is an
        # identity decision waiting for a human, not a pending write.
        "candidates_not_named": dict(sorted(candidates.items(),
                                            key=lambda kv: -kv[1])[:25]),
        # A stored id the registry no longer agrees with — left alone on
        # purpose, and worth a human deciding about.
        "disagreements_left_alone": dict(sorted(disagreed.items(),
                                                key=lambda kv: -kv[1])[:25]),
        "still_unresolved_by_surface": dict(sorted(unresolved.items(),
                                                   key=lambda kv: -kv[1])[:25]),
        "still_unresolved_entries": sum(unresolved.values()),
    }
    if args.json:
        print(json.dumps(report, ensure_ascii=False))
    else:
        verb = "filled" if args.apply else "would fill"
        print(f"{verb} {report['entries_filled']} party_id(s) across "
              f"{touched} of {scanned} analyses"
              + (f" ({unreadable} unreadable)" if unreadable else ""))
        for surface, count in report["filled_by_surface"].items():
            print(f"  {count:5}  {surface}")
        if candidates:
            print("resolvable but NOT named — decide per surface before "
                  "filling (see the docstring: ХДС is the German CDU, ПСД is "
                  "Romanian):")
            for surface, count in report["candidates_not_named"].items():
                print(f"  {count:5}  {surface}")
        if disagreed:
            print("disagreements left alone (stored id != current registry):")
            for key, count in report["disagreements_left_alone"].items():
                print(f"  {count:5}  {key}")
        print(f"still unresolved: {report['still_unresolved_entries']} entries "
              f"over {len(unresolved)} surfaces")
        if not args.apply:
            print("dry run — pass --apply to write")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
