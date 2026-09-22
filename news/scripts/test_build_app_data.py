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

import gzip
import inspect
import copy
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from news.eval_contract.canonical import (  # noqa: E402
    analysis_sha256, canonical_sha256, content_sha256)
import build_app_data  # noqa: E402
import build_app_data as bad  # noqa: E402
from datetime import datetime, timedelta, timezone  # noqa: E402
from build_app_data import (  # noqa: E402
    AXIS_POSITIONS, HOME_GZIP_BUDGET_BYTES, HOME_ITEM_LIMIT,
    HOME_STORY_FIELDS, HOME_STORY_LIMIT, TOPIC_MIN_POSITIONED, axis_spread,
    compact_analysis, home_gzip_size, load_image_rights_policy, select_home_payload,
    reconcile_effective_story, validate_display_image)
from effective_analysis import effective_analysis  # noqa: E402
from build_feedback_targets import build as build_feedback_targets  # noqa: E402

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


def ensure_fixture_story_membership(data_dir: str) -> None:
    """Give ordinary success fixtures the production index/story invariant.

    Failure-path tests call the raw subprocess helper instead, so mutations of
    a missing/omitted/crossed index row are never repaired by this convenience.
    """
    root = Path(data_dir)
    analysis_root = root / "analysis"
    article_root = analysis_root / "articles"
    if not article_root.is_dir():
        return
    index_path = analysis_root / "index.json"
    try:
        index = json.loads(index_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        index = {"version": 1, "updated_at": "now", "stories": {}, "articles": {}}
    articles = index.setdefault("articles", {})
    stories = index.setdefault("stories", {})
    stories_dir = analysis_root / "stories"
    stories_dir.mkdir(parents=True, exist_ok=True)
    for domain_dir in sorted(article_root.iterdir()):
        if not domain_dir.is_dir():
            continue
        for analysis_path in sorted(domain_dir.glob("*.json")):
            analysis = json.loads(analysis_path.read_text(encoding="utf-8"))
            url = analysis.get("url")
            if not isinstance(url, str) or url in articles:
                continue
            safe_domain = re.sub(r"[^a-z0-9]+", "-", domain_dir.name.lower()).strip("-")
            story_id = f"fixture-{safe_domain}-{analysis_path.stem}"
            article_path = analysis.get("article_path")
            articles[url] = {
                "path": article_path, "story_id": story_id,
                "domain": analysis.get("domain"), "analyzed_at": "now",
            }
            stories[story_id] = {"path": f"news/data/analysis/stories/{story_id}.json"}
            (stories_dir / f"{story_id}.json").write_text(json.dumps({
                "id": story_id,
                "canonical_title_bg": "Fixture story",
                "canonical_title_en": "Fixture story",
                "summary_bg": analysis.get("summary_bg"),
                "summary_en": analysis.get("summary_en"),
                "created_at": "now", "updated_at": "now",
                "topics": analysis.get("topics") or [],
                "related_story_ids": [],
                "members": [{
                    "domain": analysis.get("domain"),
                    "article_path": article_path, "url": url,
                    "published": analysis.get("published"),
                    "leaning": (analysis.get("leaning") or {}).get("label"),
                    "russia_stance": (
                        analysis.get("russia_stance") or {}).get("label"),
                    "added_at": "now",
                }],
                "entities": analysis.get("entities") or {},
                "aggregates": {},
            }, ensure_ascii=False), encoding="utf-8")
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")


def ensure_feedback_target_fixture(root: str, data_dir: str) -> None:
    """Install the minimum canonical-target sources required by app builds."""
    with open(os.path.join(data_dir, "gazetteer.json"), "w",
              encoding="utf-8") as fh:
        json.dump({
            "version": 1,
            "generated_at": "2026-09-01T00:00:00Z",
            "entries": [{
                "kind": "person", "id": "person-1",
                "canonical": "Иван Иванов",
                "forms": [{"surface": "Иван Иванов", "id": "person-1",
                           "resolvable": True}],
            }],
        }, fh, ensure_ascii=False)
    sector_dir = os.path.join(root, "src", "screens", "governance")
    locale_dir = os.path.join(root, "src", "locales", "bg")
    os.makedirs(sector_dir, exist_ok=True)
    os.makedirs(locale_dir, exist_ok=True)
    sector_rows = []
    sector_labels = {}
    for index in range(15):
        sector_rows.append(
            f'{{ id: "sector-{index}", titleKey: "sector_{index}", '
            f'descKey: "desc", agency: "A", to: "/sector/sector-{index}" }}')
        sector_labels[f"sector_{index}"] = f"Сектор {index}"
    Path(sector_dir, "sectorRegistry.ts").write_text(
        "export const SECTORS = [" + ",".join(sector_rows) + "];",
        encoding="utf-8")
    Path(locale_dir, "translation.json").write_text(
        json.dumps(sector_labels, ensure_ascii=False), encoding="utf-8")


class StoryProminence(unittest.TestCase):
    """Coverage momentum — observed, never claimed as popularity.

    ⚠️ The home page ranked by `last_published` desc until now, with
    `outlet_count` only as a tiebreak. Measured 2026-09-20: the build ran at
    23:25 UTC and the feed was late-night foreign wire while the day's
    most-covered domestic stories sat below the cut — the product's own
    premise, comparing outlets, losing to whoever published last.
    """

    NOW = datetime(2026, 9, 21, 12, 0, tzinfo=timezone.utc)

    def story(self, members):
        return {"members": [{"domain": d, "published": p.isoformat()}
                            for d, p in members]}

    def at(self, hours):
        return self.NOW - timedelta(hours=hours)

    def test_breadth_beats_recency(self):
        """The whole point: five newsrooms yesterday outrank one just now."""
        broad = bad.story_prominence(self.story(
            [(f"o{i}.bg", self.at(8)) for i in range(5)]), self.NOW)
        fresh = bad.story_prominence(self.story(
            [("one.bg", self.at(0))]), self.NOW)
        self.assertGreater(broad["score"], fresh["score"])

    def test_one_outlet_filing_repeatedly_is_not_breadth(self):
        """⚠️ Article count is NOT a multiplier. Six updates from one newsroom
        is not six newsrooms agreeing it matters, and rewarding it would rank
        a liveblog above an event everyone covered."""
        liveblog = bad.story_prominence(self.story(
            [("one.bg", self.at(i)) for i in range(6)]), self.NOW)
        two = bad.story_prominence(self.story(
            [("a.bg", self.at(0)), ("b.bg", self.at(0))]), self.NOW)
        self.assertEqual(liveblog["outlets"], 1)
        self.assertEqual(liveblog["articles"], 6)
        self.assertGreater(two["score"], liveblog["score"])

    def test_an_outlet_is_counted_once_in_the_velocity_window(self):
        repeated = bad.story_prominence(self.story(
            [("a.bg", self.at(1)), ("a.bg", self.at(2)),
             ("a.bg", self.at(3))]), self.NOW)
        self.assertEqual(repeated["arriving"], 1)

    def test_velocity_counts_only_the_preceding_window(self):
        recent = bad.story_prominence(self.story(
            [("a.bg", self.at(1)), ("b.bg", self.at(2))]), self.NOW)
        old = bad.story_prominence(self.story(
            [("a.bg", self.at(20)), ("b.bg", self.at(30))]), self.NOW)
        self.assertEqual(recent["arriving"], 2)
        self.assertEqual(old["arriving"], 0)

    def test_decay_is_a_half_life(self):
        # ⚠️ BOTH SIDES OUTSIDE THE 6-HOUR VELOCITY WINDOW, so this isolates
        # decay. Comparing a just-published story with a day-old one measures
        # decay AND the arrival boost at once, and neither cleanly.
        earlier = bad.story_prominence(self.story(
            [("a.bg", self.at(7)), ("b.bg", self.at(7))]), self.NOW)
        later = bad.story_prominence(self.story(
            [("a.bg", self.at(31)), ("b.bg", self.at(31))]), self.NOW)
        self.assertEqual(earlier["arriving"], 0)
        self.assertEqual(later["arriving"], 0)
        self.assertAlmostEqual(later["score"], earlier["score"] / 2, places=6)

    def test_arrival_lifts_a_story_over_an_equally_broad_older_one(self):
        arriving = bad.story_prominence(self.story(
            [("a.bg", self.at(1)), ("b.bg", self.at(2))]), self.NOW)
        settled = bad.story_prominence(self.story(
            [("a.bg", self.at(7)), ("b.bg", self.at(7))]), self.NOW)
        self.assertEqual(arriving["outlets"], settled["outlets"])
        self.assertGreater(arriving["score"], settled["score"])

    def test_no_publication_time_means_no_recency_boost_and_says_so(self):
        """⚠️ `fetched_at` is when WE saw it, not when it was published;
        substituting one for the other presents crawl scheduling as news."""
        undated = bad.story_prominence(
            {"members": [{"domain": "a.bg"}, {"domain": "b.bg"}]}, self.NOW)
        self.assertIs(undated["publication_time_known"], False)
        self.assertIsNone(undated["age_hours"])
        self.assertEqual(undated["outlets"], 2)

    def test_the_clock_is_passed_in_never_read(self):
        """A rank that moves between two rows of one page is not a ranking."""
        story = self.story([("a.bg", self.at(3))])
        first = bad.story_prominence(story, self.NOW)
        second = bad.story_prominence(story, self.NOW)
        self.assertEqual(first, second)

    def test_a_story_with_no_members_scores_zero_without_raising(self):
        empty = bad.story_prominence({"members": []}, self.NOW)
        self.assertEqual(empty["outlets"], 0)
        self.assertEqual(empty["score"], 0.0)


class GlobalFilterIndex(unittest.TestCase):
    """The structured half of a query, answered over the WHOLE corpus.

    ⚠️ `HomeScreen` filters the ≤16 stories in `home.json` and `OutletScreen`
    filters the revealed prefix and prints the count of matches within it.
    Both answer a narrower question than the reader asked, at a 200. This file
    is what lets a predicate see every story.
    """

    def build(self, stories):
        tmp = Path(tempfile.mkdtemp(prefix="filter_index_"))
        bad.write_story_pages(tmp, stories, "2026-09-21T12:00:00+00:00",
                              page_size=50)
        with open(tmp / "stories" / "filter-index.json", encoding="utf-8") as fh:
            return json.load(fh)

    def story(self, sid, *, categories=(), domains=("a",), hours=1):
        when = (datetime(2026, 9, 21, 12, 0, tzinfo=timezone.utc)
                - timedelta(hours=hours)).isoformat()
        return {"id": sid, "title_bg": sid, "last_published": when,
                "topics": [{"category": c, "primary": i == 0}
                           for i, c in enumerate(categories)],
                "members": [{"domain": f"{d}.bg", "published": when}
                            for d in domains]}

    def test_it_holds_every_story_not_a_page(self):
        stories = [self.story(f"s{i}") for i in range(120)]
        index = self.build(stories)
        self.assertEqual(index["total"], 120)
        self.assertEqual(len(index["stories"]), 120)

    def test_facet_counts_come_from_the_same_rows_as_membership(self):
        """⚠️ THE PROPERTY THAT WAS MISSING. A count computed over a different
        set than the list beneath it is how a chip reads „2" beside nine
        stories."""
        stories = [self.story("a", categories=("energy",), domains=("x",)),
                   self.story("b", categories=("energy", "economy"),
                              domains=("x", "y")),
                   self.story("c", categories=("economy",), domains=("y",))]
        index = self.build(stories)
        rows = index["stories"]
        # ⚠️ NON-VACUITY FIRST. Iterating an empty facet map asserts nothing,
        # so a mutant that stopped counting categories altogether passed this
        # test until these two lines existed.
        self.assertEqual(sorted(index["facets"]["categories"]),
                         ["economy", "energy"])
        self.assertEqual(sorted(index["facets"]["domains"]), ["x.bg", "y.bg"])
        for category, count in index["facets"]["categories"].items():
            with self.subTest(category=category):
                self.assertEqual(
                    count, sum(1 for r in rows if category in r[2]))
        for domain, count in index["facets"]["domains"].items():
            with self.subTest(domain=domain):
                self.assertEqual(
                    count, sum(1 for r in rows if domain in r[3]))

    def test_a_row_carries_what_a_predicate_needs_and_no_prose(self):
        index = self.build([self.story("a", categories=("energy",))])
        self.assertEqual(index["fields"],
                         ["id", "last_published", "categories", "domains"])
        row = index["stories"][0]
        # ⚠️ `fields` IS THE DECODER for a positional row, so it must describe
        # what is actually there — a consumer indexing by it is the whole
        # reason the rows are positional at all.
        self.assertEqual(len(row), len(index["fields"]))
        self.assertEqual(row[0], "a")
        self.assertEqual(row[2], ["energy"])
        self.assertEqual(row[3], ["a.bg"])
        # ⚠️ NO SCORE. It decays, and a decaying field in a whole-corpus file
        # ships ~248 KB on every hot run to convey a changed timestamp.
        self.assertNotIn("score", index["fields"])
        # ⚠️ NO TITLES. Measured, they take the payload from 44 KB to 288 KB
        # against a 13 KB home page; search is not global and must say so.
        titled = self.build([self.story("a", categories=("energy",))
                             | {"title_bg": "Уникално заглавие",
                                "title_en": "Unique headline"}])
        blob = json.dumps(titled["stories"], ensure_ascii=False)
        self.assertNotIn("Уникално", blob)
        self.assertNotIn("Unique", blob)

    def test_it_declares_the_query_contract_and_pins_no_instant(self):
        """⚠️ Nothing here decays, so there is no instant to pin — and an
        `as_of` would differ between two identical builds, defeating
        `restore_stable_stamps` and shipping this whole-corpus file in every
        hot overlay to convey a changed timestamp."""
        index = self.build([self.story("a")])
        self.assertEqual(index["query_version"], bad.QUERY_VERSION)
        self.assertNotIn("as_of", index)
        self.assertNotIn("prominence_version", index)

    def test_a_story_with_no_topic_is_counted_under_a_named_bucket(self):
        """Dropping it makes the facets sum to less than the corpus with
        nothing saying why."""
        index = self.build([self.story("a", categories=()),
                            self.story("b", categories=("energy",))])
        self.assertEqual(index["facets"]["categories"],
                         {bad.UNTOPICED_FACET: 1, "energy": 1})
        self.assertEqual(sum(index["facets"]["categories"].values()),
                         index["total"])

    def test_the_facet_bases_are_declared(self):
        """⚠️ The release carries TWO counts of „stories per category" —
        `taxonomy.json` counts the PRIMARY topic only, this counts every topic
        — and an undeclared pair is how a chip reads one number beside a list
        of another length."""
        index = self.build([self.story("a", categories=("energy", "economy"))])
        self.assertIn("categories", index["facets_basis"])
        self.assertIn("domains", index["facets_basis"])
        self.assertIn("not only its primary",
                      index["facets_basis"]["categories"])
        self.assertEqual(index["facets"]["categories"],
                         {"economy": 1, "energy": 1})

    def test_the_ids_match_the_paginated_families_exactly(self):
        """A story reachable from a page but absent from the index would be
        invisible to every facet; the reverse would be a phantom."""
        stories = [self.story(f"s{i}") for i in range(75)]
        tmp = Path(tempfile.mkdtemp(prefix="filter_parity_"))
        bad.write_story_pages(tmp, stories, "2026-09-21T12:00:00+00:00",
                              page_size=50)
        with open(tmp / "stories" / "filter-index.json", encoding="utf-8") as fh:
            index_ids = {r[0] for r in json.load(fh)["stories"]}
        for prefix in ("index", "ranked"):
            paged = set()
            for name in os.listdir(tmp / "stories"):
                if not name.startswith(f"{prefix}-"):
                    continue
                with open(tmp / "stories" / name, encoding="utf-8") as fh:
                    paged |= {r["id"] for r in json.load(fh)["stories"]}
            with self.subTest(prefix=prefix):
                self.assertEqual(index_ids, paged)

    def test_an_empty_corpus_produces_an_empty_index_not_a_crash(self):
        index = self.build([])
        self.assertEqual(index["total"], 0)
        self.assertEqual(index["stories"], [])
        self.assertEqual(index["facets"], {"categories": {}, "domains": {}})


class StoryIndexOrderings(unittest.TestCase):
    def rows(self, tmp):
        import json as _json
        out = {}
        for name in sorted(os.listdir(tmp / "stories")):
            if name.startswith(("index-", "ranked-")):
                with open(tmp / "stories" / name, encoding="utf-8") as fh:
                    out[name] = _json.load(fh)
        return out

    def build(self, stories):
        tmp = Path(tempfile.mkdtemp(prefix="story_pages_"))
        bad.write_story_pages(tmp, stories, "2026-09-21T12:00:00+00:00",
                              page_size=50)
        return tmp

    def story(self, sid, outlets, hours_ago, published="2026-09-21"):
        when = (datetime(2026, 9, 21, 12, 0, tzinfo=timezone.utc)
                - timedelta(hours=hours_ago)).isoformat()
        return {"id": sid, "title_bg": sid, "last_published": when,
                "members": [{"domain": f"{d}.bg", "published": when}
                            for d in outlets]}

    def test_both_orderings_hold_every_story(self):
        """⚠️ A rank may reorder the feed; it may never remove a story from
        it, or a reader following a link lands on a page that says the story
        does not exist."""
        stories = [self.story(f"s{i}", ["a", "b"][: 1 + i % 2], i)
                   for i in range(30)]
        pages = self.rows(self.build(stories))
        for prefix in ("index-", "ranked-"):
            ids = {r["id"] for name, doc in pages.items()
                   if name.startswith(prefix) for r in doc["stories"]}
            with self.subTest(prefix=prefix):
                self.assertEqual(ids, {s["id"] for s in stories})

    def test_the_ranked_tiebreak_is_newest_first(self):
        """⚠️ Written as one tuple with `-score`, the date sorts ASCENDING and
        the OLDEST story wins every tie.

        ⚠️ AND THE FIXTURE MUST ACTUALLY TIE. The first version of this test
        used stories 40 hours apart, which score 1.214 against 0.315 — no tie
        exists, so the buggy single-tuple implementation its own docstring
        names produces the same answer and the test passes against it.
        """
        stories = [self.story("old", ["a"], 3), self.story("new", ["a"], 3)]
        scores = {s["id"]: bad.story_prominence(
            s, datetime(2026, 9, 21, 12, 0, tzinfo=timezone.utc))["score"]
            for s in stories}
        self.assertEqual(len(set(scores.values())), 1,
                         f"the fixture does not tie: {scores}")
        # Same score, different publication instants: the newer must win.
        stories[0]["last_published"] = "2026-09-20T09:00:00+00:00"
        stories[1]["last_published"] = "2026-09-21T09:00:00+00:00"
        pages = self.rows(self.build(stories))
        ranked = pages["ranked-1.json"]["stories"]
        self.assertEqual([r["id"] for r in ranked], ["new", "old"])

    def test_the_ranked_tiebreak_falls_through_to_the_id(self):
        """Two stories identical in score AND instant must still order
        deterministically, or a page boundary moves between builds."""
        stories = [self.story("zeta", ["a"], 3), self.story("alpha", ["a"], 3)]
        for story in stories:
            story["last_published"] = "2026-09-21T09:00:00+00:00"
            for member in story["members"]:
                member["published"] = "2026-09-21T09:00:00+00:00"
        ranked = self.rows(self.build(stories))["ranked-1.json"]["stories"]
        self.assertEqual([r["id"] for r in ranked], ["alpha", "zeta"])

    def test_each_page_publishes_the_instant_it_was_ranked_against(self):
        pages = self.rows(self.build([self.story("a", ["a"], 1)]))
        for name, doc in pages.items():
            with self.subTest(page=name):
                self.assertEqual(doc["as_of"], "2026-09-21T12:00:00+00:00")
                self.assertIn(doc["sort"], ("latest", "prominence"))


class BuildAppDataFixture(unittest.TestCase):
    """The harness only — throwaway root, corpus writers, `run_build`.

    ⚠️ Separate from the tests deliberately. Subclassing a TestCase that owns
    tests INHERITS them, so every subclass re-runs them as extra subprocess
    builds under its own name — which is both slow and a lie in the report,
    since `TopicDistributions.test_non_numeric_rank_does_not_crash` is not a
    test of topic distributions.
    """

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="build_app_data_test_")
        self.addCleanup(shutil.rmtree, self.root, True)
        self.data_dir = os.path.join(self.root, "news", "data")
        self.out_dir = os.path.join(self.root, "news", "app-data")
        os.makedirs(os.path.join(self.root, "news"), exist_ok=True)
        with open(os.path.join(self.root, "news", "topics.json"), "w", encoding="utf-8") as fh:
            json.dump(TAXONOMY, fh, ensure_ascii=False)
        os.makedirs(self.data_dir, exist_ok=True)
        ensure_feedback_target_fixture(self.root, self.data_dir)
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

    def write_accepted_snapshot(self, article, analysis, *, leaning="conservative",
                                russia="anti_russia",
                                party_tones=None,
                                project_id="electionsbg-news"):
        article_key = f'{analysis["domain"]}/{Path(analysis["article_path"]).stem}'
        record = {
            "schema_version": 1,
            "rubric_version": "news-article-evaluation-v1",
            "article_key": article_key,
            "url": analysis["url"],
            "task_revision": 1,
            "content_sha256": content_sha256(article["content"]),
            "analysis_sha256": analysis_sha256(analysis),
            "source_submission_ids": ["submission-0001"],
            "operator_actor": {"kind": "maintainer", "id": "test-maintainer"},
            "adjudicated_at": "2026-08-31T12:00:00.000Z",
            "revision": 1,
            "evaluation": {
                "schema_version": 1,
                "leaning": {
                    "label": leaning, "disposition": "changed",
                    "evidence": "Целият материал подкрепя коригираната оценка.",
                    "reason_codes": ["model_missed_context"],
                },
                "russia_stance": {
                    "label": russia, "disposition": "changed",
                    "evidence": "Целият материал заема ясна позиция спрямо Русия.",
                    "reason_codes": ["model_missed_context"],
                },
                "parties_confirmed_complete": True,
                "party_tones": party_tones or [],
                "removed_model_parties": [],
                "public_note": "Проверено спрямо целия оригинален материал.",
            },
            "model_labels": {
                "leaning": analysis["leaning"]["label"],
                "russia_stance": analysis["russia_stance"]["label"],
                "party_tones": [],
            },
            "public_explanation": "Проверено спрямо целия оригинален материал.",
            "gold_eligible": True,
            "status": "accepted",
            "last_operation_id": "accept-operation-0001",
        }
        records = [record]
        snapshot = {
            "manifest": {
                "schema_version": 1,
                "snapshot_kind": "news-eval-accepted-adjudications",
                "project_id": project_id,
                "firestore_read_time": "2026-08-31T12:30:00.000Z",
                "rubric_version": "news-article-evaluation-v1",
                "record_count": 1,
                "records_sha256": canonical_sha256(records),
            },
            "records": records,
        }
        path = Path(self.data_dir) / "evals" / "accepted" / "current.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(snapshot, ensure_ascii=False), encoding="utf-8")
        return record

    def write_accepted_feedback_snapshot(
            self, article, *, domain, fname, analysis=None,
            leaning="conservative", issue_kinds=None, links=None):
        article_key = f"{domain}/{Path(fname).stem}"
        registry = build_feedback_targets(Path(self.root),
                                          "2026-09-01T00:00:00Z")
        record = {
            "schema_version": 1, "contract": "article-feedback-v1",
            "article_key": article_key,
            "url": f"https://news.electionsbg.com/article/{article_key}",
            "task_revision": 1,
            "content_sha256": content_sha256(article["content"]),
            "analysis_sha256": (
                canonical_sha256(compact_analysis(analysis, article))
                if analysis is not None else None),
            "target_registry_sha256": registry["targets_sha256"],
            "source_submission_ids": ["feedback-submission-0001"],
            "source_target_registry_sha256s": {
                "feedback-submission-0001": registry["targets_sha256"]},
            "operator_actor": {"kind": "maintainer", "id": "editor"},
            "adjudicated_at": "2026-09-01T10:00:00.000Z", "revision": 1,
            "feedback": {
                "leaning": ({"label": leaning, "evidence": "Иван Иванов"}
                            if leaning is not None else None),
                "russia_stance": None, "party_tones": [],
                "link_proposals": links or [],
                "issue_kinds": issue_kinds or [], "public_note": None,
            },
            "public_explanation": "Редакционно проверено.",
            "status": "accepted",
            "last_operation_id": "feedback-operation-0001",
        }
        records = [record]
        snapshot = {"manifest": {
            "schema_version": 1,
            "snapshot_kind": "news-feedback-accepted-adjudications",
            "project_id": "electionsbg-news",
            "firestore_read_time": "2026-09-01T10:05:00.000Z",
            "record_count": 1, "records_sha256": canonical_sha256(records),
        }, "records": records}
        path = (Path(self.data_dir) / "evals" / "feedback-accepted" /
                "current.json")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(snapshot, ensure_ascii=False),
                        encoding="utf-8")
        return record

    def write_story_membership(self, domain, fname, article, analysis,
                               *, story_id="story-accepted", write_story=True):
        url = article["url"]
        path = analysis["article_path"]
        analysis_dir = Path(self.data_dir) / "analysis"
        analysis_dir.mkdir(parents=True, exist_ok=True)
        (analysis_dir / "index.json").write_text(json.dumps({
            "version": 1, "updated_at": "now", "stories": {},
            "articles": {url: {
                "path": path, "story_id": story_id, "domain": domain,
                "analyzed_at": "now",
            }},
        }), encoding="utf-8")
        stories_dir = analysis_dir / "stories"
        if write_story:
            stories_dir.mkdir(parents=True, exist_ok=True)
            (stories_dir / f"{story_id}.json").write_text(json.dumps({
                "id": story_id,
                "canonical_title_bg": "Приета оценка",
                "canonical_title_en": "Accepted evaluation",
                "summary_bg": "Резюме", "summary_en": "Summary",
                "created_at": "now", "updated_at": "now",
                "topics": [], "related_story_ids": [],
                "members": [{
                    "domain": domain, "article_path": path, "url": url,
                    "published": article["published"],
                    "leaning": analysis["leaning"]["label"],
                    "russia_stance": analysis["russia_stance"]["label"],
                    "added_at": "now",
                }],
                "entities": {"people": [], "parties": [], "institutions": [],
                             "companies": [], "places": []},
                "aggregates": {
                    "article_count": 1, "outlet_count": 1,
                    "by_leaning": {analysis["leaning"]["label"]: 1},
                    "by_russia_stance": {
                        analysis["russia_stance"]["label"]: 1},
                    "by_domain": {domain: 1},
                },
            }, ensure_ascii=False), encoding="utf-8")
        return stories_dir

    def run_build_process(self, *extra):
        return subprocess.run(
            [sys.executable, SCRIPT,
             "--data-dir", self.data_dir, "--out", self.out_dir, "--quiet", "--json",
             *extra],
            capture_output=True, text=True,
            env=dict(os.environ, DATA_BG_ROOT=self.root),
        )

    def run_build(self, *extra):
        # ⚠️ DATA_BG_ROOT, or the fixture taxonomy written in setUp is dead
        # code and every test here silently reads the PRODUCTION
        # news/topics.json — which is how a taxonomy-count assertion can pass
        # while asserting nothing about the fixture it claims to use.
        ensure_fixture_story_membership(self.data_dir)
        proc = self.run_build_process(*extra)
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


