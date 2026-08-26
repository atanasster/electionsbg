#!/usr/bin/env python3
"""Regression tests for analyze_articles.py.

Runs the REAL script as a subprocess against a throwaway repository root
(DATA_BG_ROOT env override), so every test exercises the actual CLI contract:
one JSON object on stdout, exit codes 0/2/3/4. The fixture is a minimal
taxonomy plus a handful of fake corpus articles — no dependency on the live
news/data corpus.

Run:  python3 news/scripts/test_analyze_articles.py
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

SCRIPT = os.path.abspath(os.path.join(os.path.dirname(__file__), "analyze_articles.py"))

TAXONOMY = {
    "version": 1,
    "categories": [
        {
            "id": "society",
            "label": {"bg": "Общество", "en": "Society"},
            "keywords": ["протест", "граждани"],
            "subcategories": [
                {"id": "human-interest", "label": {"bg": "Хора", "en": "Human interest"},
                 "keywords": ["история"]}
            ],
        },
        {
            "id": "not-site-relevant",
            "label": {"bg": "Извън обхвата", "en": "Not site-relevant"},
            "site_relevant": False,
            "keywords": ["времето"],
            "subcategories": [
                {"id": "sports", "label": {"bg": "Спорт", "en": "Sports"}, "keywords": ["футбол"]},
                {"id": "weather", "label": {"bg": "Времето", "en": "Weather"}, "keywords": ["жега"]}
            ],
        },
    ],
}


def corpus_article(domain, fname, url, title, published, content="x" * 500):
    return {
        "domain": domain, "url": url, "title": title, "published": published,
        "author": "Автор", "topic": None, "keywords": None, "description": None,
        "site_name": None, "content": content, "content_chars": len(content),
        "fetched_at": "2026-08-22T00:00:00+00:00",
    }


def analysis(path, url, domain, *, verdict="ok", leaning="neutral", russia="not_applicable",
             action="new_story", story_id=None, titles=None, taxonomy_version=1,
             primary=("society", "human-interest"), extra=None):
    titles = titles or ("Събитие", "An event")
    a = {
        "article_path": path, "url": url, "domain": domain,
        "analyzed_at": "2026-08-22T12:00:00+00:00", "model": "test",
        "taxonomy_version": taxonomy_version,
        "quality": {"verdict": verdict, "notes": ""},
        "summary_bg": "резюме", "summary_en": "summary",
        "leaning": {"label": leaning, "confidence": 0.8, "evidence": "evidence"},
        "russia_stance": {"label": russia, "confidence": 0.8, "evidence": "evidence"},
        "ai_generated": {"verdict": "likely_human", "confidence": 0.7, "signals": []},
        "entities": {"people": [], "parties": [], "institutions": [], "companies": [], "places": []},
        "party_tones": [],
        "topics": [{"category": primary[0], "subcategory": primary[1], "primary": True}],
        "site_relevant": primary[0] != "not-site-relevant",
        "story": {"action": action, "story_id": story_id,
                  "canonical_title_bg": titles[0], "canonical_title_en": titles[1],
                  "summary_bg": "сб", "summary_en": "se"},
    }
    if extra:
        a.update(extra)
    return a


class FixtureTestCase(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="analyze_articles_test_")
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        os.makedirs(os.path.join(self.root, "news", "data", "test.bg"))
        os.makedirs(os.path.join(self.root, "news", "data", "other.bg"))
        os.makedirs(os.path.join(self.root, "news", "scripts"))
        with open(os.path.join(self.root, "news", "topics.json"), "w", encoding="utf-8") as fh:
            json.dump(TAXONOMY, fh, ensure_ascii=False)
        self.articles = {
            "a1": ("test.bg", "20260821-alpha.json",
                   corpus_article("test.bg", "a1", "https://test.bg/alpha", "Алфа събитие", "2026-08-21T10:00:00+00:00")),
            "a2": ("test.bg", "20260822-beta.json",
                   corpus_article("test.bg", "a2", "https://test.bg/beta", "Алфа събитие развитие", "2026-08-22T11:00:00+00:00")),
            "a3": ("other.bg", "20260822-gamma.json",
                   corpus_article("other.bg", "a3", "https://other.bg/gamma", "Гама", "2026-08-22T12:00:00+00:00")),
            "a4": ("test.bg", "20260822-short.json",
                   corpus_article("test.bg", "a4", "https://test.bg/short", "Кратко", "2026-08-22T13:00:00+00:00", content="къс")),
        }
        for key, (domain, fname, rec) in self.articles.items():
            with open(os.path.join(self.root, "news", "data", domain, fname), "w", encoding="utf-8") as fh:
                json.dump(rec, fh, ensure_ascii=False)

    def run_cli(self, *argv, stdin=None, expect_json=True):
        proc = subprocess.run(
            [sys.executable, SCRIPT, *argv],
            capture_output=True, text=True, timeout=60,
            env={**os.environ, "DATA_BG_ROOT": self.root},
            input=stdin,
        )
        out = None
        if expect_json and proc.stdout.strip():
            try:
                out = json.loads(proc.stdout)
            except json.JSONDecodeError:
                self.fail(f"stdout is not one JSON object: {proc.stdout[:200]!r}\nstderr: {proc.stderr[:400]}")
        return proc.returncode, out, proc.stderr

    def save(self, *analyses, expect=0):
        payload = json.dumps(list(analyses), ensure_ascii=False)
        code, out, err = self.run_cli("--save-batch", "-", stdin=payload)
        self.assertEqual(code, expect, f"save exit {code}: {out} / {err[:400]}")
        return out

    def analysis_path(self, key):
        domain, fname, _ = self.articles[key]
        return f"news/data/{domain}/{fname}"

    def index(self):
        with open(os.path.join(self.root, "news", "data", "analysis", "index.json")) as fh:
            return json.load(fh)

    def story(self, story_id):
        with open(os.path.join(self.root, "news", "data", "analysis", "stories", story_id + ".json")) as fh:
            return json.load(fh)


class TestQueueOrdering(FixtureTestCase):
    """The queue used to fill domain-by-domain with the domains in
    ALPHABETICAL order, so under a fixed nightly budget the same handful of
    outlets were analysed every night and the end of the alphabet never was —
    the corpus would have been judged alphabetically for ever."""

    def write_registry(self, ranks):
        path = os.path.join(self.root, "news", "data", "bg_news_sites.csv")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("rank,domain,feed_method_aug2026\n")
            for domain, rank in ranks.items():
                fh.write(f"{rank},{domain},rss\n")

    def queue(self, limit=10):
        code, out, err = self.run_cli("--next", "all", "--limit", str(limit))
        self.assertEqual(code, 0, err[:300])
        return out["queue"]

    def test_the_queue_is_newest_DAY_first_across_all_domains(self):
        """other.bg's article must be reachable ahead of test.bg's older one,
        even though 'other.bg' sorts after 'test.bg' alphabetically.

        The primary key is the DAY, not the timestamp: rank is the tiebreak
        within a day, and ordering by timestamp first would make it almost
        never apply since two articles rarely share a second."""
        q = self.queue()
        days = [(item["published"] or "")[:10] for item in q]
        self.assertEqual(days, sorted(days, reverse=True), days)
        self.assertEqual(days[0], "2026-08-22")
        self.assertEqual(days[-1], "2026-08-21")

    def test_the_single_newest_article_leads_whatever_its_domain(self):
        """⚠️ THE discriminating gate. With limit=1 the alphabetical fill
        returned other.bg's 12:00 article (first domain alphabetically, its
        newest); the global order must return test.bg's 13:00 one.

        Seven of the eight tests written before this one PASSED against the
        alphabetical code — including both whose docstrings named the defect —
        because the fixture's alphabetical order happened to agree with its
        date order for the first few rows."""
        q = self.queue(limit=1)
        self.assertEqual(len(q), 1)
        self.assertEqual(q[0]["published"], "2026-08-22T13:00:00+00:00")
        self.assertEqual(q[0]["domain"], "test.bg")

    def test_a_small_budget_reaches_the_newest_from_a_LATER_domain(self):
        """The starvation itself: a domain late in the alphabet whose article
        is the newest must be reachable within a tiny budget."""
        path = os.path.join(self.root, "news", "data", "zzz.bg")
        os.makedirs(path)
        with open(os.path.join(path, "20260823-newest.json"), "w",
                  encoding="utf-8") as fh:
            json.dump(corpus_article("zzz.bg", "z1", "https://zzz.bg/z",
                                     "Най-новото",
                                     "2026-08-23T09:00:00+00:00"), fh,
                      ensure_ascii=False)
        q = self.queue(limit=1)
        self.assertEqual(q[0]["domain"], "zzz.bg",
                         "the newest article is in the LAST domain "
                         "alphabetically and must still lead")

    def test_an_undated_outlet_is_reachable_within_a_small_budget(self):
        """563 of 4,346 real records carry no publish date and EIGHT outlets
        are 100% undated, including offnews.bg at registry rank 16. Sorting
        them below every dated record put their first position at 3,423 of
        3,981 — never analysed under any nightly budget."""
        path = os.path.join(self.root, "news", "data", "undated.bg")
        os.makedirs(path)
        rec = corpus_article("undated.bg", "u1", "https://undated.bg/u",
                             "Без дата", None)
        rec["fetched_at"] = "2026-08-23T09:00:00+00:00"
        with open(os.path.join(path, "nodate-u.json"), "w",
                  encoding="utf-8") as fh:
            json.dump(rec, fh, ensure_ascii=False)
        q = self.queue(limit=2)
        domains = [i["domain"] for i in q]
        self.assertIn("undated.bg", domains,
                      f"an undated outlet must interleave, not be exiled: {q}")
        entry = next(i for i in q if i["domain"] == "undated.bg")
        self.assertEqual(entry["order_basis"], "fetched_at",
                         "and the basis must be reported, since fetched_at is "
                         "a proxy and not the publication day")

    def test_the_basis_is_reported_for_every_item(self):
        for item in self.queue():
            self.assertIn(item["order_basis"],
                          ("published", "fetched_at", "future_published"))

    def test_outlet_rank_is_the_TIEBREAK_not_the_primary_key(self):
        """Within one day the significant outlets go first; a big outlet's
        older piece must never outrank a small one's newer news."""
        self.write_registry({"other.bg": 1, "test.bg": 60})
        q = self.queue()
        # Within 2026-08-22, other.bg (rank 1) leads test.bg (rank 60).
        same_day = [i for i in q if (i["published"] or "")[:10] == "2026-08-22"]
        self.assertEqual(same_day[0]["domain"], "other.bg", same_day)
        # But the OLDER day is last regardless of rank — a big outlet's stale
        # piece never outranks a newer day.
        self.assertEqual((q[-1]["published"] or "")[:10], "2026-08-21")

    def test_within_one_outlet_and_day_the_newest_article_leads(self):
        self.write_registry({"other.bg": 1, "test.bg": 60})
        mine = [i for i in self.queue()
                if i["domain"] == "test.bg"
                and (i["published"] or "")[:10] == "2026-08-22"]
        stamps = [i["published"] for i in mine]
        self.assertEqual(stamps, sorted(stamps, reverse=True), stamps)

    def test_the_rank_is_reported_so_a_reader_can_see_the_order(self):
        self.write_registry({"other.bg": 1, "test.bg": 60})
        by_domain = {i["domain"]: i.get("outlet_rank") for i in self.queue()}
        self.assertEqual(by_domain["other.bg"], 1)
        self.assertEqual(by_domain["test.bg"], 60)

    def test_a_missing_registry_orders_purely_by_date(self):
        """No registry is not an error — the primary key is still right."""
        days = [(i["published"] or "")[:10] for i in self.queue()]
        self.assertEqual(days, sorted(days, reverse=True))

    def test_the_counts_are_self_consistent_for_one_domain(self):
        """`--next vesti.bg` reported `unanalyzed: 0` beside `returned: 2`,
        because the analysed count was the WHOLE corpus's.

        Discriminating only when something in ANOTHER domain is analysed —
        with an empty analysis set both formulas agree, which is why the
        first version of this test passed against the bug."""
        self.save(analysis(self.analysis_path("a3"), "https://other.bg/gamma",
                           "other.bg", action="new_story"))
        code, out, err = self.run_cli("--next", "test.bg", "--limit", "2")
        self.assertEqual(code, 0, err[:300])
        counts = out["counts"]
        self.assertGreaterEqual(counts["unanalyzed"], counts["returned"])
        self.assertEqual(counts["corpus"],
                         counts["analyzed"] + counts["unanalyzed"],
                         f"counts must describe THIS call's scope: {counts}")
        self.assertEqual(counts["unanalyzed"], 3,
                         "test.bg holds 3 unanalysed articles; other.bg's "
                         "analysed one must not be subtracted from them")

    def test_an_unreadable_record_is_named_not_silently_skipped(self):
        path = os.path.join(self.root, "news", "data", "test.bg",
                            "20260822-torn.json")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("{not json")
        code, out, _ = self.run_cli("--next", "all", "--limit", "10")
        self.assertEqual(code, 0)
        self.assertTrue(out.get("unreadable"), out)
        self.assertIn("torn", out["unreadable"][0]["path"])

    def test_a_future_dated_article_does_not_sort_to_the_top(self):
        """A future publish date sorts first in a newest-first queue for as
        long as it stays in the future, so it would be re-offered every night
        ahead of actual news. The corpus holds three (capital.bg conference
        listings dated to 2026-10-13) from before the saver refused them."""
        path = os.path.join(self.root, "news", "data", "test.bg",
                            "20991231-future.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(corpus_article("test.bg", "fut", "https://test.bg/fut",
                                     "Бъдеща конференция",
                                     "2099-12-31T10:00:00+00:00"), fh,
                      ensure_ascii=False)
        q = self.queue()
        self.assertNotEqual(q[0]["published"], "2099-12-31T10:00:00+00:00")
        self.assertEqual(q[-1]["published"], "2099-12-31T10:00:00+00:00",
                         "a future date tells us nothing; it sorts last")
        self.assertEqual(q[-1]["order_basis"], "future_published")

    def test_the_order_is_declared_in_the_payload(self):
        code, out, _ = self.run_cli("--next", "all", "--limit", "2")
        self.assertEqual(code, 0)
        self.assertIn("publication day", out["order"])
        self.assertIn("outlet rank", out["order"])


