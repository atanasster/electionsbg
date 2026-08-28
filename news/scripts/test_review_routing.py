#!/usr/bin/env python3
"""Tests for review_routing.py — what gets a second look, and what does not.

⚠️⚠️ THE MEASUREMENT THAT SHAPES EVERY RULE HERE. Over the 365 analyses on
disk the model is MOST confident where it asserts nothing and LEAST where it
takes a position:

    leaning        not_applicable  n=329  median 0.80
                   neutral         n= 31  median 0.65
                   progressive     n=  4  median 0.60
    russia_stance  not_applicable  n=344  median 0.90
                   anti_russia     n= 12  median 0.60

So a bare confidence threshold routes exactly backwards — „everything below
0.7" reviews almost every real judgment and none of the 329 not_applicables,
spending the whole budget on the safest calls in the corpus.

Run:  python3 news/scripts/test_review_routing.py
"""

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from review_routing import (  # noqa: E402
    ALWAYS_REVIEW, FLOOR_NEUTRAL, FLOOR_POSITIONED, NEUTRAL_LABELS,
    ROUTED_FIELDS, field_review, record_review)


class TheFloorsPointTheRightWay(unittest.TestCase):
    def test_the_SAFE_labels_have_the_LOWER_floor(self):
        # ⚠️ The whole rule in one assertion. Arranged the other way round —
        # a single floor, or a higher bar for the safe labels — the queue
        # fills with 329 not_applicables and the real judgments never
        # surface.
        self.assertLess(FLOOR_NEUTRAL, FLOOR_POSITIONED)

    def test_a_confident_not_applicable_is_NOT_reviewed(self):
        # Median 0.80 in the corpus, and it asserts nothing about the text.
        self.assertIsNone(field_review("not_applicable", 0.8))
        self.assertIsNone(field_review("not_applicable", 0.5))

    def test_the_positioned_floor_is_where_it_says_it_is(self):
        # ⚠️ Testing only 0.6 (below) and 0.9 (above) lets the floor DRIFT:
        # 0.75 → 0.61 keeps all 19 tests green while the queue silently
        # shrinks from 16 records to 11. The floor is pinned from both sides.
        # ⚠️⚠️ A LITERAL, not FLOOR_POSITIONED ± 0.01. Testing relative to
        # the constant is self-referential: 0.75 → 0.61 keeps every such
        # assertion green while the queue silently shrinks from 16 records
        # to 11. The value is the decision and has to be pinned as one.
        self.assertEqual(FLOOR_POSITIONED, 0.75)
        self.assertIsNotNone(field_review("anti_russia", 0.74))
        self.assertIsNone(field_review("anti_russia", 0.75))
        self.assertIsNone(field_review("anti_russia", 0.76))
        # The corpus median for a real position is 0.60 — below the floor by
        # design, which is what makes the queue non-empty at all.
        self.assertIsNotNone(field_review("anti_russia", 0.60))

    def test_the_neutral_floor_is_where_it_says_it_is(self):
        self.assertEqual(FLOOR_NEUTRAL, 0.40)
        self.assertIsNotNone(field_review("not_applicable", 0.39))
        self.assertIsNone(field_review("not_applicable", 0.40))
        # The corpus median for not_applicable is 0.80–0.90 — far above the
        # floor, which is why 329 of them stay out of the queue.
        self.assertIsNone(field_review("not_applicable", 0.80))

    def test_a_hedged_POSITION_is_reviewed(self):
        # Median 0.60 in the corpus — the model taking a real position and
        # saying it is unsure.
        self.assertIsNotNone(field_review("anti_russia", 0.6))
        self.assertIsNotNone(field_review("progressive", 0.6))

    def test_a_confident_position_is_left_alone(self):
        self.assertIsNone(field_review("anti_russia", 0.9))

    def test_likely_human_is_a_SAFE_label(self):
        # ⚠️ It is the safe default of the AI axis — „this reads like
        # ordinary journalism" — and carries a median confidence of 0.6
        # because the rubric tells the model to hedge. Treated as a
        # positioned claim it put 355 of 365 records into the queue, 98% of
        # the corpus, which is the same as having no queue.
        self.assertIn("likely_human", NEUTRAL_LABELS)
        self.assertIsNone(field_review("likely_human", 0.6))

    def test_an_UNSURE_safe_label_still_surfaces(self):
        # The floor is low, not absent: a not_applicable at 0.2 is the model
        # saying it could not tell.
        self.assertIsNotNone(field_review("not_applicable", 0.2))


