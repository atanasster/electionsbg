#!/usr/bin/env python3
"""jev_client — the never-throw contract, the breaker, and the payload budget.

Run:  python3 news/scripts/test_jev_client.py

No network: the success paths replay the REAL captured responses from
`tests/fixtures/jev_contract.json` (Phase 3.1), so the answer shapes this
client is built on cannot drift from what the endpoint actually returned
without a test noticing.
"""

import io
import json
import sys
import unittest
import urllib.error
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
import jev_client as jc  # noqa: E402

FIXTURE = json.loads(
    (SCRIPT_DIR / "tests" / "fixtures" / "jev_contract.json")
    .read_text(encoding="utf-8"))


def captured(name):
    """One real response body from the Phase 3.1 capture."""
    for probes in FIXTURE.values():
        if name in probes and probes[name]["response"].get("status") == 200:
            return probes[name]["response"]["body"]
    raise AssertionError(f"no successful {name} in the fixture")


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def serving(body):
    def opener(request, timeout=None):
        return FakeResponse(json.dumps(body, ensure_ascii=False).encode())
    return opener


def raising(exc):
    def opener(request, timeout=None):
        raise exc
    return opener


def http_error(status, body=""):
    return urllib.error.HTTPError(
        jc.ENDPOINT, status, "err", {},
        io.BytesIO(body.encode("utf-8")))


QUESTIONS = {"q": {"type": "choice", "instructions": "тема?",
                   "criteria": {"a": "едно", "b": "две"}}}


class NeverRaises(unittest.TestCase):
    """The contract: Jev is an accelerator and must never take the lane down."""

    def setUp(self):
        jc.reset_breaker()
        self.addCleanup(jc.reset_breaker)

    def test_every_transport_failure_is_none_with_a_reason(self):
        cases = [
            (raising(TimeoutError("timed out")), "timeout"),
            (raising(OSError("connection reset")), "timeout"),
            (raising(http_error(500)), "http_error"),
            (raising(http_error(404)), "unavailable"),
            (serving("not a dict"), "malformed"),
            (serving({"answers": {}}), "malformed"),
            (serving({"answers": {"q": {"type": "unknown"}}}), "malformed"),
        ]
        for opener, reason in cases:
            with self.subTest(reason=reason):
                jc.reset_breaker()
                out = jc.ask("състояние", QUESTIONS, api_key="k",
                             urlopen=opener)
                self.assertFalse(out)
                self.assertIsNone(out.answers)
                self.assertEqual(out.skip, reason)

    def test_a_body_that_is_not_json_is_malformed_not_a_crash(self):
        def opener(request, timeout=None):
            return FakeResponse(b"<html>gateway</html>")
        out = jc.ask("s", QUESTIONS, api_key="k", urlopen=opener)
        self.assertFalse(out)
        self.assertEqual(out.skip, "malformed")

    def test_a_missing_key_never_touches_the_breaker(self):
        # ⚠️ A misconfigured process must not open the breaker and then
        # report an outage that never happened.
        for _ in range(jc.BREAKER_THRESHOLD + 2):
            out = jc.ask("s", QUESTIONS, api_key="",
                         urlopen=raising(AssertionError("called")))
            self.assertFalse(out)
        self.assertEqual(out.skip, "no_key")
        self.assertFalse(jc.breaker_open())


