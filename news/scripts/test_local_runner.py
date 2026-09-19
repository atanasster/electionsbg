#!/usr/bin/env python3
"""Tests for the standalone runner: build_prompts, llm_client, analyze_local.

⚠️ This is the code that runs on a Mac mini at 03:00 with nobody watching, so
every test here is about a failure being VISIBLE rather than quiet.

Run:  python3 news/scripts/test_local_runner.py
"""

import http.client
import json
import os
import subprocess
import tempfile
import time
import urllib.error
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import analyze_articles as aa  # noqa: E402
import analyze_local  # noqa: E402
import build_prompts  # noqa: E402
import llm_client  # noqa: E402
import test_analyze_articles as article_fixtures  # noqa: E402

SCRIPTS = Path(__file__).resolve().parent
PROMPTS = SCRIPTS.parent / "prompts"


class TheGrammar(unittest.TestCase):
    """⚠️ Worth more than the choice of model: analyze_articles.py rejects a
    WHOLE record on any schema or taxonomy violation."""

    @classmethod
    def setUpClass(cls):
        cls.doc = json.loads((SCRIPTS.parent / "topics.json")
                             .read_text(encoding="utf-8"))
        cls.text = build_prompts.build_grammar(cls.doc)

    def test_every_enum_mirrors_the_validators(self):
        # ⚠️ A grammar that permits a label the validator rejects produces
        # records that are grammatically perfect and refused 100% of the
        # time — which reads as a model problem and is not one.
        for values in (aa.QUALITY_VERDICTS, aa.LEANING_LABELS,
                       aa.RUSSIA_LABELS, aa.AI_VERDICTS, aa.TONE_LABELS):
            for value in values:
                with self.subTest(value=value):
                    self.assertIn(f'"\\"{value}\\""', self.text)

    def test_it_permits_no_label_the_validator_would_refuse(self):
        # The converse, and the one that actually bites: an extra literal in
        # the grammar is a token the model can sample and we must then reject.
        import re
        known = (set(aa.QUALITY_VERDICTS) | set(aa.LEANING_LABELS)
                 | set(aa.RUSSIA_LABELS) | set(aa.AI_VERDICTS)
                 | set(aa.TONE_LABELS)
                 | {c["id"] for c in self.doc["categories"]}
                 | {s["id"] for c in self.doc["categories"]
                    for s in c.get("subcategories") or []})
        # ⚠️ Scoped to the ENUM rules. A grammar is full of JSON KEY literals
        # („quality", „notes", „summary_bg"), and a sweep over every literal
        # in the file reports each of them as an unknown label — a failure
        # that says nothing and trains the reader to ignore this test.
        enum_rules = ("qverdict", "lean_lab", "ru_lab", "ai_lab", "tone_lab",
                      "cat", "sub")
        checked = 0
        for line in self.text.splitlines():
            if line.startswith("#") or "::=" not in line:
                continue
            rule = line.split("::=")[0].strip()
            if rule not in enum_rules:
                continue
            for lit in re.findall(r'"\\"([a-z0-9_-]+)\\""', line):
                checked += 1
                self.assertIn(lit, known, f"{lit!r} is in the grammar and in "
                                          "no validator")
        # Non-vacuous: a renamed rule would otherwise make this assert nothing.
        self.assertGreater(checked, 100, "the enum sweep found almost nothing "
                                         "— have the rule names changed?")

    def test_every_taxonomy_category_is_reachable(self):
        for c in self.doc["categories"]:
            self.assertIn(f'"\\"{c["id"]}\\""', self.text)

    def test_the_probability_rule_bounds_the_range(self):
        # ⚠️ Written as a free float a model emits `85`, `1.5` and `-0`, every
        # one of which the validator rejects for being outside [0,1].
        self.assertIn('prob        ::= "0" | "1" | "0." [0-9]+ | "1.0"',
                      self.text)

    def test_it_says_what_it_CANNOT_express(self):
        # The category/subcategory PAIRING is not expressible in GBNF. Stating
        # that beats a reader assuming the grammar guarantees a valid pair.
        self.assertIn("NOT expressible in GBNF", self.text)


class TheCompactTaxonomy(unittest.TestCase):
    def test_it_drops_the_keyword_hints(self):
        # ⚠️ Keywords exist to help a human skim, and a model given keywords
        # starts keyword-matching — which is what the rubric forbids.
        doc = {"version": 1, "categories": [
            {"id": "x", "label": {"bg": "Х", "en": "X"},
             "keywords": ["протест", "граждани"],
             "subcategories": [{"id": "y", "label": {"bg": "Y", "en": "Y"},
                                "keywords": ["z"]}]}]}
        out = build_prompts.compact_taxonomy(doc)
        self.assertEqual(out, [{"id": "x", "label": "Х", "subcategories": ["y"]}])
        self.assertNotIn("протест", json.dumps(out, ensure_ascii=False))

    def test_it_is_much_smaller_than_the_source(self):
        doc = json.loads((SCRIPTS.parent / "topics.json").read_text(
            encoding="utf-8"))
        full = len(json.dumps(doc, ensure_ascii=False))
        small = len(json.dumps(build_prompts.compact_taxonomy(doc),
                               ensure_ascii=False))
        # Measured 23,032 → 3,190 chars. At a 12B's context that difference is
        # most of the budget the article itself needs.
        self.assertLess(small, full * 0.3)


class GeneratedAssetsAreInStep(unittest.TestCase):
    def test_the_committed_assets_are_not_stale(self):
        # ⚠️ --check exits 1 on drift so a gate fails rather than a human
        # noticing. A generated file edited by hand is how a grammar comes to
        # permit a label the validator rejects.
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / "build_prompts.py"), "--check"],
            capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0,
                         f"stale: {proc.stdout} — run build_prompts.py")


    def test_check_FAILS_when_an_asset_has_drifted(self):
        # ⚠️ Asserting the happy path only lets `--check` be changed to
        # `return 0` with the suite green — and the whole point of --check is
        # to fail. A hand-edited grammar is how it comes to permit a label
        # the validator rejects.
        import shutil
        import tempfile
        root = Path(tempfile.mkdtemp())
        (root / "news").mkdir()
        shutil.copy(SCRIPTS.parent / "topics.json", root / "news" / "topics.json")
        shutil.copytree(PROMPTS, root / "news" / "prompts")
        env = {**os.environ, "DATA_BG_ROOT": str(root)}

        clean = subprocess.run(
            [sys.executable, str(SCRIPTS / "build_prompts.py"), "--check"],
            capture_output=True, text=True, env=env)
        self.assertEqual(clean.returncode, 0, clean.stdout)

        # A hand edit: one extra label the validator knows nothing about.
        grammar = root / "news" / "prompts" / "analyze_schema.gbnf"
        grammar.write_text(
            grammar.read_text(encoding="utf-8").replace(
                'ai_lab      ::= ', 'ai_lab      ::= "\\"definitely_ai\\"" | '),
            encoding="utf-8")
        drifted = subprocess.run(
            [sys.executable, str(SCRIPTS / "build_prompts.py"), "--check"],
            capture_output=True, text=True, env=env)
        self.assertEqual(drifted.returncode, 1, drifted.stdout)
        self.assertIn("analyze_schema.gbnf",
                      json.loads(drifted.stdout)["stale"])

    def test_check_writes_NOTHING(self):
        # A --check that repaired the file would report clean for ever.
        import shutil
        import tempfile
        root = Path(tempfile.mkdtemp())
        (root / "news").mkdir()
        shutil.copy(SCRIPTS.parent / "topics.json", root / "news" / "topics.json")
        shutil.copytree(PROMPTS, root / "news" / "prompts")
        grammar = root / "news" / "prompts" / "analyze_schema.gbnf"
        grammar.write_text("hand edited", encoding="utf-8")
        subprocess.run([sys.executable, str(SCRIPTS / "build_prompts.py"),
                        "--check"], capture_output=True, text=True,
                       env={**os.environ, "DATA_BG_ROOT": str(root)})
        self.assertEqual(grammar.read_text(encoding="utf-8"), "hand edited")


