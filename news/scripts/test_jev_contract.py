#!/usr/bin/env python3
"""The Phase 3.1 report's numbers must be recomputable from its fixture.

Run:  python3 news/scripts/test_jev_contract.py

⚠️ THIS EXISTS BECAUSE THE FIRST DRAFT OF THAT REPORT WAS WRONG IN A WAY
NOTHING COULD CATCH. It quoted latencies read off one probe session's stdout
while the committed fixture held a different session's (the second run
overwrote the first), and it derived a tokens-per-character figure that made
`jev_payload.js`'s 24,000-character cap look like an exact match to the
32k context when it is merely conservative — arithmetic error presented as a
designed coincidence, which is the worst shape a finding can take here.

Neither error was reachable by reading the code, and both would have been
carried forward into Phase 3.2's design. So the rule is now mechanical: every
figure in `jev-contract-2026-09-20.md` is parsed back out of the prose and
recomputed from `tests/fixtures/jev_contract.json`.

The fixture is captured API responses, so this test makes NO network calls.
"""

import json
import re
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
FIXTURE = SCRIPT_DIR / "tests" / "fixtures" / "jev_contract.json"
REPORT = SCRIPT_DIR.parent / "evals" / "jev-contract-2026-09-20.md"
PRICE_PER_M_INPUT = 0.042


def sessions():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def every_call():
    for session, probes in sessions().items():
        for name, probe in probes.items():
            yield session, name, probe


def successes():
    for session, name, probe in every_call():
        if probe["response"].get("status") == 200:
            yield session, name, probe


class Fixture(unittest.TestCase):
    def test_the_fixture_holds_every_session_not_just_the_last(self):
        # The defect that started this: two sessions merged flat, so the
        # later one silently replaced the earlier and the report's latencies
        # described a capture that was no longer on disk.
        keyed = sessions()
        self.assertGreaterEqual(len(keyed), 2, "one session cannot show the "
                                               "cold-start effect the report claims")
        for key, probes in keyed.items():
            self.assertRegex(key, r"^\d{8}T\d{6}Z$", "sessions are keyed by "
                                                     "UTC stamp, not merged")
            self.assertIn("choice", probes)

    def test_no_credential_or_account_identifier_survives(self):
        raw = FIXTURE.read_text(encoding="utf-8")
        for secret in ("sk-or-", "Bearer ", "Authorization", "api_key"):
            self.assertNotIn(secret, raw, f"{secret!r} in a committed fixture")
        self.assertNotIn("user_39", raw, "a real account id is not ours to publish")
        # And the redaction actually happened where the endpoint returns one.
        for _s, name, probe in every_call():
            body = probe["response"].get("body")
            if isinstance(body, dict) and "user_id" in body:
                self.assertEqual(body["user_id"], "<redacted-account-id>", name)


