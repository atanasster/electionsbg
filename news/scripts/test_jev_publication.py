#!/usr/bin/env python3
"""T4.4 Phase 5 — which axes are published, and what publishing attaches."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import jev_axes as ax  # noqa: E402
import jev_publication as jp  # noqa: E402
import jev_scales as js  # noqa: E402
import jev_sentiment as sm  # noqa: E402


def record(url="u1", name="ПП-ДБ", value=1.0, status="ok", **stale):
    """A record with EVERY stamp the store requires.

    ⚠️ The first fixture carried only `version`, so the gate's missing
    staleness checks were invisible: it published a record the store itself
    refuses and reported a clean attach.
    """
    return {
        "version": sm.RECORD_VERSION,
        "rubric_version": sm.RUBRIC_VERSION,
        "axes_version": ax.AXES_VERSION,
        "contract_version": js.SCALE_CONTRACT_VERSION,
        "url": url, "status": status, **stale,
        "axes": {}, "subjects": [
            {"name": name, "kind": "party", "subject_role": "secondary",
             "assessment_status": "assessed",
             "tone": {"value": value, "normalized": value / 2, "spread": 0.1,
                      "confidence_derived": 0.9, "levels": 5,
                      "both_directions": False}},
        ],
    }


def collected(rows):
    return {"parties": {"p_6": {"party_id": "p_6", "rows": rows}}}


def party_row(url="u1", surface="ПП-ДБ"):
    return {"url": url, "domain": "a.bg", "article_id": "x", "title": "t",
            "published": "2026-09-21T10:00:00+00:00", "story_id": None,
            "subject_name": surface, "tone": "neutral", "rationale": None,
            "evidence_spans": []}


class PublishedAxes(unittest.TestCase):
    def test_nothing_is_published_by_default(self):
        # ⚠️ Phase 0 is a SHADOW run: the sidecars are written, the eval reads
        # them, and no page changes. A default that published would make
        # measuring the pass and shipping it the same act.
        self.assertEqual(jp.published_axes({}), frozenset())
        self.assertEqual(jp.published_axes({jp.PUBLISH_ENV: ""}), frozenset())
        self.assertEqual(jp.published_axes({jp.PUBLISH_ENV: "  , "}), frozenset())

    def test_axes_are_flipped_one_at_a_time(self):
        # ⚠️ The preceding benchmark found Jev winning by +53 points on one
        # question and LOSING to a constant on another, in the same run. One
        # boolean would ship the second on the strength of the first.
        self.assertEqual(jp.published_axes({jp.PUBLISH_ENV: "subject_tone"}),
                         frozenset({"subject_tone"}))
        self.assertEqual(
            jp.published_axes({jp.PUBLISH_ENV: "leaning, russia_stance"}),
            frozenset({"leaning", "russia_stance"}))

    def test_an_unknown_axis_is_refused_not_ignored(self):
        # ⚠️ A typo would otherwise read as "publish nothing" and look
        # identical to the default — the one case where an operator believes
        # they have shipped and have not.
        for bad in ("subject-tone", "party_tone", "SUBJECT_TONE",
                    "subject_tone,typo"):
            with self.assertRaises(jp.JevPublicationError, msg=bad):
                jp.published_axes({jp.PUBLISH_ENV: bad})

    def test_every_scored_axis_is_publishable(self):
        self.assertIn(ax.SUBJECT_TONE.id, jp.PUBLISHABLE_AXES)
        for axis in ax.ARTICLE_AXES:
            self.assertIn(axis["id"], jp.PUBLISHABLE_AXES)

    def test_publishes_is_the_same_decision(self):
        env = {jp.PUBLISH_ENV: "subject_tone"}
        self.assertTrue(jp.publishes("subject_tone", env))
        self.assertFalse(jp.publishes("leaning", env))


class AttachForParties(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name)
        sm.sentiment_dir(self.data).mkdir(parents=True, exist_ok=True)

    def store(self, doc):
        path = sm.path_for(doc["url"], self.data)
        path.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")

    def test_it_attaches_nothing_while_the_axis_is_unpublished(self):
        self.store(record())
        rows = [party_row()]
        report = jp.attach_for_parties(collected(rows), self.data, env={})
        self.assertFalse(report["published"])
        self.assertEqual(report["attached"], 0)
        self.assertNotIn("sentiment", rows[0])

    def test_it_attaches_once_the_axis_is_published(self):
        self.store(record())
        rows = [party_row()]
        report = jp.attach_for_parties(collected(rows), self.data,
                                       env={jp.PUBLISH_ENV: "subject_tone"})
        self.assertTrue(report["published"])
        self.assertEqual(report["attached"], 1)
        self.assertAlmostEqual(rows[0]["sentiment"]["value"], 1.0)

    def test_a_failed_record_is_never_published(self):
        # ⚠️ A `failed` sidecar is a log of an attempt, not an answer.
        # Publishing from one would put an outage on a party page.
        self.store(record(status="failed"))
        rows = [party_row()]
        report = jp.attach_for_parties(collected(rows), self.data,
                                       env={jp.PUBLISH_ENV: "subject_tone"})
        self.assertEqual(report["records"], 0)
        self.assertEqual(report["attached"], 0)
        self.assertNotIn("sentiment", rows[0])

    def test_a_no_subjects_record_is_still_an_answer(self):
        doc = {**record(), "status": "no_subjects", "subjects": []}
        self.store(doc)
        report = jp.attach_for_parties(collected([party_row()]), self.data,
                                       env={jp.PUBLISH_ENV: "subject_tone"})
        self.assertEqual(report["records"], 1)
        self.assertEqual(report["attached"], 0)

    def test_it_reports_BOTH_what_was_offered_and_what_landed(self):
        # ⚠️ "0 attached" and "0 available" are different states — a join that
        # failed and a pass that has not run — and one count reads as the
        # happier of the two.
        self.store(record(url="u1"))
        rows = [party_row("u1"), party_row("u2"), party_row("u3")]
        report = jp.attach_for_parties(collected(rows), self.data,
                                       env={jp.PUBLISH_ENV: "subject_tone"})
        self.assertEqual((report["records"], report["rows"], report["attached"]),
                         (1, 3, 1))

    def test_an_unreadable_sidecar_is_skipped_not_fatal(self):
        (sm.sentiment_dir(self.data) / "broken.json").write_text(
            "{not json", encoding="utf-8")
        (sm.sentiment_dir(self.data) / "list.json").write_text(
            "[1,2]", encoding="utf-8")
        self.store(record())
        report = jp.attach_for_parties(collected([party_row()]), self.data,
                                       env={jp.PUBLISH_ENV: "subject_tone"})
        self.assertEqual(report["records"], 1)
        self.assertEqual(report["attached"], 1)

    def test_a_stale_record_is_refused_and_counted(self):
        # ⚠️ THE FILTER THE GATE ONCE RE-IMPLEMENTED AND GOT WRONG. A record
        # the store refuses must not publish, and „nothing to publish" must
        # not look like „everything is stale".
        live = jp.PUBLISH_ENV
        for field, value in (("version", sm.RECORD_VERSION + 1),
                             ("rubric_version", "jev-sentiment-v0"),
                             ("axes_version", 99),
                             ("contract_version", 99)):
            with tempfile.TemporaryDirectory() as tmp:
                data = Path(tmp)
                sm.sentiment_dir(data).mkdir(parents=True, exist_ok=True)
                doc = record(**{field: value})
                sm.path_for(doc["url"], data).write_text(
                    json.dumps(doc, ensure_ascii=False), encoding="utf-8")
                rows = [party_row()]
                report = jp.attach_for_parties(
                    collected(rows), data, env={live: "subject_tone"})
                self.assertEqual(report["records"], 0, field)
                self.assertEqual(report["stale"], 1, field)
                self.assertEqual(report["attached"], 0, field)
                self.assertNotIn("sentiment", rows[0], field)

    def test_it_attaches_across_every_party_not_only_the_first(self):
        # A single-party fixture cannot see a loop that stops early.
        self.store(record(url="u1", name="ПП-ДБ"))
        self.store(record(url="u2", name="ГЕРБ"))
        rows_a, rows_b = [party_row("u1", "ПП-ДБ")], [party_row("u2", "ГЕРБ")]
        two = {"parties": {"p_6": {"party_id": "p_6", "rows": rows_a},
                           "gerb": {"party_id": "gerb", "rows": rows_b}}}
        report = jp.attach_for_parties(two, self.data,
                                       env={jp.PUBLISH_ENV: "subject_tone"})
        self.assertEqual(report["attached"], 2)
        self.assertIn("sentiment", rows_a[0])
        self.assertIn("sentiment", rows_b[0])

    def test_no_sidecars_at_all_is_a_quiet_zero(self):
        report = jp.attach_for_parties(collected([party_row()]), self.data,
                                       env={jp.PUBLISH_ENV: "subject_tone"})
        self.assertEqual(report["records"], 0)
        self.assertEqual(report["attached"], 0)


if __name__ == "__main__":
    unittest.main()
