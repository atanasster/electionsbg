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
from datetime import datetime, timedelta, timezone
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


class CanonicalDedupeEndToEnd(unittest.TestCase):

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="save-articles-canon-"))
        (self.root / "news" / "data").mkdir(parents=True)
        self.feed = self.root / "prefetched.jsonl"

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_the_same_article_under_two_spellings_is_stored_once(self):
        html = page("Една статия", [PROSE * 5])
        write_prefetched(self.feed, [("https://www.ex.bg/a/1/", html)])
        _, first = run_saver(self.root, "ex.bg", "20",
                             f"--prefetched={self.feed}")
        self.assertEqual(first["saved"], 1)
        write_prefetched(self.feed, [("http://ex.bg/a/1?utm_source=fb", html)])
        _, second = run_saver(self.root, "ex.bg", "20",
                              f"--prefetched={self.feed}")
        self.assertEqual(second["saved"], 0)
        self.assertEqual(second["already_present"], 1)
        self.assertEqual(
            len(list((self.root / "news" / "data" / "ex.bg").glob("*.json"))), 1)

    def test_the_stored_url_stays_the_real_fetchable_one(self):
        """Only the KEY is normalised — the record must still name a URL a
        reader (and --allow-fetch) can actually open."""
        write_prefetched(self.feed, [
            ("https://www.ex.bg/a/2/", page("Статия", [PROSE * 5]))])
        run_saver(self.root, "ex.bg", "20", f"--prefetched={self.feed}")
        rec = json.loads(next((self.root / "news" / "data" / "ex.bg")
                              .glob("*.json")).read_text(encoding="utf-8"))
        self.assertEqual(rec["url"], "https://www.ex.bg/a/2/")

    def test_two_spellings_in_ONE_run_store_one_file(self):
        """Canonicalisation must dedupe within a run too, not only against
        disk — a sitemap listing both the www. and bare form would otherwise
        produce exactly the duplicate it exists to end."""
        html = page("Една статия", [PROSE * 5])
        write_prefetched(self.feed, [
            ("https://www.ex.bg/a/9/", html),
            ("http://ex.bg/a/9?utm_source=fb", html),
        ])
        _, out = run_saver(self.root, "ex.bg", "20", f"--prefetched={self.feed}")
        self.assertEqual(out["saved"], 1)
        self.assertEqual(
            len(list((self.root / "news" / "data" / "ex.bg").glob("*.json"))), 1)

    def test_a_future_date_falls_back_to_a_sane_source(self):
        """A refused future date must not also discard a usable
        article:published_time and drop the article out of every latest view."""
        html = ('<html><head><title>x</title>'
                '<meta property="og:type" content="article">'
                '<meta property="article:published_time" '
                'content="2020-05-05T10:00:00+03:00">'
                '<script type="application/ld+json">'
                + json.dumps({"@type": "NewsArticle", "headline": "Статия",
                              "datePublished": "2099-01-01T00:00:00+02:00"})
                + f'</script></head><body><article><p>{PROSE * 5}</p>'
                '</article></body></html>')
        write_prefetched(self.feed, [("https://ex.bg/a/10", html)])
        run_saver(self.root, "ex.bg", "20", f"--prefetched={self.feed}")
        rec = json.loads(next((self.root / "news" / "data" / "ex.bg")
                              .glob("*.json")).read_text(encoding="utf-8"))
        self.assertTrue(rec["published"].startswith("2020-05-05"),
                        rec["published"])

    def test_a_legacy_cache_entry_is_still_reachable(self):
        """207 of 208 live entries were written under the pre-canonicalisation
        key. The cache is the artifact whose whole purpose is recovering
        articles a structurally stale source can never list again."""
        import gzip as gz
        url = "https://www.ex.bg/a/11/"
        html = page("Статия", [PROSE * 5])
        cache = self.root / "news" / "data" / "_html" / "ex.bg"
        cache.mkdir(parents=True)
        sys.path.insert(0, str(SCRIPT_DIR))
        import save_articles as sa  # noqa: E402
        legacy = cache / sa.html_cache_path("ex.bg", url,
                                            _raw_key=True).name
        with gz.open(legacy, "wt", encoding="utf-8") as fh:
            fh.write(json.dumps({"url": url, "html": html}))
        art = self.root / "news" / "data" / "ex.bg"
        art.mkdir(parents=True)
        (art / "20260824-x-deadbeef.json").write_text(
            json.dumps({"domain": "ex.bg", "url": url, "title": "Статия",
                        "content": "x" * 500, "content_chars": 500,
                        "published": None}), encoding="utf-8")
        _, rx = run_saver(self.root, "ex.bg", "--reextract")
        self.assertEqual(rx["no_html"], 0, "the legacy entry was not found")
        self.assertEqual(rx["from_cache"], 1)

    def test_prune_keeps_a_legacy_cache_entry(self):
        import gzip as gz
        url = "https://www.ex.bg/a/12/"
        cache = self.root / "news" / "data" / "_html" / "ex.bg"
        cache.mkdir(parents=True)
        sys.path.insert(0, str(SCRIPT_DIR))
        import save_articles as sa  # noqa: E402
        legacy = cache / sa.html_cache_path("ex.bg", url, _raw_key=True).name
        with gz.open(legacy, "wt", encoding="utf-8") as fh:
            fh.write(json.dumps({"url": url, "html": page("S", [PROSE * 5])}))
        art = self.root / "news" / "data" / "ex.bg"
        art.mkdir(parents=True)
        (art / "20260824-x-deadbeef.json").write_text(
            json.dumps({"domain": "ex.bg", "url": url, "title": "S",
                        "content": "x" * 500, "content_chars": 500,
                        "published": None}), encoding="utf-8")
        run_saver(self.root, "ex.bg", "--reextract", "--prune-cache")
        self.assertTrue(legacy.exists(),
                        "the prune deleted the only cached copy of a stored "
                        "article")

    def test_the_html_cache_hits_across_spellings(self):
        write_prefetched(self.feed, [
            ("https://www.ex.bg/a/3/", page("Статия", [PROSE * 5]))])
        run_saver(self.root, "ex.bg", "20", f"--prefetched={self.feed}")
        cache = self.root / "news" / "data" / "_html" / "ex.bg"
        self.assertEqual(len(list(cache.glob("*.json.gz"))), 1)
        write_prefetched(self.feed, [
            ("http://ex.bg/a/3", page("Статия", [PROSE * 5]))])
        run_saver(self.root, "ex.bg", "20", f"--prefetched={self.feed}")
        self.assertEqual(len(list(cache.glob("*.json.gz"))), 1,
                         "a spelling variant must not mint a second entry")


