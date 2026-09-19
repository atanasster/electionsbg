#!/usr/bin/env python3
"""diagnose_yield.py and the client routing it relies on (no network).

Run:  python3 news/scripts/test_diagnose_yield.py
"""

import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import diagnose_yield as dy  # noqa: E402
import llm_client  # noqa: E402

OR_URL = "https://openrouter.ai/api/v1/chat/completions"


class Classify(unittest.TestCase):
    def test_classes(self):
        self.assertEqual(dy.classify('{"a": 1}', "stop"), "ok")
        self.assertEqual(dy.classify('```json\n{"a": 1}\n```', "stop"), "ok")
        self.assertEqual(dy.classify('{"a": "cut', "length"), "truncated")
        self.assertEqual(dy.classify('{"a": 1} {"b": 2}', "stop"),
                         "trailing_data")
        # The 2026-09-02 shape: a quote inside an evidence string closes it
        # early and the parser resumes on a letter.
        self.assertEqual(
            dy.classify('{"evidence": "каза "не" на", "x": 1}', "stop"),
            "unescaped_quote")
        self.assertEqual(dy.classify("", "stop"), "empty")
        self.assertEqual(dy.classify("{,}", "stop"), "other_json_error")

    def test_bulgarian_quote_closed_with_ascii(self):
        # Verbatim shapes from the 2026-09-19 NextBit answers.
        for text in ('{"s": "без явен автор освен „Frognews"", "x": 1}',
                     '{"s": ["грешки („стиснт", „рзмер")"]}',
                     '{"s": "за „скалъпена присъда" и още"}'):
            with self.subTest(text=text):
                self.assertEqual(dy.classify(text, "stop"),
                                 "bg_quote_closed_ascii")

    def test_a_missing_comma_is_not_an_unescaped_quote(self):
        self.assertEqual(dy.classify('{"a": 1 "b": 2}', "stop"),
                         "other_json_error")
        self.assertEqual(dy.classify('{"a": "x" "b": 2}', "stop"),
                         "other_json_error")

    def test_every_class_emitted_is_documented(self):
        for klass in ("ok", "truncated", "trailing_data", "unescaped_quote",
                      "bg_quote_closed_ascii",
                      "empty", "other_json_error", "shape_error", "unpinned",
                      "llm_error", "harness_error"):
            self.assertIn(klass, dy.CLASSES)


class Summary(unittest.TestCase):
    def test_summary_per_provider(self):
        rows = [
            {"provider_requested": "A", "class": "ok", "latency_s": 0.0,
             "cost": 0.001, "provider_served": "A"},
            {"provider_requested": "A", "class": "unescaped_quote",
             "latency_s": 20, "cost": 0.001, "provider_served": "A"},
            {"provider_requested": "B", "class": "llm_error",
             "error_elapsed_s": 60},
            {"provider_requested": "B", "class": "harness_error"},
        ]
        out = dy.summarise(rows)
        self.assertEqual(out["A"]["accept_rate"], 0.5)
        self.assertEqual(out["A"]["classes"], {"ok": 1, "unescaped_quote": 1})
        self.assertEqual(out["A"]["cost_usd"], 0.002)
        self.assertEqual(out["A"]["latency_p50_s"], 0.0)  # zero is a latency
        self.assertEqual(out["B"]["answered"], 0)
        self.assertIsNone(out["B"]["accept_rate"])

    def test_percentile(self):
        self.assertIsNone(dy.percentile([], 0.5))
        self.assertEqual(dy.percentile([1, 2, 3, 4, 5], 0.5), 3)
        self.assertEqual(dy.percentile([1, 2, 3, 4, 5], 0.9), 5)


