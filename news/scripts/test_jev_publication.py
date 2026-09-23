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



class _ArticleFixture:
    """A real stored record for one article — shared, and owning NO tests,
    so a class that uses it does not inherit (and re-run) another's."""

    def setUp(self):
        import test_jev_ask as tja  # noqa: PLC0415
        import jev_ask as ja  # noqa: PLC0415
        self.tja = tja
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name)
        self.article, self.analysis = tja.ARTICLE, tja.ANALYSIS
        sm.store(ja.assess_article(self.article, self.analysis,
                                   ask=tja.answering_ask()), self.data)

    def public(self, published, **kw):
        return jp.article_public(self.article, self.analysis, self.data,
                                 env={jp.PUBLISH_ENV: published}, **kw)


class ArticlePublic(_ArticleFixture, unittest.TestCase):
    """T4.4 Phase 4 — the block ONE article page carries.

    ⚠️ The record comes from the REAL pass (`assess_article` with a fake
    `ask`), because `article_public` checks the record's content key against
    the article — a hand-built record would either skip that check or fail it
    for a reason unrelated to the test.
    """

    def test_nothing_published_is_nothing_on_the_page(self):
        self.assertIsNone(self.public(""))

    def test_only_the_published_axes_ship(self):
        # ⚠️ Per axis: a block that shipped every stored axis would publish
        # the unreviewed ones the day the first one cleared.
        out = self.public("leaning")
        self.assertEqual(set(out["axes"]), {"leaning"})
        self.assertNotIn("subjects", out)
        out = self.public("subject_tone")
        self.assertEqual(out["axes"], {})
        self.assertTrue(out["subjects"])

    def test_an_axis_carries_its_distribution_and_applicability(self):
        leaning = self.public("leaning")["axes"]["leaning"]
        self.assertIn("applies", leaning)
        self.assertEqual(len(leaning["distribution"]), leaning["levels"])
        self.assertAlmostEqual(sum(leaning["distribution"]), 1.0, places=2)

    def test_an_incidental_subject_ships_WITHOUT_a_tone(self):
        # ⚠️ Not a neutral one: Jev was never asked. That is the whole fix for
        # a party quoted once being scored as the article's target.
        subjects = self.public("subject_tone")["subjects"]
        incidental = [s for s in subjects if s["subject_role"] == "incidental"]
        self.assertTrue(incidental, "the fixture must carry an incidental subject")
        for s in incidental:
            self.assertNotIn("tone", s)
        scored = [s for s in subjects if s["subject_role"] != "incidental"]
        self.assertTrue(all("tone" in s for s in scored))

    def test_a_human_review_withholds_the_block_and_says_so(self):
        self.assertEqual(self.public("leaning", human_reviewed=True),
                         {"withheld": "human_reviewed"})

    def test_a_human_review_with_nothing_published_is_still_nothing(self):
        self.assertIsNone(self.public("", human_reviewed=True))

    def test_a_record_for_DIFFERENT_words_is_refused(self):
        # ⚠️ `current_for`, not `answered`: an article re-extracted since the
        # ask has a version-current record that describes other text.
        moved = {**self.article, "content": self.article["content"] + " Добавено."}
        self.assertIsNone(jp.article_public(
            moved, self.analysis, self.data, env={jp.PUBLISH_ENV: "leaning"}))

    def test_no_record_at_all_is_nothing_never_a_neutral(self):
        empty = Path(self.tmp.name) / "empty"
        self.assertIsNone(jp.article_public(
            self.article, self.analysis, empty, env={jp.PUBLISH_ENV: "leaning"}))

    def test_the_scope_that_was_READ_ships_with_it(self):
        self.assertIn("kind", self.public("leaning")["text_scope"])