class TestPhantomDomain(FixtureTestCase):
    def test_analysis_dir_is_not_a_corpus_domain(self):
        self.save(analysis(self.analysis_path("a1"), "https://test.bg/alpha", "test.bg"))
        self.assertTrue(os.path.isdir(os.path.join(self.root, "news", "data", "analysis")))
        code, out, _ = self.run_cli("--next", "all", "--limit", "50")
        self.assertEqual(code, 0)
        domains = {q["domain"] for q in out["queue"]}
        self.assertNotIn("analysis", domains)
        code, out, _ = self.run_cli("--stats")
        self.assertNotIn("analysis", out["coverage"])
        self.assertEqual(out["corpus_total"], 4)


class TestEntityCap(FixtureTestCase):
    def test_buckets_respect_cap(self):
        records = []
        for i in range(30):
            key = "a1" if i == 0 else "a2" if i == 1 else "a3"
            domain, _, rec = self.articles[key]
            # rotate urls so each save is a distinct article? no — reuse 3 articles:
            # instead vary entities per save of the SAME url to test merge cap
            a = analysis(self.analysis_path(key), rec["url"], domain,
                         titles=("Кълстър", "Cluster"))
            a["entities"]["people"] = [f"Човек {c}" for c in range(3 * (i % 5) + 3)]
            records.append(a)
        # saving the same 3 urls repeatedly with growing entity lists: the
        # merged bucket is bounded by one analysis' list size times nothing —
        # the cap check happens per (member, bucket) merge; with 3 members the
        # worst case is ENTITY_CAP + 2. Assert that bound.
        self.save(*records[:3])
        stories = os.listdir(os.path.join(self.root, "news", "data", "analysis", "stories"))
        with open(os.path.join(self.root, "news", "data", "analysis", "stories", stories[0])) as fh:
            st = json.load(fh)
        for bucket, names in st["entities"].items():
            self.assertLessEqual(len(names), 52, f"bucket {bucket} overran the cap: {len(names)}")