class StaleSourceQuarantine(unittest.TestCase):
    """A structurally stale source publishes actively while its sitemap
    carries years-old dates. The lister already DETECTED this and the saver
    stored the articles anyway, where they sat indistinguishable from fresh
    content and entered the analysis queue at the same priority — measured:
    dnes.bg stuck at 2018, iskra.bg 2019, bnews.bg 2020, investor.bg 2023.

    Every test here seeds its OWN registry in the throwaway tree. Driving a
    domain that happens to be flagged in the committed CSV would pass for an
    incidental reason, and two earlier versions of these tests did exactly
    that — one of them reporting `movable: 0` because it seeded one domain and
    drove another."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="save-articles-quar-"))
        (self.root / "news" / "data").mkdir(parents=True)
        self.feed = self.root / "prefetched.jsonl"

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def write_registry(self, rows, quarantine_col="quarantine_aug2026"):
        """A minimal registry with the dated column names the real one uses."""
        header = ["domain", "feed_method_aug2026", "feed_url_aug2026"]
        if quarantine_col:
            header.append(quarantine_col)
        lines = [",".join(header)]
        for domain, method, verdict in rows:
            cells = [domain, method, f"https://{domain}/"]
            if quarantine_col:
                cells.append(verdict)
            lines.append(",".join(cells))
        (self.root / "news" / "data" / "bg_news_sites.csv").write_text(
            "\n".join(lines) + "\n", encoding="utf-8")

    def corpus(self, domain="ex.bg"):
        return self.root / "news" / "data" / domain

    def quarantine(self, domain="ex.bg"):
        return self.root / "news" / "data" / "_quarantine" / domain

    def sidecar(self, name, domain="ex.bg", quarantined=False):
        parts = (("_quarantine", domain) if quarantined else (domain,))
        return (self.root / "news" / "data" / "analysis" / "articles"
                ).joinpath(*parts, name)

    def seed_record(self, folder, name, url, with_sidecar=False,
                    quarantined=False):
        folder.mkdir(parents=True, exist_ok=True)
        (folder / name).write_text(json.dumps({
            "domain": "ex.bg", "url": url, "title": "Стара",
            "content": "x" * 500, "content_chars": 500,
            "published": "2019-03-26T09:00:00+00:00"}), encoding="utf-8")
        if with_sidecar:
            side = self.sidecar(name, quarantined=quarantined)
            side.parent.mkdir(parents=True, exist_ok=True)
            side.write_text("{}", encoding="utf-8")

    # ---------------------------------------------------------- the decision

    def decision(self, domain, order_confidence):
        """quarantine_decision through a subprocess, so it reads the TEST
        tree's registry via DATA_BG_ROOT rather than the committed one."""
        code = (
            "import sys, json, os;"
            f"sys.path.insert(0, {str(SCRIPT_DIR)!r});"
            "import save_articles as sa;"
            f"print(json.dumps(sa.quarantine_decision({domain!r},"
            f" {order_confidence!r})))")
        env = dict(os.environ, DATA_BG_ROOT=str(self.root))
        out = subprocess.run([sys.executable, "-c", code], capture_output=True,
                             text=True, env=env, timeout=60)
        return json.loads(out.stdout)

    def test_a_curated_stale_source_is_quarantined_whatever_the_run_says(self):
        self.write_registry([("ex.bg", "rss", "stale_source")])
        for oc in ("date_sorted", "stale_source_suspected",
                   "feed_order_unconfirmed"):
            with self.subTest(order_confidence=oc):
                q, why = self.decision("ex.bg", oc)
                self.assertTrue(q)
                self.assertIn("registry", why)

    def test_never_beats_the_runtime_signal(self):
        """dnes.bg's staleness is TRANSIENT — it served fresh headlines early
        one day and 2018 URLs for hours after — so a runtime-only rule would
        shuttle its articles between two folders run to run."""
        self.write_registry([("ex.bg", "rss", "never")])
        q, why = self.decision("ex.bg", "stale_source_suspected")
        self.assertFalse(q)
        self.assertIn("never", why)

    def test_an_empty_verdict_follows_the_runtime_signal(self):
        self.write_registry([("ex.bg", "rss", "")])
        self.assertTrue(self.decision("ex.bg", "stale_source_suspected")[0])
        self.assertFalse(self.decision("ex.bg", "date_sorted")[0])

    def test_an_unrecognised_verdict_is_reported_not_swallowed(self):
        """A typo would otherwise look identical to an empty cell."""
        self.write_registry([("ex.bg", "rss", "quarrantine")])
        q, why = self.decision("ex.bg", "stale_source_suspected")
        self.assertTrue(q, "still follows the lister")
        self.assertIn("unrecognised", why)
        self.assertIn("quarrantine", why)

    def test_a_missing_quarantine_column_is_not_an_error(self):
        """update-news-sites carries forward only feed_* columns, so a refresh
        can drop the curated column entirely."""
        self.write_registry([("ex.bg", "rss", "")], quarantine_col=None)
        q, why = self.decision("ex.bg", "date_sorted")
        self.assertFalse(q)
        self.assertEqual(why, "")

    def test_an_unknown_domain_follows_the_runtime_signal(self):
        """Absent from the registry is not the same as 'never quarantine' —
        the runtime detector must still apply."""
        self.write_registry([("other.bg", "rss", "")])
        self.assertFalse(self.decision("ex.bg", "date_sorted")[0])
        self.assertTrue(self.decision("ex.bg", "stale_source_suspected")[0])

    # ------------------------------------------------------------ the paths

    def test_existing_urls_reads_both_sides(self):
        """A domain quarantined yesterday and fresh today must not re-fetch
        what it already holds, and vice versa."""
        sys.path.insert(0, str(SCRIPT_DIR))
        import save_articles as sa  # noqa: E402
        self.seed_record(self.corpus(), "a.json", "https://ex.bg/a/1")
        self.seed_record(self.quarantine(), "b.json", "https://ex.bg/a/2")
        keys = sa.existing_urls(self.corpus(), self.quarantine())
        self.assertEqual(keys, {"https://ex.bg/a/1", "https://ex.bg/a/2"})

    def test_a_stale_run_writes_into_the_quarantine(self):
        self.write_registry([("ex.bg", "rss", "stale_source")])
        write_prefetched(self.feed, [
            ("https://ex.bg/a/50", page("Статия", [PROSE * 5]))])
        _, out = run_saver(self.root, "ex.bg", "20", f"--prefetched={self.feed}")
        self.assertTrue(out["quarantined"])
        self.assertEqual(out["saved"], 1)
        self.assertEqual(len(list(self.quarantine().glob("*.json"))), 1)
        self.assertFalse(self.corpus().exists())

    def test_no_quarantine_overrides_the_decision(self):
        self.write_registry([("ex.bg", "rss", "stale_source")])
        write_prefetched(self.feed, [
            ("https://ex.bg/a/51", page("Статия", [PROSE * 5]))])
        _, out = run_saver(self.root, "ex.bg", "20", "--no-quarantine",
                           f"--prefetched={self.feed}")
        self.assertFalse(out["quarantined"])
        self.assertEqual(out["quarantine_reason"], "--no-quarantine")
        self.assertEqual(len(list(self.corpus().glob("*.json"))), 1)
        self.assertFalse(self.quarantine().exists())

    # ------------------------------------------------------- the relocation

    def test_apply_quarantine_is_dry_by_default(self):
        self.write_registry([("ex.bg", "rss", "stale_source")])
        self.seed_record(self.corpus(), "20190326-y-beef.json",
                         "https://ex.bg/a/1")
        _, dry = run_saver(self.root, "ex.bg", "--apply-quarantine")
        self.assertEqual((dry["movable"], dry["moved"]), (1, 0))
        self.assertTrue((self.corpus() / "20190326-y-beef.json").exists())
        _, wet = run_saver(self.root, "ex.bg", "--apply-quarantine", "--apply")
        self.assertEqual(wet["moved"], 1)
        self.assertTrue((self.quarantine() / "20190326-y-beef.json").exists())

    def test_relocating_removes_the_stale_analysis_sidecar(self):
        """corpus_domains() skips _-prefixed directories, so the analysis
        layer cannot reach a quarantined article — its sidecar is an analysis
        of something no longer in the analysable corpus. The previous 'move'
        computed the same path twice and silently did nothing."""
        self.write_registry([("ex.bg", "rss", "stale_source")])
        name = "20190326-z-cafe.json"
        self.seed_record(self.corpus(), name, "https://ex.bg/a/2",
                         with_sidecar=True)
        self.assertTrue(self.sidecar(name).exists())
        _, out = run_saver(self.root, "ex.bg", "--apply-quarantine", "--apply")
        self.assertEqual(out["sidecars_removed"], 1)
        self.assertFalse(self.sidecar(name).exists(),
                         "an analysis for an unanalysable article is an orphan")

    def test_an_uncurated_domain_is_left_alone(self):
        """This mode reads no feed, so it cannot see the runtime signal main()
        also routes on — acting on a blank verdict would drag records back OUT
        of quarantine on a domain the lister had flagged."""
        self.write_registry([("ex.bg", "rss", "")])
        self.seed_record(self.quarantine(), "20190326-q-1.json",
                         "https://ex.bg/a/3")
        _, out = run_saver(self.root, "ex.bg", "--apply-quarantine", "--apply")
        self.assertEqual(out["moved"], 0)
        self.assertIn("no curated verdict", out["direction"])
        self.assertTrue((self.quarantine() / "20190326-q-1.json").exists())

    def test_never_moves_records_back_to_the_corpus(self):
        self.write_registry([("ex.bg", "rss", "never")])
        self.seed_record(self.quarantine(), "20190326-b-1.json",
                         "https://ex.bg/a/4")
        _, out = run_saver(self.root, "ex.bg", "--apply-quarantine", "--apply")
        self.assertEqual(out["direction"], "quarantine -> corpus")
        self.assertEqual(out["moved"], 1)
        self.assertTrue((self.corpus() / "20190326-b-1.json").exists())

    def test_a_differing_record_on_the_far_side_is_refused(self):
        """The filename embeds a hash of the canonical URL, so a collision is
        the same article — but discarding the source without comparing throws
        away a newer re-extraction."""
        self.write_registry([("ex.bg", "rss", "stale_source")])
        name = "20190326-c-1.json"
        self.seed_record(self.corpus(), name, "https://ex.bg/a/5")
        self.quarantine().mkdir(parents=True, exist_ok=True)
        (self.quarantine() / name).write_text(
            json.dumps({"domain": "ex.bg", "url": "https://ex.bg/a/5",
                        "title": "Друга версия", "content": "y" * 900,
                        "content_chars": 900, "published": None}),
            encoding="utf-8")
        _, out = run_saver(self.root, "ex.bg", "--apply-quarantine", "--apply")
        self.assertEqual(out["moved"], 0)
        self.assertTrue((self.corpus() / name).exists(), "source survives")
        self.assertIn("DIFFERENT", out["failed"][0]["detail"])

    def test_an_identical_record_on_the_far_side_is_discarded(self):
        self.write_registry([("ex.bg", "rss", "stale_source")])
        name = "20190326-d-1.json"
        self.seed_record(self.corpus(), name, "https://ex.bg/a/6")
        self.quarantine().mkdir(parents=True, exist_ok=True)
        (self.quarantine() / name).write_bytes(
            (self.corpus() / name).read_bytes())
        _, out = run_saver(self.root, "ex.bg", "--apply-quarantine", "--apply")
        self.assertEqual(out["moved"], 1)
        self.assertFalse((self.corpus() / name).exists())

    def test_an_unreadable_record_is_reported_not_silently_skipped(self):
        self.write_registry([("ex.bg", "rss", "stale_source")])
        self.corpus().mkdir(parents=True, exist_ok=True)
        (self.corpus() / "20190326-e-1.json").write_text("{not json",
                                                         encoding="utf-8")
        _, out = run_saver(self.root, "ex.bg", "--apply-quarantine", "--apply")
        self.assertEqual(out["unreadable"], 1)
        self.assertTrue(out["failed"])

    def test_an_emptied_corpus_folder_is_removed(self):
        """build_app_data lists a domain directory whether or not it holds
        anything, so an emptied one renders as a ghost outlet."""
        self.write_registry([("ex.bg", "rss", "stale_source")])
        self.seed_record(self.corpus(), "20190326-f-1.json",
                         "https://ex.bg/a/7")
        run_saver(self.root, "ex.bg", "--apply-quarantine", "--apply")
        self.assertFalse(self.corpus().exists())

    def test_apply_outside_its_mode_is_refused(self):
        self.write_registry([("ex.bg", "rss", "")])
        code, out = run_saver(self.root, "ex.bg", "5", "--apply")
        self.assertEqual((code, out["error"]), (1, "usage"))

    # -------------------------------------------------- reextract interplay

    def test_reextract_reaches_quarantined_records(self):
        """The mode exists to reach articles a structurally stale source can
        never list again — which after relocation are exactly the quarantined
        ones. Resolving only the corpus made it report `records: 0`."""
        self.write_registry([("ex.bg", "rss", "stale_source")])
        write_prefetched(self.feed, [
            ("https://ex.bg/a/60", page("Статия", [PROSE * 5]))])
        run_saver(self.root, "ex.bg", "20", f"--prefetched={self.feed}")
        self.assertEqual(len(list(self.quarantine().glob("*.json"))), 1)
        _, rx = run_saver(self.root, "ex.bg", "--reextract")
        self.assertEqual(rx["records"], 1)
        self.assertEqual(rx["from_cache"], 1)

    def test_prune_cache_keeps_a_quarantined_article_s_html(self):
        """Deleting it destroys the recovery path the cache exists to provide,
        for the one population that cannot be re-listed."""
        self.write_registry([("ex.bg", "rss", "stale_source")])
        write_prefetched(self.feed, [
            ("https://ex.bg/a/61", page("Статия", [PROSE * 5]))])
        run_saver(self.root, "ex.bg", "20", f"--prefetched={self.feed}")
        cache = self.root / "news" / "data" / "_html" / "ex.bg"
        self.assertEqual(len(list(cache.glob("*.json.gz"))), 1)
        _, rx = run_saver(self.root, "ex.bg", "--reextract", "--prune-cache")
        self.assertEqual(rx["cache_pruned"], 0)
        self.assertEqual(len(list(cache.glob("*.json.gz"))), 1)

    def test_reextract_does_not_promote_a_quarantined_record(self):
        self.write_registry([("ex.bg", "rss", "stale_source")])
        write_prefetched(self.feed, [
            ("https://ex.bg/a/62", page("Статия", [PROSE * 5]))])
        run_saver(self.root, "ex.bg", "20", f"--prefetched={self.feed}")
        run_saver(self.root, "ex.bg", "--reextract")
        self.assertEqual(len(list(self.quarantine().glob("*.json"))), 1)
        self.assertFalse(self.corpus().exists(),
                         "a re-extraction must not move an article out of "
                         "quarantine")

    def test_the_summary_reports_freshness(self):
        """The number a nightly report needs to tell a quiet source from a
        dead one — a run that saved nothing does not itself distinguish them."""
        self.write_registry([("ex.bg", "rss", "")])
        write_prefetched(self.feed, [
            ("https://ex.bg/a/63", page("Статия", [PROSE * 5]))])
        _, out = run_saver(self.root, "ex.bg", "20", f"--prefetched={self.feed}")
        self.assertEqual(out["newest_stored"], "2026-08-24")
        self.assertIsInstance(out["newest_stored_age_days"], int)

    def test_a_malformed_stored_date_does_not_break_the_summary(self):
        """Raising here would print no summary at all — after every article
        has already been saved."""
        self.write_registry([("ex.bg", "rss", "")])
        self.corpus().mkdir(parents=True, exist_ok=True)
        (self.corpus() / "nodate-x-1.json").write_text(json.dumps({
            "domain": "ex.bg", "url": "https://ex.bg/a/64", "title": "T",
            "content": "x" * 500, "content_chars": 500,
            "published": "9999-99-99T00:00:00+00:00"}), encoding="utf-8")
        write_prefetched(self.feed, [
            ("https://ex.bg/a/65", page("Статия", [PROSE * 5]))])
        _, out = run_saver(self.root, "ex.bg", "20", f"--prefetched={self.feed}")
        self.assertEqual(out["saved"], 1)
        self.assertIsNone(out["newest_stored_age_days"])