class AlwaysReviewed(unittest.TestCase):
    def test_every_strong_label_is_reviewed_at_ANY_confidence(self):
        # ⚠️ „The model was very sure" is not evidence — the corpus shows
        # confidence tracks how SAFE a label is, not how right. A strong_*
        # label is the strongest thing this site says about a text.
        for label in ("strong_conservative", "strong_progressive",
                      "strong_pro_russia", "strong_anti_russia"):
            for conf in (0.5, 0.9, 1.0):
                with self.subTest(label=label, confidence=conf):
                    self.assertIsNotNone(field_review(label, conf))

    def test_likely_ai_is_reviewed_at_ANY_confidence(self):
        # It is an accusation about a named outlet, and the rubric itself
        # calls the assessment „probabilistic, hedged, never proof".
        self.assertIsNotNone(field_review("likely_ai", 1.0))

    def test_the_always_list_is_DERIVED_from_the_analyzer_vocabulary(self):
        # ⚠️ `len(strong) == 4` is satisfied by a hard-coded list, so a fifth
        # `strong_*` label added to the analyzer would ride the 0.75 floor
        # silently — the strongest claim the site can make about a text,
        # quietly stopping being reviewed.
        import analyze_articles as aa
        expected = {x for x in (set(aa.LEANING_LABELS) | set(aa.RUSSIA_LABELS))
                    if x.startswith("strong_")}
        strong = {x for x in ALWAYS_REVIEW if x.startswith("strong_")}
        self.assertEqual(strong, expected)
        self.assertEqual(ALWAYS_REVIEW - strong, {"likely_ai"})

    def test_the_import_fallback_AGREES_with_the_derived_set(self):
        # analyze_articles imports this module, so the derivation can run
        # before its constants exist. A fallback that could DISAGREE would be
        # worse than no fallback.
        import analyze_articles as aa
        import review_routing as rr
        derived = {x for x in (set(aa.LEANING_LABELS) | set(aa.RUSSIA_LABELS))
                   if x.startswith("strong_")}
        self.assertEqual(rr._strong_labels(), derived)

    def test_no_SAFE_label_leaked_into_the_always_list(self):
        self.assertEqual(ALWAYS_REVIEW & NEUTRAL_LABELS, set())


