#!/usr/bin/env python3
"""Which person-sentiment surfaces are published — one switch per surface.

Plan: `docs/plans/news-person-sentiment-v1.md` §8. Each is an env line in
`news/.env.pipeline` (never the shell), read once per build:

    NEWS_PERSON_RAIL=1         the article page's „Хора в материала" rail
    NEWS_PERSON_AGGREGATES=1   person pages, /persons, the outlet section,
                               the main-site tile
    NEWS_PERSON_MATRIX=1       the outlet × person grid

⚠️ OFF BY DEFAULT, and the build is what obeys it: an off surface is not
hidden in the UI, its data is not WRITTEN. The rail ships only when the
identity join's precision audit has passed; the aggregates only when the
person accuracy gate has; the election freeze (§8.2) applies on top of both.

⚠️ AN UNREADABLE VALUE IS REFUSED, NOT READ AS OFF — the `jev_publication`
rule. „yes" or „on " would otherwise look identical to the default, which is
the one case where an operator believes they have shipped and have not.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

FLAGS = {
    "rail": "NEWS_PERSON_RAIL",
    "aggregates": "NEWS_PERSON_AGGREGATES",
    "matrix": "NEWS_PERSON_MATRIX",
}
ON = frozenset({"1", "true", "on"})
OFF = frozenset({"", "0", "false", "off"})


class PersonPublicationError(ValueError):
    """A flag cannot be read. Never silently off."""


PRECISION_PATH = (Path(__file__).resolve().parent.parent / "evals"
                  / "person_link_precision.json")
PRECISION_MIN_PAIRS = 100
PRECISION_FLOOR = 0.98


def link_precision(path: Path = PRECISION_PATH) -> dict | None:
    """The §3.2 hand audit of the join's steps 2–3 — `{pairs, correct}` —
    or None when it has not been recorded."""
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
        pairs, correct = int(doc["pairs"]), int(doc["correct"])
    except (OSError, ValueError, KeyError, TypeError):
        return None
    return {"pairs": pairs, "correct": correct,
            "precision": correct / pairs if pairs else None}


def readiness_alerts(surfaces: frozenset, path: Path = PRECISION_PATH,
                     gate: dict | None = None) -> list:
    """What an ON switch is missing. ⚠️ Reported on every run rather than
    refusing the build: the switch is the operator's, and a refusal would take
    the article pages down with it — but an unmet precondition must never be
    silent (§8: the rail ships when the join's precision audit passes)."""
    out = []
    audit = link_precision(path)
    if "rail" in surfaces and (
            audit is None or audit["pairs"] < PRECISION_MIN_PAIRS
            or (audit["precision"] or 0) < PRECISION_FLOOR):
        state = "is missing" if audit is None else "is below the floor"
        out.append({"alert": "person_rail_without_link_audit",
                    "message": f"NEWS_PERSON_RAIL is on but {path.name} {state} — "
                               f"≥{PRECISION_MIN_PAIRS} hand-checked context/alias "
                               f"links at ≥{PRECISION_FLOOR:.0%} precision (§3.2)"})
    # §8/§9 — the aggregates ship when the gate passes (the agreement arm
    # may stay open, stated on the methodology page).
    if "aggregates" in surfaces and not (gate or {}).get("passed_without_agreement"):
        out.append({"alert": "person_aggregates_without_gate",
                    "message": "NEWS_PERSON_AGGREGATES is on but the person "
                               "accuracy gate has not passed (§8)"})
    return out


def published(env=None) -> frozenset:
    """The person surfaces switched on, from the environment."""
    source = env if env is not None else os.environ
    out = set()
    for surface, name in FLAGS.items():
        raw = str(source.get(name) or "").strip().lower()
        if raw in ON:
            out.add(surface)
        elif raw not in OFF:
            raise PersonPublicationError(
                f"{name}={source.get(name)!r} — use 1 to publish, 0 or empty "
                "to hold")
    if "matrix" in out and "aggregates" not in out:
        # The grid is built from the person shards; without them it would
        # publish cells whose evidence pages do not exist.
        raise PersonPublicationError(
            "NEWS_PERSON_MATRIX needs NEWS_PERSON_AGGREGATES — every cell "
            "links to a person page")
    return frozenset(out)
