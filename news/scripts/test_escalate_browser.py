#!/usr/bin/env python3
"""escalate_browser.sh — the page-level browser fallback's control flow.

Run:  python3 news/scripts/test_escalate_browser.py

`node` and `save_articles.py` are stubbed on PATH / in a temp tree, so
nothing here launches a browser or touches the network. What is tested is
what the bugs were in: an empty failure list writing invalid JSON into the
sweep, a cooldown that hides a recoverable outlet, and the budgets that keep
an hourly job bounded.
"""

import json
import os
import shutil
import stat
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

NEWS = Path(__file__).resolve().parent.parent


def write_exec(path: Path, body: str) -> None:
    path.write_text("#!/bin/bash\n" + body, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


class Escalate(unittest.TestCase):
    def setUp(self):
        self.td = Path(tempfile.mkdtemp(prefix="escalate_"))
        self.addCleanup(shutil.rmtree, self.td, True)
        # A news/ tree holding just what the script touches.
        self.news = self.td / "news"
        (self.news / "scripts").mkdir(parents=True)
        (self.news / "data" / "_browser").mkdir(parents=True)
        shutil.copy2(NEWS / "scripts/escalate_browser.sh",
                     self.news / "scripts/escalate_browser.sh")
        # ⚠️ The REAL rule, not a stub. What a failure MEANS is the thing
        # under test here (a gate decision must never be escalated), so a
        # local copy of the predicate would test itself. save_articles.py
        # stays stubbed — that one is only invoked to observe the call.
        shutil.copy2(NEWS / "scripts/failure_rules.py",
                     self.news / "scripts/failure_rules.py")
        self.calls = self.td / "calls.log"
        self.bin = self.td / "bin"
        self.bin.mkdir()
        self.set_node(prefetched=2, challenged=0)
        self.set_save(saved=2)
        self.env = {**os.environ, "PATH": f"{self.bin}:{os.environ['PATH']}",
                    "NEWS_ESCALATE_PAGE_TIMEOUT": "5",
                    "NEWS_ESCALATE_ENTRY_TIMEOUT": "7"}

    def set_node(self, *, prefetched, challenged, crash=False):
        jsonl = self.news / "data/_browser/x.bg.retry.jsonl"
        # The URL file is deleted by the script's EXIT trap, so the stub is
        # the only place its contents can be observed — and WHICH urls are
        # passed is the whole assertion for the gate-decision filter.
        body = (f'echo "node $*" >> "{self.calls}"\n'
                'for a in "$@"; do case "$a" in --prefetch-urls=*)\n'
                f'  sed "s/^/url /" "${{a#*=}}" >> "{self.calls}" ;; esac; done\n')
        if crash:
            body += "exit 1\n"
        else:
            if prefetched:
                body += f'printf \'{{"url": "u", "html": "h"}}\\n\' > "{jsonl}"\n'
            body += ('printf \'{"domain": "x.bg", "mode": "browser_prefetch", '
                     f'"prefetched": {prefetched}, "challenged": {challenged}, '
                     f'"jsonl_path": "{jsonl}"}}\\n\'\n')
        write_exec(self.bin / "node", body)

    def set_save(self, *, saved):
        # Run as `python3 scripts/save_articles.py`, so the stub is Python.
        (self.news / "scripts/save_articles.py").write_text(
            "import json, sys\n"
            f"open({str(self.calls)!r}, 'a').write('save ' + ' '.join(sys.argv[1:]) + '\\n')\n"
            f"print(json.dumps({{'domain': 'x.bg', 'saved': {saved}, 'failed': []}}))\n",
            encoding="utf-8")

    def run_escalate(self, payload: dict, **env):
        out = subprocess.run(
            ["bash", str(self.news / "scripts/escalate_browser.sh"), "x.bg", "5"],
            input=json.dumps(payload), text=True, capture_output=True,
            env={**self.env, **env}, timeout=120)
        self.assertEqual(out.returncode, 0, out.stderr)
        return out.stdout

    def ledger(self) -> dict:
        path = self.news / "data/_browser/x.bg.escalation.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}

    def test_nothing_to_escalate_prints_nothing(self):
        # ⚠️ `grep -c` prints 0 AND exits 1, so `|| echo 0` made COUNT "0\\n0":
        # every test errored, the early exit never fired, and two lines of
        # INVALID JSON went into the sweep for each clean domain (18 of 34
        # rows in the 2026-09-20 03:00 sweep).
        for payload in ({"saved": 18, "failed": []}, {"saved": 1}, {}):
            with self.subTest(payload=payload):
                self.assertEqual(self.run_escalate(payload), "")
        self.assertFalse(self.calls.exists(), "no browser for a clean domain")

    def test_every_line_it_prints_is_one_json_object(self):
        for setup in (lambda: None,
                      lambda: self.set_node(prefetched=0, challenged=2),
                      lambda: self.set_node(prefetched=0, challenged=0,
                                            crash=True)):
            setup()
            out = self.run_escalate({"failed": [{"url": "https://x.bg/a"}]})
            lines = [l for l in out.splitlines() if l.strip()]
            self.assertEqual(len(lines), 1, out)
            self.assertEqual(json.loads(lines[0])["mode"], "browser_escalation")

    def test_it_fetches_the_failed_urls_and_saves_them(self):
        out = self.run_escalate({"failed": [{"url": "https://x.bg/a"},
                                            {"url": "https://x.bg/b"},
                                            "not-a-url"]})
        row = json.loads(out)
        self.assertEqual((row["saved"], row["escalated"]), (2, 2))
        calls = self.calls.read_text(encoding="utf-8")
        self.assertIn("--prefetch-urls=", calls)
        # The entry page and an article page get DIFFERENT budgets.
        self.assertIn("--timeout=7", calls)
        self.assertIn("--page-timeout=5", calls)
        self.assertIn("--prefetched=", calls)

    def test_a_gate_decision_is_never_escalated(self):
        # ⚠️ A page refused on its CONTENT (non_article_page, thin_body,
        # off_domain) has been decided against — re-fetching identical bytes
        # in a browser cannot change the answer. Taking `failed` verbatim
        # spent the whole budget on them and then cooled the domain down for
        # "yielding nothing", which reads as an outlet block and is not one.
        # Measured 2026-09-20: all 5 escalated dnes.bg URLs were recipes and
        # horoscopes, and plovdiv24.bg's were its own section pages.
        # `merge_retry_queue` has always known this; this script did not.
        payload = {"failed": [
            {"url": "https://x.bg/recipe",
             "detail": "non_article_page (no Article JSON-LD, og:type != "
                       "article, and body failed the paragraph gate)"},
            {"url": "https://x.bg/thin", "detail": "thin_body (120 chars)"},
            {"url": "https://x.bg/off", "detail": "off_domain"},
            {"url": "https://x.bg/blocked", "detail": "HTTP 403"},
        ]}
        row = json.loads(self.run_escalate(payload))
        self.assertEqual(row["escalated"], 1, "only the 403 is recoverable")
        calls = self.calls.read_text(encoding="utf-8")
        self.assertIn("url https://x.bg/blocked", calls)
        for decided in ("/recipe", "/thin", "/off"):
            self.assertNotIn(f"url https://x.bg{decided}", calls, calls)

    def test_a_domain_whose_failures_are_all_decisions_never_escalates(self):
        # And it must exit BEFORE the browser and before the ledger: an
        # empty URL set is "nothing to do", not a refusal to cool down for.
        payload = {"failed": [
            {"url": "https://x.bg/a", "detail": "non_article_page (homepage)"},
            {"url": "https://x.bg/b", "detail": "title_as_body"},
        ]}
        self.assertEqual(self.run_escalate(payload), "")
        self.assertFalse(self.calls.exists(), "no browser for decisions")
        self.assertEqual(self.ledger(), {}, "and no cooldown")

    def test_the_url_cap_bounds_one_domain(self):
        payload = {"failed": [{"url": f"https://x.bg/{i}"} for i in range(50)]}
        row = json.loads(self.run_escalate(payload, NEWS_ESCALATE_MAX_URLS="3"))
        self.assertEqual(row["escalated"], 3)

    def test_a_refusal_earns_a_cooldown_and_a_yield_clears_it(self):
        self.set_node(prefetched=0, challenged=2)
        self.run_escalate({"failed": [{"url": "https://x.bg/a"}]})
        self.assertEqual(self.ledger()["saved"], 0)

        skipped = json.loads(self.run_escalate(
            {"failed": [{"url": "https://x.bg/a"}]}))
        self.assertEqual(skipped["skipped"], "cooldown")
        self.assertGreater(skipped["seconds_left"], 0)

        # A zero cooldown lets it try again; a yield clears the ledger.
        self.set_node(prefetched=1, challenged=0)
        row = json.loads(self.run_escalate({"failed": [{"url": "https://x.bg/a"}]},
                                           NEWS_ESCALATE_COOLDOWN_S="0"))
        self.assertEqual(row["saved"], 2)
        self.assertEqual(self.ledger()["saved"], 2)
        again = json.loads(self.run_escalate({"failed": [{"url": "https://x.bg/a"}]}))
        self.assertNotIn("skipped", again)

    def test_our_own_failure_never_ices_a_domain(self):
        # ⚠️ A cooldown must mean "this outlet refuses us". A crashed harvest,
        # a timeout, or a save that failed says nothing about the outlet —
        # icing it for six hours on that basis hides a recoverable domain.
        for setup in (lambda: self.set_node(prefetched=0, challenged=0,
                                            crash=True),
                      lambda: self.set_node(prefetched=0, challenged=0)):
            with self.subTest():
                if self.ledger():
                    (self.news / "data/_browser/x.bg.escalation.json").unlink()
                setup()
                self.run_escalate({"failed": [{"url": "https://x.bg/a"}]})
                self.assertEqual(self.ledger(), {})

    def test_a_stale_cooldown_expires(self):
        (self.news / "data/_browser/x.bg.escalation.json").write_text(
            json.dumps({"at": time.time() - 10_000, "saved": 0}),
            encoding="utf-8")
        row = json.loads(self.run_escalate({"failed": [{"url": "https://x.bg/a"}]},
                                           NEWS_ESCALATE_COOLDOWN_S="60"))
        self.assertNotIn("skipped", row)


if __name__ == "__main__":
    unittest.main()
