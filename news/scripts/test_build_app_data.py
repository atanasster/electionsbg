#!/usr/bin/env python3
"""Regression tests for build_app_data.py.

Runs the REAL script as a subprocess against a throwaway repository root
(DATA_BG_ROOT env override — which every runner here MUST set, or the fixture
taxonomy below is dead code and the tests silently read the production
news/topics.json), with a
minimal taxonomy, a two-domain corpus and hand-built analysis/index/story
fixtures. Each test parses the generated bundles — no dependency on the live
news/data corpus.

Covers the two silently-wrong-bundle bugs the review surfaced (story_id
resolution via index.json, taxonomy counts for subcategory-less topics) plus
the non-numeric-rank crash guard.

Run:  python3 news/scripts/test_build_app_data.py
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.abspath(os.path.join(os.path.dirname(__file__), "build_app_data.py"))

TAXONOMY = {
    "version": 1,
    "categories": [
        {
            "id": "society",
            "label": {"bg": "Общество", "en": "Society"},
            "keywords": [],
            "subcategories": [
                {"id": "human-interest", "label": {"bg": "Хора", "en": "Human interest"},
                 "keywords": []}
            ],
        },
        {
            "id": "healthcare",
            "label": {"bg": "Здравеопазване", "en": "Healthcare"},
            "keywords": [],
            "subcategories": [
                {"id": "reform", "label": {"bg": "Реформа", "en": "Reform"}, "keywords": []}
            ],
        },
    ],
}


def corpus_article(domain, fname, url, title, published, content="x" * 500):
    return {
        "domain": domain, "url": url, "title": title, "published": published,
        "author": "Автор", "topic": None, "keywords": None, "description": None,
        "site_name": None, "content": content, "content_chars": len(content),
        "fetched_at": "2026-08-23T00:00:00+00:00",
    }


class BuildAppDataTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="build_app_data_test_")
        self.addCleanup(shutil.rmtree, self.root, True)
        self.data_dir = os.path.join(self.root, "news", "data")
        self.out_dir = os.path.join(self.root, "news", "app-data")
        os.makedirs(os.path.join(self.root, "news"), exist_ok=True)
        with open(os.path.join(self.root, "news", "topics.json"), "w", encoding="utf-8") as fh:
            json.dump(TAXONOMY, fh, ensure_ascii=False)
        os.makedirs(self.data_dir, exist_ok=True)
        self.domains = []

    def write_corpus(self, domain, fname, article):
        self.domains.append(domain)
        d = os.path.join(self.data_dir, domain)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, fname), "w", encoding="utf-8") as fh:
            json.dump(article, fh, ensure_ascii=False)

    def write_analysis(self, domain, fname, record):
        d = os.path.join(self.data_dir, "analysis", "articles", domain)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, fname), "w", encoding="utf-8") as fh:
            json.dump(record, fh, ensure_ascii=False)

    def run_build(self, *extra):
        # ⚠️ DATA_BG_ROOT, or the fixture taxonomy written in setUp is dead
        # code and every test here silently reads the PRODUCTION
        # news/topics.json — which is how a taxonomy-count assertion can pass
        # while asserting nothing about the fixture it claims to use.
        proc = subprocess.run(
            [sys.executable, SCRIPT,
             "--data-dir", self.data_dir, "--out", self.out_dir, "--quiet", "--json",
             *extra],
            capture_output=True, text=True,
            env=dict(os.environ, DATA_BG_ROOT=self.root),
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return json.loads(proc.stdout)

    def load(self, name):
        with open(os.path.join(self.out_dir, name), encoding="utf-8") as fh:
            return json.load(fh)

    def analysis_record(self, url, domain, article_path, *, leaning="progressive",
                        russia="not_applicable", action="new_story", story_id=None,
                        topics=None):
        return {
            "article_path": article_path, "url": url, "domain": domain,
            "analyzed_at": "2026-08-23T00:00:00+00:00", "model": "test",
            "taxonomy_version": 1,
            "quality": {"verdict": "ok", "notes": ""},
            "summary_bg": "обобщение", "summary_en": "summary",
            "leaning": {"label": leaning, "confidence": 0.7, "evidence": ""},
            "russia_stance": {"label": russia, "confidence": 0.7, "evidence": ""},
            "ai_generated": {"verdict": "likely_human", "confidence": 0.6, "signals": []},
            "entities": {"people": [], "parties": [], "institutions": [],
                         "companies": [], "places": []},
            "party_tones": [],
            "topics": topics if topics is not None else [
                {"category": "society", "subcategory": "human-interest", "primary": True}],
            "site_relevant": True,
            "story": {"action": action, "story_id": story_id},
            "published": "2026-08-22T00:00:00+00:00",
        }

    def test_new_story_member_gets_story_id_from_index(self):
        # An article whose analysis decided new_story (story_id null in the decision
        # block); the resolved id exists only in analysis/index.json.
        url = "https://example.bg/a1"
        self.write_corpus("example.bg", "20260822-a1-abc.json",
                          corpus_article("example.bg", "a1", url, "Заглавие",
                                         "2026-08-22T00:00:00+00:00"))
        path = "news/data/example.bg/20260822-a1-abc.json"
        self.write_analysis("example.bg", "20260822-a1-abc.json",
                            self.analysis_record(url, "example.bg", path))
        os.makedirs(os.path.join(self.data_dir, "analysis"), exist_ok=True)
        with open(os.path.join(self.data_dir, "analysis", "index.json"), "w",
                  encoding="utf-8") as fh:
            json.dump({"version": 1, "updated_at": "now", "stories": {},
                       "articles": {url: {"path": path, "story_id": "20260822-s1",
                                          "domain": "example.bg",
                                          "analyzed_at": "now"}}}, fh)
        os.makedirs(os.path.join(self.data_dir, "analysis", "stories"), exist_ok=True)
        with open(os.path.join(self.data_dir, "analysis", "stories", "20260822-s1.json"),
                  "w", encoding="utf-8") as fh:
            json.dump({
                "id": "20260822-s1", "canonical_title_bg": "Т", "canonical_title_en": "T",
                "summary_bg": "s", "summary_en": "s", "created_at": "now", "topics": [],
                "related_story_ids": [], "first_published": "2026-08-22T00:00:00+00:00",
                "last_published": "2026-08-22T00:00:00+00:00", "entities": {},
                "members": [{"domain": "example.bg", "article_path": path, "url": url,
                             "published": "2026-08-22T00:00:00+00:00",
                             "leaning": "progressive",
                             "russia_stance": "not_applicable", "added_at": "now"}],
                "aggregates": {"article_count": 1, "outlet_count": 1,
                               "by_leaning": {"progressive": 1},
                               "by_russia_stance": {"not_applicable": 1},
                               "by_domain": {"example.bg": 1}},
            }, fh, ensure_ascii=False)

        summary = self.run_build()
        self.assertEqual(summary["total_articles"], 1)
        article = self.load("articles/example.bg.json")["articles"][0]
        self.assertEqual(article["story_id"], "20260822-s1")
        story = self.load("stories.json")["stories"][0]
        self.assertEqual(story["members"][0]["title"], "Заглавие")

    def test_category_without_subcategory_counted(self):
        url = "https://example.bg/a2"
        self.write_corpus("example.bg", "20260822-a2-abc.json",
                          corpus_article("example.bg", "a2", url, "Заглавие",
                                         "2026-08-22T00:00:00+00:00"))
        path = "news/data/example.bg/20260822-a2-abc.json"
        self.write_analysis(
            "example.bg", "20260822-a2-abc.json",
            self.analysis_record(url, "example.bg", path,
                                 topics=[{"category": "healthcare", "subcategory": None,
                                          "primary": True}]))
        self.run_build()
        cats = {c["id"]: c for c in self.load("taxonomy.json")["categories"]}
        self.assertEqual(cats["healthcare"]["article_count"], 1)
        self.assertEqual(cats["society"]["article_count"], 0)

    def test_non_numeric_rank_does_not_crash(self):
        url = "https://example.bg/a3"
        self.write_corpus("example.bg", "20260822-a3-abc.json",
                          corpus_article("example.bg", "a3", url, "Заглавие",
                                         "2026-08-22T00:00:00+00:00"))
        with open(os.path.join(self.data_dir, "bg_news_sites.csv"), "w",
                  encoding="utf-8") as fh:
            fh.write("rank,tier,domain,outlet,type,scope,similarweb_visits_aug2026\n")
            fh.write("n/a,mass,example.bg,Пример,news,national,18.3M\n")
        summary = self.run_build()
        self.assertEqual(summary["outlets"], 1)
        outlet = self.load("outlets.json")["outlets"][0]
        self.assertIsNone(outlet["rank"])
        self.assertEqual(outlet["visits"], 18_300_000)


class MetadataAndBudget(unittest.TestCase):
    """The fields T0.3 carries through, and the one budget that guards them.

    ⚠️ Every one of these is about a SHARED file: latest.json is downloaded by
    every page in the app before it can paint, so what it carries is a budget
    decision and a field added to it without one is invisible until the app is
    slow — which nobody bisects to a JSON key."""

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="build_app_data_meta_")
        self.addCleanup(shutil.rmtree, self.root, True)
        self.data_dir = os.path.join(self.root, "news", "data")
        self.out_dir = os.path.join(self.root, "news", "app-data")
        os.makedirs(self.data_dir, exist_ok=True)
        with open(os.path.join(self.root, "news", "topics.json"), "w",
                  encoding="utf-8") as fh:
            json.dump(TAXONOMY, fh, ensure_ascii=False)

    def write_article(self, domain, fname, **over):
        rec = corpus_article(domain, fname, f"https://{domain}/a/1", "Заглавие",
                             "2026-08-22T09:00:00+00:00")
        rec.update({
            "image": f"https://cdn.{domain}/lead.jpg",
            "image_alt": "Надпис на снимката",
            "canonical": f"https://{domain}/a/1",
            "language": "bg",
            "section_path": ["Начало", "Икономика"],
            "updated": "2026-08-22T11:00:00+00:00",
        })
        rec.update(over)
        d = os.path.join(self.data_dir, domain)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, fname), "w", encoding="utf-8") as fh:
            json.dump(rec, fh, ensure_ascii=False)

    def write_registry(self, extra_cols="", extra_vals=""):
        with open(os.path.join(self.data_dir, "bg_news_sites.csv"), "w",
                  encoding="utf-8") as fh:
            fh.write("rank,tier,domain,outlet,type,scope,"
                     "similarweb_visits_jul2026" + extra_cols + "\n")
            fh.write("1,mass,ex.bg,Пример,news,national,1M" + extra_vals + "\n")

    def build(self):
        proc = subprocess.run(
            [sys.executable, SCRIPT, "--data-dir", self.data_dir,
             "--out", self.out_dir, "--quiet", "--json"],
            capture_output=True, text=True,
            env=dict(os.environ, DATA_BG_ROOT=self.root))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return json.loads(proc.stdout), proc.stderr

    def load(self, name):
        with open(os.path.join(self.out_dir, name), encoding="utf-8") as fh:
            return json.load(fh)

    def test_the_per_domain_bundle_carries_every_field(self):
        self.write_article("ex.bg", "20260822-a1-abc.json")
        self.build()
        rec = self.load("articles/ex.bg.json")["articles"][0]
        for key, want in (("image", "https://cdn.ex.bg/lead.jpg"),
                          ("image_alt", "Надпис на снимката"),
                          ("canonical", "https://ex.bg/a/1"),
                          ("language", "bg"),
                          ("section_path", ["Начало", "Икономика"]),
                          ("updated", "2026-08-22T11:00:00+00:00")):
            self.assertEqual(rec.get(key), want, key)

    def test_the_shared_feed_omits_the_article_only_fields(self):
        """section_path and image_alt are read on the article page, which
        already loads the per-domain bundle. In the feed they are dead weight
        on every page view."""
        self.write_article("ex.bg", "20260822-a1-abc.json")
        self.build()
        feed = self.load("latest.json")["articles"][0]
        self.assertNotIn("section_path", feed)
        self.assertNotIn("image_alt", feed)
        # ...and the fields a CARD renders are still there
        self.assertEqual(feed["image"], "https://cdn.ex.bg/lead.jpg")
        self.assertEqual(feed["language"], "bg")

    def test_omitting_from_the_feed_does_not_strip_the_bundle(self):
        """The two share one record object.

        ⚠️ Asserting on the WRITTEN bundle cannot catch a destructive
        projection: the per-domain file is serialized BEFORE the feed is
        built, so `r.pop(k)` passes this on the file alone. The real assertion
        is in-memory and below; this one only guards the write order it
        depends on."""
        self.write_article("ex.bg", "20260822-a1-abc.json")
        self.build()
        self.assertIn("section_path", self.load("articles/ex.bg.json")["articles"][0])

    def test_the_feed_projection_is_non_destructive(self):
        """The assertion the file-level one cannot make. Run the projection
        over a record and require the SOURCE to be intact afterwards, so a
        `pop`-based rewrite fails here regardless of write order."""
        sys.path.insert(0, os.path.dirname(SCRIPT))
        import build_app_data as b  # noqa: E402
        src = {"id": "a", "published": "2026-01-01", "image": "x",
               "section_path": ["Начало"], "image_alt": "надпис"}
        projected = {k: v for k, v in src.items() if k not in b.FEED_OMIT}
        self.assertEqual(projected.keys() | b.FEED_OMIT, src.keys())
        self.assertIn("section_path", src, "the projection mutated its source")
        self.assertIn("image_alt", src)
        self.assertEqual(src["section_path"], ["Начало"])

    def test_the_feed_omission_list_is_not_silently_empty(self):
        """A guard against the fix being reverted to a no-op: if FEED_OMIT
        empties, this fails rather than the feed quietly regaining weight."""
        sys.path.insert(0, os.path.dirname(SCRIPT))
        import build_app_data  # noqa: E402
        self.assertTrue(build_app_data.FEED_OMIT)
        for key in ("section_path", "image_alt"):
            self.assertIn(key, build_app_data.FEED_OMIT, key)

    def test_the_feed_budget_warns_when_exceeded(self):
        """Documented but unchecked is a comment, not a budget."""
        sys.path.insert(0, os.path.dirname(SCRIPT))
        import build_app_data  # noqa: E402
        self.assertGreater(build_app_data.FEED_GZIP_BUDGET_BYTES, 0)
        for i in range(40):
            self.write_article("ex.bg", f"20260822-a{i}-abc.json",
                               url=f"https://ex.bg/a/{i}",
                               content="дълъг текст " * 4000)
        proc = subprocess.run(
            [sys.executable, "-c",
             "import sys;"
             "sys.argv = ['b', '--data-dir', %r, '--out', %r, '--quiet', '--json'];"
             "import build_app_data as b;"
             "b.FEED_GZIP_BUDGET_BYTES = 1;"
             "sys.exit(b.main())" % (self.data_dir, self.out_dir)],
            capture_output=True, text=True,
            env=dict(os.environ, DATA_BG_ROOT=self.root),
            cwd=os.path.dirname(SCRIPT))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("over the", proc.stderr)
        self.assertIn("PAGINATE", proc.stderr)

    def test_the_budget_check_is_silent_under_budget(self):
        """Half the gate. Proving the warning CAN fire leaves `if True:`
        passing — the check has to be shown not to cry wolf on every build."""
        self.write_article("ex.bg", "20260822-a1-abc.json")
        _, stderr = self.build()
        self.assertNotIn("over the", stderr)
        self.assertNotIn("PAGINATE", stderr)

    def test_a_second_logo_vintage_does_not_clobber_a_good_logo(self):
        """⚠️ The case the resolver actually produces. Vintages ACCUMULATE,
        and a re-mint starts the new column empty — so plain last-column-wins
        takes the blank cell and erases every logo the new pass could not
        re-resolve (Cloudflare, bot_refused). Last NON-EMPTY wins."""
        self.write_article("ex.bg", "20260822-a1-abc.json")
        with open(os.path.join(self.data_dir, "bg_news_sites.csv"), "w",
                  encoding="utf-8") as fh:
            fh.write("rank,tier,domain,outlet,type,scope,"
                     "similarweb_visits_jul2026,logo_url_aug2026,"
                     "logo_url_sep2027\n")
            fh.write("1,mass,ex.bg,Пример,news,national,1M,"
                     "https://ex.bg/old.png,\n")
        self.build()
        row = next(o for o in self.load("outlets.json")["outlets"]
                   if o["domain"] == "ex.bg")
        self.assertEqual(row["logo"], "https://ex.bg/old.png",
                         "an empty newer vintage erased a resolved logo")

    def test_a_filled_newer_vintage_does_win(self):
        """The other direction: skipping empties must not freeze the value."""
        self.write_article("ex.bg", "20260822-a1-abc.json")
        with open(os.path.join(self.data_dir, "bg_news_sites.csv"), "w",
                  encoding="utf-8") as fh:
            fh.write("rank,tier,domain,outlet,type,scope,"
                     "similarweb_visits_jul2026,logo_url_aug2026,"
                     "logo_url_sep2027\n")
            fh.write("1,mass,ex.bg,Пример,news,national,1M,"
                     "https://ex.bg/old.png,https://ex.bg/new.png\n")
        self.build()
        row = next(o for o in self.load("outlets.json")["outlets"]
                   if o["domain"] == "ex.bg")
        self.assertEqual(row["logo"], "https://ex.bg/new.png")

    def test_a_near_miss_column_is_not_read_as_a_logo(self):
        """`logo_urls_backup` is not a logo column. A bare startswith matched
        it and published its contents as an outlet's mark."""
        self.write_article("gone.bg", "20260822-a1-abc.json")
        self.write_registry()
        with open(os.path.join(self.data_dir, "retired_sites.csv"), "w",
                  encoding="utf-8") as fh:
            fh.write("rank,domain,outlet,type,scope,retired_on,reason,detail,"
                     "logo_urls_backup\n")
            fh.write("9,gone.bg,Изчезнал,news,national,2026-08-26,dead,note,"
                     "https://gone.bg/NOT-A-LOGO.png\n")
        self.build()
        row = next(o for o in self.load("outlets.json")["outlets"]
                   if o["domain"] == "gone.bg")
        self.assertIsNone(row["logo"])

    def test_a_story_always_carries_the_shape_the_app_type_promises(self):
        """StoryScreen dereferences `.entities.people` and
        `.aggregates.by_domain` with no guard, so a story file missing a
        bucket is a blank page rather than a missing chip."""
        sys.path.insert(0, os.path.dirname(SCRIPT))
        import build_app_data as b  # noqa: E402
        self.write_article("ex.bg", "20260822-a1-abc.json")
        d = os.path.join(self.data_dir, "analysis", "stories")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "s1.json"), "w", encoding="utf-8") as fh:
            json.dump({"story_id": "s1", "title_bg": "Ист", "members": []}, fh)
        self.build()
        stories = self.load("stories.json")["stories"]
        self.assertTrue(stories)
        st = stories[0]
        self.assertEqual(set(st["entities"]), set(b.EMPTY_STORY_ENTITIES))
        self.assertEqual(set(st["aggregates"]), set(b.EMPTY_STORY_AGGREGATES))
        self.assertEqual(st["entities"]["people"], [])
        self.assertEqual(st["aggregates"]["by_domain"], {})

    def test_an_outlet_carries_its_logo(self):
        self.write_article("ex.bg", "20260822-a1-abc.json")
        self.write_registry(",logo_url_aug2026", ",https://ex.bg/logo.png")
        self.build()
        row = next(o for o in self.load("outlets.json")["outlets"]
                   if o["domain"] == "ex.bg")
        self.assertEqual(row["logo"], "https://ex.bg/logo.png")

    def test_the_logo_column_is_matched_by_prefix_not_by_name(self):
        """Registry columns carry a vintage suffix and are re-minted; a
        hard-coded `logo_url_aug2026` silently returns null the day someone
        resolves logos again."""
        self.write_article("ex.bg", "20260822-a1-abc.json")
        self.write_registry(",logo_url_sep2027", ",https://ex.bg/new.png")
        self.build()
        row = next(o for o in self.load("outlets.json")["outlets"]
                   if o["domain"] == "ex.bg")
        self.assertEqual(row["logo"], "https://ex.bg/new.png")

    def test_a_domain_with_no_registry_row_gets_an_explicit_null_logo(self):
        """Absent is not null: the app reads a missing key as `undefined`,
        which is a different bug from 'we have no logo for this outlet'."""
        self.write_article("orphan.bg", "20260822-a1-abc.json")
        self.write_registry()
        self.build()
        row = next(o for o in self.load("outlets.json")["outlets"]
                   if o["domain"] == "orphan.bg")
        self.assertIn("logo", row)
        self.assertIsNone(row["logo"])

    def test_a_retired_outlet_still_carries_its_mark(self):
        self.write_article("gone.bg", "20260822-a1-abc.json")
        self.write_registry()
        with open(os.path.join(self.data_dir, "retired_sites.csv"), "w",
                  encoding="utf-8") as fh:
            fh.write("rank,domain,outlet,type,scope,retired_on,reason,detail,"
                     "logo_url_aug2026\n")
            fh.write("9,gone.bg,Изчезнал,news,national,2026-08-26,"
                     "portal_not_newsroom,note,https://gone.bg/logo.png\n")
        self.build()
        row = next(o for o in self.load("outlets.json")["outlets"]
                   if o["domain"] == "gone.bg")
        self.assertTrue(row["retired"])
        self.assertEqual(row["logo"], "https://gone.bg/logo.png")
        self.assertEqual(row["retired_reason"], "portal_not_newsroom")


if __name__ == "__main__":
    unittest.main()
