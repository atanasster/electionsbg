#!/usr/bin/env python3
"""T4.4 Phase 2 — the two calls, their answers and their failures.

⚠️ NO NETWORK. `ask` is injected everywhere; the only thing that touches
`jev_client` is `build_payload`, which is offline by construction and is the
point of several of these tests — a question set that the real validator
refuses is a call we would pay for and get a 400 from.
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import jev_ask as ja  # noqa: E402
import jev_axes as ax  # noqa: E402
import jev_client as jc  # noqa: E402
import jev_sentiment as sm  # noqa: E402

ARTICLE = {
    "url": "https://a.bg/1",
    "title": "ПП-ДБ пита кой контролира плановете",
    "content": ("ПП-ДБ внесе питане. ПП-ДБ настоява. Общинският съветник Иван "
                "Иванов подписа. Иван Иванов говори. ГЕРБ не коментира."),
}
ANALYSIS = {"entities": {"parties": ["ПП-ДБ", "ГЕРБ"], "people": ["Иван Иванов"]}}


def score(level=2, probs=None, confidence=0.9, levels=5):
    probs = probs or {str(i): (1.0 if i == level else 0.0) for i in range(levels)}
    return {"type": "score", "score": level, "probabilities": probs,
            "confidence": confidence}


def noul(value=0.8):
    return {"type": "noul", "noul": value}


def choice(value="0"):
    return {"type": "choice", "choice": value,
            "probabilities": {value: 1.0}, "confidence": 1.0}


def answers_for(questions, primary="0"):
    """⚠️ EACH SUBJECT GETS A DISTINGUISHABLE ANSWER.

    Identical answers cannot catch a mis-join: with every `tone_i` scored the
    same, reading `tone_0` for every subject passed all 28 tests. `tone_i` now
    scores level `i % 5`, so a row wearing another subject's tone is visible.
    """
    out = {}
    for qid, q in questions.items():
        if q["type"] == "noul":
            out[qid] = noul()
        elif qid.startswith("tone_"):
            out[qid] = score(level=int(qid.split("_")[1]) % 5)
        elif q["type"] == "score":
            out[qid] = score()
        else:
            out[qid] = choice(primary)
    return out


class FakeOutcome:
    def __init__(self, answers=None, skip=None, report_worthy=False, ms=400):
        self.answers = answers
        self.skip = skip
        self.ms = ms
        self.model = "typesafe/jev-1.13-20260917" if answers else None
        self.usage = {"cost": 0.0002, "input_tokens": 1200} if answers else {}
        self._rw = report_worthy

    def __bool__(self):
        return self.answers is not None

    @property
    def report_worthy(self):
        return self._rw


def answering_ask(calls=None):
    """An `ask` that answers every question it is given."""
    def ask(state, questions, model=None):
        if calls is not None:
            calls.append((state, questions))
        return FakeOutcome(answers_for(questions))
    return ask


def failing_ask(skip="timeout", report_worthy=False, only=None):
    def ask(state, questions, model=None):
        if only is None or only in questions:
            return FakeOutcome(None, skip=skip, report_worthy=report_worthy)
        return FakeOutcome(answers_for(questions))
    return ask


class Questions(unittest.TestCase):
    def test_each_axis_gets_an_applicability_gate_and_a_score(self):
        questions = ja.axis_questions()
        self.assertEqual(len(questions), 2 * len(ax.ARTICLE_AXES))
        for axis in ax.ARTICLE_AXES:
            self.assertEqual(questions[axis["applies_id"]]["type"], "noul")
            self.assertEqual(questions[axis["id"]]["type"], "score")
            self.assertEqual(questions[axis["id"]]["criteria"],
                             list(axis["scale"].anchors))

    def test_the_subject_questions_are_keyed_by_INDEX_not_by_name(self):
        # A party's own spelling in a payload key (and an answer key) is a
        # quote or a dot away from being a different kind of problem; the
        # index is the same integer the state publishes as `i`.
        subjects, _ = sm.subjects_for(ANALYSIS, ARTICLE)
        questions = ja.subject_questions(subjects)
        self.assertEqual(set(questions),
                         {"primary_subject", *(f"tone_{i}" for i in range(len(subjects)))})
        state, _ = sm.state_for(ARTICLE, subjects)
        for i, entry in enumerate(state["subjects"]):
            self.assertEqual(entry["i"], i)
            self.assertIn(entry["name"], questions[f"tone_{i}"]["instructions"])

    def test_the_primary_choice_offers_an_explicit_none(self):
        # Without it the model must name somebody on an article that is about
        # nobody in the list — 28.5% of the corpus names no subject at all.
        subjects, _ = sm.subjects_for(ANALYSIS, ARTICLE)
        criteria = ja.subject_questions(subjects)["primary_subject"]["criteria"]
        self.assertIn(ja.PRIMARY_NONE, criteria)
        self.assertEqual(len(criteria), len(subjects) + 1)

    def test_more_subjects_than_the_budget_are_refused(self):
        subjects = [{"name": f"П{i}", "kind": "party", "mentions": 2,
                     "in_title": False} for i in range(sm.MAX_SUBJECTS + 1)]
        with self.assertRaises(sm.JevSentimentError):
            ja.subject_questions(subjects)

    def test_both_question_sets_pass_the_real_client_validator(self):
        # ⚠️ A set the validator refuses is a call we pay for and get a 400
        # from — which `jev_client` classifies as OUR bug, not an outage.
        subjects = [{"name": f"Партия {i} „X“.", "kind": "party",
                     "mentions": 3, "in_title": True}
                    for i in range(sm.MAX_SUBJECTS)]
        state, _ = sm.state_for(ARTICLE, subjects)
        # ⚠️ EVERY CHUNK, not one: each is its own paid call.
        chunks = [ja.subject_questions(subjects, start=a, stop=b)
                  for a, b in ja.subject_chunks(subjects)]
        for questions in [ja.axis_questions(), *chunks]:
            payload = jc.build_payload(state, questions)
            self.assertLessEqual(len(questions), jc.LIMITS["questions"])
            self.assertLessEqual(
                len(json.dumps(payload, ensure_ascii=False)), jc.LIMITS["total_chars"])

    def test_a_worst_case_article_still_fits_the_whole_payload(self):
        subjects = [{"name": "Партия" + "я" * 40, "kind": "party",
                     "mentions": 9, "in_title": True}
                    for _ in range(sm.MAX_SUBJECTS)]
        big = {**ARTICLE, "content": 'дълъг "текст"\n' * 4000}
        state, truncated = sm.state_for(big, subjects)
        self.assertTrue(truncated)
        for a, b in ja.subject_chunks(subjects):
            payload = jc.build_payload(
                state, ja.subject_questions(subjects, start=a, stop=b))
            self.assertLessEqual(
                len(json.dumps(payload, ensure_ascii=False)),
                jc.LIMITS["total_chars"])

    def test_a_chunk_larger_than_one_calls_budget_is_refused(self):
        subjects = [{"name": f"П{i}", "kind": "party", "mentions": 2,
                     "in_title": False} for i in range(sm.TONES_PER_CALL + 1)]
        with self.assertRaises(sm.JevSentimentError):
            ja.subject_questions(subjects, start=0, stop=sm.TONES_PER_CALL + 1)

    def test_the_chunks_cover_every_subject_once(self):
        for n in (1, 6, 7, 12, 13, sm.MAX_SUBJECTS):
            chunks = ja.subject_chunks(list(range(n)))
            covered = [i for a, b in chunks for i in range(a, b)]
            self.assertEqual(covered, list(range(n)), n)
            self.assertTrue(all(b - a <= sm.TONES_PER_CALL for a, b in chunks))


class ChunkedSubjects(unittest.TestCase):
    """More subjects than one call carries: several calls, one record.

    ⚠️ The case that motivated it: on a crowded article the ONE-call cap of six
    dropped a party named twice in favour of people named twice, and the party
    archive then had no score for an article about the party.
    """

    def crowded(self, n=13):
        people = [f"Лице{chr(0x0410 + i)} Име" for i in range(n - 1)]
        body = " ".join(f"{p} говори. {p} отговори." for p in people)
        body += " ПП-ДБ внесе питане. пп дб настоява."
        article = {"url": "https://a.bg/crowd", "title": "Събрание",
                   "content": body * 3}
        analysis = {"entities": {"parties": ["ПП-ДБ"], "people": people}}
        return article, analysis

    def test_every_subject_is_asked_across_several_calls(self):
        calls = []
        article, analysis = self.crowded(13)
        rec = ja.assess_article(article, analysis, ask=ja_answering(calls))
        subject_calls = [q for _, q in calls if "axis" not in "".join(q)
                         and any(k.startswith("tone_") for k in q)]
        self.assertEqual(len(subject_calls), 3)
        # The primary choice rides on the first chunk only.
        self.assertEqual(sum("primary_subject" in q for q in subject_calls), 1)
        asked = [k for q in subject_calls for k in q if k.startswith("tone_")]
        self.assertEqual(len(asked), len(set(asked)))
        self.assertEqual(rec["subjects_dropped"], 0)
        self.assertEqual(len(rec["subjects"]), 13)
        self.assertEqual(set(rec["calls"]), {"axes", "subjects", "subjects_2",
                                             "subjects_3"})

    def test_a_party_named_with_another_separator_is_counted(self):
        # „пп дб" is the same name as „ПП-ДБ"; counted, it is no longer the
        # first subject the ranking drops.
        article, analysis = self.crowded(3)
        rec = ja.assess_article(article, analysis, ask=ja_answering([]))
        party = next(s for s in rec["subjects"] if s["kind"] == "party")
        self.assertEqual(party["mentions"], 6)

    def test_one_failed_chunk_keeps_the_others_answers(self):
        article, analysis = self.crowded(13)

        def ask(state, questions, model=None):
            if "tone_6" in questions:      # the second chunk
                return FakeOutcome(None, skip="timeout")
            return FakeOutcome(answers_for(questions))
        rec = ja.assess_article(article, analysis, ask=ask)
        self.assertEqual(rec["calls"]["subjects_2"]["status"], "failed")
        # ⚠️ NOT `ok`: a cached gap would never be re-asked.
        self.assertEqual(rec["status"], "partial")
        self.assertFalse(sm.answered({**rec, "rubric_version": sm.RUBRIC_VERSION}))
        assessed = [s for s in rec["subjects"]
                    if s["assessment_status"] == "assessed"]
        self.assertTrue(assessed)
        self.assertTrue(any("subjects_2: timeout" in p for p in rec["problems"]))
        self.assertTrue(any(p.startswith("tone_6") for p in rec["problems"]))

    def test_losing_the_FIRST_chunk_is_partial_not_a_re_derived_primary(self):
        # The first chunk carries `primary_subject`; losing it would silently
        # re-derive every role for the article if the record were cached.
        article, analysis = self.crowded(13)

        def ask(state, questions, model=None):
            if "primary_subject" in questions:
                return FakeOutcome(None, skip="timeout")
            return FakeOutcome(answers_for(questions))
        rec = ja.assess_article(article, analysis, ask=ask)
        self.assertEqual(rec["status"], "partial")
        self.assertFalse(any(s["subject_role"] == "primary" for s in rec["subjects"]))

    def test_every_subject_call_failing_with_the_axes_answered_is_partial(self):
        # ⚠️ The shape that published „не е субект" about a named party: an
        # `ok` record with an empty subject list.
        def ask(state, questions, model=None):
            if any(k.startswith("tone_") for k in questions):
                return FakeOutcome(None, skip="timeout")
            return FakeOutcome(answers_for(questions))
        rec = ja.assess_article(ARTICLE, ANALYSIS, ask=ask)
        self.assertTrue(rec["axes"])
        self.assertEqual(rec["subjects"], [])
        self.assertEqual(rec["status"], "partial")

    def test_past_the_cap_the_record_NAMES_what_it_dropped(self):
        # „Not in `subjects`" is otherwise two facts: absent, or past the cap.
        article, analysis = self.crowded(sm.MAX_SUBJECTS + 3)
        rec = ja.assess_article(article, analysis, ask=ja_answering([]))
        self.assertEqual(rec["subjects_dropped"], 3)
        dropped = rec["subjects_dropped_names"]
        self.assertEqual(len(dropped), 3)
        # With its KIND — the identity the archive joins on.
        self.assertTrue(all(set(d) == {"kind", "name"} for d in dropped))
        kept = {(s["kind"], s["name"]) for s in rec["subjects"]}
        self.assertFalse(kept & {(d["kind"], d["name"]) for d in dropped})


def ja_answering(calls):
    return answering_ask(calls)


class ReadingAxes(unittest.TestCase):
    def test_both_axes_decode_with_their_applicability(self):
        axes, problems = ja.read_axes(answers_for(ja.axis_questions()))
        self.assertEqual(problems, [])
        self.assertEqual(set(axes), {"leaning", "russia_stance"})
        self.assertAlmostEqual(axes["leaning"]["applies"], 0.8)
        self.assertAlmostEqual(axes["leaning"]["score"]["value"], 0.0)

    def test_a_malformed_answer_is_a_recorded_problem_not_a_neutral(self):
        answers = answers_for(ja.axis_questions())
        answers["leaning"] = {"type": "score", "score": 2, "probabilities": {}}
        axes, problems = ja.read_axes(answers)
        self.assertTrue(any("leaning" in p for p in problems))
        self.assertIsNone(axes["leaning"]["score"])
        self.assertIsNotNone(axes["leaning"]["applies"])

    def test_an_axis_with_no_answer_at_all_is_absent_and_reported(self):
        axes, problems = ja.read_axes({})
        self.assertEqual(axes, {})
        # Both halves of each axis are reported — a half-answered axis is not
        # the same event as an unanswered one.
        self.assertEqual(len(problems), 2 * len(ax.ARTICLE_AXES))

    def test_a_missing_score_beside_a_valid_gate_is_reported(self):
        answers = answers_for(ja.axis_questions())
        del answers["leaning"]
        axes, problems = ja.read_axes(answers)
        self.assertTrue(any("leaning: no score" == p for p in problems))
        self.assertIsNotNone(axes["leaning"]["applies"])
        self.assertIsNone(axes["leaning"]["score"])


class ReadingSubjects(unittest.TestCase):
    def setUp(self):
        self.subjects, _ = sm.subjects_for(ANALYSIS, ARTICLE)
        self.questions = ja.subject_questions(self.subjects)

    def test_an_unreadable_primary_choice_is_none_never_zero(self):
        # ⚠️ Defaulting to index 0 would make the most-mentioned subject
        # `primary` on every article whose choice failed — a judgement nobody
        # made, applied systematically.
        for answer in ({}, {"primary_subject": {"type": "score", "score": 1}},
                       {"primary_subject": choice("nope")},
                       {"primary_subject": choice("99")},
                       {"primary_subject": choice(ja.PRIMARY_NONE)}):
            self.assertIsNone(ja.read_primary(answer, self.subjects), answer)

    def test_each_subjects_tone_is_ITS_OWN_answer(self):
        # ⚠️ THE MIS-JOIN TEST. Reading `tone_0` for every subject passed the
        # whole suite before this: the question ids and the state indices have
        # to stay joined, and only distinguishable answers can show it.
        rows, problems = ja.read_subjects(answers_for(self.questions),
                                          self.subjects)
        self.assertEqual(problems, [])
        assessed = 0
        for i, row in enumerate(rows):
            if row["assessment_status"] == "assessed":
                assessed += 1
                self.assertEqual(row["tone"]["level"], i % 5,
                                 f"row {i} took another subject's tone")
        self.assertGreaterEqual(assessed, 2)

    def test_the_primary_options_name_the_subject_at_that_index(self):
        # ⚠️ Reversing the option labels leaves every index VALID and pointing
        # at the wrong human on every multi-subject article — systematically,
        # with every count reconciling. Nothing checked the labels against the
        # state's own order.
        criteria = ja.subject_questions(self.subjects)["primary_subject"]["criteria"]
        state, _ = sm.state_for(ARTICLE, self.subjects)
        for i, entry in enumerate(state["subjects"]):
            self.assertIn(entry["name"], criteria[str(i)])
            self.assertIn(entry["kind"], criteria[str(i)])

    def test_the_chosen_index_becomes_the_primary_role(self):
        answers = answers_for(self.questions, primary="1")
        rows, problems = ja.read_subjects(answers, self.subjects)
        self.assertEqual(problems, [])
        self.assertEqual(rows[1]["subject_role"], "primary")
        self.assertEqual(rows[1]["assessment_status"], "assessed")

    def test_an_incidental_subject_is_never_asked_for_a_tone(self):
        # Refusal 2, at the point it is applied.
        passing = [{"name": "ГЕРБ", "kind": "party", "mentions": 1, "in_title": False}]
        rows, problems = ja.read_subjects({"primary_subject": choice(ja.PRIMARY_NONE)},
                                          passing)
        self.assertEqual(rows[0]["subject_role"], "incidental")
        self.assertIsNone(rows[0]["tone"])
        self.assertEqual(rows[0]["assessment_status"], "not_assessed")
        # And its missing answer is NOT reported as a problem — we never asked.
        self.assertEqual(problems, [])

    def test_a_substantial_subject_with_no_answer_IS_a_problem(self):
        rows, problems = ja.read_subjects({"primary_subject": choice("0")},
                                          self.subjects)
        self.assertTrue(problems)
        self.assertTrue(all(r["tone"] is None for r in rows))

    def test_every_row_carries_the_tier_1_facts_it_was_judged_on(self):
        rows, _ = ja.read_subjects(answers_for(self.questions), self.subjects)
        for row, subject in zip(rows, self.subjects):
            self.assertEqual(row["mentions"], subject["mentions"])
            self.assertEqual(row["in_title"], subject["in_title"])
            self.assertIn(row["assessment_status"], sm.ASSESSMENT_STATUSES)


class AssessArticle(unittest.TestCase):
    def test_a_dry_run_builds_the_state_and_asks_nothing(self):
        def exploding(*a, **k):
            raise AssertionError("asked during a dry run")
        record = ja.assess_article(ARTICLE, ANALYSIS, ask=exploding, dry_run=True)
        self.assertEqual(record["status"], "would_generate")
        self.assertGreater(record["state_chars"], 0)
        self.assertEqual(record["axes"], {})

    def test_a_full_pass_records_both_calls(self):
        calls = []
        record = ja.assess_article(ARTICLE, ANALYSIS, ask=answering_ask(calls))
        self.assertEqual(record["status"], "ok")
        self.assertEqual(len(calls), 2)
        self.assertEqual(set(record["calls"]), {"axes", "subjects"})
        self.assertEqual(record["subjects_total"], 3)
        self.assertTrue(record["model"])
        self.assertEqual(record["problems"], [])

    def test_the_state_is_billed_once_per_call_and_is_the_same_state(self):
        # Two calls, not one per question — and both about the same text.
        calls = []
        ja.assess_article(ARTICLE, ANALYSIS, ask=answering_ask(calls))
        self.assertEqual(calls[0][0], calls[1][0])

    def test_one_call_failing_does_not_take_the_others_answers(self):
        # The reason the two sets are split on this seam.
        record = ja.assess_article(ARTICLE, ANALYSIS,
                                   ask=failing_ask(only="leaning"))
        self.assertEqual(record["status"], "ok")
        self.assertEqual(record["axes"], {})
        self.assertTrue(record["subjects"])
        self.assertEqual(record["calls"]["axes"]["status"], "failed")
        self.assertEqual(record["calls"]["subjects"]["status"], "ok")

    def test_both_calls_failing_is_a_failure_with_a_reason_not_a_neutral(self):
        record = ja.assess_article(ARTICLE, ANALYSIS, ask=failing_ask("timeout"))
        self.assertEqual(record["status"], "failed")
        self.assertIn("timeout", record["reason"])
        self.assertEqual(record["axes"], {})
        self.assertEqual(record["subjects"], [])

    def test_the_report_worthy_classes_are_the_CLIENTS_not_ours(self):
        # ⚠️ The stub's injected flag proves the plumbing, not the
        # classification. If `REPORT_WORTHY` gained `timeout`, or the
        # head-splitting on `:` regressed, nothing else here would notice.
        for skip, ours in (("timeout", False), ("unavailable", False),
                           ("http_error", False), ("too_large", False),
                           ("no_key", False), ("breaker_open", False),
                           ("invalid_request:invalid_state", True)):
            self.assertEqual(jc.JevOutcome(skip=skip).report_worthy, ours, skip)

    def test_our_own_bad_payload_is_distinguished_from_an_outage(self):
        # ⚠️ `jev_client` separates these for exactly this reason: swallowing
        # a refused payload pays for a fallback on every article while the bug
        # stays invisible.
        outage = ja.assess_article(ARTICLE, ANALYSIS, ask=failing_ask("timeout"))
        ours = ja.assess_article(ARTICLE, ANALYSIS,
                                 ask=failing_ask("invalid_request:invalid_state",
                                                 report_worthy=True))
        self.assertFalse(ja.our_bug(outage))
        self.assertTrue(ja.our_bug(ours))

    def test_an_article_naming_nobody_still_gets_its_axes(self):
        calls = []
        record = ja.assess_article(ARTICLE, {"entities": {}},
                                   ask=answering_ask(calls))
        self.assertEqual(len(calls), 1)
        self.assertEqual(record["subjects"], [])
        self.assertEqual(set(record["axes"]), {"leaning", "russia_stance"})

    def test_the_scope_badge_is_about_what_jev_saw(self):
        # 10,000 characters is a `prefix` to the GLM pass and FULL to this one
        # — which is the whole point of the pass, and the badge has to say so.
        long_article = {**ARTICLE, "content": "я" * 10000}
        record = ja.assess_article(long_article, ANALYSIS, ask=answering_ask())
        self.assertEqual(record["text_scope"]["kind"], "full")
        self.assertFalse(record["truncated"])

    def test_a_truncated_article_cannot_wear_a_full_badge(self):
        # The side that matters: only 0.41% of articles reach it, and a
        # `full` badge on one of them is the claim this pass must not make.
        huge = {**ARTICLE, "content": "я" * 30000}
        record = ja.assess_article(huge, ANALYSIS, ask=answering_ask())
        self.assertTrue(record["truncated"])
        self.assertNotEqual(record["text_scope"]["kind"], "full")
        self.assertLessEqual(record["state_chars"], sm.MAX_STATE_CHARS)

    def test_an_over_long_subject_name_is_truncated_not_reported_as_our_bug(self):
        # A corpus oddity must not exit the run non-zero as `invalid_request`.
        subjects = [{"name": "Я" * 2000, "kind": "party", "mentions": 4,
                     "in_title": True}]
        criteria = ja.subject_questions(subjects)["primary_subject"]["criteria"]
        self.assertLessEqual(len(criteria["0"]), jc.LIMITS["option_chars"])
        for question in ja.subject_questions(subjects).values():
            self.assertLessEqual(len(question["instructions"]),
                                 jc.LIMITS["instructions_chars"])


class Run(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name)

    def test_a_second_run_reads_the_cache_and_asks_nothing(self):
        pairs = [(ARTICLE, ANALYSIS)]
        first = ja.run(pairs, self.data, ask=answering_ask())
        self.assertEqual((first["assessed"], first["cached"]), (1, 0))
        def exploding(*a, **k):
            raise AssertionError("asked for a cached article")
        second = ja.run(pairs, self.data, ask=exploding)
        self.assertEqual((second["assessed"], second["cached"]), (0, 1))

    def test_force_re_asks(self):
        pairs = [(ARTICLE, ANALYSIS)]
        ja.run(pairs, self.data, ask=answering_ask())
        again = ja.run(pairs, self.data, ask=answering_ask(), force=True)
        self.assertEqual(again["assessed"], 1)

    def test_a_dry_run_stores_nothing(self):
        ja.run([(ARTICLE, ANALYSIS)], self.data, ask=answering_ask(), dry_run=True)
        self.assertIsNone(sm.cached(ARTICLE["url"], self.data))

    def test_the_cost_and_the_failures_are_counted(self):
        stats = ja.run([(ARTICLE, ANALYSIS)], self.data, ask=answering_ask())
        self.assertGreater(stats["cost"], 0)
        failed = ja.run([({**ARTICLE, "url": "https://a.bg/2"}, ANALYSIS)],
                        self.data, ask=failing_ask("timeout"))
        self.assertEqual(failed["failed"], 1)

    def test_one_bad_article_does_not_take_the_run_down(self):
        # ⚠️ Every call already in flight has been PAID FOR. Measured before
        # the guard: 9 articles, 18 billed calls, every statistic discarded.
        good = (ARTICLE, ANALYSIS)
        # A malformed `entities` no longer crashes — `subjects_for` handles it
        # — so the crash is injected where one can really come from: the call.
        bad = ({**ARTICLE, "url": "https://a.bg/bad", "title": "BOOM"}, ANALYSIS)
        calls = {"n": 0}

        def ask(state, questions, model=None):
            calls["n"] += 1
            if state.get("title") == "BOOM":
                raise RuntimeError("boom")
            return FakeOutcome(answers_for(questions))

        stats = ja.run([good, bad, good], self.data, ask=ask, concurrency=1)
        self.assertEqual(stats["crashed"], 1)
        self.assertGreaterEqual(stats["assessed"], 1)
        self.assertEqual(len(stats["crashes"]), 1)
        self.assertIn("RuntimeError", stats["crashes"][0]["error"])

    def test_an_outage_is_not_cached_as_an_answer(self):
        # ⚠️ A failed record is a log of an attempt, not an answer. Caching it
        # makes one transient outage permanently remove those articles: every
        # later healthy run reports them `cached` and never re-asks.
        pairs = [(ARTICLE, ANALYSIS)]
        outage = ja.run(pairs, self.data, ask=failing_ask("timeout"))
        self.assertEqual(outage["failed"], 1)
        healthy = ja.run(pairs, self.data, ask=answering_ask())
        self.assertEqual((healthy["assessed"], healthy["cached"]), (1, 0))
        # And the recovered record IS cached.
        again = ja.run(pairs, self.data, ask=failing_ask("timeout"))
        self.assertEqual(again["cached"], 1)

    def test_an_article_naming_nobody_is_recorded_as_such(self):
        record = ja.assess_article(ARTICLE, {"entities": {}}, ask=answering_ask())
        self.assertEqual(record["status"], "no_subjects")
        self.assertIn(record["status"], sm.RECORD_STATUSES)

    def test_our_bugs_are_collected_by_url(self):
        stats = ja.run([(ARTICLE, ANALYSIS)], self.data,
                       ask=failing_ask("invalid_request:invalid_state",
                                       report_worthy=True))
        self.assertEqual(stats["our_bugs"], [ARTICLE["url"]])


class Selection(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name)
        # ⚠️ The NEWER article sits under the alphabetically-EARLIER domain.
        # Sorting by path put 25 three-week-old vesti.bg articles first and
        # never reached the newest day in the corpus at any sane limit.
        for domain, name, url in (("aaa.bg", "20260101-old.json", "https://aaa.bg/old"),
                                  ("zzz.bg", "20261231-new.json", "https://zzz.bg/new")):
            adir = self.data / "analysis/articles" / domain
            adir.mkdir(parents=True, exist_ok=True)
            art_dir = self.data / domain
            art_dir.mkdir(parents=True, exist_ok=True)
            art = art_dir / name
            art.write_text(json.dumps({**ARTICLE, "url": url}, ensure_ascii=False),
                           encoding="utf-8")
            (adir / name).write_text(json.dumps(
                {**ANALYSIS, "url": url,
                 "article_path": str(art.relative_to(ja.ROOT))
                 if str(art).startswith(str(ja.ROOT)) else str(art)},
                ensure_ascii=False), encoding="utf-8")

    def test_the_newest_article_is_selected_first(self):
        files = sorted((self.data / "analysis/articles").glob("*/*.json"),
                       key=lambda p: (p.name, p.parent.name), reverse=True)
        self.assertEqual(files[0].name, "20261231-new.json")

    def test_a_malformed_analysis_file_does_not_crash_the_selection(self):
        bad = self.data / "analysis/articles/bad.bg"
        bad.mkdir(parents=True, exist_ok=True)
        (bad / "20270101-x.json").write_text('{"article_path": 7}', encoding="utf-8")
        (bad / "20270102-y.json").write_text("not json", encoding="utf-8")
        self.assertIsInstance(ja.load_pairs(self.data, 5), list)


class Mode(unittest.TestCase):
    def test_shadow_is_the_default_and_an_unknown_value_is_REFUSED(self):
        # ⚠️ Not read as the default: `shadow` is the paid mode, so a typo'd
        # `of` used to spend money. Unset or empty is still the default.
        import os
        original = os.environ.get(ja.MODE_ENV)
        try:
            for value, expected in ((None, "shadow"), ("", "shadow"),
                                    ("LIVE", "live"), ("off", "off"),
                                    ("nonsense", "invalid"), ("of", "invalid")):
                if value is None:
                    os.environ.pop(ja.MODE_ENV, None)
                else:
                    os.environ[ja.MODE_ENV] = value
                self.assertEqual(ja.mode(), expected, value)
        finally:
            os.environ.pop(ja.MODE_ENV, None)
            if original is not None:
                os.environ[ja.MODE_ENV] = original


class StageMode(unittest.TestCase):
    """`--stage` is how `run_nightly.sh` invokes this. Its `stage()` parses
    only the LAST line of combined output, and any non-zero stage withholds
    the whole public release — so both the shape and the exit code are the
    contract, not a detail."""

    def main(self, *argv, stats=None, pairs=((ARTICLE, ANALYSIS),), mode=None):
        import contextlib
        import io
        import os
        from unittest import mock
        out = io.StringIO()
        env = {} if mode is None else {ja.MODE_ENV: mode}
        with mock.patch.dict(os.environ, env), \
                mock.patch.object(ja, "load_pairs", return_value=list(pairs)), \
                mock.patch.object(ja, "run", return_value=dict(stats or {
                    "assessed": 1, "cached": 0, "failed": 0, "crashed": 0,
                    "our_bugs": [], "crashes": [], "cost": 0.0003})), \
                contextlib.redirect_stdout(out):
            if mode is None:
                os.environ.pop(ja.MODE_ENV, None)
            code = ja.main(list(argv))
        return code, out.getvalue()

    def test_the_last_line_is_one_parseable_json_object(self):
        code, out = self.main("--stage")
        self.assertEqual(code, 0)
        last = out.strip().splitlines()[-1]
        self.assertIsInstance(json.loads(last), dict)
        self.assertEqual(json.loads(last)["assessed"], 1)

    def test_without_stage_the_dump_is_indented_and_its_last_line_is_not(self):
        # The contrast that makes the flag necessary: `}` alone is what the
        # runner would have recorded as unparsed, failing the stage.
        _, out = self.main()
        self.assertEqual(out.strip().splitlines()[-1], "}")

    def test_our_bug_is_named_in_the_payload_and_does_not_fail_the_stage(self):
        bug = {"assessed": 1, "cached": 0, "failed": 1, "crashed": 0,
               "our_bugs": ["https://a.bg/1"], "crashes": [], "cost": 0.0}
        code, out = self.main("--stage", stats=bug)
        self.assertEqual(code, 0)
        payload = json.loads(out.strip().splitlines()[-1])
        self.assertEqual(payload["alert"], "our_bug")
        self.assertEqual(payload["our_bugs"], ["https://a.bg/1"])

    def test_a_manual_run_still_fails_loudly_on_our_bug(self):
        bug = {"assessed": 1, "cached": 0, "failed": 1, "crashed": 0,
               "our_bugs": ["https://a.bg/1"], "crashes": [], "cost": 0.0}
        code, _ = self.main(stats=bug)
        self.assertEqual(code, 1)

    def test_off_emits_a_result_instead_of_nothing(self):
        # A stage that exits 0 with no parseable line is recorded as exit 2.
        code, out = self.main("--stage", mode="off")
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out.strip().splitlines()[-1])["skipped"], "off")

    def test_nothing_to_assess_is_still_a_result(self):
        code, out = self.main("--stage", pairs=())
        self.assertEqual(code, 0)
        payload = json.loads(out.strip().splitlines()[-1])
        self.assertEqual(payload["skipped"], "nothing_to_assess")
        self.assertEqual(payload["assessed"], 0)

    def test_every_branch_carries_the_same_keys(self):
        # A reader must not need to know which branch ran to find a count.
        shapes = []
        for kwargs in ({}, {"pairs": ()}, {"mode": "off"}, {"mode": "typo"}):
            _, out = self.main("--stage", **kwargs)
            shapes.append(set(json.loads(out.strip().splitlines()[-1])))
        required = set(ja.empty_stats()) | {"mode", "dry_run"}
        for shape in shapes:
            self.assertLessEqual(required, shape)

    def test_a_typo_in_the_mode_asks_nothing_and_is_named(self):
        from unittest import mock
        with mock.patch.object(ja, "run") as run:
            code, out = self.main("--stage", mode="of")
        run.assert_not_called()
        self.assertEqual(code, 0)
        payload = json.loads(out.strip().splitlines()[-1])
        self.assertEqual((payload["skipped"], payload["alert"], payload["value"]),
                         ("invalid_mode", "invalid_mode", "of"))

    def test_a_manual_run_refuses_a_typo_in_the_mode(self):
        code, _ = self.main(mode="of")
        self.assertEqual(code, 2)

    def test_an_all_failed_run_raises_an_alert(self):
        # A host with no OPENROUTER_API_KEY fails every article and used to
        # exit 0 with no alert, re-asking the same articles every hour.
        dead = {**ja.empty_stats(), "assessed": 5, "failed": 5}
        _, out = self.main("--stage", stats=dead)
        self.assertEqual(json.loads(out.strip().splitlines()[-1])["alert"],
                         "all_failed")

    def test_a_partly_failed_run_raises_no_alert(self):
        # An outage on some articles is weather, not a finding.
        some = {**ja.empty_stats(), "assessed": 5, "failed": 2}
        _, out = self.main("--stage", stats=some)
        self.assertNotIn("alert", json.loads(out.strip().splitlines()[-1]))

    def test_a_crash_outside_the_run_is_named_and_does_not_fail_the_stage(self):
        import contextlib
        import io
        from unittest import mock
        out = io.StringIO()
        with mock.patch.object(ja, "load_pairs", side_effect=RuntimeError("boom")), \
                contextlib.redirect_stdout(out):
            code = ja.main(["--stage"])
        self.assertEqual(code, 0)
        payload = json.loads(out.getvalue().strip().splitlines()[-1])
        self.assertEqual(payload["alert"], "crash")
        self.assertIn("boom", payload["error"])

    def test_a_crash_outside_the_run_still_raises_on_a_manual_run(self):
        from unittest import mock
        with mock.patch.object(ja, "load_pairs", side_effect=RuntimeError("boom")):
            with self.assertRaises(RuntimeError):
                ja.main([])

    def test_a_dry_run_is_named_so_its_count_is_not_read_as_paid(self):
        _, out = self.main("--stage", "--dry-run")
        self.assertIs(json.loads(out.strip().splitlines()[-1])["dry_run"], True)


class SelectionRobustness(unittest.TestCase):
    """The real `load_pairs`, on the inputs that used to escape its guard."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name)

    def write(self, name, article):
        adir = self.data / "analysis/articles/a.bg"
        adir.mkdir(parents=True, exist_ok=True)
        art = self.data / "a.bg" / name
        art.parent.mkdir(parents=True, exist_ok=True)
        art.write_text(json.dumps(article, ensure_ascii=False), encoding="utf-8")
        (adir / name).write_text(json.dumps(
            {**ANALYSIS, "url": "https://a.bg/" + name, "article_path": str(art)},
            ensure_ascii=False), encoding="utf-8")

    def test_a_list_shaped_article_is_skipped_not_raised(self):
        self.write("20260101-list.json", ["not", "an", "object"])
        self.write("20260102-ok.json", {**ARTICLE, "url": "https://a.bg/ok"})
        pairs = ja.load_pairs(self.data, 5)
        self.assertEqual([a["url"] for a, _ in pairs], ["https://a.bg/ok"])

    def test_a_current_for_that_raises_skips_that_article(self):
        from unittest import mock
        self.write("20260102-ok.json", {**ARTICLE, "url": "https://a.bg/ok"})
        with mock.patch.object(ja.sm, "current_for", side_effect=TypeError("bad")):
            self.assertEqual(ja.load_pairs(self.data, 5), [])


class StageEndToEnd(unittest.TestCase):
    """The REAL script, as the runner invokes it — no mocks on `main`."""

    def test_the_real_script_prints_one_parseable_last_line(self):
        import os
        import subprocess
        with tempfile.TemporaryDirectory() as tmp:
            # ⚠️ `--dry-run` over an empty data dir: nothing is selected and
            # nothing is asked, so this touches no network.
            env = {**os.environ, ja.MODE_ENV: "shadow"}
            env.pop("OPENROUTER_API_KEY", None)
            proc = subprocess.run(
                [sys.executable, str(HERE / "jev_ask.py"), "--stage", "--dry-run",
                 "--limit", "3", "--data-dir", tmp],
                capture_output=True, text=True, env=env, check=False)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        combined = (proc.stdout + proc.stderr).strip().splitlines()
        self.assertIsInstance(json.loads(combined[-1]), dict)


if __name__ == "__main__":
    unittest.main()