class IntakeState(unittest.TestCase):
    """Per-domain intake state and the retry queue.

    Each run was a fresh 'give me the newest N' with no memory: a domain that
    timed out was simply absent from that night's data and nothing ever
    noticed or went back for it. Measured on the first full sweep: 14 of 55
    domains failed, 8 by timeout, and every one of those articles was lost
    silently.

    ⚠️ The first version of these tests drove merge_retry_queue as a unit and
    cmd_intake_report against hand-written state files, and left the writer in
    main() that joins them untested — so FOUR of the five new behaviours could
    be deleted outright with the whole suite green. The end-to-end tests below
    exist because of that measurement."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="save-articles-state-"))
        (self.root / "news" / "data").mkdir(parents=True)
        self.feed = self.root / "prefetched.jsonl"
        self.write_registry()

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def write_registry(self, domains=("ex.bg",)):
        lines = ["domain,feed_method_aug2026,feed_url_aug2026,quarantine_aug2026"]
        for d in domains:
            lines.append(f"{d},rss,https://{d}/,")
        (self.root / "news" / "data" / "bg_news_sites.csv").write_text(
            "\n".join(lines) + "\n", encoding="utf-8")

    def state_file(self, domain="ex.bg"):
        return self.root / "news" / "data" / "_state" / f"{domain}.json"

    def state(self, domain="ex.bg"):
        p = self.state_file(domain)
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None

    def write_state(self, payload, domain="ex.bg"):
        p = self.state_file(domain)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(payload), encoding="utf-8")

    def sa(self):
        sys.path.insert(0, str(SCRIPT_DIR))
        import save_articles  # noqa: E402
        return save_articles

    # ------------------------------------------------------- the merge rule

    def test_a_transient_failure_is_queued(self):
        q, newly, ex = self.sa().merge_retry_queue(
            [], [{"url": "https://ex.bg/a/72",
                  "detail": "HTTP Error 503: Service Unavailable"}],
            "2026-08-26T00:00:00+00:00", attempted={"https://ex.bg/a/72"})
        self.assertEqual(len(q), 1)
        self.assertEqual(q[0]["attempts"], 1)
        self.assertEqual((newly, ex), ([], {}))

    def test_a_gate_decision_is_never_queued(self):
        """The body gate and the article gate are DECISIONS, with their own
        ledger and TTL. Queueing them would retry tonight what the gate
        refused on purpose."""
        q, newly, _ = self.sa().merge_retry_queue([], [
            {"url": "https://ex.bg/a/73", "detail": "thin_body (12 chars < 400 floor)"},
            {"url": "https://ex.bg/a/74", "detail": "title_as_body (…)"},
            {"url": "https://ex.bg/a/75", "detail": "non_article_page (…)"},
        ], "2026-08-26T00:00:00+00:00")
        self.assertEqual((q, newly), ([], []))

    def test_a_url_that_succeeded_on_retry_leaves_the_queue(self):
        sa = self.sa()
        stamp = "2026-08-26T00:00:00+00:00"
        q, _, _ = sa.merge_retry_queue(
            [], [{"url": "https://ex.bg/a/80", "detail": "timeout"}], stamp,
            attempted={"https://ex.bg/a/80"})
        self.assertEqual(len(q), 1)
        q2, _, _ = sa.merge_retry_queue(q, [], stamp,
                                        attempted={"https://ex.bg/a/80"})
        self.assertEqual(q2, [], "attempted and no longer failing")

    def test_an_unattempted_entry_is_carried_forward(self):
        """A --prefetched or --urls-file run cannot consult the queue, and
        rewriting it from that run's failures alone silently discarded the
        whole thing."""
        sa = self.sa()
        stamp = "2026-08-26T00:00:00+00:00"
        prior = [{"url": "https://ex.bg/a/81", "detail": "timeout",
                  "attempts": 1, "first_failed_at": stamp}]
        q, _, _ = sa.merge_retry_queue(prior, [], stamp, attempted=set())
        self.assertEqual(len(q), 1)
        self.assertEqual(q[0]["attempts"], 1, "not re-counted as an attempt")

    def test_the_retry_key_is_canonical(self):
        """The dedupe against the fresh listing already keyed canonically, so
        keying the COUNTER on the raw url let a spelling change reset attempts
        to 1 for ever — the cap never fired."""
        sa = self.sa()
        stamp = "2026-08-26T00:00:00+00:00"
        q, _, _ = sa.merge_retry_queue(
            [], [{"url": "https://www.ex.bg/a/82/", "detail": "timeout"}],
            stamp, attempted=set())
        q, _, _ = sa.merge_retry_queue(
            q, [{"url": "http://ex.bg/a/82?utm_source=x", "detail": "timeout"}],
            stamp, attempted=set())
        self.assertEqual(len(q), 1, "two spellings must not take two slots")
        self.assertEqual(q[0]["attempts"], 2, "the counter must accumulate")

    def test_an_exhausted_url_stays_exhausted(self):
        """The cap did NOT stop the nightly re-fetch it claims to: a 404 that
        stays in the sitemap cycled 1 -> 2 -> exhausted -> 1 for ever and
        re-appeared in retry_exhausted every third night."""
        sa = self.sa()
        stamp = "2026-08-26T00:00:00+00:00"
        fail = [{"url": "https://ex.bg/a/83", "detail": "HTTP Error 404"}]
        q, newly, ex = [], [], {}
        for _ in range(sa.MAX_RETRY_ATTEMPTS):
            q, newly, ex = sa.merge_retry_queue(q, fail, stamp,
                                                attempted=set(), exhausted=ex)
        self.assertEqual(q, [])
        self.assertEqual(len(newly), 1)
        # A fourth night must NOT re-queue it.
        q2, newly2, ex2 = sa.merge_retry_queue(q, fail, stamp,
                                               attempted=set(), exhausted=ex)
        self.assertEqual(q2, [])
        self.assertEqual(newly2, [], "it must not be re-named every third night")

    def test_an_exhausted_url_comes_back_after_the_ttl(self):
        sa = self.sa()
        old = (datetime.now(timezone.utc)
               - timedelta(days=sa.RETRY_EXHAUSTED_TTL_DAYS + 1)).isoformat()
        q, newly, _ = sa.merge_retry_queue(
            [], [{"url": "https://ex.bg/a/84", "detail": "timeout"}],
            "2026-08-26T00:00:00+00:00", attempted=set(),
            exhausted={"https://ex.bg/a/84": old})
        self.assertEqual(len(q), 1, "a stale exhaustion must not be permanent")

    def test_first_failed_at_survives_across_runs(self):
        sa = self.sa()
        fail = [{"url": "https://ex.bg/a/77", "detail": "timeout"}]
        q1, _, _ = sa.merge_retry_queue([], fail, "2026-08-24T00:00:00+00:00")
        q2, _, _ = sa.merge_retry_queue(q1, fail, "2026-08-26T00:00:00+00:00")
        self.assertEqual(q2[0]["first_failed_at"], "2026-08-24T00:00:00+00:00")
        self.assertEqual(q2[0]["last_failed_at"], "2026-08-26T00:00:00+00:00")

    # ---------------------------------------------------------- end to end

    def test_state_is_per_domain_not_one_shared_file(self):
        """save_all_direct.sh runs six domains at a time through xargs, so a
        single intake.json would have six concurrent writers and no locking."""
        sa = self.sa()
        self.assertNotEqual(sa.state_path("a.bg"), sa.state_path("b.bg"))
        self.assertEqual(sa.state_path("a.bg").parent,
                         sa.state_path("b.bg").parent)

    def test_a_successful_run_records_success(self):
        write_prefetched(self.feed, [
            ("https://ex.bg/a/70", page("Статия", [PROSE * 5]))])
        run_saver(self.root, "ex.bg", "20", f"--prefetched={self.feed}")
        st = self.state()
        self.assertIsNotNone(st["last_success_at"])
        self.assertEqual(st["consecutive_failures"], 0)
        self.assertIsNone(st["last_error"])
        self.assertEqual(st["newest_stored"], "2026-08-24")

    def test_a_mode_that_cannot_drain_the_queue_must_not_delete_it(self):
        """--prefetched cannot consult the queue, and the queue was rewritten
        unconditionally from that run's failures — so a seeded URL vanished
        with retry_queued 0 and no retry_exhausted. This hits the 17
        browser-tier domains."""
        self.write_state({"domain": "ex.bg", "retry_urls": [
            {"url": "https://ex.bg/a/85", "detail": "timeout", "attempts": 1,
             "first_failed_at": "2026-08-20T00:00:00+00:00"}]})
        write_prefetched(self.feed, [
            ("https://ex.bg/a/86", page("Статия", [PROSE * 5]))])
        _, out = run_saver(self.root, "ex.bg", "20", f"--prefetched={self.feed}")
        self.assertEqual(out["retry_queued"], 1)
        self.assertEqual(self.state()["retry_urls"][0]["url"],
                         "https://ex.bg/a/85")

    def test_a_run_that_stores_nothing_is_not_a_success(self):
        """The counter exists to notice a source that has stopped working, and
        recording every completed run as a success made it unable to."""
        write_prefetched(self.feed, [
            ("https://ex.bg/a/87", page("Празна", []))])
        run_saver(self.root, "ex.bg", "20", f"--prefetched={self.feed}")
        st = self.state()
        self.assertEqual(st["consecutive_failures"], 1)
        self.assertEqual(st["last_error"]["error"], "nothing_stored")
        self.assertIsNone(st["last_success_at"])

    def test_a_run_with_nothing_new_is_still_a_success(self):
        """A quiet source is not a broken one."""
        write_prefetched(self.feed, [
            ("https://ex.bg/a/88", page("Статия", [PROSE * 5]))])
        run_saver(self.root, "ex.bg", "20", f"--prefetched={self.feed}")
        run_saver(self.root, "ex.bg", "20", f"--prefetched={self.feed}")
        st = self.state()
        self.assertEqual(st["consecutive_failures"], 0)
        self.assertIsNotNone(st["last_success_at"])

    def test_already_present_counts_disk_not_this_run(self):
        """Counted against the set the loop grows as it goes, every URL this
        run stored was also counted as already present."""
        write_prefetched(self.feed, [
            ("https://ex.bg/a/89", page("Статия", [PROSE * 5]))])
        _, first = run_saver(self.root, "ex.bg", "20",
                             f"--prefetched={self.feed}")
        self.assertEqual((first["saved"], first["already_present"]), (1, 0))
        _, second = run_saver(self.root, "ex.bg", "20",
                              f"--prefetched={self.feed}")
        self.assertEqual((second["saved"], second["already_present"]), (0, 1))

    def test_a_lister_failure_increments_consecutive_failures(self):
        """not-in-the-registry is a standing fact; a fetch failure is not."""
        code, out = run_saver(self.root, "no-such-domain.invalid", "2")
        self.assertIn(code, (2, 4))
        st = self.state("no-such-domain.invalid")
        # A domain the lister cannot resolve at all is a STANDING fact, so it
        # must not accumulate a failure every night.
        self.assertTrue(st is None or st["consecutive_failures"] == 0)

    def test_a_corrupt_state_file_does_not_stop_the_run(self):
        self.state_file().parent.mkdir(parents=True, exist_ok=True)
        self.state_file().write_text("{not json", encoding="utf-8")
        write_prefetched(self.feed, [
            ("https://ex.bg/a/78", page("Статия", [PROSE * 5]))])
        code, out = run_saver(self.root, "ex.bg", "20",
                              f"--prefetched={self.feed}")
        self.assertEqual((code, out["saved"]), (0, 1))
        self.assertIsNotNone(self.state()["last_success_at"])

    def test_a_corrupt_retry_queue_type_does_not_yield_a_bogus_count(self):
        self.write_state({"domain": "ex.bg", "retry_urls": "not a list"})
        write_prefetched(self.feed, [
            ("https://ex.bg/a/90", page("Статия", [PROSE * 5]))])
        _, out = run_saver(self.root, "ex.bg", "20", f"--prefetched={self.feed}")
        self.assertEqual(out["retry_queued"], 0)

    # ------------------------------------------------------------- the report

    def report(self, *extra):
        env = dict(os.environ, DATA_BG_ROOT=str(self.root))
        proc = subprocess.run(
            [sys.executable, str(SAVER), "--intake-report", *extra],
            capture_output=True, text=True, env=env, timeout=120)
        return proc.returncode, json.loads(proc.stdout)

    def test_a_registry_domain_that_never_ran_is_visible(self):
        """Enumerating state files alone made a domain that has NEVER
        completed a run invisible — the original defect's exact shape."""
        self.write_registry(("ex.bg", "never-touched.bg"))
        _, rep = self.report()
        self.assertEqual(rep["domains"], 2)
        self.assertEqual({a["alert"] for a in rep["alerts"]}, {"never_ran"})

    def test_the_report_alerts_on_a_stale_unquarantined_source(self):
        self.write_state({"domain": "ex.bg", "newest_stored": "2026-01-01",
                          "consecutive_failures": 0, "retry_urls": [],
                          "quarantined": False})
        alerts = self.report()[1]["alerts"]
        self.assertEqual([a["alert"] for a in alerts], ["going_stale"])

    def test_a_quarantined_source_is_old_on_purpose_and_not_alerted(self):
        self.write_state({"domain": "ex.bg", "newest_stored": "2019-01-01",
                          "consecutive_failures": 0, "retry_urls": [],
                          "quarantined": True})
        self.assertEqual(self.report()[1]["alerts"], [])

    def test_the_report_alerts_on_a_repeatedly_failing_source(self):
        self.write_state({"domain": "ex.bg", "newest_stored": None,
                          "consecutive_failures": 4, "retry_urls": [],
                          "last_error": {"error": "fetch_failed"},
                          "quarantined": False})
        self.assertEqual(self.report()[1]["alerts"][0]["alert"], "failing")

    def test_the_report_alerts_on_a_retry_backlog(self):
        self.write_state({"domain": "ex.bg", "newest_stored": "2026-08-26",
                          "consecutive_failures": 0, "quarantined": False,
                          "retry_urls": [{"url": f"https://ex.bg/a/{i}",
                                          "attempts": 1} for i in range(12)]})
        self.assertEqual(self.report()[1]["alerts"][0]["alert"],
                         "retry_backlog")

    def test_the_stale_threshold_is_configurable(self):
        self.write_state({"domain": "ex.bg", "newest_stored": "2026-08-20",
                          "consecutive_failures": 0, "retry_urls": [],
                          "quarantined": False})
        self.assertEqual(self.report("--stale-after=365")[1]["alerts"], [])
        self.assertTrue(self.report("--stale-after=1")[1]["alerts"])

    def test_a_malformed_stored_date_does_not_break_the_report(self):
        self.write_state({"domain": "ex.bg", "newest_stored": "9999-99-99",
                          "consecutive_failures": 0, "retry_urls": [],
                          "quarantined": False})
        rep = self.report()[1]
        row = next(r for r in rep["rows"] if r["domain"] == "ex.bg")
        self.assertIsNone(row["newest_stored_age_days"])

    def test_a_corrupt_retry_queue_does_not_raise_a_bogus_alert(self):
        self.write_state({"domain": "ex.bg", "newest_stored": "2026-08-26",
                          "consecutive_failures": 0, "quarantined": False,
                          "retry_urls": "not a list"})
        rep = self.report()[1]
        row = next(r for r in rep["rows"] if r["domain"] == "ex.bg")
        self.assertEqual(row["retry_queued"], 0)

    def test_the_verdict_line_carries_a_domain_key(self):
        """save_all_direct.sh appends it to a file of per-domain summaries; a
        consumer reading `.domain` on every line must not break."""
        rep = self.report()[1]
        self.assertIn("domain", rep)
        self.assertIsNone(rep["domain"])
        self.assertEqual(rep["mode"], "intake-report")

    def test_intake_report_refuses_a_stray_positional(self):
        code, out = self.report("ex.bg")
        self.assertEqual((code, out["error"]), (1, "usage"))

    def test_stale_after_outside_its_mode_is_refused(self):
        code, out = run_saver(self.root, "ex.bg", "2", "--stale-after=3")
        self.assertEqual((code, out["error"]), (1, "usage"))


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

    def test_pre_existing_duplicates_are_reported_then_collapsed(self):
        """canonical_url stops NEW duplicates; nothing collapsed the 19 groups
        already stored. Reported by default, removed only with --dedupe —
        consistent with every other destructive path here."""
        art = self.data_dir()
        art.mkdir(parents=True)
        for name, url, chars in (
                ("20260824-a-1111.json", "https://www.ex.bg/a/30/", 900),
                ("20260824-a-2222.json", "http://ex.bg/a/30?ref=home", 400)):
            (art / name).write_text(json.dumps({
                "domain": "ex.bg", "url": url, "title": "Една статия",
                "content": "x" * chars, "content_chars": chars,
                "published": "2026-08-24T09:00:00+00:00"}), encoding="utf-8")
        side = (self.root / "news" / "data" / "analysis" / "articles"
                / "ex.bg" / "20260824-a-2222.json")
        side.parent.mkdir(parents=True, exist_ok=True)
        side.write_text("{}", encoding="utf-8")

        _, dry = run_saver(self.root, "ex.bg", "--reextract")
        self.assertEqual(dry["duplicates_found"], 1)
        self.assertEqual(dry["duplicates_removed"], 0, "dry by default")
        self.assertEqual(len(list(art.glob("*.json"))), 2)

        _, wet = run_saver(self.root, "ex.bg", "--reextract", "--dedupe")
        self.assertEqual(wet["duplicates_removed"], 1)
        survivors = list(art.glob("*.json"))
        self.assertEqual(len(survivors), 1)
        rec = json.loads(survivors[0].read_text(encoding="utf-8"))
        self.assertEqual(rec["content_chars"], 900,
                         "the fullest body must be the survivor")
        self.assertFalse(side.exists(),
                         "the loser's analysis sidecar is an orphan")

    def test_a_promoted_rejection_keeps_the_raw_fetchable_url(self):
        """The canonical form normalises SPELLING for dedupe and is not
        guaranteed fetchable — a site serving only the www. form would be
        handed a URL that does not resolve."""
        url = "https://www.ex.bg/b/20/"
        buried = ('<html><head><title>Заровена</title>'
                  '<meta property="og:type" content="article">'
                  '<script type="application/ld+json">'
                  + json.dumps({"@type": "NewsArticle", "headline": "Заровена"})
                  + f'</script></head><body><aside><p>{PROSE * 5}</p>'
                  '</aside></body></html>')
        write_prefetched(self.feed, [(url, buried)])
        run_saver(self.root, "ex.bg", "20", f"--prefetched={self.feed}")
        self.rewrite_cache(lambda h: h.replace("<aside>", "<article>")
                                      .replace("</aside>", "</article>"))
        _, rx = run_saver(self.root, "ex.bg", "--reextract")
        self.assertEqual(rx["promoted"], 1)
        rec = json.loads(next(self.data_dir().glob("*.json"))
                         .read_text(encoding="utf-8"))
        self.assertEqual(rec["url"], url)

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


