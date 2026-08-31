#!/usr/bin/env python3
"""Cross-language canonical JSON and evaluation hash vectors."""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CONTRACT_DIR = ROOT / "news" / "eval_contract"
sys.path.insert(0, str(CONTRACT_DIR))
from canonical import (  # noqa: E402
    analysis_sha256,
    canonical_json,
    canonical_sha256,
    content_sha256,
)


class CanonicalVectors(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.vectors = json.loads(
            (CONTRACT_DIR / "canonical_vectors.json").read_text(encoding="utf-8"))

    def typescript_process(self, op, value):
        completed = subprocess.run(
            ["node", "--import", "tsx",
             str(CONTRACT_DIR / "canonical_cli.ts")],
            cwd=ROOT, check=False, capture_output=True, text=True,
            input=json.dumps({"op": op, "value": value}, ensure_ascii=True),
        )
        return completed, json.loads(completed.stdout)

    def typescript(self, op, value, *, expect_error=False):
        completed, response = self.typescript_process(op, value)
        self.assertEqual(2 if expect_error else 0, completed.returncode)
        return response

    def test_canonical_json_and_hash_vectors_match_both_runtimes(self):
        for vector in self.vectors["json"]:
            with self.subTest(vector=vector["id"]):
                self.assertEqual(vector["canonical"],
                                 canonical_json(vector["value"]))
                self.assertEqual(vector["sha256"],
                                 canonical_sha256(vector["value"]))
                self.assertEqual({"result": vector["canonical"]},
                                 self.typescript("canonical", vector["value"]))
                self.assertEqual({"result": vector["sha256"]},
                                 self.typescript("canonical_sha256",
                                                 vector["value"]))

    def test_noncanonical_numbers_fail_closed_in_both_runtimes(self):
        for vector in self.vectors["errors"]:
            with self.subTest(vector=vector["id"]):
                with self.assertRaisesRegex(ValueError, vector["error"]):
                    canonical_json(vector["value"])
                self.assertEqual({"error": vector["error"]},
                                 self.typescript("canonical", vector["value"],
                                                 expect_error=True))

    def test_unpaired_surrogates_in_object_keys_fail_closed(self):
        value = {"\ud800": 1}
        with self.assertRaisesRegex(ValueError,
                                    "string contains an unpaired surrogate"):
            canonical_json(value)
        self.assertEqual(
            {"error": "string contains an unpaired surrogate"},
            self.typescript("canonical", value, expect_error=True),
        )

    def test_content_hash_is_exact_and_cross_language(self):
        for vector in self.vectors["content"]:
            with self.subTest(vector=vector["id"]):
                self.assertEqual(vector["sha256"], content_sha256(vector["value"]))
                self.assertEqual({"result": vector["sha256"]},
                                 self.typescript("content_sha256", vector["value"]))
        self.assertNotEqual(content_sha256("Ред\n"), content_sha256("Ред\r\n"))

    def test_content_hash_rejects_unpaired_surrogates(self):
        for vector in self.vectors["content_errors"]:
            with self.subTest(vector=vector["id"]):
                with self.assertRaisesRegex(ValueError, vector["error"]):
                    content_sha256(vector["value"])
                self.assertEqual(
                    {"error": vector["error"]},
                    self.typescript("content_sha256", vector["value"],
                                    expect_error=True),
                )

    def test_analysis_hash_matches_committed_vectors(self):
        for vector in self.vectors["analysis"]:
            with self.subTest(vector=vector["id"]):
                self.assertEqual(vector["sha256"],
                                 analysis_sha256(vector["value"]))
                self.assertEqual(
                    {"result": vector["sha256"]},
                    self.typescript("analysis_sha256", vector["value"]),
                )

    def test_operator_cli_rejects_unknown_operations_and_bad_json(self):
        completed, response = self.typescript_process("canonical_hash", {})
        self.assertEqual(2, completed.returncode)
        self.assertEqual({"error": "unsupported operation: canonical_hash"},
                         response)
        completed = subprocess.run(
            ["node", "--import", "tsx",
             str(CONTRACT_DIR / "canonical_cli.ts")],
            cwd=ROOT, check=False, capture_output=True, text=True,
            input="{not-json",
        )
        self.assertEqual(2, completed.returncode)
        self.assertEqual("error", next(iter(json.loads(completed.stdout))))


if __name__ == "__main__":
    unittest.main()
