#!/usr/bin/env python3
"""Regression suite for save_articles.py — the acquisition half.

Run:  python3 news/scripts/test_save_articles.py

Same convention as test_analyze_articles.py: DATA_BG_ROOT points the script at
a throwaway tree, so nothing here touches the real corpus, and nothing here
touches the network — the saver's `--prefetched` mode takes page HTML from a
file, which is exactly the seam a test needs.

The suite covers the BODY GATE and its ledger. The extraction fixtures that
exercise BodyExtractor against real page shapes live alongside in
tests/fixtures/ and are driven by the extraction cases at the foot of this
file.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SAVER = SCRIPT_DIR / "save_articles.py"


def run_saver(root: Path, domain: str, *args: str):
    """Invoke the saver as a subprocess against a throwaway data root and
    return (exit_code, parsed_stdout_json). Asserting on the PARSED object is
    the point: the module's contract is exactly one JSON object on stdout on
    every path, and a traceback breaks that contract before it breaks
    anything else."""
    env = dict(os.environ, DATA_BG_ROOT=str(root))
    proc = subprocess.run([sys.executable, str(SAVER), domain, *args],
                          capture_output=True, text=True, env=env, timeout=120)
    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:  # pragma: no cover - failure path
        raise AssertionError(
            f"saver printed unparseable stdout (exit {proc.returncode}): "
            f"{proc.stdout[:400]!r} / stderr {proc.stderr[:400]!r}") from exc
    return proc.returncode, payload


def page(title: str, body_paras: list[str], *, jsonld: bool = True) -> str:
    """A minimal but realistic article page: JSON-LD Article node (which alone
    satisfies the ARTICLE gate) plus og:type, plus whatever paragraphs the
    caller wants. With body_paras=[] this is precisely the shape that used to
    be stored as a complete article with no body."""
    ld = ""
    if jsonld:
        ld = ('<script type="application/ld+json">'
              + json.dumps({"@context": "https://schema.org",
                            "@type": "NewsArticle", "headline": title,
                            "datePublished": "2026-08-24T09:00:00+03:00"})
              + "</script>")
    paras = "".join(f"<p>{p}</p>" for p in body_paras)
    return (f"<html><head><title>{title} - Тестови Новини</title>"
            f'<meta property="og:type" content="article">'
            f'<meta property="og:title" content="{title}">'
            f"{ld}</head><body><article>{paras}</article></body></html>")


def write_prefetched(path: Path, items: list[tuple[str, str]]) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        for url, html in items:
            fh.write(json.dumps({"url": url, "html": html},
                                ensure_ascii=False) + "\n")


PROSE = ("Общинският съвет прие решението с 34 гласа „за“ и 11 „против“ "
         "на извънредното заседание в понеделник следобед. ")


class BodyGateUnit(unittest.TestCase):
    """body_is_title() in isolation — the comparison, not the plumbing."""

    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(SCRIPT_DIR))
        import save_articles  # noqa: E402
        cls.sa = save_articles

    def test_exact_echo_is_caught(self):
        t = "Работа на 4 часа - за малцина е избор"
        self.assertTrue(self.sa.body_is_title(t, t))

    def test_echo_with_brand_tail_is_caught(self):
        self.assertTrue(self.sa.body_is_title(
            "37 души са гласували повече от веднъж - Новини Варна",
            "37 души са гласували повече от веднъж"))

    def test_entity_escaped_title_still_matches_decoded_body(self):
        """The body arrives decoded (convert_charrefs) while a JSON-LD headline
        does not — so without a shared escaping convention the gate misses the
        very shape it exists to catch, and records the wrong reason."""
        self.assertTrue(self.sa.body_is_title(
            "Показаха участниците в „Ергенът“ - Новини Варна",
            "Показаха участниците в &#8222;Ергенът&#8220;"))

    def test_zero_width_characters_do_not_defeat_the_match(self):
        self.assertTrue(self.sa.body_is_title(
            "\ufeffЗаловиха убиеца\u200b на лешоядите\u200b",
            "Заловиха убиеца на лешоядите"))

    def test_real_article_repeating_its_headline_is_not_an_echo(self):
        title = "Заловиха убиеца на лешоядите"
        self.assertFalse(self.sa.body_is_title(title + "\n\n" + PROSE * 5,
                                               title))

    def test_empty_sides_are_never_an_echo(self):
        self.assertFalse(self.sa.body_is_title("", "Заглавие"))
        self.assertFalse(self.sa.body_is_title("Текст", ""))
        self.assertFalse(self.sa.body_is_title(None, None))

    def test_unrelated_body_is_not_an_echo(self):
        self.assertFalse(self.sa.body_is_title(PROSE, "Съвсем друго заглавие"))

    def test_echo_slack_scales_with_the_floor(self):
        """The slack must never approach the floor the operator chose, or the
        --min-body escape hatch throws away the briefs it exists to admit."""
        self.assertEqual(self.sa.echo_slack_for(400), 60)
        self.assertEqual(self.sa.echo_slack_for(80), 20)
        self.assertEqual(self.sa.echo_slack_for(0), 0)
        title = "Съдът гледа делото"
        brief = title + " Заседанието е насрочено за днес в 14 часа."
        self.assertTrue(self.sa.body_is_title(brief, title, slack=60))
        self.assertFalse(
            self.sa.body_is_title(brief, title,
                                  slack=self.sa.echo_slack_for(80)))


class BodyGateEndToEnd(unittest.TestCase):
    """The gate as the saver actually applies it, via --prefetched."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="save-articles-test-"))
        (self.root / "news" / "data").mkdir(parents=True)
        self.feed = self.root / "prefetched.jsonl"

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def data_dir(self, domain):
        return self.root / "news" / "data" / domain

    def ledger(self, domain):
        path = self.root / "news" / "data" / "_rejected" / f"{domain}.jsonl"
        if not path.exists():
            return []
        return [json.loads(x) for x in
                path.read_text(encoding="utf-8").splitlines() if x.strip()]

    def test_headline_only_page_is_rejected_not_saved(self):
        """The defect this gate exists for: JSON-LD + a headline + no body
        passed the ARTICLE gate and was stored as a complete record."""
        write_prefetched(self.feed, [
            ("https://ex.bg/a/1", page("Иран осъди новите санкции", [])),
        ])
        code, out = run_saver(self.root, "ex.bg", "5",
                              f"--prefetched={self.feed}")
        self.assertEqual(out["saved"], 0)
        self.assertEqual(out["rejected"], 1)
        self.assertEqual(code, 4, "nothing saved this run")
        self.assertIn("title_as_body", out["failed"][0]["detail"])
        self.assertFalse(self.data_dir("ex.bg").exists(),
                         "a fully-rejected domain leaves no empty folder")
        self.assertFalse(out["dir_exists"])

    def test_short_body_is_rejected_as_thin(self):
        write_prefetched(self.feed, [
            ("https://ex.bg/a/2", page("Кратко", ["Съвсем малко текст тук."])),
        ])
        _, out = run_saver(self.root, "ex.bg", "5", f"--prefetched={self.feed}")
        self.assertEqual(out["rejected"], 1)
        self.assertIn("thin_body", out["failed"][0]["detail"])
        self.assertEqual(self.ledger("ex.bg")[0]["reason"], "thin_body")

    def test_real_article_is_saved(self):
        write_prefetched(self.feed, [
            ("https://ex.bg/a/3", page("Истинска статия", [PROSE * 5])),
        ])
        code, out = run_saver(self.root, "ex.bg", "5",
                              f"--prefetched={self.feed}")
        self.assertEqual((code, out["saved"], out["rejected"]), (0, 1, 0))
        self.assertTrue(out["dir_exists"])
        files = list(self.data_dir("ex.bg").glob("*.json"))
        self.assertEqual(len(files), 1)
        rec = json.loads(files[0].read_text(encoding="utf-8"))
        self.assertGreaterEqual(rec["content_chars"], 400)

    def test_min_body_override_admits_a_brief(self):
        brief = "Заседанието е насрочено за днес в 14 часа в зала 2 на съда."
        write_prefetched(self.feed, [
            ("https://ex.bg/a/4", page("Съдът заседава", [brief])),
        ])
        _, strict = run_saver(self.root, "ex.bg", "5",
                              f"--prefetched={self.feed}")
        self.assertEqual(strict["rejected"], 1)
        _, loose = run_saver(self.root, "ex.bg", "5", "--min-body=40",
                             "--retry-rejected", f"--prefetched={self.feed}")
        self.assertEqual(loose["saved"], 1)
        self.assertEqual(loose["min_body"], 40)

    def test_ledger_skips_on_rerun_and_is_counted(self):
        write_prefetched(self.feed, [
            ("https://ex.bg/a/5", page("Празна", [])),
        ])
        run_saver(self.root, "ex.bg", "5", f"--prefetched={self.feed}")
        _, out = run_saver(self.root, "ex.bg", "5", f"--prefetched={self.feed}")
        self.assertEqual(out["rejected"], 0, "not re-fetched")
        self.assertEqual(out["skipped_rejected"], 1,
                         "a ledger-skipped URL must be visible in the summary")
        self.assertIsNotNone(out["rejected_ledger"])

    def test_ledger_does_not_grow_on_repeated_retries(self):
        """--retry-rejected is the documented post-extractor-fix workflow, so
        it is exactly the path that must not append a duplicate every run."""
        write_prefetched(self.feed, [
            ("https://ex.bg/a/6", page("Пак празна", [])),
        ])
        for _ in range(3):
            run_saver(self.root, "ex.bg", "5", "--retry-rejected",
                      f"--prefetched={self.feed}")
        self.assertEqual(len(self.ledger("ex.bg")), 1)

    def test_retry_rejected_re_attempts_the_url(self):
        write_prefetched(self.feed, [
            ("https://ex.bg/a/7", page("Празна пак", [])),
        ])
        run_saver(self.root, "ex.bg", "5", f"--prefetched={self.feed}")
        _, out = run_saver(self.root, "ex.bg", "5", "--retry-rejected",
                           f"--prefetched={self.feed}")
        self.assertEqual(out["rejected"], 1)
        self.assertEqual(out["skipped_rejected"], 0)

    def test_stale_ledger_entry_is_retried_without_a_flag(self):
        """Rejection must not be permanent: the nightly sweep passes no flags,
        so without a TTL it could never recover from an over-firing gate."""
        write_prefetched(self.feed, [
            ("https://ex.bg/a/8", page("Празна трета", [])),
        ])
        run_saver(self.root, "ex.bg", "5", f"--prefetched={self.feed}")
        path = self.root / "news" / "data" / "_rejected" / "ex.bg.jsonl"
        entry = json.loads(path.read_text(encoding="utf-8").strip())
        entry["at"] = "2020-01-01T00:00:00+00:00"
        path.write_text(json.dumps(entry, ensure_ascii=False) + "\n",
                        encoding="utf-8")
        _, out = run_saver(self.root, "ex.bg", "5", f"--prefetched={self.feed}")
        self.assertEqual(out["skipped_rejected"], 0, "stale entry not skipped")
        self.assertEqual(out["rejected"], 1, "the URL was tried again")

    def test_torn_ledger_line_does_not_hide_the_rest(self):
        write_prefetched(self.feed, [
            ("https://ex.bg/a/9", page("Празна четвърта", [])),
        ])
        run_saver(self.root, "ex.bg", "5", f"--prefetched={self.feed}")
        path = self.root / "news" / "data" / "_rejected" / "ex.bg.jsonl"
        path.write_text("{not json\n" + path.read_text(encoding="utf-8"),
                        encoding="utf-8")
        _, out = run_saver(self.root, "ex.bg", "5", f"--prefetched={self.feed}")
        self.assertEqual(out["skipped_rejected"], 1)

    def test_entity_escaped_echo_records_the_right_reason(self):
        """A wrong reason in the ledger is what an operator reads when deciding
        whether to fix the extractor or lower the floor."""
        title = "Показаха участниците в &#8222;Ергенът&#8220;"
        html = (f"<html><head><title>{title}</title>"
                f'<meta property="og:type" content="article">'
                '<script type="application/ld+json">'
                + json.dumps({"@type": "NewsArticle", "headline": title})
                + "</script></head><body><article>"
                "<p>Показаха участниците в „Ергенът“ - Тестови Новини</p>"
                "</article></body></html>")
        write_prefetched(self.feed, [("https://ex.bg/a/10", html)])
        _, out = run_saver(self.root, "ex.bg", "5",
                           f"--prefetched={self.feed}")
        self.assertEqual(self.ledger("ex.bg")[0]["reason"], "title_as_body")

    def test_jsonld_entities_are_unescaped_in_the_saved_record(self):
        title = "Кметът обяви &#8222;План Б&#8220; за водата"
        html = (f"<html><head><title>x</title>"
                f'<meta property="og:type" content="article">'
                '<script type="application/ld+json">'
                + json.dumps({"@type": "NewsArticle", "headline": title,
                              "description": "Кратко &amp; ясно"})
                + "</script></head><body><article>"
                f"<p>{PROSE * 5}</p></article></body></html>")
        write_prefetched(self.feed, [("https://ex.bg/a/11", html)])
        _, out = run_saver(self.root, "ex.bg", "5",
                           f"--prefetched={self.feed}")
        self.assertEqual(out["saved"], 1)
        rec = json.loads(next(self.data_dir("ex.bg").glob("*.json"))
                         .read_text(encoding="utf-8"))
        self.assertEqual(rec["title"], "Кметът обяви „План Б“ за водата")
        self.assertEqual(rec["description"], "Кратко & ясно")