class PublishDates(unittest.TestCase):
    """normalize_date — the timezone the corpus is actually published in."""

    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(SCRIPT_DIR))
        import save_articles  # noqa: E402
        cls.sa = save_articles
        from datetime import datetime, timezone
        cls.now = datetime(2026, 8, 25, 12, 0, tzinfo=timezone.utc)

    def norm(self, raw):
        return self.sa.normalize_date(raw, now=self.now)

    def test_a_naive_timestamp_is_sofia_local_not_utc(self):
        """Bulgarian newsrooms publish in local time and frequently emit no
        offset. Reading those as UTC shifted 4,354 of 4,925 stored records by
        2-3 hours and filed anything after 21:00 local under the previous
        day — including in the filename the whole date-bucketing keys on."""
        self.assertEqual(self.norm("2026-08-24T22:30:00"),
                         "2026-08-24T19:30:00+00:00")

    def test_summer_uses_eest_not_a_fixed_offset(self):
        """+03:00 in August, +02:00 in January. A fixed offset is wrong for
        half the year, which is why this goes through ZoneInfo."""
        self.assertEqual(self.norm("2026-08-24T12:00:00"),
                         "2026-08-24T09:00:00+00:00")
        self.assertEqual(self.norm("2026-01-24T12:00:00"),
                         "2026-01-24T10:00:00+00:00")

    def test_an_explicit_offset_is_respected(self):
        self.assertEqual(self.norm("2026-08-24T22:30:00+03:00"),
                         "2026-08-24T19:30:00+00:00")
        self.assertEqual(self.norm("2026-08-24T22:30:00Z"),
                         "2026-08-24T22:30:00+00:00")

    def test_a_bulgarian_date_only_value_keeps_its_own_day(self):
        """'24 август 2026' states a DAY and no wall clock. Midnight Sofia is
        21:00 UTC the day BEFORE, which would file it under the 23rd."""
        got = self.norm("24 август 2026")
        self.assertTrue(got.startswith("2026-08-24"), got)

    def test_a_future_date_is_refused_not_stored(self):
        """A future publish date sorts an article to the top of every 'latest'
        view for as long as it stays in the future. Measured: 5 stored
        records, capital.bg by nearly two months."""
        self.assertIsNone(self.norm("2026-10-13T09:00:00+03:00"))

    def test_a_few_hours_ahead_is_tolerated(self):
        """Clock skew and an editor's near-future scheduling are ordinary; the
        refusal is for a broken feed, not for every timestamp past 'now'."""
        self.assertIsNotNone(self.norm("2026-08-25T20:00:00+03:00"))

    def test_an_iso_date_only_value_keeps_its_own_day(self):
        """parse_dt SUCCEEDS on '2026-08-24' and returns naive MIDNIGHT, which
        in Sofia is 21:00 UTC the day before. Sitemap <lastmod> — the lister's
        own list_published source — is routinely date-only, so this path is
        the common one, not an edge case."""
        for raw in ("2026-08-24", "20260824"):
            with self.subTest(raw=raw):
                got = self.norm(raw)
                self.assertTrue(got.startswith("2026-08-24"), got)

    def test_a_written_out_midnight_is_left_alone(self):
        """The site stated a time. We convert it; we do not overrule it."""
        self.assertEqual(self.norm("2026-08-06T00:00:00"),
                         "2026-08-05T21:00:00+00:00")

    def test_rfc2822_minus_zero_means_utc_not_sofia(self):
        """RFC 5322: -0000 is 'UTC, sender withholding local time', and
        parsedate_to_datetime returns it NAIVE — so the Sofia branch would
        shift it three hours."""
        self.assertEqual(self.norm("Mon, 24 Aug 2026 22:30:00 -0000"),
                         "2026-08-24T22:30:00+00:00")
        self.assertEqual(self.norm("Mon, 24 Aug 2026 22:30:00 +0000"),
                         "2026-08-24T22:30:00+00:00")

    def test_a_naive_now_does_not_raise(self):
        from datetime import datetime
        self.assertIsNotNone(
            self.sa.normalize_date("2026-08-24", now=datetime(2026, 8, 25)))

    def test_an_unparseable_value_is_kept_verbatim(self):
        self.assertEqual(self.norm("вчера следобед"), "вчера следобед")
        self.assertIsNone(self.norm(""))
        self.assertIsNone(self.norm(None))