class TheClient(unittest.TestCase):
    """⚠️ This client posts the FULL TEXT of every article we hold."""

    def test_a_remote_url_is_REFUSED_by_default(self):
        with mock.patch.dict(os.environ,
                             {"NEWS_LLM_URL": "https://api.example.com/v1/chat/completions"},
                             clear=False):
            os.environ.pop("NEWS_LLM_ALLOW_REMOTE", None)
            with self.assertRaises(llm_client.LlmError) as ctx:
                llm_client.endpoint()
            self.assertEqual(ctx.exception.kind, "remote_refused")

    def test_a_remote_url_is_allowed_only_DELIBERATELY(self):
        with mock.patch.dict(os.environ, {
                "NEWS_LLM_URL": "https://api.example.com/v1/chat/completions",
                "NEWS_LLM_ALLOW_REMOTE": "1"}, clear=False):
            self.assertTrue(llm_client.endpoint().startswith("https://"))

    def test_openrouter_key_is_sent_only_to_openrouter(self):
        with mock.patch.dict(os.environ,
                             {"OPENROUTER_API_KEY": "secret"}, clear=False):
            got = llm_client.request_headers(
                "https://openrouter.ai/api/v1/chat/completions")
            self.assertEqual(got["Authorization"], "Bearer secret")
            other = llm_client.request_headers(
                "https://api.example.com/v1/chat/completions")
            self.assertNotIn("Authorization", other)

    def test_generic_hosted_key_is_explicit(self):
        with mock.patch.dict(os.environ,
                             {"NEWS_LLM_API_KEY": "generic"}, clear=False):
            got = llm_client.request_headers(
                "https://api.example.com/v1/chat/completions")
            self.assertEqual(got["Authorization"], "Bearer generic")

    def test_openrouter_requires_schema_support_and_disables_reasoning(self):
        import io
        seen = {}

        class Resp(io.BytesIO):
            def __enter__(self_): return self_
            def __exit__(self_, *args): return False

        def fake(req, timeout=None):
            seen["body"] = json.loads(req.data.decode("utf-8"))
            return Resp(json.dumps({
                "choices": [{"message": {"content": "{}"}}]
            }).encode("utf-8"))

        with mock.patch.dict(os.environ,
                             {"NEWS_LLM_ALLOW_REMOTE": "1"}, clear=False), \
                mock.patch.object(llm_client.urllib.request, "urlopen", fake):
            llm_client.complete(
                "s", "u", model="m",
                json_schema={"type": "object"},
                url="https://openrouter.ai/api/v1/chat/completions")
        self.assertEqual(seen["body"]["provider"],
                         {"require_parameters": True})
        self.assertEqual(seen["body"]["reasoning"],
                         {"effort": "none", "exclude": True})

    def test_response_identity_and_provider_are_returned_for_provenance(self):
        import io

        class Resp(io.BytesIO):
            def __enter__(self_): return self_
            def __exit__(self_, *args): return False

        doc = {"id": "gen-123", "model": "served-model", "provider": "fast",
               "choices": [{"message": {"content": "{}"}}],
               "usage": {"prompt_tokens": 10, "completion_tokens": 2}}
        with mock.patch.object(llm_client.urllib.request, "urlopen",
                               lambda req, timeout=None: Resp(
                                   json.dumps(doc).encode("utf-8"))):
            got = llm_client.complete("s", "u", model="requested")
        self.assertEqual(got["response_id"], "gen-123")
        self.assertEqual(got["provider"], "fast")
        self.assertEqual(got["request"]["max_tokens"], 2048)
        self.assertTrue(got["request"]["body_sha256"].startswith("sha256:"))
        self.assertGreaterEqual(got["transport_elapsed_s"],
                                got["attempt_elapsed_s"])

    def test_request_fingerprint_changes_with_reasoning_and_token_budget(self):
        import io

        class Resp(io.BytesIO):
            def __enter__(self_): return self_
            def __exit__(self_, *args): return False

        def fake(req, timeout=None):
            return Resp(json.dumps({
                "choices": [{"message": {"content": "{}"}}]
            }).encode("utf-8"))

        hashes = []
        for effort, tokens in (("none", 512), ("low", 512), ("low", 4096)):
            with mock.patch.dict(os.environ, {
                    "NEWS_LLM_ALLOW_REMOTE": "1",
                    "NEWS_LLM_REASONING_EFFORT": effort}, clear=False), \
                    mock.patch.object(llm_client.urllib.request, "urlopen", fake):
                got = llm_client.complete(
                    "s", "u", model="m", max_tokens=tokens,
                    json_schema={"type": "object"},
                    url="https://openrouter.ai/api/v1/chat/completions")
            hashes.append(got["request"]["body_sha256"])
        self.assertEqual(len(set(hashes)), 3)

    def test_every_localhost_spelling_is_accepted(self):
        for host in ("127.0.0.1", "localhost", "0.0.0.0"):
            with self.subTest(host=host):
                with mock.patch.dict(os.environ,
                                     {"NEWS_LLM_URL": f"http://{host}:8080/v1/chat/completions"},
                                     clear=False):
                    os.environ.pop("NEWS_LLM_ALLOW_REMOTE", None)
                    self.assertIn(host, llm_client.endpoint())

    def test_a_bad_answer_is_NOT_retried(self):
        # ⚠️ Retries are for TRANSPORT. A model that produced an invalid
        # record will produce it again; re-asking burns the budget and the
        # validator's rejection is the useful signal.
        #
        # ⚠️ Asserting frozenset MEMBERSHIP proves nothing about the code
        # that reads it — this now drives complete() and counts the calls.
        calls = []

        def fake_urlopen(req, timeout=None):
            calls.append(req.full_url)
            raise urllib.error.HTTPError(req.full_url, 400, "bad", {}, None)

        with mock.patch.object(llm_client.urllib.request, "urlopen",
                               fake_urlopen):
            with self.assertRaises(llm_client.LlmError) as ctx:
                llm_client.complete("s", "u", model="m")
        self.assertEqual(ctx.exception.kind, "http_400")
        self.assertEqual(len(calls), 1, "a 400 must not be retried")

    def test_a_5xx_IS_retried(self):
        calls = []

        def fake_urlopen(req, timeout=None):
            calls.append(1)
            raise urllib.error.HTTPError(req.full_url, 503, "busy", {}, None)

        with mock.patch.object(llm_client.urllib.request, "urlopen",
                               fake_urlopen), \
                mock.patch.object(llm_client.time, "sleep", lambda _: None):
            with self.assertRaises(llm_client.LlmError):
                llm_client.complete("s", "u", model="m")
        self.assertEqual(len(calls), llm_client.MAX_ATTEMPTS)

    def test_free_triage_can_limit_transport_to_one_attempt(self):
        calls = []

        def fake_urlopen(req, timeout=None):
            calls.append(1)
            raise urllib.error.HTTPError(req.full_url, 503, "busy", {}, None)

        with mock.patch.object(llm_client.urllib.request, "urlopen",
                               fake_urlopen), \
                mock.patch.object(llm_client.time, "sleep", lambda _: None):
            with self.assertRaises(llm_client.LlmError):
                llm_client.complete("s", "u", model="m", max_attempts=1)
        self.assertEqual(calls, [1])

    def test_a_MID_RESPONSE_disconnect_is_an_LlmError(self):
        # ⚠️ The likeliest failure on a 16 GB Mac mini: the server is
        # OOM-killed part-way through generating. IncompleteRead is neither
        # an OSError nor a URLError, so without its own arm it escapes the
        # caller's `except LlmError` and discards the whole batch with a
        # traceback instead of a report line.
        def fake_urlopen(req, timeout=None):
            raise http.client.IncompleteRead(b"partial")

        with mock.patch.object(llm_client.urllib.request, "urlopen",
                               fake_urlopen), \
                mock.patch.object(llm_client.time, "sleep", lambda _: None):
            with self.assertRaises(llm_client.LlmError) as ctx:
                llm_client.complete("s", "u", model="m")
        self.assertEqual(ctx.exception.kind, "disconnected")

    def test_the_url_ARGUMENT_cannot_bypass_the_localhost_check(self):
        # ⚠️ `url or endpoint()` let a caller pass a remote address directly,
        # bypassing the whole protection on a client that posts the full text
        # of every article we hold.
        with self.assertRaises(llm_client.LlmError) as ctx:
            llm_client.complete("s", "u", model="m",
                                url="https://api.example.com/v1/chat/completions")
        self.assertEqual(ctx.exception.kind, "remote_refused")
        # ⚠️ Asserting `ok is False` cannot tell a REFUSAL from a network
        # failure — with the guard bypassed, probe would simply fail to reach
        # api.example.com and report ok:False either way, having already sent
        # a request off the machine. The reason is what discriminates.
        got = llm_client.probe("https://api.example.com/v1/chat/completions")
        self.assertFalse(got["ok"])
        self.assertIn("not localhost", got["error"])

    def test_the_probe_reports_rather_than_raising(self):
        # It runs BEFORE an hour of harvesting; it must answer, not explode.
        got = llm_client.probe("http://127.0.0.1:9/v1/chat/completions",
                               timeout=1)
        self.assertFalse(got["ok"])
        self.assertIn("error", got)

    OR_ENV = {"NEWS_LLM_URL": "https://openrouter.ai/api/v1/chat/completions",
              "NEWS_LLM_ALLOW_REMOTE": "1", "NEWS_LLM_MODEL": "z-ai/glm-x",
              "OPENROUTER_API_KEY": "sk-test"}

    def _fake_urlopen(self, payload, seen):
        class Resp:
            def __enter__(self_inner):
                return self_inner

            def __exit__(self_inner, *exc):
                return False

            def read(self_inner, *_):
                return json.dumps(payload).encode("utf-8")

        def fake(req, timeout=None):
            if isinstance(req, str):
                seen.append((req, {}))
            else:
                seen.append((req.full_url, dict(req.headers)))
            return Resp()
        return fake

    def _probe(self, payload, env, **kw):
        seen = []
        with mock.patch.dict(os.environ, env, clear=False), mock.patch.object(
                llm_client.urllib.request, "urlopen",
                self._fake_urlopen(payload, seen)):
            return llm_client.probe(**kw), seen

    def test_openrouter_probe_checks_the_model_not_the_catalogue(self):
        # The full /models catalogue took >60 s to stream on 2026-09-19 and a
        # 10 s timeout skipped analysis for the whole first scheduled run.
        got, seen = self._probe({"data": {"endpoints": [{}, {}]}}, self.OR_ENV)
        self.assertTrue(got["ok"], got)
        self.assertEqual((got["providers"], got["model"]), (2, "z-ai/glm-x"))
        self.assertEqual(
            [u for u, _ in seen],
            ["https://openrouter.ai/api/v1/models/z-ai/glm-x/endpoints"])
        self.assertEqual(seen[0][1].get("Authorization"), "Bearer sk-test")

        got, _ = self._probe({"data": {"endpoints": []}}, self.OR_ENV)
        self.assertFalse(got["ok"])
        self.assertIn("no provider", got["error"])

    def test_an_explicit_model_beats_the_environment(self):
        # run_nightly.sh passes the model it RESOLVED (a --model override
        # included); the probe must check that one.
        got, seen = self._probe({"data": {"endpoints": [{}]}}, self.OR_ENV,
                                model="other/model:free")
        self.assertEqual(got["model"], "other/model:free")
        self.assertEqual(
            seen[0][0], "https://openrouter.ai/api/v1/models/other/model/endpoints")

    def test_openrouter_without_a_model_fails_instead_of_the_catalogue(self):
        env = {**self.OR_ENV, "NEWS_LLM_MODEL": ""}
        got, seen = self._probe({"data": []}, env)
        self.assertFalse(got["ok"])
        self.assertIn("no model configured", got["error"])
        self.assertEqual(seen, [])

    def test_a_base_style_url_builds_the_same_check_url(self):
        env = {**self.OR_ENV, "NEWS_LLM_URL": "https://openrouter.ai/api/v1"}
        _, seen = self._probe({"data": {"endpoints": [{}]}}, env)
        self.assertEqual(
            seen[0][0], "https://openrouter.ai/api/v1/models/z-ai/glm-x/endpoints")

    def test_a_local_server_still_lists_its_models(self):
        env = {"NEWS_LLM_URL": "http://127.0.0.1:8080/v1/chat/completions",
               "NEWS_LLM_MODEL": "local-model"}
        got, seen = self._probe({"data": [{"id": "gemma"}]}, env)
        self.assertTrue(got["ok"])
        self.assertEqual(got["models"], ["gemma"])
        self.assertEqual(seen[0][0], "http://127.0.0.1:8080/v1/models")

    def test_a_failed_probe_reports_the_url_it_actually_tried(self):
        def boom(req, timeout=None):
            raise TimeoutError("The read operation timed out")
        with mock.patch.dict(os.environ, self.OR_ENV), mock.patch.object(
                llm_client.urllib.request, "urlopen", boom):
            got = llm_client.probe()
        self.assertFalse(got["ok"])
        self.assertEqual(got["url"],
                         "https://openrouter.ai/api/v1/chat/completions")
        self.assertEqual(got["model"], "z-ai/glm-x")

    def _complete_with(self, fake_urlopen, perf_dir):
        with mock.patch.dict(os.environ, {
                "NEWS_PERF_DIR": perf_dir, "NEWS_RUN_ID": "2026-09-19T190005Z-1",
                "NEWS_LLM_URL": "http://127.0.0.1:9/v1/chat/completions"}), \
                mock.patch.object(llm_client.urllib.request, "urlopen",
                                  fake_urlopen), \
                mock.patch.object(llm_client.time, "sleep"):
            return llm_client.complete("s", "u", model="m", max_attempts=2)

    def _events(self, perf_dir):
        import perf_log
        return [e for day in {p.stem for p in Path(perf_dir).glob("*.jsonl")}
                for e in perf_log.read_events(day, Path(perf_dir))]

    def test_every_response_and_failed_attempt_is_a_glm_event(self):
        perf_dir = tempfile.mkdtemp(prefix="glm_perf_")
        doc = {"id": "gen-1", "model": "m", "provider": "P",
               "choices": [{"message": {"content": "{}"},
                            "finish_reason": "stop"}],
               "usage": {"prompt_tokens": 10, "completion_tokens": 2,
                         "cost": 0.001,
                         "prompt_tokens_details": {"cached_tokens": 4}}}
        calls = []

        class Resp:
            def __enter__(self_inner):
                return self_inner

            def __exit__(self_inner, *exc):
                return False

            def read(self_inner, *_):
                return json.dumps(doc).encode("utf-8")

        def flaky(req, timeout=None):
            calls.append(1)
            if len(calls) == 1:
                raise TimeoutError("timed out")
            return Resp()
        answer = self._complete_with(flaky, perf_dir)
        self.assertEqual(answer["text"], "{}")
        events = [e for e in self._events(perf_dir) if e["event"] == "glm"]
        self.assertEqual([e["outcome"] for e in events],
                         ["unreachable", "response"])
        self.assertEqual([e["attempt"] for e in events], [1, 2])
        ok = events[1]
        self.assertEqual((ok["provider"], ok["prompt_tokens"],
                          ok["cached_prompt_tokens"], ok["cost"]),
                         ("P", 10, 4, 0.001))
        self.assertEqual({e["run_id"] for e in events},
                         {"2026-09-19T190005Z-1"})

    def test_a_logger_that_raises_cannot_fail_the_call(self):
        doc = {"choices": [{"message": {"content": "{}"}}], "usage": {}}

        class Resp:
            def __enter__(self_inner):
                return self_inner

            def __exit__(self_inner, *exc):
                return False

            def read(self_inner, *_):
                return json.dumps(doc).encode("utf-8")
        import perf_log
        with mock.patch.object(perf_log, "emit",
                               side_effect=RuntimeError("disk on fire")):
            answer = self._complete_with(lambda req, timeout=None: Resp(),
                                         tempfile.mkdtemp())
        self.assertEqual(answer["text"], "{}")

    def test_the_cli_probes_once_and_exits_on_that_result(self):
        for ok, code in ((True, 0), (False, 1)):
            with self.subTest(ok=ok), mock.patch.object(
                    llm_client, "probe", return_value={"ok": ok}) as probe, \
                    mock.patch("builtins.print"):
                self.assertEqual(llm_client.main(["--model", "m"]), code)
                probe.assert_called_once_with(model="m")


