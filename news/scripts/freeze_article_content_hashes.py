#!/usr/bin/env python3
"""Freeze a hash over the fields an adjudicator actually reads.

`article_sha256` hashes the WHOLE article file, so any nightly enrichment
breaks it — on 2026-09-02 an image-rights pass rewrote 40 of the 1,833 baseline
files, three of them inside the gate's 75 assignment rows, and the gate could
not be scored at all until three exemptions were hand-written. This is the fix
that stops that recurring: a second hash over {title, description, content},
the exact fields `load_article` shows, which a metadata write cannot move.

⚠️ IT IS A SIDECAR, NOT A NEW FIELD ON THE ASSIGNMENTS. `assignments_sha256`
is a canonical hash over the whole assignment array, so adding a key to those
rows would invalidate every sealed pass — the same trap as re-freezing a moved
`article_sha256`. The sidecar states the `assignments_sha256` it was built
against instead, which is this directory's stated convention for any output
keyed by assignment_id.

⚠️ THE `basis` FIELD IS LOAD-BEARING AND MUST NEVER BE HAND-SET.

    frozen      the file's bytes still match `article_sha256`, so this content
                hash IS what the adjudicators read. Full provenance, and the
                scorer may use it to clear a future benign drift by itself.
    post_drift  the bytes had ALREADY moved when this ran, so the hash was
                taken from a file that is not the frozen one. It gives FORWARD
                protection — the content has not changed since `stamped_on` —
                and says nothing about whether it equals what pass A read.

Stamping every row `frozen` regardless would launder the three drifted rows
into looking as well-provenanced as the other 72 and make their exemptions
look removable. The basis is therefore DERIVED here by comparing hashes, never
declared, and the scorer refuses to clear a drift on a `post_drift` record.

    python3 news/scripts/freeze_article_content_hashes.py --write
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from score_editorial_treatment_agreement import (  # noqa: E402
    ROOT, canonical_sha, content_sha, file_sha,
)

EVAL_DIR = ROOT / "news" / "evals" / "editorial_treatment_v2"
SAMPLES = ("human-agreement-sample-2026-09-01.json",
           "russia-supplement-2026-09-01.json")
OUT = EVAL_DIR / "article-content-hashes-2026-09-04.json"


def build() -> dict:
    records: dict[str, dict] = {}
    bound: dict[str, str] = {}
    counts = {"frozen": 0, "post_drift": 0, "missing": 0}
    for name in SAMPLES:
        doc = json.loads((EVAL_DIR / name).read_text(encoding="utf-8"))
        bound[name] = doc.get("assignments_sha256")
        for row in doc["assignments"]:
            path = ROOT / row["article_path"]
            if not path.exists():
                counts["missing"] += 1
                continue
            basis = ("frozen" if file_sha(path) == row["article_sha256"]
                     else "post_drift")
            counts[basis] += 1
            records[row["assignment_id"]] = {
                "article_path": row["article_path"],
                "content_sha256": content_sha(path),
                "basis": basis,
                "sample": name,
            }
    return {
        "artifact": "editorial-treatment-v2-article-content-hashes",
        "stamped_on": "2026-09-04",
        "hashed_fields": ["title", "description", "content"],
        "hashed_fields_note":
            "Exactly what load_article() shows an adjudicator. `content_chars` "
            "is deliberately excluded: it is derived from `content`, so it adds "
            "no evidence and would break the hash if a fetcher recomputed it.",
        "assignments_sha256": bound,
        "counts": counts,
        "records": dict(sorted(records.items())),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true",
                        help="write the artifact; otherwise report only")
    args = parser.parse_args()
    doc = build()
    print(json.dumps({"counts": doc["counts"],
                      "records": len(doc["records"]),
                      "out": str(OUT.relative_to(ROOT))}, indent=2))
    if not args.write:
        print("dry run — pass --write to freeze")
        return 0
    if OUT.exists():
        old = json.loads(OUT.read_text(encoding="utf-8"))
        regressed = [k for k, v in (old.get("records") or {}).items()
                     if v.get("basis") == "frozen"
                     and doc["records"].get(k, {}).get("basis") != "frozen"]
        if regressed:
            # A row losing `frozen` means its file drifted after this artifact
            # was written. Overwriting would destroy the one record able to
            # prove the drift was benign — the exact evidence this exists for.
            print(json.dumps({"refused": "rows would lose their frozen basis",
                              "rows": sorted(regressed)}, indent=2))
            return 1
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
                   encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