class TestRebuild(FixtureTestCase):
    def test_rebuild_recovers_from_lost_index(self):
        a1 = analysis(self.analysis_path("a1"), "https://test.bg/alpha", "test.bg",
                      titles=("Алфа събитие", "Alpha event"))
        self.save(a1)
        index_path = os.path.join(self.root, "news", "data", "analysis", "index.json")
        with open(index_path) as fh:
            story_id = json.load(fh)["articles"]["https://test.bg/alpha"]["story_id"]
        a2 = analysis(self.analysis_path("a2"), "https://test.bg/beta", "test.bg",
                      action="same_story", story_id=story_id, titles=("Алфа", "Alpha"))
        self.save(a2)

        os.remove(index_path)  # the disaster --rebuild exists for
        code, out, _ = self.run_cli("--rebuild")
        self.assertEqual(code, 0)
        self.assertEqual(out["analyses"], 2)
        self.assertEqual(out["stories"], 1)
        with open(index_path) as fh:
            idx = json.load(fh)
        self.assertEqual(idx["articles"]["https://test.bg/alpha"]["story_id"],
                         idx["articles"]["https://test.bg/beta"]["story_id"])
        story_file = os.path.join(self.root, idx["stories"][idx["articles"]["https://test.bg/alpha"]["story_id"]]["path"])
        with open(story_file) as fh:
            st = json.load(fh)
        self.assertEqual(st["aggregates"]["article_count"], 2)
        self.assertEqual(st["canonical_title_bg"], "Алфа събитие")  # titles survive from the story file

    def test_rebuild_prunes_an_index_entry_whose_analysis_is_gone(self):
        """The plain half of the drift: the analysis file was removed (a
        pruned corpus, a bot_refused site) and nothing cleaned the index, so
        `articles[url].path` named a file that is not there."""
        self.save(analysis(self.analysis_path("a1"), "https://test.bg/alpha", "test.bg"))
        self.save(analysis(self.analysis_path("a2"), "https://test.bg/beta", "test.bg",
                           action="new_story", titles=("Бета", "Beta")))
        gone = os.path.join(self.root, self.index()["articles"]["https://test.bg/beta"]["path"])
        os.remove(gone)

        code, out, _ = self.run_cli("--rebuild")
        self.assertEqual(code, 0)
        self.assertEqual(out["dropped_orphan_articles"], ["https://test.bg/beta"])
        idx = self.index()
        self.assertNotIn("https://test.bg/beta", idx["articles"])
        self.assertIn("https://test.bg/alpha", idx["articles"])  # not a blanket wipe

    def test_rebuild_repoints_an_entry_whose_article_path_went_stale(self):
        """⚠️ THE HALF A DISK SCAN ALONE DOES NOT FIX, and the one that was
        live. The analysis file is present and readable; only the `article_path`
        FROZEN INSIDE IT names a corpus file that has since moved — re-saved
        under a new content hash, or re-keyed to another domain directory. A
        rebuild that derives `path` from that field reproduces the dangle it was
        run to repair, with every count reconciling."""
        a = analysis(self.analysis_path("a1"), "https://test.bg/alpha", "test.bg")
        self.save(a)
        on_disk = self.index()["articles"]["https://test.bg/alpha"]["path"]

        # freeze a stale article_path INTO the saved analysis, leaving the file
        # itself exactly where it is — the live novavarna.net shape.
        stale_corpus = "news/data/test.bg/20260821-alpha-OLDHASH.json"
        full = os.path.join(self.root, on_disk)
        with open(full, encoding="utf-8") as fh:
            rec = json.load(fh)
        rec["article_path"] = stale_corpus
        with open(full, "w", encoding="utf-8") as fh:
            json.dump(rec, fh, ensure_ascii=False)

        code, out, _ = self.run_cli("--rebuild")
        self.assertEqual(code, 0)
        entry = self.index()["articles"]["https://test.bg/alpha"]
        self.assertEqual(entry["path"], on_disk)
        self.assertTrue(os.path.exists(os.path.join(self.root, entry["path"])))
        self.assertEqual(out["stale_article_path"], ["https://test.bg/alpha"])
        self.assertEqual(out["dropped_orphan_articles"], [])  # repointed, NOT pruned

        # ⚠️ MUTATION CHECK. Without this the fixture is satisfiable by the very
        # implementation the test exists to reject: reconstruct what deriving the
        # path from `article_path` would have written and require it to be BOTH
        # different from what was written AND absent from disk. If a future edit
        # makes the fixture non-stale, this fails and says the test went vacuous
        # rather than passing on a scenario that no longer discriminates.
        derived = os.path.join("news", "data", "analysis", "articles",
                               os.path.relpath(stale_corpus, os.path.join("news", "data")))
        self.assertNotEqual(derived, entry["path"])
        self.assertFalse(os.path.exists(os.path.join(self.root, derived)))

    def test_rebuild_leaves_no_dangling_index_entry(self):
        """The invariant itself, over a corpus carrying BOTH failure shapes at
        once — one analysis deleted, one left in place with a stale
        `article_path`. Neither may survive as an entry naming a file that is
        not there."""
        for key, url, title in (("a1", "https://test.bg/alpha", ("Алфа", "Alpha")),
                                ("a2", "https://test.bg/beta", ("Бета", "Beta")),
                                ("a3", "https://other.bg/gamma", ("Гама", "Gamma"))):
            self.save(analysis(self.analysis_path(key), url, url.split("/")[2],
                               action="new_story", titles=title))
        idx = self.index()
        os.remove(os.path.join(self.root, idx["articles"]["https://test.bg/beta"]["path"]))
        full = os.path.join(self.root, idx["articles"]["https://other.bg/gamma"]["path"])
        with open(full, encoding="utf-8") as fh:
            rec = json.load(fh)
        rec["article_path"] = "news/data/other.bg/20260822-gamma-OLDHASH.json"
        with open(full, "w", encoding="utf-8") as fh:
            json.dump(rec, fh, ensure_ascii=False)

        # the state --rebuild is run to repair really is broken first
        before = [u for u, v in self.index()["articles"].items()
                  if not os.path.exists(os.path.join(self.root, v["path"]))]
        self.assertEqual(sorted(before), ["https://test.bg/beta"])

        code, _, _ = self.run_cli("--rebuild")
        self.assertEqual(code, 0)
        after = self.index()["articles"]
        dangling = [u for u, v in after.items()
                    if not os.path.exists(os.path.join(self.root, v["path"]))]
        self.assertEqual(dangling, [], f"index entries name files that are not on disk: {dangling}")
        self.assertEqual(sorted(after), ["https://other.bg/gamma", "https://test.bg/alpha"])

    def test_rebuild_drops_orphan_story_files(self):
        self.save(analysis(self.analysis_path("a1"), "https://test.bg/alpha", "test.bg"))
        stories_dir = os.path.join(self.root, "news", "data", "analysis", "stories")
        with open(os.path.join(stories_dir, "20200101-deadbeef.json"), "w") as fh:
            json.dump({"id": "20200101-deadbeef", "members": [], "related_story_ids": []}, fh)
        code, out, _ = self.run_cli("--rebuild")
        self.assertEqual(code, 0)
        self.assertIn("20200101-deadbeef", out["dropped_orphan_stories"])
        self.assertFalse(os.path.exists(os.path.join(stories_dir, "20200101-deadbeef.json")))


class TestCrashConsistency(FixtureTestCase):
    def test_index_flushed_per_record_and_reanalysis_moves_membership(self):
        a1 = analysis(self.analysis_path("a1"), "https://test.bg/alpha", "test.bg",
                      titles=("Първи клъстер", "First cluster"))
        a1b = analysis(self.analysis_path("a3"), "https://other.bg/gamma", "other.bg",
                       action="new_story", titles=("Гама клъстер", "Gamma cluster"))
        # batch where the middle record is invalid: a1 must still be on disk+index
        bad = analysis(self.analysis_path("a2"), "https://test.bg/beta", "test.bg")
        bad["leaning"]["label"] = "bogus"
        out = self.save(a1, bad, a1b, expect=3)
        self.assertEqual(len(out["saved"]), 2)
        index_path = os.path.join(self.root, "news", "data", "analysis", "index.json")
        with open(index_path) as fh:
            idx = json.load(fh)
        self.assertIn("https://test.bg/alpha", idx["articles"])

        # simulate the crash window: index loses alpha's entry, story keeps it
        alpha_story = idx["articles"]["https://test.bg/alpha"]["story_id"]
        idx["articles"].pop("https://test.bg/alpha")
        with open(index_path, "w") as fh:
            json.dump(idx, fh)

        # re-analysis attaching to the OTHER story must detach via the
        # story-scan fallback, and the emptied story must be deleted
        moved = analysis(self.analysis_path("a1"), "https://test.bg/alpha", "test.bg",
                         action="same_story",
                         story_id=idx["articles"]["https://other.bg/gamma"]["story_id"],
                         titles=("Гама клъстер", "Gamma cluster"))
        self.save(moved)
        with open(index_path) as fh:
            idx2 = json.load(fh)
        self.assertNotIn(alpha_story, idx2["stories"])
        self.assertFalse(os.path.exists(
            os.path.join(self.root, "news", "data", "analysis", "stories", alpha_story + ".json")))
        # exactly one story remains, holding both articles
        self.assertEqual(len(idx2["stories"]), 1)
        remaining = next(iter(idx2["stories"].values()))
        self.assertEqual(remaining["member_count"], 2)


class TestStoryHygiene(FixtureTestCase):
    def test_deleted_story_prunes_related_ids(self):
        a1 = analysis(self.analysis_path("a1"), "https://test.bg/alpha", "test.bg",
                      titles=("Главен", "Main"))
        self.save(a1)
        main_id = self.index()["articles"]["https://test.bg/alpha"]["story_id"]

        # a second story that links to the first, via related ids on a new record
        a3 = analysis(self.analysis_path("a3"), "https://other.bg/gamma", "other.bg",
                      titles=("Свързан", "Related"))
        a3["story"]["related_story_ids"] = [main_id]
        self.save(a3)

        # detaching a1's only member must delete the main story and prune the link
        related_id = self.index()["articles"]["https://other.bg/gamma"]["story_id"]
        moved = analysis(self.analysis_path("a1"), "https://test.bg/alpha", "test.bg",
                         action="same_story", story_id=related_id,
                         titles=("Свързан", "Related"))
        self.save(moved)
        st = self.story(related_id)
        self.assertNotIn(main_id, st["related_story_ids"])