class PoliticalNotApplicable(unittest.TestCase):
    """⚠️ The commonest rubric error in this corpus, and the one that
    prompted this rule: 66% of the 82 political articles carry
    `not_applicable` on leaning where the rubric asks for `neutral`."""

    def rec(self, category="judiciary", label="not_applicable",
            verdict="ok", relevant=True):
        return {
            "quality": {"verdict": verdict},
            "site_relevant": relevant,
            "topics": [{"category": category, "primary": True}],
            "leaning": {"label": label, "confidence": 0.85},
            "russia_stance": {"label": "not_applicable", "confidence": 0.9},
            "ai_generated": {"verdict": "likely_human", "confidence": 0.6},
        }

    def test_a_political_not_applicable_is_flagged(self):
        got = record_review(self.rec())
        self.assertIn("leaning", got)
        self.assertIn("judiciary", got["leaning"])

    def test_it_is_flagged_however_CONFIDENT_the_model_was(self):
        # ⚠️ Independent of the confidence floors: the label is wrong for the
        # topic, and the model was sure — median 0.85 across the corpus.
        r = self.rec()
        r["leaning"]["confidence"] = 1.0
        self.assertIn("leaning", record_review(r))

    def test_a_political_NEUTRAL_is_not_flagged(self):
        # This is the answer the rubric asks for.
        self.assertNotIn("leaning", record_review(self.rec(label="neutral")))

    def test_a_NON_political_not_applicable_is_not_flagged(self):
        # A weather report correctly takes no position.
        self.assertNotIn("leaning",
                         record_review(self.rec(category="not-site-relevant")))
        self.assertNotIn("leaning", record_review(self.rec(category="sports")))

    def test_a_NON_OK_record_is_not_flagged(self):
        # ⚠️ A paywall shell or a listing page is correctly not_applicable —
        # the rubric requires the full record shape with not_applicable on
        # both axes. Flagging those would put 127 junk records in the queue.
        for verdict in ("paywall_shell", "too_short", "non_article"):
            with self.subTest(verdict=verdict):
                self.assertNotIn(
                    "leaning", record_review(self.rec(verdict=verdict)))

    def test_site_relevant_false_is_not_flagged(self):
        self.assertNotIn("leaning",
                         record_review(self.rec(relevant=False)))

    def test_a_LOW_CONFIDENCE_reason_is_not_overwritten(self):
        # Both reasons can apply; the confidence one is more specific about
        # what the model itself said, so it wins.
        r = self.rec(label="progressive")
        r["leaning"]["confidence"] = 0.5
        self.assertIn("below", record_review(r)["leaning"])

    def test_a_malformed_topic_list_does_not_raise(self):
        r = self.rec()
        r["topics"] = ["judiciary"]        # strings, not objects
        self.assertNotIn("leaning", record_review(r))
        r["topics"] = None
        self.assertNotIn("leaning", record_review(r))


class AlteredNamesSurface(unittest.TestCase):
    """⚠️ The validator refuses this at SAVE time now — but a prompt and a
    validator are not retroactive. Three records on disk carry „Антон Славев"
    and „Кая Каллас", and flagging them is what makes those actionable."""

    def rec(self, people, body):
        return {
            "quality": {"verdict": "ok"},
            "site_relevant": True,
            "topics": [{"category": "society", "primary": True}],
            "leaning": {"label": "not_applicable", "confidence": 0.8},
            "russia_stance": {"label": "not_applicable", "confidence": 0.9},
            "ai_generated": {"verdict": "likely_human", "confidence": 0.6},
            "entities": {"people": people, "parties": [], "institutions": [],
                         "companies": [], "places": []},
            "_article": {"title": "", "description": "", "content": body},
        }

    def test_an_altered_name_is_flagged(self):
        got = record_review(self.rec(
            ["Антон Славев"], "Антон Славчев подаде оставка. " * 12))
        self.assertIn("entities", got)
        self.assertIn("Славчев", got["entities"])

    def test_a_correct_name_is_not_flagged(self):
        got = record_review(self.rec(
            ["Антон Славчев"], "Антон Славчев подаде оставка. " * 12))
        self.assertNotIn("entities", got)

    def test_without_the_article_the_check_is_SKIPPED_not_wrong(self):
        # ⚠️ A record whose corpus file is gone cannot be checked. Silence is
        # right; inventing a verdict from no text is not.
        r = self.rec(["Антон Славев"], "")
        r.pop("_article")
        self.assertNotIn("entities", record_review(r))


class MalformedInput(unittest.TestCase):
    def test_a_bool_is_not_a_confidence(self):
        # ⚠️ `bool` IS an `int` in Python, so `True` reads as 1.0 and clears
        # every floor. The project's own `is_num` excludes it for this reason.
        self.assertIsNotNone(field_review("progressive", True))
        self.assertIsNotNone(field_review("not_applicable", True))

    def test_a_non_dict_block_is_flagged_not_raised(self):
        # ⚠️ „leaning": "progressive" — a string where an object belongs.
        # Calling `.get` on it raised out of the queue reader's loop, killing
        # all 365 records and, through run_nightly.sh's exit grep, the whole
        # night's run. One malformed record must cost one record.
        got = record_review({"leaning": "progressive",
                             "russia_stance": {"label": "not_applicable",
                                               "confidence": 0.9},
                             "ai_generated": {"verdict": "likely_human",
                                              "confidence": 0.6}})
        self.assertIn("leaning", got)
        self.assertIn("not an object", got["leaning"])
        self.assertEqual(list(got), ["leaning"])


    def test_a_missing_label_is_reviewed(self):
        # ⚠️ A missing label is not a confident one. Treating it as „nothing
        # to review" lets the one shape nobody validated through untouched.
        self.assertIsNotNone(field_review(None, 0.9))

    def test_a_missing_confidence_is_reviewed(self):
        self.assertIsNotNone(field_review("progressive", None))
        self.assertIsNotNone(field_review("progressive", "high"))

    def test_a_missing_confidence_on_a_SAFE_label_is_still_reviewed(self):
        self.assertIsNotNone(field_review("not_applicable", None))