class Saving(unittest.TestCase):
    """⚠️ A save that FAILED TO RUN is not a save that rejected records, and
    neither is success."""

    def test_a_save_that_never_ran_is_reported_and_is_not_success(self):
        # ⚠️⚠️ Reproduced: `queued: 4, answered: 4, saved: 1, rejected: []`
        # at exit 0, with three analyses gone — because cmd_save's error
        # shapes carry neither `saved` nor `failed`, and the caller read only
        # those keys.
        stats = {"saved": 0, "rejected": [], "save_failed": []}
        with mock.patch.object(analyze_local, "run_analyze",
                               return_value=(4, {"error": "invalid_json"})):
            ok = analyze_local.save([{"x": 1}], stats)
        self.assertFalse(ok)
        self.assertEqual(stats["saved"], 0)
        self.assertEqual(len(stats["save_failed"]), 1)
        self.assertEqual(stats["save_failed"][0]["records"], 1)

    def test_a_REJECTED_record_is_not_a_failed_save(self):
        # Different facts: the validator refused a named record, and the save
        # itself ran fine. Only the first names which record was bad.
        stats = {"saved": 0, "rejected": [], "save_failed": []}
        with mock.patch.object(analyze_local, "run_analyze",
                               return_value=(3, {"saved": [],
                                                 "failed": [{"url": "u"}]})):
            ok = analyze_local.save([{"x": 1}], stats)
        self.assertFalse(ok)
        self.assertEqual(stats["save_failed"], [])
        self.assertEqual(len(stats["rejected"]), 1)

    def test_a_clean_save_counts_what_landed(self):
        stats = {"saved": 0, "rejected": [], "save_failed": []}
        with mock.patch.object(analyze_local, "run_analyze",
                               return_value=(0, {"saved": ["a", "b"],
                                                 "failed": []})):
            self.assertTrue(analyze_local.save([1, 2], stats))
        self.assertEqual(stats["saved"], 2)

    def test_real_save_subprocess_preserves_provenance_unchanged(self):
        with tempfile.TemporaryDirectory(prefix="provenance_save_") as td:
            root = Path(td)
            corpus_dir = root / "news" / "data" / "test.bg"
            corpus_dir.mkdir(parents=True)
            (root / "news" / "topics.json").write_text(
                json.dumps(article_fixtures.TAXONOMY, ensure_ascii=False),
                encoding="utf-8")
            article = article_fixtures.corpus_article(
                "test.bg", "a", "https://test.bg/a", "Заглавие",
                "2026-08-22T00:00:00+00:00")
            article_path = "news/data/test.bg/a.json"
            (root / article_path).write_text(
                json.dumps(article, ensure_ascii=False), encoding="utf-8")
            rec = article_fixtures.analysis(
                article_path, article["url"], article["domain"])
            rec["analysis_provenance"] = {
                "version": 1, "model_requested": "requested",
                "model_served": "served", "user_prompt_sha256": "sha256:u",
            }
            stats = {"saved": 0, "rejected": [], "save_failed": []}
            with mock.patch.object(analyze_local, "ROOT", root):
                self.assertTrue(analyze_local.save([rec], stats))
            index = json.loads((root / "news" / "data" / "analysis"
                                / "index.json").read_text(encoding="utf-8"))
            saved_path = root / index["articles"][article["url"]]["path"]
            saved = json.loads(saved_path.read_text(encoding="utf-8"))
            self.assertEqual(saved["analysis_provenance"],
                             rec["analysis_provenance"])

    def test_the_canary_is_keyed_on_the_first_record_BUILT(self):
        # ⚠️ `n == 1` was the QUEUE index, so an unreadable first article
        # silently disabled the canary — and the run then discovered a
        # grammar-ignoring server only after the whole queue, which is the
        # entire nightly window.
        src = (SCRIPTS / "analyze_local.py").read_text(encoding="utf-8")
        self.assertIn("canary_done = not FIRST_RECORD_IS_A_CANARY", src)
        self.assertNotIn("and n == 1", src)


    def test_one_schema_retry_is_bounded_and_a_success_hides_first_rejection(self):
        import io
        calls = {}
        queue = [{"path": name, "domain": "x.bg"}
                 for name in ("bad.json", "canary.json", "retry.json")]

        def fake_analyze(item, *_args):
            path = item["path"]
            calls[path] = calls.get(path, 0) + 1
            if path == "bad.json":
                return {"kind": "parse_failed", "path": path,
                        "detail": "unreadable"}
            return {"kind": "record", "item": item,
                    "record": {"article_path": path}}

        save_calls = {}

        def fake_run(*args, stdin=None):
            if args[0] == "--next":
                return 0, {"queue": queue}
            record = json.loads(stdin)[0]
            path = record["article_path"]
            save_calls[path] = save_calls.get(path, 0) + 1
            if path == "retry.json" and save_calls[path] == 1:
                return 3, {"saved": [], "failed": [{"article_path": path}]}
            return 0, {"saved": [path], "failed": []}

        argv = ["analyze_local.py", "--limit", "3", "--model", "m",
                "--workers", "2", "--schema-retries", "1"]
        assets = {"grammar": "g", "json_schema": {}, "system": "s",
                  "taxonomy": '{"version": 1}'}
        output = io.StringIO()
        with mock.patch.object(sys, "argv", argv), \
                mock.patch.object(analyze_local, "load_prompt_assets",
                                  return_value=assets), \
                mock.patch.object(analyze_local, "grammar_is_enforced",
                                  return_value=(True, "enforced")), \
                mock.patch.object(analyze_local, "run_analyze", fake_run), \
                mock.patch.object(analyze_local, "analyze_one", fake_analyze), \
                mock.patch("sys.stdout", output):
            self.assertEqual(analyze_local.main(), 0)

        got = json.loads(output.getvalue())
        self.assertEqual(got["saved"], 2)
        self.assertEqual(got["parse_failed"], [
            {"path": "bad.json", "detail": "unreadable"}])
        self.assertEqual(got["schema_retry_attempted"], 1)
        self.assertEqual(got["schema_retry_succeeded"], 1)
        self.assertEqual(got["rejected"], [])
        self.assertEqual(calls,
                         {"bad.json": 1, "canary.json": 1, "retry.json": 2})