class BuildAppDataTest(BuildAppDataFixture):
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
        home = self.load("home.json")
        self.assertEqual([row["id"] for row in home["stories"]], ["20260822-s1"])
        self.assertEqual(len(home["articles"]), 1)
        self.assertEqual(home["articles"][0]["story_id"], "20260822-s1")
        self.assertIsNone(home["articles"][0]["image"])
        # ⚠️ The home bundle ships a BOOLEAN, not the analysis. The object was
        # 54% of home.json — 18,689 of 34,452 gzipped bytes on the first-paint
        # path — and `homeHierarchy` read it once, as a truthiness test.
        self.assertTrue(home["articles"][0]["has_analysis"])
        for dropped in ("analysis", "excerpt", "feedback_analysis_sha256"):
            self.assertNotIn(dropped, home["articles"][0])
        # The trim drops a DUPLICATE from the first-paint bundle, not the data:
        # the article page loads articles/<domain>.json, which is unaffected.
        self.assertIsInstance(article.get("analysis"), dict)

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

    def test_accepted_analysis_drives_article_and_touched_story_projection(self):
        domain = "example.bg"
        fname = "article-accepted.json"
        url = "https://example.bg/article-accepted"
        path = f"news/data/{domain}/{fname}"
        article = corpus_article(
            domain, fname, url, "Приета оценка", "2026-08-22T00:00:00+00:00")
        analysis = self.analysis_record(
            url, domain, path, leaning="progressive", russia="not_applicable")
        self.write_corpus(domain, fname, article)
        self.write_analysis(domain, fname, analysis)
        self.write_accepted_snapshot(article, analysis, party_tones=[{
            "party": "Партия А", "party_id": "party-a", "tone": "favorable",
            "evidence": "Материалът описва партията положително.",
            "disposition": "added", "reason_codes": ["party_missing"],
        }])

        stories_dir = self.write_story_membership(
            domain, fname, article, analysis)

        self.run_build()

        public_article = self.load(f"articles/{domain}.json")["articles"][0]
        self.assertEqual(public_article["analysis"]["leaning"]["label"], "conservative")
        self.assertIsNone(public_article["analysis"]["leaning"]["confidence"])
        self.assertEqual(public_article["analysis"]["russia_stance"]["label"], "anti_russia")
        self.assertEqual(public_article["analysis"]["party_tones"][0]["party"], "Партия А")
        self.assertIsNone(
            public_article["analysis"]["party_tones"][0]["confidence"])
        self.assertEqual(public_article["analysis"]["human_review"], {
            "status": "accepted",
            "adjudicated_at": "2026-08-31T12:00:00.000Z",
            "revision": 1,
            "fields": {
                "leaning": "changed",
                "russia_stance": "changed",
                "party_tones": "accepted",
            },
            "public_explanation": "Проверено спрямо целия оригинален материал.",
        })
        public_analysis_json = json.dumps(
            public_article["analysis"], ensure_ascii=False)
        for private_key in (
                "operator_actor", "source_submission_ids", "content_sha256",
                "analysis_sha256", "original_model", "last_operation_id"):
            self.assertNotIn(private_key, public_analysis_json)
        story = self.load("stories.json")["stories"][0]
        self.assertEqual(story["members"][0]["leaning"], "conservative")
        self.assertEqual(story["members"][0]["russia_stance"], "anti_russia")
        self.assertEqual(story["aggregates"]["by_leaning"], {"conservative": 1})
        self.assertEqual(story["aggregates"]["by_russia_stance"], {"anti_russia": 1})
        # T5.2: the per-axis distinct positioned-outlet count the cards' guard reads.
        self.assertEqual(story["aggregates"]["leaning_outlets"], 1)
        self.assertEqual(story["aggregates"]["russia_stance_outlets"], 1)
        self.assertEqual(story["aggregates"]["by_party_tone"], {
            "Партия А": {"favorable": 1},
        })
        stats = self.load("stats.json")
        snapshot = json.loads(
            (Path(self.data_dir) / "evals" / "accepted" / "current.json")
            .read_text(encoding="utf-8"))
        self.assertEqual(
            stats["accepted_snapshot_records_sha256"],
            snapshot["manifest"]["records_sha256"],
        )
        outlet = next(
            item for item in self.load("outlets.json")["outlets"]
            if item["domain"] == domain)
        self.assertEqual(outlet["leaning"], {"conservative": 1})
        self.assertEqual(outlet["russia_stance"], {"anti_russia": 1})
        society = next(
            item for item in self.load("taxonomy.json")["categories"]
            if item["id"] == "society")
        self.assertEqual(society["leaning"], {"conservative": 1})
        self.assertEqual(society["russia_stance"], {"anti_russia": 1})

        # Publication overlays are in-memory only.
        stored_analysis = json.loads(
            (Path(self.data_dir) / "analysis" / "articles" / domain / fname)
            .read_text(encoding="utf-8"))
        stored_story = json.loads(
            (stories_dir / "story-accepted.json").read_text(encoding="utf-8"))
        self.assertEqual(stored_analysis["leaning"]["label"], "progressive")
        self.assertEqual(stored_story["aggregates"]["by_leaning"], {"progressive": 1})

    def test_stale_accepted_content_keeps_model_values_and_recomputes_story(self):
        domain = "example.bg"
        fname = "article-stale.json"
        url = "https://example.bg/article-stale"
        path = f"news/data/{domain}/{fname}"
        original = corpus_article(
            domain, fname, url, "Стара оценка", "2026-08-22T00:00:00+00:00")
        analysis = self.analysis_record(
            url, domain, path, leaning="progressive", russia="not_applicable")
        self.write_corpus(domain, fname, original)
        self.write_analysis(domain, fname, analysis)
        self.write_accepted_snapshot(original, analysis)
        stories_dir = self.write_story_membership(
            domain, fname, original, analysis, story_id="story-stale")
        stored_story_path = stories_dir / "story-stale.json"
        stored_story = json.loads(stored_story_path.read_text(encoding="utf-8"))
        stored_story["members"][0]["leaning"] = "conservative"
        stored_story["members"][0]["russia_stance"] = "anti_russia"
        stored_story["aggregates"]["by_leaning"] = {"conservative": 1}
        stored_story["aggregates"]["by_russia_stance"] = {"anti_russia": 1}
        stored_story_path.write_text(
            json.dumps(stored_story, ensure_ascii=False), encoding="utf-8")
        edited = {**original, "content": "Редактиран текст. " * 40}
        edited["content_chars"] = len(edited["content"])
        self.write_corpus(domain, fname, edited)

        self.run_build()

        public_article = self.load(f"articles/{domain}.json")["articles"][0]
        self.assertEqual(public_article["analysis"]["leaning"]["label"], "progressive")
        self.assertEqual(public_article["analysis"]["leaning"]["confidence"], 0.7)
        self.assertEqual(
            public_article["analysis"]["human_review"]["status"],
            "needs_revalidation")
        story = self.load("stories.json")["stories"][0]
        self.assertEqual(story["aggregates"]["by_leaning"], {"progressive": 1})
        self.assertEqual(
            story["aggregates"]["by_russia_stance"], {"not_applicable": 1})
        self.assertEqual(
            json.loads(stored_story_path.read_text(encoding="utf-8"))
            ["aggregates"]["by_leaning"],
            {"conservative": 1},
        )

    def test_accepted_all_article_feedback_updates_analysis_and_links(self):
        domain, fname = "example.bg", "feedback.json"
        url = "https://example.bg/feedback"
        article = corpus_article(
            domain, fname, url, "Иван Иванов",
            "2026-08-22T00:00:00+00:00", content="Иван Иванов каза нещо.")
        path = f"news/data/{domain}/{fname}"
        analysis = self.analysis_record(url, domain, path)
        self.write_corpus(domain, fname, article)
        self.write_analysis(domain, fname, analysis)
        self.write_story_membership(domain, fname, article, analysis,
                                    story_id="story-feedback")
        self.write_accepted_feedback_snapshot(
            article, domain=domain, fname=fname, analysis=analysis,
            links=[{
                "action": "add", "surface": "Иван Иванов",
                "target_kind": "person", "resolution_status": "selected",
                "target_ref": {"kind": "person", "id": "person-1"},
                "current_href": None, "context": "Иван Иванов",
                "evidence": "Иван Иванов",
            }], issue_kinds=["missing_entity"])

        self.run_build()
        public = self.load(f"articles/{domain}.json")["articles"][0]
        self.assertEqual(public["analysis"]["leaning"]["label"],
                         "conservative")
        self.assertIsNone(public["analysis"]["leaning"]["confidence"])
        self.assertEqual(
            public["analysis"]["entity_links"]["Иван Иванов"]["id"],
            "person-1")
        self.assertEqual(public["analysis"]["reviewed_links"][0]["kind"],
                         "person")
        self.assertEqual(public["editorial_feedback"]["status"], "accepted")
        self.assertEqual(
            public["feedback_analysis_sha256"],
            canonical_sha256(compact_analysis(analysis, article)))
        self.assertNotEqual(
            public["feedback_analysis_sha256"],
            canonical_sha256(public["analysis"]))
        stats = self.load("stats.json")
        self.assertRegex(stats["accepted_feedback_records_sha256"],
                         r"^sha256:[0-9a-f]{64}$")
        story = self.load("stories.json")["stories"][0]
        self.assertEqual(story["aggregates"]["by_leaning"],
                         {"conservative": 1})

    def test_accepted_missing_analysis_issue_surfaces_without_fake_analysis(self):
        domain, fname = "example.bg", "not-analyzed.json"
        url = "https://example.bg/not-analyzed"
        article = corpus_article(
            domain, fname, url, "Без анализ",
            "2026-08-22T00:00:00+00:00")
        self.write_corpus(domain, fname, article)
        self.write_accepted_feedback_snapshot(
            article, domain=domain, fname=fname, analysis=None, leaning=None,
            issue_kinds=["missing_analysis"])

        self.run_build()
        public = self.load(f"articles/{domain}.json")["articles"][0]
        self.assertNotIn("analysis", public)
        self.assertEqual(public["editorial_feedback"]["issue_kinds"],
                         ["missing_analysis"])
        self.assertEqual(public["editorial_feedback"]["status"], "accepted")

    def test_new_analysis_withholds_stale_missing_analysis_claim(self):
        domain, fname = "example.bg", "analysis-added.json"
        url = "https://example.bg/analysis-added"
        article = corpus_article(
            domain, fname, url, "Без анализ",
            "2026-08-22T00:00:00+00:00")
        self.write_corpus(domain, fname, article)
        self.write_accepted_feedback_snapshot(
            article, domain=domain, fname=fname, analysis=None, leaning=None,
            issue_kinds=["missing_analysis"])
        analysis = self.analysis_record(
            url, domain, f"news/data/{domain}/{fname}")
        self.write_analysis(domain, fname, analysis)

        self.run_build()
        public = self.load(f"articles/{domain}.json")["articles"][0]
        provenance = public["editorial_feedback"]
        self.assertEqual(provenance["status"], "needs_revalidation")
        self.assertEqual(provenance["fields"], [])
        self.assertEqual(provenance["needs_revalidation_fields"],
                         ["issue_kinds"])
        self.assertEqual(provenance["issue_kinds"], [])
        self.assertIsNone(provenance["public_explanation"])

    def test_archived_only_feedback_target_is_not_release_eligible(self):
        domain, fname = "example.bg", "removed-target.json"
        url = "https://example.bg/removed-target"
        article = corpus_article(
            domain, fname, url, "Иван Иванов",
            "2026-08-22T00:00:00+00:00", content="Иван Иванов каза нещо.")
        analysis = self.analysis_record(
            url, domain, f"news/data/{domain}/{fname}")
        self.write_corpus(domain, fname, article)
        self.write_analysis(domain, fname, analysis)
        self.write_accepted_feedback_snapshot(
            article, domain=domain, fname=fname, analysis=analysis,
            links=[{
                "action": "add", "surface": "Иван Иванов",
                "target_kind": "person", "resolution_status": "selected",
                "target_ref": {"kind": "person", "id": "person-1"},
                "current_href": None, "context": "Иван Иванов",
                "evidence": "Иван Иванов",
            }])
        Path(self.data_dir, "gazetteer.json").write_text(json.dumps({
            "version": 1, "generated_at": "2026-09-01T00:00:00Z",
            "entries": [],
        }), encoding="utf-8")

        proc = self.run_build_process()
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("absent from current registry", proc.stderr)

    def test_wrong_project_unmatched_article_and_missing_story_fail_before_write(self):
        domain = "example.bg"
        fname = "article-fail.json"
        url = "https://example.bg/article-fail"
        path = f"news/data/{domain}/{fname}"
        article = corpus_article(
            domain, fname, url, "Отказана оценка", "2026-08-22T00:00:00+00:00")
        analysis = self.analysis_record(url, domain, path)
        self.write_corpus(domain, fname, article)
        self.write_analysis(domain, fname, analysis)
        self.write_accepted_snapshot(
            article, analysis, project_id="demo-news-evals")
        output = Path(self.out_dir)
        output.mkdir(parents=True, exist_ok=True)
        sentinel = output / "sentinel.json"
        sentinel.write_text('{"keep":true}', encoding="utf-8")

        wrong_project = self.run_build_process()
        self.assertNotEqual(wrong_project.returncode, 0)
        self.assertIn("project_id", wrong_project.stderr)
        self.assertEqual(sentinel.read_text(encoding="utf-8"), '{"keep":true}')
        self.assertEqual(list(output.iterdir()), [sentinel])

        self.write_accepted_snapshot(article, analysis)
        snapshot_path = (Path(self.data_dir) / "evals" / "accepted" /
                         "current.json")
        snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
        snapshot["records"][0]["article_key"] = f"{domain}/absent-article"
        snapshot["manifest"]["records_sha256"] = canonical_sha256(
            snapshot["records"])
        snapshot_path.write_text(
            json.dumps(snapshot, ensure_ascii=False), encoding="utf-8")
        unmatched = self.run_build_process()
        self.assertNotEqual(unmatched.returncode, 0)
        self.assertIn("absent from the coherent corpus/analysis", unmatched.stderr)
        self.assertEqual(list(output.iterdir()), [sentinel])

        self.write_accepted_snapshot(article, analysis)
        self.write_story_membership(
            domain, fname, article, analysis,
            story_id="story-missing", write_story=False)
        missing_story = self.run_build_process()
        self.assertNotEqual(missing_story.returncode, 0)
        self.assertIn("analysis/index.json references missing story files: story-missing",
                      missing_story.stderr)
        self.assertEqual(sentinel.read_text(encoding="utf-8"), '{"keep":true}')
        self.assertEqual(list(output.iterdir()), [sentinel])

    def test_model_only_story_membership_failures_happen_before_output(self):
        domain = "example.bg"
        fname = "article-indexed.json"
        url = "https://example.bg/article-indexed"
        path = f"news/data/{domain}/{fname}"
        article = corpus_article(
            domain, fname, url, "Индекс", "2026-08-22T00:00:00+00:00")
        analysis = self.analysis_record(url, domain, path)
        self.write_corpus(domain, fname, article)
        self.write_analysis(domain, fname, analysis)
        output = Path(self.out_dir)
        output.mkdir(parents=True, exist_ok=True)
        sentinel = output / "sentinel.json"
        sentinel.write_text('{"keep":true}', encoding="utf-8")

        stories_dir = self.write_story_membership(
            domain, fname, article, analysis,
            story_id="story-missing", write_story=False)
        missing = self.run_build_process()
        self.assertNotEqual(missing.returncode, 0)
        self.assertIn("references missing story files: story-missing", missing.stderr)
        self.assertEqual(list(output.iterdir()), [sentinel])

        self.write_story_membership(
            domain, fname, article, analysis, story_id="story-omits")
        story_path = stories_dir / "story-omits.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story["members"] = []
        story_path.write_text(json.dumps(story), encoding="utf-8")
        omitted = self.run_build_process()
        self.assertNotEqual(omitted.returncode, 0)
        self.assertIn("index_only=['https://example.bg/article-indexed']", omitted.stderr)
        self.assertEqual(list(output.iterdir()), [sentinel])

        story["members"] = [{
            "domain": domain, "article_path": path, "url": url,
            "published": article["published"], "leaning": "progressive",
            "russia_stance": "not_applicable", "added_at": "now",
        }]
        story_path.write_text(json.dumps(story), encoding="utf-8")
        index_path = Path(self.data_dir) / "analysis" / "index.json"
        index = json.loads(index_path.read_text(encoding="utf-8"))
        index["articles"][url]["story_id"] = "story-elsewhere"
        index_path.write_text(json.dumps(index), encoding="utf-8")
        crossed = self.run_build_process()
        self.assertNotEqual(crossed.returncode, 0)
        self.assertIn("file_only=['https://example.bg/article-indexed']", crossed.stderr)
        self.assertEqual(list(output.iterdir()), [sentinel])

        # The raw model decision is not resolved membership. With no index row
        # it must neither become a public fallback link nor bypass the gate.
        analysis_path = (Path(self.data_dir) / "analysis" / "articles" /
                         domain / fname)
        stored_analysis = json.loads(analysis_path.read_text(encoding="utf-8"))
        stored_analysis["story"] = {
            "action": "same_story", "story_id": "story-raw-fallback"}
        analysis_path.write_text(json.dumps(stored_analysis), encoding="utf-8")
        index["articles"] = {}
        index_path.write_text(json.dumps(index), encoding="utf-8")
        story_path.unlink()
        unindexed = self.run_build_process()
        self.assertNotEqual(unindexed.returncode, 0)
        self.assertIn("absent from analysis/index.json", unindexed.stderr)
        self.assertEqual(list(output.iterdir()), [sentinel])

    def test_present_malformed_review_or_retained_confidence_fails_closed(self):
        domain = "example.bg"
        fname = "article-malformed-review.json"
        url = "https://example.bg/article-malformed-review"
        path = f"news/data/{domain}/{fname}"
        article = corpus_article(
            domain, fname, url, "Проверка", "2026-08-22T00:00:00+00:00")
        analysis = self.analysis_record(url, domain, path)
        accepted = self.write_accepted_snapshot(article, analysis)
        effective = effective_analysis(analysis, article, accepted)

        malformed = copy.deepcopy(effective)
        del malformed["human_review"]["fields"]["leaning"]
        with self.assertRaisesRegex(ValueError, "disposition is invalid"):
            compact_analysis(malformed, article)

        contradictory = copy.deepcopy(effective)
        contradictory["leaning"]["confidence"] = 0.99
        with self.assertRaisesRegex(ValueError, "must not retain model confidence"):
            compact_analysis(contradictory, article)

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
        ensure_feedback_target_fixture(self.root, self.data_dir)

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
            "image_rights": {
                "status": "cc",
                "creator": "Иван Иванов",
                "credit_text": "Снимка: Иван Иванов / CC BY 4.0",
                "credit_url": "https://example.org/photo",
                "licence_name": "CC BY 4.0",
                "licence_url": "https://creativecommons.org/licenses/by/4.0/",
                "source_url": "https://example.org/photo",
                "checked_at": "2026-08-28",
                "display_home": True,
            },
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

    def run_build(self):
        return subprocess.run(
            [sys.executable, SCRIPT, "--data-dir", self.data_dir,
             "--out", self.out_dir, "--quiet", "--json"],
            capture_output=True, text=True,
            env=dict(os.environ, DATA_BG_ROOT=self.root))

    def build(self):
        ensure_fixture_story_membership(self.data_dir)
        proc = self.run_build()
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
                          ("updated", "2026-08-22T11:00:00+00:00"),
                          ("image_rights", {
                              "status": "cc",
                              "creator": "Иван Иванов",
                              "credit_text": "Снимка: Иван Иванов / CC BY 4.0",
                              "credit_url": "https://example.org/photo",
                              "licence_name": "CC BY 4.0",
                              "licence_url": "https://creativecommons.org/licenses/by/4.0/",
                              "source_url": "https://example.org/photo",
                              "checked_at": "2026-08-28",
                              "display_home": True,
                              # Provenance is always EMITTED, even unstated —
                              # a stable shape means a consumer never has to
                              # tell "not reviewed" from "field not built yet".
                              "role": None,
                              "crop_allowed": None,
                              "source_article_url": None,
                              "focal_x": None,
                              "focal_y": None,
                          })):
            self.assertEqual(rec.get(key), want, key)

    def test_missing_image_rights_stays_absent(self):
        self.write_article("ex.bg", "20260822-a1-abc.json", image_rights=None)
        self.build()
        rec = self.load("articles/ex.bg.json")["articles"][0]
        self.assertNotIn("image_rights", rec)

    def test_unknown_or_blocked_rights_cannot_enable_home_display(self):
        for status in ("unknown", "blocked"):
            with self.subTest(status=status):
                self.write_article(
                    "ex.bg", "20260822-a1-abc.json",
                    image_rights={
                        "status": status,
                        "creator": None,
                        "credit_text": "Проверен източник",
                        "credit_url": "https://ex.bg/a/1",
                        "licence_name": None,
                        "licence_url": None,
                        "source_url": "https://ex.bg/a/1",
                        "checked_at": "2026-08-28",
                        "display_home": True,
                    },
                )
                proc = self.run_build()
                self.assertNotEqual(proc.returncode, 0)
                self.assertIn(
                    f"{status} image rights cannot allow home display", proc.stderr
                )

    def test_malformed_image_rights_fail_the_build(self):
        self.write_article(
            "ex.bg", "20260822-a1-abc.json",
            image_rights={"status": "licensed"},
        )
        proc = self.run_build()
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("image_rights missing required keys", proc.stderr)

    def test_display_cleared_status_requires_licence_evidence(self):
        for status in (
            "publisher_permission", "licensed", "cc", "public_domain",
            "official_reuse_policy",
        ):
            with self.subTest(status=status):
                self.write_article(
                    "ex.bg", "20260822-a1-abc.json",
                    image_rights={
                        "status": status,
                        "creator": "Иван Иванов",
                        "credit_text": "Снимка: Иван Иванов",
                        "credit_url": "https://ex.bg/credit",
                        "licence_name": None,
                        "licence_url": None,
                        "source_url": "https://ex.bg/a/1",
                        "checked_at": "2026-08-28",
                        "display_home": True,
                    },
                )
                proc = self.run_build()
                self.assertNotEqual(proc.returncode, 0)
                self.assertIn("require non-empty evidence", proc.stderr)

    def test_display_cleared_status_rejects_blank_licence_name(self):
        self.write_article(
            "ex.bg", "20260822-a1-abc.json",
            image_rights={
                "status": "cc",
                "creator": "Иван Иванов",
                "credit_text": "Снимка: Иван Иванов / CC BY 4.0",
                "credit_url": "https://example.org/photo",
                "licence_name": "   ",
                "licence_url": "https://creativecommons.org/licenses/by/4.0/",
                "source_url": "https://example.org/photo",
                "checked_at": "2026-08-28",
                "display_home": True,
            },
        )
        proc = self.run_build()
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("licence_name", proc.stderr)

    def test_machine_policy_is_conservative_and_fail_closed(self):
        policy_path = (
            Path(SCRIPT).resolve().parents[1]
            / "config" / "image_rights_policy.json"
        )
        policy = json.loads(policy_path.read_text())
        self.assertEqual(policy["default_decision"], "deny")
        self.assertEqual(policy["scope"], "news_home")
        self.assertTrue(policy["delivery_is_not_permission"])
        self.assertEqual(
            set(policy["permitted_statuses"]),
            {
                "publisher_permission", "licensed", "cc", "public_domain",
                "official_reuse_policy",
            },
        )
        self.assertEqual(set(policy["denied_statuses"]), {"unknown", "blocked"})
        self.assertEqual(
            policy["legal_review"], "required_before_public_launch"
        )

    def test_policy_loader_rejects_semantic_drift(self):
        policy_path = (
            Path(SCRIPT).resolve().parents[1]
            / "config" / "image_rights_policy.json"
        )
        valid = json.loads(policy_path.read_text())
        cases = {
            "overlap": lambda p: p["denied_statuses"].append("cc"),
            "omission": lambda p: p["denied_statuses"].remove("unknown"),
            "allow_default": lambda p: p.update(default_decision="allow"),
            "delivery_permission": lambda p: p.update(
                delivery_is_not_permission=False
            ),
            "missing_evidence": lambda p: p["required_evidence"].remove(
                "licence_name"
            ),
            "bad_approval_date": lambda p: p.update(approved_on="28/08/2026"),
            "bad_version": lambda p: p.update(version=2),
        }
        for label, mutate in cases.items():
            with self.subTest(label=label), tempfile.TemporaryDirectory() as tmp:
                candidate = json.loads(json.dumps(valid))
                mutate(candidate)
                path = Path(tmp) / "policy.json"
                path.write_text(json.dumps(candidate))
                with self.assertRaises(ValueError):
                    load_image_rights_policy(path)

    def test_image_rights_reject_unsafe_urls_and_malformed_dates(self):
        cases = (
            ("credit_url", "javascript:alert(1)", "absolute http(s) URL"),
            ("source_url", "/relative", "absolute http(s) URL"),
            ("licence_url", "ftp://example.org/licence", "absolute http(s) URL"),
            ("checked_at", "recently", "must be an ISO date"),
        )
        for key, value, message in cases:
            with self.subTest(key=key):
                rights = {
                    "status": "cc",
                    "creator": "Иван Иванов",
                    "credit_text": "Снимка: Иван Иванов / CC BY 4.0",
                    "credit_url": "https://example.org/photo",
                    "licence_name": "CC BY 4.0",
                    "licence_url": "https://creativecommons.org/licenses/by/4.0/",
                    "source_url": "https://example.org/photo",
                    "checked_at": "2026-08-28",
                    "display_home": True,
                }
                rights[key] = value
                self.write_article(
                    "ex.bg", "20260822-a1-abc.json", image_rights=rights
                )
                proc = self.run_build()
                self.assertNotEqual(proc.returncode, 0)
                self.assertIn(message, proc.stderr)

    def _cc_rights(self, **over):
        rights = {
            "status": "cc",
            "creator": "Иван Иванов",
            "credit_text": "Снимка: Иван Иванов / CC BY 4.0",
            # ⚠️ NOT a commons.wikimedia.org URL. A Commons source triggers the
            # separate <=960px-derivative check, which the default fixture
            # image is not — and that failure would be read as a provenance
            # failure by every test below.
            "credit_url": "https://example.org/photo",
            "licence_name": "CC BY 4.0",
            "licence_url": "https://creativecommons.org/licenses/by/4.0/",
            "source_url": "https://example.org/photo",
            "checked_at": "2026-08-28",
            "display_home": True,
        }
        rights.update(over)
        return rights

    def test_provenance_keys_are_optional_but_always_emitted(self):
        """A record written before the provenance fields existed must still
        build — absent means 'nobody stated a role', which the UI renders with
        its neutral label. Requiring them would have failed the build on all 40
        existing records at once for a value that is legitimately unknown."""
        self.write_article(
            "ex.bg", "20260822-a1-abc.json", image_rights=self._cc_rights()
        )
        proc = self.run_build()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        rights = self.load("articles/ex.bg.json")["articles"][0]["image_rights"]
        for key in ("role", "crop_allowed", "source_article_url",
                    "focal_x", "focal_y"):
            self.assertIn(key, rights)
            self.assertIsNone(rights[key])

    def test_source_photo_must_carry_evidence_on_the_outlet_s_own_domain(self):
        """⚠️ A source_photo caption NAMES A PUBLISHER („От публикацията на
        X"), so the claim has to be checkable rather than asserted. Attributing
        a photograph to an outlet that never published it is the one error in
        this pipeline that cannot be walked back."""
        cases = (
            (None, "requires source_article_url"),
            ("https://other.example/a/1", "is not on"),
            ("https://ex.bg.evil.example/a/1", "is not on"),
        )
        for url, message in cases:
            with self.subTest(url=url):
                self.write_article(
                    "ex.bg", "20260822-a1-abc.json",
                    image_rights=self._cc_rights(
                        role="source_photo", source_article_url=url
                    ),
                )
                proc = self.run_build()
                self.assertNotEqual(proc.returncode, 0)
                self.assertIn(message, proc.stderr)

        # The same role WITH evidence on the outlet's own domain builds, and a
        # subdomain of it counts.
        for url in ("https://ex.bg/a/1", "https://www.ex.bg/a/1"):
            with self.subTest(accepted=url):
                self.write_article(
                    "ex.bg", "20260822-a1-abc.json",
                    image_rights=self._cc_rights(
                        role="source_photo", source_article_url=url
                    ),
                )
                proc = self.run_build()
                self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_every_role_is_exercised(self):
        """`official_image` was in the enum and in no test — an enum member
        nothing renders and nothing checks is indistinguishable from a typo."""
        for role in ("illustration", "official_image"):
            with self.subTest(role=role):
                self.write_article(
                    "ex.bg", "20260822-a1-abc.json",
                    image_rights=self._cc_rights(role=role),
                )
                proc = self.run_build()
                self.assertEqual(proc.returncode, 0, proc.stderr)
                rights = self.load("articles/ex.bg.json")["articles"][0][
                    "image_rights"
                ]
                self.assertEqual(rights["role"], role)
                # Only source_photo demands evidence — the other two make no
                # claim about a publisher.
                self.assertIsNone(rights["source_article_url"])

    def test_source_photo_evidence_refuses_a_url_two_parsers_disagree_on(self):
        """⚠️ `urlparse().hostname` splits the authority on the LAST `@` and
        ignores a backslash, so `https://evil.example\\@ex.bg/a` reports
        `ex.bg` — while WHATWG (every browser) resolves it to `evil.example`.
        The caption would name the outlet and its evidence link would go
        somewhere else entirely."""
        for url in (
            "https://evil.example\\@ex.bg/a",
            "https://evil.example@ex.bg/a",
        ):
            with self.subTest(url=url):
                self.write_article(
                    "ex.bg", "20260822-a1-abc.json",
                    image_rights=self._cc_rights(
                        role="source_photo", source_article_url=url
                    ),
                )
                proc = self.run_build()
                self.assertNotEqual(proc.returncode, 0)
                self.assertIn("is not on", proc.stderr)

    def test_an_unknown_image_rights_key_fails_rather_than_being_dropped(self):
        """The optional provenance keys have no presence check, so a typo would
        otherwise be silently dropped by the whitelist projection — and
        `crop_allowd: false` beside a focal point would publish a focal point
        on a work the reviewer marked un-croppable."""
        self.write_article(
            "ex.bg", "20260822-a1-abc.json",
            image_rights=self._cc_rights(crop_allowd=False, focal_x=0.5),
        )
        proc = self.run_build()
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("unknown image_rights keys: crop_allowd", proc.stderr)

    def test_provenance_fields_reject_nonsense(self):
        cases = (
            ({"role": "photo"}, "invalid image_rights.role"),
            ({"crop_allowed": "yes"}, "crop_allowed must be boolean"),
            ({"source_article_url": "/relative"}, "absolute http(s) URL"),
            ({"focal_x": "middle"}, "focal_x must be a number"),
            # `True` is an int in Python — without the explicit bool guard it
            # would pass the numeric check as 1 and then the 0-1 range check.
            ({"focal_x": True, "crop_allowed": True}, "focal_x must be a number"),
            ({"focal_y": 1.4, "crop_allowed": True}, "focal_y must be a 0-1 fraction"),
            # A focal point says WHERE to crop; on a work we may not adapt
            # there is nothing for it to steer.
            (
                {"focal_x": 0.5, "crop_allowed": False},
                "recorded on an image that may not be cropped",
            ),
            # Not merely "not refused": an unreviewed crop decision must not be
            # settled by the presence of a focal point.
            (
                {"focal_y": 0.5},
                "recorded on an image that may not be cropped",
            ),
        )
        for over, message in cases:
            with self.subTest(over=over):
                self.write_article(
                    "ex.bg", "20260822-a1-abc.json",
                    image_rights=self._cc_rights(**over),
                )
                proc = self.run_build()
                self.assertNotEqual(proc.returncode, 0)
                self.assertIn(message, proc.stderr)

    def test_home_article_drops_only_what_the_home_page_cannot_render(self):
        """`home_article` is the projection; this pins WHICH fields it drops.

        ⚠️ `useHome()` has one consumer, which passes `articles` to one
        function, which reads story_id, image, image_rights, published, domain
        and id — plus image_alt and url for the credit. Nothing on the page
        renders an article's own analysis, title or excerpt; the cards render
        STORIES."""
        import build_app_data as bad
        record = {
            "id": "a1", "domain": "ex.bg", "url": "https://ex.bg/a",
            "published": "2026-08-22T00:00:00+00:00", "story_id": "s1",
            "image": None, "image_alt": None, "image_rights": None,
            "analysis": {"summary_bg": "x"}, "excerpt": "y" * 400,
            "feedback_analysis_sha256": "f" * 64,
        }
        slim = bad.home_article(record)
        self.assertTrue(slim["has_analysis"])
        for dropped in ("analysis", "excerpt", "feedback_analysis_sha256"):
            self.assertNotIn(dropped, slim)
        for kept in ("id", "domain", "url", "published", "story_id",
                     "image", "image_alt", "image_rights"):
            self.assertIn(kept, slim)
        # It projects, it does not mutate — the caller's record is reused for
        # the per-domain bundle, which keeps the full analysis.
        self.assertIsInstance(record["analysis"], dict)
        # An unanalyzed record says so rather than omitting the marker.
        self.assertFalse(bad.home_article({"id": "a2"})["has_analysis"])

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

    def test_home_bundle_requires_analysis_and_strips_uncleared_images(self):
        fixtures = (
            ("cleared.bg", "https://cleared.bg/a", True, True),
            ("raw.bg", "https://raw.bg/a", False, True),
            ("held.bg", "https://held.bg/a", True, False),
        )
        for domain, url, analyzed, display_home in fixtures:
            rights = {
                "status": "cc", "creator": "Автор", "credit_text": "Кредит",
                "credit_url": "https://example.org/photo",
                "licence_name": "CC BY 4.0",
                "licence_url": "https://creativecommons.org/licenses/by/4.0/",
                "source_url": "https://example.org/photo",
                "checked_at": "2026-08-28", "display_home": display_home,
            }
            fname = "20260822-a.json"
            self.write_article(domain, fname, url=url, image_rights=rights)
            if analyzed:
                directory = Path(self.data_dir) / "analysis" / "articles" / domain
                directory.mkdir(parents=True, exist_ok=True)
                (directory / fname).write_text(json.dumps({
                    "domain": domain, "url": url, "summary_bg": "Резюме",
                    "analyzed_at": "2026-08-28T00:00:00+00:00",
                    "quality": {"verdict": "ok", "notes": None},
                    "site_relevant": True,
                    "leaning": {"label": "neutral", "confidence": 0.8},
                    "russia_stance": {"label": "not_applicable", "confidence": 0.8},
                    "ai_generated": {"verdict": "likely_human", "confidence": 0.8},
                    "topics": [{"category": "society", "subcategory": "human-interest",
                                "primary": True}],
                }))
        self.build()
        home = self.load("home.json")
        self.assertEqual(
            home["eligibility"],
            "published_recent_analyzed_with_cleared_images_only",
        )
        self.assertEqual(home["version"], 3)
        self.assertEqual(home["event_dedupe"], "conservative_title_entity_v1")
        # The fixture harness gives every coherent analysis the same resolved
        # singleton membership production requires. Unanalysed raw.bg stays
        # out; the reviewed image survives and the uncleared one is stripped.
        by_domain = {article["domain"]: article for article in home["articles"]}
        self.assertEqual(set(by_domain), {"cleared.bg", "held.bg"})
        self.assertEqual(by_domain["cleared.bg"]["image"],
                         "https://cdn.cleared.bg/lead.jpg")
        self.assertIsNone(by_domain["held.bg"]["image"])
        self.assertLessEqual(len(home["articles"]), HOME_ITEM_LIMIT)
        for story in home["stories"]:
            self.assertEqual(set(story), HOME_STORY_FIELDS)
        self.assertLessEqual(
            home_gzip_size((Path(self.out_dir) / "home.json").read_bytes()),
            HOME_GZIP_BUDGET_BYTES,
        )


    def test_partial_or_cross_article_analysis_never_enters_home(self):
        self.write_article("ex.bg", "20260822-a.json", url="https://ex.bg/a")
        directory = Path(self.data_dir) / "analysis" / "articles" / "ex.bg"
        directory.mkdir(parents=True)
        (directory / "20260822-a.json").write_text(json.dumps({
            "domain": "other.bg", "url": "https://ex.bg/a", "summary_bg": "Резюме",
        }))
        self.build()
        self.assertEqual(self.load("home.json")["articles"], [])

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

    def test_the_feed_budget_fails_when_exceeded(self):
        """The hourly uploader must not publish an oversized hot feed."""
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
        self.assertNotEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("over the", proc.stderr)
        self.assertIn("PAGINATE", proc.stderr)

    def test_latest_must_be_positive(self):
        proc = subprocess.run(
            [sys.executable, SCRIPT, "--data-dir", self.data_dir,
             "--out", self.out_dir, "--latest", "0", "--quiet"],
            capture_output=True, text=True,
            env=dict(os.environ, DATA_BG_ROOT=self.root))
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("--latest must be positive", proc.stderr)

    def test_commons_publication_boundary_requires_thumbnail_and_identity(self):
        rights = {
            "status": "cc", "display_home": True,
            "licence_name": "CC BY 4.0",
            "licence_url": "https://creativecommons.org/licenses/by/4.0/",
            "source_url": "https://commons.wikimedia.org/wiki/File:A.jpg",
            "credit_url": "https://commons.wikimedia.org/wiki/File:A.jpg",
        }
        thumb = (
            "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/"
            "A.jpg/960px-A.jpg"
        )
        validate_display_image(thumb, rights, article="ex.bg/a.json")
        with self.assertRaisesRegex(ValueError, "requires an image URL"):
            validate_display_image(None, rights, article="ex.bg/a.json")
        with self.assertRaisesRegex(ValueError, "<=960px derivative"):
            validate_display_image(
                "https://upload.wikimedia.org/wikipedia/commons/a/ab/A.jpg",
                rights, article="ex.bg/a.json")
        bad = dict(rights, licence_url="https://example.org/fake")
        with self.assertRaisesRegex(ValueError, "mismatched CC licence"):
            validate_display_image(thumb, bad, article="ex.bg/a.json")
        wrong_file = dict(
            rights,
            source_url="https://commons.wikimedia.org/wiki/File:B.jpg",
        )
        with self.assertRaisesRegex(ValueError, "attribution file must match"):
            validate_display_image(thumb, wrong_file, article="ex.bg/a.json")
        wrong_credit = dict(
            rights,
            credit_url="https://commons.wikimedia.org/wiki/File:B.jpg",
        )
        with self.assertRaisesRegex(ValueError, "attribution file must match"):
            validate_display_image(thumb, wrong_credit, article="ex.bg/a.json")

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
            analysis_dir = os.path.join(
                self.data_dir, "analysis", "articles", dom)
            os.makedirs(analysis_dir, exist_ok=True)
            with open(os.path.join(analysis_dir, "20260822-a1-abc.json"), "w",
                      encoding="utf-8") as fh:
                json.dump({
                    "domain": dom, "url": f"https://{dom}/a/1",
                    "article_path": f"news/data/{dom}/20260822-a1-abc.json",
                    "published": "2026-08-22T09:00:00+00:00",
                    "summary_bg": "Резюме", "summary_en": "Summary",
                    "leaning": {"label": "neutral", "confidence": 0.7,
                                "evidence": "Неутрално."},
                    "russia_stance": {"label": "not_applicable", "confidence": 0.7,
                                       "evidence": "Не се отнася."},
                    "ai_generated": {"verdict": "likely_human", "confidence": 0.7,
                                     "signals": []},
                    "entities": {"people": [], "parties": [], "institutions": [],
                                 "companies": [], "places": []},
                    "party_tones": [], "topics": [{
                        "category": "society", "subcategory": "human-interest",
                        "primary": True,
                    }],
                    "quality": {"verdict": "ok", "notes": None},
                    "site_relevant": True, "model": "test", "analyzed_at": "now",
                }, fh, ensure_ascii=False)
        index_path = os.path.join(self.data_dir, "analysis", "index.json")
        with open(index_path, "w", encoding="utf-8") as fh:
            json.dump({"articles": {
                "https://fast.bg/a/1": {"story_id": "s1"},
                "https://slow.bg/a/1": {"story_id": "s1"},
            }}, fh)
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


