#!/usr/bin/env python3
"""Regression suite for save_articles.py — the acquisition half.

Run:  python3 news/scripts/test_save_articles.py

Same convention as test_analyze_articles.py: DATA_BG_ROOT points the script at
a throwaway tree, so nothing here touches the real corpus, and nothing here
touches the network — the saver's `--prefetched` mode takes page HTML from a
file, which is exactly the seam a test needs.

The suite covers the BODY GATE, its rejection ledger, the page-HTML cache,
--reextract, and EXTRACTION against frozen real pages — one per failure class
this repo has actually met (see scripts/capture_fixtures.py for what each is
and why it is there).
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import gzip
import re
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SAVER = SCRIPT_DIR / "save_articles.py"
FIXTURE_DIR = SCRIPT_DIR / "tests" / "fixtures"


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
        brief = ("Заседанието е насрочено за днес от 14 часа в зала 2 на "
                 "Софийския градски съд, съобщиха от пресцентъра. Очаква се "
                 "да бъдат разпитани трима свидетели.")
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


class ReExtraction(unittest.TestCase):
    """--reextract: the mode that makes extractor work compounding.

    Dedupe is by stored URL, so before the HTML cache existed every
    improvement to BodyExtractor reached only articles saved AFTER it, and the
    only documented remedy — delete the folder and re-fetch — destroys
    articles a structurally stale source can never list again."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="save-articles-rx-"))
        (self.root / "news" / "data").mkdir(parents=True)
        self.feed = self.root / "prefetched.jsonl"

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def data_dir(self, domain="ex.bg"):
        return self.root / "news" / "data" / domain

    def cache_dir(self, domain="ex.bg"):
        return self.root / "news" / "data" / "_html" / domain

    def records(self, domain="ex.bg"):
        return [json.loads(p.read_text(encoding="utf-8"))
                for p in sorted(self.data_dir(domain).glob("*.json"))]

    def seed(self, items):
        write_prefetched(self.feed, items)
        return run_saver(self.root, "ex.bg", "20", f"--prefetched={self.feed}")

    def test_html_is_cached_for_saved_articles(self):
        self.seed([("https://ex.bg/a/1", page("Статия", [PROSE * 5]))])
        self.assertEqual(len(list(self.cache_dir().glob("*.json.gz"))), 1)

    def test_html_is_cached_for_REJECTED_pages_too(self):
        """The whole point of caching before the gate: a rejected page is
        exactly the page a future extractor fix is meant to rescue."""
        self.seed([("https://ex.bg/a/2", page("Празна", []))])
        self.assertFalse(self.data_dir().exists())
        self.assertEqual(len(list(self.cache_dir().glob("*.json.gz"))), 1)

    def test_no_cache_flag_writes_nothing(self):
        write_prefetched(self.feed, [
            ("https://ex.bg/a/3", page("Статия", [PROSE * 5]))])
        run_saver(self.root, "ex.bg", "20", "--no-cache",
                  f"--prefetched={self.feed}")
        self.assertFalse(self.cache_dir().exists())

    def test_rejected_page_is_promoted_when_the_extractor_improves(self):
        """Simulates the real sequence: a page whose body the extractor could
        not reach is rejected and cached; the extractor improves; --reextract
        turns the cached page into a stored article with no network."""
        url = "https://ex.bg/a/4"
        # The body sits inside a subtree the extractor treats as junk, so it
        # is rejected on save — but the HTML is cached in full.
        buried = (f'<html><head><title>Заровена</title>'
                  f'<meta property="og:type" content="article">'
                  '<script type="application/ld+json">'
                  + json.dumps({"@type": "NewsArticle",
                                "headline": "Заровена"})
                  + f'</script></head><body><aside><p>{PROSE * 5}</p>'
                  '</aside></body></html>')
        _, out = self.seed([(url, buried)])
        self.assertEqual(out["rejected"], 1)
        # Rewrite the cache entry with the same page, body now reachable.
        cached = next(self.cache_dir().glob("*.json.gz"))
        import gzip as gz
        with gz.open(cached, "rt", encoding="utf-8") as fh:
            blob = json.load(fh)
        blob["html"] = blob["html"].replace("<aside>", "<article>").replace(
            "</aside>", "</article>")
        with gz.open(cached, "wt", encoding="utf-8") as fh:
            fh.write(json.dumps(blob, ensure_ascii=False))
        _, rx = run_saver(self.root, "ex.bg", "--reextract")
        self.assertEqual(rx["promoted"], 1)
        self.assertEqual(rx["fetched"], 0, "--reextract must not touch the network")
        self.assertEqual(len(self.records()), 1)

    def test_reextract_is_idempotent(self):
        self.seed([("https://ex.bg/a/5", page("Статия", [PROSE * 5]))])
        _, first = run_saver(self.root, "ex.bg", "--reextract")
        _, second = run_saver(self.root, "ex.bg", "--reextract")
        self.assertEqual(second["rewritten"], 0)
        self.assertEqual(second["unchanged"], 1)

    def test_reextract_refuses_to_shrink_a_good_body(self):
        """A re-extraction runs the CURRENT extractor. A regression in it must
        not quietly overwrite a corpus that was fine."""
        url = "https://ex.bg/a/6"
        self.seed([(url, page("Статия", [PROSE * 5]))])
        cached = next(self.cache_dir().glob("*.json.gz"))
        import gzip as gz
        with gz.open(cached, "rt", encoding="utf-8") as fh:
            blob = json.load(fh)
        blob["html"] = blob["html"].replace("<article>", "<aside>").replace(
            "</article>", "</aside>")
        with gz.open(cached, "wt", encoding="utf-8") as fh:
            fh.write(json.dumps(blob, ensure_ascii=False))
        _, rx = run_saver(self.root, "ex.bg", "--reextract")
        self.assertEqual(rx["shrunk_refused"], 1)
        self.assertEqual(rx["demoted"], 0)
        self.assertGreaterEqual(self.records()[0]["content_chars"], 400)

    def test_allow_shrink_demotes_a_record_below_the_gate(self):
        url = "https://ex.bg/a/7"
        self.seed([(url, page("Статия", [PROSE * 5]))])
        cached = next(self.cache_dir().glob("*.json.gz"))
        import gzip as gz
        with gz.open(cached, "rt", encoding="utf-8") as fh:
            blob = json.load(fh)
        blob["html"] = blob["html"].replace("<article>", "<aside>").replace(
            "</article>", "</aside>")
        with gz.open(cached, "wt", encoding="utf-8") as fh:
            fh.write(json.dumps(blob, ensure_ascii=False))
        _, rx = run_saver(self.root, "ex.bg", "--reextract", "--allow-shrink")
        self.assertEqual(rx["demoted"], 1)
        self.assertEqual(len(self.records()), 0,
                         "the corpus must not keep a record the current rules "
                         "would refuse to create")

    def test_reextract_without_cache_reports_no_html_and_fetches_nothing(self):
        """The pre-cache corpus: without --allow-fetch this must report rather
        than silently reach for the network."""
        self.data_dir().mkdir(parents=True)
        (self.data_dir() / "20260101-x-deadbeef.json").write_text(
            json.dumps({"domain": "ex.bg", "url": "https://ex.bg/old",
                        "title": "Стара", "content": PROSE * 5,
                        "content_chars": len(PROSE * 5), "published": None}),
            encoding="utf-8")
        _, rx = run_saver(self.root, "ex.bg", "--reextract")
        self.assertEqual(rx["no_html"], 1)
        self.assertEqual(rx["fetched"], 0)
        self.assertEqual(rx["rewritten"], 0)

    def test_reextract_rejects_incompatible_flags(self):
        code, out = run_saver(self.root, "ex.bg", "--reextract",
                              f"--prefetched={self.feed}")
        self.assertEqual((code, out["error"]), (1, "usage"))

    def test_corrupt_cache_entry_reads_as_absent(self):
        self.seed([("https://ex.bg/a/8", page("Статия", [PROSE * 5]))])
        next(self.cache_dir().glob("*.json.gz")).write_bytes(b"not gzip at all")
        _, rx = run_saver(self.root, "ex.bg", "--reextract")
        self.assertEqual(rx["no_html"], 1)
        self.assertEqual(len(self.records()), 1, "the record survives")


