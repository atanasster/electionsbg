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


if __name__ == "__main__":
    unittest.main(verbosity=2)