class AnalyzeYield(unittest.TestCase):
    """Plan Phase 1.3: repair, parse retry, bounded canary, deadline."""

    def run_main(self, fake_analyze, paths, *extra, fake_save=None):
        import io
        queue = [{"path": name, "domain": "x.bg"} for name in paths]

        def fake_run(*args, stdin=None):
            if args[0] == "--next":
                return 0, {"queue": queue}
            record = json.loads(stdin)[0]
            if fake_save is not None:
                return fake_save(record)
            return 0, {"saved": [record["article_path"]], "failed": []}

        argv = ["analyze_local.py", "--limit", str(len(paths)), "--model",
                "m", "--workers", "2", "--schema-retries", "1", *extra]
        assets = {"grammar": "g", "json_schema": {}, "system": "s",
                  "taxonomy": '{"version": 1}'}
        output = io.StringIO()
        with mock.patch.object(sys, "argv", argv), \
                mock.patch.object(analyze_local, "load_prompt_assets",
                                  return_value=assets), \
                mock.patch.object(analyze_local, "grammar_is_enforced",
                                  return_value=(True, "enforced")), \
                mock.patch.object(analyze_local, "run_analyze", fake_run), \
                mock.patch.object(analyze_local, "analyze_one", fake_analyze), \
                mock.patch.object(analyze_local.os, "_exit",
                                  side_effect=SystemExit), \
                mock.patch("sys.stdout", output):
            try:
                code = analyze_local.main()
            except SystemExit:
                code = "hard_exit"
        return code, json.loads(output.getvalue())

    @staticmethod
    def unparseable(path):
        return {"kind": "parse_failed", "path": path, "detail": "bad json",
                "model_output": True, "provider": "P"}

    def test_the_repair_leaves_escaped_quotes_and_refuses_to_merge(self):
        parsed, repair = analyze_local.parse_answer_detail(
            '{"a": "„Не\\"", "b": "„x" y"}')
        self.assertEqual(parsed, {"a": '„Не"', "b": "„x“ y"})
        self.assertEqual(repair, "bg_quote_closed_ascii")
        # Rewriting here would fold two array elements into one string.
        with self.assertRaises(json.JSONDecodeError):
            analyze_local.parse_answer_detail('["„p", ", "x"]')

    def test_a_failed_repair_reports_the_original_error(self):
        text = '{"a": "x" y}'
        with self.assertRaises(json.JSONDecodeError) as ctx:
            analyze_local.parse_answer_detail(text)
        with self.assertRaises(json.JSONDecodeError) as raw:
            json.loads(text)
        self.assertEqual((ctx.exception.msg, ctx.exception.pos),
                         (raw.exception.msg, raw.exception.pos))

    def test_the_repair_closes_a_bulgarian_quotation_and_nothing_else(self):
        broken = '{"e": "без автор освен „Frognews"", "x": ["„а" и „б""]}'
        parsed, repair = analyze_local.parse_answer_detail(broken)
        self.assertEqual(repair, "bg_quote_closed_ascii")
        self.assertEqual(parsed["e"], "без автор освен „Frognews“")
        self.assertEqual(parsed["x"], ["„а“ и „б“"])
        valid = '{"e": "„цитат" в ключ"}'.replace('" в', '“ в')
        self.assertEqual(analyze_local.parse_answer_detail(valid)[1], None)
        # A valid answer containing „…" in the RIGHT form is never rewritten.
        self.assertEqual(analyze_local.parse_answer('{"e": "a „b“"}')["e"],
                         "a „b“")
        with self.assertRaises(json.JSONDecodeError):
            analyze_local.parse_answer_detail(broken, repair=False)
        with self.assertRaises(json.JSONDecodeError):
            analyze_local.parse_answer('{"e": "unrelated" break}')

    def test_a_saved_repaired_record_is_counted(self):
        def fake(item, *_):
            prov = ({"json_repair": "bg_quote_closed_ascii"}
                    if item["path"] == "fixed.json" else {})
            return {"kind": "record", "item": item,
                    "record": {"article_path": item["path"],
                               "analysis_provenance": prov}}
        _, got = self.run_main(fake, ["canary.json", "fixed.json"])
        self.assertEqual(got["json_repaired"], 1)

    def test_an_unparseable_answer_gets_one_retry_and_its_success_is_saved(self):
        calls = {}

        def fake(item, *_):
            path = item["path"]
            calls[path] = calls.get(path, 0) + 1
            if path == "flaky.json" and calls[path] == 1:
                return self.unparseable(path)
            return {"kind": "record", "item": item,
                    "record": {"article_path": path}}
        code, got = self.run_main(fake, ["canary.json", "flaky.json"])
        self.assertEqual(code, 0)
        self.assertEqual(got["saved"], 2)
        self.assertEqual(got["parse_failed"], [])
        self.assertEqual((got["parse_retry_attempted"],
                          got["parse_retry_succeeded"]), (1, 1))
        self.assertEqual(calls["flaky.json"], 2)

    def test_a_retry_that_fails_again_is_reported_once(self):
        def fake(item, *_):
            if item["path"] == "bad.json":
                return self.unparseable(item["path"])
            return {"kind": "record", "item": item,
                    "record": {"article_path": item["path"]}}
        _, got = self.run_main(fake, ["canary.json", "bad.json"])
        self.assertEqual([f["path"] for f in got["parse_failed"]],
                         ["bad.json"])
        self.assertEqual(got["parse_retry_succeeded"], 0)

    def test_an_unreadable_article_is_not_retried(self):
        calls = {}

        def fake(item, *_):
            calls[item["path"]] = calls.get(item["path"], 0) + 1
            if item["path"] == "gone.json":
                return {"kind": "parse_failed", "path": "gone.json",
                        "detail": "unreadable"}
            return {"kind": "record", "item": item,
                    "record": {"article_path": item["path"]}}
        _, got = self.run_main(fake, ["canary.json", "gone.json"])
        self.assertEqual(calls["gone.json"], 1)
        self.assertEqual(got["parse_retry_attempted"], 0)

    def test_the_canary_gives_up_after_consecutive_unparseable_answers(self):
        # Before: `continue`d through every parse failure, serializing the
        # whole queue on a provider that ignores the schema (plan §0.10 W1).
        calls = []

        def fake(item, *_):
            calls.append(item["path"])
            return self.unparseable(item["path"])
        paths = [f"a{i}.json" for i in range(12)]
        _, got = self.run_main(fake, paths)
        self.assertEqual(len(calls), analyze_local.CANARY_MAX_PARSE_FAILURES)
        self.assertIn("unparseable", got["aborted"])
        self.assertEqual(got["saved"], 0)

    def test_the_deadline_abandons_slow_calls_and_leaves_them_queued(self):
        import threading
        release = threading.Event()

        def fake(item, *_):
            if item["path"] != "canary.json":
                release.wait(5)  # a hung provider call
            return {"kind": "record", "item": item,
                    "record": {"article_path": item["path"]}}
        started = time.monotonic()
        try:
            code, got = self.run_main(
                fake, ["canary.json", "s1.json", "s2.json"], "--deadline", "1")
        finally:
            release.set()
        self.assertLess(time.monotonic() - started, 4)
        self.assertEqual(got["saved"], 1)
        self.assertEqual(sorted(got["deadline_abandoned"]),
                         ["s1.json", "s2.json"])
        # The PROCESS must not outlive the deadline by joining the abandoned
        # threads at interpreter exit.
        self.assertEqual(code, "hard_exit")

    def test_results_finished_during_a_slow_save_are_not_dropped(self):
        # as_completed's timeout used to drop futures that completed while a
        # handler was still busy — counted nowhere.
        def slow_save(record):
            if record["article_path"] == "a.json":
                time.sleep(1.5)
            return 0, {"saved": [record["article_path"]], "failed": []}

        def fake(item, *_):
            if item["path"] == "b.json":
                time.sleep(0.2)
            return {"kind": "record", "item": item,
                    "record": {"article_path": item["path"]}}
        code, got = self.run_main(fake, ["canary.json", "a.json", "b.json"],
                                  "--deadline", "1", fake_save=slow_save)
        self.assertEqual(got["saved"], 3)
        self.assertEqual(got["deadline_abandoned"], [])

    def test_a_parse_retry_abandoned_at_the_deadline_keeps_its_first_failure(self):
        import threading
        release = threading.Event()
        calls = {}

        def fake(item, *_):
            path = item["path"]
            calls[path] = calls.get(path, 0) + 1
            if path == "p.json":
                if calls[path] == 1:
                    time.sleep(0.2)
                    return self.unparseable(path)
                release.wait(5)
            return {"kind": "record", "item": item,
                    "record": {"article_path": path}}
        try:
            _, got = self.run_main(fake, ["canary.json", "p.json"],
                                   "--deadline", "1")
        finally:
            release.set()
        self.assertEqual([f["path"] for f in got["parse_failed"]], ["p.json"])
        self.assertEqual(got["deadline_abandoned"], ["p.json"])
        self.assertEqual(got["parse_retry_attempted"], 0)


