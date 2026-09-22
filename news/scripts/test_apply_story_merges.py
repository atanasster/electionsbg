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
        os.makedirs(os.path.join(self.root, "news", "config"))
        with open(os.path.join(self.root, "news", "config", "retired_stories.json"), "w",
                  encoding="utf-8") as fh:
            json.dump({"version": 1, "retired": {}}, fh)

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

    def test_a_transitive_merge_is_validated_against_the_anchor_and_refused_when_it_fails(self):
        """`matched` != keeper means the direct evidence was against a third
        story; the human accepted C≈B, not C≈K. The candidate is re-read
        against the KEEPER, and a pair that passes neither rule is refused
        — chained in only with --allow-anchor-miss, visibly."""
        self.write_queue("accepted", matched="20260902-other")
        out, proc = self.run_script()
        self.assertEqual(out["counts"]["merges_planned"], 0)
        self.assertEqual(out["counts"]["refused"], 1)
        self.assertEqual(out["refused"][0]["anchor_check"], "none")
        self.assertIn("anchor", out["refused"][0]["reason"])
        self.assertEqual(proc.returncode, 1)
        out, _ = self.run_script("--allow-anchor-miss")
        self.assertEqual(out["counts"]["transitive"], 1)
        self.assertTrue(out["merges"][0]["transitive"])
        self.assertTrue(out["allow_anchor_miss"])

    def test_a_transitive_merge_that_matches_the_anchor_is_planned(self):
        # The candidate reads against the keeper under the strict rule: the
        # same headline, the same person, minutes apart.
        title = "БСП подкрепи Йотова за президент на консултациите"
        for sid in ("20260902-keeper", "20260902-cand"):
            st = self.read_story(sid)
            st["canonical_title_bg"] = title
            st["entities"] = {"people": ["Илияна Йотова"], "parties": ["БСП"], "institutions": [],
                              "companies": [], "places": []}
            st["topics"] = [{"category": "elections-presidential", "primary": True}]
            with open(os.path.join(self.root, "news", "data", "analysis", "stories", sid + ".json"),
                      "w", encoding="utf-8") as fh:
                json.dump(st, fh)
        self.write_queue("accepted", matched="20260902-other")
        out, _ = self.run_script()
        self.assertEqual(out["counts"]["merges_planned"], 1)
        self.assertEqual(out["merges"][0]["anchor_check"], "strict")

    def test_a_rejected_pair_blocks_the_merge_directly_and_through_a_folded_story(self):
        # Direct: the accepted item's own pair is also rejected under another
        # proposal id — the human's refusal wins.
        queue = json.load(open(self.queue_path, encoding="utf-8"))
        queue["items"].append({
            "id": "story-merge-rej", "status": "rejected", "active": True,
            "first_seen": "2026-09-02T09:00:00+00:00", "last_seen": "2026-09-02T09:00:00+00:00",
            "keeper": {"id": "20260902-keeper"}, "matched": {"id": "20260902-keeper"},
            "candidate": {"id": "20260902-cand"}, "evidence": {}})
        with open(self.queue_path, "w", encoding="utf-8") as fh:
            json.dump(queue, fh)
        out, _ = self.run_script("--apply")
        self.assertEqual(out["counts"]["refused"], 1)
        self.assertIn("rejected", out["refused"][0]["reason"])
        self.assertIsNotNone(self.read_story("20260902-cand"))
        # Transitive: the keeper once absorbed story X, and X~candidate was
        # rejected. A~B, B~C accepted must not smuggle in the refused A/C.
        queue["items"][-1]["keeper"] = {"id": "20260902-old"}
        with open(self.queue_path, "w", encoding="utf-8") as fh:
            json.dump(queue, fh)
        keeper = self.read_story("20260902-keeper")
        keeper["merge_history"] = [{"from": "20260902-old", "on": "2026-09-01T00:00:00+00:00",
                                    "proposal": "p0", "members": []}]
        with open(os.path.join(self.root, "news", "data", "analysis", "stories", "20260902-keeper.json"),
                  "w", encoding="utf-8") as fh:
            json.dump(keeper, fh)
        out, _ = self.run_script("--apply")
        self.assertEqual(out["counts"]["refused"], 1)
        self.assertIn("20260902-old~20260902-cand", out["refused"][0]["reason"])
        self.assertIsNotNone(self.read_story("20260902-cand"))

    def test_the_retired_id_redirects_and_the_merge_is_recorded_reversibly(self):
        retired_path = os.path.join(self.root, "news", "config", "retired_stories.json")
        out, _ = self.run_script("--apply")
        self.assertTrue(out["needs_rebuild"])
        with open(retired_path, encoding="utf-8") as fh:
            retired = json.load(fh)["retired"]
        self.assertEqual(retired["20260902-cand"]["reason"], "merged")
        self.assertEqual(retired["20260902-cand"]["target"], "20260902-keeper")
        keeper = self.read_story("20260902-keeper")
        self.assertEqual(keeper["merge_history"][0]["from"], "20260902-cand")
        self.assertEqual(keeper["merge_history"][0]["members"], [self.b["url"]])
        self.assertEqual(keeper["merge_history"][0]["proposal"], "story-merge-test")

    def test_a_split_restores_the_candidate_and_marks_the_pair_rejected(self):
        self.run_script("--apply")
        out, _ = self.run_script("--split", "20260902-cand")
        self.assertTrue(out["dry_run"])
        self.assertEqual(out["action"], "split")
        self.assertEqual(out["members_restored"], 1)
        self.assertIsNone(self.read_story("20260902-cand"))
        out, _ = self.run_script("--split", "20260902-cand", "--apply")
        self.assertEqual(out["action"], "split")
        self.assertEqual(out["members_restored"], 1)
        self.assertTrue(out["needs_rebuild"])
        restored = self.read_story("20260902-cand")
        self.assertEqual([m["url"] for m in restored["members"]], [self.b["url"]])
        self.assertEqual(restored["canonical_title_bg"], "БСП потвърди подкрепата")
        keeper = self.read_story("20260902-keeper")
        self.assertEqual(len(keeper["members"]), 1)
        self.assertEqual(keeper["merge_history"], [])
        self.assertEqual(keeper["split_history"][0]["restored"], "20260902-cand")
        index = self.read_index()
        self.assertEqual(index["articles"][self.b["url"]]["story_id"], "20260902-cand")
        self.assertIn("20260902-cand", index["stories"])
        with open(os.path.join(self.root, "news", "config", "retired_stories.json"), encoding="utf-8") as fh:
            self.assertNotIn("20260902-cand", json.load(fh)["retired"])
        queue = json.load(open(self.queue_path, encoding="utf-8"))
        self.assertEqual(queue["items"][0]["status"], "rejected")
        self.assertEqual(queue["items"][0]["decision"]["by"], "split")
        # Split twice: nothing to restore.
        out, proc = self.run_script("--split", "20260902-cand", "--apply")
        self.assertEqual(out["action"], "refused")
        self.assertEqual(proc.returncode, 1)

    def test_a_decision_is_recorded_with_reviewer_and_rule_version(self):
        self.write_queue("pending")
        out, _ = self.run_script("--decide", "story-merge-test", "--status", "accepted",
                                 "--by", "Редактор", "--note", "същото съобщение")
        self.assertEqual(out["status"], "accepted")
        self.assertEqual(out["decision"]["by"], "Редактор")
        queue = json.load(open(self.queue_path, encoding="utf-8"))
        self.assertEqual(queue["items"][0]["status"], "accepted")
        self.assertEqual(queue["items"][0]["decision"]["note"], "същото съобщение")
        self.assertIn("rule_version", queue["items"][0]["decision"])
        # Now it applies — and the merge_history carries the decision.
        out, _ = self.run_script("--apply")
        self.assertEqual(out["counts"]["merges_planned"], 1)
        self.assertEqual(self.read_story("20260902-keeper")["merge_history"][0]["decision"]["by"], "Редактор")
        # An unknown proposal or a nameless reviewer is refused.
        out, proc = self.run_script("--decide", "nope", "--status", "accepted", "--by", "x")
        self.assertEqual(proc.returncode, 2)

    def test_a_missing_keeper_is_refused_and_exits_nonzero(self):
        os.remove(os.path.join(self.root, "news", "data", "analysis", "stories",
                               "20260902-keeper.json"))
        out, proc = self.run_script("--apply")
        self.assertEqual(out["counts"]["refused"], 1)
        self.assertEqual(proc.returncode, 1)
        self.assertIsNotNone(self.read_story("20260902-cand"))



    # ------------------------------------------------ T2.2 review findings ---

    def write_story_file(self, st):
        with open(os.path.join(self.root, "news", "data", "analysis", "stories", st["id"] + ".json"),
                  "w", encoding="utf-8") as fh:
            json.dump(st, fh)

    def add_story(self, sid, title, records, **kw):
        st = story(sid, title, records, **kw)
        self.write_story_file(st)
        self.index["stories"][sid] = {"title_bg": title, "path": "z", "member_count": len(records)}
        for r in records:
            self.index["articles"][r["url"]] = {"path": self.paths.get(r["url"], "p"), "story_id": sid}
        self._write_index()
        return st

    def write_queue_items(self, items):
        with open(self.queue_path, "w", encoding="utf-8") as fh:
            json.dump({"version": 1, "generated_at": "2026-09-02T09:00:00+00:00",
                       "counts": {"total": len(items), "active": len(items), "pending": 0},
                       "items": items}, fh)

    @staticmethod
    def item(pid, keeper, cand, status="accepted", matched=None, active=True, evidence=None):
        return {"id": pid, "status": status, "active": active,
                "first_seen": "2026-09-02T09:00:00+00:00", "last_seen": "2026-09-02T09:00:00+00:00",
                "keeper": {"id": keeper}, "matched": {"id": matched or keeper},
                "candidate": {"id": cand}, "evidence": evidence or {"confidence": "high"}}

    def test_a_chained_merge_repoints_the_redirect_and_the_build_accepts_the_registry(self):
        # ⚠️ THE MUTATION THIS CATCHES: leaving `retired[cand].target = keeper`
        # after the keeper itself is merged into k2 — the next build refuses
        # a registry whose target is not published.
        c = analysis("https://x.bg/c1", "x.bg", "neutral", "neutral", ["Илияна Йотова"])
        self.add_story("20260902-k2", "БСП подкрепи Йотова", [c])
        self.write_queue_items([self.item("p1", "20260902-keeper", "20260902-cand"),
                                self.item("p2", "20260902-k2", "20260902-keeper")])
        out, _ = self.run_script("--apply")
        self.assertEqual(sum(1 for r in out["merges"] if r.get("applied")), 2)
        with open(os.path.join(self.root, "news", "config", "retired_stories.json"), encoding="utf-8") as fh:
            retired = json.load(fh)["retired"]
        self.assertEqual(retired["20260902-cand"]["target"], "20260902-k2")
        self.assertEqual(retired["20260902-keeper"]["target"], "20260902-k2")
        self.assertIsNone(self.read_story("20260902-keeper"))
        # The build's own gate accepts it.
        sys.path.insert(0, os.path.dirname(SCRIPT))
        import build_app_data as bad
        from pathlib import Path as P
        loaded = bad.load_retired_stories(P(self.root) / "news" / "config" / "retired_stories.json")
        bad.write_retired_stories(P(self.root) / "out", loaded, {"20260902-k2"}, "2026-09-22T00:00:00+00:00")
        # And the chained story is still reversible: cand comes back out of k2.
        out, _ = self.run_script("--split", "20260902-cand", "--apply")
        self.assertEqual(out["action"], "split", out)
        self.assertEqual(out["keeper"], "20260902-k2")
        self.assertEqual([m["url"] for m in self.read_story("20260902-cand")["members"]], [self.b["url"]])

    def test_a_rejection_two_folds_deep_still_blocks(self):
        # ⚠️ THE MUTATION THIS CATCHES: walking merge_history one level only.
        keeper = self.read_story("20260902-keeper")
        keeper["merge_history"] = [{"from": "20260902-b", "on": "2026-09-01T00:00:00+00:00", "proposal": "p0",
                                    "members": [], "candidate_merge_history": [
                                        {"from": "20260902-x", "on": "2026-08-31T00:00:00+00:00",
                                         "proposal": "p-1", "members": []}]}]
        self.write_story_file(keeper)
        self.write_queue_items([self.item("p1", "20260902-keeper", "20260902-cand"),
                                self.item("rej", "20260902-x", "20260902-cand", status="rejected")])
        out, _ = self.run_script("--apply")
        self.assertEqual(out["counts"]["refused"], 1)
        self.assertEqual(out["refused"][0]["code"], "rejected_pair")
        self.assertIn("20260902-x~20260902-cand", out["refused"][0]["reason"])
        self.assertIsNotNone(self.read_story("20260902-cand"))

    def test_deciding_an_applied_or_inactive_item_is_guarded(self):
        self.run_script("--apply")
        # Already applied: a rejection cannot undo it — that is --split.
        out, proc = self.run_script("--decide", "story-merge-test", "--status", "rejected", "--by", "x")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("--split", out["error"])
        # Inactive: stale evidence needs --force, and the record says so.
        c = analysis("https://x.bg/c1", "x.bg", "neutral", "neutral", ["Илияна Йотова"])
        self.add_story("20260902-k2", "Друго събитие", [c])
        self.write_queue_items([self.item("stale", "20260902-keeper", "20260902-k2",
                                          status="pending", active=False)])
        out, proc = self.run_script("--decide", "stale", "--status", "rejected", "--by", "x")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("--force", out["error"])
        out, proc = self.run_script("--decide", "stale", "--status", "rejected", "--by", "x", "--force")
        self.assertEqual(proc.returncode, 0)
        self.assertFalse(out["active"])
        self.assertFalse(out["decision"]["active_when_decided"])
        self.assertEqual(out["decision"]["rule_version"], "strict-v1")
        # A nameless reviewer is refused.
        out, proc = self.run_script("--decide", "stale", "--status", "accepted", "--by", "  ", "--force")
        self.assertEqual(proc.returncode, 2)

    def test_a_split_restores_the_candidate_own_titles_and_summaries(self):
        cand = self.read_story("20260902-cand")
        cand["canonical_title_en"] = "BSP confirms its support"
        cand["summary_bg"] = "Резюме на кандидата."
        cand["summary_en"] = "Candidate summary."
        cand["created_at"] = "2026-09-01T08:00:00+00:00"
        self.write_story_file(cand)
        self.run_script("--apply")
        keeper = self.read_story("20260902-keeper")
        self.assertEqual(sorted(t["category"] for t in keeper["topics"]), ["elections-parliamentary", "parliament"])
        self.run_script("--split", "20260902-cand", "--apply")
        restored = self.read_story("20260902-cand")
        self.assertEqual(restored["canonical_title_en"], "BSP confirms its support")
        self.assertEqual(restored["summary_bg"], "Резюме на кандидата.")
        self.assertEqual(restored["summary_en"], "Candidate summary.")
        self.assertEqual(restored["created_at"], "2026-09-01T08:00:00+00:00")
        # The topics the candidate brought leave with it.
        keeper = self.read_story("20260902-keeper")
        self.assertEqual([t["category"] for t in keeper["topics"]], ["elections-parliamentary"])

    def test_an_interrupted_apply_leaves_a_consistent_index(self):
        # Two merges; the second keeper is unreadable at re-plan time → the
        # first merge's index and registry writes are already on disk.
        c = analysis("https://x.bg/c1", "x.bg", "neutral", "neutral", ["Илияна Йотова"])
        self.add_story("20260902-k2", "Друго събитие", [c])
        d = analysis("https://y.bg/d1", "y.bg", "neutral", "neutral", ["Илияна Йотова"])
        # d's analysis record is malformed in a way only the APPLY reads
        # (recompute_story), so the plan passes and the second merge crashes
        # mid-run — after the first merge's writes have landed.
        d["entities"] = "bad"
        rel = os.path.join("news", "data", "analysis", "articles", "d1.json")
        with open(os.path.join(self.root, rel), "w", encoding="utf-8") as fh:
            json.dump(d, fh)
        self.paths[d["url"]] = rel
        self.add_story("20260902-c2", "Друго събитие отново", [d])
        self.write_queue_items([self.item("p1", "20260902-keeper", "20260902-cand"),
                                self.item("p2", "20260902-k2", "20260902-c2")])
        # The run CRASHES on the unreadable file (an operator problem, not
        # one to paper over); what matters is what it left on disk.
        env = {**os.environ, "DATA_BG_ROOT": self.root}
        proc = subprocess.run([sys.executable, SCRIPT, "--apply"], env=env,
                              text=True, capture_output=True, timeout=120)
        self.assertNotEqual(proc.returncode, 0)
        index = self.read_index()
        self.assertEqual(index["articles"][self.b["url"]]["story_id"], "20260902-keeper")
        self.assertNotIn("20260902-cand", index["stories"])
        with open(os.path.join(self.root, "news", "config", "retired_stories.json"), encoding="utf-8") as fh:
            self.assertIn("20260902-cand", json.load(fh)["retired"])
        # No story file the index still names is missing, and the crash
        # released the pipeline lock.
        for sid in index["stories"]:
            if sid == "20260902-k2":
                continue
            self.assertIsNotNone(self.read_story(sid), sid)
        self.assertFalse(os.path.exists(os.path.join(self.root, "news", "data", "_nightly", "pipeline.lock")))

    def test_apply_refuses_while_the_pipeline_lock_is_held(self):
        lock = os.path.join(self.root, "news", "data", "_nightly", "pipeline.lock")
        os.makedirs(lock)
        out, proc = self.run_script("--apply")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("lock", out["error"])
        self.assertIsNotNone(self.read_story("20260902-cand"))
        os.rmdir(lock)
        out, proc = self.run_script("--apply")
        self.assertEqual(proc.returncode, 0)
        self.assertFalse(os.path.exists(lock))


    def test_an_article_channel_decision_is_mirrored_onto_the_sidecar(self):
        sidecar = os.path.join(self.root, "news", "review", "article_join_proposals.json")
        with open(sidecar, "w", encoding="utf-8") as fh:
            json.dump({"version": 1, "items": [{"id": "article-join-7", "status": "pending", "active": True,
                                                 "article": {"url": "https://nova.bg/b1"},
                                                 "candidate": {"story_id": "20260902-keeper"}}]}, fh)
        self.write_queue_items([self.item("p1", "20260902-keeper", "20260902-cand", status="pending",
                                          evidence={"mode": "review", "rule_version": "review-v1",
                                                    "relaxations": ["lede"], "sidecar_id": "article-join-7"})])
        out, _ = self.run_script("--decide", "p1", "--status", "rejected", "--by", "Редактор")
        self.assertTrue(out["sidecar_mirrored"])
        self.assertEqual(out["decision"]["rule_version"], "review-v1")
        with open(sidecar, encoding="utf-8") as fh:
            row = json.load(fh)["items"][0]
        self.assertEqual(row["status"], "rejected")
        self.assertEqual(row["decision"]["by"], "Редактор")


if __name__ == "__main__":
    unittest.main(verbosity=2)