class TopicSpread(unittest.TestCase):
    """The per-topic disagreement measure behind /topics.

    ⚠️ Every assertion here guards a rule that fails SILENTLY. A spread
    computed over not_applicable verdicts is 0.0, which reads as "every
    outlet agrees" — the exact opposite of "nobody took a position". And a
    spread computed over an article's SECONDARY topics lets one piece move
    three topics' numbers at once.
    """

    def spread(self, counts, axis="leaning"):
        return axis_spread(counts, axis)

    def test_one_side_only_is_zero(self):
        self.assertEqual(
            self.spread({"progressive": 8})["spread"], 0.0)

    def test_the_two_extremes_is_two(self):
        self.assertEqual(
            self.spread({"strong_progressive": 5,
                         "strong_conservative": 5})["spread"], 2.0)

    def test_a_near_miss_scores_below_a_real_split(self):
        # ⚠️ ORDINAL, not categorical. strong_progressive vs progressive is a
        # near miss; strong_progressive vs strong_conservative is a real
        # disagreement. Entropy scores those two the same, which is why this
        # is a standard deviation over -2..+2 and not an entropy.
        near = self.spread({"strong_progressive": 5, "progressive": 5})
        real = self.spread({"strong_progressive": 5, "strong_conservative": 5})
        self.assertEqual(near["spread"], 0.5)
        self.assertLess(near["spread"], real["spread"])

    def test_not_applicable_is_excluded_not_counted_as_centre(self):
        # ⚠️ THE defect this guards. not_applicable is the MAJORITY verdict
        # (90% of leaning calls), and it is not a position. Counting it as
        # neutral would pull every topic's spread toward 0 in proportion to
        # how little anyone said — i.e. the quietest topics would look like
        # the most unanimous ones.
        with_na = self.spread({"strong_progressive": 5,
                               "strong_conservative": 5,
                               "not_applicable": 500})
        without = self.spread({"strong_progressive": 5,
                               "strong_conservative": 5})
        self.assertEqual(with_na["spread"], without["spread"])
        self.assertEqual(with_na["n"], 10)

    def test_an_unknown_label_is_ignored_not_crashed_on(self):
        # A model emitting a label outside the scale must not take the build
        # down, and must not be scored as if it were on it.
        self.assertEqual(self.spread({"progressive": 4, "bogus": 9})["n"], 4)

    def test_fewer_than_two_positions_has_no_spread(self):
        # ⚠️ A single article has a standard deviation of exactly 0.0, which
        # renders as "total agreement" about a topic one person wrote about.
        # None is the only honest answer.
        self.assertIsNone(self.spread({"progressive": 1})["spread"])
        self.assertIsNone(self.spread({})["spread"])
        self.assertEqual(self.spread({})["n"], 0)

    def test_the_floor_is_reported_never_silently_applied(self):
        # The consumer needs `n` and `enough` beside the number: a spread of
        # 1.4 over four articles and one over four hundred are different
        # claims and look identical as a bare float.
        few = self.spread({"progressive": 2, "conservative": 2})
        self.assertFalse(few["enough"])
        many = self.spread({"progressive": TOPIC_MIN_POSITIONED})
        self.assertTrue(many["enough"])
        self.assertEqual(many["n"], TOPIC_MIN_POSITIONED)

    def test_a_negative_count_is_refused_rather_than_subtracted(self):
        # Tolerating this would let a malformed input REDUCE a sample size,
        # so a topic could report `enough` from fewer articles than it has.
        with self.assertRaises(ValueError):
            self.spread({"progressive": 5, "conservative": -3})

    def test_an_unknown_axis_raises_rather_than_returning_empty(self):
        # "this axis has no positions" and "you asked for an axis that does
        # not exist" are different answers; only the second is a caller bug,
        # and returning the first for it hides it for ever.
        with self.assertRaises(KeyError):
            self.spread({"progressive": 5}, "tone")

    def test_none_and_zero_counts_are_tolerated(self):
        self.assertEqual(axis_spread(None, "leaning")["n"], 0)
        self.assertEqual(self.spread({"progressive": None})["n"], 0)
        self.assertEqual(self.spread({"progressive": 0})["n"], 0)

    def test_a_zero_variance_never_returns_a_complex_number(self):
        # The count-based form computes E[x²] − E[x]², which can land a hair
        # below zero on exact agreement — and a negative ** 0.5 in Python is
        # COMPLEX, not an error, so it would ship as "(0.0+0j)" in JSON.
        got = self.spread({"conservative": 1000})["spread"]
        self.assertIsInstance(got, float)
        self.assertEqual(got, 0.0)

    def test_the_floor_is_the_same_number_the_client_uses(self):
        # ⚠️ Written twice, in two languages. A server floor of 20 against a
        # client floor of 30 renders a spread the page's own caption calls
        # insufficient — or withholds one it published.
        ts = (Path(__file__).resolve().parents[2] / "newsapp" / "app"
              / "data.ts").read_text(encoding="utf-8")
        m = re.search(r"TOPIC_MIN_POSITIONED\s*=\s*(\d+)", ts)
        self.assertIsNotNone(m, "TOPIC_MIN_POSITIONED not found in data.ts")
        self.assertEqual(int(m.group(1)), TOPIC_MIN_POSITIONED)

    def test_the_axis_scales_are_the_same_ones_the_client_draws(self):
        # The spread's positions and the bar's segment order must cover the
        # same label set, or the bar draws a verdict the number ignores.
        labels = (Path(__file__).resolve().parents[2] / "newsapp" / "app"
                  / "labels.ts").read_text(encoding="utf-8")
        for axis, const in (("leaning", "LEANING_ORDER"),
                            ("russia_stance", "RUSSIA_ORDER")):
            block = re.search(const + r"[^=]*=\s*\[(.*?)\]", labels, re.S)
            self.assertIsNotNone(block, const)
            found = set(re.findall(r'"([a-z_]+)"', block.group(1)))
            self.assertEqual(found, set(AXIS_POSITIONS[axis]),
                             f"{const} and AXIS_POSITIONS[{axis!r}] disagree")

    def test_the_russia_axis_uses_its_own_scale(self):
        # The two axes have DIFFERENT label sets. Scoring a Russia verdict
        # against the leaning positions would drop every one of them.
        self.assertEqual(
            self.spread({"strong_pro_russia": 5, "strong_anti_russia": 5},
                        "russia_stance")["spread"], 2.0)
        self.assertEqual(
            self.spread({"strong_pro_russia": 5}, "leaning")["n"], 0)