class TransportBudget(unittest.TestCase):
    def test_hosted_endpoints_get_a_short_budget_local_keeps_its_own(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            for k in ("NEWS_LLM_HOSTED_TIMEOUT", "NEWS_LLM_HOSTED_ATTEMPTS"):
                os.environ.pop(k, None)
            self.assertEqual(llm_client.transport_budget(
                "https://openrouter.ai/api/v1/chat/completions", None, None),
                (60, 2))
            self.assertEqual(llm_client.transport_budget(
                "http://127.0.0.1:8080/v1/chat/completions", None, None),
                (llm_client.DEFAULT_TIMEOUT, llm_client.MAX_ATTEMPTS))
            # An explicit caller choice always wins (triage passes 12 s x 1).
            self.assertEqual(llm_client.transport_budget(
                "https://openrouter.ai/x", 12, 1), (12, 1))
        with mock.patch.dict(os.environ, {"NEWS_LLM_HOSTED_TIMEOUT": "45",
                                          "NEWS_LLM_HOSTED_ATTEMPTS": "3"}):
            self.assertEqual(llm_client.transport_budget(
                "https://openrouter.ai/x", None, None), (45, 3))

    def test_an_explicit_pin_is_not_emptied_by_env_ignore(self):
        # diagnose_yield --providers NextBit with NEWS_LLM_PROVIDER_IGNORE=
        # NextBit set would otherwise ask for NextBit AND exclude it.
        with mock.patch.dict(os.environ, {
                "NEWS_LLM_URL": "https://openrouter.ai/api/v1/chat/completions",
                "NEWS_LLM_ALLOW_REMOTE": "1",
                "NEWS_LLM_PROVIDER_IGNORE": "NextBit"}):
            _, body, _ = llm_client.prepare_request(
                "s", "u", model="m", json_schema={"type": "object"},
                provider={"order": ["NextBit"], "allow_fallbacks": False})
        self.assertEqual(json.loads(body)["provider"],
                         {"require_parameters": True, "order": ["NextBit"],
                          "allow_fallbacks": False})

    def test_prepared_and_returned_request_metadata_agree(self):
        # benchmark_news_models.py raises if these differ.
        doc = {"choices": [{"message": {"content": "{}"}}], "usage": {}}

        class Resp:
            def __enter__(self_inner):
                return self_inner

            def __exit__(self_inner, *exc):
                return False

            def read(self_inner, *_):
                return json.dumps(doc).encode("utf-8")
        env = {"NEWS_LLM_URL": "https://openrouter.ai/api/v1/chat/completions",
               "NEWS_LLM_ALLOW_REMOTE": "1"}
        with mock.patch.dict(os.environ, env), mock.patch.object(
                llm_client.urllib.request, "urlopen",
                lambda req, timeout=None: Resp()):
            _, _, prepared = llm_client.prepare_request(
                "s", "u", model="m", json_schema={"type": "object"},
                max_attempts=llm_client.MAX_ATTEMPTS, timeout=90)
            answer = llm_client.complete(
                "s", "u", model="m", json_schema={"type": "object"},
                max_attempts=llm_client.MAX_ATTEMPTS, timeout=90)
        self.assertEqual(answer["request"], prepared)
        self.assertEqual(prepared["transport_timeout_s"], 90)

    def test_a_malformed_env_budget_falls_back_instead_of_crashing(self):
        with mock.patch.dict(os.environ, {"NEWS_LLM_HOSTED_TIMEOUT": "1m",
                                          "NEWS_LLM_HOSTED_ATTEMPTS": "0"}), \
                mock.patch("sys.stderr"):
            self.assertEqual(llm_client.transport_budget(
                "https://openrouter.ai/x", None, None), (60, 2))

    def test_env_routing_ignores_and_orders_providers(self):
        with mock.patch.dict(os.environ, {
                "NEWS_LLM_URL": "https://openrouter.ai/api/v1/chat/completions",
                "NEWS_LLM_ALLOW_REMOTE": "1",
                "NEWS_LLM_PROVIDER_IGNORE": "NextBit, Foo",
                "NEWS_LLM_PROVIDER_ORDER": ""}):
            _, body, _ = llm_client.prepare_request(
                "s", "u", model="m", json_schema={"type": "object"})
        self.assertEqual(json.loads(body)["provider"],
                         {"require_parameters": True,
                          "ignore": ["NextBit", "Foo"]})


class TheGrammarNonEmpty(unittest.TestCase):
    def test_a_required_string_cannot_be_empty(self):
        # ⚠️ The obvious `(...)*` derives `""`, and the validator demands a
        # non-empty string for summary_bg, summary_en, both evidence fields
        # and every party name — so the grammar could produce records it
        # would then reject, most likely on the paywall_shell / too_short
        # articles the rubric tells the model NOT to analyse.
        text = (PROMPTS / "analyze_schema.gbnf").read_text(encoding="utf-8")
        self.assertIn('string      ::= "\\"" char+ "\\""', text)

    def test_the_fields_that_MAY_be_empty_use_the_other_rule(self):
        text = (PROMPTS / "analyze_schema.gbnf").read_text(encoding="utf-8")
        self.assertIn('"\\"notes\\"" ws ":" ws str0', text)
        self.assertIn('str0        ::= "\\"" char* "\\""', text)


class ThePrompt(unittest.TestCase):
    def test_the_body_is_truncated_from_the_HEAD(self):
        # ⚠️ A Bulgarian news article states its framing in the lede, which is
        # exactly what the rubric asks the model to judge. A middle window
        # would take the part that matters least.
        rec = {"domain": "x.bg", "title": "T",
               "content": "НАЧАЛО " + ("x" * 20000) + " КРАЙ"}
        out = analyze_local.build_user_prompt(rec, [], "{}")
        self.assertIn("НАЧАЛО", out)
        self.assertNotIn("КРАЙ", out)

    def test_a_truncated_body_SAYS_it_was_truncated(self):
        # A model that cannot see the end should not be asked to judge the
        # conclusion as if it had.
        rec = {"domain": "x.bg", "content": "x" * 20000}
        self.assertIn("съкратен", analyze_local.build_user_prompt(rec, [], "{}"))

    def test_a_short_body_is_not_labelled_truncated(self):
        rec = {"domain": "x.bg", "content": "кратко"}
        self.assertNotIn("съкратен",
                         analyze_local.build_user_prompt(rec, [], "{}"))

    def test_resolved_mentions_are_HANDED_OVER_not_requested(self):
        # ⚠️ The dictionary pass already resolved these and the validator
        # refuses any record that changes an id — so telling the model who is
        # in the article costs nothing and stops it inventing anybody.
        rec = {"domain": "x.bg", "content": "текст"}
        out = analyze_local.build_user_prompt(
            rec, [{"surface": "Делян Пеевски"}], "{}")
        self.assertIn("Делян Пеевски", out)
        self.assertIn("не ги променяй", out)

    def test_no_mentions_means_no_mentions_LINE(self):
        rec = {"domain": "x.bg", "content": "текст"}
        self.assertNotIn("СПОМЕНАВАНИЯ",
                         analyze_local.build_user_prompt(rec, [], "{}"))


class TheRecord(unittest.TestCase):
    def test_publishable_unclustered_article_gets_a_safe_singleton_story(self):
        # The unattended runner must never merge two events. Creating a
        # one-member story loses no information and makes the analysis visible.
        model = {
            "quality": {"verdict": "ok"},
            "site_relevant": True,
            "summary_bg": "Българско резюме",
            "summary_en": "English summary",
        }
        rec = analyze_local.record_from(
            {"path": "news/data/x.bg/a.json", "domain": "x.bg"},
            {"url": "https://x.bg/a", "title": "Заглавие"},
            {"text": json.dumps(model), "model": "srv"},
            "flag-model", 1, [])
        self.assertEqual(rec["story"], {
            "action": "new_story",
            "canonical_title_bg": "Заглавие",
            "canonical_title_en": "English summary",
            "summary_bg": "Българско резюме",
            "summary_en": "English summary",
            "related_story_ids": [],
        })

    def test_nonpublishable_article_stays_detached_and_redo_keeps_membership(self):
        answer = {"text": json.dumps({
            "quality": {"verdict": "ok"}, "site_relevant": False,
            "summary_bg": "БГ", "summary_en": "EN",
        })}
        detached = analyze_local.record_from(
            {"path": "p", "domain": "x.bg"}, {"url": "u"},
            answer, "m", 1, [])
        attached = analyze_local.record_from(
            {"path": "p", "domain": "x.bg", "story_id": "story-1"},
            {"url": "u"}, answer, "m", 1, [])
        self.assertEqual(detached["story"], {"action": "none"})
        self.assertEqual(attached["story"], {
            "action": "same_story", "story_id": "story-1"})

    def test_the_SERVER_model_id_wins_over_the_flag(self):
        # ⚠️ A run pointed at a server holding a different model would
        # otherwise record a name nobody served — and Tier 4 is about
        # comparing models.
        rec = analyze_local.record_from(
            {"path": "p", "domain": "x.bg"}, {"url": "u"},
            {"text": "{}", "model": "gemma-4-12b-q4"}, "whatever", 1, [])
        self.assertEqual(rec["model"], "gemma-4-12b-q4")

    def test_prompt_model_usage_and_claim_provenance_are_persisted(self):
        prompt = {
            "system_prompt_sha256": "sha256:system",
            "json_schema_sha256": "sha256:schema",
            "grammar_sha256": "sha256:grammar",
            "taxonomy_prompt_sha256": "sha256:taxonomy",
            "user_prompt_sha256": "sha256:user",
            "body_truncated": False,
            "max_body_chars": 6000,
        }
        rec = analyze_local.record_from(
            {"path": "p", "domain": "x.bg"}, {"url": "u"},
            {"text": json.dumps({"analysis_provenance": {"version": 999}}),
             "model": "served", "response_id": "gen-1", "provider": "p",
             "usage": {"prompt_tokens": 12, "total_tokens": 20,
                       "ignored": "large-provider-object"},
             "attempt_elapsed_s": 0.75, "transport_elapsed_s": 1.25,
             "attempts": 2, "request": {"body_sha256": "sha256:req"}},
            "requested", 1, [], prompt)
        got = rec["analysis_provenance"]
        self.assertEqual(got["version"], 1)
        self.assertEqual(got["model_requested"], "requested")
        self.assertEqual(got["model_served"], "served")
        self.assertEqual(got["response_id"], "gen-1")
        self.assertEqual(got["usage"], {"prompt_tokens": 12,
                                         "total_tokens": 20})
        self.assertEqual(got["user_prompt_sha256"], "sha256:user")
        self.assertEqual(got["claim_sources"]["evidence"], "model_output")
        self.assertEqual(got["request"]["body_sha256"], "sha256:req")
        self.assertEqual(got["schema_generation_attempt"], 1)
        self.assertEqual(got["cumulative_usage"], got["usage"])

    def test_loaded_prompt_hashes_match_the_exact_assets(self):
        import hashlib
        assets = analyze_local.load_prompt_assets()
        got = assets["provenance"]
        system = (PROMPTS / "analyze_system.md").read_text(encoding="utf-8")
        expected_system = "sha256:" + hashlib.sha256(
            system.encode("utf-8")).hexdigest()
        self.assertEqual(got["system_prompt_sha256"], expected_system)
        self.assertTrue(all(value.startswith("sha256:")
                            for value in got.values()))

    def test_usage_rejects_nonfinite_negative_boolean_and_implausible_values(self):
        got = analyze_local.bounded_usage({
            "prompt_tokens": -1,
            "completion_tokens": True,
            "total_tokens": analyze_local.MAX_USAGE_TOKENS + 1,
            "cost": float("nan"),
            "prompt_tokens_details": [],
            "completion_tokens_details": "bad",
        })
        self.assertEqual(got, {})
        for bad in (float("inf"), -0.01,
                    analyze_local.MAX_USAGE_COST_USD + 1):
            self.assertNotIn("cost", analyze_local.bounded_usage({"cost": bad}))

    def test_usage_keeps_cache_and_reasoning_counters(self):
        got = analyze_local.bounded_usage({
            "prompt_tokens": 100,
            "completion_tokens": 30,
            "total_tokens": 130,
            "cost": 0.00125,
            "prompt_tokens_details": {"cached_tokens": 80},
            "completion_tokens_details": {"reasoning_tokens": 12},
        })
        self.assertEqual(got["cached_prompt_tokens"], 80)
        self.assertEqual(got["reasoning_tokens"], 12)

    def test_schema_retry_provenance_carries_cumulative_billed_usage(self):
        def rec(response, cost):
            return analyze_local.record_from(
                {"path": "p", "domain": "x.bg"}, {"url": "u"},
                {"text": "{}", "model": "m", "response_id": response,
                 "usage": {"prompt_tokens": 10, "completion_tokens": 2,
                           "total_tokens": 12, "cost": cost}},
                "m", 1, [])
        first, accepted = rec("first", 0.001), rec("accepted", 0.002)
        analyze_local.carry_schema_attempts(accepted, [first])
        got = accepted["analysis_provenance"]
        self.assertEqual(got["schema_generation_attempt"], 2)
        self.assertEqual([a["response_id"] for a in got["schema_attempts"]],
                         ["first", "accepted"])
        self.assertEqual(got["cumulative_usage"]["total_tokens"], 24)
        self.assertAlmostEqual(got["cumulative_usage"]["cost"], 0.003)


class OptionalFreeTriage(unittest.TestCase):
    def article(self, root, *, title="Прогноза за времето утре",
                content="Утре температурите ще достигнат двадесет и пет градуса."):
        rel = "news/data/x.bg/weather.json"
        path = root / rel
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps({
            "url": "https://x.bg/weather", "domain": "x.bg", "title": title,
            "content": content,
        }, ensure_ascii=False), encoding="utf-8")
        return {"path": rel, "domain": "x.bg", "mentions": []}

    def answer(self, **over):
        decision = {
            "decision": "obvious_not_site_relevant", "subcategory": "weather",
            "confidence": 0.99,
            "evidence": "Утре температурите ще достигнат двадесет и пет градуса.",
        }
        decision.update(over)
        return {"text": json.dumps(decision, ensure_ascii=False),
                "model": "free-served", "response_id": "free-1",
                "usage": {"total_tokens": 30, "cost": 0}}

    def test_exact_high_confidence_weather_can_be_closed_without_paid_model(self):
        with tempfile.TemporaryDirectory(prefix="triage_") as td:
            root = Path(td)
            item = self.article(root)
            with mock.patch.object(analyze_local, "ROOT", root), \
                    mock.patch.object(llm_client, "complete",
                                      return_value=self.answer()):
                got = analyze_local.triage_one(item, {}, "free", 12, 1)
        self.assertEqual(got["route"], "free_triage")
        rec = got["record"]
        self.assertFalse(rec["site_relevant"])
        self.assertEqual(rec["model"], "free-served")
        self.assertEqual(rec["topics"][0]["subcategory"], "weather")
        self.assertEqual(rec["analysis_provenance"]["claim_sources"]["evidence"],
                         "free_triage_model_exact_excerpt")

    def test_exact_high_confidence_sports_can_also_close(self):
        evidence = "Отборът спечели мача с два гола преднина."
        with tempfile.TemporaryDirectory(prefix="triage_") as td:
            root = Path(td)
            item = self.article(root, title="Футболен мач завърши с победа",
                                content=evidence)
            with mock.patch.object(analyze_local, "ROOT", root), \
                    mock.patch.object(llm_client, "complete", return_value=self.answer(
                        subcategory="sports", evidence=evidence)):
                got = analyze_local.triage_one(item, {}, "free", 12, 1)
        self.assertEqual(got["route"], "free_triage")
        self.assertEqual(got["record"]["topics"][0]["subcategory"], "sports")

    def test_every_nonproof_decision_shape_falls_back(self):
        cases = [
            {"decision": "needs_paid_analysis"},
            {"confidence": 0.97},
            {"evidence": "Този откъс изобщо не присъства в статията."},
            {"subcategory": "sports"},  # weather title cannot prove sports
        ]
        with tempfile.TemporaryDirectory(prefix="triage_") as td:
            root = Path(td)
            item = self.article(root)
            for overrides in cases:
                with self.subTest(overrides=overrides), \
                        mock.patch.object(analyze_local, "ROOT", root), \
                        mock.patch.object(llm_client, "complete",
                                          return_value=self.answer(**overrides)):
                    got = analyze_local.triage_one(item, {}, "free", 12, 1)
                    self.assertEqual(got["reason"], "triage_not_proven")

    def test_named_entity_veto_calls_no_free_endpoint(self):
        with tempfile.TemporaryDirectory(prefix="triage_") as td:
            root = Path(td)
            item = self.article(root)
            item["mentions"] = [{"kind": "party", "id": "gerb"}]
            with mock.patch.object(analyze_local, "ROOT", root), \
                    mock.patch.object(llm_client, "complete") as complete:
                got = analyze_local.triage_one(item, {}, "free", 12, 1)
        self.assertEqual(got["reason"], "named_entity_veto")
        complete.assert_not_called()

    def test_mentions_must_be_present_verified_and_empty(self):
        with tempfile.TemporaryDirectory(prefix="triage_") as td:
            root = Path(td)
            base = self.article(root)
            for mentions in (None, "bad"):
                item = dict(base)
                if mentions is None:
                    item.pop("mentions")
                else:
                    item["mentions"] = mentions
                with self.subTest(mentions=mentions), \
                        mock.patch.object(analyze_local, "ROOT", root), \
                        mock.patch.object(llm_client, "complete") as complete:
                    got = analyze_local.triage_one(item, {}, "free", 12, 1)
                    self.assertEqual(got["reason"], "mentions_unavailable")
                    complete.assert_not_called()

    def test_all_consequential_mention_kinds_veto_even_without_id(self):
        with tempfile.TemporaryDirectory(prefix="triage_") as td:
            root = Path(td)
            base = self.article(root)
            for kind in ("person", "party", "institution", "company"):
                item = {**base, "mentions": [{"kind": kind, "id": None}]}
                with self.subTest(kind=kind), \
                        mock.patch.object(analyze_local, "ROOT", root), \
                        mock.patch.object(llm_client, "complete") as complete:
                    got = analyze_local.triage_one(item, {}, "free", 12, 1)
                    self.assertEqual(got["reason"], "named_entity_veto")
                    complete.assert_not_called()

    def test_low_confidence_or_nonexact_evidence_falls_through_to_paid(self):
        with tempfile.TemporaryDirectory(prefix="triage_") as td:
            root = Path(td)
            item = self.article(root)
            with mock.patch.object(analyze_local, "ROOT", root), \
                    mock.patch.object(llm_client, "complete",
                                      return_value=self.answer(confidence=0.8)), \
                    mock.patch.object(analyze_local, "analyze_one",
                                      return_value={"kind": "record", "item": item,
                                                    "record": {"analysis_provenance": {}}}) \
                    as paid:
                got = analyze_local.analyze_routed(
                    item, {}, "paid", 2048, 1, "free", 12)
        self.assertEqual(got["route"], "paid_fallback")
        self.assertEqual(got["record"]["analysis_provenance"]
                         ["triage_fallback"]["reason"], "triage_not_proven")
        generation = got["record"]["analysis_provenance"]["triage_fallback"][
            "generation"]
        self.assertEqual(generation["usage"]["cost"], 0)
        self.assertIn("system_prompt_sha256", generation["prompt"])
        paid.assert_called_once()

    def test_invalid_json_roots_and_transport_errors_always_call_paid(self):
        bad_answers = ["[]", "null", '"text"', "7"]
        with tempfile.TemporaryDirectory(prefix="triage_") as td:
            root = Path(td)
            item = self.article(root)
            for text in bad_answers:
                with self.subTest(text=text), \
                        mock.patch.object(analyze_local, "ROOT", root), \
                        mock.patch.object(llm_client, "complete",
                                          return_value={**self.answer(), "text": text}), \
                        mock.patch.object(analyze_local, "analyze_one",
                                          return_value={"kind": "record", "item": item,
                                                        "record": {"analysis_provenance": {}}}) \
                        as paid:
                    got = analyze_local.analyze_routed(
                        item, {}, "paid", 2048, 1, "free", 12)
                    self.assertEqual(got["route"], "paid_fallback")
                    self.assertEqual(got["record"]["analysis_provenance"]
                                     ["triage_fallback"]["reason"],
                                     "triage_invalid_response")
                    paid.assert_called_once()

            with mock.patch.object(analyze_local, "ROOT", root), \
                    mock.patch.object(llm_client, "complete",
                                      side_effect=RuntimeError("free down")), \
                    mock.patch.object(analyze_local, "analyze_one",
                                      return_value={"kind": "record", "item": item,
                                                    "record": {"analysis_provenance": {}}}) \
                    as paid:
                got = analyze_local.analyze_routed(
                    item, {}, "paid", 2048, 1, "free", 12)
                self.assertEqual(got["route"], "paid_fallback")
                self.assertEqual(got["record"]["analysis_provenance"]
                                 ["triage_fallback"]["reason"],
                                 "triage_unavailable")
                paid.assert_called_once()

    def test_accepted_triage_real_save_has_no_review_debt(self):
        with tempfile.TemporaryDirectory(prefix="triage_save_") as td:
            root = Path(td)
            item = self.article(root)
            (root / "news" / "topics.json").write_text(
                json.dumps(article_fixtures.TAXONOMY, ensure_ascii=False),
                encoding="utf-8")
            with mock.patch.object(analyze_local, "ROOT", root), \
                    mock.patch.object(llm_client, "complete",
                                      return_value=self.answer()):
                result = analyze_local.triage_one(item, {}, "free", 12, 1)
                stats = {"saved": 0, "rejected": [], "save_failed": []}
                self.assertTrue(analyze_local.save([result["record"]], stats))
            index = json.loads((root / "news" / "data" / "analysis"
                                / "index.json").read_text(encoding="utf-8"))
            saved_path = root / index["articles"]["https://x.bg/weather"]["path"]
            saved = json.loads(saved_path.read_text(encoding="utf-8"))
            self.assertNotIn("review", saved)
            self.assertEqual(saved["analysis_provenance"]["claim_sources"]
                             ["ai_generated"], "not_performed_out_of_scope")

    def test_the_url_comes_from_the_CORPUS_record(self):
        # ⚠️ The queue carries no `url` — reading item["url"] raised KeyError
        # on the first non-dry run and only there. analyze_articles.py
        # cross-checks url against the corpus, so taking it from the same file
        # it will check against is the only version that can be right.
        rec = analyze_local.record_from(
            {"path": "p", "domain": "x.bg"},
            {"url": "https://x.bg/real"}, {"text": "{}"}, "m", 1, [])
        self.assertEqual(rec["url"], "https://x.bg/real")

    def test_mentions_ride_along_when_present(self):
        m = [{"kind": "person", "surface": "X", "basis": "gazetteer_exact",
              "id": "x-1", "role": "mention"}]
        rec = analyze_local.record_from(
            {"path": "p", "domain": "x.bg"}, {"url": "u"}, {"text": "{}"},
            "m", 1, m)
        self.assertEqual(rec["mentions"], m)

    def test_an_absent_mentions_list_is_OMITTED_not_emptied(self):
        # The absent-vs-empty rule, one layer out: `[]` would tell the
        # validator the extractor ran and found nobody.
        rec = analyze_local.record_from(
            {"path": "p", "domain": "x.bg"}, {"url": "u"}, {"text": "{}"},
            "m", 1, [])
        self.assertNotIn("mentions", rec)



