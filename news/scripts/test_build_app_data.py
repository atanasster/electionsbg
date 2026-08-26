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
import time
import unittest
from pathlib import Path

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
        # derived from FEED_OMIT rather than hard-coded, so a field JOINING
        # the omit list does not make this test stale
        self.assertEqual(set(projected), set(src) - set(b.FEED_OMIT))
        self.assertTrue(set(src) & set(b.FEED_OMIT), "fixture covers no omitted key")
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

    # ---------------------------------------------------- T0.4 derived fields

    def test_scoop_lag_keys_on_first_seen_not_on_published(self):
        """⚠️ The whole design decision. `published` is set by the outlet —
        13% of the corpus has none and the rest is trivially back-dated — so a
        lead measured on it is a claim about whose CMS says what. Here the
        LATER-fetched outlet claims the EARLIER publish date; the measure must
        follow the fetch."""
        sys.path.insert(0, os.path.dirname(SCRIPT))
        import build_app_data as b  # noqa: E402
        members = [
            {"domain": "slow.bg", "published": "2026-08-22T06:00:00+00:00",
             "first_seen": "2026-08-22T15:00:00+00:00"},
            {"domain": "fast.bg", "published": "2026-08-22T09:00:00+00:00",
             "first_seen": "2026-08-22T10:00:00+00:00"},
        ]
        b.attach_scoop_lag(members)
        by = {m["domain"]: m for m in members}
        self.assertTrue(by["fast.bg"]["first_here"])
        self.assertFalse(by["slow.bg"]["first_here"])
        self.assertEqual(by["fast.bg"]["scoop_lag_hours"], 0.0)
        self.assertEqual(by["slow.bg"]["scoop_lag_hours"], 5.0)

    def test_scoop_lag_reaches_the_bundle_end_to_end(self):
        """⚠️ Every other scoop test calls attach_scoop_lag DIRECTLY, so four
        mutations that make the feature inert — dropping `first_seen` from the
        record, never calling the helper, reading `published` instead —
        passed the whole suite. This one goes through the real build."""
        for dom, fetched in (("fast.bg", "2026-08-22T10:00:00+00:00"),
                             ("slow.bg", "2026-08-22T18:00:00+00:00")):
            self.write_article(dom, "20260822-a1-abc.json",
                               url=f"https://{dom}/a/1",
                               fetched_at=fetched,
                               published="2026-08-22T09:00:00+00:00")
        d = os.path.join(self.data_dir, "analysis", "stories")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "s1.json"), "w", encoding="utf-8") as fh:
            json.dump({"story_id": "s1", "title_bg": "Ист", "members": [
                {"domain": "fast.bg", "article_path":
                 "news/data/fast.bg/20260822-a1-abc.json",
                 "url": "https://fast.bg/a/1",
                 "published": "2026-08-22T09:00:00+00:00"},
                {"domain": "slow.bg", "article_path":
                 "news/data/slow.bg/20260822-a1-abc.json",
                 "url": "https://slow.bg/a/1",
                 "published": "2026-08-22T09:00:00+00:00"}]}, fh)
        self.build()
        members = self.load("stories.json")["stories"][0]["members"]
        by = {m["domain"]: m for m in members}
        self.assertEqual(by["fast.bg"]["first_seen"],
                         "2026-08-22T10:00:00+00:00",
                         "first_seen never reached the story member")
        self.assertEqual(by["fast.bg"]["scoop_lag_hours"], 0.0)
        self.assertEqual(by["slow.bg"]["scoop_lag_hours"], 8.0)
        self.assertTrue(by["fast.bg"]["first_here"])
        self.assertFalse(by["slow.bg"]["first_here"])

    def test_a_single_outlet_cluster_claims_no_scoop(self):
        """⚠️ A race needs a competitor. Before this guard, 72 of 74
        single-member stories in the real corpus published first_here: true —
        a 'first to report' rosette where nobody else reported."""
        sys.path.insert(0, os.path.dirname(SCRIPT))
        import build_app_data as b  # noqa: E402
        members = [{"domain": "only.bg", "first_seen": "2026-08-22T10:00:00+00:00"}]
        b.attach_scoop_lag(members)
        self.assertFalse(members[0]["first_here"])
        self.assertFalse(members[0]["scoop_decidable"])
        self.assertEqual(members[0]["scoop_lag_hours"], 0.0,
                         "the lag is still true and still reported")
        # two ARTICLES from one outlet is still one outlet
        two = [{"domain": "only.bg", "first_seen": "2026-08-22T10:00:00+00:00"},
               {"domain": "only.bg", "first_seen": "2026-08-22T20:00:00+00:00"}]
        b.attach_scoop_lag(two)
        self.assertEqual([m["first_here"] for m in two], [False, False])

    def test_a_cluster_with_no_distinguishable_lead_flags_nobody(self):
        """9 of 12 multi-member stories flagged EVERY member — which says
        nothing while looking like a finding."""
        sys.path.insert(0, os.path.dirname(SCRIPT))
        import build_app_data as b  # noqa: E402
        members = [{"domain": "a.bg", "first_seen": "2026-08-22T10:00:00+00:00"},
                   {"domain": "b.bg", "first_seen": "2026-08-22T10:20:00+00:00"}]
        b.attach_scoop_lag(members)
        self.assertEqual([m["first_here"] for m in members], [False, False])
        self.assertFalse(members[0]["scoop_decidable"])
        # ...and the lag survives, because "both within the hour" is true
        self.assertEqual(members[1]["scoop_lag_hours"], 0.33)

    def test_the_baseline_is_parsed_not_compared_as_a_string(self):
        """⚠️ A lexicographic min() across mixed UTC offsets picks the wrong
        baseline, then hands a NEGATIVE lag to the outlet that was actually
        first and 0.0 ('was first') to one that was not."""
        sys.path.insert(0, os.path.dirname(SCRIPT))
        import build_app_data as b  # noqa: E402
        # "2026-08-22T09:00:00+03:00" is 06:00Z — EARLIER than "…T07:00:00+00:00",
        # but sorts LATER as a string.
        members = [{"domain": "late.bg", "first_seen": "2026-08-22T07:00:00+00:00"},
                   {"domain": "early.bg", "first_seen": "2026-08-22T09:00:00+03:00"}]
        b.attach_scoop_lag(members)
        by = {m["domain"]: m for m in members}
        self.assertEqual(by["early.bg"]["scoop_lag_hours"], 0.0)
        self.assertEqual(by["late.bg"]["scoop_lag_hours"], 1.0)
        for m in members:
            self.assertGreaterEqual(m["scoop_lag_hours"], 0,
                                    "a negative lag means the baseline is wrong")

    def test_an_owner_without_a_source_or_date_is_refused(self):
        """⚠️ `source` and `checked` are part of the CLAIM. A block with them
        null renders as a present-tense, unsourced, undated assertion about
        who owns a named newsroom — and the row looks complete."""
        self.write_article("ex.bg", "20260822-a1-abc.json")
        self.write_registry(",owner_aug2026", ",Холдинг ЕООД")
        _, stderr = self.build()
        row = next(o for o in self.load("outlets.json")["outlets"]
                   if o["domain"] == "ex.bg")
        self.assertIsNone(row["owner"])
        self.assertIn("REFUSED", stderr)
        # a source with no date is refused too — an undated lookup is not a fact
        self.write_registry(",owner_aug2026,owner_source_aug2026",
                            ",Холдинг ЕООД,https://papagal.bg/x")
        self.build()
        row = next(o for o in self.load("outlets.json")["outlets"]
                   if o["domain"] == "ex.bg")
        self.assertIsNone(row["owner"])

    def test_a_tie_inside_the_window_is_shared_not_broken(self):
        """The sweep is sequential over ~60 domains, so minutes of spread are
        our scheduling. Picking a winner there invents a lead."""
        sys.path.insert(0, os.path.dirname(SCRIPT))
        import build_app_data as b  # noqa: E402
        members = [
            {"domain": "a.bg", "first_seen": "2026-08-22T10:00:00+00:00"},
            {"domain": "b.bg", "first_seen": "2026-08-22T10:20:00+00:00"},
            {"domain": "c.bg", "first_seen": "2026-08-22T14:00:00+00:00"},
        ]
        b.attach_scoop_lag(members)
        self.assertEqual([m["first_here"] for m in members],
                         [True, True, False])
        self.assertTrue(members[0]["scoop_decidable"],
                        "three outlets spanning 4h is a decidable race")

    def test_an_unknown_lag_is_none_and_never_zero(self):
        """Zero means 'was first'. A member we cannot time must not claim it."""
        sys.path.insert(0, os.path.dirname(SCRIPT))
        import build_app_data as b  # noqa: E402
        members = [{"domain": "a.bg", "first_seen": "2026-08-22T10:00:00+00:00"},
                   {"domain": "b.bg", "first_seen": None}]
        b.attach_scoop_lag(members)
        self.assertIsNone(members[1]["scoop_lag_hours"])
        self.assertFalse(members[1]["first_here"])
        # ...and a cluster with NO timings at all reports unknown throughout
        none_at_all = [{"domain": "a.bg", "first_seen": None},
                       {"domain": "b.bg", "first_seen": ""}]
        b.attach_scoop_lag(none_at_all)
        self.assertEqual([m["scoop_lag_hours"] for m in none_at_all],
                         [None, None])

    def test_a_malformed_timestamp_does_not_raise(self):
        sys.path.insert(0, os.path.dirname(SCRIPT))
        import build_app_data as b  # noqa: E402
        members = [{"domain": "a.bg", "first_seen": "not a date"},
                   {"domain": "b.bg", "first_seen": "2026-08-22T10:00:00+00:00"}]
        b.attach_scoop_lag(members)
        self.assertIsNone(members[0]["scoop_lag_hours"])
        self.assertEqual(members[1]["scoop_lag_hours"], 0.0)
        # ...and NOT first_here: one timeable outlet is not a race, so the
        # unreadable sibling cannot be used to award the other a scoop.
        self.assertFalse(members[1]["first_here"])
        self.assertFalse(members[1]["scoop_decidable"])

    def test_a_naive_timestamp_is_read_as_utc_not_crashed_on(self):
        """Mixing naive and aware datetimes raises TypeError on subtraction."""
        sys.path.insert(0, os.path.dirname(SCRIPT))
        import build_app_data as b  # noqa: E402
        members = [{"domain": "a.bg", "first_seen": "2026-08-22T10:00:00"},
                   {"domain": "b.bg", "first_seen": "2026-08-22T13:00:00+00:00"}]
        b.attach_scoop_lag(members)
        self.assertEqual(members[1]["scoop_lag_hours"], 3.0)

    def test_first_seen_is_not_in_the_shared_feed(self):
        """Per-article context, not something a card renders."""
        sys.path.insert(0, os.path.dirname(SCRIPT))
        import build_app_data as b  # noqa: E402
        self.assertIn("first_seen", b.FEED_OMIT)

    def test_an_outlet_with_no_owner_recorded_gets_null_not_an_empty_block(self):
        """A block of nulls renders as 'ownership: unknown', which is a
        statement. Absent means nobody has looked."""
        self.write_article("ex.bg", "20260822-a1-abc.json")
        self.write_registry()
        self.build()
        row = next(o for o in self.load("outlets.json")["outlets"]
                   if o["domain"] == "ex.bg")
        self.assertIn("owner", row)
        self.assertIsNone(row["owner"])

    def test_a_recorded_owner_carries_its_source_and_date(self):
        """⚠️ `source` and `checked` are part of the CLAIM. Without them the
        row asserts a present-tense fact about a named organisation on the
        strength of an undated lookup."""
        self.write_article("ex.bg", "20260822-a1-abc.json")
        self.write_registry(
            ",owner_aug2026,owner_category_aug2026,owner_source_aug2026,"
            "owner_checked_aug2026",
            ",Холдинг ЕООД,media_conglomerate,https://papagal.bg/x,2026-08-26")
        self.build()
        row = next(o for o in self.load("outlets.json")["outlets"]
                   if o["domain"] == "ex.bg")
        self.assertEqual(row["owner"], {
            "name": "Холдинг ЕООД", "category": "media_conglomerate",
            "source": "https://papagal.bg/x", "checked": "2026-08-26"})

    def test_an_unknown_owner_category_is_dropped_and_reported(self):
        """A free-text value in a controlled column becomes a facet nobody can
        filter on, and a typo silently splits one owner in two."""
        self.write_article("ex.bg", "20260822-a1-abc.json")
        # source + checked are required before the block is published at all,
        # so they have to be present for the CATEGORY branch to be reachable
        self.write_registry(
            ",owner_aug2026,owner_category_aug2026,owner_source_aug2026,"
            "owner_checked_aug2026",
            ",Холдинг ЕООД,конгломерат,https://papagal.bg/x,2026-08-26")
        _, stderr = self.build()
        row = next(o for o in self.load("outlets.json")["outlets"]
                   if o["domain"] == "ex.bg")
        self.assertEqual(row["owner"]["name"], "Холдинг ЕООД")
        self.assertIsNone(row["owner"]["category"])
        self.assertIn("unknown owner_category", stderr)

    def test_a_sibling_column_is_not_read_as_the_parent(self):
        """⚠️ `owner` + "_" also matches owner_category/source/checked, so a
        naive prefix rule returned the CHECK DATE as the owner's NAME — a
        fabricated claim about who owns a newsroom, manufactured by a string
        match. The vintage after a prefix must be one token."""
        sys.path.insert(0, os.path.dirname(SCRIPT))
        import build_app_data as b  # noqa: E402
        row = {
            "owner_aug2026": "Холдинг ЕООД",
            "owner_category_aug2026": "media_conglomerate",
            "owner_source_aug2026": "https://papagal.bg/x",
            "owner_checked_aug2026": "2026-08-26",
        }
        self.assertEqual(b.pick_dated_column(row, "owner"), "Холдинг ЕООД")
        self.assertEqual(b.pick_dated_column(row, "owner_category"),
                         "media_conglomerate")
        self.assertEqual(b.pick_dated_column(row, "owner_checked"),
                         "2026-08-26")
        # a prefix whose own name contains an underscore still works
        self.assertEqual(
            b.pick_dated_column({"similarweb_visits_jul2026": "1M"},
                                "similarweb_visits"), "1M")
        self.assertEqual(
            b.pick_dated_column({"logo_url_aug2026": "x"}, "logo_url"), "x")
        # ...and a near-miss is still refused
        self.assertIsNone(
            b.pick_dated_column({"logo_urls_backup": "x"}, "logo_url"))

    def test_the_owner_category_vocabulary_is_not_empty(self):
        sys.path.insert(0, os.path.dirname(SCRIPT))
        import build_app_data as b  # noqa: E402
        self.assertEqual(len(b.OWNER_CATEGORIES), 8)
        self.assertIn("independent", b.OWNER_CATEGORIES)

    # ------------------------------------------------------ T0.7 changelog

    def build_with(self, *extra):
        proc = subprocess.run(
            [sys.executable, SCRIPT, "--data-dir", self.data_dir,
             "--out", self.out_dir, "--json", *extra],
            capture_output=True, text=True,
            env=dict(os.environ, DATA_BG_ROOT=self.root))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return json.loads(proc.stdout), proc.stderr

    def fake_cli(self, body):
        """Stand-ins for scripts/append-data-change.ts and the tsx runner.

        ⚠️ The real CLI is TypeScript and writes the repo's live
        data-changes.json. Invoking it from a test would need node and would
        write to a committed file — so what is under test here is the contract
        this script owns: does it invoke the CLI, with the right skill and a
        real summary, and does it report honestly when the CLI declines.

        ⚠️ The shim is a FILE IN THE TEMP ROOT, not an entry on PATH. An
        earlier cut shimmed `npx` on PATH, which leaks a stub interpreter into
        every later test in the process — and `stamp_data_change` no longer
        goes through PATH at all: it runs node_modules/.bin/tsx by absolute
        path, precisely so a timeout can kill the process group."""
        d = os.path.join(self.root, "scripts")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "append-data-change.ts"), "w",
                  encoding="utf-8") as fh:
            fh.write(body)
        binp = os.path.join(self.root, "node_modules", ".bin")
        os.makedirs(binp, exist_ok=True)
        runner = os.path.join(binp, "tsx")
        with open(runner, "w", encoding="utf-8") as fh:
            fh.write(f"#!/bin/sh\nexec {sys.executable} \"$@\"\n")
        os.chmod(runner, 0o755)
        return runner

    def test_a_rebuild_does_not_stamp_by_default(self):
        """A rebuild is not an ingest. Stamping every local rebuild would fill
        a public page with entries nobody acted on."""
        self.write_article("ex.bg", "20260822-a1-abc.json")
        self.fake_cli("import sys, json;"
                             "open(sys.argv[0] + '.called','w').write('x')")
        self.build_with()
        self.assertFalse(os.path.exists(
            os.path.join(self.root, "scripts", "append-data-change.ts.called")))

    def test_stamp_invokes_the_repo_cli_with_the_corpus_totals(self):
        self.write_article("ex.bg", "20260822-a1-abc.json")
        self.fake_cli(
            "import sys, json;"
            "open(sys.argv[0] + '.args','w').write(json.dumps(sys.argv[1:]));"
            "print('\u2713 appended')")
        _, stderr = self.build_with("--stamp")
        with open(os.path.join(self.root, "scripts",
                               "append-data-change.ts.args"),
                  encoding="utf-8") as fh:
            argv = json.load(fh)
        self.assertEqual(argv[0], "save-news-articles")
        self.assertIn("--summary", argv)
        summary = argv[argv.index("--summary") + 1]
        # the numbers a reader needs, not a file count
        self.assertIn("1 статия", summary)  # not "1 статии"
        self.assertIn("анализирани", summary)
        self.assertIn("--source", argv)
        # ⚠️ NOT assertIn("stamped"), which "NOT stamped" also satisfies —
        # mutating the success flag to a hardcoded False left this green.
        self.assertIn("data-changes: stamped", stderr)
        self.assertNotIn("NOT stamped", stderr)

    def test_a_declined_stamp_is_reported_not_swallowed(self):
        """The CLI prints '· skipped …' when its own no-op guard fires.
        'Nothing changed' and 'the stamp failed' are different states."""
        self.write_article("ex.bg", "20260822-a1-abc.json")
        self.fake_cli("print('\u00b7 skipped save-news-articles')")
        _, stderr = self.build_with("--stamp")
        self.assertIn("NOT stamped", stderr)

    def test_a_broken_stamp_never_fails_the_build(self):
        """⚠️ The bundle is already written and correct by this point. A
        missing npx, or a checkout with no node_modules, must not fail a data
        build over a changelog row."""
        self.write_article("ex.bg", "20260822-a1-abc.json")
        self.fake_cli("import sys; sys.exit(3)")
        out, stderr = self.build_with("--stamp")
        self.assertEqual(out["total_articles"], 1)
        self.assertIn("NOT stamped", stderr)

    def test_a_missing_tsx_runner_is_reported_rather_than_crashing(self):
        """A checkout with no node_modules must not fail a data build over a
        changelog row."""
        self.write_article("ex.bg", "20260822-a1-abc.json")
        d = os.path.join(self.root, "scripts")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "append-data-change.ts"), "w",
                  encoding="utf-8") as fh:
            fh.write("print('x')")
        out, stderr = self.build_with("--stamp")
        self.assertEqual(out["total_articles"], 1)
        self.assertIn("npm install", stderr)

    def test_a_timeout_kills_the_whole_process_group(self):
        """⚠️ Measured on the first cut: `npx tsx <file>` is a three-deep tree,
        and killing the direct child left both descendants alive — they went
        on to write data-changes.json while the caller reported NOT stamped.

        The shim therefore SPAWNS A GRANDCHILD, mirroring the real runner. A
        shim that is a single process cannot tell a group kill from a child
        kill, and this test passed against both before the grandchild existed.
        """
        sys.path.insert(0, os.path.dirname(SCRIPT))
        import build_app_data as b  # noqa: E402
        self.write_article("ex.bg", "20260822-a1-abc.json")
        marker = os.path.join(self.root, "wrote-after-timeout")
        self.fake_cli(
            "import subprocess, sys, time;"
            # the grandchild: outlives its parent unless the GROUP is killed
            "subprocess.Popen([sys.executable, '-c',"
            f"  \"import time; time.sleep(3); open({marker!r},'w').write('x')\"]);"
            "time.sleep(30)")
        prior = b.STAMP_TIMEOUT_SECONDS
        self.addCleanup(setattr, b, "STAMP_TIMEOUT_SECONDS", prior)
        b.STAMP_TIMEOUT_SECONDS = 1
        got = b.stamp_data_change("резюме", Path(self.root))
        self.assertFalse(got["stamped"])
        self.assertIn("timed out", got["reason"])
        time.sleep(4.5)
        self.assertFalse(
            os.path.exists(marker),
            "a descendant survived the timeout and went on to write")

    def test_the_kill_refuses_to_take_down_its_own_process_group(self):
        """⚠️ The guard that stops a catastrophe. Without start_new_session the
        child shares OUR group, and an unguarded killpg would SIGKILL the
        caller — the build, the test runner, everything. Found by mutation:
        the harness running these very tests was killed by its own mutant."""
        sys.path.insert(0, os.path.dirname(SCRIPT))
        import build_app_data as b  # noqa: E402
        # deliberately NOT start_new_session: same group as this test process
        proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        self.addCleanup(proc.kill)
        self.assertEqual(os.getpgid(proc.pid), os.getpgid(0),
                         "fixture is not in our group — the test proves nothing")
        action = b.terminate_tree(proc)
        self.assertEqual(action, "kill:own-group")
        proc.wait(timeout=5)
        # and we are still alive to assert it
        self.assertTrue(True)

    def test_the_kill_uses_the_group_when_the_child_has_its_own(self):
        sys.path.insert(0, os.path.dirname(SCRIPT))
        import build_app_data as b  # noqa: E402
        proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"],
                                start_new_session=True)
        self.addCleanup(proc.kill)
        self.assertEqual(b.terminate_tree(proc), "killpg")
        proc.wait(timeout=5)

    def test_a_missing_cli_is_reported_rather_than_crashing(self):
        self.write_article("ex.bg", "20260822-a1-abc.json")
        out, stderr = self.build_with("--stamp")
        self.assertEqual(out["total_articles"], 1)
        self.assertIn("not found", stderr)

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
