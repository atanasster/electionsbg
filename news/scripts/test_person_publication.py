#!/usr/bin/env python3
"""The person-surface switches (news-person-sentiment-v1 §8)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import person_publication as pp  # noqa: E402


class Flags(unittest.TestCase):
    def test_off_by_default(self):
        self.assertEqual(pp.published({}), frozenset())

    def test_each_switch_on_its_own(self):
        self.assertEqual(pp.published({"NEWS_PERSON_RAIL": "1"}), {"rail"})
        self.assertEqual(pp.published({"NEWS_PERSON_AGGREGATES": " TRUE "}),
                         {"aggregates"})

    def test_explicit_off_values(self):
        for v in ("0", "off", "false", ""):
            self.assertEqual(pp.published({"NEWS_PERSON_RAIL": v}), frozenset())

    def test_an_unreadable_value_is_refused(self):
        for v in ("yes", "enabled", "2"):
            with self.assertRaises(pp.PersonPublicationError):
                pp.published({"NEWS_PERSON_RAIL": v})

    def test_the_grid_needs_the_pages(self):
        with self.assertRaises(pp.PersonPublicationError):
            pp.published({"NEWS_PERSON_MATRIX": "1"})
        self.assertEqual(pp.published({"NEWS_PERSON_MATRIX": "1",
                                       "NEWS_PERSON_AGGREGATES": "1"}),
                         {"matrix", "aggregates"})


if __name__ == "__main__":
    unittest.main()