class ReasoningModels(unittest.TestCase):
    """⚠️ Gemma 4 thinks BEFORE it answers, and llama.cpp routes that to
    `reasoning_content` — leaving `content` EMPTY. Measured: the full rubric
    prompt spent its whole 2048-token budget reasoning, returned "" after 508
    seconds, and surfaced as „Expecting value: line 1 column 1" — a JSON
    error about an answer that was never produced."""

    def respond(self, doc, env=None):
        import io, urllib.request
        payload = json.dumps(doc).encode("utf-8")
        seen = {}

        class Resp(io.BytesIO):
            def __enter__(self_): return self_
            def __exit__(self_, *a): return False

        def fake(req, timeout=None):
            seen["body"] = json.loads(req.data.decode("utf-8"))
            return Resp(payload)

        old_open, old_env = urllib.request.urlopen, dict(os.environ)
        urllib.request.urlopen = fake
        os.environ.update(env or {})
        try:
            return llm_client.complete("s", "u", model="m",
                                       url="http://127.0.0.1:1/v1"), seen
        finally:
            urllib.request.urlopen = old_open
            os.environ.clear(); os.environ.update(old_env)

    def test_thinking_is_disabled_by_default(self):
        _r, seen = self.respond({"choices": [{"message": {"content": "hi"}}]})
        self.assertEqual(seen["body"]["chat_template_kwargs"],
                         {"enable_thinking": False})

    def test_NEWS_LLM_THINKING_1_leaves_it_on(self):
        # ⚠️ An escape hatch for a model that needs its chain of thought.
        _r, seen = self.respond({"choices": [{"message": {"content": "hi"}}]},
                                env={"NEWS_LLM_THINKING": "1"})
        self.assertNotIn("chat_template_kwargs", seen["body"])

    def test_reasoning_with_no_answer_is_NAMED(self):
        with self.assertRaises(llm_client.LlmError) as ctx:
            self.respond({"choices": [{"finish_reason": "length", "message": {
                "content": "", "reasoning_content": "thinking hard"}}]})
        self.assertIn("reasoning_only", str(ctx.exception))

    def test_an_ordinary_empty_answer_is_NOT_hijacked(self):
        # No reasoning_content — that is a different failure and the caller's
        # own parse error is the honest report of it.
        r, _ = self.respond({"choices": [{"message": {"content": ""}}]})
        self.assertEqual(r["text"], "")

    def test_hidden_reasoning_tokens_with_no_answer_are_NAMED(self):
        llm_client.reset_usage_events()
        with self.assertRaises(llm_client.LlmError) as ctx:
            self.respond({
                "id": "charged-failure", "model": "served",
                "provider": "FallbackProvider",
                "choices": [{"finish_reason": "length",
                             "message": {"content": ""}}],
                "usage": {
                    "prompt_tokens": 100, "completion_tokens": 2048,
                    "total_tokens": 2148, "cost": 0.0025,
                    "prompt_tokens_details": {"cached_tokens": 80},
                    "completion_tokens_details": {
                        "reasoning_tokens": 2046}},
            })
        self.assertEqual(ctx.exception.kind, "reasoning_only")
        billing = analyze_local.summarize_run_billing()
        self.assertEqual(billing["responses"], 1)
        self.assertEqual(billing["responses_with_cost"], 1)
        self.assertEqual(billing["cost_usd"], 0.0025)
        self.assertEqual(billing["cached_prompt_tokens"], 80)
        self.assertEqual(billing["reasoning_tokens"], 2046)
        self.assertEqual(billing["providers"], {"FallbackProvider": 1})
        self.assertEqual(billing["finish_reasons"], {"length": 1})


