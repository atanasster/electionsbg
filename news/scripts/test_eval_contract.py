#!/usr/bin/env python3
"""Python/TypeScript parity gate for the shared evaluation contract."""

from __future__ import annotations

import copy
import json
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CONTRACT_DIR = ROOT / "news" / "eval_contract"
sys.path.insert(0, str(CONTRACT_DIR))
import validate as contract_validate  # noqa: E402


class FixtureParity(unittest.TestCase):
    def fixtures(self):
        root = CONTRACT_DIR / "fixtures"
        manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
        return [json.loads((root / name).read_text(encoding="utf-8"))
                for name in manifest["cases"]]

    def typescript_result(self, fixture):
        completed = subprocess.run(
            ["node", "--import", "tsx", str(CONTRACT_DIR / "validate.ts"),
             "--fixture-stdin"],
            cwd=ROOT, check=True, capture_output=True, text=True,
            input=json.dumps(fixture, ensure_ascii=False),
        )
        return json.loads(completed.stdout)

    def assert_parity(self, fixture):
        python = contract_validate.validate_fixture(fixture)
        self.assertEqual(python, self.typescript_result(fixture))
        return python

    def test_python_results_match_declared_expectations(self):
        fixtures = self.fixtures()
        results = contract_validate.validate_fixtures()
        self.assertEqual([case["id"] for case in fixtures],
                         [result["id"] for result in results])
        for fixture, result in zip(fixtures, results):
            with self.subTest(fixture=fixture["id"]):
                self.assertEqual(fixture["expected"], {
                    key: result[key]
                    for key in ("schema_valid", "semantic_valid",
                                "gold_eligible", "error_codes")
                })

    def test_typescript_results_are_byte_for_byte_equivalent(self):
        completed = subprocess.run(
            ["node", "--import", "tsx", str(CONTRACT_DIR / "validate.ts"),
             "--fixtures", "--json"],
            cwd=ROOT, check=True, capture_output=True, text=True,
        )
        self.assertEqual(contract_validate.validate_fixtures(),
                         json.loads(completed.stdout))

    def test_model_relative_disposition_is_not_trusted(self):
        fixture = copy.deepcopy(self.fixtures()[0])
        fixture["value"]["leaning"]["disposition"] = "confirmed"
        result = self.assert_parity(fixture)
        self.assertFalse(result["semantic_valid"])
        self.assertFalse(result["gold_eligible"])
        self.assertIn("invalid_disposition", result["error_codes"])

    def test_reason_codes_are_limited_to_their_axis(self):
        fixture = copy.deepcopy(self.fixtures()[0])
        fixture["value"]["leaning"]["reason_codes"] = ["wrong_party_identity"]
        result = self.assert_parity(fixture)
        self.assertFalse(result["semantic_valid"])
        self.assertFalse(result["gold_eligible"])
        self.assertIn("invalid_reason_scope", result["error_codes"])

    def test_duplicate_canonical_party_ids_are_rejected(self):
        fixture = copy.deepcopy(self.fixtures()[5])
        duplicate = copy.deepcopy(fixture["value"]["party_tones"][0])
        duplicate["party"] = "Граждани за европейско развитие на България"
        fixture["value"]["party_tones"].append(duplicate)
        result = self.assert_parity(fixture)
        self.assertFalse(result["semantic_valid"])
        self.assertFalse(result["gold_eligible"])
        self.assertIn("duplicate_party", result["error_codes"])

    def test_every_model_party_must_be_retained_or_removed(self):
        fixture = copy.deepcopy(self.fixtures()[2])
        fixture["value"]["party_tones"] = []
        result = self.assert_parity(fixture)
        self.assertFalse(result["semantic_valid"])
        self.assertFalse(result["gold_eligible"])
        self.assertIn("unaccounted_model_party", result["error_codes"])

    def test_a_model_party_may_be_explicitly_removed(self):
        fixture = copy.deepcopy(self.fixtures()[2])
        fixture["value"]["party_tones"] = []
        fixture["value"]["removed_model_parties"] = [{
            "party": "ГЕРБ", "party_id": "gerb",
            "reason_code": "party_not_meaningful",
        }]
        result = self.assert_parity(fixture)
        self.assertTrue(result["semantic_valid"])
        self.assertTrue(result["gold_eligible"])

    def test_removed_parties_cannot_overlap_duplicate_or_be_invented(self):
        base = copy.deepcopy(self.fixtures()[2])
        removal = {"party": "ГЕРБ", "party_id": "gerb",
                   "reason_code": "party_not_meaningful"}
        cases = []
        overlap = copy.deepcopy(base)
        overlap["value"]["removed_model_parties"] = [removal]
        cases.append((overlap, "party_retained_removed_overlap"))
        duplicate = copy.deepcopy(base)
        duplicate["value"]["party_tones"] = []
        duplicate["value"]["removed_model_parties"] = [removal, removal]
        cases.append((duplicate, "duplicate_removed_party"))
        invented = copy.deepcopy(base)
        invented["value"]["removed_model_parties"] = [{
            "party": "Несъществуваща", "party_id": "missing",
            "reason_code": "party_not_meaningful",
        }]
        cases.append((invented, "unknown_removed_party"))
        for fixture, code in cases:
            with self.subTest(code=code):
                result = self.assert_parity(fixture)
                self.assertFalse(result["semantic_valid"])
                self.assertFalse(result["gold_eligible"])
                self.assertIn(code, result["error_codes"])

    def test_json_boolean_and_number_equality_matches(self):
        base = self.fixtures()[4]
        mutations = [
            ("schema_version", True, False),
            ("schema_version", 1.0, True),
            ("parties_confirmed_complete", 1, False),
        ]
        for field, value, valid in mutations:
            with self.subTest(field=field, value=value):
                fixture = copy.deepcopy(base)
                fixture["value"][field] = value
                result = self.assert_parity(fixture)
                self.assertEqual(valid, result["schema_valid"])
                if not valid:
                    self.assertFalse(result["gold_eligible"])

    def test_record_hash_numbers_are_cross_language_canonical(self):
        fixture = copy.deepcopy(self.fixtures()[12])
        fixture["records"] = [{
            "integer_float": 1.0,
            "fraction": 1.25,
            "small": 1e-7,
            "decimal_threshold": 1e-6,
            "negative_zero": -0.0,
            "nested": ["ж", {"😀": 2}],
        }]
        fixture["value"]["records_sha256"] = contract_validate._sha256_json(
            fixture["records"])
        result = self.assert_parity(fixture)
        self.assertNotIn("records_hash_mismatch", result["error_codes"])

    def test_unsafe_integer_records_fail_closed_in_both_runtimes(self):
        fixture = copy.deepcopy(self.fixtures()[12])
        fixture["records"] = [{"unsafe_integer": 1.2e20}]
        fixture["value"]["records_sha256"] = (
            "sha256:0000000000000000000000000000000000000000000000000000000000000000")
        result = self.assert_parity(fixture)
        self.assertIn("noncanonical_record_number", result["error_codes"])

    def test_unicode_length_and_party_normalization_match(self):
        fixture = copy.deepcopy(self.fixtures()[4])
        fixture["value"]["public_note"] = "😀" * 600
        self.assertTrue(self.assert_parity(fixture)["schema_valid"])
        fixture["value"]["public_note"] += "😀"
        self.assertFalse(self.assert_parity(fixture)["schema_valid"])

        fixture = copy.deepcopy(self.fixtures()[6])
        duplicate = copy.deepcopy(fixture["value"]["party_tones"][0])
        duplicate["party"] = "Съюзыт".replace("ы", "и\u0306")
        fixture["value"]["party_tones"][0]["party"] = "Съюзйт"
        fixture["value"]["party_tones"].append(duplicate)
        self.assertIn("duplicate_party",
                      self.assert_parity(fixture)["error_codes"])

    def test_manifest_total_must_match_records(self):
        fixture = copy.deepcopy(self.fixtures()[12])
        fixture["value"]["records_sha256"] = contract_validate._sha256_json(
            fixture["records"])
        fixture["value"]["label_statistics"]["total_records"] = 2
        result = self.assert_parity(fixture)
        self.assertIn("statistics_mismatch", result["error_codes"])


if __name__ == "__main__":
    unittest.main()