class TopicDistributions(BuildAppDataFixture):
    """What reaches taxonomy.json — measured through the real script."""

    def article_with(self, domain, fname, *, leaning, topics):
        url = f"https://{domain}/a/{fname}"
        self.write_corpus(domain, fname,
                          corpus_article(domain, fname, url, "Заглавие",
                                         "2026-08-22T00:00:00+00:00"))
        self.write_analysis(domain, fname,
                            self.analysis_record(url, domain,
                                                 f"{domain}/{fname}",
                                                 leaning=leaning,
                                                 topics=topics))

    def cat(self, cat_id):
        return next(c for c in self.load("taxonomy.json")["categories"]
                    if c["id"] == cat_id)

    def test_the_primary_topic_alone_carries_the_verdict(self):
        # ⚠️ An article tagged with three topics is ONE article about its
        # primary subject. Counting it into all three lets a single piece
        # move three topics' spreads at once.
        self.article_with("ex.bg", "20260822-a1-abc.json",
                          leaning="strong_progressive",
                          # ⚠️ The primary topic is deliberately NOT first.
                          # With it first, `next(iter(topics))` and
                          # `next(t for t in topics if t["primary"])` return
                          # the same object, so a fall-back-to-first bug
                          # passes this test with nothing to show for it.
                          topics=[{"category": "healthcare",
                                   "subcategory": None, "primary": False},
                                  {"category": "society",
                                   "subcategory": None, "primary": True}])
        self.run_build()
        self.assertEqual(self.cat("society")["leaning"],
                         {"strong_progressive": 1})
        self.assertEqual(self.cat("healthcare")["leaning"], {})
        # The ARTICLE count still counts both — that is a different question
        # ("what is this about") from "whose position is this".
        self.assertEqual(self.cat("healthcare")["article_count"], 1)

    def test_outlets_are_counted_distinct_not_summed(self):
        for i, dom in enumerate(("ex.bg", "ex.bg", "two.bg")):
            self.article_with(dom, f"20260822-a{i}-abc.json",
                              leaning="progressive",
                              topics=[{"category": "society",
                                       "subcategory": None, "primary": True}])
        self.run_build()
        row = self.cat("society")
        self.assertEqual(row["outlet_count"], 2)
        self.assertEqual(row["leaning"], {"progressive": 3})

    def test_the_spread_rides_along_with_its_sample(self):
        self.article_with("ex.bg", "20260822-a1-abc.json",
                          leaning="strong_progressive",
                          topics=[{"category": "society",
                                   "subcategory": None, "primary": True}])
        self.article_with("two.bg", "20260822-a2-abc.json",
                          leaning="strong_conservative",
                          topics=[{"category": "society",
                                   "subcategory": None, "primary": True}])
        self.run_build()
        got = self.cat("society")["spread"]["leaning"]
        self.assertEqual(got["spread"], 2.0)
        self.assertEqual(got["n"], 2)
        # ⚠️ Below the floor, and it says so. Two articles is not a finding.
        self.assertFalse(got["enough"])

    def test_a_secondary_only_topic_reports_zero_primaries(self):
        # ⚠️ THE state the screen has a third message for. „Управление и
        # кабинет" is tagged on 7 articles and is the MAIN subject of none, so
        # a consumer reading only article_count says „nobody took a position"
        # about a topic nobody was ever asked about.
        self.article_with("ex.bg", "20260822-a1-abc.json",
                          leaning="progressive",
                          topics=[{"category": "society",
                                   "subcategory": None, "primary": True},
                                  {"category": "healthcare",
                                   "subcategory": None, "primary": False}])
        self.run_build()
        sec = self.cat("healthcare")
        self.assertEqual(sec["article_count"], 1)
        self.assertEqual(sec["primary_count"], 0)
        self.assertEqual(sec["outlet_count"], 0)
        main = self.cat("society")
        self.assertEqual(main["primary_count"], 1)
        self.assertEqual(main["article_count"], 1)

    def test_an_out_of_vocabulary_label_never_reaches_the_bundle(self):
        # ⚠️ It is not enough that axis_spread ignores it. The CLIENT counts
        # any label that is not not_applicable as positioned, so a stray
        # „centre-left" in the distribution makes the bar and the sample size
        # disagree about the same topic — and violates the declared TS type.
        self.article_with("ex.bg", "20260822-a1-abc.json",
                          leaning="centre-left",
                          topics=[{"category": "society",
                                   "subcategory": None, "primary": True}])
        self.run_build()
        row = self.cat("society")
        self.assertEqual(row["leaning"], {})
        self.assertEqual(row["spread"]["leaning"]["n"], 0)
        # The article is still counted — the verdict is what was refused.
        self.assertEqual(row["primary_count"], 1)

    def test_a_positioned_article_always_has_a_primary_count(self):
        # ⚠️ The invariant the screen's three-state shortfall rests on: it
        # shows „само като второстепенна тема" when primary_count is 0, so a
        # topic with n > 0 and primary_count 0 would be told nobody wrote
        # about it while its own spread was computed from articles.
        self.article_with("ex.bg", "20260822-a1-abc.json",
                          leaning="progressive",
                          topics=[{"category": "society",
                                   "subcategory": None, "primary": True},
                                  {"category": "healthcare",
                                   "subcategory": None, "primary": False}])
        self.run_build()
        for row in self.load("taxonomy.json")["categories"]:
            for axis in ("leaning", "russia_stance"):
                if row["spread"][axis]["n"] > 0:
                    self.assertGreater(
                        row["primary_count"], 0,
                        f"{row['id']} has positions but no primary articles")

    def test_an_empty_mentions_list_survives_the_bundle(self):
        # ⚠️ THE distinction, and it was untested: `compact_analysis` uses
        # `is not None`, and a truthiness check there survived all 64 tests
        # while silently deleting every empty list. `[]` means the extractor
        # RAN and found nobody; absent means the record predates extraction.
        # Collapsing them publishes „this article mentions nobody" about all
        # 365 analyses on disk.
        self.write_corpus("ex.bg", "20260822-a1-abc.json",
                          corpus_article("ex.bg", "20260822-a1-abc.json",
                                         "https://ex.bg/a/1", "Заглавие",
                                         "2026-08-22T00:00:00+00:00"))
        rec = self.analysis_record("https://ex.bg/a/1", "ex.bg",
                                   "ex.bg/20260822-a1-abc.json")
        rec["mentions"] = []
        self.write_analysis("ex.bg", "20260822-a1-abc.json", rec)
        self.run_build()
        got = self.load("articles/ex.bg.json")["articles"][0]["analysis"]
        self.assertIn("mentions", got)
        self.assertEqual(got["mentions"], [])

    def test_an_absent_mentions_key_stays_absent(self):
        self.write_corpus("ex.bg", "20260822-a1-abc.json",
                          corpus_article("ex.bg", "20260822-a1-abc.json",
                                         "https://ex.bg/a/1", "Заглавие",
                                         "2026-08-22T00:00:00+00:00"))
        self.write_analysis("ex.bg", "20260822-a1-abc.json",
                            self.analysis_record("https://ex.bg/a/1", "ex.bg",
                                                 "ex.bg/20260822-a1-abc.json"))
        self.run_build()
        got = self.load("articles/ex.bg.json")["articles"][0]["analysis"]
        self.assertNotIn("mentions", got)

    def test_a_resolved_mention_reaches_the_bundle_intact(self):
        self.write_corpus("ex.bg", "20260822-a1-abc.json",
                          corpus_article("ex.bg", "20260822-a1-abc.json",
                                         "https://ex.bg/a/1", "Заглавие",
                                         "2026-08-22T00:00:00+00:00"))
        rec = self.analysis_record("https://ex.bg/a/1", "ex.bg",
                                   "ex.bg/20260822-a1-abc.json")
        rec["mentions"] = [
            {"kind": "person", "surface": "Делян Пеевски",
             "basis": "gazetteer_exact", "id": "dp-1", "role": "subject"},
            {"kind": "person", "surface": "Василев",
             "basis": "ambiguous_refused", "id": None, "role": "mention",
             "candidates": ["a", "b"]},
        ]
        self.write_analysis("ex.bg", "20260822-a1-abc.json", rec)
        self.run_build()
        got = self.load("articles/ex.bg.json")["articles"][0]["analysis"]["mentions"]
        # ⚠️ The refused one is CARRIED, not filtered out at the boundary —
        # "we found no link" and "nobody was mentioned" are different claims.
        self.assertEqual(len(got), 2)
        self.assertIsNone(got[1]["id"])
        self.assertEqual(got[1]["candidates"], ["a", "b"])

    def test_ungrounded_tone_is_withheld_without_losing_mention_backlink(self):
        self.write_corpus("ex.bg", "20260822-a1-abc.json",
                          corpus_article("ex.bg", "20260822-a1-abc.json",
                                         "https://ex.bg/a/1", "ГЕРБ обсъжда бюджет",
                                         "2026-08-22T00:00:00+00:00"))
        rec = self.analysis_record("https://ex.bg/a/1", "ex.bg",
                                   "ex.bg/20260822-a1-abc.json")
        rec["entities"]["parties"] = ["ГЕРБ"]
        rec["mentions"] = [{
            "kind": "party", "surface": "ГЕРБ", "basis": "gazetteer_exact",
            "id": "gerb", "role": "subject",
        }]
        rec["party_tones"] = [{
            "party": "ГЕРБ", "party_id": "gerb", "tone": "favorable",
            "confidence": 0.95, "evidence": "Несъществуваща похвала за партията",
            "evidence_grounded": False,
        }]
        self.write_analysis("ex.bg", "20260822-a1-abc.json", rec)
        self.run_build()
        got = self.load("articles/ex.bg.json")["articles"][0]["analysis"]
        self.assertEqual(got["party_tones"], [])
        self.assertEqual(got["mentions"][0]["id"], "gerb")

    def test_current_and_legacy_grounded_tones_reach_the_bundle(self):
        evidence = "ГЕРБ получи подкрепа за бюджета"
        for suffix, current in (("current", True), ("legacy", False)):
            fname = f"20260822-{suffix}-abc.json"
            url = f"https://ex.bg/a/{suffix}"
            article = corpus_article("ex.bg", fname, url, "Бюджет",
                                     "2026-08-22T00:00:00+00:00")
            article["content"] = f"Увод. {evidence}. Заключение."
            self.write_corpus("ex.bg", fname, article)
            rec = self.analysis_record(url, "ex.bg", f"ex.bg/{fname}")
            rec["party_tones"] = [{
                "party": "ГЕРБ", "party_id": "gerb", "tone": "favorable",
                "confidence": 0.9, "evidence": evidence,
            }]
            if current:
                rec["party_tone_evidence_gate_version"] = 1
                rec["party_tones"][0]["evidence_grounded"] = True
            self.write_analysis("ex.bg", fname, rec)
        self.run_build()
        rows = self.load("articles/ex.bg.json")["articles"]
        self.assertEqual([len(row["analysis"]["party_tones"]) for row in rows],
                         [1, 1])

    def test_stale_true_gate_is_rechecked_and_negation_is_withheld(self):
        fname = "20260822-stale-abc.json"
        url = "https://ex.bg/a/stale"
        article = corpus_article("ex.bg", fname, url, "Бюджет",
                                 "2026-08-22T00:00:00+00:00")
        article["content"] = "ГЕРБ не получи подкрепа за бюджета."
        self.write_corpus("ex.bg", fname, article)
        rec = self.analysis_record(url, "ex.bg", f"ex.bg/{fname}")
        rec["mentions"] = [{
            "kind": "party", "surface": "ГЕРБ", "basis": "gazetteer_exact",
            "id": "gerb", "role": "subject",
        }]
        rec["party_tone_evidence_gate_version"] = 0
        rec["party_tones"] = [{
            "party": "ГЕРБ", "party_id": "gerb", "tone": "favorable",
            "confidence": 0.9, "evidence": "ГЕРБ получи подкрепа за бюджета",
            "evidence_grounded": True,
        }]
        self.write_analysis("ex.bg", fname, rec)
        self.run_build()
        got = self.load("articles/ex.bg.json")["articles"][0]["analysis"]
        self.assertEqual(got["party_tones"], [])
        self.assertEqual(got["mentions"][0]["id"], "gerb")

    def test_a_topic_nobody_wrote_about_is_empty_not_absent(self):
        # An untouched category must still carry the keys, with n=0 — a
        # missing key and "nobody took a position" are different, and a
        # consumer reading `undefined` renders neither.
        self.article_with("ex.bg", "20260822-a1-abc.json",
                          leaning="progressive",
                          topics=[{"category": "society",
                                   "subcategory": None, "primary": True}])
        self.run_build()
        row = self.cat("healthcare")
        self.assertEqual(row["leaning"], {})
        self.assertEqual(row["outlet_count"], 0)
        self.assertEqual(row["primary_count"], 0)
        self.assertEqual(row["spread"]["leaning"],
                         {"spread": None, "n": 0, "enough": False})