class FencedJson(unittest.TestCase):
    """⚠️ An unconstrained model fences its JSON, and `json.loads` then fails
    at „line 1 column 1" — an error that describes the fence rather than the
    answer. Stripping it does NOT make the record usable; it makes the
    failure honest."""

    def test_a_json_fence_is_stripped(self):
        self.assertEqual(
            analyze_local.parse_answer('```json\n{"a": 1}\n```'), {"a": 1})

    def test_a_bare_fence_is_stripped(self):
        self.assertEqual(analyze_local.parse_answer('```\n{"a": 1}\n```'),
                         {"a": 1})

    def test_unfenced_json_is_untouched(self):
        self.assertEqual(analyze_local.parse_answer('{"a": 1}'), {"a": 1})

    def test_a_backtick_INSIDE_a_string_is_not_a_fence(self):
        self.assertEqual(analyze_local.parse_answer('{"a": "``x``"}'),
                         {"a": "``x``"})

    def test_prose_still_raises_rather_than_being_salvaged(self):
        with self.assertRaises(json.JSONDecodeError):
            analyze_local.parse_answer("I am ready. How can I help?")


class GrammarProbe(unittest.TestCase):
    """⚠️ A server can ACCEPT `grammar` and silently drop it. Measured
    against Docker Model Runner + `ai/gemma4:12b`: one-rule grammars are
    enforced, the rubric's 6.4 KB grammar is dropped on every request, and
    the model then invents its own schema. The existing canary catches that
    after the first record — minutes; this proves it in about a second."""

    def probe(self, text=None, raise_exc=None):
        def fake(system, user, *, model, grammar=None, max_tokens=None,
                 url=None, **kw):
            if raise_exc:
                raise raise_exc
            return {"text": text}
        old = llm_client.complete
        llm_client.complete = fake
        try:
            return analyze_local.grammar_is_enforced("root ::= \"{\"", "m")
        finally:
            llm_client.complete = old

    def test_a_dropped_grammar_is_PROVEN_not_guessed(self):
        ok, detail = self.probe("It looks like you've sent a")
        self.assertFalse(ok)
        self.assertIn("ignored it", detail)

    def test_an_enforced_grammar_passes(self):
        ok, _ = self.probe('{"quality"')
        self.assertTrue(ok)

    def test_an_UNREACHABLE_server_is_not_a_verdict(self):
        # ⚠️ A different failure. The run's own error handling reports it;
        # calling it a grammar defect would send the operator to the wrong
        # place entirely.
        ok, detail = self.probe(raise_exc=llm_client.LlmError("unreachable", "x"))
        self.assertTrue(ok)
        self.assertIn("skipped", detail)

    def test_an_EMPTY_probe_is_inconclusive_not_a_verdict(self):
        ok, detail = self.probe("")
        self.assertTrue(ok)
        self.assertIn("inconclusive", detail)


