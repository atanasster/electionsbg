#!/usr/bin/env python3
"""Tests for the model triage annotation.

Both guarantees here are negative and both are load-bearing: the artifact must
be unusable as a human pass, and it must stay closed until pass B is sealed.
Either one failing quietly would leave a model's reading standing where a
human's is required.

Run:  python3 news/scripts/test_model_triage_annotation.py
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import model_triage_annotation as triage  # noqa: E402
import score_editorial_treatment_agreement as scoring  # noqa: E402


def label_chunks(directory: Path, sample: dict) -> str:
    ids = [row["assignment_id"] for row in sample["assignments"]]
    for index in range(0, len(ids), 10):
        chunk = {key: {"leaning": "neutral", "russia_stance": "not_applicable",
                       "party_tone": "neutral", "note": "n/a"}
                 for key in ids[index:index + 10]}
        (directory / f"labels-{index // 10 + 1}.json").write_text(
            json.dumps(chunk, ensure_ascii=False), encoding="utf-8")
    return str(directory / "labels-*.json")


class TriageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sample = json.loads(triage.SAMPLE.read_text(encoding="utf-8"))

    def test_the_artifact_is_refused_as_a_pass_on_two_independent_stamps(self):
        with tempfile.TemporaryDirectory() as tmp:
            doc = triage.build(label_chunks(Path(tmp), self.sample), "m", "t")
        self.assertEqual(doc["annotator_kind"], "model")
        self.assertEqual(doc["pass_id"], "TRIAGE")
        self.assertFalse(doc["is_kappa_denominator"])
        pass_a = json.loads(
            (triage.EVAL_DIR / "human-agreement-pass-a.template.json")
            .read_text(encoding="utf-8"))
        result = scoring.score(self.sample, pass_a, doc)
        self.assertEqual(result["status"], "invalid")
        self.assertTrue(any("pass B id mismatch" in e for e in result["errors"]))
        self.assertTrue(any("not a human annotation" in e
                            for e in result["errors"]))

    def test_relabelling_the_stamps_still_cannot_smuggle_it_in(self):
        """Mutation guard: even with both stamps forged, the row hash and the
        blinded pass order do not match a real pass B."""

        with tempfile.TemporaryDirectory() as tmp:
            doc = triage.build(label_chunks(Path(tmp), self.sample), "m", "t")
        doc["pass_id"] = "B"
        doc["annotator_kind"] = "human"
        doc["adjudicator"] = "Someone"
        doc["completed_at"] = "2026-09-09T09:00:00+00:00"
        pass_a = json.loads(
            (triage.EVAL_DIR / "human-agreement-pass-a.template.json")
            .read_text(encoding="utf-8"))
        result = scoring.score(self.sample, pass_a, doc)
        self.assertEqual(result["status"], "invalid")

    def test_report_is_withheld_until_pass_b_is_sealed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "triage.json"
            path.write_text(json.dumps(
                triage.build(label_chunks(root, self.sample), "m", "t")),
                encoding="utf-8")
            out = triage.report(path, root / "a.json", root / "b.json")
            self.assertEqual(out["status"], "withheld")
            self.assertIn("pass B", out["reason"])
            # and nothing about the labels leaks into the withheld payload
            self.assertNotIn("axes", out)
            for axis in scoring.AXES:
                self.assertNotIn(axis, json.dumps(out))

    def test_an_unfinalized_pass_b_does_not_count_as_sealed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "triage.json"
            path.write_text(json.dumps(
                triage.build(label_chunks(root, self.sample), "m", "t")),
                encoding="utf-8")
            half = json.loads(
                (triage.EVAL_DIR / "human-agreement-pass-b.template.json")
                .read_text(encoding="utf-8"))
            half["adjudicator"] = "Someone"          # named but not finalized
            (root / "b.json").write_text(json.dumps(half), encoding="utf-8")
            out = triage.report(path, root / "a.json", root / "b.json")
            self.assertEqual(out["status"], "withheld")

    def test_build_refuses_a_partial_or_mislabelled_set(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pattern = label_chunks(root, self.sample)
            (root / "labels-1.json").unlink()
            with self.assertRaises(SystemExit):
                triage.build(pattern, "m", "t")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pattern = label_chunks(root, self.sample)
            first = json.loads((root / "labels-1.json").read_text())
            key = next(iter(first))
            first[key]["party_tone"] = "mixed"       # removed in v2 (§3.3)
            (root / "labels-1.json").write_text(json.dumps(first))
            with self.assertRaises(SystemExit):
                triage.build(pattern, "m", "t")


if __name__ == "__main__":
    unittest.main(verbosity=2)