class CanonicalUrls(unittest.TestCase):
    """canonical_url — the identity this pipeline dedupes on."""

    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(SCRIPT_DIR))
        import save_articles  # noqa: E402
        cls.sa = save_articles

    def test_spelling_variants_collapse_to_one_key(self):
        """20 groups of the first corpus were one article stored twice."""
        base = "https://dnes.bg/a/1"
        for variant in ("https://www.dnes.bg/a/1/", "http://dnes.bg/a/1",
                        "https://DNES.bg/a/1", "https://dnes.bg:443/a/1",
                        "https://dnes.bg/a/1#comments",
                        "https://dnes.bg/a/1?utm_source=fb&utm_medium=social",
                        "https://dnes.bg/a/1?fbclid=xyz"):
            with self.subTest(variant=variant):
                self.assertEqual(self.sa.canonical_url(variant), base)

    def test_a_meaningful_query_is_kept(self):
        """moreto.net addresses every article as novini.php?n=NNNN — dropping
        the query would collapse the whole site into one key."""
        self.assertEqual(
            self.sa.canonical_url("https://www.moreto.net/novini.php?n=534254"),
            "https://moreto.net/novini.php?n=534254")

    def test_distinct_articles_stay_distinct(self):
        self.assertNotEqual(self.sa.canonical_url("https://dnes.bg/a/1"),
                            self.sa.canonical_url("https://dnes.bg/a/2"))
        self.assertNotEqual(
            self.sa.canonical_url("https://moreto.net/novini.php?n=1"),
            self.sa.canonical_url("https://moreto.net/novini.php?n=2"))

    def test_the_filename_day_is_the_sofia_day_not_the_utc_day(self):
        """The stored `published` is an instant (UTC); the filename prefix is a
        publication DAY, and Bulgaria is +02:00/+03:00 — so a UTC-derived
        bucket files everything published 00:00-02:59 local under the previous
        day (143 of 4,361 stored records sit in that window)."""
        # 2026-08-24T00:30 Sofia == 2026-08-23T21:30 UTC
        name = self.sa.article_filename("https://ex.bg/a/1",
                                        "2026-08-23T21:30:00+00:00")
        self.assertTrue(name.startswith("20260824"), name)

    def test_the_filename_key_is_canonical(self):
        """Two spellings of one article must not mint two filenames."""
        a = self.sa.article_filename("https://www.ex.bg/a/1/", None)
        b = self.sa.article_filename("http://ex.bg/a/1?utm_source=x", None)
        self.assertEqual(a, b)

    def test_a_bare_host_keeps_a_root_path(self):
        self.assertEqual(self.sa.canonical_url("https://dnes.bg"),
                         "https://dnes.bg/")


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