class SchemaAndGrammarAgree(unittest.TestCase):
    """⚠️ TWO EXPRESSIONS OF ONE CONTRACT, and the way they drift is that one
    permits a label the validator rejects — producing records that are
    perfectly formed and refused 100% of the time, which reads as a model
    problem and is not one. Both are DERIVED from the same
    `analyze_articles` constants; this proves the derivation still holds."""

    def setUp(self):
        doc = json.loads((Path(__file__).resolve().parents[1]
                          / "topics.json").read_text(encoding="utf-8"))
        self.schema = build_prompts.build_json_schema(doc)
        self.gbnf = build_prompts.build_grammar(doc)

    def enums_in(self, node, out):
        if isinstance(node, dict):
            if "enum" in node:
                out.append([v for v in node["enum"] if v is not None])
            for v in node.values():
                self.enums_in(v, out)
        elif isinstance(node, list):
            for v in node:
                self.enums_in(v, out)
        return out

    def test_every_schema_enum_appears_in_the_grammar(self):
        for vals in self.enums_in(self.schema, []):
            for v in vals:
                self.assertIn(f'"\\"{v}\\""', self.gbnf, v)

    def test_the_label_sets_come_from_the_VALIDATOR(self):
        got = {tuple(sorted(v)) for v in self.enums_in(self.schema, [])}
        for const in (aa.QUALITY_VERDICTS, aa.LEANING_LABELS,
                      aa.RUSSIA_LABELS, aa.AI_VERDICTS, aa.TONE_LABELS):
            self.assertIn(tuple(sorted(const)), got)

    def test_every_object_is_CLOSED_and_fully_required(self):
        # ⚠️ Structured outputs treat an absent `required` as „all optional",
        # so a provider may legally return {} — valid against the schema and
        # refused by the validator.
        def walk(n):
            if isinstance(n, dict):
                if n.get("type") == "object":
                    self.assertIs(n.get("additionalProperties"), False)
                    self.assertEqual(sorted(n.get("required") or []),
                                     sorted(n.get("properties") or {}))
                for v in n.values():
                    walk(v)
            elif isinstance(n, list):
                for v in n:
                    walk(v)
        walk(self.schema)

    def test_subcategory_admits_null(self):
        # A topic with no subcategory is the common case, and an enum of
        # strings alone cannot express it.
        topic = self.schema["properties"]["topics"]["items"]
        self.assertIn("null", topic["properties"]["subcategory"]["type"])
        self.assertIn(None, topic["properties"]["subcategory"]["enum"])

    def test_confidence_is_bounded(self):
        lean = self.schema["properties"]["leaning"]["properties"]
        self.assertEqual(lean["confidence"]["minimum"], 0)
        self.assertEqual(lean["confidence"]["maximum"], 1)

    def test_the_committed_file_is_in_step_with_the_generator(self):
        # Same contract as the .gbnf — `--check` reports a stale artifact.
        on_disk = json.loads((Path(__file__).resolve().parents[1]
                              / "prompts" / "analyze_schema.json")
                             .read_text(encoding="utf-8"))
        self.assertEqual(on_disk, self.schema)

if __name__ == "__main__":
    unittest.main()
