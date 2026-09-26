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

import os

FLAGS = {
    "rail": "NEWS_PERSON_RAIL",
    "aggregates": "NEWS_PERSON_AGGREGATES",
    "matrix": "NEWS_PERSON_MATRIX",
}
ON = frozenset({"1", "true", "on"})
OFF = frozenset({"", "0", "false", "off"})


class PersonPublicationError(ValueError):
    """A flag cannot be read. Never silently off."""


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