class PerRecord(unittest.TestCase):
    def rec(self, **over):
        base = {
            "leaning": {"label": "not_applicable", "confidence": 0.8},
            "russia_stance": {"label": "not_applicable", "confidence": 0.9},
            "ai_generated": {"verdict": "likely_human", "confidence": 0.6},
        }
        base.update(over)
        return base

    def test_a_clean_record_needs_nothing(self):
        self.assertEqual(record_review(self.rec()), {})

    def test_the_result_is_PER_FIELD(self):
        # ⚠️ „Its topics are fine and its Russia stance is not" is the useful
        # output. A single boolean sends the whole record back and loses the
        # part that was right — which is the point of measuring per field.
        got = record_review(self.rec(
            russia_stance={"label": "pro_russia", "confidence": 0.6}))
        self.assertEqual(list(got), ["russia_stance"])

    def test_each_field_carries_a_REASON_not_a_flag(self):
        # „The model was unsure" and „this is the strongest claim we make"
        # are different problems and a reviewer triages them differently.
        unsure = record_review(self.rec(
            leaning={"label": "progressive", "confidence": 0.5}))["leaning"]
        strong = record_review(self.rec(
            leaning={"label": "strong_progressive",
                     "confidence": 0.99}))["leaning"]
        self.assertIn("below", unsure)
        self.assertIn("strongest claim", strong)
        self.assertNotEqual(unsure, strong)

    def test_the_AI_verdict_is_read_from_its_own_KEY(self):
        # ⚠️ `ai_generated` carries `verdict`, the other two carry `label`.
        #
        # ⚠️⚠️ Asserting the mapping and „is the field flagged" both pass
        # under the very mutation this test names: reading `label` everywhere
        # makes the verdict invisible, the field reports „no label", and it
        # is STILL flagged — for the wrong reason. The discriminating
        # assertions are that a SAFE verdict is not flagged, and that a
        # flagged one names the verdict rather than its absence.
        self.assertEqual(dict(ROUTED_FIELDS)["ai_generated"], "verdict")
        safe = record_review(self.rec(
            ai_generated={"verdict": "likely_human", "confidence": 0.6}))
        self.assertNotIn("ai_generated", safe,
                         "a safe verdict was flagged — is `verdict` still "
                         "being read from its own key?")
        flagged = record_review(self.rec(
            ai_generated={"verdict": "likely_ai", "confidence": 0.9}))
        self.assertIn("likely_ai", flagged["ai_generated"])

    def test_a_missing_block_is_reviewed_not_skipped(self):
        got = record_review({"leaning": None, "russia_stance": {},
                             "ai_generated": {}})
        self.assertEqual(sorted(got), ["ai_generated", "leaning",
                                       "russia_stance"])

    def test_the_corpus_queue_is_a_MINORITY_of_the_corpus(self):
        # ⚠️ A queue holding 98% of the corpus is the same as no queue. This
        # is the calibration assertion: on the real distribution the rule
        # must select a workable minority.
        import glob
        import json
        rows = []
        for f in glob.glob(os.path.join(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                "data", "analysis", "articles", "*", "*.json")):
            try:
                with open(f, encoding="utf-8") as fh:
                    rows.append(record_review(json.load(fh)))
            except (OSError, json.JSONDecodeError):
                continue
        if len(rows) < 50:
            self.skipTest("no analysed corpus here — SKIPPING, not passing")
        flagged = sum(1 for r in rows if r)
        self.assertLess(flagged / len(rows), 0.25,
                        f"{flagged}/{len(rows)} flagged — the rule is not "
                        "selecting, it is passing everything through")
        self.assertGreater(flagged, 0,
                           "nothing flagged — the rule has stopped "
                           "discriminating")


