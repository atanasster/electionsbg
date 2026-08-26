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

    def test_the_canary_is_keyed_on_the_first_record_BUILT(self):
        # ⚠️ `n == 1` was the QUEUE index, so an unreadable first article
        # silently disabled the canary — and the run then discovered a
        # grammar-ignoring server only after the whole queue, which is the
        # entire nightly window.
        src = (SCRIPTS / "analyze_local.py").read_text(encoding="utf-8")
        self.assertIn("not canary_done", src)
        self.assertNotIn("and n == 1", src)


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
    def test_the_story_action_is_always_none(self):
        # ⚠️ Clustering is NOT this script's job: it needs the candidate set,
        # the canonical titles and a judgment about whether two events are the
        # same event — and „merges of distinct events cannot be undone".
        rec = analyze_local.record_from(
            {"path": "news/data/x.bg/a.json", "domain": "x.bg"},
            {"url": "https://x.bg/a"},
            {"text": '{"quality": {"verdict": "ok"}}', "model": "srv"},
            "flag-model", 1, [])
        self.assertEqual(rec["story"], {"action": "none"})

    def test_the_SERVER_model_id_wins_over_the_flag(self):
        # ⚠️ A run pointed at a server holding a different model would
        # otherwise record a name nobody served — and Tier 4 is about
        # comparing models.
        rec = analyze_local.record_from(
            {"path": "p", "domain": "x.bg"}, {"url": "u"},
            {"text": "{}", "model": "gemma-4-12b-q4"}, "whatever", 1, [])
        self.assertEqual(rec["model"], "gemma-4-12b-q4")

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


if __name__ == "__main__":
    unittest.main()
