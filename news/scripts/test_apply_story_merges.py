#!/usr/bin/env python3
"""Regression tests for apply_story_merges.py.

Runs the REAL script as a subprocess against a throwaway repository root
(DATA_BG_ROOT), like test_build_app_data.py does, so the module-level path
constants in analyze_articles.py resolve to the fixture and never to the
production corpus.

Run:  python3 news/scripts/test_apply_story_merges.py
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                      "apply_story_merges.py")


def analysis(url, domain, leaning, stance, people):
    return {
        "url": url, "domain": domain,
        "article_path": f"news/data/{domain}/{url.rsplit('/', 1)[-1]}.json",
        "published": "2026-09-02T09:00:00+00:00",
        "leaning": {"label": leaning},
        "russia_stance": {"label": stance},
        "entities": {"people": people, "parties": [], "institutions": [],
                     "companies": [], "places": []},
        "topics": [{"category": "elections-parliamentary", "primary": True}],
        "party_tones": [],
    }


def member(record):
    return {"domain": record["domain"], "article_path": record["article_path"],
            "url": record["url"], "published": record["published"],
            "leaning": record["leaning"]["label"],
            "russia_stance": record["russia_stance"]["label"],
            "added_at": "2026-09-02T09:00:00+00:00"}


def story(sid, title, records, topics=None):
    return {
        "id": sid, "canonical_title_bg": title, "canonical_title_en": title,
        "summary_bg": title, "summary_en": title,
        "created_at": "2026-09-02T09:00:00+00:00",
        "updated_at": "2026-09-02T09:00:00+00:00",
        "topics": topics if topics is not None else [
            {"category": "elections-parliamentary", "primary": True}],
        "related_story_ids": [], "members": [member(r) for r in records],
        "entities": {}, "aggregates": {},
        "first_published": "2026-09-02T09:00:00+00:00",
        "last_published": "2026-09-02T09:00:00+00:00",
    }


class ApplyStoryMerges(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="news_merge_")
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        adir = os.path.join(self.root, "news", "data", "analysis")
        os.makedirs(os.path.join(adir, "stories"))
        os.makedirs(os.path.join(adir, "articles"))
        os.makedirs(os.path.join(self.root, "news", "review"))

        self.a = analysis("https://dir.bg/a1", "dir.bg", "neutral", "neutral",
                          ["Илияна Йотова"])
        self.b = analysis("https://nova.bg/b1", "nova.bg", "progressive",
                          "critical", ["Крум Зарков"])
        self.paths = {}
        for name, rec in (("a1", self.a), ("b1", self.b)):
            rel = os.path.join("news", "data", "analysis", "articles", f"{name}.json")
            with open(os.path.join(self.root, rel), "w", encoding="utf-8") as fh:
                json.dump(rec, fh)
            self.paths[rec["url"]] = rel

        self.keeper = story("20260902-keeper", "БСП подкрепи Йотова", [self.a])
        self.candidate = story("20260902-cand", "БСП потвърди подкрепата", [self.b],
                               topics=[{"category": "parliament", "primary": True}])
        for st in (self.keeper, self.candidate):
            with open(os.path.join(adir, "stories", st["id"] + ".json"),
                      "w", encoding="utf-8") as fh:
                json.dump(st, fh)

        self.index = {
            "version": 1, "updated_at": "2026-09-02T09:00:00+00:00",
            "stories": {
                "20260902-keeper": {"title_bg": "k", "path": "x", "member_count": 1},
                "20260902-cand": {"title_bg": "c", "path": "y", "member_count": 1},
            },
            "articles": {
                self.a["url"]: {"path": self.paths[self.a["url"]],
                                "story_id": "20260902-keeper"},
                self.b["url"]: {"path": self.paths[self.b["url"]],
                                "story_id": "20260902-cand"},
            },
        }
        self._write_index()
        self.queue_path = os.path.join(self.root, "news", "review",
                                       "story_merge_queue.json")
        self.write_queue("accepted")

    def _write_index(self):
        with open(os.path.join(self.root, "news", "data", "analysis", "index.json"),
                  "w", encoding="utf-8") as fh:
            json.dump(self.index, fh)

    def write_queue(self, status, matched="20260902-keeper"):
        queue = {"version": 1, "generated_at": "2026-09-02T09:00:00+00:00",
                 "counts": {"total": 1, "active": 1, "pending": 1},
                 "items": [{
                     "id": "story-merge-test", "status": status, "active": True,
                     "first_seen": "2026-09-02T09:00:00+00:00",
                     "last_seen": "2026-09-02T09:00:00+00:00",
                     "keeper": {"id": "20260902-keeper"},
                     "matched": {"id": matched},
                     "candidate": {"id": "20260902-cand"},
                     "evidence": {"confidence": "high"},
                 }]}
        with open(self.queue_path, "w", encoding="utf-8") as fh:
            json.dump(queue, fh)

    def run_script(self, *args):
        env = {**os.environ, "DATA_BG_ROOT": self.root}
        proc = subprocess.run([sys.executable, SCRIPT, *args], env=env,
                              text=True, capture_output=True, timeout=120)
        line = [l for l in proc.stdout.splitlines() if l.startswith("{")]
        self.assertTrue(line, proc.stdout + proc.stderr)
        return json.loads(line[-1]), proc

    def read_story(self, sid):
        path = os.path.join(self.root, "news", "data", "analysis", "stories",
                            sid + ".json")
        if not os.path.isfile(path):
            return None
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)

    def read_index(self):
        with open(os.path.join(self.root, "news", "data", "analysis", "index.json"),
                  encoding="utf-8") as fh:
            return json.load(fh)

    # ----------------------------------------------------------------- tests

    def test_an_accepted_merge_joins_two_outlets_into_one_story(self):
        out, _ = self.run_script("--apply")
        self.assertEqual(out["counts"]["merges_planned"], 1)
        keeper = self.read_story("20260902-keeper")
        self.assertEqual(len(keeper["members"]), 2)
        self.assertEqual(keeper["aggregates"]["outlet_count"], 2)
        self.assertEqual(keeper["aggregates"]["by_domain"],
                         {"dir.bg": 1, "nova.bg": 1})
        # The whole point: the story now carries two different framings.
        self.assertEqual(keeper["aggregates"]["by_leaning"],
                         {"neutral": 1, "progressive": 1})
        self.assertIsNone(self.read_story("20260902-cand"))

    def test_the_index_repoints_the_moved_article(self):
        """Membership lives only in the index; the article files carry none."""
        self.run_script("--apply")
        index = self.read_index()
        self.assertEqual(index["articles"][self.b["url"]]["story_id"],
                         "20260902-keeper")
        self.assertNotIn("20260902-cand", index["stories"])
        self.assertEqual(index["stories"]["20260902-keeper"]["member_count"], 2)

    def test_a_dry_run_writes_nothing(self):
        out, _ = self.run_script()
        self.assertTrue(out["dry_run"])
        self.assertEqual(out["counts"]["merges_planned"], 1)
        self.assertIsNotNone(self.read_story("20260902-cand"))
        self.assertEqual(len(self.read_story("20260902-keeper")["members"]), 1)

    def test_a_PENDING_proposal_is_never_applied(self):
        """The review step must not be decorative."""
        self.write_queue("pending")
        out, _ = self.run_script("--apply")
        self.assertEqual(out["counts"]["accepted"], 0)
        self.assertEqual(out["counts"]["merges_planned"], 0)
        self.assertIsNotNone(self.read_story("20260902-cand"))

    def test_a_REJECTED_proposal_is_never_applied(self):
        self.write_queue("rejected")
        out, _ = self.run_script("--apply")
        self.assertEqual(out["counts"]["merges_planned"], 0)
        self.assertIsNotNone(self.read_story("20260902-cand"))

    def test_re_running_is_idempotent(self):
        self.run_script("--apply")
        out, _ = self.run_script("--apply")
        self.assertEqual(out["counts"]["merges_planned"], 0)
        self.assertEqual(out["counts"]["already_applied"], 1)
        self.assertEqual(len(self.read_story("20260902-keeper")["members"]), 2)

    def test_topics_from_both_stories_survive_with_one_primary(self):
        self.run_script("--apply")
        topics = self.read_story("20260902-keeper")["topics"]
        cats = sorted(t["category"] for t in topics)
        self.assertEqual(cats, ["elections-parliamentary", "parliament"])
        self.assertEqual(sum(bool(t.get("primary")) for t in topics), 1)

    def test_a_transitive_merge_is_reported_rather_than_hidden(self):
        """`matched` != keeper means the direct evidence was against a third
        story, so the merge rides the connected component. It still applies --
        that is the design -- but it must be visible in the output."""
        self.write_queue("accepted", matched="20260902-other")
        out, _ = self.run_script()
        self.assertEqual(out["counts"]["transitive"], 1)
        self.assertTrue(out["merges"][0]["transitive"])

    def test_a_missing_keeper_is_refused_and_exits_nonzero(self):
        os.remove(os.path.join(self.root, "news", "data", "analysis", "stories",
                               "20260902-keeper.json"))
        out, proc = self.run_script("--apply")
        self.assertEqual(out["counts"]["refused"], 1)
        self.assertEqual(proc.returncode, 1)
        self.assertIsNotNone(self.read_story("20260902-cand"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
