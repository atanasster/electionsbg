#!/usr/bin/env python3

import unittest

from home_event_dedupe import (
    RELAXATION_KINDS, build_story_merge_queue, dedupe_home_events,
    rejected_story_pairs, same_event_evidence,
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



class ReviewMode(unittest.TestCase):
    """Plan T2.1 — the relaxed reading proposes, never joins. Every strict
    veto it passes through is NAMED, and the strict rule is untouched."""

    def pair(self, **kw):
        left = story("s1", "Парламентът прие окончателно новия държавен бюджет за годината",
                     "2026-08-31T06:00:00+00:00", people=("Румен Радев",),
                     topic=kw.get("lt", ("economy", "budget")), places=kw.get("lp", ()))
        right = story("s2", "Парламентът прие окончателно новия държавен бюджет за годината",
                      "2026-08-31T06:30:00+00:00", people=("Румен Радев",),
                      topic=kw.get("rt", ("economy", "budget")), places=kw.get("rp", ()))
        return left, right

    def test_strict_is_the_default_and_an_unknown_mode_is_refused(self):
        left, right = self.pair()
        self.assertNotIn("mode", same_event_evidence(left, right))
        with self.assertRaises(ValueError):
            same_event_evidence(left, right, mode="lenient")

    def test_a_subcategory_mismatch_is_a_category_agreement_in_review_and_a_veto_in_strict(self):
        left, right = self.pair(lt=("judiciary", "vss"), rt=("judiciary", "high-profile-cases"))
        self.assertIsNone(same_event_evidence(left, right))
        got = same_event_evidence(left, right, mode="review")
        self.assertEqual(got["topic_agreement"], "category")
        self.assertEqual(got["relaxations"], ["topic:category"])
        self.assertEqual(got["mode"], "review")
        self.assertTrue(got["rule_version"])

    def test_a_cross_category_pair_passes_review_but_is_flagged(self):
        left, right = self.pair(lt=("government", None), rt=("judiciary", None))
        self.assertIsNone(same_event_evidence(left, right))
        got = same_event_evidence(left, right, mode="review")
        self.assertEqual(got["topic_agreement"], "none")
        self.assertIn("topic:none", got["relaxations"])

    def test_a_venue_and_a_scene_pass_review_but_two_local_councils_do_not(self):
        left, right = self.pair(lp=("София",), rp=("Петрохан",))
        self.assertIsNone(same_event_evidence(left, right))
        got = same_event_evidence(left, right, mode="review")
        self.assertTrue(got["place_conflict"])
        self.assertIn("places:disjoint", got["relaxations"])
        # ⚠️ THE HARD NEGATIVE SURVIVES: two local stories in two places.
        left, right = self.pair(lp=("Враца",), rp=("Монтана",),
                                lt=("local-news", None), rt=("local-news", None))
        self.assertIsNone(same_event_evidence(left, right, mode="review"))

    def test_evolving_digits_pass_review_but_two_different_years_do_not(self):
        first = story("s1", "Парламентът прие бюджет с дефицит 3 процента",
                      "2026-08-31T06:00:00+00:00", people=("Румен Радев", "Асен Василев"))
        second = story("s2", "Парламентът прие бюджет с дефицит 5 процента",
                       "2026-08-31T06:30:00+00:00", people=("Румен Радев", "Асен Василев"))
        self.assertIsNone(same_event_evidence(first, second))
        got = same_event_evidence(first, second, mode="review")
        self.assertTrue(got["number_disagreement"])
        self.assertIn("numbers:disjoint", got["relaxations"])
        y1 = story("s1", "Изборите през 2021 година промениха парламента",
                   "2026-08-31T06:00:00+00:00", people=("Румен Радев", "Асен Василев"))
        y2 = story("s2", "Изборите през 2023 година промениха парламента",
                   "2026-08-31T06:30:00+00:00", people=("Румен Радев", "Асен Василев"))
        self.assertIsNone(same_event_evidence(y1, y2, mode="review"))

    def test_the_lede_class_is_a_review_only_positive_and_is_named(self):
        left = story("s1", "Министърът отговори на критиките",
                     "2026-08-31T06:00:00+00:00", people=("Асен Василев",))
        right = story("s2", "Василев отговори на критиките за дефицита",
                      "2026-08-31T07:00:00+00:00", people=("Асен Василев",))
        left["lede_bg"] = "Финансовият министър Асен Василев отговори на критиките за дефицита пред депутатите."
        right["lede_bg"] = "Асен Василев отговори на критиките за дефицита, наречени от него неоснователни, пред депутатите."
        self.assertIsNone(same_event_evidence(left, right))
        got = same_event_evidence(left, right, mode="review")
        self.assertIsNotNone(got)
        self.assertEqual(got["relaxations"], ["lede"])
        self.assertGreaterEqual(got["lede_jaccard"], 0.35)
        # Without a lede on one side, review mode has no fourth class.
        del right["lede_bg"]
        self.assertIsNone(same_event_evidence(left, right, mode="review"))

    def test_the_horizon_is_not_relaxed(self):
        left, right = self.pair()
        right["last_published"] = "2026-09-04T06:30:00+00:00"
        self.assertIsNone(same_event_evidence(left, right, mode="review"))

    def all_pairs(self):
        """Every fixture pair this file constructs, so the invariants below
        are pinned over the whole suite rather than one pair."""
        pairs = [self.pair(), self.pair(lt=("judiciary", "vss"), rt=("judiciary", "high-profile-cases")),
                 self.pair(lt=("government", None), rt=("judiciary", None)),
                 self.pair(lp=("София",), rp=("Петрохан",)),
                 self.pair(lp=("Враца",), rp=("Монтана",), lt=("local-news", None), rt=("local-news", None))]
        for title_a, title_b in (("Парламентът прие бюджет с дефицит 3 процента", "Парламентът прие бюджет с дефицит 5 процента"),
                                 ("Изборите през 2021 година промениха парламента", "Изборите през 2023 година промениха парламента")):
            pairs.append((story("s1", title_a, "2026-08-31T06:00:00+00:00", people=("Румен Радев", "Асен Василев")),
                          story("s2", title_b, "2026-08-31T06:30:00+00:00", people=("Румен Радев", "Асен Василев"))))
        left, right = self.pair()
        right["last_published"] = "2026-09-04T06:30:00+00:00"
        pairs.append((left, right))
        return pairs

    def test_strict_is_unchanged_and_review_is_a_superset_over_every_fixture_pair(self):
        # ⚠️ THE MUTATION THIS CATCHES: any relaxation leaking into the
        # default mode, on any pair. Strict ≡ mode="strict"; review ⊇ strict;
        # where strict accepts, review names NO relaxation and agrees on the
        # shared evidence keys; every named relaxation is a known kind.
        shared = ("shared_title_tokens", "shared_entities", "shared_places",
                  "title_jaccard", "published_gap_hours", "topic")
        seen_strict_accepts = 0
        for left, right in self.all_pairs():
            strict = same_event_evidence(left, right)
            self.assertEqual(strict, same_event_evidence(left, right, mode="strict"))
            review = same_event_evidence(left, right, mode="review")
            if strict is not None:
                seen_strict_accepts += 1
                self.assertIsNotNone(review)
                self.assertEqual(review["relaxations"], [])
                self.assertEqual({k: review[k] for k in shared}, {k: strict[k] for k in shared})
            if review is not None:
                self.assertTrue(set(review["relaxations"]) <= set(RELAXATION_KINDS), review["relaxations"])
        self.assertGreater(seen_strict_accepts, 0)

    def test_a_pair_the_strict_rule_accepts_carries_no_relaxation(self):
        left, right = self.pair()
        self.assertIsNotNone(same_event_evidence(left, right))
        got = same_event_evidence(left, right, mode="review")
        self.assertEqual(got["relaxations"], [])
        self.assertEqual(got["topic_agreement"], "exact")


if __name__ == "__main__":
    unittest.main()