class HomePayloadSelection(unittest.TestCase):
    def story(self, idx, *, outlets=1, published=None, title_bg="Заглавие"):
        return {
            "id": f"s{idx:02d}", "title_bg": title_bg,
            "title_en": f"English {idx}", "summary_bg": "Резюме",
            "summary_en": f"Summary {idx}",
            "last_published": published or f"2026-08-{idx + 1:02d}T00:00:00+00:00",
            "topics": [], "aggregates": {
                "article_count": max(2, outlets), "outlet_count": outlets,
                "by_leaning": {}, "by_russia_stance": {}, "by_domain": {},
            },
            "members": ["must not reach home.json"],
        }

    def article(self, story_id, idx, published):
        return {
            "id": f"a{idx:03d}", "domain": f"d{idx:03d}.bg",
            "story_id": story_id, "published": published,
        }

    def test_caps_are_stable_newest_first_and_have_no_orphans(self):
        stories = [self.story(i) for i in range(HOME_STORY_LIMIT + 1)]
        stories[0] = self.story(
            0, outlets=5, published="2026-08-01T00:00:00+00:00"
        )
        articles = [
            self.article(story["id"], i, story["last_published"])
            for i, story in enumerate(stories)
        ]
        articles.extend(
            self.article(stories[-1]["id"], i, "2026-08-31T00:00:00+00:00")
            for i in range(100, 170)
        )
        got_articles, got_stories, proposals = select_home_payload(articles, stories)
        self.assertEqual(len(got_stories), HOME_STORY_LIMIT)
        self.assertEqual(got_stories[0]["id"], stories[-1]["id"])
        self.assertNotIn("s00", {story["id"] for story in got_stories})
        self.assertLessEqual(len(got_articles), HOME_ITEM_LIMIT)
        selected = {story["id"] for story in got_stories}
        self.assertEqual({row["story_id"] for row in got_articles}, selected)
        self.assertTrue(all(set(story) == HOME_STORY_FIELDS for story in got_stories))
        self.assertEqual(proposals, [])

    def test_iso_offsets_rank_as_instants_and_english_fallback_survives(self):
        older = self.story(
            1, published="2026-08-28T10:30:00+03:00", title_bg=None
        )
        newer = self.story(2, published="2026-08-28T08:00:00+00:00")
        articles = [
            self.article(older["id"], 1, older["last_published"]),
            self.article(newer["id"], 2, newer["last_published"]),
        ]
        _, got, _ = select_home_payload(articles, [older, newer])
        self.assertEqual([row["id"] for row in got], [newer["id"], older["id"]])
        self.assertIsNone(got[1]["title_bg"])
        self.assertEqual(got[1]["title_en"], "English 1")
        self.assertEqual(got[1]["summary_en"], "Summary 1")

    def test_a_cleared_image_is_the_story_representative_even_when_older(self):
        item = self.story(1)
        text = self.article(item["id"], 1, "2026-08-28T10:00:00+00:00")
        text["image"] = None
        cleared = self.article(item["id"], 2, "2026-08-28T09:00:00+00:00")
        cleared["image"] = "https://upload.wikimedia.org/photo.jpg"
        cleared["image_rights"] = {"display_home": True}
        got, _, _ = select_home_payload([text, cleared], [item])
        self.assertEqual(got[0]["id"], cleared["id"])

    def test_home_emits_a_merge_proposal_and_one_card_for_a_strong_event_match(self):
        first = self.story(
            1,
            published="2026-08-31T06:00:00+00:00",
            title_bg="Андрей Гюров обявява на 31 август дали ще се кандидатира за президент",
        )
        second = self.story(
            2,
            published="2026-08-31T05:00:00+00:00",
            title_bg="Андрей Гюров казва на 31 август дали ще се кандидатира за президент",
        )
        for item in (first, second):
            item["topics"] = [{
                "category": "politics", "subcategory": "elections", "primary": True,
            }]
            item["entities"] = {
                "people": ["Андрей Гюров"], "parties": [], "institutions": [],
                "companies": [], "places": [],
            }
        articles = [
            self.article(first["id"], 1, first["last_published"]),
            self.article(second["id"], 2, second["last_published"]),
        ]
        _, selected, proposals = select_home_payload(articles, [first, second])
        self.assertEqual([item["id"] for item in selected], [first["id"]])
        self.assertEqual(proposals[0]["keeper_story_id"], first["id"])
        self.assertEqual(proposals[0]["candidate_story_id"], second["id"])

    def test_duplicates_do_not_hide_later_unique_stories(self):
        duplicates = []
        for idx in range(64):
            item = self.story(
                idx,
                published="2026-08-31T06:00:00+00:00",
                title_bg="Еднакво важно събитие с напълно еднакво заглавие",
            )
            duplicates.append(item)
        unique = [
            self.story(
                100 + idx,
                published="2026-08-31T05:00:00+00:00",
                title_bg=f"Самостоятелна тема номер {100 + idx} различен казус",
            )
            for idx in range(20)
        ]
        candidates = duplicates + unique
        articles = [
            self.article(item["id"], idx, item["last_published"])
            for idx, item in enumerate(candidates)
        ]
        _, selected, _ = select_home_payload(articles, candidates)
        self.assertEqual(len(selected), HOME_STORY_LIMIT)
        self.assertEqual(selected[0]["id"], duplicates[0]["id"])
        self.assertEqual(len({item["title_bg"] for item in selected}), HOME_STORY_LIMIT)

    def test_wire_measurement_matches_documented_gzip_level(self):
        payload = b"home payload " * 1000
        self.assertEqual(
            home_gzip_size(payload),
            len(gzip.compress(payload, compresslevel=6)),
        )