class TestValidationNeverRaises(FixtureTestCase):
    def test_malformed_records_return_errors_not_tracebacks(self):
        cases = [
            {"topics": [{"category": ["economy"], "primary": True, "subcategory": None}]},
            {"story": {"action": "same_story", "story_id": {"x": 1}}},
            {"story": {"action": "new_story", "related_story_ids": [[]],
                       "canonical_title_bg": "т", "canonical_title_en": "t",
                       "summary_bg": "с", "summary_en": "s"}},
            {"taxonomy_version": True},
            {"leaning": None},
            {"analyzed_at": "yesterday"},
        ]
        for extra in cases:
            a = analysis(self.analysis_path("a1"), "https://test.bg/alpha", "test.bg")
            a.update(extra)
            if extra.get("topics"):
                a["topics"] = extra["topics"]
            if "story" in extra:
                a["story"].update(extra["story"])
            code, out, err = self.run_cli("--save-analysis", "-", stdin=json.dumps(a, ensure_ascii=False))
            self.assertEqual(code, 3, f"case {extra}: exit {code}, out={out}, err={err[:300]}")
            self.assertIn("failed", out)

    def test_wrong_shape_index_fails_loudly_not_crashing(self):
        self.save(analysis(self.analysis_path("a1"), "https://test.bg/alpha", "test.bg"))
        index_path = os.path.join(self.root, "news", "data", "analysis", "index.json")
        with open(index_path, "w") as fh:
            json.dump(["not", "a", "dict"], fh)
        code, out, err = self.run_cli("--candidates", self.analysis_path("a2"))
        self.assertEqual(code, 4)
        self.assertEqual(out["error"], "internal")
        self.assertIn("--rebuild", out["detail"])