class Breaker(unittest.TestCase):
    def setUp(self):
        jc.reset_breaker()
        self.addCleanup(jc.reset_breaker)

    def test_it_opens_after_the_threshold_and_then_costs_nothing(self):
        clock = [1000.0]
        opener = raising(TimeoutError())
        for _ in range(jc.BREAKER_THRESHOLD):
            jc.ask("s", QUESTIONS, api_key="k", urlopen=opener,
                   now=lambda: clock[0])
        self.assertTrue(jc.breaker_open(clock[0]))
        # An open breaker must not issue a request at all — that is the whole
        # point: an outage costs ONE timeout, not one per article.
        out = jc.ask("s", QUESTIONS, api_key="k",
                     urlopen=raising(AssertionError("called")),
                     now=lambda: clock[0])
        self.assertFalse(out)
        self.assertEqual(out.skip, "breaker_open")

    def test_half_open_reopens_on_one_failure_not_three(self):
        clock = [1000.0]
        for _ in range(jc.BREAKER_THRESHOLD):
            jc.ask("s", QUESTIONS, api_key="k", urlopen=raising(TimeoutError()),
                   now=lambda: clock[0])
        clock[0] += jc.BREAKER_COOLDOWN_S + 1
        self.assertFalse(jc.breaker_open(clock[0]))
        jc.ask("s", QUESTIONS, api_key="k", urlopen=raising(TimeoutError()),
               now=lambda: clock[0])
        self.assertTrue(jc.breaker_open(clock[0]),
                        "a still-broken upstream must re-open immediately")

    def test_a_success_closes_it(self):
        clock = [1000.0]
        for _ in range(jc.BREAKER_THRESHOLD - 1):
            jc.ask("s", QUESTIONS, api_key="k", urlopen=raising(TimeoutError()),
                   now=lambda: clock[0])
        out = jc.ask("s", QUESTIONS, api_key="k",
                     urlopen=serving(captured("choice")),
                     now=lambda: clock[0])
        self.assertTrue(out)
        for _ in range(jc.BREAKER_THRESHOLD - 1):
            jc.ask("s", QUESTIONS, api_key="k", urlopen=raising(TimeoutError()),
                   now=lambda: clock[0])
        self.assertFalse(jc.breaker_open(clock[0]),
                         "the success must have reset the counter")


class OurBugIsNotAnOutage(unittest.TestCase):
    """The distinction the plan does not make, and Phase 3.1 measured."""

    def setUp(self):
        jc.reset_breaker()
        self.addCleanup(jc.reset_breaker)

    def test_an_invalid_payload_is_reported_not_absorbed(self):
        # ⚠️ Falling through to GLM silently on OUR bug looks identical to a
        # healthy fallback from the outside — for ever, at a higher cost per
        # article than Jev saves.
        out = jc.ask("s", {"q": {"type": "choice", "instructions": ""}},
                     api_key="k", urlopen=raising(AssertionError("called")))
        self.assertFalse(out)
        self.assertTrue(out.skip.startswith("invalid_request"), out.skip)
        self.assertTrue(out.report_worthy)
        # …and it never reached the network, so it cost nothing.
        self.assertFalse(jc.breaker_open())

    def test_a_400_from_the_endpoint_is_also_ours(self):
        out = jc.ask("s", QUESTIONS, api_key="k",
                     urlopen=raising(http_error(400)))
        self.assertEqual(out.skip, "invalid_request")
        self.assertTrue(out.report_worthy)

    def test_too_large_is_neither_a_bug_nor_an_outage(self):
        # The real captured body, nested exactly as the endpoint sends it.
        body = json.dumps({"error": {
            "message": 'HTTP 400: {"detail":{"error_type":'
                       '"max_tokens_exceeded"}}', "code": 400}})
        out = jc.ask("s", QUESTIONS, api_key="k",
                     urlopen=raising(http_error(400, body)))
        self.assertEqual(out.skip, "too_large")
        self.assertFalse(out.report_worthy,
                         "an article that does not fit is not a defect")
        self.assertFalse(jc.breaker_open(),
                         "the endpoint answered promptly and is healthy")

    def test_an_outage_is_not_report_worthy_but_does_trip_the_breaker(self):
        out = jc.ask("s", QUESTIONS, api_key="k",
                     urlopen=raising(http_error(410)))
        self.assertEqual(out.skip, "unavailable")
        self.assertFalse(out.report_worthy)

    def test_a_schema_change_is_report_worthy(self):
        out = jc.ask("s", QUESTIONS, api_key="k",
                     urlopen=serving({"results": [{"answer": "a"}]}))
        self.assertEqual(out.skip, "malformed")
        self.assertTrue(out.report_worthy)