class PartyArchiveRelabel(unittest.TestCase):
    """Publishing `subject_tone` makes Jev the producer of the ARCHIVE.

    ⚠️ Measured before this existed, with the axis published: the ПП-ДБ page
    still read „pik.bg — негативен" and „actualno — позитивен", because
    publishing only attached a score beside each row while the counts read
    GLM's `tone`. These are those two shapes.
    """

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name)

    def store(self, doc):
        sm.store(doc, self.data)

    def publish(self, rows, glm_counts=None, categories=None):
        coll = collected(rows)
        party = coll["parties"]["p_6"]
        party["counts"] = glm_counts or {"favorable": 0, "neutral": 0,
                                         "unfavorable": 0, "mixed": 0}
        party["assessed"] = sum(party["counts"].values())
        coll["row_categories"] = categories or {}
        coll["topics"] = {}
        report = jp.attach_for_parties(coll, self.data,
                                       env={jp.PUBLISH_ENV: "subject_tone"})
        return coll, report

    def test_a_scored_row_takes_jevs_verdict_and_sheds_glms_argument(self):
        self.store(record("u1", value=0.0))           # Jev: neutral
        row = {**party_row("u1"), "tone": "favorable",
               "rationale": "позитивно", "evidence_spans": [{"quote": "q"}]}
        coll, _ = self.publish([row], {"favorable": 1, "neutral": 0,
                                       "unfavorable": 0, "mixed": 0})
        out = coll["parties"]["p_6"]
        self.assertEqual(out["rows"][0]["tone"], "neutral")
        self.assertEqual(out["rows"][0]["tone_producer"], "jev")
        self.assertIsNone(out["rows"][0]["rationale"])
        self.assertEqual(out["rows"][0]["evidence_spans"], [])
        # ⚠️ THE COUNTS FOLLOW: GLM's `favorable` is gone from the header.
        self.assertEqual(out["counts"]["favorable"], 0)
        self.assertEqual(out["counts"]["neutral"], 1)
        self.assertEqual(out["assessed"], 1)

    def test_an_incidental_party_leaves_the_distribution(self):
        # The Минчев shape: quoted once, never the article's target.
        doc = record("u1")
        doc["subjects"] = [{"name": "ПП-ДБ", "kind": "party",
                            "subject_role": "incidental"}]
        self.store(doc)
        coll, report = self.publish([{**party_row("u1"), "tone": "favorable"}],
                                    {"favorable": 1, "neutral": 0,
                                     "unfavorable": 0, "mixed": 0})
        row = coll["parties"]["p_6"]["rows"][0]
        self.assertIsNone(row["tone"])
        self.assertEqual(row["tone_withheld"], "incidental")
        self.assertEqual(coll["parties"]["p_6"]["assessed"], 0)
        self.assertEqual(coll["parties"]["p_6"]["counts"]["favorable"], 0)
        self.assertEqual(report["withheld"], {"incidental": 1})

    def test_a_party_absent_from_the_text_is_not_a_subject(self):
        # The pik.bg shape: zero mentions, so no subject row at all.
        doc = record("u1", name="Андрей Гюров")
        doc["subjects"][0]["kind"] = "person"
        self.store(doc)
        coll, _ = self.publish([{**party_row("u1"), "tone": "unfavorable"}])
        row = coll["parties"]["p_6"]["rows"][0]
        self.assertIsNone(row["tone"])
        self.assertEqual(row["tone_withheld"], "not_a_subject")

    def test_a_party_DROPPED_by_the_cap_is_never_called_absent(self):
        # ⚠️ Measured: all 8 ПП-ДБ rows first labelled „не е субект" were
        # dropped by the cap, in articles that name the party outright.
        doc = record("u1", name="ГЕРБ")
        doc["subjects_dropped"] = 3
        doc["subjects_dropped_names"] = ["ПП-ДБ", "БСП", "ДПС"]
        self.store(doc)
        coll, _ = self.publish([party_row("u1")])
        self.assertEqual(coll["parties"]["p_6"]["rows"][0]["tone_withheld"],
                         "not_scored")

    def test_an_older_record_that_dropped_subjects_cannot_claim_absence(self):
        # It counted what it dropped but did not name them: undecidable.
        doc = record("u1", name="ГЕРБ")
        doc["subjects_dropped"] = 2
        self.store(doc)
        coll, _ = self.publish([party_row("u1")])
        self.assertEqual(coll["parties"]["p_6"]["rows"][0]["tone_withheld"],
                         "not_scored")

    def test_an_unscored_article_carries_no_glm_tone_either(self):
        # ⚠️ One distribution over two producers means neither.
        coll, _ = self.publish([{**party_row("u9"), "tone": "unfavorable"}])
        row = coll["parties"]["p_6"]["rows"][0]
        self.assertIsNone(row["tone"])
        self.assertEqual(row["tone_withheld"], "not_scored")

    def test_a_strong_degree_counts_on_its_side_and_keeps_its_bucket(self):
        self.store(record("u1", value=-2.0))          # strongly unfavorable
        coll, _ = self.publish([party_row("u1")])
        row = coll["parties"]["p_6"]["rows"][0]
        self.assertEqual(row["tone"], "unfavorable")
        self.assertEqual(row["bucket"], "strongly_unfavorable")

    def test_both_directions_is_counted_as_mixed(self):
        doc = record("u1", value=0.0)
        doc["subjects"][0]["tone"]["both_directions"] = True
        self.store(doc)
        coll, _ = self.publish([party_row("u1")])
        self.assertEqual(coll["parties"]["p_6"]["rows"][0]["tone"], "mixed")

    def test_the_topic_distribution_is_recounted_from_the_rows(self):
        self.store(record("u1", value=-1.0))
        coll, _ = self.publish([{**party_row("u1"), "tone": "favorable"}],
                               categories={("u1", "p_6"): "politics"})
        self.assertEqual(coll["topics"]["politics"]["p_6"]["unfavorable"], 1)
        self.assertEqual(coll["topics"]["politics"]["p_6"]["favorable"], 0)

    def test_nothing_changes_while_the_axis_is_unpublished(self):
        self.store(record("u1", value=-2.0))
        coll = collected([{**party_row("u1"), "tone": "favorable"}])
        jp.attach_for_parties(coll, self.data, env={jp.PUBLISH_ENV: ""})
        row = coll["parties"]["p_6"]["rows"][0]
        self.assertEqual(row["tone"], "favorable")
        self.assertNotIn("tone_producer", row)