class ReExtractionGuards(unittest.TestCase):
    """The three ways --reextract could destroy a corpus, each pinned.

    Every test here is a MUTATION test in the useful sense: remove the guard it
    names and it fails. The three defects were live before these existed."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="save-articles-guard-"))
        (self.root / "news" / "data").mkdir(parents=True)
        self.feed = self.root / "prefetched.jsonl"

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def data_dir(self, domain="ex.bg"):
        return self.root / "news" / "data" / domain

    def cache_entry(self, domain="ex.bg"):
        return next((self.root / "news" / "data" / "_html" / domain)
                    .glob("*.json.gz"))

    def rewrite_cache(self, mutate, domain="ex.bg"):
        import gzip as gz
        path = self.cache_entry(domain)
        with gz.open(path, "rt", encoding="utf-8") as fh:
            blob = json.load(fh)
        blob["html"] = mutate(blob["html"])
        with gz.open(path, "wt", encoding="utf-8") as fh:
            fh.write(json.dumps(blob, ensure_ascii=False))

    def records(self, domain="ex.bg"):
        return [json.loads(p.read_text(encoding="utf-8"))
                for p in sorted(self.data_dir(domain).glob("*.json"))]

    def test_bare_reextract_does_not_demote_a_lowered_floor_corpus(self):
        """Both halves are documented workflows: save a briefs source at
        --min-body=100, then re-extract after an extractor fix. Re-judging
        against the DEFAULT 400 deleted the entire corpus at exit 0."""
        brief = ("Заседанието е насрочено за днес от 14 часа в зала 2 на "
                 "Софийския градски съд, съобщиха от пресцентъра. Очаква се "
                 "да бъдат разпитани трима свидетели.")
        write_prefetched(self.feed, [
            (f"https://ex.bg/b/{i}", page(f"Кратко {i}", [brief]))
            for i in range(3)])
        _, saved = run_saver(self.root, "ex.bg", "20", "--min-body=100",
                             f"--prefetched={self.feed}")
        self.assertEqual(saved["saved"], 3)
        self.assertTrue(all(r["gate_min_body"] == 100 for r in self.records()),
                        "the floor must be persisted on the record")
        _, rx = run_saver(self.root, "ex.bg", "--reextract")
        self.assertEqual(rx["demoted"], 0)
        self.assertEqual(len(self.records()), 3)

    def test_an_explicit_floor_on_the_reextract_still_wins(self):
        brief = ("Заседанието е насрочено за днес от 14 часа в зала 2 на "
                 "Софийския градски съд, съобщиха от пресцентъра. Очаква се "
                 "да бъдат разпитани трима свидетели.")
        write_prefetched(self.feed, [
            ("https://ex.bg/b/9", page("Кратко", [brief]))])
        run_saver(self.root, "ex.bg", "20", "--min-body=100",
                  f"--prefetched={self.feed}")
        _, rx = run_saver(self.root, "ex.bg", "--reextract", "--min-body=400")
        self.assertEqual(rx["demoted"], 1)
        self.assertEqual(len(self.records()), 0)

    def test_allow_fetch_refuses_a_page_that_is_a_different_article(self):
        """A character count cannot tell 'the extractor improved' from 'this
        URL now serves something else' — measured, a longer 404 page replaced
        a good record."""
        url = "https://ex.bg/b/10"
        write_prefetched(self.feed, [(url, page("Истинско заглавие",
                                                [PROSE * 5]))])
        run_saver(self.root, "ex.bg", "20", f"--prefetched={self.feed}")
        self.rewrite_cache(lambda h: page("Страницата не е намерена",
                                          [PROSE * 9]))
        _, rx = run_saver(self.root, "ex.bg", "--reextract", "--allow-fetch")
        self.assertEqual(rx["identity_refused"], 1)
        self.assertEqual(rx["rewritten"], 0)
        self.assertEqual(self.records()[0]["title"], "Истинско заглавие")

    def test_identity_guard_allows_a_brand_tail_change(self):
        url = "https://ex.bg/b/11"
        write_prefetched(self.feed, [(url, page("Заглавие", [PROSE * 5]))])
        run_saver(self.root, "ex.bg", "20", f"--prefetched={self.feed}")
        self.rewrite_cache(lambda h: h.replace("<p>", "<p>Нов увод. ", 1))
        _, rx = run_saver(self.root, "ex.bg", "--reextract", "--allow-fetch")
        self.assertEqual(rx["identity_refused"], 0)
        self.assertEqual(rx["rewritten"], 1)

    def test_demote_keeps_the_record_when_the_ledger_write_fails(self):
        """Unlinking first loses the URL from the corpus AND the ledger at
        once, orphaning its cached HTML with nothing left that knows the page
        was ever seen."""
        url = "https://ex.bg/b/12"
        write_prefetched(self.feed, [(url, page("Заглавие", [PROSE * 5]))])
        run_saver(self.root, "ex.bg", "20", f"--prefetched={self.feed}")
        self.rewrite_cache(lambda h: h.replace("<article>", "<aside>")
                                      .replace("</article>", "</aside>"))
        ledger_dir = self.root / "news" / "data" / "_rejected"
        shutil.rmtree(ledger_dir, ignore_errors=True)
        ledger_dir.write_text("not a directory", encoding="utf-8")
        try:
            _, rx = run_saver(self.root, "ex.bg", "--reextract",
                              "--allow-shrink")
            self.assertEqual(rx["demoted"], 0)
            self.assertEqual(len(self.records()), 1, "record survives")
            self.assertTrue(any("ledger write failed" in f["detail"]
                                for f in rx["failed"]))
        finally:
            ledger_dir.unlink()

    def test_demote_removes_the_analysis_sidecar(self):
        url = "https://ex.bg/b/13"
        write_prefetched(self.feed, [(url, page("Заглавие", [PROSE * 5]))])
        run_saver(self.root, "ex.bg", "20", f"--prefetched={self.feed}")
        name = next(self.data_dir().glob("*.json")).name
        side = (self.root / "news" / "data" / "analysis" / "articles"
                / "ex.bg" / name)
        side.parent.mkdir(parents=True, exist_ok=True)
        side.write_text('{"url":"%s"}' % url, encoding="utf-8")
        self.rewrite_cache(lambda h: h.replace("<article>", "<aside>")
                                      .replace("</article>", "</aside>"))
        run_saver(self.root, "ex.bg", "--reextract", "--allow-shrink")
        self.assertFalse(side.exists(),
                         "an analysis for an article the corpus no longer "
                         "holds is an orphan")

    def test_rename_moves_the_record_and_its_sidecar(self):
        """When the publish date changes, article_filename changes with it —
        so the corpus file is renamed and the sidecar has to follow."""
        url = "https://ex.bg/b/14"
        write_prefetched(self.feed, [(url, page("Заглавие", [PROSE * 5]))])
        run_saver(self.root, "ex.bg", "20", f"--prefetched={self.feed}")
        old_name = next(self.data_dir().glob("*.json")).name
        self.assertTrue(old_name.startswith("20260824"), old_name)
        side = (self.root / "news" / "data" / "analysis" / "articles"
                / "ex.bg" / old_name)
        side.parent.mkdir(parents=True, exist_ok=True)
        side.write_text('{"url":"%s"}' % url, encoding="utf-8")
        self.rewrite_cache(lambda h: h.replace("2026-08-24T09:00:00+03:00",
                                               "2026-07-02T09:00:00+03:00"))
        _, rx = run_saver(self.root, "ex.bg", "--reextract")
        self.assertEqual(rx["rewritten"], 1)
        names = [p.name for p in self.data_dir().glob("*.json")]
        self.assertEqual(len(names), 1, "the old filename must not survive")
        self.assertTrue(names[0].startswith("20260702"), names)
        self.assertFalse(side.exists())
        self.assertTrue(((self.root / "news" / "data" / "analysis" / "articles"
                          / "ex.bg" / names[0]).exists()))

    def test_idempotent_after_a_REAL_rewrite(self):
        """The earlier idempotence test never produces a rewrite, so it never
        reaches the comparison that excludes reextracted_at — removing that
        exclusion made every re-run report every record as rewritten for ever,
        and the test still passed."""
        url = "https://ex.bg/b/15"
        write_prefetched(self.feed, [(url, page("Заглавие", [PROSE * 5]))])
        run_saver(self.root, "ex.bg", "20", f"--prefetched={self.feed}")
        self.rewrite_cache(lambda h: h.replace("<p>", "<p>Нов увод. ", 1))
        _, first = run_saver(self.root, "ex.bg", "--reextract")
        self.assertEqual(first["rewritten"], 1)
        self.assertIn("reextracted_at", self.records()[0])
        _, second = run_saver(self.root, "ex.bg", "--reextract")
        self.assertEqual(second["rewritten"], 0)
        self.assertEqual(second["unchanged"], 1)

    def test_promotes_a_rejection_older_than_the_ledger_ttl(self):
        """A rejection older than the 30-day TTL is exactly the one most
        likely to predate the extractor fix being applied, so pass 2 must read
        the ledger WITHOUT the TTL."""
        url = "https://ex.bg/b/16"
        buried = (f'<html><head><title>Заровена</title>'
                  f'<meta property="og:type" content="article">'
                  '<script type="application/ld+json">'
                  + json.dumps({"@type": "NewsArticle", "headline": "Заровена"})
                  + f'</script></head><body><aside><p>{PROSE * 5}</p>'
                  '</aside></body></html>')
        write_prefetched(self.feed, [(url, buried)])
        run_saver(self.root, "ex.bg", "20", f"--prefetched={self.feed}")
        ledger = self.root / "news" / "data" / "_rejected" / "ex.bg.jsonl"
        entry = json.loads(ledger.read_text(encoding="utf-8").strip())
        entry["at"] = "2020-01-01T00:00:00+00:00"
        ledger.write_text(json.dumps(entry, ensure_ascii=False) + "\n",
                          encoding="utf-8")
        self.rewrite_cache(lambda h: h.replace("<aside>", "<article>")
                                      .replace("</aside>", "</article>"))
        _, rx = run_saver(self.root, "ex.bg", "--reextract")
        self.assertEqual(rx["promoted"], 1)

    def test_exit_code_is_stable_across_identical_runs(self):
        write_prefetched(self.feed, [
            ("https://ex.bg/b/17", page("Заглавие", [PROSE * 5]))])
        run_saver(self.root, "ex.bg", "20", f"--prefetched={self.feed}")
        codes = [run_saver(self.root, "ex.bg", "--reextract")[0]
                 for _ in range(3)]
        self.assertEqual(codes, [0, 0, 0])

    def test_prune_cache_removes_only_orphans(self):
        write_prefetched(self.feed, [
            ("https://ex.bg/b/18", page("Заглавие", [PROSE * 5]))])
        run_saver(self.root, "ex.bg", "20", f"--prefetched={self.feed}")
        cache_dir = self.root / "news" / "data" / "_html" / "ex.bg"
        (cache_dir / "deadbeefdeadbeef.json.gz").write_bytes(b"orphan")
        _, rx = run_saver(self.root, "ex.bg", "--reextract", "--prune-cache")
        self.assertEqual(rx["cache_pruned"], 1)
        self.assertEqual(len(list(cache_dir.glob("*.json.gz"))), 1)

    def test_no_cache_is_honoured_by_reextract(self):
        self.data_dir().mkdir(parents=True)
        (self.data_dir() / "20260101-x-deadbeef.json").write_text(
            json.dumps({"domain": "ex.bg", "url": "https://ex.bg/b/19",
                        "title": "Стара", "content": PROSE * 5,
                        "content_chars": len(PROSE * 5), "published": None}),
            encoding="utf-8")
        code, rx = run_saver(self.root, "ex.bg", "--reextract",
                             "--allow-fetch", "--no-cache")
        # No network in tests, so the fetch fails — the point is that the flag
        # is accepted and no cache directory appears.
        self.assertFalse((self.root / "news" / "data" / "_html").exists())


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


class CharsetDecoding(unittest.TestCase):
    """decode_html against real byte sequences.

    The fixture files are stored DECODED, so nothing in ExtractionFixtures can
    reach this function — a mutation replacing the cp1251 fallback with utf-8
    survived the whole fixture suite. Mojibake passes every length check and
    every field check while being unreadable, so it needs its own test on
    bytes."""

    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(SCRIPT_DIR))
        import save_articles  # noqa: E402
        cls.sa = save_articles

    BG = "Общинският съвет прие решението с 34 гласа „за“"

    def test_cp1251_body_with_no_declared_charset(self):
        """moreto.net: windows-1251 is still alive. Undeclared, so only the
        decode fallback saves it."""
        raw = self.BG.replace("„", '"').replace("“", '"').encode("cp1251")
        self.assertIn("Общинският", self.sa.decode_html(raw))

    def test_content_type_charset_wins(self):
        raw = "Здравей".encode("cp1251")
        self.assertEqual(
            self.sa.decode_html(raw, "text/html; charset=windows-1251"),
            "Здравей")

    def test_meta_charset_sniff(self):
        raw = (b'<html><head><meta charset="windows-1251"></head><body>'
               + "Здравей".encode("cp1251") + b"</body></html>")
        self.assertIn("Здравей", self.sa.decode_html(raw))

    def test_utf8_is_preferred_when_valid(self):
        raw = self.BG.encode("utf-8")
        self.assertEqual(self.sa.decode_html(raw), self.BG)

    def test_a_bogus_declared_charset_falls_through(self):
        raw = self.BG.encode("utf-8")
        self.assertEqual(
            self.sa.decode_html(raw, "text/html; charset=x-nonexistent"),
            self.BG)


class ExtractionFixtures(unittest.TestCase):
    """BodyExtractor against frozen REAL pages, one per failure class.

    Every heuristic in that extractor was learned from a specific page —
    windows-1251 on moreto.net, the iubenda cookie banner in glasove.com's
    rendered DOM, the `with-sidebar` class that names the MAIN column and once
    silently zeroed every article on that domain. None of it was pinned, so
    the only way to learn whether a change broke something was a 4,700-page
    sweep that reports a number moved and cannot say which edge did it.

    The expectations are BANDS plus the gate verdict, not exact character
    counts: an exact count breaks on any cosmetic change to the page and
    teaches people to re-baseline without reading. What the pipeline acts on
    is which side of the gate a page lands, and roughly how much body came
    out."""

    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(SCRIPT_DIR))
        import save_articles  # noqa: E402
        cls.sa = save_articles
        manifest = FIXTURE_DIR / "expectations.json"
        if not manifest.exists():  # pragma: no cover - fresh clone
            raise unittest.SkipTest(
                "no fixtures — run python3 news/scripts/capture_fixtures.py")
        cls.manifest = json.loads(manifest.read_text(encoding="utf-8"))

    def fixture_html(self, name):
        path = FIXTURE_DIR / f"{name}.html.gz"
        self.assertTrue(path.exists(), f"missing fixture {path}")
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            return fh.read()

    def extract(self, entry):
        html = self.fixture_html(entry["name"])
        rec, is_article = self.sa.extract_record(html, entry["domain"],
                                                 entry["url"])
        floor = self.sa.MIN_BODY_CHARS
        reason = self.sa.gate_reason(rec, is_article, floor,
                                     self.sa.echo_slack_for(floor))
        return rec, is_article, reason

    def test_the_manifest_agrees_with_its_own_source(self):
        """expectations.json is GENERATED from MANIFEST_SEED in
        capture_fixtures.py. Nothing cross-checked them, so editing the
        generated file — which both the docs and the failure messages tell you
        to do — was silently reverted by the next capture run."""
        sys.path.insert(0, str(SCRIPT_DIR))
        import capture_fixtures  # noqa: E402
        seed = {e["name"]: e for e in capture_fixtures.MANIFEST_SEED}
        declared = {e["name"]: e for e in self.manifest["fixtures"]}
        self.assertEqual(set(seed), set(declared),
                         "the seed and expectations.json name different "
                         "fixtures — re-run capture_fixtures.py")
        for name, entry in declared.items():
            for key in ("gate", "min_chars", "max_chars", "min_paras",
                        "max_paras", "expect_title", "known_gap",
                        "expect_is_article", "domain", "url"):
                self.assertEqual(entry.get(key), seed[name].get(key),
                                 f"{name}.{key} differs between the seed and "
                                 f"the generated manifest — edit the SEED")

    def test_every_fixture_extracts_its_expected_title(self):
        """`title` is a stored corpus field that feeds the LLM prompts and the
        story-clustering keys, and it was captured from 18 real pages and
        asserted by nothing — which froze two OPPOSITE strip_site_suffix
        defects into committed fixtures: segabg lost a legitimate
        '- лято 2026 г.' to a leftmost separator match, and offnews kept
        '— OFFNews' because the separator class omitted the em-dash."""
        for entry in self.manifest["fixtures"]:
            if "expect_title" not in entry:
                continue
            with self.subTest(fixture=entry["name"]):
                rec, _, _ = self.extract(entry)
                self.assertEqual(rec["title"], entry["expect_title"])

    def test_no_extracted_title_keeps_a_brand_tail(self):
        """The other direction of the same rule, stated as an invariant rather
        than a per-page string, so a NEW fixture is covered the day it lands."""
        for entry in self.manifest["fixtures"]:
            with self.subTest(fixture=entry["name"]):
                rec, _, _ = self.extract(entry)
                title = (rec.get("title") or "").lower()
                brand = entry["domain"].split(".")[0].lower()
                if len(brand) < 4 or not title:
                    continue
                # A brand may legitimately appear INSIDE a headline; what must
                # not survive is a separator followed by the brand at the end.
                self.assertNotRegex(
                    title, r"\s+[-–—|·]\s+[^-–—|·]*" + re.escape(brand) + r"[^-–—|·]*$",
                    f"{entry['name']}: the brand tail was not stripped")

    def test_every_fixture_yields_its_expected_paragraph_count(self):
        """Paragraph COUNT is far more sensitive to a junk-filter change than
        character count and far more stable against a copy edit — it is what
        catches a tightened LINK_SOUP_RATIO or a trim_junk that started
        dropping middle paragraphs, both of which shrink bodies by less than
        the character bands allow."""
        for entry in self.manifest["fixtures"]:
            if "min_paras" not in entry:
                continue
            with self.subTest(fixture=entry["name"]):
                html = self.fixture_html(entry["name"])
                paras, _ = self.sa.extract_body(html)
                self.assertGreaterEqual(
                    len(paras), entry["min_paras"],
                    f"{entry['name']}: paragraphs DROPPED to {len(paras)} — a "
                    f"junk rule started eating real prose")
                self.assertLessEqual(
                    len(paras), entry["max_paras"],
                    f"{entry['name']}: paragraphs grew to {len(paras)} — junk "
                    f"started leaking in")

    def test_every_fixture_has_a_two_sided_band(self):
        """A lower bound alone lets 47-98% of a body vanish silently."""
        for entry in self.manifest["fixtures"]:
            with self.subTest(fixture=entry["name"]):
                self.assertIsNotNone(entry.get("min_chars"))
                self.assertIsNotNone(entry.get("max_chars"))

    def test_every_fixture_decodes_to_readable_text(self):
        """A fixture that is mojibake on disk makes every assertion over it
        meaningless while still passing length checks.

        Measured on the extracted BODY and by DENSITY, not by absence in the
        raw HTML: minified jQuery ships a literal U+FFFD ('\\0' -> the
        replacement character), so 'no U+FFFD anywhere' fails on a perfectly
        decoded page. A genuine cp1251-read-as-utf8 body is saturated with
        them."""
        for entry in self.manifest["fixtures"]:
            with self.subTest(fixture=entry["name"]):
                html = self.fixture_html(entry["name"])
                self.assertGreater(len(html), 2000)
                rec, _, _ = self.extract(entry)
                body = rec.get("content") or ""
                if len(body) < 200:
                    continue  # the empty-body fixtures have nothing to judge
                bad = body.count("\ufffd") / len(body)
                self.assertLess(bad, 0.005,
                                f"{bad:.1%} of the body is replacement "
                                f"characters — the capture decoded with the "
                                f"wrong charset")

    def test_manifest_covers_every_frozen_fixture(self):
        """A fixture on disk with no expectation is a page nothing asserts
        anything about — it looks like coverage and is not."""
        on_disk = {p.name[:-len(".html.gz")]
                   for p in FIXTURE_DIR.glob("*.html.gz")}
        declared = {e["name"] for e in self.manifest["fixtures"]}
        self.assertEqual(on_disk, declared)
        self.assertGreaterEqual(len(declared), 18)

    def test_every_fixture_lands_on_the_expected_side_of_the_gate(self):
        for entry in self.manifest["fixtures"]:
            with self.subTest(fixture=entry["name"]):
                rec, is_article, reason = self.extract(entry)
                self.assertEqual(
                    reason, entry.get("gate"),
                    f"{entry['name']}: gate said {reason!r}, manifest expects "
                    f"{entry.get('gate')!r} — {entry.get('why', '')}")

    def test_every_fixture_extracts_within_its_band(self):
        for entry in self.manifest["fixtures"]:
            with self.subTest(fixture=entry["name"]):
                rec, _, _ = self.extract(entry)
                chars = rec["content_chars"]
                if entry.get("min_chars") is not None:
                    self.assertGreaterEqual(
                        chars, entry["min_chars"],
                        f"{entry['name']}: extraction REGRESSED to {chars} "
                        f"chars — {entry.get('why', '')}")
                if entry.get("max_chars") is not None:
                    self.assertLessEqual(
                        chars, entry["max_chars"],
                        f"{entry['name']}: extraction grew to {chars} chars, "
                        f"which usually means junk leaked in — "
                        f"{entry.get('why', '')}")

    def test_the_empty_body_class_is_still_caught(self):
        """The defect the body gate exists for. If any of these three starts
        passing the gate, either the extractor genuinely improved (update the
        manifest) or the gate stopped discriminating."""
        empties = [e for e in self.manifest["fixtures"]
                   if e["name"].startswith("jsonld_empty_body__")]
        self.assertEqual(len(empties), 3)
        for entry in empties:
            with self.subTest(fixture=entry["name"]):
                rec, is_article, reason = self.extract(entry)
                self.assertTrue(is_article,
                                "these pages DO pass the article gate — that "
                                "is precisely why the body gate is needed")
                self.assertIn(reason, ("title_as_body", "thin_body"))

    def test_the_article_gate_still_rejects(self):
        """The gate's REJECT direction. Without a fixture here, replacing the
        whole listing/homepage protection with `is_article = True` passed the
        entire suite — the one documented failure class the set did not
        cover."""
        rejecting = [e for e in self.manifest["fixtures"]
                     if e.get("expect_is_article") is False]
        self.assertGreaterEqual(len(rejecting), 1,
                                "at least one fixture must exercise the "
                                "article gate's reject direction")
        for entry in rejecting:
            with self.subTest(fixture=entry["name"]):
                _, is_article, reason = self.extract(entry)
                self.assertFalse(is_article, entry.get("why", ""))
                self.assertEqual(reason, "non_article_page")

    def test_every_gate_verdict_is_represented(self):
        """All three of gate_reason's outcomes, so none can quietly stop being
        reachable."""
        verdicts = {e.get("gate") for e in self.manifest["fixtures"]}
        self.assertEqual(verdicts,
                         {None, "thin_body", "title_as_body",
                          "non_article_page"})

    def test_healthy_articles_are_never_rejected(self):
        """The other direction, and the one that matters more: a change to the
        junk filter that starts eating real bodies must fail here rather than
        in a sweep three weeks later."""
        healthy = [e for e in self.manifest["fixtures"]
                   if e.get("gate") is None and not e.get("known_gap")]
        self.assertGreaterEqual(len(healthy), 8)
        for entry in healthy:
            with self.subTest(fixture=entry["name"]):
                _, _, reason = self.extract(entry)
                self.assertIsNone(reason, entry.get("why", ""))

    def test_cp1251_page_decodes_to_bulgarian(self):
        """windows-1251 is still alive (moreto.net) and a mojibake body passes
        every length check while being unreadable."""
        entry = next(e for e in self.manifest["fixtures"]
                     if e["name"] == "cp1251__moreto")
        rec, _, _ = self.extract(entry)
        body = rec["content"]
        cyrillic = sum(1 for ch in body if "\u0400" <= ch <= "\u04FF")
        self.assertGreater(cyrillic / max(len(body), 1), 0.5,
                           "body is not predominantly Cyrillic — mojibake")

    def test_no_fixture_yields_a_raw_html_entity(self):
        """JSON-LD lives in a <script>, so the HTML parser never decodes it —
        197 stored records carried '&#8222;' verbatim into the LLM prompts and
        the story-clustering keys, where such a headline is a different string
        for every comparison. Free to assert on all 18."""
        for entry in self.manifest["fixtures"]:
            with self.subTest(fixture=entry["name"]):
                rec, _, _ = self.extract(entry)
                for field in ("title", "description", "content", "author",
                              "topic", "keywords"):
                    value = rec.get(field) or ""
                    for bad in ("&#", "&amp;", "&quot;", "&lt;", "&gt;",
                                "&nbsp;"):
                        self.assertNotIn(
                            bad, value,
                            f"{entry['name']}.{field} carries a raw {bad!r}")

    def test_no_fixture_body_carries_cookie_banner_text(self):
        """The iubenda vendor list swamped 100+ paragraphs per article on the
        browser tier until the junk filter learned iubenda/cmp/consent.

        Applied to EVERY fixture, not just the ones named `rendered__`: the
        dnevnik fixture is itself an iubenda page and a filename-prefix
        selector excluded it, so deleting that arm of the junk regex grew its
        body from 10,500 to 23,771 chars with 'бисквитки' in it and nothing on
        that page failed."""
        for entry in self.manifest["fixtures"]:
            with self.subTest(fixture=entry["name"]):
                rec, _, _ = self.extract(entry)
                body = (rec["content"] or "").lower()
                for marker in ("бисквитки", "iubenda", "съгласие за обработка",
                               "cookie policy"):
                    self.assertNotIn(marker, body,
                                     f"cookie-consent text leaked into the "
                                     f"body via {marker!r}")

    def test_known_gaps_are_declared_not_silent(self):
        """A fixture marked known_gap pins behaviour we consider WRONG. It is
        here so a future narrowing of the article gate flips it visibly rather
        than being discovered in production — and so nobody reads its passing
        expectation as approval."""
        gaps = [e for e in self.manifest["fixtures"] if e.get("known_gap")]
        self.assertGreaterEqual(len(gaps), 2)
        for entry in gaps:
            with self.subTest(fixture=entry["name"]):
                self.assertIn("KNOWN GAP", entry.get("why", "").upper(),
                              "a known_gap fixture must say what is wrong "
                              "with it and why it has not been fixed")
                _, is_article, reason = self.extract(entry)
                self.assertTrue(is_article)
                self.assertIsNone(reason,
                                  "this page still passes every gate — if it "
                                  "no longer does, the gap was closed: update "
                                  "the manifest and delete the known_gap flag")


if __name__ == "__main__":
    unittest.main(verbosity=2)
