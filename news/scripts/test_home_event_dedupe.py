#!/usr/bin/env python3

import unittest

from home_event_dedupe import (
    build_story_merge_queue, dedupe_home_events, rejected_story_pairs,
    same_event_evidence,
)


def story(
    sid, title, published, *, people=(), places=(),
    topic=("politics", "elections"),
):
    return {
        "id": sid,
        "title_bg": title,
        "last_published": published,
        "topics": [{"category": topic[0], "subcategory": topic[1], "primary": True}],
        "entities": {
            "people": list(people), "parties": [], "institutions": [],
            "companies": [], "places": list(places),
        },
    }


class HomeEventDedupe(unittest.TestCase):
    def test_same_announcement_is_suppressed_and_proposed(self):
        left = story(
            "s1", "Андрей Гюров обявява на 31 август дали ще се кандидатира за президент",
            "2026-08-31T06:00:00+00:00", people=("Андрей Гюров",),
        )
        right = story(
            "s2", "Андрей Гюров казва на 31 август дали ще се кандидатира за президент",
            "2026-08-31T05:00:00+00:00", people=("Андрей Гюров",),
        )
        kept, proposals = dedupe_home_events([left, right])
        self.assertEqual([item["id"] for item in kept], ["s1"])
        self.assertEqual(proposals[0]["candidate_story_id"], "s2")
        self.assertEqual(proposals[0]["matched_story_id"], "s1")
        self.assertIn("андрей", proposals[0]["shared_title_tokens"])

    def test_same_person_different_event_is_not_suppressed(self):
        candidacy = story(
            "s1", "Андрей Гюров обявява кандидатура за президент",
            "2026-08-31T06:00:00+00:00", people=("Андрей Гюров",),
        )
        court = story(
            "s2", "Съдът разгледа жалбата на Андрей Гюров срещу БНБ",
            "2026-08-31T07:00:00+00:00", people=("Андрей Гюров",),
        )
        self.assertIsNone(same_event_evidence(candidacy, court))

    def test_topic_disagreement_and_large_time_gap_fail_closed(self):
        base = story(
            "s1", "Парламентът прие окончателно новия държавен бюджет за 2027 година",
            "2026-08-31T06:00:00+00:00", topic=("economy", "budget"),
        )
        other_topic = story(
            "s2", "Парламентът прие окончателно новия държавен бюджет за 2027 година",
            "2026-08-31T06:30:00+00:00", topic=("politics", "parliament"),
        )
        old = story(
            "s3", "Парламентът прие окончателно новия държавен бюджет за 2027 година",
            "2026-08-27T06:00:00+00:00", topic=("economy", "budget"),
        )
        self.assertIsNone(same_event_evidence(base, other_topic))
        self.assertIsNone(same_event_evidence(base, old))

    def test_same_actor_and_action_with_different_targets_fail_closed(self):
        china = story(
            "s1", "Тръмп наложи нови мита на Китай",
            "2026-08-31T06:00:00+00:00", people=("Доналд Тръмп",), places=("Китай",),
        )
        india = story(
            "s2", "Тръмп наложи нови мита на Индия",
            "2026-08-31T06:30:00+00:00", people=("Доналд Тръмп",), places=("Индия",),
        )
        self.assertIsNone(same_event_evidence(china, india))

    def test_conflicting_numbers_fail_closed(self):
        first = story(
            "s1", "Парламентът прие бюджет с дефицит 3 процента",
            "2026-08-31T06:00:00+00:00", people=("Румен Радев",),
        )
        second = story(
            "s2", "Парламентът прие бюджет с дефицит 5 процента",
            "2026-08-31T06:30:00+00:00", people=("Румен Радев",),
        )
        self.assertIsNone(same_event_evidence(first, second))

    def test_a_strong_direct_bridge_yields_one_event_but_keeps_its_evidence(self):
        first = story(
            "s1", "Нападнаха танкер в Ормузкия проток",
            "2026-08-31T06:00:00+00:00", people=("Иран", "Оман"),
            topic=("foreign-policy", "bilateral"),
        )
        bridge = story(
            "s2", "Нападнаха с неидентифициран снаряд танкер в Ормузкия проток",
            "2026-08-31T05:30:00+00:00",
            people=("Иран", "Оман", "Морски операции", "Революционна гвардия"),
            topic=("foreign-policy", "bilateral"),
        )
        third = story(
            "s3", "Танкер беше нападнат в Ормузкия проток",
            "2026-08-31T05:00:00+00:00",
            people=("Морски операции", "Революционна гвардия"),
            topic=("foreign-policy", "bilateral"),
        )
        kept, proposals = dedupe_home_events([first, bridge, third])
        self.assertEqual([item["id"] for item in kept], ["s1"])
        third_proposal = next(
            item for item in proposals if item["candidate_story_id"] == "s3"
        )
        self.assertEqual(third_proposal["keeper_story_id"], "s1")
        self.assertEqual(third_proposal["matched_story_id"], "s2")

    def test_review_queue_preserves_decisions_and_deactivates_disappeared_pairs(self):
        first = story(
            "s1", "Андрей Гюров обявява на 31 август дали ще се кандидатира за президент",
            "2026-08-31T06:00:00+00:00", people=("Андрей Гюров",),
        )
        second = story(
            "s2", "Андрей Гюров казва на 31 август дали ще се кандидатира за президент",
            "2026-08-31T05:00:00+00:00", people=("Андрей Гюров",),
        )
        _, proposals = dedupe_home_events([first, second])
        initial = build_story_merge_queue(
            None, proposals, {"s1": first, "s2": second}, "2026-08-31T07:00:00Z"
        )
        self.assertEqual(initial["items"][0]["status"], "pending")
        self.assertEqual(initial["items"][0]["candidate"]["title_bg"], second["title_bg"])
        unchanged = build_story_merge_queue(
            initial, proposals, {"s1": first, "s2": second},
            "2026-08-31T08:00:00Z",
        )
        self.assertEqual(unchanged, initial)
        reviewed = {
            **initial,
            "items": [{**initial["items"][0], "status": "rejected"}],
        }
        later = build_story_merge_queue(
            reviewed, [], {"s1": first, "s2": second}, "2026-09-01T07:00:00Z"
        )
        self.assertEqual(later["items"][0]["status"], "rejected")
        self.assertFalse(later["items"][0]["active"])
        self.assertEqual(later["items"][0]["first_seen"], "2026-08-31T07:00:00Z")
        self.assertEqual(later["items"][0]["last_seen"], "2026-08-31T07:00:00Z")
        kept, proposals = dedupe_home_events(
            [first, second], rejected_story_pairs(reviewed)
        )
        self.assertEqual([item["id"] for item in kept], ["s1", "s2"])
        self.assertEqual(proposals, [])



if __name__ == "__main__":
    unittest.main()
