#!/usr/bin/env python3

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import benchmark_news_models as benchmark
import build_political_gold_config as political


class Allocation(unittest.TestCase):
    def test_largest_remainder_is_exact_deterministic_and_capped(self):
        got = political.allocate({"a": 5, "b": 3, "c": 2}, 7)
        self.assertEqual(sum(got.values()), 7)
        self.assertTrue(all(got[key] <= cap
                            for key, cap in {"a": 5, "b": 3, "c": 2}.items()))
        self.assertEqual(got, political.allocate({"c": 2, "b": 3, "a": 5}, 7))

    def test_selection_is_stable_and_respects_category_quota(self):
        rows = [{"category": category, "article_path": f"{category}/{i}"}
                for category, n in (("a", 7), ("b", 3)) for i in range(n)]
        first = political.select(rows, 5, "seed")
        second = political.select(list(reversed(rows)), 5, "seed")
        self.assertEqual(first, second)
        self.assertEqual(sum(row["category"] == "a" for row in first), 4)
        self.assertEqual(sum(row["category"] == "b" for row in first), 1)


class FrozenInputs(unittest.TestCase):
    def test_hash_gate_reports_changed_and_missing_inputs(self):
        with tempfile.TemporaryDirectory(prefix="gold_hash_") as td:
            root = Path(td)
            good = root / "good.json"
            good.write_text("{}", encoding="utf-8")
            config = {
                "article_hashes": {
                    "good.json": hashlib.sha256(b"{}").hexdigest(),
                    "missing.json": "abc",
                },
                "reference_hashes": {},
            }
            with mock.patch.object(benchmark, "ROOT", root):
                got = benchmark.verify_frozen_inputs(config)
            self.assertIn({"field": "article_hashes",
                           "path": "missing.json",
                           "expected": "abc", "actual": None}, got)

    def test_current_100_article_config_is_reproducible(self):
        value = political.build(100, "political-gold-v1-20260829")
        self.assertEqual(value["selection"]["selected"], 100)
        self.assertGreaterEqual(value["selection"]["eligible"], 100)
        self.assertEqual(len(value["articles"]), len(set(value["articles"])))
        self.assertEqual(benchmark.verify_frozen_inputs(value), [])

    def test_frozen_config_requires_exact_hash_coverage_and_selection_hash(self):
        value = political.build(100, "political-gold-v1-20260829")
        missing = json.loads(json.dumps(value))
        missing["article_hashes"].pop(missing["articles"][0])
        errors = benchmark.verify_frozen_inputs(missing)
        self.assertTrue(any(error.get("error") == "coverage_mismatch"
                            for error in errors))

        extra = json.loads(json.dumps(value))
        extra["reference_hashes"]["news/data/gold/reference/extra.json"] = "0"
        errors = benchmark.verify_frozen_inputs(extra)
        self.assertTrue(any(error.get("extra") == [
            "news/data/gold/reference/extra.json"] for error in errors))

        bad_selection = json.loads(json.dumps(value))
        bad_selection["selection"]["selection_sha256"] = "0" * 64
        errors = benchmark.verify_frozen_inputs(bad_selection)
        self.assertTrue(any(error.get("field") ==
                            "selection.selection_sha256" for error in errors))


class ResumeContract(unittest.TestCase):
    def test_manifest_refuses_changed_contract_and_unmanifested_output(self):
        with tempfile.TemporaryDirectory(prefix="benchmark_manifest_") as td:
            out = Path(td) / "fresh"
            contract = {"version": 1, "request": {"max_tokens": 10}}
            digest, error = benchmark.prepare_run_manifest(out, contract, False)
            self.assertIsNone(error)
            self.assertEqual(digest, benchmark.canonical_sha256(contract))
            _, error = benchmark.prepare_run_manifest(out, contract, True)
            self.assertIsNone(error)
            _, error = benchmark.prepare_run_manifest(
                out, {"version": 2, "request": {"max_tokens": 10}}, True)
            self.assertEqual(error, "run_manifest_mismatch")

            legacy = Path(td) / "legacy"
            legacy.mkdir()
            (legacy / "raw.json").write_text("{}", encoding="utf-8")
            _, error = benchmark.prepare_run_manifest(legacy, contract, True)
            self.assertEqual(error, "legacy_or_unmanifested_output_refused")

    def test_resumed_raw_requires_contract_prompt_and_request_metadata(self):
        contract = {"request": {
            "endpoint_origin": "https://openrouter.ai",
            "endpoint_class": "openrouter", "max_tokens": 4096,
            "temperature": 0.2, "thinking_enabled": False,
            "reasoning": {"effort": "low", "exclude": True},
            "provider_routing": {"require_parameters": True},
            "transport_attempt_limit": 3,
        }}
        answer = {
            "benchmark": {"contract_sha256": "contract",
                          "user_prompt_sha256": "prompt",
                          "requested_model": "model-a"},
            "request": {**contract["request"],
                        "body_sha256": "sha256:" + "a" * 64},
            "transport_elapsed_s": 12.5,
            "attempt_elapsed_s": 3.5,
        }
        self.assertIsNone(benchmark.resumed_answer_error(
            answer, "contract", "prompt", "model-a", answer["request"]))
        self.assertEqual(benchmark.resumed_answer_error(
            answer, "contract", "prompt", "model-b", answer["request"]),
            "requested_model_mismatch")
        expected_request = dict(answer["request"])
        expected_request["body_sha256"] = "sha256:" + "b" * 64
        self.assertEqual(benchmark.resumed_answer_error(
            answer, "contract", "prompt", "model-a", expected_request),
            "request_body_sha256_mismatch")
        answer["request"]["max_tokens"] = 2048
        self.assertEqual(benchmark.resumed_answer_error(
            answer, "contract", "prompt", "model-a",
            {**answer["request"], "max_tokens": 4096}),
            "request_max_tokens_mismatch")
        row = benchmark.resumed_row("article.json", answer, [])
        self.assertEqual(row["elapsed_s"], 12.5)
        self.assertEqual(row["final_attempt_elapsed_s"], 3.5)
        no_transport = benchmark.resumed_row(
            "legacy.json", {"elapsed_s": 3.5}, ["bad"])
        self.assertIsNone(no_transport["elapsed_s"])
        self.assertEqual(no_transport["final_attempt_elapsed_s"], 3.5)


if __name__ == "__main__":
    unittest.main()