class AnswerShapes(unittest.TestCase):
    """Replayed from the real capture, so they cannot drift silently."""

    def setUp(self):
        jc.reset_breaker()
        self.addCleanup(jc.reset_breaker)

    def test_it_returns_the_answers_usage_and_resolved_model(self):
        body = captured("batched_all_three")
        out = jc.ask("s", QUESTIONS, api_key="k", urlopen=serving(body))
        self.assertEqual(set(out.answers), set(body["answers"]))
        self.assertEqual(out.usage, body["usage"])
        # ⚠️ The RESOLVED id, not the one we asked for.
        self.assertEqual(out.model, body["model"])
        self.assertIsNone(out.skip)

    def test_confidence_is_per_type_because_noul_has_none(self):
        answers = captured("batched_all_three")["answers"]
        by_type = {a["type"]: a for a in answers.values()}
        self.assertEqual(set(by_type), {"choice", "score", "noul"})
        for kind in ("choice", "score"):
            self.assertEqual(jc.confidence_of(by_type[kind]),
                             by_type[kind]["confidence"])
        # ⚠️ noul carries NO confidence field. Reading one uniformly returns
        # nothing, and treating that as "low" discards the answer exactly
        # when it is most certain — the fixture's noul is 0.99.
        self.assertNotIn("confidence", by_type["noul"])
        self.assertAlmostEqual(jc.confidence_of(by_type["noul"]), 0.98)

    def test_a_confident_no_is_as_confident_as_a_confident_yes(self):
        # ⚠️ noul's value is a PROBABILITY, not a confidence. Reading it
        # directly rates a near-certain "no" (0.01) as the least reliable
        # answer on the scale, when it is among the most reliable.
        self.assertAlmostEqual(jc.confidence_of({"type": "noul", "noul": 0.01}),
                               0.98)
        self.assertAlmostEqual(jc.confidence_of({"type": "noul", "noul": 0.5}),
                               0.0)
        self.assertIsNone(jc.confidence_of({"type": "noul", "noul": None}))
        self.assertIsNone(jc.confidence_of(None))


class PayloadBudget(unittest.TestCase):
    """Ported from functions/jev_payload.js — the caps MULTIPLY."""

    def test_it_pins_the_model_and_keeps_the_question_shape(self):
        built = jc.build_payload("текст", QUESTIONS)
        self.assertEqual(built["model"], jc.MODEL)
        self.assertRegex(built["model"], r"-\d{8}$",
                         "the pinned id, never the moving alias")
        self.assertEqual(built["questions"]["q"]["criteria"],
                         QUESTIONS["q"]["criteria"])

    def test_the_per_field_caps(self):
        cases = [
            ("invalid_state", "x" * (jc.LIMITS["state_chars"] + 1), QUESTIONS),
            ("invalid_state", None, QUESTIONS),
            ("invalid_questions", "s", {}),
            ("invalid_questions", "s",
             {f"q{i}": QUESTIONS["q"] for i in range(jc.LIMITS["questions"] + 1)}),
            ("invalid_question_type", "s", {"q": {"type": "guess",
                                                  "instructions": "x"}}),
            ("invalid_instructions", "s", {"q": {"type": "choice",
                                                 "instructions": None,
                                                 "criteria": {"a": "1"}}}),
            ("invalid_criteria", "s", {"q": {"type": "choice",
                                             "instructions": "x",
                                             "criteria": {}}}),
            ("invalid_criteria", "s", {"q": {"type": "score",
                                             "instructions": "x",
                                             "criteria": ["only one"]}}),
            ("invalid_criteria", "s", {"q": {"type": "noul",
                                             "instructions": "x",
                                             "criteria": {}}}),
        ]
        for code, state, questions in cases:
            with self.subTest(code=code):
                with self.assertRaises(jc.JevPayloadError) as cm:
                    jc.build_payload(state, questions)
                self.assertEqual(cm.exception.code, code)

    def test_the_aggregate_bound_catches_what_the_per_field_caps_pass(self):
        # ⚠️ THE REASON total_chars EXISTS. Each field below is individually
        # legal; multiplied they are ~1.4M characters of paid payload.
        big = {f"q{i}": {"type": "choice", "instructions": "x" * 100,
                         "criteria": {f"k{j}": "y" * 500 for j in range(120)}}
               for i in range(jc.LIMITS["questions"])}
        for q in big.values():
            self.assertLessEqual(len(q["criteria"]), jc.LIMITS["options"])
        with self.assertRaises(jc.JevPayloadError) as cm:
            jc.build_payload("s", big)
        self.assertEqual(cm.exception.code, "input_too_large")

    def test_a_noul_question_may_omit_its_criteria(self):
        built = jc.build_payload("s", {"q": {"type": "noul",
                                             "instructions": "пари?"}})
        self.assertNotIn("criteria", built["questions"]["q"])