class PartyToneRouting(unittest.TestCase):
    def rec(self, **tone_over):
        tone = {
            "party": "ГЕРБ", "party_id": "gerb", "tone": "neutral",
            "confidence": 0.8,
            "evidence": "Материалът представя позицията фактически и без оценка.",
        }
        tone.update(tone_over)
        return {
            "leaning": {"label": "neutral", "confidence": 0.8},
            "russia_stance": {"label": "not_applicable", "confidence": 0.9},
            "ai_generated": {"verdict": "likely_human", "confidence": 0.8},
            "party_tones": [tone],
        }

    def test_unresolved_party_is_reviewed(self):
        self.assertIn("unresolved party identity",
                      record_review(self.rec(party_id=None))["party_tones"])

    def test_low_confidence_positioned_tone_is_reviewed(self):
        got = record_review(self.rec(tone="unfavorable", confidence=0.6))
        self.assertIn("below", got["party_tones"])

    def test_mixed_is_always_reviewed(self):
        got = record_review(self.rec(tone="mixed", confidence=1.0))
        self.assertIn("both directions", got["party_tones"])

    def test_clean_neutral_tone_needs_no_review_without_article_context(self):
        self.assertNotIn("party_tones", record_review(self.rec()))

    def test_resolved_candidate_missing_from_empty_model_output_is_reviewed(self):
        rec = self.rec()
        rec["party_tones"] = []
        rec["entities"] = {"parties": []}
        rec["mentions"] = [{"kind": "party", "id": "gerb"}]
        self.assertIn("absent from model", record_review(rec)["party_tones"])


