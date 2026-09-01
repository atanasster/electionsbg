#!/usr/bin/env python3
"""Tests for the Tier 0 adjudication workspace.

The interesting assertions are all NEGATIVE. A tool that quietly leaked a v1
label, wrote a decision onto the frozen template, or mutated an immutable field
would still look like it worked — the pass would fill in, the page would render
and the kappa would come out a number. So the guarantees are pinned here rather
than trusted.

Run:  python3 news/scripts/test_adjudicate_editorial_treatment.py
"""

import ast
import copy
import io
import json
import sys
import tempfile
import tokenize
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import adjudicate_editorial_treatment as tool  # noqa: E402
import score_editorial_treatment_agreement as scoring  # noqa: E402



def executable_source(path: Path) -> str:
    """Source with comments and docstrings removed.

    ⚠️ A leak gate that greps the raw file is testing PROSE, not behaviour —
    this module's own docstring names `clean-amplification` in order to say it
    is never read, and the first cut of the gate failed on that sentence. The
    repo has been burned twice by the same shape (see CLAUDE.md on
    `scripts/lib/strip_comments.ts`), in both directions: a naive strip that
    removes too much makes the gate vacuous instead of noisy.

    String LITERALS are kept deliberately. `PAGE` is a literal and it is served
    to the browser, so anything embedded there is reachable and must be scanned.
    """

    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source)
    doc_lines: set[int] = set()
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef,
                                 ast.AsyncFunctionDef)):
            continue
        body = getattr(node, "body", None)
        if not body:
            continue
        first = body[0]
        if (isinstance(first, ast.Expr)
                and isinstance(first.value, ast.Constant)
                and isinstance(first.value.value, str)):
            doc_lines.update(range(first.lineno, (first.end_lineno or first.lineno) + 1))
    kept = []
    for token in tokenize.generate_tokens(io.StringIO(source).readline):
        if token.type == tokenize.COMMENT:
            continue
        if token.start[0] in doc_lines:
            continue
        kept.append(token.string)
    return "\n".join(kept)


class WorkspaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.template = json.loads(
            tool.TEMPLATES["A"].read_text(encoding="utf-8"))
        cls.assignments = json.loads(
            scoring.DEFAULT_SAMPLE.read_text(encoding="utf-8"))

    def test_refuses_to_write_inside_the_frozen_eval_directory(self):
        target = tool.EVAL_DIR / "human-agreement-pass-a.template.json"
        argv = ["--pass", "A", "--work", str(target)]
        saved = sys.argv
        try:
            sys.argv = ["adjudicate"] + argv
            with self.assertRaises(SystemExit) as caught:
                tool.main()
            self.assertIn("refusing to write inside", str(caught.exception))
        finally:
            sys.argv = saved

    def test_checked_in_templates_stay_pending(self):
        for pass_id, path in tool.TEMPLATES.items():
            doc = json.loads(path.read_text(encoding="utf-8"))
            self.assertIsNone(doc["adjudicator"], pass_id)
            self.assertIsNone(doc["completed_at"], pass_id)
            self.assertTrue(all(row["decision"] is None for row in doc["rows"]),
                            pass_id)

    def test_opening_a_pass_never_carries_a_decision_over(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp) / "pass-a.json"
            doc = tool.open_work("A", work, "Tester")
            self.assertTrue(all(row["decision"] is None for row in doc["rows"]))
            self.assertEqual(doc["adjudicator"], "Tester")

    def test_opening_the_wrong_pass_file_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp) / "pass-a.json"
            tool.atomic_write_json(
                work, json.loads(tool.TEMPLATES["B"].read_text(encoding="utf-8")))
            with self.assertRaises(SystemExit):
                tool.open_work("A", work, None)

    def test_article_view_carries_no_source_and_no_v1_label(self):
        """load_article is the ONLY thing the page sees before a reveal."""

        row = self.template["rows"][0]
        view = tool.load_article(row)
        self.assertEqual(set(view) - {"missing", "hash_ok"},
                         {"title", "content", "description", "chars"})
        for leaked in ("domain", "url", "canonical", "site_name",
                       "leaning", "russia_stance", "party_tones", "analysis"):
            self.assertNotIn(leaked, view)

    def test_no_v1_analysis_or_stratum_path_is_reachable_from_the_tool(self):
        source = executable_source(HERE / "adjudicate_editorial_treatment.py")
        for forbidden in ("data/analysis", "clean-amplification",
                          "baseline-2026", "party-identity-review",
                          "party_tones", "russia_stance\", \"leaning"):
            self.assertNotIn(forbidden, source)

    def test_the_leak_gate_still_discriminates(self):
        """Mutation guard on the stripper: if it removed too much, the gate
        above would pass on a tool that genuinely read the v1 analyses."""

        source = executable_source(HERE / "adjudicate_editorial_treatment.py")
        self.assertIn("article_sha256", source)
        self.assertIn("PAGE", source)
        self.assertIn("Reveal source", source)  # a literal inside PAGE
        self.assertNotIn("never shows a v1 label", source)  # docstring prose

    def test_article_hash_mismatch_is_surfaced_not_swallowed(self):
        row = dict(self.template["rows"][0], article_sha256="0" * 64)
        self.assertFalse(tool.load_article(row)["hash_ok"])

    def test_a_completed_workspace_pass_scores_without_further_editing(self):
        """End to end: fill both passes the way the server does, seal with the
        same canonical hash, and hand them straight to the scorer."""

        left = copy.deepcopy(self.template)
        right = json.loads(tool.TEMPLATES["B"].read_text(encoding="utf-8"))
        by_id = {}
        for index, assignment in enumerate(self.assignments["assignments"]):
            by_id[assignment["assignment_id"]] = {
                "leaning": scoring.AXES["leaning"]["scale"][index % 5],
                "russia_stance": (
                    "not_applicable" if index % 4 else
                    scoring.AXES["russia_stance"]["scale"][index % 5]),
                "party_tone": scoring.AXES["party_tone"]["scale"][index % 5],
            }
        for doc, name in ((left, "Human A"), (right, "Human B")):
            for row in doc["rows"]:
                row["decision"] = copy.deepcopy(by_id[row["assignment_id"]])
            doc["adjudicator"] = name
            doc["completed_at"] = "2026-09-01T09:00:00+00:00"
            doc["rows_sha256"] = scoring.canonical_sha(doc["rows"])
        result = scoring.score(self.assignments, left, right, min_n=0)
        self.assertEqual(result["errors"], [])
        self.assertEqual(result["status"], "passed")

    def test_an_immutable_field_written_by_the_tool_would_be_caught(self):
        left = copy.deepcopy(self.template)
        right = json.loads(tool.TEMPLATES["B"].read_text(encoding="utf-8"))
        for doc, name in ((left, "Human A"), (right, "Human B")):
            for row in doc["rows"]:
                row["decision"] = {"leaning": "neutral",
                                   "russia_stance": "not_applicable",
                                   "party_tone": "neutral"}
            doc["adjudicator"] = name
            doc["completed_at"] = "2026-09-01T09:00:00+00:00"
        left["rows"][3]["party_surface"] = "ГЕРБ"
        for doc in (left, right):
            doc["rows_sha256"] = scoring.canonical_sha(doc["rows"])
        result = scoring.score(self.assignments, left, right)
        self.assertEqual(result["status"], "invalid")
        self.assertTrue(any("immutable party_surface" in e
                            for e in result["errors"]))

    def test_every_axis_option_has_a_distinct_keyboard_key(self):
        """'0' was on both scalar axes and the handler resolved leaning first,
        so russia's not_applicable was unreachable — silently, because the
        mouse still worked."""

        source = (HERE / "adjudicate_editorial_treatment.py").read_text(
            encoding="utf-8")
        block = source.split("const KEYS={", 1)[1].split("};", 1)[0]
        keys = [part.strip().strip("'")
                for part in block.replace("\n", "").split("[")[1:]]
        flat = []
        for group in keys:
            flat += [k.strip().strip("'") for k in
                     group.split("]")[0].split(",")]
        self.assertEqual(len(flat), len(set(flat)), f"duplicate keys: {flat}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
