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



class Readiness(unittest.TestCase):
    def audit(self, doc):
        import json, tempfile  # noqa: E401, PLC0415
        from pathlib import Path  # noqa: PLC0415
        path = Path(tempfile.mkdtemp()) / "p.json"
        if doc is not None:
            path.write_text(json.dumps(doc), encoding="utf-8")
        return path

    def test_the_rail_without_its_link_audit_is_reported(self):
        alerts = pp.readiness_alerts(frozenset({"rail"}), self.audit(None))
        self.assertEqual([a["alert"] for a in alerts],
                         ["person_rail_without_link_audit"])
        low = self.audit({"pairs": 100, "correct": 95})
        self.assertTrue(pp.readiness_alerts(frozenset({"rail"}), low))
        few = self.audit({"pairs": 40, "correct": 40})
        self.assertTrue(pp.readiness_alerts(frozenset({"rail"}), few))

    def test_aggregates_on_without_the_gate_are_reported(self):
        alerts = pp.readiness_alerts(frozenset({"aggregates"}), self.audit(None),
                                     gate={"passed_without_agreement": False})
        self.assertEqual([a["alert"] for a in alerts],
                         ["person_aggregates_without_gate"])
        self.assertEqual(pp.readiness_alerts(
            frozenset({"aggregates"}), self.audit(None),
            gate={"passed_without_agreement": True}), [])

    def test_a_passing_audit_or_an_off_rail_is_quiet(self):
        ok = self.audit({"pairs": 120, "correct": 119})
        self.assertEqual(pp.readiness_alerts(frozenset({"rail"}), ok), [])
        self.assertEqual(pp.readiness_alerts(frozenset(), self.audit(None)), [])

if __name__ == "__main__":
    unittest.main()