class ArchiveReviewFindings(unittest.TestCase):
    """The second review's findings on the Jev-produced archive."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name)

    def publish(self, rows, **extra):
        coll = collected(rows)
        coll.update(extra)
        report = jp.attach_for_parties(coll, self.data,
                                       env={jp.PUBLISH_ENV: "subject_tone"})
        return coll, report

    def test_a_failed_subject_call_never_claims_absence(self):
        # TEST-001: axes answered, subjects scored none, total says there
        # were some. Must read `not_scored`, never „не е субект".
        doc = record("u1")
        doc["subjects"] = []
        doc["subjects_total"] = 2
        doc["calls"] = {"subjects": {"status": "failed"}}
        self.assertEqual(jp.relabel_row(party_row("u1"), doc), "not_scored")

    def test_an_accepted_editorial_verdict_is_not_relabelled(self):
        # TEST-002 / FINDING-002 — the article page withholds Jev under the
        # same review; the archive must agree.
        sm.store(record("u1", value=-2.0), self.data)
        row = {**party_row("u1"), "tone": "favorable", "rationale": "човек"}
        coll, report = self.publish(
            [row], row_reviewed={("u1", "p_6"): True}, row_categories={})
        out = coll["parties"]["p_6"]["rows"][0]
        self.assertEqual(out["tone"], "favorable")
        self.assertEqual(out["tone_producer"], "editorial")
        self.assertEqual(out["rationale"], "човек")
        self.assertEqual(coll["parties"]["p_6"]["counts"]["favorable"], 1)
        self.assertEqual(report["editorial"], 1)

    def test_an_unknown_scale_is_not_scored_rather_than_guessed(self):
        # FINDING-012: a 7-anchor score must not be bucketed as a 5-anchor one.
        doc = record("u1")
        doc["subjects"][0]["tone"]["levels"] = 7
        sm.store(doc, self.data)
        coll, _ = self.publish([party_row("u1")])
        row = coll["parties"]["p_6"]["rows"][0]
        self.assertIsNone(row["tone"])
        self.assertEqual(row["tone_withheld"], "not_scored")

    def test_the_header_names_the_producer(self):
        # FINDING-014 — the counts are Jev's; GLM's rubric alone would say
        # otherwise.
        coll, _ = self.publish([party_row("u1")])
        party = coll["parties"]["p_6"]
        self.assertEqual(party["tone_producer"], "jev")
        self.assertEqual(party["tone_rubric_version"], sm.RUBRIC_VERSION)

    def test_a_jev_party_with_no_archive_row_is_counted(self):
        # FINDING-009 — the row set is still GLM's; the gap is a number.
        sm.store(record("u2", name="БСП"), self.data)
        _, report = self.publish([party_row("u1")])
        self.assertEqual(report["jev_subjects_without_row"], 1)

    def test_a_dropped_PERSON_with_the_same_surface_does_not_hide_the_party(self):
        # FINDING-013 — absence is matched on (kind, name).
        doc = record("u1", name="ГЕРБ")
        doc["subjects_dropped"] = 1
        doc["subjects_dropped_names"] = [{"kind": "person", "name": "ПП-ДБ"}]
        self.assertEqual(jp.relabel_row(party_row("u1"), doc), "not_a_subject")

    def test_a_bare_name_from_an_older_record_still_reads_as_dropped(self):
        doc = record("u1", name="ГЕРБ")
        doc["subjects_dropped"] = 1
        doc["subjects_dropped_names"] = ["ПП-ДБ"]
        self.assertEqual(jp.relabel_row(party_row("u1"), doc), "not_scored")


class ArticlePublicReviewFindings(_ArticleFixture, unittest.TestCase):
    """FINDING-003 / 011 / 017 on the article block."""

    def test_the_cap_ships_so_the_page_states_the_real_number(self):
        self.assertEqual(self.public("subject_tone")["subjects_max"],
                         sm.MAX_SUBJECTS)

    def test_a_list_of_models_becomes_one_string(self):
        doc = sm.cached(self.article["url"], self.data)
        doc["model"] = ["a/one", "b/two"]
        sm.store(doc, self.data)
        self.assertEqual(self.public("leaning")["model"], "a/one, b/two")

    def test_an_explicit_axis_set_wins_over_the_environment(self):
        out = jp.article_public(self.article, self.analysis, self.data,
                                env={jp.PUBLISH_ENV: ""},
                                axes=frozenset({"leaning"}))
        self.assertEqual(set(out["axes"]), {"leaning"})

if __name__ == "__main__":
    unittest.main()
