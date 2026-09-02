#!/usr/bin/env python3

import unittest
import json
from pathlib import Path
import subprocess
import sys
import tempfile

from home_health import evaluate_home_payload


def story(index, age_hours, *, outlets=1):
    hour = 12 - age_hours
    return {
        "id": f"s{index}",
        "title_bg": f"История {index}",
        "last_published": f"2026-08-31T{hour:02d}:00:00+00:00",
        "aggregates": {"outlet_count": outlets},
    }


def bundle(stories):
    return {
        "generated_at": "2026-08-31T12:00:00+00:00",
        "stories": stories,
        "articles": [
            {"story_id": item["id"], "analysis": {"summary_bg": "x"}}
            for item in stories
        ],
        "merge_proposals": [],
    }


class HomeHealth(unittest.TestCase):
    def test_six_fresh_stories_choose_the_24_hour_default(self):
        health = evaluate_home_payload(bundle([story(i, i + 1) for i in range(6)]))
        self.assertEqual(health["default_days"], 1)
        self.assertEqual(health["counts"]["default_visible"], 6)
        self.assertTrue(health["ready"])

    def test_thin_feed_expands_only_to_seven_days_and_reports_actual_rows(self):
        stories = [story(1, 2), {
            "id": "older", "title_bg": "По-стара", "aggregates": {"outlet_count": 2},
            "last_published": "2026-08-27T12:00:00+00:00",
        }, {
            "id": "stale", "title_bg": "Осмия ден", "aggregates": {"outlet_count": 1},
            "last_published": "2026-08-23T11:00:00+00:00",
        }]
        health = evaluate_home_payload(bundle(stories))
        self.assertEqual(health["default_days"], 7)
        self.assertEqual(
            [item["id"] for item in health["default_payload"]], ["s1", "older"]
        )
        self.assertLessEqual(health["default_age_hours"]["oldest_hours"], 168)
        self.assertTrue(health["ready"])

    def test_no_story_in_24_hours_fails_the_publish_gate(self):
        home = bundle([{
            "id": "old", "title_bg": "Стара", "aggregates": {"outlet_count": 1},
            "last_published": "2026-08-29T12:00:00+00:00",
        }])
        health = evaluate_home_payload(home)
        self.assertFalse(health["checks"]["has_story_within_24h"])
        self.assertFalse(health["ready"])

    def test_missing_analyzed_representative_fails(self):
        home = bundle([story(1, 1)])
        home["articles"] = []
        health = evaluate_home_payload(home)
        self.assertFalse(health["checks"]["every_default_story_has_analyzed_article"])

    def test_exact_time_boundaries_do_not_round_into_the_window(self):
        over_day = {
            "id": "over-day", "title_bg": "Над ден", "aggregates": {"outlet_count": 1},
            "last_published": "2026-08-30T11:59:59+00:00",
        }
        over_week = {
            "id": "over-week", "title_bg": "Над седмица",
            "aggregates": {"outlet_count": 1},
            "last_published": "2026-08-24T11:59:59+00:00",
        }
        # ⚠️ BEYOND the anchor tolerance, not one second past `generated_at`.
        # A story slightly ahead is now read as age 0 on purpose — see
        # FUTURE_ANCHOR_TOLERANCE_HOURS — so a 1-second value tests the old
        # boundary rather than the one that exists.
        future = {
            "id": "future", "title_bg": "Бъдеща", "aggregates": {"outlet_count": 1},
            "last_published": "2026-09-01T00:00:01+00:00",
        }
        health = evaluate_home_payload(bundle([over_day, over_week, future]))
        self.assertEqual(health["counts"]["selected_within_24h"], 0)
        self.assertEqual(health["counts"]["default_visible"], 1)
        self.assertEqual(health["default_payload"][0]["id"], "over-day")
        self.assertFalse(health["checks"]["no_future_story_timestamps"])

    def test_a_date_only_noon_anchor_counts_as_published_today(self):
        """⚠️ THE CASE THAT EMPTIED THE HOME PAYLOAD. A source stating a DAY
        and no wall clock is anchored at noon Sofia by the ingest, so before
        09:00 UTC it is legitimately hours 'ahead'. Measured 2026-09-02, a
        05:53 UTC run put all 16 stories in the future and the payload came out
        empty — the gate refusing to publish a home page with nothing on it.
        The stamp was not wrong; reading a day-claim as an instant was."""
        anchored = {
            "id": "anchored", "title_bg": "Дневна котва",
            "aggregates": {"outlet_count": 1},
            # generated_at is 12:00 UTC; noon Sofia that day is 09:00 UTC, so
            # this is the shape seen at an early-morning run, shifted forward.
            "last_published": "2026-08-31T21:00:00+00:00",
        }
        health = evaluate_home_payload(bundle([anchored]))
        self.assertTrue(health["checks"]["no_future_story_timestamps"])
        self.assertEqual(health["counts"]["default_visible"], 1)
        self.assertEqual(health["counts"]["selected_within_24h"], 1)
        self.assertEqual(health["default_payload"][0]["age_hours"], 0)

    def test_the_tolerance_has_an_edge_and_refuses_past_it(self):
        """It is a derived bound, not slack: 12 hours covers the winter noon
        anchor (10:00 UTC) with margin. A feed dated beyond it is broken —
        the offender this check was written for was nearly two months out."""
        def at(stamp):
            item = {"id": "s", "title_bg": "x",
                    "aggregates": {"outlet_count": 1}, "last_published": stamp}
            return evaluate_home_payload(bundle([item]))

        inside = at("2026-08-31T23:59:59+00:00")   # 11h59m59s ahead
        self.assertTrue(inside["checks"]["no_future_story_timestamps"])
        self.assertEqual(inside["counts"]["default_visible"], 1)

        outside = at("2026-09-01T00:00:01+00:00")  # 12h00m01s ahead
        self.assertFalse(outside["checks"]["no_future_story_timestamps"])
        self.assertEqual(outside["counts"]["default_visible"], 0)

    def test_comparison_matches_the_ui_two_article_predicate(self):
        item = story(1, 1, outlets=2)
        item["aggregates"]["article_count"] = 1
        health = evaluate_home_payload(bundle([item]))
        self.assertFalse(health["default_payload"][0]["comparison"])

    def test_enforcement_cli_rejects_a_tampered_declaration(self):
        home = bundle([story(i, i + 1) for i in range(6)])
        home["home_health"] = evaluate_home_payload(home)
        script = Path(__file__).with_name("home_health.py")
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "home.json"
            path.write_text(json.dumps(home), encoding="utf-8")
            good = subprocess.run(
                [sys.executable, str(script), "--home", str(path), "--enforce", "--json"],
                text=True, capture_output=True,
            )
            self.assertEqual(good.returncode, 0, good.stdout + good.stderr)
            home["home_health"]["default_days"] = 7
            path.write_text(json.dumps(home), encoding="utf-8")
            bad = subprocess.run(
                [sys.executable, str(script), "--home", str(path), "--enforce", "--json"],
                text=True, capture_output=True,
            )
            self.assertEqual(bad.returncode, 1)
            self.assertFalse(json.loads(bad.stdout)["declared_selected_payload_matches"])


if __name__ == "__main__":
    unittest.main()
