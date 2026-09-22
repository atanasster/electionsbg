#!/usr/bin/env python3
"""Plan T2.1 — candidate retrieval is a UNION of channels, not a title
ranking with entity evidence capped beneath it. Every test here names the
ceiling it exists to remove."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import analyze_articles as aa  # noqa: E402


def entry(title, *, people=(), places=(), first="2026-09-20T08:00:00+00:00", last=None):
    return {
        "title_bg": title, "title_en": "", "member_count": 1,
        "first_published": first, "last_published": last or first, "topics": [],
        "entities": {"people": list(people), "parties": [], "institutions": [],
                     "companies": [], "places": list(places)},
    }


def article(title, content="", published="2026-09-20T10:00:00+00:00"):
    return {"title": title, "description": "", "keywords": "", "content": content,
            "published": published}


class UnionRetrieval(unittest.TestCase):
    def setUp(self):
        aa._reset_case_terms_cache()

    def test_an_entity_only_story_gets_a_slot_beside_six_headline_near_duplicates(self):
        # ⚠️ THE CEILING THIS REMOVES (§15.2): six stories sharing three
        # headline tokens each outscore a story the article names only by
        # its PEOPLE, so the correct host never reaches the six slots.
        index = {"stories": {
            **{f"dup{i}": entry(f"Министърът представи бюджета на пресконференция {i}")
               for i in range(6)},
            "host": entry("Скандал в министерството", people=["Асен Василев", "Румен Радев"]),
        }}
        art = article("Министърът представи бюджета на пресконференция днес",
                      "Асен Василев и Румен Радев коментираха бюджета.")
        ids = [c["story_id"] for c in aa.candidate_stories(index, art)]
        self.assertIn("host", ids)
        self.assertEqual(len(ids), 6)
        host = next(c for c in aa.candidate_stories(index, art) if c["story_id"] == "host")
        self.assertIn("entities", host["channels"])
        self.assertNotIn("title", host["channels"])
        self.assertEqual(host["entity_hits"], ["Асен Василев", "Румен Радев"])

    def test_the_composite_floor_still_applies(self):
        # Date proximity alone never surfaces a candidate — unchanged.
        index = {"stories": {"near": entry("Нещо съвсем друго")}}
        self.assertEqual(aa.candidate_stories(index, article("Без общи думи")), [])

    def test_the_case_channel_sees_an_affair_the_headline_does_not_share(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Path(tmp) / "news" / "config"
            cfg.mkdir(parents=True)
            bi = {"bg": "б", "en": "b"}
            cfg.joinpath("cases.json").write_text(json.dumps({"version": 1, "cases": [{
                "slug": "petrohan", "name": bi, "opened_on": "2026-02-13", "rule_version": 1,
                "reviewer": "t", "reviewed_on": "2026-09-22", "description": bi,
                "sources": [{"claim": bi, "url": "https://x/1", "domain": "x", "published": "2026-09-20"}],
                "contested": [], "namesakes": [], "auto_attach": True, "ambiguous_match": "review",
                "overrides": {"include": [], "exclude": []}, "history": [],
                "rule": {"basis": bi, "required_terms": ["петрохан"], "context_terms": ["прокуратур"],
                         "excluded_terms": []}}]}, ensure_ascii=False), encoding="utf-8")
            old_root = aa.REPO_ROOT
            aa.REPO_ROOT = tmp
            aa._reset_case_terms_cache()
            try:
                index = {"stories": {
                    **{f"dup{i}": entry(f"Адвокатите поискаха разследване на изтичането {i}") for i in range(6)},
                    "affair": entry("Делото Петрохан отива в съда"),
                }}
                art = article("Адвокатите поискаха разследване на изтичането на експертизата",
                              "Експертизата по случая Петрохан изтече в медиите, казват адвокатите.")
                cands = aa.candidate_stories(index, art)
                affair = next(c for c in cands if c["story_id"] == "affair")
                self.assertEqual(affair["case_hits"], ["petrohan"])
                self.assertIn("case", affair["channels"])
            finally:
                aa.REPO_ROOT = old_root
                aa._reset_case_terms_cache()

    def test_the_place_time_channel_needs_both_a_place_and_the_window(self):
        index = {"stories": {
            "same_day": entry("Наводнение", places=["Царево"]),
            "old": entry("Наводнение", places=["Царево"], first="2026-08-01T00:00:00+00:00"),
        }}
        art = article("Водата отнесе моста", "Царево остана без ток след пороя.")
        cands = {c["story_id"]: c for c in aa.candidate_stories(index, art)}
        self.assertIn("place_time", cands["same_day"]["channels"])
        self.assertNotIn("old", cands)   # a place 50 days away is not the same event

    def test_the_lede_channel_reads_the_body_not_only_the_headline(self):
        index = {"stories": {"s": entry("Прокуратурата обвини бившия министър за споразумението")}}
        art = article("Реакции", "Прокуратурата обвини бившия министър за споразумението с фондацията. " * 3)
        cands = aa.candidate_stories(index, art)
        self.assertEqual([c["story_id"] for c in cands], ["s"])
        self.assertIn("lede", cands[0]["channels"])
        self.assertNotIn("title", cands[0]["channels"])
        self.assertGreaterEqual(len(cands[0]["shared_lede_tokens"]), 3)

    def test_retrieval_is_deterministic_and_presents_composite_order(self):
        index = {"stories": {f"s{i}": entry(f"Общ заглавен ред номер {i}", people=[f"Лице {i}"]) for i in range(20)}}
        art = article("Общ заглавен ред", "Лице 3 и Лице 17 говориха.")
        first = aa.candidate_stories(index, art)
        second = aa.candidate_stories(index, art)
        self.assertEqual([c["story_id"] for c in first], [c["story_id"] for c in second])
        scores = [c["score"] for c in first]
        self.assertEqual(scores, sorted(scores, reverse=True))
        self.assertTrue({"s3", "s17"} <= {c["story_id"] for c in first})

    def test_a_missing_registry_disables_the_case_channel_and_nothing_else(self):
        old_root = aa.REPO_ROOT
        with tempfile.TemporaryDirectory() as tmp:
            aa.REPO_ROOT = tmp
            aa._reset_case_terms_cache()
            try:
                index = {"stories": {"s": entry("Делото Петрохан отива в съда")}}
                cands = aa.candidate_stories(index, article("Делото Петрохан отива в съда"))
                self.assertEqual(cands[0]["case_hits"], [])
                self.assertIn("title", cands[0]["channels"])
            finally:
                aa.REPO_ROOT = old_root
                aa._reset_case_terms_cache()

    def test_the_case_channel_honours_the_registry_stem_contract(self):
        # ⚠️ THE MUTATION THIS CATCHES: matching registry terms with the
        # whole-word `entity_in_text`. „помилв" is a STEM — the registry reaches
        # „помилването"; whole-word matching reached 0 of its 42 articles.
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Path(tmp) / "news" / "config"
            cfg.mkdir(parents=True)
            bi = {"bg": "б", "en": "b"}
            cfg.joinpath("cases.json").write_text(json.dumps({"version": 1, "cases": [{
                "slug": "narco-pardon", "name": bi, "opened_on": "2026-09-11", "rule_version": 1,
                "reviewer": "t", "reviewed_on": "2026-09-22", "description": bi,
                "sources": [{"claim": bi, "url": "https://x/1", "domain": "x", "published": "2026-09-20"}],
                "contested": [], "namesakes": [], "auto_attach": True, "ambiguous_match": "review",
                "overrides": {"include": [], "exclude": []}, "history": [],
                "rule": {"basis": bi, "required_terms": ["помилв"], "context_terms": ["ескобар"],
                         "excluded_terms": []}}]}, ensure_ascii=False), encoding="utf-8")
            old_root = aa.REPO_ROOT
            aa.REPO_ROOT = tmp
            aa._reset_case_terms_cache()
            try:
                index = {"stories": {"s": entry("Помилването на наркотрафиканта раздели кандидатите")}}
                art = article("Реакции в кампанията", "Президентът помилва осъдения през 2022 г.")
                cands = aa.candidate_stories(index, art)
                self.assertEqual([c["story_id"] for c in cands], ["s"])
                self.assertEqual(cands[0]["case_hits"], ["narco-pardon"])
                self.assertIn("case", cands[0]["channels"])
            finally:
                aa.REPO_ROOT = old_root
                aa._reset_case_terms_cache()

    def test_the_slots_do_not_depend_on_index_insertion_order(self):
        stories = {f"s{i}": entry(f"Общ заглавен ред номер {i}", people=[f"Лице {i}"]) for i in range(20)}
        art = article("Общ заглавен ред", "Лице 3 и Лице 17 говориха.")
        forward = [c["story_id"] for c in aa.candidate_stories({"stories": stories}, art)]
        reverse = [c["story_id"] for c in aa.candidate_stories(
            {"stories": dict(reversed(list(stories.items())))}, art)]
        self.assertEqual(forward, reverse)


if __name__ == "__main__":
    unittest.main()