class CliContract(unittest.TestCase):
    """Every path prints exactly one JSON object — save_all_direct.sh reads an
    empty stdout as 'skip this domain silently', so a traceback drops a whole
    domain from the sweep log with no diagnostic anywhere."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="save-articles-cli-"))
        (self.root / "news" / "data").mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_bad_min_body_is_a_json_error_not_a_traceback(self):
        for bad in ("abc", "", "-5", "4.5"):
            with self.subTest(value=bad):
                code, out = run_saver(self.root, "ex.bg", f"--min-body={bad}")
                self.assertEqual(code, 1)
                self.assertEqual(out["error"], "usage")

    def test_bad_delay_is_a_json_error(self):
        code, out = run_saver(self.root, "ex.bg", "--delay=xyz")
        self.assertEqual((code, out["error"]), (1, "usage"))

    def test_zero_min_body_is_accepted_as_disabling_the_floor(self):
        feed = self.root / "p.jsonl"
        write_prefetched(feed, [
            ("https://ex.bg/a/12", page("Заглавие", ["Мъничко."])),
        ])
        _, out = run_saver(self.root, "ex.bg", "5", "--min-body=0",
                           f"--prefetched={feed}")
        self.assertEqual(out["min_body"], 0)
        self.assertEqual(out["saved"], 1)

    def test_missing_urls_file_is_a_json_error(self):
        code, out = run_saver(self.root, "ex.bg", "5",
                              "--urls-file=/nope/missing.txt")
        self.assertEqual((code, out["error"]), (1, "usage"))

    def test_missing_prefetched_file_is_a_json_error(self):
        code, out = run_saver(self.root, "ex.bg", "5",
                              "--prefetched=/nope/missing.jsonl")
        self.assertEqual((code, out["error"]), (1, "usage"))

    def test_data_bg_root_is_honoured(self):
        """Without this the script cannot be pointed at a throwaway tree, which
        is what made it untestable in the first place."""
        feed = self.root / "p.jsonl"
        write_prefetched(feed, [
            ("https://ex.bg/a/13", page("Истинска", [PROSE * 5])),
        ])
        run_saver(self.root, "ex.bg", "5", f"--prefetched={feed}")
        self.assertTrue((self.root / "news" / "data" / "ex.bg").is_dir())


if __name__ == "__main__":
    unittest.main(verbosity=2)
