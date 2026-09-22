#!/usr/bin/env python3
"""The one Cyrillic word-boundary rule, and the one sidecar key."""
import re
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import analyze_articles as aa  # noqa: E402
import jev_text as jt  # noqa: E402
import person_tones as pt  # noqa: E402


class Boundary(unittest.TestCase):
    def test_a_cyrillic_surface_matches_at_all(self):
        # A boundary that stops matching Bulgarian reports zero mentions
        # silently, which in the sentiment pass means a subject derived
        # `incidental` and given no tone at all.
        self.assertTrue(jt.contains_mention("ГЕРБ", "ГЕРБ каза"))
        self.assertTrue(jt.contains_mention("Желязков", "каза Желязков."))

    def test_the_class_differs_from_python_s_own_word_boundary_where_it_should(self):
        # ⚠️ NOT because `\b` is broken here — Python's is Unicode-aware and
        # misses „иванов" correctly. The class is inherited from
        # `analyze_articles.entity_in_text` so the two layers agree, and it
        # excludes `_`, which `\w` counts as a word character.
        self.assertIsNone(re.search(r"\bиван\b", "иванов"))
        self.assertIsNotNone(re.search(r"\bиван\b", "иван каза"))
        self.assertTrue(jt.contains_mention("иван", "иван_ов", allow_tail=False))
        self.assertIsNone(re.search(r"\bиван\b", "иван_ов"))

    def test_it_does_not_match_inside_a_longer_word(self):
        self.assertFalse(jt.contains_mention("Иван", "Иванов", allow_tail=False))
        self.assertFalse(jt.contains_mention("ЕС", "ЕСО"))

    def test_the_two_boundary_implementations_agree(self):
        # `analyze_articles.entity_in_text` carries the same rule for the
        # story-clustering layer. They were copies; this is what keeps them
        # from drifting apart.
        cases = [("ГЕРБ", "ГЕРБ каза"), ("ГЕРБ", "ГЕРБове"), ("Иван", "Иван Иванов"),
                 ("Иван", "Иванов"), ("ДАНС", "танц и ДАНС"), ("ЕС", "в ЕС и ЕСО"),
                 ("Мъск", "Илон Мъск"), ("Лига", "Лига")]
        for surface, haystack in cases:
            self.assertEqual(jt.contains_mention(surface, haystack, allow_tail=False),
                             aa.entity_in_text(surface, haystack),
                             f"{surface!r} in {haystack!r}")

    def test_the_class_covers_the_letters_the_older_range_missed(self):
        # `А-Яа-яЁё` omits `Ѝ`/`ѝ` (U+040D/U+045D), a Bulgarian letter in
        # everyday use — so „ГЕРБѝ" counted as a mention of „ГЕРБ".
        self.assertFalse(jt.contains_mention("ГЕРБ", "ГЕРБѝ"))
        self.assertIn("Ѐ-ӿ", jt.WORD_CHAR)

    def test_a_metacharacter_in_a_surface_is_escaped(self):
        self.assertTrue(jt.contains_mention("А.Б.", "А.Б. каза"))
        self.assertFalse(jt.contains_mention("А.Б.", "АХБЗ каза"))

    def test_the_tail_is_bounded_and_opt_out(self):
        self.assertTrue(jt.contains_mention("Възраждане", "Възраждането"))
        self.assertFalse(jt.contains_mention("Възраждане", "Възражданетостотина"))
        self.assertFalse(jt.contains_mention("Възраждане", "Възраждането",
                                             allow_tail=False))

    def test_a_short_surface_takes_no_tail_even_when_allowed(self):
        # Otherwise „меч" swallows „мечта".
        self.assertFalse(jt.contains_mention("меч", "мечта"))
        self.assertEqual(len("меч") < jt.MIN_TAIL_SURFACE, True)

    def test_spans_are_returned_so_overlaps_can_be_folded(self):
        spans = jt.mention_matches("иван", "Иван и Иван")
        self.assertEqual(len(spans), 2)
        for start, end in spans:
            self.assertEqual("иван и иван"[start:end], "иван")

    def test_an_empty_surface_or_haystack_matches_nothing(self):
        self.assertEqual(jt.mention_matches("", "нещо"), [])
        self.assertEqual(jt.mention_matches("ГЕРБ", ""), [])


class ArticleKey(unittest.TestCase):
    def test_it_is_identical_to_the_person_tones_key(self):
        # The two sidecar trees are read by the same tooling; a different
        # truncation would make one unfindable from the other.
        for url in ("https://a.bg/1", "https://b.bg/x?y=1", ""):
            self.assertEqual(jt.article_key(url), pt.article_key(url), url)

    def test_it_is_sixteen_hex_characters(self):
        key = jt.article_key("https://a.bg/1")
        self.assertEqual(len(key), 16)
        self.assertTrue(all(c in "0123456789abcdef" for c in key))


if __name__ == "__main__":
    unittest.main()