class TheQueueReader(unittest.TestCase):
    """`main()` — driven through the CLI, because that is how it is used.

    ⚠️ The unit tests above cover the RULE and reach none of this: the
    `--limit 0` slice, the malformed-record arm and the evidence fallback all
    live in the reader, and all three survived mutation until this class
    existed.
    """

    def setUp(self):
        import shutil
        import tempfile
        self.root = Path(tempfile.mkdtemp(prefix="review_q_"))
        self.dir = self.root / "news" / "data" / "analysis" / "articles" / "x.bg"
        self.dir.mkdir(parents=True)
        self.addCleanup(shutil.rmtree, self.root, True)

    def write(self, name, **over):
        rec = {"url": f"https://x.bg/{name}", "domain": "x.bg",
               "model": "m",
               "leaning": {"label": "not_applicable", "confidence": 0.8},
               "russia_stance": {"label": "not_applicable", "confidence": 0.9},
               "ai_generated": {"verdict": "likely_human", "confidence": 0.6}}
        rec.update(over)
        (self.dir / f"{name}.json").write_text(
            json.dumps(rec, ensure_ascii=False), encoding="utf-8")

    def run_cli(self, *args):
        proc = subprocess.run(
            [sys.executable,
             str(Path(__file__).with_name("review_routing.py")), *args],
            capture_output=True, text=True,
            env={**os.environ, "DATA_BG_ROOT": str(self.root)})
        return proc.returncode, json.loads(proc.stdout or "{}")

    def test_limit_ZERO_means_all_of_them(self):
        # ⚠️⚠️ run_nightly.sh passes `--limit 0` to get the whole queue into
        # the report, and `rows[:0]` shipped `needing_review: 16, shown: 0,
        # queue: []` every night at exit 0 — a report that names the number
        # and then withholds every row.
        for i in range(7):
            self.write(f"a{i}", leaning={"label": "progressive",
                                         "confidence": 0.5})
        code, out = self.run_cli("--limit", "0", "--json")
        self.assertEqual(code, 0)
        self.assertEqual(out["needing_review"], 7)
        self.assertEqual(out["shown"], 7)
        self.assertEqual(len(out["queue"]), 7)

    def test_a_positive_limit_still_caps(self):
        for i in range(7):
            self.write(f"a{i}", leaning={"label": "progressive",
                                         "confidence": 0.5})
        _, out = self.run_cli("--limit", "3", "--json")
        self.assertEqual(out["needing_review"], 7)
        self.assertEqual(out["shown"], 3)
        self.assertEqual(len(out["queue"]), 3)

    def test_a_negative_limit_is_REFUSED(self):
        self.write("a1")
        code, out = self.run_cli("--limit", "-1", "--json")
        self.assertEqual(code, 3)
        self.assertEqual(out["error"], "bad_limit")

    def test_one_malformed_record_costs_ONE_record(self):
        # ⚠️ A `.get` on a string raised out of the loop, killing all 365
        # records and — through run_nightly.sh's non-zero-exit grep — the
        # whole night's run.
        self.write("good", leaning={"label": "progressive",
                                    "confidence": 0.5})
        self.write("bad", leaning="progressive")
        code, out = self.run_cli("--limit", "0", "--json")
        self.assertEqual(code, 0)
        self.assertEqual(out["scanned"], 2)
        # The malformed one is FLAGGED rather than skipped or fatal.
        self.assertEqual(out["needing_review"], 2)
        self.assertTrue(any("not an object" in f["why"]
                            for r in out["queue"] for f in r["fields"].values()))

    def test_an_AI_row_carries_its_SIGNALS_as_evidence(self):
        # ⚠️ `ai_generated` carries `signals`, not `evidence` — reading only
        # `evidence` gave every AI row an empty string, i.e. a review-queue
        # entry with nothing to review.
        self.write("a1", ai_generated={"verdict": "likely_ai",
                                       "confidence": 0.9,
                                       "signals": ["no byline",
                                                   "uniform rhythm"]})
        _, out = self.run_cli("--limit", "0", "--json")
        row = out["queue"][0]["fields"]["ai_generated"]
        self.assertIn("no byline", row["evidence"])

    def test_a_party_tone_row_preserves_the_values_under_review(self):
        self.write("a1", party_tones=[{
            "party": "ГЕРБ", "party_id": None, "tone": "unfavorable",
            "confidence": 0.62, "evidence": "Конкретно неблагоприятно описание",
        }])
        _, out = self.run_cli("--field", "party_tones", "--json")
        row = out["queue"][0]["fields"]["party_tones"]
        self.assertEqual(row["items"][0]["party"], "ГЕРБ")
        self.assertEqual(row["items"][0]["tone"], "unfavorable")
        self.assertIn("неблагоприятно", row["items"][0]["evidence"])

    def test_the_floors_travel_with_the_queue(self):
        # A queue whose thresholds are invisible cannot be argued with.
        self.write("a1", leaning={"label": "progressive", "confidence": 0.5})
        _, out = self.run_cli("--limit", "0", "--json")
        self.assertEqual(out["floors"]["positioned"], FLOOR_POSITIONED)
        self.assertIn("likely_ai", out["floors"]["always"])


class TheTestRunner(unittest.TestCase):
    """⚠️ The runner listed three files by hand while eight existed."""

    def test_an_empty_discovery_is_a_FAILURE(self):
        # ⚠️ A renamed directory or a changed prefix would otherwise report
        # „all tests passed" for a suite it never found — which is exactly
        # the shape the hand-written list already produced once, silently,
        # for five of eight files.
        import shutil
        import tempfile
        empty = Path(tempfile.mkdtemp())
        runner = Path(__file__).with_name("run_tests.py")
        shutil.copy(runner, empty / "run_tests.py")
        proc = subprocess.run([sys.executable, str(empty / "run_tests.py")],
                              capture_output=True, text=True)
        self.assertEqual(proc.returncode, 2, proc.stderr)
        self.assertIn("refusing to report success", proc.stderr)

    def test_it_finds_every_test_file_beside_it(self):
        here = Path(__file__).resolve().parent
        found = {p.name for p in here.glob("test_*.py")}
        self.assertIn("test_review_routing.py", found)
        self.assertGreaterEqual(len(found), 8, sorted(found))


if __name__ == "__main__":
    unittest.main()
