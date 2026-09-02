"""Measure and gate the exact story payload the default homepage will show."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import statistics


MIN_DEFAULT_STORIES = 6
MAX_DEFAULT_DAYS = 7

# ⚠️ HOW FAR AHEAD OF `generated_at` A STORY MAY BE STAMPED AND STILL COUNT AS
# PUBLISHED. Not slack for broken feeds — the size is derived from one rule in
# the ingest.
#
# A source that states a DAY and no wall clock is anchored at noon Sofia on
# purpose (`_DAY_ONLY_RE` in save_articles.py): midnight Sofia converts to
# 21:00 UTC the day BEFORE, which would file the article under the wrong day.
# Noon is the only anchor whose UTC day equals the stated day in both EET and
# EEST. Noon Sofia is 09:00 UTC in summer and 10:00 in winter, so a bundle
# generated just after midnight UTC sees that article up to 10 hours "ahead".
#
# Measured 2026-09-02: a 05:53 UTC run put ALL 16 stories in the future, three
# of them dir.bg date-only values, and the home payload came out EMPTY — the
# gate refused to publish a home page with no stories on it. The stamp was not
# wrong; the reading of it was. A date-only anchor is a claim about the DAY,
# and inside that day the only honest age is "now".
#
# 12 hours covers the winter anchor with margin and still refuses a genuinely
# broken feed: the offender this gate was written for was capital.bg, dated
# nearly two months out.
FUTURE_ANCHOR_TOLERANCE_HOURS = 12


def _instant(value: str | None) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value or "")
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(timezone.utc)


def _age_hours(now: datetime, value: str | None) -> float | None:
    """Hours since publication, or None when the value is unusable.

    A story stamped slightly AHEAD of `now` reads as age 0 rather than as a
    negative number — see `FUTURE_ANCHOR_TOLERANCE_HOURS`. Beyond that horizon
    the negative age is returned unchanged, so the caller can exclude the story
    AND fail `no_future_story_timestamps` on it.
    """
    parsed = _instant(value)
    if parsed is None:
        return None
    age = (now - parsed).total_seconds() / 3600
    if -FUTURE_ANCHOR_TOLERANCE_HOURS <= age < 0:
        return 0.0
    return age


def evaluate_home_payload(
    home: dict, eligibility_counts: dict[str, int] | None = None
) -> dict:
    generated_at = _instant(home.get("generated_at"))
    if generated_at is None:
        raise ValueError("home.generated_at must be a timezone-aware ISO timestamp")
    stories = home.get("stories")
    articles = home.get("articles")
    if not isinstance(stories, list) or not isinstance(articles, list):
        raise ValueError("home stories/articles must be arrays")

    measured = []
    for story in stories:
        if not isinstance(story, dict) or not isinstance(story.get("id"), str):
            raise ValueError("home story must be an object with an id")
        measured.append((story, _age_hours(generated_at, story.get("last_published"))))
    within_24h = [item for item in measured if item[1] is not None and 0 <= item[1] <= 24]
    default_days = 1 if len(within_24h) >= MIN_DEFAULT_STORIES else MAX_DEFAULT_DAYS
    visible = [
        item for item in measured
        if item[1] is not None and 0 <= item[1] <= default_days * 24
    ]
    visible_ids = [item[0]["id"] for item in visible]
    article_story_ids = {
        article.get("story_id") for article in articles
        if isinstance(article, dict) and article.get("analysis")
    }
    image_story_ids = {
        article.get("story_id") for article in articles
        if isinstance(article, dict)
        and article.get("image")
        and (article.get("image_rights") or {}).get("display_home") is True
    }
    ages = [age for _, age in visible if age is not None]
    default_payload = [
        {
            "id": story["id"],
            "title_bg": story.get("title_bg"),
            "last_published": story.get("last_published"),
            "age_hours": round(age, 2),
            "comparison": (
                (story.get("aggregates") or {}).get("outlet_count", 0) >= 2
                and (story.get("aggregates") or {}).get("article_count", 0) >= 2
            ),
            "image_eligible": story["id"] in image_story_ids,
        }
        for story, age in visible
    ]
    counts = {
        **(eligibility_counts or {}),
        "selected_unique_events": len(stories),
        "selected_within_24h": len(within_24h),
        "default_visible": len(visible),
        "default_comparisons": sum(item["comparison"] for item in default_payload),
        "default_image_eligible": sum(item["image_eligible"] for item in default_payload),
        "merge_proposals": len(home.get("merge_proposals") or []),
    }
    checks = {
        "selected_payload_not_empty": bool(stories),
        "has_story_within_24h": bool(within_24h),
        "default_window_at_most_7_days": default_days <= MAX_DEFAULT_DAYS,
        "default_payload_not_empty": bool(visible),
        "selected_story_ids_unique": len({story["id"] for story in stories}) == len(stories),
        "default_story_ids_unique": len(set(visible_ids)) == len(visible_ids),
        "default_oldest_within_window": bool(ages) and max(ages) <= default_days * 24,
        "no_future_story_timestamps": all(
            age is not None and age >= 0 for _, age in measured
        ),
        "every_default_story_has_analyzed_article": set(visible_ids) <= article_story_ids,
    }
    age_stats = {
        "newest_hours": round(min(ages), 2) if ages else None,
        "median_hours": round(statistics.median(ages), 2) if ages else None,
        "oldest_hours": round(max(ages), 2) if ages else None,
    }
    if any(
        value is not None and (not isinstance(value, (int, float)) or not math.isfinite(value))
        for value in age_stats.values()
    ):
        raise ValueError("home age statistics must be finite")
    return {
        "version": 1,
        "default_days": default_days,
        "thresholds": {
            "stories_for_24h_default": MIN_DEFAULT_STORIES,
            "maximum_implicit_days": MAX_DEFAULT_DAYS,
            "newest_story_max_hours": 24,
        },
        "counts": counts,
        "default_age_hours": age_stats,
        "default_payload": default_payload,
        "checks": checks,
        "ready": all(checks.values()),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", type=Path, default=Path("news/app-data/home.json"))
    parser.add_argument("--enforce", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    try:
        home = json.loads(args.home.read_text(encoding="utf-8"))
        declared = home.get("home_health")
        counts = declared.get("counts") if isinstance(declared, dict) else None
        eligibility = {
            key: value for key, value in (counts or {}).items()
            if key.startswith("recent_") and isinstance(value, int)
        }
        measured = evaluate_home_payload(home, eligibility)
        selected_payload_matches = declared == measured
        ready = selected_payload_matches and measured["ready"]
        result = {
            "mode": "home_health",
            "ready": ready,
            "declared_selected_payload_matches": selected_payload_matches,
            "eligibility_counts_verified": False,
            "health": measured,
        }
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        result = {"mode": "home_health", "ready": False, "error": str(exc)}
        ready = False
    print(json.dumps(result, ensure_ascii=False) if args.json else json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if args.enforce and not ready else 0


if __name__ == "__main__":
    raise SystemExit(main())