class RegressionsReviewFound(unittest.TestCase):
    """Four ways this client broke its own contract on the first cut.

    Every one is a case where the port dropped something the original had,
    or where a Python/JS difference widened a narrow gap.
    """

    def setUp(self):
        jc.reset_breaker()
        self.addCleanup(jc.reset_breaker)

    def test_an_unserializable_state_is_our_error_not_a_crash(self):
        # ⚠️ jev_payload.js wraps JSON.stringify in a try/catch for circular
        # references. Python's json.dumps ALSO refuses datetime, set, bytes,
        # Decimal and tuple keys — all of which a caller assembling a state
        # from parsed records produces without trying — so the dropped guard
        # was a far wider hole here, and each one raised straight out of
        # ask(), breaking never-raise on the ordinary path.
        import datetime
        import decimal
        circular = {}
        circular["self"] = circular
        for state in (datetime.datetime(2026, 9, 20), {"a"}, b"\x00",
                      decimal.Decimal("1.5"), circular, {(1, 2): "x"}):
            with self.subTest(kind=type(state).__name__):
                out = jc.ask(state, QUESTIONS, api_key="k",
                             urlopen=raising(AssertionError("called")))
                self.assertFalse(out)
                self.assertTrue(out.skip.startswith("invalid_request"),
                                out.skip)
                self.assertTrue(out.report_worthy)

    def test_an_unserializable_criteria_value_is_caught_too(self):
        import datetime
        out = jc.ask("s", {"q": {"type": "choice", "instructions": "x",
                                 "criteria": {"a": datetime.date(2026, 1, 1)}}},
                     api_key="k", urlopen=raising(AssertionError("called")))
        self.assertFalse(out)
        self.assertTrue(out.skip.startswith("invalid_request"))

    def test_a_non_string_question_id_is_refused(self):
        # Object.keys() is always a string in JS; a Python dict key is not,
        # and the answers would come back under a key the caller cannot match.
        for qid in ((1, 2), 7, None):
            with self.subTest(qid=qid):
                with self.assertRaises(jc.JevPayloadError):
                    jc.build_payload("s", {qid: QUESTIONS["q"]})

    def test_a_drip_feeding_peer_cannot_outlive_the_budget(self):
        # ⚠️ urllib's timeout= is PER SOCKET OPERATION, so a peer sending one
        # byte just under it holds the connection for ever while every read
        # looks healthy. AbortSignal.timeout() in jevClient.ts is a TOTAL
        # deadline and the port silently weakened it — the same no-output,
        # no-error shape as the 772 s stall in the plan's §0.11 E1.
        clock = [1000.0]

        class Dripping:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def read(self, n=None):
                clock[0] += 0.9      # each read is individually "fast"
                return b"x"          # …and never ends

        out = jc.ask("s", QUESTIONS, api_key="k", timeout_s=2.0,
                     urlopen=lambda req, timeout=None: Dripping(),
                     now=lambda: clock[0])
        self.assertFalse(out)
        self.assertEqual(out.skip, "timeout")
        self.assertLess(clock[0] - 1000.0, 5.0,
                        "the total deadline must bound the read")

    def test_an_endless_body_is_bounded_by_size_as_well(self):
        clock = [1000.0]

        class Firehose:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def read(self, n=65536):
                return b"x" * n

        out = jc.ask("s", QUESTIONS, api_key="k", timeout_s=30,
                     urlopen=lambda req, timeout=None: Firehose(),
                     now=lambda: clock[0])
        self.assertFalse(out)
        self.assertEqual(out.skip, "timeout")

    def test_a_nan_confidence_is_none_never_maximum(self):
        # ⚠️ min(1.0, nan) returns nan's partner, so NaN, -3.0 and 7.0 all
        # read as MAXIMUM confidence while the choice branch beside it failed
        # safe. One function, two opposite directions, on the value that
        # decides whether an answer is trusted.
        nan = float("nan")
        self.assertIsNone(jc.confidence_of({"type": "noul", "noul": nan}))
        self.assertIsNone(jc.confidence_of({"type": "choice",
                                            "confidence": nan}))
        # Out of range clamps rather than exceeding 1.0.
        for value in (-3.0, 7.0):
            self.assertLessEqual(
                jc.confidence_of({"type": "noul", "noul": value}), 1.0)
            self.assertGreaterEqual(
                jc.confidence_of({"type": "noul", "noul": value}), 0.0)
        # A bool is not a confidence, however much Python thinks it is a number.
        self.assertIsNone(jc.confidence_of({"type": "choice",
                                            "confidence": True}))

    def test_the_skip_reason_travels_with_the_call_not_the_module(self):
        # ⚠️ THE POOL HAZARD. Under 12 workers, 402 of ~411 failing calls read
        # back another thread's reason from module state — so the one class
        # report_worthy exists to catch was the one it could not see.
        import concurrent.futures as cf

        # Two failure kinds that do NOT trip the breaker, so this measures
        # per-call isolation and nothing else. (410 would be more dramatic
        # and would open the breaker by design, which is a different test.)
        too_large = json.dumps({"error": {
            "message": 'HTTP 400: {"detail":{"error_type":'
                       '"max_tokens_exceeded"}}', "code": 400}})

        def one(i):
            if i % 2:
                return jc.ask("s", {"q": {"type": "choice",
                                          "instructions": ""}},
                              api_key="k",
                              urlopen=raising(AssertionError("called")))
            return jc.ask("s", QUESTIONS, api_key="k",
                          urlopen=raising(http_error(400, too_large)))

        with cf.ThreadPoolExecutor(max_workers=12) as pool:
            outcomes = list(pool.map(one, range(120)))
        for i, out in enumerate(outcomes):
            expected = "invalid_request" if i % 2 else "too_large"
            self.assertEqual(out.skip.split(":", 1)[0], expected, i)
            self.assertEqual(out.report_worthy, bool(i % 2))
        self.assertFalse(jc.breaker_open())