class ReportMatchesFixture(unittest.TestCase):
    """Each claim below is parsed from the prose, not restated here."""

    def setUp(self):
        self.text = REPORT.read_text(encoding="utf-8")

    def claim(self, pattern):
        m = re.search(pattern, self.text)
        self.assertIsNotNone(m, f"the report no longer states {pattern!r} — "
                                f"update this test WITH the number, not after it")
        return m

    def test_the_total_cost(self):
        claimed = float(self.claim(r"\*\*\$(0\.\d+)\s+in\s*\n?total\*\*").group(1))
        actual = sum((p["response"].get("body") or {}).get("usage", {}).get("cost", 0)
                     for _s, _n, p in every_call())
        self.assertAlmostEqual(claimed, actual, places=8)

    def test_the_call_counts(self):
        m = self.claim(r"(\d+) calls, (\d+) of them 200")
        total = sum(1 for _ in every_call())
        ok = sum(1 for _ in successes())
        self.assertEqual((int(m.group(1)), int(m.group(2))), (total, ok))

    def test_the_latency_range_and_median(self):
        m = self.claim(r"Latency: ([\d,]+)–([\d,]+) ms across (\d+) "
                       r"successful calls, median ([\d,]+) ms")
        lat = sorted(p["response"]["ms"] for _s, _n, p in successes())
        num = lambda g: int(m.group(g).replace(",", ""))
        self.assertEqual(num(3), len(lat))
        self.assertEqual((num(1), num(2)), (lat[0], lat[-1]))
        median = lat[len(lat) // 2] if len(lat) % 2 else (
            (lat[len(lat) // 2 - 1] + lat[len(lat) // 2]) / 2)
        self.assertEqual(num(4), median)

    def test_only_two_calls_exceeded_a_second(self):
        m = self.claim(r"\((\d[\d,]*) and (\d[\d,]*) ms\)")
        slow = sorted(p["response"]["ms"] for _s, _n, p in successes()
                      if p["response"]["ms"] > 1000)
        claimed = sorted(int(g.replace(",", "")) for g in m.groups())
        self.assertEqual(claimed, slow)
        self.assertIn("first two calls of the first session", self.text)
        # …and they really are the first two of the earliest session.
        first = sessions()[min(sessions())]
        order = [p["response"]["ms"] for p in first.values()
                 if p["response"].get("status") == 200]
        self.assertEqual(sorted(order[:2], reverse=True), sorted(slow, reverse=True))

    def test_the_batching_arithmetic(self):
        m = self.claim(r"(\d+) \+ (\d+) \+ (\d+) = \*\*([\d,]+)\*\*")
        parts = [int(m.group(i)) for i in (1, 2, 3)]
        self.assertEqual(sum(parts), int(m.group(4).replace(",", "")))
        # The three singles and the batched call, from ONE session so the
        # numbers are comparable.
        for _key, probes in sessions().items():
            if not {"choice", "score", "noul", "batched_all_three"} <= set(probes):
                continue
            singles = [probes[k]["response"]["body"]["usage"]["input_tokens"]
                       for k in ("choice", "score", "noul")]
            if sorted(singles) == sorted(parts):
                batched = probes["batched_all_three"]["response"]["body"]["usage"]
                claimed_batched = int(self.claim(
                    r"one batched call \| \*\*([\d,]+)\*\*")
                    .group(1).replace(",", ""))
                self.assertEqual(batched["input_tokens"], claimed_batched)
                saving = 1 - batched["input_tokens"] / sum(singles)
                pct = int(self.claim(r"a (\d+)% cost saving").group(1))
                self.assertEqual(round(saving * 100), pct)
                return
        self.fail("no session carries all four probes — the report compares "
                  "numbers that were never measured together")

    def test_the_tokens_per_character_range(self):
        m = self.claim(r"~(0\.\d+) tokens per character of JSON payload\*\*\s*"
                       r"\((0\.\d+)–(0\.\d+)")
        ratios = []
        for _s, _n, probe in successes():
            usage = probe["response"]["body"].get("usage") or {}
            if "input_tokens" not in usage:
                continue
            chars = len(json.dumps(probe["request"], ensure_ascii=False))
            ratios.append(usage["input_tokens"] / chars)
        self.assertTrue(ratios)
        lo, hi = min(ratios), max(ratios)
        self.assertAlmostEqual(float(m.group(2)), lo, places=2)
        self.assertAlmostEqual(float(m.group(3)), hi, places=2)
        # ⚠️ And the conclusion that follows: the cap is INSIDE the context
        # with headroom, never an exact match. 24000 chars must cost well
        # under 32000 tokens at the WORST observed ratio.
        self.assertLess(24000 * hi, 32000 * 0.95,
                        "the 24k cap is no longer conservative — re-measure "
                        "before repeating the claim that it has headroom")
        self.assertIn("conservative", self.text)


class ContractShape(unittest.TestCase):
    """The findings Phase 3.2 will be built on."""

    def test_cost_is_input_tokens_only(self):
        for _s, name, probe in successes():
            usage = probe["response"]["body"].get("usage") or {}
            if "cost" not in usage:
                continue
            implied = usage["input_tokens"] * PRICE_PER_M_INPUT / 1e6
            self.assertAlmostEqual(usage["cost"], implied, places=9, msg=name)
            # Output really is free: several calls billed 18–80 output
            # tokens and none of it reached the price.
            self.assertGreater(usage.get("output_tokens", 0), 0, name)

    def test_noul_carries_no_confidence_and_the_others_do(self):
        # ⚠️ The finding a uniform `answer["confidence"]` read would break
        # on — and `noul`'s value IS its probability, so a missing
        # confidence read as "low" discards it when it is most certain.
        seen = set()
        for _s, _n, probe in successes():
            for answer in (probe["response"]["body"].get("answers") or {}).values():
                seen.add(answer["type"])
                if answer["type"] == "noul":
                    self.assertNotIn("confidence", answer)
                    self.assertNotIn("probabilities", answer)
                    self.assertIsInstance(answer["noul"], (int, float))
                else:
                    self.assertIn("confidence", answer)
                    self.assertIn("probabilities", answer)
        self.assertEqual(seen, {"choice", "score", "noul"})

    def test_the_pinned_id_was_actually_sent_and_accepted(self):
        # The report says "probed, not assumed" — an earlier cut printed the
        # pinned id beside the alias and never called it.
        pinned = [p for _s, n, p in successes() if n == "pinned_model"]
        self.assertTrue(pinned, "no probe sent the dated model id")
        req, resp = pinned[0]["request"], pinned[0]["response"]["body"]
        self.assertRegex(req["model"], r"-\d{8}$")
        self.assertEqual(resp["model"], req["model"])

    def test_an_error_is_distinguishable_from_an_outage(self):
        errors = {n: p["response"] for _s, n, p in every_call()
                  if p["response"].get("status") == 400}
        self.assertGreaterEqual(len(errors), 3, sorted(errors))
        for name, resp in errors.items():
            body = resp.get("body") or {}
            self.assertIn("error", body, name)
            self.assertIn("message", body["error"], name)
        too_large = [r for n, r in errors.items() if "too_large" in n]
        self.assertTrue(too_large)
        self.assertIn("max_tokens_exceeded",
                      json.dumps(too_large[0]["body"], ensure_ascii=False),
                      "the over-size class must stay identifiable — it is "
                      "neither our bug nor an outage")


if __name__ == "__main__":
    unittest.main()
