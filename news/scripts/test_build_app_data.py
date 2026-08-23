#!/usr/bin/env python3
"""Regression tests for build_app_data.py.

Runs the REAL script as a subprocess against a throwaway repository root
(DATA_BG_ROOT env override, same contract as test_analyze_articles.py), with a
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
        proc = subprocess.run(
            [sys.executable, SCRIPT,
             "--data-dir", self.data_dir, "--out", self.out_dir, "--quiet", "--json",
             *extra],
            capture_output=True, text=True,
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


if __name__ == "__main__":
    unittest.main()