class WithholdsAlteredNames(unittest.TestCase):
    """⚠️ A VALIDATOR IS NOT RETROACTIVE. Five records written before the
    name rule existed carry „Антон Славев" / „Кая Каллас", and the build is
    the last thing between them and a published page."""

    def setUp(self):
        import build_app_data
        self.b = build_app_data
        self.article = {"title": "", "description": "",
                        "content": "Антон Славчев подаде оставка. " * 10}
        self.ents = {"people": ["Антон Славев", "Иван Христанов"],
                     "parties": [], "institutions": [], "companies": [],
                     "places": []}

    def test_the_altered_name_is_dropped_and_the_good_one_kept(self):
        bad = self.b.altered_names(self.ents, [self.article])
        out = self.b.verified_entities(self.ents, bad)
        self.assertEqual(out["people"], ["Иван Христанов"])

    def test_it_is_WITHHELD_never_corrected(self):
        # ⚠️ The near-token is what the SEARCH found, not what the model
        # meant. Rewriting „Славев" to „Славчев" is the graded guess this
        # project refuses everywhere else.
        bad = self.b.altered_names(self.ents, [self.article])
        out = self.b.verified_entities(self.ents, bad)
        self.assertNotIn("Антон Славчев", out["people"])

    def test_a_leaked_summary_is_withheld_PER_FIELD(self):
        bad = self.b.altered_names(self.ents, [self.article])
        prose = self.b.verified_prose(
            {"summary_bg": "Антон Славев получи обезщетение.",
             "summary_en": "Anton Slavchev got a payout."},
            ("summary_bg", "summary_en"), bad)
        self.assertIsNone(prose["summary_bg"])
        self.assertEqual(prose["summary_en"], "Anton Slavchev got a payout.")

    def test_the_REASON_travels_with_the_withholding(self):
        # ⚠️ Without it the app renders „Липсва резюме на български." — the
        # generic upstream-defect note — so a deliberate refusal reads as
        # breakage. The code is machine-readable; the wording is the app's.
        bad = self.b.altered_names(self.ents, [self.article])
        prose = self.b.verified_prose(
            {"summary_bg": "Антон Славев получи обезщетение."},
            ("summary_bg",), bad)
        self.assertEqual(prose["_withheld"],
                         {"summary_bg": self.b.WITHHELD_ALTERED_NAME})

    def test_no_withholding_carries_NO_reason_key_at_all(self):
        # ⚠️ Absent, never an empty map: „we published everything" and „we
        # checked nothing" must not be the same value.
        bad = self.b.altered_names(self.ents, [self.article])
        prose = self.b.verified_prose(
            {"summary_en": "Anton Slavchev got a payout."},
            ("summary_en",), bad)
        self.assertNotIn("_withheld", prose)

    def test_a_clean_record_is_returned_UNTOUCHED(self):
        clean = {"people": ["Иван Христанов"], "parties": [],
                 "institutions": [], "companies": [], "places": []}
        bad = self.b.altered_names(clean, [self.article])
        self.assertEqual(bad, [])
        self.assertIs(self.b.verified_entities(clean, bad), clean)
        # ⚠️ The prose arm still RUNS with `bad` empty — a corrected entity
        # block must not switch it off — so it returns the fields unchanged
        # and no `_withheld` key, rather than an empty dict.
        out = self.b.verified_prose({"summary_bg": "Славчев подаде оставка."},
                                    ("summary_bg",), bad, clean,
                                    [self.article])
        self.assertEqual(out["summary_bg"], "Славчев подаде оставка.")
        self.assertNotIn("_withheld", out)

    def test_a_stale_summary_is_caught_after_the_ENTITIES_are_fixed(self):
        # ⚠️⚠️ THE HOLE THIS CLOSES. Once a re-analysis corrected
        # `entities.people`, the prose arm — scoped to the tokens the entity
        # check proved — stopped examining the summary, and story
        # 20260822-ed7347ac shipped „Каллас" while its own entities read
        # „Кая Калас". The record disagreed with itself and every check
        # passed.
        fixed = {"people": ["Кая Калас"], "parties": [], "institutions": [],
                 "companies": [], "places": []}
        texts = [{"content": "Кая Калас обвини Русия. " * 10}]
        bad = self.b.altered_names(fixed, texts)
        self.assertEqual(bad, [], "the entities are correct")
        out = self.b.verified_prose({"summary_bg": "Каллас обвини Русия."},
                                    ("summary_bg",), bad, fixed, texts)
        self.assertIsNone(out["summary_bg"])
        self.assertEqual(out["_withheld"],
                         {"summary_bg": self.b.WITHHELD_ALTERED_NAME})

    def test_a_MISSING_article_refuses_nothing(self):
        # ⚠️ No text is not evidence of a bad name — otherwise a story whose
        # corpus files are gone loses its whole cast.
        bad = self.b.altered_names(self.ents, [{}])
        self.assertEqual(bad, [])

    def test_a_name_is_verified_against_EVERY_member_not_the_first(self):
        # A story member that never names him must not refuse a name another
        # member writes in full.
        bad = self.b.altered_names(
            self.ents, [{"content": "Нищо общо. " * 20}, self.article])
        self.assertEqual([n for n, _, _ in bad], ["Антон Славев"])
        good = self.b.altered_names(
            {"people": ["Антон Славчев"]},
            [{"content": "Нищо общо. " * 20}, self.article])
        self.assertEqual(good, [])



class HomeOutletDiversity(unittest.TestCase):
    """One outlet must not be able to take the whole home page.

    Home ranks by `last_published` alone, so an outlet with coarser timestamps
    sorts ahead of everyone publishing in the same hour. Measured 2026-09-02:
    every dir.bg article carries minute `00`, and dir.bg held 15 of 16 slots
    while owning only 15 of the day's 202 stories.
    """

    @staticmethod
    def _story(sid, *domains):
        return {"id": sid, "aggregates": {"by_domain": {d: 1 for d in domains}}}

    def test_a_dominant_outlet_is_capped_and_others_surface(self):
        import build_app_data as bad
        # Enough alternatives exist to honour the cap without a short page.
        events = [self._story(f"d{i}", "dir.bg") for i in range(10)]
        events += [self._story("a1", "actualno.com"), self._story("a2", "actualno.com"),
                   self._story("n1", "nova.bg"), self._story("n2", "nova.bg")]
        picked = bad.diversify_home_outlets(events, 6, 2)
        domains = [next(iter(s["aggregates"]["by_domain"])) for s in picked]
        self.assertEqual(len(picked), 6)
        self.assertEqual(domains.count("dir.bg"), 2)
        self.assertEqual(domains.count("actualno.com"), 2)
        self.assertEqual(domains.count("nova.bg"), 2)

    def test_the_backfill_prefers_a_full_page_over_the_cap(self):
        """With no alternatives left, deferred stories return in rank order.

        This is the trade the cap makes deliberately: a page of 6 from one
        outlet beats a page of 4, and the story count must not depend on how
        the day's outlet mix happened to fall.
        """
        import build_app_data as bad
        events = [self._story(f"d{i}", "dir.bg") for i in range(10)]
        events += [self._story("a1", "actualno.com"), self._story("n1", "nova.bg")]
        picked = bad.diversify_home_outlets(events, 6, 2)
        domains = [next(iter(s["aggregates"]["by_domain"])) for s in picked]
        self.assertEqual(len(picked), 6)
        self.assertEqual(domains.count("dir.bg"), 4)
        self.assertIn("actualno.com", domains)
        self.assertIn("nova.bg", domains)

    def test_a_multi_outlet_story_is_never_capped(self):
        """The comparison story is the product; the cap must not hold it back."""
        import build_app_data as bad
        events = [self._story(f"m{i}", "dir.bg", "nova.bg") for i in range(5)]
        picked = bad.diversify_home_outlets(events, 5, 1)
        self.assertEqual(len(picked), 5)

    def test_the_cap_DEFERS_and_never_publishes_a_shorter_page(self):
        """A day genuinely dominated by one outlet still fills every slot."""
        import build_app_data as bad
        events = [self._story(f"d{i}", "dir.bg") for i in range(8)]
        picked = bad.diversify_home_outlets(events, 6, 2)
        self.assertEqual(len(picked), 6)
        self.assertEqual([s["id"] for s in picked],
                         ["d0", "d1", "d2", "d3", "d4", "d5"])

    def test_rank_order_is_preserved_within_what_the_cap_allows(self):
        import build_app_data as bad
        events = [self._story("d0", "dir.bg"), self._story("a0", "actualno.com"),
                  self._story("d1", "dir.bg"), self._story("n0", "nova.bg")]
        picked = bad.diversify_home_outlets(events, 3, 1)
        self.assertEqual([s["id"] for s in picked], ["d0", "a0", "n0"])

    def test_selection_actually_routes_through_the_cap(self):
        """Mutation guard: the cap must reach the real selection path.

        It reaches it INDIRECTLY — select_home_payload calls
        select_home_stories, which applies the cap — so the guard follows the
        whole chain. Asserting only the outer call would pass on a
        select_home_stories that had quietly stopped capping.
        """
        import build_app_data as bad
        self.assertLessEqual(bad.HOME_MAX_STORIES_PER_OUTLET, bad.HOME_STORY_LIMIT)
        outer = inspect.getsource(bad.select_home_payload)
        self.assertIn("select_home_stories", outer)
        self.assertIn("HOME_MAX_STORIES_PER_OUTLET", outer)
        self.assertIn("diversify_home_outlets",
                      inspect.getsource(bad.select_home_stories))



class HomeComparisonSlots(unittest.TestCase):
    """Multi-outlet stories must survive a recency-ranked page.

    The analyser emits singletons, so every fresh batch is single-outlet and
    outranks the comparisons. Measured 2026-09-02 right after 85 merges
    landed: 68 multi-outlet stories existed, 18 inside the 24h window, and
    home showed ZERO.
    """

    @staticmethod
    def _story(sid, *domains):
        return {"id": sid, "aggregates": {"by_domain": {d: 1 for d in domains}}}

    def test_a_comparison_outranked_by_fresh_singletons_still_appears(self):
        import build_app_data as bad
        events = [self._story(f"s{i}", f"o{i}.bg") for i in range(10)]
        events.append(self._story("cmp", "a.bg", "b.bg"))
        picked = bad.select_home_stories(events, 4, 4, 1)
        self.assertIn("cmp", [s["id"] for s in picked])
        # Without the reservation it is rank 11 of 11 and never makes a top-4.
        self.assertNotIn("cmp",
                         [s["id"] for s in bad.diversify_home_outlets(events, 4, 4)])

    def test_the_reservation_changes_WHICH_not_the_ORDER(self):
        """Pinning comparisons to the top would reorder the page around a
        property the reader cannot see."""
        import build_app_data as bad
        events = [self._story("s0", "o0.bg"), self._story("s1", "o1.bg"),
                  self._story("s2", "o2.bg"), self._story("cmp", "a.bg", "b.bg")]
        picked = bad.select_home_stories(events, 4, 4, 1)
        self.assertEqual([s["id"] for s in picked], ["s0", "s1", "s2", "cmp"])

    def test_a_day_with_no_comparison_selects_what_the_cap_alone_would(self):
        """Same stories -- and, unlike the cap alone, in rank order.

        `diversify_home_outlets` appends its deferred backfill at the END, so
        a capped day could emit a page that was not newest-first. Reserving
        re-sorts, which closes that. The live page has never shown it (there
        have always been enough outlets to avoid the backfill), so this pins a
        latent wart rather than reporting a visible one.
        """
        import build_app_data as bad
        events = [self._story(f"s{i}", "dir.bg") for i in range(6)]
        events += [self._story("a", "actualno.com"), self._story("n", "nova.bg")]
        reserved = [s["id"] for s in bad.select_home_stories(events, 5, 2, 4)]
        capped = [s["id"] for s in bad.diversify_home_outlets(events, 5, 2)]
        self.assertEqual(set(reserved), set(capped))
        rank = [s["id"] for s in events]
        self.assertEqual(reserved, sorted(reserved, key=rank.index))
        self.assertNotEqual(capped, sorted(capped, key=rank.index))

    def test_it_reserves_what_exists_and_never_pads(self):
        import build_app_data as bad
        events = [self._story("cmp", "a.bg", "b.bg")]
        events += [self._story(f"s{i}", f"o{i}.bg") for i in range(5)]
        picked = bad.select_home_stories(events, 4, 4, 4)
        self.assertEqual(len(picked), 4)
        self.assertEqual(sum(1 for s in picked if bad.sole_outlet(s) is None), 1)

    def test_the_outlet_cap_still_binds_alongside_the_reservation(self):
        import build_app_data as bad
        events = [self._story("cmp", "a.bg", "b.bg")]
        events += [self._story(f"d{i}", "dir.bg") for i in range(6)]
        events += [self._story("x", "nova.bg"), self._story("y", "fakti.bg")]
        picked = bad.select_home_stories(events, 5, 2, 1)
        sole = [bad.sole_outlet(s) for s in picked]
        self.assertEqual(sole.count("dir.bg"), 2)

    def test_sole_outlet_has_one_definition_used_by_both_rules(self):
        import build_app_data as bad
        self.assertIsNone(bad.sole_outlet(self._story("m", "a.bg", "b.bg")))
        self.assertEqual(bad.sole_outlet(self._story("s", "a.bg")), "a.bg")
        self.assertIsNone(bad.sole_outlet({"id": "e", "aggregates": {}}))

    def test_selection_actually_routes_through_the_reservation(self):
        import build_app_data as bad
        src = inspect.getsource(bad.select_home_payload)
        self.assertIn("select_home_stories", src)
        self.assertIn("HOME_MIN_COMPARISON_STORIES", src)
        self.assertLessEqual(bad.HOME_MIN_COMPARISON_STORIES, bad.HOME_STORY_LIMIT)


class EffectiveStoryReconciliation(unittest.TestCase):
    def test_independent_gate_rejects_a_party_aggregate_mutation(self):
        url = "https://example.bg/member"
        analysis = {
            "url": url, "domain": "example.bg",
            "leaning": {"label": "neutral"},
            "russia_stance": {"label": "not_applicable"},
            "party_tones": [{"party": "Партия А", "tone": "mixed"}],
        }
        story = {"id": "story-1", "members": [{"url": url}]}
        recomputed = {
            "members": [{
                "url": url, "domain": "example.bg", "leaning": "neutral",
                "russia_stance": "not_applicable",
            }],
            "aggregates": {
                "article_count": 1, "outlet_count": 1,
                "by_leaning": {"neutral": 1},
                "by_russia_stance": {"not_applicable": 1},
                "by_party_tone": {"Партия А": {"favorable": 1}},
                "by_domain": {"example.bg": 1},
            },
        }
        with self.assertRaisesRegex(ValueError, "aggregate reconciliation"):
            reconcile_effective_story(story, recomputed, {url: analysis})

class BundleStampIsContentDerived(unittest.TestCase):
    """A per-domain bundle must be byte-stable when its records have not moved.

    ⚠️ Measured 2026-09-20 (`news/evals/publish-baseline-2026-09-20.md`):
    0 of 65 published files were byte-identical between consecutive hourly
    releases, while only 105 of 9,104 article records had changed. Every one
    differed solely because it carried the RUN's timestamp — `taxonomy.json`
    by three bytes — which republished 37.2 MB an hour to convey 584 KB, and
    made content addressing (§7.6 F2) impossible by construction.
    """

    def test_the_same_records_yield_the_same_stamp_across_runs(self):
        records = [{"published": "2026-09-20T07:00:00+00:00"},
                   {"published": "2026-09-20T09:00:00+00:00"}]
        first = build_app_data.bundle_generated_at(records, "RUN-1")
        second = build_app_data.bundle_generated_at(records, "RUN-2")
        self.assertEqual(first, second)
        self.assertNotIn("RUN", first, "the run stamp must not leak in")

    def test_it_takes_the_newest_of_updated_and_published(self):
        self.assertEqual(
            build_app_data.bundle_generated_at(
                [{"published": "2026-09-20T07:00:00+00:00",
                  "updated": "2026-09-20T11:00:00+00:00"}], "RUN"),
            "2026-09-20T11:00:00+00:00")

    def test_a_new_article_moves_the_stamp(self):
        old = [{"published": "2026-09-20T07:00:00+00:00"}]
        new = old + [{"published": "2026-09-20T10:00:00+00:00"}]
        self.assertNotEqual(build_app_data.bundle_generated_at(old, "RUN"),
                            build_app_data.bundle_generated_at(new, "RUN"))

    def test_a_non_string_timestamp_is_ignored_rather_than_compared(self):
        # `max` across mixed types raises; a malformed record must not take
        # the whole build down.
        self.assertEqual(
            build_app_data.bundle_generated_at(
                [{"published": None}, {"published": 17},
                 {"published": "2026-09-20T07:00:00+00:00"}], "RUN"),
            "2026-09-20T07:00:00+00:00")

    def test_it_falls_back_only_when_there_is_no_timestamp_at_all(self):
        for records in ([], None, [{"title": "x"}], ["not a dict"]):
            self.assertEqual(
                build_app_data.bundle_generated_at(records, "RUN"), "RUN",
                records)

    def test_the_bundle_writer_uses_it(self):
        # The helper is only worth having if the call site reads it: the
        # whole defect was the run stamp being written here.
        source = Path(build_app_data.__file__).read_text(encoding="utf-8")
        flat = " ".join(source.split())
        self.assertIn('"generated_at": bundle_generated_at(records, '
                      'generated_at),', flat)


class StoryPagesAndDetails(unittest.TestCase):
    """stories.json is 1,456 KB gzipped and EVERY screen downloads all of it.

    ⚠️ Paging alone does not fix it, which is why the split exists. No
    consumer renders the list: StoryScreen and ArticleScreen `.find()` one
    story by id, SavedScreen builds a lookup map, OutletScreen `.filter()`s
    by domain — so a paged list still needs the page holding the id, i.e.
    up to ten fetches or an index anyway. Measured: StoryScreen 1,456 KB →
    1.4 KB, list screens → 50 KB for the first page.
    """

    def stories(self, n=5):
        return [{"id": f"s{i}", "title_bg": f"Заглавие {i}",
                 "title_en": f"Title {i}", "topics": [],
                 "first_published": f"2026-09-{10+i:02d}T00:00:00+00:00",
                 "last_published": f"2026-09-{10+i:02d}T12:00:00+00:00",
                 "summary_bg": "х" * 500, "summary_en": "y" * 500,
                 "entities": {"people": ["А"]}, "entity_links": [{"a": 1}],
                 "members": [{"url": f"https://x.bg/{i}", "domain": "x.bg",
                              "published": f"2026-09-{10+i:02d}T12:00:00+00:00"}]}
                for i in range(n)]

    def build(self, stories, tmp):
        build_app_data.write_story_pages(Path(tmp), stories, "RUN-STAMP")
        return Path(tmp) / "stories"

    def test_the_pages_cover_every_story_exactly_once(self):
        with tempfile.TemporaryDirectory() as td:
            out = self.build(self.stories(7), td)
            seen = []
            for page in sorted(out.glob("index-*.json")):
                seen += [s["id"] for s in
                         json.loads(page.read_text(encoding="utf-8"))["stories"]]
            self.assertEqual(sorted(seen), [f"s{i}" for i in range(7)])
            self.assertEqual(len(seen), len(set(seen)), "a story on two pages")

    def test_page_one_is_newest_first(self):
        # Progressive reveal means "show me more, older" — page 1 must be
        # the page a reader wants without asking for it.
        with tempfile.TemporaryDirectory() as td:
            out = self.build(self.stories(5), td)
            page = json.loads((out / "index-1.json").read_text(encoding="utf-8"))
            dates = [s["last_published"] for s in page["stories"]]
            self.assertEqual(dates, sorted(dates, reverse=True))

    def test_every_story_gets_a_detail_file_carrying_the_whole_story(self):
        with tempfile.TemporaryDirectory() as td:
            stories = self.stories(3)
            out = self.build(stories, td)
            for story in stories:
                got = json.loads(
                    (out / f"{story['id']}.json").read_text(encoding="utf-8"))
                self.assertEqual(got["story"], story)

    def test_the_index_drops_the_heavy_fields(self):
        # The point of the split: summaries, entities, entity_links and the
        # member records are 72% of stories.json and are needed only when a
        # single story is opened.
        with tempfile.TemporaryDirectory() as td:
            out = self.build(self.stories(3), td)
            row = json.loads(
                (out / "index-1.json").read_text(encoding="utf-8"))["stories"][0]
            for heavy in ("summary_bg", "summary_en", "entities",
                          "entity_links", "members"):
                self.assertNotIn(heavy, row, heavy)
            # …while keeping what a list actually renders.
            for needed in ("id", "title_bg", "member_count", "domains"):
                self.assertIn(needed, row, needed)

    def test_the_url_map_answers_which_story_an_article_is_in(self):
        with tempfile.TemporaryDirectory() as td:
            out = self.build(self.stories(3), td)
            by_url = json.loads(
                (out / "by-url.json").read_text(encoding="utf-8"))["stories_by_url"]
            self.assertEqual(by_url["https://x.bg/1"], "s1")

    def test_a_detail_file_is_byte_stable_across_runs(self):
        # ⚠️ This adds ~1,919 objects per release. Stamping them with the RUN
        # time would rewrite every one every hour to convey nothing — the
        # exact defect `bundle_generated_at` was added to remove, at 30x the
        # scale. Measured on the real corpus: 1,919/1,919 stable.
        stories = self.stories(3)
        with tempfile.TemporaryDirectory() as t1, \
                tempfile.TemporaryDirectory() as t2:
            a = self.build(stories, t1)
            build_app_data.write_story_pages(Path(t2), stories, "A-LATER-RUN")
            b = Path(t2) / "stories"
            for story in stories:
                name = f"{story['id']}.json"
                self.assertEqual((a / name).read_bytes(), (b / name).read_bytes(),
                                 name)

    def test_an_undated_story_still_gets_a_stable_stamp(self):
        # The `nodate-*` family: 183 of 1,919 real stories have a null
        # first_published AND last_published, and members with no
        # `published` either. `first_seen` is the only dated fact they
        # carry; without it they fall back to the run stamp and churn.
        story = {"id": "nodate-1", "first_published": None,
                 "last_published": None,
                 "members": [{"url": "https://x.bg/n", "domain": "x.bg",
                              "published": None,
                              "first_seen": "2026-08-30T23:18:11+00:00"}]}
        with tempfile.TemporaryDirectory() as t1, \
                tempfile.TemporaryDirectory() as t2:
            build_app_data.write_story_pages(Path(t1), [story], "RUN-A")
            build_app_data.write_story_pages(Path(t2), [story], "RUN-B")
            a = (Path(t1) / "stories" / "nodate-1.json").read_bytes()
            b = (Path(t2) / "stories" / "nodate-1.json").read_bytes()
            self.assertEqual(a, b)
            self.assertNotIn(b"RUN-", a, "the run stamp must not leak in")

    def test_a_story_id_that_is_not_a_plain_identifier_is_skipped(self):
        # ⚠️ The id reaches a PATH. Sanitising it silently would break the
        # lookup the file exists for, so it is skipped instead.
        with tempfile.TemporaryDirectory() as td:
            out = self.build([{"id": "../escape", "members": []},
                              {"id": "ok-1", "members": []}], td)
            self.assertTrue((out / "ok-1.json").is_file())
            self.assertFalse((Path(td) / "escape.json").exists())
            self.assertFalse((out.parent / "escape.json").exists())

    def test_an_empty_corpus_still_writes_one_page(self):
        with tempfile.TemporaryDirectory() as td:
            out = self.build([], td)
            page = json.loads((out / "index-1.json").read_text(encoding="utf-8"))
            self.assertEqual(page["stories"], [])
            self.assertEqual(page["pages"], 1)


