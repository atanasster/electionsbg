#!/usr/bin/env python3
"""T4.4 Phase 5 — which Jev axes are published, and to whom.

Plan: `docs/plans/news-jev-sentiment-scales-v1.md` Phase 5. „Flipped per axis,
never all at once, and only for axes Phase 0 cleared. Rollback is one
environment variable."

⚠️⚠️ NOTHING IS PUBLISHED BY DEFAULT, AND THAT IS THE POINT OF THE FILE.
`jev_ask.NEWS_JEV_SENTIMENT` decides whether the pass RUNS; this decides
whether what it produced reaches a reader, and the two are deliberately
separate. The whole of Phase 0 is a shadow run — the sidecars are written, the
eval reads them, and no page changes — so a single switch covering both would
make measuring the pass and publishing it the same act.

⚠️ PER AXIS, NOT ONE FLAG. Phase 0 scores `leaning`, `russia_stance` and
`subject_tone` separately and can clear them separately: the benchmark that
preceded this one found Jev winning by +53 points on one question and LOSING to
a constant on another, in the same run. A single boolean would publish the
second on the strength of the first.

    NEWS_JEV_PUBLISH=subject_tone            # one axis
    NEWS_JEV_PUBLISH=leaning,russia_stance   # two
    NEWS_JEV_PUBLISH=                        # the default: none

⚠️ AN UNKNOWN NAME IS REFUSED, NOT IGNORED. A typo („subject-tone",
„party_tone") would otherwise read as „publish nothing" and look identical to
the default — so the one case where an operator believes they have shipped and
have not is the one this raises on.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import jev_axes as ax  # noqa: E402

PUBLISH_ENV = "NEWS_JEV_PUBLISH"

# Every axis Phase 0 scores. `subject_tone` is the one the party and person
# archives read; the other two are article-level.
PUBLISHABLE_AXES = frozenset(
    {axis["id"] for axis in ax.ARTICLE_AXES} | {ax.SUBJECT_TONE.id})


class JevPublicationError(ValueError):
    """The publication set cannot be read. Never silently empty."""


def published_axes(env=None) -> frozenset:
    """The axes cleared for publication, from the environment.

    Empty by default — Phase 0 runs in shadow and no page changes.
    """
    raw = (env if env is not None else os.environ).get(PUBLISH_ENV) or ""
    names = [part.strip() for part in raw.split(",") if part.strip()]
    unknown = sorted(set(names) - PUBLISHABLE_AXES)
    if unknown:
        raise JevPublicationError(
            f"{PUBLISH_ENV}: unknown axis {unknown} — "
            f"known axes are {sorted(PUBLISHABLE_AXES)}")
    return frozenset(names)


def publishes(axis: str, env=None) -> bool:
    return axis in published_axes(env)


def attach_for_parties(collected: dict, data_dir, *, env=None) -> dict:
    """Attach stored subject scores to a party rollup's rows, if published.

    Returns a report: which axis, how many rows carried a score, and how many
    could be offered one. ⚠️ BOTH NUMBERS, because „0 attached" and „0
    available" are different states — the first is a join that failed, the
    second is a pass that has not run — and a single count reads as the
    happier of the two.
    """
    report = {"axis": ax.SUBJECT_TONE.id, "published": False,
              "records": 0, "stale": 0, "rows": 0, "attached": 0}
    if not publishes(ax.SUBJECT_TONE.id, env):
        return report
    report["published"] = True

    import jev_sentiment as sm  # noqa: PLC0415
    import sentiment_rollups as sr  # noqa: PLC0415

    records = {}
    for path in sm.sentiment_dir(data_dir).glob("*.json"):
        try:
            import json  # noqa: PLC0415
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        # ⚠️ THE STORE'S OWN FILTER, NOT A COPY OF PART OF IT. This gate once
        # kept only the `status` check and dropped all four version stamps, so
        # a record the store itself refuses as stale published verbatim onto a
        # party page and reported a clean attach — reachable from an ordinary
        # `NEWS_JEV_SENTIMENT=off` plus a cleared axis, which is exactly the
        # configuration the two flags exist to allow.
        if not isinstance(doc, dict) or not doc.get("url"):
            continue
        if not sm.answered(doc):
            # Counted, so „nothing to publish" and „everything is stale" are
            # not the same silence.
            report["stale"] += 1
            continue
        records[doc["url"]] = doc
    report["records"] = len(records)
    if not records:
        return report

    for party in (collected.get("parties") or {}).values():
        rows = party.get("rows") or []
        report["rows"] += len(rows)
        report["attached"] += sr.attach_sentiment(rows, records, kind="party")
    return report