class Routing(unittest.TestCase):
    def test_a_route_layers_over_the_defaults(self):
        with mock.patch.dict(os.environ, {"NEWS_LLM_URL": OR_URL,
                                          "NEWS_LLM_ALLOW_REMOTE": "1"}):
            _, body, meta = llm_client.prepare_request(
                "s", "u", model="m", json_schema={"type": "object"},
                provider={"order": ["P"], "allow_fallbacks": False})
        routing = json.loads(body)["provider"]
        self.assertEqual(routing, {"require_parameters": True,
                                   "order": ["P"], "allow_fallbacks": False})
        self.assertEqual(meta["provider_routing"], routing)

    def test_no_route_leaves_the_request_unchanged(self):
        with mock.patch.dict(os.environ, {"NEWS_LLM_URL": OR_URL,
                                          "NEWS_LLM_ALLOW_REMOTE": "1"}):
            _, body, _ = llm_client.prepare_request(
                "s", "u", model="m", json_schema={"type": "object"})
        self.assertEqual(json.loads(body)["provider"],
                         {"require_parameters": True})

    def test_a_route_to_a_non_openrouter_target_is_refused(self):
        with mock.patch.dict(os.environ, {
                "NEWS_LLM_URL": "http://127.0.0.1:8080/v1/chat/completions"}):
            with self.assertRaises(llm_client.LlmError) as ctx:
                llm_client.prepare_request("s", "u", model="m",
                                           provider={"order": ["P"]})
        self.assertEqual(ctx.exception.kind, "routing_unsupported")

    def test_complete_surfaces_finish_reason(self):
        doc = {"choices": [{"message": {"content": "{}"},
                            "finish_reason": "length"}], "usage": {}}

        class Resp:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def read(self, *_):
                return json.dumps(doc).encode("utf-8")
        with mock.patch.dict(os.environ, {
                "NEWS_LLM_URL": "http://127.0.0.1:9/v1/chat/completions",
                "NEWS_PERF_LOG": "0"}), mock.patch.object(
                llm_client.urllib.request, "urlopen",
                lambda req, timeout=None: Resp()):
            answer = llm_client.complete("s", "u", model="m")
        self.assertEqual(answer["finish_reason"], "length")


class EndToEnd(unittest.TestCase):
    def setUp(self):
        self.out = Path(tempfile.mkdtemp(prefix="diag_"))
        self.addCleanup(shutil.rmtree, self.out, True)

    def run_main(self, complete, served=None):
        items = [{"path": "news/data/a.bg/x.json"},
                 {"path": "news/data/b.bg/x.json"}]
        article = {"title": "t", "content": "c"}
        assets = {"system": "s", "grammar": None,
                  "json_schema": {"type": "object"},
                  "taxonomy": json.dumps({"version": 1})}
        with mock.patch.dict(os.environ, {"NEWS_LLM_URL": OR_URL}), \
                mock.patch.object(dy.analyze_local, "run_analyze",
                                  return_value=(1, {"queue": items,
                                                    "missing": ["gone.json"]})), \
                mock.patch.object(dy.analyze_local, "load_prompt_assets",
                                  return_value=assets), \
                mock.patch.object(dy.analyze_local, "build_user_prompt",
                                  return_value="p"), \
                mock.patch.object(dy.analyze_local, "record_from",
                                  return_value={}), \
                mock.patch.object(dy.Path, "read_text",
                                  return_value=json.dumps(article)), \
                mock.patch.object(dy.llm_client, "complete", complete), \
                mock.patch("builtins.print"):
            code = dy.main(["--paths", "x", "--providers", "P,Q",
                            "--out-dir", str(self.out), "--workers", "2"])
        result = json.loads(next(self.out.glob("*/result.json"))
                            .read_text(encoding="utf-8"))
        return code, result

    def test_a_partial_queue_still_runs_and_names_distinct_raw_files(self):
        def complete(*a, provider, **k):
            return {"text": '{"ok": 1}', "provider": provider["order"][0],
                    "finish_reason": "stop", "transport_elapsed_s": 1.0,
                    "usage": {"cost": 0.001}}
        code, result = self.run_main(complete)
        self.assertEqual(code, 0)
        self.assertEqual(result["missing"], ["gone.json"])
        self.assertEqual(len(result["rows"]), 4)
        self.assertEqual({r["class"] for r in result["rows"]}, {"ok"})
        raw = {r["raw_file"] for r in result["rows"]}
        self.assertEqual(len(raw), 4)  # same stem, two outlets: no overwrite

    def test_an_unpinned_answer_and_a_harness_failure_are_kept_as_rows(self):
        def complete(*a, provider, **k):
            if provider["order"][0] == "Q":
                raise RuntimeError("disk full")
            return {"text": "{}", "provider": "SomebodyElse",
                    "finish_reason": "stop", "usage": {}}
        code, result = self.run_main(complete)
        self.assertEqual(code, 0)
        classes = sorted(r["class"] for r in result["rows"])
        self.assertEqual(classes, ["harness_error", "harness_error",
                                   "unpinned", "unpinned"])

    def test_refuses_a_non_openrouter_endpoint(self):
        with mock.patch.dict(os.environ, {"NEWS_LLM_URL": ""}), \
                mock.patch("builtins.print"):
            self.assertEqual(dy.main(["--paths", "x", "--providers", "P"]), 2)

    def test_a_report_without_an_analyze_stage_is_an_error_not_a_crash(self):
        report = self.out / "r.json"
        report.write_text(json.dumps({"stages": []}), encoding="utf-8")
        with mock.patch.dict(os.environ, {"NEWS_LLM_URL": OR_URL}), \
                mock.patch("builtins.print"):
            self.assertEqual(dy.main(["--report", str(report),
                                      "--providers", "P"]), 2)


if __name__ == "__main__":
    unittest.main()