class FeedbackTargetDeterminism(unittest.TestCase):
    """The registry must be identical for identical data, every process.

    ⚠️ NOT A TIDINESS TEST. `targets_sha256` is what an article feedback
    submission is validated against, so an order that moves for no reason
    can refuse a reader's submission about a registry that did not change.
    It also made `feedback-targets.json` — 1.5 MB — differ on every
    release, which is 1.5 MB of the 1.84 MB first overlay ever built.

    ⚠️ AND IT MUST RUN IN A SEPARATE PROCESS. String hashing is randomised
    per interpreter, so two builds inside THIS process share a seed and
    agree even with the defect present — the test would pass on the bug it
    exists to catch.
    """

    def build_in_subprocess(self, seed: str) -> dict:
        code = (
            "import json,sys;"
            "sys.path.insert(0, 'news/scripts');"
            "from build_feedback_targets import build;"
            "r = build(generated_at='FIXED');"
            "print(json.dumps({'sha': r['targets_sha256'],"
            " 'aliases': [t['aliases'] for t in r['targets']]}))"
        )
        proc = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True, text=True,
            cwd=os.path.dirname(os.path.dirname(os.path.dirname(SCRIPT))),
            env={**os.environ, "PYTHONHASHSEED": seed})
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return json.loads(proc.stdout)

    def test_two_hash_seeds_produce_the_same_registry(self):
        first = self.build_in_subprocess("1")
        second = self.build_in_subprocess("987654")
        self.assertEqual(first["sha"], second["sha"],
                         "the registry hash depends on the hash seed — a "
                         "reader's feedback submission can be refused for a "
                         "registry change that never happened")
        self.assertEqual(first["aliases"], second["aliases"])

    def test_the_key_separates_spellings_that_fold_together(self):
        from build_feedback_targets import alias_sort_key
        variants = ["община Сандански", "Община Сандански", "ОБЩИНА САНДАНСКИ"]
        for order in (variants, list(reversed(variants))):
            self.assertEqual(sorted(set(order), key=alias_sort_key),
                             sorted(variants, key=alias_sort_key))
        # …while still grouping them, which a plain sort would not: the
        # fold is the primary key, so case variants stay adjacent.
        self.assertEqual(
            [alias_sort_key(v)[0] for v in variants],
            [variants[0].casefold()] * 3)


class StampPreservation(unittest.TestCase):
    """A bundle whose content did not change keeps the stamp it had.

    ⚠️ THIS IS WHAT MAKES A HOT RELEASE SMALL, AND THE NUMBER IS THE
    ARGUMENT. Measured 2026-09-20 against the live release, a real overlay
    came to 1.84 MB — of which 1.57 MB was three files carried whole
    because they DIFFERED: feedback-targets.json (1.5 MB), outlets.json
    (43 KB) and taxonomy.json (25 KB). Their content was identical; they
    differed by the run timestamp alone.
    """

    def setUp(self):
        self.temp = tempfile.mkdtemp(prefix="stamp_preservation_")
        self.addCleanup(shutil.rmtree, self.temp, True)
        self.out = Path(self.temp) / "out"
        self.base = Path(self.temp) / "base"
        for directory in (self.out, self.base):
            directory.mkdir(parents=True)

    def put(self, tree, name, payload):
        path = tree / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False),
                        encoding="utf-8")

    def stamps(self, *names):
        return [json.loads((self.out / n).read_text(encoding="utf-8"))
                .get("generated_at") for n in names]

    def test_identical_content_keeps_the_previous_stamp(self):
        self.put(self.base, "taxonomy.json", {"generated_at": "OLD", "t": [1]})
        self.put(self.out, "taxonomy.json", {"generated_at": "NEW", "t": [1]})
        self.assertEqual(
            build_app_data.restore_stable_stamps(self.out, self.base), 1)
        self.assertEqual(self.stamps("taxonomy.json"), ["OLD"])

    def test_changed_content_takes_the_new_stamp(self):
        self.put(self.base, "taxonomy.json", {"generated_at": "OLD", "t": [1]})
        self.put(self.out, "taxonomy.json", {"generated_at": "NEW", "t": [1, 2]})
        build_app_data.restore_stable_stamps(self.out, self.base)
        self.assertEqual(self.stamps("taxonomy.json"), ["NEW"])

    def test_the_group_mechanism_still_works_though_no_group_exists(self):
        # ⚠️ STAMP_GROUPS is EMPTY today: the four consumers that compared
        # two published stamps now read the revision from `home.json`, or
        # check the content hash that already binds the file to the
        # release. The machinery stays because the next genuine pair will
        # need it — and untested machinery is machinery that does not
        # work, so this patches a group in rather than asserting on one.
        for name in ("latest.json", "feedback-targets.json"):
            self.put(self.base, name, {"generated_at": "OLD", "v": 1})
        self.put(self.out, "latest.json", {"generated_at": "NEW", "v": 2})
        self.put(self.out, "feedback-targets.json",
                 {"generated_at": "NEW", "v": 1})
        with mock.patch.object(
                build_app_data, "STAMP_GROUPS",
                (frozenset({"latest.json", "feedback-targets.json"}),)):
            build_app_data.restore_stable_stamps(self.out, self.base)
        self.assertEqual(
            self.stamps("latest.json", "feedback-targets.json"),
            ["NEW", "NEW"], "the group split")

    def test_an_unchanged_file_keeps_its_stamp_independently(self):
        # The consequence of the empty group, and the point of the change:
        # feedback-targets.json is 1.5 MB, and it no longer has to move
        # every time the feed does.
        self.put(self.base, "latest.json", {"generated_at": "OLD", "v": 1})
        self.put(self.base, "feedback-targets.json",
                 {"generated_at": "OLD", "v": 1})
        self.put(self.out, "latest.json", {"generated_at": "NEW", "v": 2})
        self.put(self.out, "feedback-targets.json",
                 {"generated_at": "NEW", "v": 1})
        build_app_data.restore_stable_stamps(self.out, self.base)
        self.assertEqual(
            self.stamps("latest.json", "feedback-targets.json"),
            ["NEW", "OLD"])

    def test_home_and_stats_always_take_the_run_stamp(self):
        # ⚠️ The publish path compares the BUILD'S REPORTED stamp against
        # home's, so preserving home's would need the summary to preserve
        # it too — and a disagreement refuses the release outright.
        for name in ("home.json", "stats.json"):
            self.put(self.base, name, {"generated_at": "OLD", "v": 1})
            self.put(self.out, name, {"generated_at": "NEW", "v": 1})
        build_app_data.restore_stable_stamps(self.out, self.base)
        self.assertEqual(self.stamps("home.json", "stats.json"),
                         ["NEW", "NEW"])

    def test_a_subdirectory_file_is_compared_against_its_own_path(self):
        # ⚠️ `articles/x.json` and `stories/x.json` share a BASENAME.
        # Comparing by name would hand one file the other's stamp — and
        # both parse, so the only symptom is two files quietly asserting a
        # generation time neither has.
        self.put(self.base, "articles/x.json", {"generated_at": "A", "v": 1})
        self.put(self.base, "stories/x.json", {"generated_at": "S", "v": 1})
        self.put(self.out, "articles/x.json", {"generated_at": "NEW", "v": 1})
        self.put(self.out, "stories/x.json", {"generated_at": "NEW", "v": 1})
        build_app_data.restore_stable_stamps(self.out, self.base)
        self.assertEqual(self.stamps("articles/x.json", "stories/x.json"),
                         ["A", "S"])

    def test_a_cold_build_compares_against_its_own_output(self):
        self.put(self.out, "taxonomy.json", {"generated_at": "FIRST", "v": 1})
        # No stamp_from: the file being replaced is the one already there,
        # so a rewrite with identical content is a no-op.
        build_app_data.restore_stable_stamps(self.out, None)
        self.assertEqual(self.stamps("taxonomy.json"), ["FIRST"])

    def test_a_missing_or_unreadable_previous_is_not_an_error(self):
        self.put(self.out, "taxonomy.json", {"generated_at": "NEW", "v": 1})
        self.assertEqual(
            build_app_data.restore_stable_stamps(self.out, self.base), 0)
        (self.base / "taxonomy.json").write_text("{not json", encoding="utf-8")
        self.assertEqual(
            build_app_data.restore_stable_stamps(self.out, self.base), 0)
        self.assertEqual(self.stamps("taxonomy.json"), ["NEW"])

    def test_a_payload_with_no_stamp_is_left_alone(self):
        self.put(self.base, "list.json", [1, 2, 3])
        self.put(self.out, "list.json", [1, 2, 3])
        self.assertEqual(
            build_app_data.restore_stable_stamps(self.out, self.base), 0)

    def test_every_group_member_is_a_file_the_build_writes(self):
        if not build_app_data.STAMP_GROUPS:
            self.skipTest("no groups declared")
        # A group naming a file nothing writes is dead config that reads
        # as protection — and it would make the whole group un-preservable
        # for ever, since a missing member can never be "unchanged".
        written = {p.name for p in
                   (Path(SCRIPT).parent.parent / "app-data").rglob("*.json")}
        if not written:
            self.skipTest("no built app-data tree to check against")
        for group in build_app_data.STAMP_GROUPS:
            for member in group:
                self.assertIn(member, written, member)


class RetiredStories(BuildAppDataFixture):
    """T1.5 — an old bookmarked story URL stays valid, or says why it does not.

    `news/config/retired_stories.json` is the ONLY way a published story id
    may stop being served; the build publishes it as `stories/retired.json`
    and refuses the two contradictions — a retired story still published, a
    merge target that is not.
    """

    def registry(self, retired):
        config = Path(self.root) / "news" / "config"
        config.mkdir(parents=True, exist_ok=True)
        (config / "retired_stories.json").write_text(
            json.dumps({"version": 1, "retired": retired}), encoding="utf-8")

    def seed(self):
        article = {"url": "https://a.bg/one", "domain": "a.bg",
                   "title": "Едно", "published": "2026-09-10T09:00:00+00:00",
                   "first_seen": "2026-09-10T09:00:00+00:00",
                   "content": "Съдържание. " * 30}
        self.write_corpus("a.bg", "one.json", article)
        self.write_analysis("a.bg", "one.json", self.analysis_record(
            article["url"], "a.bg", "news/data/a.bg/one.json",
            action="new_story", story_id=None))

    def test_the_registry_is_published_and_empty_by_default(self):
        self.seed()
        self.run_build()
        payload = self.load("stories/retired.json")
        self.assertEqual(payload["version"], 1)
        self.assertEqual(payload["retired"], {})
        # ⚠️ And it is in the tree the manifest inventories, so the uploader's
        # continuity gate can read it from the snapshot it publishes.
        self.assertTrue(os.path.exists(
            os.path.join(self.out_dir, "stories", "retired.json")))

    def test_a_valid_entry_reaches_the_reader_with_its_reason(self):
        self.seed()
        self.registry({"20200101-deadbeef": {
            "reason": "withdrawn", "on": "2026-09-21",
            "note": "Оттеглена след сигнал за грешно свързване."}})
        self.run_build()
        payload = self.load("stories/retired.json")
        self.assertEqual(payload["retired"]["20200101-deadbeef"]["reason"],
                         "withdrawn")
        self.assertIn("Оттеглена", payload["retired"]["20200101-deadbeef"]["note"])

    def test_a_story_cannot_be_both_retired_and_published(self):
        # ⚠️ THE MUTATION THIS CATCHES: writing the registry without the
        # intersection check — two answers to one URL.
        self.seed()
        self.run_build()
        published = [row[0] for row in
                     self.load("stories/filter-index.json")["stories"]]
        self.registry({published[0]: {"reason": "withdrawn", "on": "2026-09-21",
                                      "note": "n"}})
        proc = self.run_build_process()
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("still publishes", proc.stderr)

    def test_a_merge_target_must_be_published(self):
        self.seed()
        self.registry({"20200101-deadbeef": {
            "reason": "merged", "on": "2026-09-21", "note": "n",
            "target": "20200101-00000000"}})
        ensure_fixture_story_membership(self.data_dir)
        proc = self.run_build_process()
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("merge targets are not published", proc.stderr)

    def test_malformed_entries_are_refused_not_repaired(self):
        cases = [
            ({"x/../y": {"reason": "withdrawn", "on": "2026-09-21", "note": "n"}},
             "unsafe story id"),
            ({"20200101-deadbeef": {"reason": "scandal", "on": "2026-09-21",
                                    "note": "n"}}, "reason must be one of"),
            ({"20200101-deadbeef": {"reason": "withdrawn", "on": "yesterday",
                                    "note": "n"}}, "needs on=YYYY-MM-DD"),
            ({"20200101-deadbeef": {"reason": "withdrawn", "on": "2026-09-21",
                                    "note": " "}}, "needs a note"),
            ({"20200101-deadbeef": {"reason": "merged", "on": "2026-09-21",
                                    "note": "n"}}, "names no target"),
            ({"20200101-deadbeef": {"reason": "withdrawn", "on": "2026-09-21",
                                    "note": "n", "target": "20200101-0000000a"}},
             "carries a target but is not merged"),
        ]
        for retired, message in cases:
            with self.subTest(message=message):
                path = Path(self.root) / "retired.json"
                path.write_text(json.dumps({"version": 1, "retired": retired}),
                                encoding="utf-8")
                with self.assertRaises(ValueError) as caught:
                    bad.load_retired_stories(path)
                self.assertIn(message, str(caught.exception))