class CapsAreRealNumbers(unittest.TestCase):
    """⚠️ The size tests built their input FROM the constant they tested, so
    five of eight LIMITS could be inflated 100x with the suite still green —
    internal consistency proved, the cap itself not. These are literals."""

    def test_the_ported_values_match_jev_payload_js(self):
        self.assertEqual(jc.LIMITS, {
            "questions": 8, "options": 300, "instructions_chars": 4000,
            "option_chars": 600, "option_key_chars": 200,
            "state_chars": 24000, "score_levels": 24, "total_chars": 100000})

    def test_each_cap_actually_rejects_one_over(self):
        q = lambda **kw: {"q": {"type": "choice", "instructions": "x",
                                "criteria": {"a": "1"}, **kw}}
        with self.assertRaises(jc.JevPayloadError):   # state_chars
            jc.build_payload("x" * 24001, q())
        jc.build_payload("x" * 24000, q())
        with self.assertRaises(jc.JevPayloadError):   # instructions_chars
            jc.build_payload("s", q(instructions="x" * 4001))
        with self.assertRaises(jc.JevPayloadError):   # option_chars
            jc.build_payload("s", {"q": {"type": "choice",
                                         "instructions": "x",
                                         "criteria": {"a": "y" * 601}}})
        with self.assertRaises(jc.JevPayloadError):   # option_key_chars
            jc.build_payload("s", {"q": {"type": "choice",
                                         "instructions": "x",
                                         "criteria": {"k" * 201: "1"}}})
        with self.assertRaises(jc.JevPayloadError):   # options
            jc.build_payload("s", {"q": {"type": "choice",
                                         "instructions": "x",
                                         "criteria": {f"k{i}": "1"
                                                      for i in range(301)}}})
        with self.assertRaises(jc.JevPayloadError):   # score_levels
            jc.build_payload("s", {"q": {"type": "score", "instructions": "x",
                                         "criteria": ["l"] * 25}})
        with self.assertRaises(jc.JevPayloadError):   # questions
            jc.build_payload("s", {f"q{i}": QUESTIONS["q"] for i in range(9)})


class CostModel(unittest.TestCase):
    def test_the_price_matches_what_the_endpoint_billed(self):
        # Guards the constant against the real receipts, so a listing change
        # shows up here rather than in a budget nobody rechecks.
        for probes in FIXTURE.values():
            for name, probe in probes.items():
                usage = ((probe["response"].get("body") or {})
                         .get("usage") or {})
                if "cost" not in usage:
                    continue
                self.assertAlmostEqual(
                    usage["cost"],
                    usage["input_tokens"] * jc.PRICE_PER_M_INPUT / 1e6,
                    places=9, msg=name)


if __name__ == "__main__":
    unittest.main()