class TestPrefilterEntities(unittest.TestCase):
    # pure function — import in-process, no CLI or fixture needed
    def test_entity_hits_match_case_insensitive_and_word_bounded(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("analyze_mod", SCRIPT)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        self.assertTrue(mod.entity_in_text("ДАНС", "вчера ДАНС откри заглушител"))  # raw-case haystack
        self.assertTrue(mod.entity_in_text("Капитан Андреево", "имот край Капитан Андреево е претърсен"))
        self.assertFalse(mod.entity_in_text("Иван", "иванов е следствател"))
        self.assertFalse(mod.entity_in_text("ГЕРБ", "гербовци реагираха"))
        self.assertFalse(mod.entity_in_text("ГЕРБ", "герб7"))  # digit boundary


class TestPrefilterEntityChannel(FixtureTestCase):
    def test_body_only_entity_mention_surfaces_story(self):
        """End-to-end pin: an entity hit found only in the article BODY (title
        case, no title-token overlap) surfaces the story; and token overlap
        from the body alone does NOT — art_tokens stays title-only."""
        a1 = analysis(self.analysis_path("a1"), "https://test.bg/alpha", "test.bg",
                      titles=("Разследване на Иван Кирилов", "Probe"))
        a1["entities"]["people"] = ["Иван Кирилов"]
        self.save(a1)
        _, fname, rec = self.articles["a2"]
        rec["title"] = "Напълно друга тема"
        rec["description"], rec["keywords"] = None, None
        rec["content"] = "Вчера Иван Кирилов проведе пресконференция. " + "текст " * 80
        with open(os.path.join(self.root, "news", "data", "test.bg", fname), "w", encoding="utf-8") as fh:
            json.dump(rec, fh, ensure_ascii=False)
        code, out, _ = self.run_cli("--candidates", self.analysis_path("a2"))
        self.assertEqual(code, 0)
        self.assertEqual(len(out["candidates"]), 1)
        self.assertEqual(out["candidates"][0]["entity_hits"], ["Иван Кирилов"])
        self.assertEqual(out["candidates"][0]["shared_title_tokens"], [])

        # negative: body sharing only common words with the story TITLE must
        # not surface it (content never feeds art_tokens)
        _, fname3, rec3 = self.articles["a3"]
        rec3["title"] = "Нещо трето изобщо"
        rec3["description"], rec3["keywords"] = None, None
        rec3["content"] = "Разследване продължава вече месеци. " + "друго " * 80
        with open(os.path.join(self.root, "news", "data", "other.bg", fname3), "w", encoding="utf-8") as fh:
            json.dump(rec3, fh, ensure_ascii=False)
        code, out, _ = self.run_cli("--candidates", self.analysis_path("a3"))
        self.assertEqual(code, 0)
        self.assertEqual(out["candidates"], [])
        # and a4 (no entity, body-only word overlap with nothing) stays empty
        code, out, _ = self.run_cli("--candidates", self.analysis_path("a4"))
        self.assertEqual(code, 0)
        self.assertEqual(out["candidates"], [])


class TestPrefilterDates(FixtureTestCase):
    def test_partial_and_garbage_dates_degrade_to_zero(self):
        _, fname, rec = self.articles["a1"]
        rec["published"] = "2026-08"  # partial ISO
        with open(os.path.join(self.root, "news", "data", "test.bg", fname), "w") as fh:
            json.dump(rec, fh)
        self.save(analysis(self.analysis_path("a1"), "https://test.bg/alpha", "test.bg"))
        _, fname2, rec2 = self.articles["a2"]
        rec2["published"] = "Fri, 21 Aug"  # non-ISO
        rec2["title"] = "Алфа събитие"     # strong token overlap
        with open(os.path.join(self.root, "news", "data", "test.bg", fname2), "w") as fh:
            json.dump(rec2, fh)
        code, out, err = self.run_cli("--candidates", self.analysis_path("a2"))
        self.assertEqual(code, 0, err[:300])
        self.assertEqual(len(out["candidates"]), 1)  # token overlap, not dates, carried it


class TestCliContract(FixtureTestCase):
    def test_limit_zero_rejected(self):
        code, out, _ = self.run_cli("--next", "all", "--limit", "0")
        self.assertEqual(code, 3)
        self.assertEqual(out["error"], "bad_limit")

    def test_unknown_domain_exit_2(self):
        code, out, _ = self.run_cli("--next", "nope.bg")
        self.assertEqual(code, 2)
        self.assertEqual(out["error"], "unknown_domain")

    def test_conflicting_modes_rejected(self):
        code, out, _ = self.run_cli("--stats", "--next", "all")
        self.assertEqual(code, 3)
        self.assertEqual(out["error"], "bad_arguments")

    def test_no_mode_rejected(self):
        code, out, _ = self.run_cli()
        self.assertEqual(code, 3)
        self.assertEqual(out["error"], "bad_arguments")


class AlteredNameMustNotSurviveInProse(FixtureTestCase):
    """⚠️ The chip is a word in a sidebar; the summary is the lead paragraph.
    All five affected records repeated the altered surname in `summary_bg`, so
    a validator that refuses only `entities.people` refuses the quieter half."""

    def setUp(self):
        super().setUp()
        import analyze_articles
        self.aa = analyze_articles

    def rec(self, body):
        return {"title": "", "description": "", "content": body}

    def test_a_leaked_name_in_the_summary_is_refused(self):
        errs = self.aa.check_person_names(
            {"people": ["Антон Славев"]},
            self.rec("Антон Славчев подаде оставка. " * 10),
            {"summary_bg": "Антон Славев получи обезщетение."})
        self.assertTrue(any(e.startswith("summary_bg:") for e in errs), errs)

    def test_a_CORRECT_summary_beside_a_bad_chip_is_not_refused(self):
        # ⚠️ Per FIELD. In all five records the ENGLISH summary has the name
        # right, so refusing the pair would punish a correct sentence.
        errs = self.aa.check_person_names(
            {"people": ["Антон Славев"]},
            self.rec("Антон Славчев подаде оставка. " * 10),
            {"summary_en": "Anton Slavchev resigned."})
        self.assertEqual([e for e in errs if e.startswith("summary_")], [])

    def test_prose_is_only_checked_for_ALREADY_PROVEN_tokens(self):
        # ⚠️ A summary is Bulgarian prose full of INFLECTED words, and a
        # general „is this word in the article" sweep over it has the same
        # false-positive problem that keeps institutions out of the rule
        # entirely. Here the record IS bad — so the arm runs — and the
        # summary carries only ordinary inflection plus the good name. Only
        # the proven token may be reported.
        errs = self.aa.check_person_names(
            {"people": ["Антон Славев"]},
            self.rec("Антон Славчев подаде оставка пред комисия. " * 10),
            {"summary_bg": "Комисията и комисиите решиха за Славчев."})
        self.assertEqual([e for e in errs if e.startswith("summary_")], [],
                         "inflection was reported as an altered name")
        self.assertTrue(any(e.startswith("entities.people:") for e in errs))

    def test_a_clean_record_examines_no_prose_at_all(self):
        errs = self.aa.check_person_names(
            {"people": ["Антон Славчев"]},
            self.rec("Антон Славчев подаде оставка. " * 10),
            {"summary_bg": "Комисията, комисиите и на комисията решиха."})
        self.assertEqual(errs, [])

    def test_no_analysis_means_no_prose_arm_rather_than_a_crash(self):
        errs = self.aa.check_person_names(
            {"people": ["Антон Славев"]},
            self.rec("Антон Славчев подаде оставка. " * 10))
        self.assertTrue(errs)
        self.assertFalse(any(e.startswith("summary_") for e in errs))


class ProseIsCheckedEvenWhenEntitiesAreClean(FixtureTestCase):
    """⚠️⚠️ The hole that shipped „Каллас". The prose arm was scoped to the
    tokens the ENTITY check proved altered — so the moment a re-analysis
    corrected `entities.people`, the summary was examined by nothing, and a
    record went out disagreeing with itself."""

    def setUp(self):
        super().setUp()
        import analyze_articles
        self.aa = analyze_articles
        self.body = "Кая Калас обвини Русия в тероризъм. " * 10
        self.ents = {"people": ["Кая Калас"], "parties": [],
                     "institutions": [], "companies": [], "places": []}

    def test_a_stale_summary_is_caught_with_CORRECT_entities(self):
        errs = self.aa.check_person_names(
            self.ents, {"content": self.body},
            {"summary_bg": "Каллас обвини Русия."})
        self.assertTrue(any(e.startswith("summary_bg:") for e in errs), errs)

    def test_the_article_SPELLING_passes(self):
        errs = self.aa.check_person_names(
            self.ents, {"content": self.body},
            {"summary_bg": "Калас обвини Русия."})
        self.assertEqual(errs, [])

    def test_a_LOWERCASE_common_word_is_not_a_name(self):
        # ⚠️ Measured: without this, 3 of 4 corpus hits were „пред" (a
        # preposition, 2 edits from „пеев") and „бива" (a verb, 2 edits from
        # „иван"). A name in Bulgarian prose is capitalised.
        errs = self.aa.check_person_names(
            {"people": ["Иван Пеев"], "parties": [], "institutions": [],
             "companies": [], "places": []},
            {"content": "Иван Пеев подаде оставка. " * 10},
            {"summary_bg": "Оставката бива внесена пред комисията."})
        self.assertEqual(errs, [])

    def test_a_LONG_lowercase_word_is_still_not_a_name(self):
        # ⚠️ ISOLATES THE CAPITALISATION RULE, which the short cases above do
        # not — the length window already rejects those. „славчева" is an
        # ordinary Bulgarian possessive form: 8 characters, ONE edit from the
        # surname, and absent from the article. Only „a name is capitalised"
        # keeps it out, and without that a summary is withheld over a
        # grammatical inflection of a name it spelled correctly.
        found = self.aa.altered_names_in_prose(
            {"people": ["Иван Славчев"]},
            [{"content": "Иван Славчев подаде оставка. " * 10}],
            "Това е славчева работа.")
        self.assertEqual(found, [])

    def test_the_same_word_CAPITALISED_is_caught(self):
        # The pair, so the test above cannot pass by the rule never firing.
        found = self.aa.altered_names_in_prose(
            {"people": ["Иван Славчев"]},
            [{"content": "Иван Славчев подаде оставка. " * 10}],
            "Славчева подаде оставка.")
        self.assertEqual([u for _w, u in found], ["Славчева"])

    def test_a_SHORT_token_gets_a_one_edit_window_only(self):
        # Two edits on a four-letter token is most of the word.
        found = self.aa.altered_names_in_prose(
            {"people": ["Иван Пеев"]},
            [{"content": "Иван Пеев подаде оставка. " * 10}],
            "Пред комисията.")
        self.assertEqual(found, [])

    def test_a_name_the_ARTICLE_never_writes_anchors_nothing(self):
        # ⚠️ The anchor is a name the article CORROBORATES. An entity the
        # article does not contain cannot license a prose verdict.
        found = self.aa.altered_names_in_prose(
            {"people": ["Непознат Човек"]},
            [{"content": "Съвсем друга статия. " * 10}],
            "Непознет Човек каза нещо.")
        self.assertEqual(found, [])


class PersonNamesAreCopied(FixtureTestCase):
    """⚠️⚠️ „Антон Славев" was published where the article said „Антон
    Славчев" — a person who does not exist, while Антон Славчев is in the
    identity layer with declarations. „Кая Каллас" twice for „Калас". Three
    of 344 name tokens across the corpus.

    A name one letter from a real one is worse than a missing one: it is a
    claim about a named individual that no register can confirm, and it
    silently costs the link that would have made it checkable.
    """

    def save_with_people(self, body, people, expect=0):
        domain, fname, rec = self.articles["a1"]
        rec = dict(rec, content=body, title=body[:60])
        with open(os.path.join(self.root, "news", "data", domain, fname),
                  "w", encoding="utf-8") as fh:
            json.dump(rec, fh, ensure_ascii=False)
        a = analysis(self.analysis_path("a1"), "https://test.bg/alpha",
                     "test.bg")
        a["entities"] = {"people": people, "parties": [], "institutions": [],
                         "companies": [], "places": []}
        return self.save(a, expect=expect)

    def test_an_ALTERED_surname_is_refused(self):
        out = self.save_with_people(
            "Антон Славчев подаде оставка от поста. " * 12, ["Антон Славев"],
            expect=3)
        msgs = [e for r in out["failed"] for e in r["errors"]]
        self.assertTrue(any("Славчев" in e for e in msgs), msgs)

    def test_a_DOUBLED_letter_is_refused(self):
        out = self.save_with_people(
            "Кая Калас заяви пред журналисти нещо важно. " * 12,
            ["Кая Каллас"], expect=3)
        msgs = [e for r in out["failed"] for e in r["errors"]]
        self.assertTrue(any("Калас" in e for e in msgs), msgs)

    def test_a_name_copied_EXACTLY_passes(self):
        self.save_with_people(
            "Антон Славчев подаде оставка от поста. " * 12, ["Антон Славчев"])

    def test_a_name_COMPOSED_from_context_is_allowed(self):
        # ⚠️ „Absent" is not the test — „absent but NEARLY PRESENT" is. A
        # model writing „Росен Желязков" from a text that says only
        # „Желязков" is inferring, which is legitimate and common. Refusing
        # it would reject most of the corpus.
        self.save_with_people(
            "Премиерът Желязков обяви решението на кабинета. " * 12,
            ["Росен Желязков"])

    def test_a_name_absent_ENTIRELY_is_allowed(self):
        self.save_with_people(
            "Няма никакви имена в този текст изобщо, само думи. " * 12,
            ["Кевин Кастро"])

    def test_a_SHORT_token_is_not_checked(self):
        # ⚠️ Two- and three-letter tokens sit within two edits of half the
        # language; checking them would refuse everything.
        self.save_with_people(
            "Иван Пеев каза нещо важно на всички днес. " * 12, ["Иван Гео"])

    def test_INSTITUTIONS_are_not_subject_to_the_rule(self):
        # ⚠️ On institutions and places the same rule fires on Bulgarian
        # INFLECTION — „Съвет" against „съвета", „Русия" against „руският" —
        # 53 hits, essentially all false. Personal names do not take the
        # definite article, which is why only the people arm is switched on.
        a = analysis(self.analysis_path("a1"), "https://test.bg/alpha",
                     "test.bg")
        a["entities"] = {"people": [], "parties": [],
                         "institutions": ["Съвет на Европа"],
                         "companies": [], "places": ["Русия"]}
        domain, fname, rec = self.articles["a1"]
        with open(os.path.join(self.root, "news", "data", domain, fname),
                  "w", encoding="utf-8") as fh:
            json.dump(dict(rec, content="Съвета обсъди руският въпрос. " * 14),
                      fh, ensure_ascii=False)
        self.save(a)


class Mentions(FixtureTestCase):
    """The `mentions` sibling block.

    ⚠️ The rule every test here defends is ONE rule: a mention that could not
    be resolved must not carry an id. Bulgarian newsrooms write two-part names
    and the identity layer stores three, so of 17 corpus names tested ZERO
    matched exactly and every one matched ambiguously when folded — Борисов 7
    candidates, Радев 15, Цветан Василев 21. Rank-picking would be right for
    one and wrong for another, and a wrong link is SHAPE-IDENTICAL to a right
    one, so no downstream gate can catch it.
    """

    def mention(self, **over):
        m = {"kind": "person", "surface": "Делян Пеевски",
             "basis": "gazetteer_exact", "id": "delyan-peevski-ab12cd",
             "role": "subject"}
        m.update(over)
        return m

    def save_with(self, mentions, expect=0):
        return self.save(analysis(self.analysis_path("a1"), "https://test.bg/alpha",
                                  "test.bg", extra={"mentions": mentions}),
                         expect=expect)

    def saved(self):
        d = os.path.join(self.root, "news", "data", "analysis", "articles", "test.bg")
        with open(os.path.join(d, os.listdir(d)[0]), encoding="utf-8") as fh:
            return json.load(fh)

    GAZ = {"version": 1, "entries": [
        {"kind": "person", "canonical": "Делян Пеевски", "forms": [
            {"surface": "Делян Пеевски", "resolvable": True,
             "id": "delyan-peevski-ab12cd", "why": ""},
            {"surface": "Пеевски", "resolvable": False, "id": None,
             "anchor_for": "delyan-peevski-ab12cd", "why": ""}]},
        {"kind": "person", "canonical": "Иван Пеевски", "forms": [
            {"surface": "Иван Пеевски", "resolvable": True, "id": "ip-9",
             "why": ""},
            {"surface": "Пеевски", "resolvable": False, "id": None,
             "anchor_for": "ip-9", "why": ""}]}]}

    def write_gazetteer(self, doc=None):
        path = os.path.join(self.root, "news", "data", "gazetteer.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(doc if doc is not None else self.GAZ, fh,
                      ensure_ascii=False)

    def set_body(self, key, text):
        domain, fname, rec = self.articles[key]
        rec = dict(rec, content=text, title=text[:60])
        with open(os.path.join(self.root, "news", "data", domain, fname),
                  "w", encoding="utf-8") as fh:
            json.dump(rec, fh, ensure_ascii=False)

    def test_a_resolved_mention_is_stored(self):
        self.save_with([self.mention()])
        got = self.saved()["mentions"]
        self.assertEqual(len(got), 1)
        self.assertEqual(got[0]["id"], "delyan-peevski-ab12cd")
        self.assertEqual(got[0]["surface"], "Делян Пеевски")

    def test_a_refused_mention_may_not_carry_an_id(self):
        # ⚠️⚠️ THE assertion. An id here links a story to a specific named
        # individual on the strength of a shared surname.
        for basis in ("ambiguous_refused", "not_in_gazetteer"):
            with self.subTest(basis=basis):
                out = self.save_with(
                    [self.mention(basis=basis, id="tsvetan-vasilev-1",
                                  candidates=["a", "b"])],
                    expect=3)
                self.assertTrue(
                    any("must be null" in e for r in out["failed"]
                        for e in r["errors"]), out)

    def test_a_refused_mention_is_KEPT_not_dropped(self):
        # „we found no link" and „nobody was mentioned" are different claims,
        # and only the first is true of a refusal.
        self.save_with([self.mention(basis="ambiguous_refused", id=None,
                                     candidates=["Цветан Василев (1)",
                                                 "Цветан Василев (2)"]),
                        self.mention(basis="not_in_gazetteer", id=None,
                                     surface="Неизвестен Човек")])
        got = self.saved()["mentions"]
        self.assertEqual(len(got), 2)
        self.assertEqual([m["basis"] for m in got],
                         ["ambiguous_refused", "not_in_gazetteer"])

    def test_a_resolution_with_nothing_to_link_to_is_refused(self):
        out = self.save_with([self.mention(id=None)], expect=3)
        self.assertTrue(any("id: required" in e for r in out["failed"]
                            for e in r["errors"]), out)

    def test_one_candidate_is_not_an_ambiguity(self):
        out = self.save_with([self.mention(basis="ambiguous_refused", id=None,
                                           candidates=["only-one"])], expect=3)
        self.assertTrue(any("at least two" in e for r in out["failed"]
                            for e in r["errors"]), out)

    def test_the_vocabularies_are_closed(self):
        for field, bad in (("kind", "politician"), ("basis", "best_match"),
                           ("role", "protagonist")):
            with self.subTest(field=field):
                out = self.save_with([self.mention(**{field: bad})], expect=3)
                self.assertTrue(any(f".{field}" in e for r in out["failed"]
                                    for e in r["errors"]), out)

    def test_there_is_no_rank_picking_basis(self):
        # ⚠️ A guard against the fix somebody will reach for the first time
        # this refuses a name they can see is right. Adding a basis meaning
        # "highest-ranked candidate" re-introduces the whole defect, and it
        # would pass every other test in this file.
        import analyze_articles as m
        for banned in ("best_match", "highest_ranked", "top_candidate",
                       "fuzzy", "inferred", "probable", "guessed"):
            self.assertNotIn(banned, m.MENTION_BASES)
        self.assertEqual(set(m.MENTION_BASES) - set(m.MENTION_BASES_WITH_ID),
                         {"ambiguous_refused", "not_in_gazetteer"})

    def test_the_surface_string_is_required(self):
        # ⚠️ The load-bearing one, and it was untested: deleting the check
        # left every other test green. `surface` is the string AS WRITTEN in
        # the article — it is what a reader sees, what a roster reviewer
        # judges, and the only thing tying a refused mention to anything at
        # all. A mention without it is an id and a shrug.
        for bad in (None, "", "   ", 42, ["Пеевски"]):
            with self.subTest(surface=bad):
                out = self.save_with([self.mention(surface=bad)], expect=3)
                self.assertTrue(any(".surface" in e for r in out["failed"]
                                    for e in r["errors"]), out)

    def test_a_mention_must_be_an_object(self):
        out = self.save_with(["Делян Пеевски"], expect=3)
        self.assertTrue(any("must be an object" in e for r in out["failed"]
                            for e in r["errors"]), out)

    def test_the_block_must_be_a_list(self):
        # ⚠️ A dict here would be the `entities` shape, i.e. exactly the merge
        # the two blocks exist to prevent — so it has to fail loudly rather
        # than being iterated as keys.
        out = self.save_with({"people": ["Пеевски"]}, expect=3)
        self.assertTrue(any("must be a list" in e for r in out["failed"]
                            for e in r["errors"]), out)

    def test_candidates_must_be_strings(self):
        out = self.save_with([self.mention(basis="ambiguous_refused", id=None,
                                           candidates=[{"slug": "a"}, "b"])],
                             expect=3)
        self.assertTrue(any(".candidates" in e for r in out["failed"]
                            for e in r["errors"]), out)

    def test_ambiguity_cannot_be_claimed_by_omission(self):
        # ⚠️ Gated on `is not None`, OMITTING the key passed while `[]` and
        # `["one"]` were both rejected — so the ≥2 rule was bypassable by
        # leaving it out, which is what a generator does by default.
        for cands in (None, [], ["only-one"]):
            with self.subTest(candidates=cands):
                m = self.mention(basis="ambiguous_refused", id=None)
                if cands is not None:
                    m["candidates"] = cands
                out = self.save_with([m], expect=3)
                self.assertTrue(any("at least two" in e for r in out["failed"]
                                    for e in r["errors"]), out)

    def test_a_refusal_names_the_rule_it_broke(self):
        # ⚠️ The three id checks were one if/elif chain, so a malformed id
        # short-circuited the refusal check: a not_in_gazetteer mention with
        # id=123 was reported only as "must be a non-empty string", never as
        # "may not name an individual". The record was still rejected — but a
        # regression in the branch this module exists for would be invisible
        # whenever the id happened to be junk too.
        out = self.save_with([self.mention(basis="not_in_gazetteer", id=123)],
                             expect=3)
        msgs = [e for r in out["failed"] for e in r["errors"]]
        self.assertTrue(any("must be null" in e for e in msgs), msgs)

    def test_an_unknown_key_is_refused(self):
        out = self.save_with([self.mention(confidence=0.9)], expect=3)
        self.assertTrue(any("unknown keys" in e for r in out["failed"]
                            for e in r["errors"]), out)

    def test_the_block_is_optional_and_absent_is_not_empty(self):
        # ⚠️ Every one of the 365 analyses on disk predates this block. A
        # validator requiring it would reject the whole corpus; a builder
        # defaulting it to [] would publish „mentions nobody" about all of it.
        self.save(analysis(self.analysis_path("a1"), "https://test.bg/alpha",
                           "test.bg"))
        self.assertNotIn("mentions", self.saved())

    def test_the_analyst_may_not_MINT_an_identity(self):
        # ⚠️⚠️ THE check a well-formed lie cannot pass. validate_mentions
        # proves a mention is SHAPED right; it cannot prove the id is the one
        # the gazetteer produced, because a fabricated id looks exactly like
        # a real one. So the dictionary pass is re-run and compared.
        self.write_gazetteer()
        self.set_body("a1", "Днес Пеевски заяви пред медиите нещо важно. " * 12)
        out = self.save_with([self.mention(
            surface="Пеевски", basis="gazetteer_exact",
            id="delyan-peevski-ab12cd")], expect=3)
        msgs = [e for r in out["failed"] for e in r["errors"]]
        self.assertTrue(any("dictionary pass" in e for e in msgs), msgs)

    def test_an_id_on_a_name_the_dictionary_never_saw_is_refused(self):
        self.write_gazetteer()
        self.set_body("a1", "Няма познати имена в този текст изобщо. " * 15)
        out = self.save_with([self.mention(
            surface="Непознат Човек", basis="gazetteer_exact",
            id="fabricated-1")], expect=3)
        msgs = [e for r in out["failed"] for e in r["errors"]]
        self.assertTrue(any("may not mint an identity" in e for e in msgs), msgs)

    def test_an_unknown_name_may_be_recorded_WITHOUT_an_id(self):
        # The analyst can see names a gazetteer never will; that is welcome,
        # so long as it claims no identity for them.
        self.write_gazetteer()
        self.set_body("a1", "Няма познати имена в този текст изобщо. " * 15)
        self.save_with([self.mention(surface="Непознат Човек",
                                     basis="not_in_gazetteer", id=None)])
        self.assertEqual(self.saved()["mentions"][0]["id"], None)

    def test_a_matching_mention_passes_and_keeps_its_role(self):
        # ⚠️ `role` is the ONE field the analyst may set — a dictionary
        # cannot tell a story's subject from a name in the last paragraph.
        self.write_gazetteer()
        self.set_body("a1", "Делян Пеевски заяви днес нещо много важно. " * 12)
        self.save_with([self.mention(surface="Делян Пеевски",
                                     basis="gazetteer_exact",
                                     id="delyan-peevski-ab12cd",
                                     role="subject")])
        got = self.saved()["mentions"][0]
        self.assertEqual(got["role"], "subject")
        self.assertEqual(got["id"], "delyan-peevski-ab12cd")

    def test_a_basis_may_not_be_promoted(self):
        # Two roster people share „Пеевски" and neither full name appears, so
        # the dictionary refuses. An analyst calling that a coreference is
        # asserting something the document does not say.
        self.write_gazetteer()
        self.set_body("a1", "Днес Пеевски заяви пред медиите нещо важно. " * 12)
        out = self.save_with([self.mention(
            surface="Пеевски", basis="coref_resolved",
            id="delyan-peevski-ab12cd")], expect=3)
        msgs = [e for r in out["failed"] for e in r["errors"]]
        self.assertTrue(any(".basis" in e or "dictionary pass" in e
                            for e in msgs), msgs)

    def test_ONLY_the_id_differing_is_refused(self):
        # ⚠️ Isolates the id comparison. In the mint test above the basis
        # ALSO differs, so that test passes even with the id check deleted —
        # one assertion masking the other is how a guard goes half-dead.
        self.write_gazetteer()
        self.set_body("a1", "Делян Пеевски заяви днес нещо много важно. " * 12)
        out = self.save_with([self.mention(
            surface="Делян Пеевски", basis="gazetteer_exact",
            id="somebody-else-99")], expect=3)
        msgs = [e for r in out["failed"] for e in r["errors"]]
        self.assertTrue(any(".id:" in e for e in msgs), msgs)

    def test_ONLY_the_basis_differing_is_refused(self):
        # The mirror image: the id is right, the provenance claim is not.
        # „coref_resolved" asserts the document named him twice; it did not.
        self.write_gazetteer()
        self.set_body("a1", "Делян Пеевски заяви днес нещо много важно. " * 12)
        out = self.save_with([self.mention(
            surface="Делян Пеевски", basis="coref_resolved",
            id="delyan-peevski-ab12cd")], expect=3)
        msgs = [e for r in out["failed"] for e in r["errors"]]
        self.assertTrue(any(".basis:" in e for e in msgs), msgs)

    def test_the_analyst_may_not_INVENT_CANDIDATES(self):
        # ⚠️⚠️ A LIVE HOLE: only `id` and `basis` were compared, so
        # `candidates` was free text no check touched — and a record could be
        # saved at exit 0 asserting an article's „Пеевски" was ambiguous
        # between Бойко Борисов and Цветан Василев. Two names the dictionary
        # never proposed, about real people, published as our finding.
        self.write_gazetteer()
        self.set_body("a1", "Днес Пеевски заяви пред медиите нещо важно. " * 12)
        out = self.save_with([self.mention(
            surface="Пеевски", basis="ambiguous_refused", id=None,
            candidates=["Бойко Борисов (person, bb-1)",
                        "Цветан Василев (person, cv-1)"])], expect=3)
        msgs = [e for r in out["failed"] for e in r["errors"]]
        self.assertTrue(any(".candidates" in e for e in msgs), msgs)

    def test_candidates_may_not_ride_an_INVENTED_mention_either(self):
        self.write_gazetteer()
        self.set_body("a1", "Няма познати имена в този текст изобщо. " * 15)
        out = self.save_with([self.mention(
            surface="Непознат Човек", basis="not_in_gazetteer", id=None,
            candidates=["Бойко Борисов", "Цветан Василев"])], expect=3)
        msgs = [e for r in out["failed"] for e in r["errors"]]
        self.assertTrue(any(".candidates" in e for e in msgs), msgs)

    def test_the_TRUE_candidates_are_accepted(self):
        self.write_gazetteer()
        self.set_body("a1", "Днес Пеевски заяви пред медиите нещо важно. " * 12)
        # Taken from the dictionary itself rather than hand-written, so this
        # cannot drift from what the resolver actually produces.
        import resolve_mentions as rm
        gaz = rm.Gazetteer(self.GAZ)
        domain, fname, _ = self.articles["a1"]
        with open(os.path.join(self.root, "news", "data", domain, fname),
                  encoding="utf-8") as fh:
            rec = json.load(fh)
        truth = rm.dedupe(rm.resolve(rm.article_text(rec), gaz))[0]
        self.save_with([{**truth, "role": "subject"}])
        self.assertEqual(self.saved()["mentions"][0].get("candidates"),
                         truth.get("candidates"))

    def test_a_tidied_up_quote_in_a_surface_is_NOT_treated_as_minting(self):
        # ⚠️ resolve() slices between token boundaries, so a surface opening
        # a quote it never closes — „Агенция „Пътна инфраструктура" — ships
        # unbalanced (49 live mentions, 27 distinct surfaces). An analyst
        # that closes it matched no truth entry, was accused of minting an
        # identity, and lost the WHOLE record at exit 3.
        self.write_gazetteer({"version": 1, "entries": [
            {"kind": "institution", "canonical": "Агенция Пътна инфраструктура",
             "forms": [{"surface": "Агенция \u201eПътна инфраструктура",
                        "resolvable": True, "id": "api-1", "why": ""}]}]})
        self.set_body("a1", "Агенция \u201eПътна инфраструктура\u201c обяви. " * 12)
        self.save_with([{"kind": "institution",
                         "surface": "Агенция \u201eПътна инфраструктура\u201c",
                         "basis": "gazetteer_exact", "id": "api-1",
                         "role": "subject"}])
        self.assertEqual(self.saved()["mentions"][0]["id"], "api-1")

    def test_an_OMITTED_field_is_filled_from_the_dictionary(self):
        # ⚠️ These fields are OURS — an analyst is not asked to produce
        # `form_kind`, and refusing a record for omitting one makes every new
        # field a breaking change for every analyst. Only a value it SET
        # differently is a claim we refuse.
        self.write_gazetteer({"version": 1, "entries": [
            {"kind": "person", "canonical": "Делян Пеевски", "forms": [
                {"surface": "Делян Пеевски", "resolvable": True,
                 "id": "dp-1", "form_kind": "full_name", "why": ""}]}]})
        self.set_body("a1", "Делян Пеевски заяви днес нещо много важно. " * 12)
        self.save_with([{"kind": "person", "surface": "Делян Пеевски",
                         "basis": "gazetteer_exact", "id": "dp-1",
                         "role": "subject"}])
        self.assertEqual(self.saved()["mentions"][0]["form_kind"], "full_name")

    def test_an_analyst_may_not_PROMOTE_a_two_part_match(self):
        # ⚠️⚠️ 464 of 468 person links rest on a two-part name. Relabelling
        # one `full_name` launders the weakest evidence this tier admits into
        # the strongest, on a page that carries a named individual.
        self.write_gazetteer({"version": 1, "entries": [
            {"kind": "person", "canonical": "Делян Славчев Пеевски", "forms": [
                {"surface": "Делян Пеевски", "resolvable": True, "id": "dp-1",
                 "form_kind": "two_part", "why": ""}]}]})
        self.set_body("a1", "Делян Пеевски заяви днес нещо много важно. " * 12)
        out = self.save_with([{"kind": "person", "surface": "Делян Пеевски",
                               "basis": "gazetteer_exact", "id": "dp-1",
                               "form_kind": "full_name", "role": "subject"}],
                             expect=3)
        msgs = [e for r in out["failed"] for e in r["errors"]]
        self.assertTrue(any(".form_kind" in e for e in msgs), msgs)

    def test_without_a_gazetteer_the_skip_is_REPORTED(self):
        # ⚠️ A save that quietly accepted every id looks identical to one
        # that verified them. The flag is the only difference.
        self.set_body("a1", "Делян Пеевски заяви днес нещо важно. " * 12)
        out = self.save_with([self.mention()])
        self.assertIn("mentions_unverified", out)
        self.assertIn("build_gazetteer", out["mentions_unverified"])

    def test_with_a_gazetteer_no_such_flag_appears(self):
        self.write_gazetteer()
        self.set_body("a1", "Делян Пеевски заяви днес нещо важно. " * 12)
        out = self.save_with([self.mention(surface="Делян Пеевски",
                                           id="delyan-peevski-ab12cd")])
        self.assertNotIn("mentions_unverified", out)

    def test_the_queue_carries_the_dictionary_pass(self):
        # ⚠️ Deleting `attach_dictionary_mentions(queue)` outright left every
        # test green — the analyst would simply receive no mentions and be
        # asked to invent them, which is the whole thing this tier prevents.
        self.write_gazetteer()
        self.set_body("a1", "Делян Пеевски заяви днес нещо много важно. " * 12)
        code, out, _ = self.run_cli("--next", "all", "--limit", "20")
        self.assertEqual(code, 0)
        item = next((q for q in out["queue"]
                     if "Делян Пеевски" in (q.get("title") or "")), None)
        self.assertIsNotNone(item, out["queue"])
        self.assertIn("mentions", item)
        self.assertEqual(item["mentions"][0]["id"], "delyan-peevski-ab12cd")
        self.assertIn("You may NOT change", item["mentions_note"])

    def test_without_a_gazetteer_the_queue_SAYS_it_did_not_run(self):
        # ⚠️ An absent key plus no note reads as „this article mentions
        # nobody" — the absent-vs-empty rule, one layer out.
        code, out, _ = self.run_cli("--next", "all", "--limit", "3")
        self.assertEqual(code, 0)
        self.assertNotIn("mentions", out["queue"][0])
        self.assertIn("NOT", out["queue"][0]["mentions_note"])

    def test_an_analyst_may_not_set_its_OWN_review_flag(self):
        # ⚠️⚠️ A model that could set this would set it to nothing — not from
        # malice, but because a model asked „do you need checking?" answers
        # the way it answers everything else. The rule is a pure function of
        # (label, confidence) computed at save time.
        out = self.save(
            analysis(self.analysis_path("a1"), "https://test.bg/alpha",
                     "test.bg", extra={"review": {}}), expect=3)
        msgs = [e for r in out["failed"] for e in r["errors"]]
        self.assertTrue(any("computed at save time" in e for e in msgs), msgs)

    def test_the_review_flag_is_STAMPED_when_it_is_earned(self):
        # A hedged position: the model taking a real stance and saying it is
        # unsure. On the corpus this is 4% of records.
        self.save(analysis(self.analysis_path("a1"), "https://test.bg/alpha",
                           "test.bg",
                           extra={"russia_stance": {"label": "pro_russia",
                                                    "confidence": 0.6,
                                                    "evidence": "e"}}))
        got = self.saved()
        self.assertIn("review", got)
        self.assertIn("russia_stance", got["review"])

    def test_a_confident_not_applicable_carries_NO_review_flag(self):
        # ⚠️ The calibration: the model is MOST confident where it asserts
        # nothing (median 0.90 on russia_stance), so a bare threshold would
        # queue everything real and nothing safe.
        self.save(analysis(self.analysis_path("a1"), "https://test.bg/alpha",
                           "test.bg",
                           extra={"russia_stance": {"label": "not_applicable",
                                                    "confidence": 0.9,
                                                    "evidence": "e"},
                                  "leaning": {"label": "not_applicable",
                                              "confidence": 0.8,
                                              "evidence": "e"}}))
        self.assertNotIn("review", self.saved())

    def test_entities_still_takes_only_strings(self):
        # ⚠️ The merge these two blocks exist to prevent. `entities` feeds
        # story clustering, which calls .lower() on each value — an object
        # there raises AttributeError and every story stops being built.
        out = self.save(
            analysis(self.analysis_path("a1"), "https://test.bg/alpha", "test.bg",
                     extra={"entities": {"people": [{"surface": "Пеевски"}],
                                         "parties": [], "institutions": [],
                                         "companies": [], "places": []}}),
            expect=3)
        self.assertTrue(any("entities.people" in e for r in out["failed"]
                            for e in r["errors"]), out)

    def test_mentions_is_not_accepted_as_a_sixth_entity_bucket(self):
        out = self.save(
            analysis(self.analysis_path("a1"), "https://test.bg/alpha", "test.bg",
                     extra={"entities": {"people": [], "parties": [],
                                         "institutions": [], "companies": [],
                                         "places": [], "mentions": []}}),
            expect=3)
        self.assertTrue(any("unknown bucket" in e for r in out["failed"]
                            for e in r["errors"]), out)



class RedoQueuesAlreadyAnalysedWork(FixtureTestCase):
    """⚠️ `--next` CAN NEVER RETURN THESE. It skips every URL in the index by
    construction, so the records the review queue flags — the only ones anyone
    ever wants to re-run — are exactly the ones it cannot offer. Without a
    second mode the only way to redo one is to delete its analysis, which
    leaves the record with NO vintage if the re-run then fails."""

    def analysed_url(self):
        domain, fname, rec = self.articles["a1"]
        a = analysis(self.analysis_path("a1"), rec["url"], domain)
        self.save(a)
        return rec["url"], f"news/data/{domain}/{fname}"

    def test_it_returns_an_article_next_would_skip(self):
        url, path = self.analysed_url()
        code, out, _err = self.run_cli("--next", "all", "--limit", "50")
        self.assertEqual(code, 0)
        self.assertNotIn(url, [q.get("url") for q in out["queue"]])
        self.assertNotIn(path, [q["path"] for q in out["queue"]])
        code, out, _err = self.run_cli("--redo", url)
        self.assertEqual(code, 0, out)
        self.assertEqual([q["path"] for q in out["queue"]], [path])

    def test_a_corpus_PATH_works_as_well_as_a_url(self):
        _url, path = self.analysed_url()
        code, out, _err = self.run_cli("--redo", path)
        self.assertEqual(code, 0, out)
        self.assertEqual([q["path"] for q in out["queue"]], [path])

    def test_an_unknown_target_is_NAMED_and_exits_non_zero(self):
        # ⚠️ A redo names its own targets, so returning fewer than it was
        # given is a failure — silently short, it reads as „those were fine".
        _url, path = self.analysed_url()
        code, out, _err = self.run_cli("--redo", path, "https://nope.example/x")
        self.assertEqual(code, 1, out)
        self.assertEqual(out["missing"], ["https://nope.example/x"])
        self.assertEqual(len(out["queue"]), 1)

    def test_it_WRITES_NOTHING(self):
        # The old analysis must survive until --save replaces it, so an
        # interrupted re-run leaves the record at its previous vintage.
        url, _path = self.analysed_url()
        before = self.index()
        self.run_cli("--redo", url)
        self.assertEqual(self.index(), before)

    def test_the_dictionary_pass_travels_with_it(self):
        # ⚠️ Compared against --next rather than asserted directly, so the two
        # modes cannot drift. The analyst is handed resolved mentions instead
        # of being asked to produce them, and check_mention_provenance()
        # refuses any change to them — a redo missing them fails that guard
        # on every record. (In this fixture there is no gazetteer, so what
        # travels is `mentions_note`; the point is that it is the SAME key.)
        domain, fname, rec = self.articles["a1"]
        code, nxt, _err = self.run_cli("--next", "all", "--limit", "50")
        self.assertEqual(code, 0)
        want = next(q for q in nxt["queue"]
                    if q["path"] == f"news/data/{domain}/{fname}")
        url, _path = self.analysed_url()
        code, out, _err = self.run_cli("--redo", url)
        self.assertEqual(code, 0, out)
        got = out["queue"][0]
        for key in ("mentions", "mentions_note"):
            self.assertEqual(key in got, key in want, key)
            if key in want:
                self.assertEqual(got[key], want[key], key)

if __name__ == "__main__":
    unittest.main(verbosity=2)