class Cases(BuildAppDataFixture):
    """T3.3 — the build attaches cases from the registry, publishes the
    payloads and the review artifact, and WITHHOLDS auto-attach when the
    fixtures do not earn it."""

    DOCS = {
        "case": ("Делото Петрохан", "Прокуратурата по Петрохан продължава. " * 5),
        "case2": ("Петрохан: нови данни", "Прокуратурата по Петрохан. " * 5),
        "road": ("Пътна обстановка", "Проходът Петрохан е затворен за камиони. " * 3),
        "road2": ("Снегопочистване", "По Петрохан има сняг. " * 3),
    }

    def registry(self, fixtures=True, auto_attach=True, flip=None, absent=None):
        bi = {"bg": "б", "en": "b"}
        config = Path(self.root) / "news" / "config"
        config.mkdir(parents=True, exist_ok=True)
        (config / "cases.json").write_text(json.dumps({"version": 1, "cases": [{
            "slug": "petrohan", "name": {"bg": "Петрохан", "en": "Petrohan"},
            "opened_on": "2026-02-13", "rule_version": 1, "reviewer": "t", "reviewed_on": "2026-09-22",
            "description": {"bg": "о", "en": "d"},
            "sources": [{"claim": bi, "url": "https://x/1", "domain": "x", "published": "2026-09-20"}],
            "contested": [], "namesakes": [], "auto_attach": auto_attach, "ambiguous_match": "review",
            "overrides": {"include": [], "exclude": []}, "history": [],
            "rule": {"basis": bi, "required_terms": ["петрохан"], "context_terms": ["прокуратур"],
                     "excluded_terms": []}}]}, ensure_ascii=False), encoding="utf-8")
        evals = Path(self.root) / "news" / "evals"
        evals.mkdir(parents=True, exist_ok=True)
        rows = []
        for slug, (title, body) in self.DOCS.items():
            expected = slug.startswith("case")
            if slug == flip:
                expected = not expected
            rows.append({"article_path": f"news/data/a.bg/{slug if slug != absent else 'gone'}.json",
                         "url": f"https://a.bg/{slug}", "expected": expected, "why": "w",
                         "content_sha256": hashlib.sha256(body.encode("utf-8")).hexdigest()})
        (evals / "case_fixtures.json").write_text(
            json.dumps({"version": 1, "cases": {"petrohan": rows if fixtures else []}}),
            encoding="utf-8")

    def seed(self):
        for slug, (title, body) in self.DOCS.items():
            art = {"url": f"https://a.bg/{slug}", "domain": "a.bg", "title": title,
                   "published": "2026-09-20T09:00:00+00:00", "first_seen": "2026-09-20T09:00:00+00:00",
                   "content": body}
            self.write_corpus("a.bg", f"{slug}.json", art)
            self.write_analysis("a.bg", f"{slug}.json", self.analysis_record(
                art["url"], "a.bg", f"news/data/a.bg/{slug}.json", action="new_story", story_id=None))

    def test_attached_cases_reach_the_stories_the_payload_and_the_review_artifact(self):
        self.seed(); self.registry()
        self.run_build()
        index = self.load("cases.json")
        self.assertEqual(index["cases"][0]["membership"], "attached")
        # The index row carries the description: a register that lists names
        # and counts only says nothing about what the affair is.
        self.assertEqual(index["cases"][0]["description"]["bg"], "о")
        payload = self.load("cases/petrohan.json")
        self.assertEqual(payload["story_count"], 2)
        self.assertEqual({s["supporting"][0]["url"] for s in payload["timeline"]},
                         {"https://a.bg/case", "https://a.bg/case2"})
        stories = self.load("stories.json")["stories"]
        with_case = {s["members"][0]["url"] for s in stories if s.get("case_ids")}
        self.assertEqual(with_case, {"https://a.bg/case", "https://a.bg/case2"})
        self.assertTrue(all(s["case_ids"] == [] for s in stories
                            if s["members"][0]["url"].endswith(("road", "road2"))))
        # The index rows carry it too, so a browse could filter on it.
        rows = self.load("stories/index-1.json")["stories"]
        self.assertEqual(sum(1 for r in rows if r.get("case_ids")), 2)
        review = json.loads((Path(self.root) / "news" / "review" / "case_candidates.json").read_text())
        self.assertEqual(review["counts"]["petrohan"]["matched"], 2)

    def assert_withheld(self, reason):
        payload = self.load("cases/petrohan.json")
        self.assertEqual(payload["membership"], "review")
        self.assertEqual(payload["timeline"], [])
        self.assertEqual(payload["verification"]["reason"], reason)
        self.assertTrue(all(s.get("case_ids") == [] for s in self.load("stories.json")["stories"]))
        # The description still ships: the registry entry is the page.
        self.assertEqual(payload["description"]["bg"], "о")
        return payload

    def test_without_fixtures_auto_attach_is_withheld_and_nothing_is_attached(self):
        # ⚠️ THE MUTATION THIS CATCHES: honouring `auto_attach: true` on the
        # registry's say-so. Registry authorship is not accuracy.
        self.seed(); self.registry(fixtures=False)
        self.run_build()
        self.assert_withheld("no_fixtures")

    def test_a_misclassified_fixture_withholds_and_names_the_article(self):
        self.seed(); self.registry(flip="road")   # the road is now claimed as the affair
        self.run_build()
        payload = self.assert_withheld("fixtures_failed")
        self.assertEqual(payload["verification"]["failed"][0]["url"], "https://a.bg/road")

    def test_an_absent_fixture_article_withholds(self):
        # The standalone host that never saved a fixture article: unverifiable,
        # so nothing is attached there — by design, and pinned end to end.
        self.seed(); self.registry(absent="case")
        self.run_build()
        payload = self.assert_withheld("fixtures_failed")
        self.assertEqual(payload["verification"]["failed"][0]["reason"], "article_absent")

    def test_the_registry_saying_no_withholds_even_when_the_fixtures_pass(self):
        self.seed(); self.registry(auto_attach=False)
        ensure_fixture_story_membership(self.data_dir)
        proc = self.run_build_process()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        payload = self.load("cases/petrohan.json")
        self.assertEqual(payload["membership"], "review")
        self.assertTrue(payload["verification"]["ok"])
        self.assertIn("auto_attach is false", proc.stderr)

    def test_fixtures_are_verified_against_the_corpus_the_build_reads(self):
        # ⚠️ THE MUTATION THIS CATCHES: resolving fixture paths under the REPO
        # instead of `--data-dir`. The corpus is moved to a directory that is
        # NOT <root>/news/data and the repo copy of the articles deleted, so
        # an attach proves the fixtures were read from the build's corpus.
        self.seed(); self.registry()
        ensure_fixture_story_membership(self.data_dir)
        alt = os.path.join(self.root, "elsewhere")
        shutil.copytree(self.data_dir, alt)
        shutil.rmtree(os.path.join(self.data_dir, "a.bg"))
        proc = self.run_build_process("--data-dir", alt)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.load("cases/petrohan.json")["membership"], "attached")


class OneMergeQueue(BuildAppDataFixture):
    """T2.2 — the article-level review sidecar is folded into the ONE
    tracked queue at build time, and home health names both proposal sets."""

    def seed(self):
        docs = {
            "k": ("Прокуратурата обвини бившия министър", "Прокуратурата обвини бившия министър. " * 5),
            "c": ("Обвинение срещу бившия министър", "Обвинение срещу бившия министър беше повдигнато. " * 5),
        }
        for slug, (title, body) in docs.items():
            art = {"url": f"https://a.bg/{slug}", "domain": "a.bg", "title": title,
                   "published": "2026-09-20T09:00:00+00:00", "first_seen": "2026-09-20T09:00:00+00:00",
                   "content": body}
            self.write_corpus("a.bg", f"{slug}.json", art)
            self.write_analysis("a.bg", f"{slug}.json", self.analysis_record(
                art["url"], "a.bg", f"news/data/a.bg/{slug}.json", action="new_story", story_id=None))
        ensure_fixture_story_membership(self.data_dir)

    def stories_by_url(self):
        index = json.loads((Path(self.data_dir) / "analysis" / "index.json").read_text(encoding="utf-8"))
        return {url: e["story_id"] for url, e in index["articles"].items()}

    def test_a_sidecar_proposal_reaches_the_queue_with_its_provenance(self):
        self.seed()
        by_url = self.stories_by_url()
        review = Path(self.root) / "news" / "review"
        review.mkdir(parents=True, exist_ok=True)
        (review / "article_join_proposals.json").write_text(json.dumps({"version": 1, "items": [{
            "id": "article-join-x", "status": "pending", "active": True,
            "article": {"url": "https://a.bg/c"},
            "candidate": {"story_id": by_url["https://a.bg/k"]},
            "channels": ["lede"],
            "evidence": {"mode": "review", "rule_version": "review-v1", "relaxations": ["lede"],
                         "title_jaccard": 0.3}}]}), encoding="utf-8")
        self.run_build_process()
        queue = json.loads((review / "story_merge_queue.json").read_text(encoding="utf-8"))
        folded = [i for i in queue["items"] if i.get("source") == "article_review_channel"]
        self.assertEqual(len(folded), 1)
        self.assertEqual(folded[0]["keeper"]["id"], by_url["https://a.bg/k"])
        self.assertEqual(folded[0]["candidate"]["id"], by_url["https://a.bg/c"])
        self.assertEqual(folded[0]["evidence"]["relaxations"], ["lede"])
        self.assertEqual(folded[0]["status"], "pending")
        home = self.load("home.json")
        counts = home["home_health"]["counts"]
        self.assertEqual(counts["merge_queue_from_article_channel"], 1)
        self.assertGreaterEqual(counts["merge_queue_pending"], 1)
        # The two sets are named apart: the home count is over THIS page.
        self.assertIn("merge_proposals", counts)

    def test_an_unreadable_sidecar_is_skipped_not_a_build_failure(self):
        self.seed()
        review = Path(self.root) / "news" / "review"
        review.mkdir(parents=True, exist_ok=True)
        (review / "article_join_proposals.json").write_text('{"version": 1, "items": [', encoding="utf-8")
        proc = self.run_build_process()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("article_join_proposals.json unreadable", proc.stderr)


class NewsPersonIdentity(BuildAppDataFixture):
    """T4.0 — the build resolves person names against the reviewed registry,
    exports ACTIVE identities only, and queues what did not resolve."""

    T = "2026-09-22T00:00:00Z"

    def registry(self, active=True):
        config = Path(self.root) / "news" / "config"
        config.mkdir(parents=True, exist_ok=True)
        src = {"url": "https://x.bg/s", "domain": "x.bg", "published": "2026-09-20", "supports": "s",
               "reviewer": "r", "reviewed_at": self.T}
        (config / "news_persons.json").write_text(json.dumps({"version": 1, "registry_version": "t1",
            "retired_ids": {}, "persons": [
                {"news_person_id": "np_00000001", "name_bg": "Иван Петров", "name_en": "Ivan Petrov",
                 "status": "active" if active else "pending_review", "created_at": self.T,
                 "reviewed_by": "r" if active else None, "reviewed_at": self.T if active else None,
                 "disambiguation_bg": "д", "disambiguation_en": "d", "identity_sources": [src] if active else [],
                 "aliases": [{"surface": "Иван Петров", "scope": "global", "status": "accepted" if active else "pending_review",
                              "evidence": ["https://x.bg/e"] if active else [], "reviewer": "r" if active else None,
                              "reviewed_at": self.T if active else None, "note": ""}],
                 "verified_main_site_slug": None, "namesakes": [], "history": []}]}, ensure_ascii=False),
            encoding="utf-8")

    def seed(self):
        # Two articles, so an unresolved name RECURS — a name seen once is
        # counted but not listed in the queue.
        for slug in ("p", "q"):
            art = {"url": f"https://a.bg/{slug}", "domain": "a.bg", "title": f"Иван Петров говори {slug}",
                   "published": "2026-09-20T09:00:00+00:00", "first_seen": "2026-09-20T09:00:00+00:00",
                   "content": f"Иван Петров и Георги Димов коментираха {slug}. " * 5}
            self.write_corpus("a.bg", f"{slug}.json", art)
            rec = self.analysis_record(art["url"], "a.bg", f"news/data/a.bg/{slug}.json", action="new_story", story_id=None)
            rec["entities"]["people"] = ["Иван Петров", "Георги Димов"]
            self.write_analysis("a.bg", f"{slug}.json", rec)
        ensure_fixture_story_membership(self.data_dir)

    def test_resolved_names_reach_the_article_and_the_index_and_the_rest_are_queued(self):
        self.seed(); self.registry()
        self.run_build_process()
        index = self.load("news_persons.json")
        self.assertEqual([p["news_person_id"] for p in index["persons"]], ["np_00000001"])
        self.assertEqual(index["persons"][0]["article_count"], 2)
        article = next(a for a in self.load("articles/a.bg.json")["articles"] if a["url"] == "https://a.bg/p")
        rows = {r["surface"]: r for r in article["analysis"]["news_persons"]}
        self.assertEqual(rows["Иван Петров"]["news_person_id"], "np_00000001")
        self.assertEqual(rows["Георги Димов"]["basis"], "not_in_registry")
        self.assertEqual(rows["Георги Димов"]["assessment"], "not_assessed")
        queue = json.loads((Path(self.root) / "news" / "review" / "news_person_candidates.json").read_text(encoding="utf-8"))
        self.assertEqual([i["surface"] for i in queue["items"]], ["Георги Димов"])

    def test_a_pending_identity_never_reaches_the_public_output(self):
        # ⚠️ THE MUTATION THIS CATCHES: exporting or resolving a pending record.
        self.seed(); self.registry(active=False)
        self.run_build_process()
        self.assertEqual(self.load("news_persons.json")["persons"], [])
        article = next(a for a in self.load("articles/a.bg.json")["articles"] if a["url"] == "https://a.bg/p")
        rows = {r["surface"]: r for r in article["analysis"]["news_persons"]}
        self.assertIsNone(rows["Иван Петров"]["news_person_id"])
        queue = json.loads((Path(self.root) / "news" / "review" / "news_person_candidates.json").read_text(encoding="utf-8"))
        by = {i["surface"]: i for i in queue["items"]}
        self.assertEqual(by["Иван Петров"]["pending_identity"], "np_00000001")


class AxisEvidenceProjection(BuildAppDataFixture):
    """T4.1b — a v2 axis label with no located span on its side is WITHHELD on
    the public copy: label null with a named reason, the rationale and spans
    shipped, the member carrying the absence, and no aggregate counting it."""

    def test_an_unsupported_positioned_label_is_withheld_everywhere(self):
        url = "https://example.bg/a1"
        path = "news/data/example.bg/20260822-a1-abc.json"
        self.write_corpus("example.bg", "20260822-a1-abc.json",
                          corpus_article("example.bg", "a1", url, "Заглавие",
                                         "2026-08-22T00:00:00+00:00",
                                         content="Увод. Правителството прокара реформата. Край."))
        rec = self.analysis_record(url, "example.bg", path)
        rec["leaning"] = {"label": "conservative", "confidence": 0.8,
                          "rationale": "Материалът рамкира реформата като необходима.",
                          "evidence_spans": [{"quote": "тази фраза липсва", "field": "body",
                                              "direction": "conservative", "voice": "journalist",
                                              "located": False, "article_content_hash": "x"}],
                          "evidence_grounded": False}
        rec["russia_stance"] = {"label": "anti_russia", "confidence": 0.8,
                                "rationale": "Русия е рамкирана като заплаха.",
                                "evidence_spans": [{"quote": "прокара реформата", "field": "body",
                                                    "direction": "anti_russia", "voice": "journalist",
                                                    "located": True, "start": 21, "end": 38,
                                                    "article_content_hash": "x"}],
                                "evidence_grounded": True}
        import analyze_articles as aa
        rec["axis_evidence_gate_version"] = aa.AXIS_EVIDENCE_VERSION
        self.write_analysis("example.bg", "20260822-a1-abc.json", rec)
        os.makedirs(os.path.join(self.data_dir, "analysis", "stories"), exist_ok=True)
        with open(os.path.join(self.data_dir, "analysis", "index.json"), "w", encoding="utf-8") as fh:
            json.dump({"version": 1, "updated_at": "now", "stories": {
                "20260822-s1": {"member_count": 1, "last_published": "2026-08-22T00:00:00+00:00"}},
                "articles": {url: {"path": path, "story_id": "20260822-s1",
                                   "domain": "example.bg", "analyzed_at": "now"}}}, fh)
        with open(os.path.join(self.data_dir, "analysis", "stories", "20260822-s1.json"), "w",
                  encoding="utf-8") as fh:
            json.dump({
                "id": "20260822-s1", "canonical_title_bg": "Т", "canonical_title_en": "T",
                "summary_bg": "s", "summary_en": "s", "created_at": "now", "topics": [],
                "related_story_ids": [], "first_published": "2026-08-22T00:00:00+00:00",
                "last_published": "2026-08-22T00:00:00+00:00", "entities": {},
                "members": [{"domain": "example.bg", "article_path": path, "url": url,
                             "published": "2026-08-22T00:00:00+00:00",
                             "leaning": "conservative", "russia_stance": "anti_russia",
                             "added_at": "now"}],
                "aggregates": {"article_count": 1, "outlet_count": 1,
                               "by_leaning": {"conservative": 1},
                               "by_russia_stance": {"anti_russia": 1},
                               "by_domain": {"example.bg": 1}},
            }, fh, ensure_ascii=False)
        self.run_build()
        article = self.load("articles/example.bg.json")["articles"][0]["analysis"]
        # ⚠️ THE MUTATION THIS CATCHES: publishing the unsupported label (or a
        # neutral in its place) — the label is null, the reason named, the
        # rationale and the unlocated span still shipped for the reader.
        self.assertIsNone(article["leaning"]["label"])
        self.assertEqual(article["leaning"]["withheld_reason"], "unsupported_evidence")
        self.assertEqual(article["leaning"]["rationale"], "Материалът рамкира реформата като необходима.")
        self.assertIs(article["leaning"]["evidence_spans"][0]["located"], False)
        self.assertEqual(article["russia_stance"]["label"], "anti_russia")
        self.assertIs(article["russia_stance"]["evidence_grounded"], True)
        story = self.load("stories.json")["stories"][0]
        self.assertIsNone(story["members"][0]["leaning"])
        self.assertEqual(story["members"][0]["russia_stance"], "anti_russia")
        self.assertEqual(story["aggregates"]["by_leaning"], {})
        self.assertEqual(story["aggregates"]["leaning_outlets"], 0)
        self.assertEqual(story["aggregates"]["by_russia_stance"], {"anti_russia": 1})
        # ⚠️ THE MUTATION THIS CATCHES: the per-outlet and per-topic
        # distributions reading the RAW label — the withheld label would be
        # absent from the article and the story and still counted on the
        # outlet's spectrum and the topic's axis spread.
        outlet = next(o for o in self.load("outlets.json")["outlets"] if o["domain"] == "example.bg")
        self.assertEqual(outlet["leaning"], {})
        self.assertEqual(outlet["russia_stance"], {"anti_russia": 1})
        category = next(c for c in self.load("taxonomy.json")["categories"] if c["id"] == "society")
        self.assertNotIn("conservative", category["leaning"])
        self.assertEqual(category["russia_stance"].get("anti_russia"), 1)


class PositionedOutletCounts(unittest.TestCase):
    """T5.2 — `leaning_outlets` / `russia_stance_outlets` count distinct
    OUTLETS holding a positioned label, in BOTH independent writers."""

    def analyses(self):
        def rec(url, domain, leaning, russia):
            return {"url": url, "domain": domain, "article_path": f"news/data/{domain}/{url}.json",
                    "leaning": {"label": leaning}, "russia_stance": {"label": russia},
                    "party_tones": [], "entities": {}}
        return {
            "u1": rec("u1", "a.bg", "neutral", "not_applicable"),
            "u2": rec("u2", "a.bg", "progressive", "not_applicable"),   # same outlet, second label
            "u3": rec("u3", "b.bg", "not_applicable", "pro_russia"),
        }

    def test_both_writers_count_outlets_not_labels(self):
        story = {"id": "s", "members": [{"url": u} for u in ("u1", "u2", "u3")]}
        _, expected = bad.expected_story_aggregates(story, self.analyses())
        # ⚠️ THE MUTATION THIS CATCHES: counting labels (2 on leaning) or every
        # assessed outlet including not_applicable (2 on leaning, 2 on Russia).
        self.assertEqual(expected["leaning_outlets"], 1)
        self.assertEqual(expected["russia_stance_outlets"], 1)
        members = [{"url": u, "domain": self.analyses()[u]["domain"], "published": None}
                   for u in ("u1", "u2", "u3")]
        recomputed = bad.recompute_analysis_story(
            {"id": "s", "members": members, "entities": {}}, self.analyses())
        self.assertEqual(recomputed["aggregates"]["leaning_outlets"], 1)
        self.assertEqual(recomputed["aggregates"]["russia_stance_outlets"], 1)
        self.assertEqual(recomputed["aggregates"], expected)

    def test_zero_positioned_two_outlets_and_a_missing_label(self):
        story = {"id": "s", "members": [{"url": u} for u in ("u1", "u2", "u3")]}
        a = self.analyses()
        a["u3"]["leaning"]["label"] = "conservative"          # a genuine spread: a.bg + b.bg
        for rec in a.values():
            rec["russia_stance"]["label"] = "not_applicable"  # nobody positioned
        _, expected = bad.expected_story_aggregates(story, a)
        self.assertEqual(expected["leaning_outlets"], 2)
        self.assertEqual(expected["russia_stance_outlets"], 0)
        members = [{"url": u, "domain": a[u]["domain"], "published": None} for u in a]
        recomputed = bad.recompute_analysis_story(
            {"id": "s", "members": members, "entities": {}}, a)
        self.assertEqual(recomputed["aggregates"], expected)
        # ⚠️ The recompute writer must not count a MISSING label as positioned
        # (the release reconcile refuses such a member before it can ship, so
        # only the writer's own rule can be pinned here).
        a["u3"]["leaning"]["label"] = None
        recomputed = bad.recompute_analysis_story(
            {"id": "s", "members": members, "entities": {}}, a)
        self.assertEqual(recomputed["aggregates"]["leaning_outlets"], 1)


if __name__ == "__main__":
    unittest.main()
