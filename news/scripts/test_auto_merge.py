#!/usr/bin/env python3
"""Regression tests for auto_merge_host in analyze_articles.py.

Reloads the module against a throwaway DATA_BG_ROOT, because its story and
index paths are module-level constants resolved at import.

Run:  python3 news/scripts/test_auto_merge.py
"""

import importlib
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def story(sid, title, domain, when="2026-09-02T09:00:00+00:00", people=("Зеленски",)):
    return {
        "id": sid, "canonical_title_bg": title, "canonical_title_en": title,
        "summary_bg": title, "summary_en": title,
        "created_at": when, "updated_at": when,
        "topics": [{"category": "foreign-policy", "primary": True}],
        "related_story_ids": [],
        "members": [{"domain": domain, "url": f"https://{domain}/a",
                     "article_path": f"news/data/{domain}/a.json",
                     "published": when, "leaning": "neutral",
                     "russia_stance": "neutral", "added_at": when}],
        "entities": {"people": list(people), "parties": [], "institutions": [],
                     "companies": [], "places": ["Украйна"]},
        "aggregates": {"article_count": 1, "outlet_count": 1,
                       "by_domain": {domain: 1}},
        "first_published": when, "last_published": when,
    }


def analysis(title, when="2026-09-02T09:20:00+00:00", people=("Зеленски",)):
    """An ANALYSIS record — deliberately WITHOUT article fields.

    It carries no `title`/`description`/`keywords`/`content`; the headline is
    in `story.canonical_title_bg`. Reading the article names here yields None
    for all of them, which scores 0 rather than failing — the first cut of
    auto_merge_host did exactly that and joined 0 of 300 real analyses.
    """
    return {
        "url": "https://other.bg/x", "domain": "other.bg",
        "article_path": "news/data/other.bg/x.json", "published": when,
        "summary_bg": title, "summary_en": title,
        "leaning": {"label": "neutral"}, "russia_stance": {"label": "neutral"},
        "entities": {"people": list(people), "parties": [], "institutions": [],
                     "companies": [], "places": ["Украйна"]},
        "topics": [{"category": "foreign-policy", "primary": True}],
        "party_tones": [],
        "story": {"action": "new_story", "canonical_title_bg": title,
                  "canonical_title_en": title, "summary_bg": title,
                  "summary_en": title, "related_story_ids": []},
    }


class Harness(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="news_automerge_")
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.stories = os.path.join(self.root, "news", "data", "analysis", "stories")
        os.makedirs(self.stories)
        os.environ["DATA_BG_ROOT"] = self.root
        os.environ.pop("NEWS_AUTO_MERGE", None)
        self.addCleanup(os.environ.pop, "DATA_BG_ROOT", None)
        import analyze_articles
        self.aa = importlib.reload(analyze_articles)
        self.addCleanup(self._restore)

    def _restore(self):
        os.environ.pop("NEWS_AUTO_MERGE", None)
        os.environ.pop("DATA_BG_ROOT", None)
        import analyze_articles
        importlib.reload(analyze_articles)

    def put(self, st):
        with open(os.path.join(self.stories, st["id"] + ".json"), "w",
                  encoding="utf-8") as fh:
            json.dump(st, fh)

    def index_for(self, *sts):
        return {"version": 1, "updated_at": "2026-09-02T09:00:00+00:00",
                "articles": {},
                "stories": {s["id"]: {
                    "title_bg": s["canonical_title_bg"],
                    "title_en": s["canonical_title_en"],
                    "first_published": s["first_published"],
                    "last_published": s["last_published"],
                    "member_count": len(s["members"]),
                    "topics": s["topics"], "entities": s["entities"],
                    "path": f"news/data/analysis/stories/{s['id']}.json",
                } for s in sts}}

    # ----------------------------------------------------------------- tests


class AutoMergeHost(Harness):
    def test_it_joins_the_same_event_from_another_outlet(self):
        title = "Зеленски смени командващия сухопътните войски на Украйна"
        st = story("s1", title, "dir.bg")
        self.put(st)
        host = self.aa.auto_merge_host(analysis(title), self.index_for(st))
        self.assertIsNotNone(host)
        self.assertEqual(host[0], "s1")
        self.assertGreaterEqual(host[1]["title_jaccard"], 0.8)

    def test_it_reads_the_STORY_title_not_an_article_field(self):
        """The regression that made the first cut a silent no-op.

        The analysis record has no `title` key at all, so a host found here
        proves the headline was taken from `story.canonical_title_bg`.
        """
        title = "Зеленски смени командващия сухопътните войски на Украйна"
        st = story("s1", title, "dir.bg")
        self.put(st)
        record = analysis(title)
        self.assertNotIn("title", record)
        self.assertIsNotNone(self.aa.auto_merge_host(record, self.index_for(st)))

    def test_an_unrelated_story_is_not_joined(self):
        st = story("s1", "Цените на горивата се повишиха с два процента", "dir.bg",
                   people=("Иван Иванов",))
        self.put(st)
        host = self.aa.auto_merge_host(
            analysis("Зеленски смени командващия сухопътните войски на Украйна"),
            self.index_for(st))
        self.assertIsNone(host)

    def test_a_stale_story_is_not_joined(self):
        """Beyond the event window the rule must refuse, however similar."""
        title = "Зеленски смени командващия сухопътните войски на Украйна"
        st = story("s1", title, "dir.bg", when="2026-08-01T09:00:00+00:00")
        self.put(st)
        self.assertIsNone(
            self.aa.auto_merge_host(analysis(title), self.index_for(st)))

    def test_the_kill_switch_disables_it(self):
        """An operator facing a bad merge wave needs one lever, not a deploy."""
        title = "Зеленски смени командващия сухопътните войски на Украйна"
        st = story("s1", title, "dir.bg")
        self.put(st)
        self.assertIsNotNone(
            self.aa.auto_merge_host(analysis(title), self.index_for(st)))
        os.environ["NEWS_AUTO_MERGE"] = "0"
        self.assertIsNone(
            self.aa.auto_merge_host(analysis(title), self.index_for(st)))

    def test_it_picks_the_strongest_host_when_several_match(self):
        title = "Зеленски смени командващия сухопътните войски на Украйна"
        exact = story("s_exact", title, "dir.bg")
        looser = story("s_loose",
                       "Зеленски смени командващия сухопътните войски след среща",
                       "nova.bg")
        self.put(exact)
        self.put(looser)
        host = self.aa.auto_merge_host(analysis(title),
                                       self.index_for(exact, looser))
        self.assertEqual(host[0], "s_exact")

    def test_it_uses_the_same_rule_as_the_review_queue(self):
        """One definition of "same event", not a second that could disagree
        with the proposals a human audits."""
        import home_event_dedupe
        self.assertIs(self.aa.same_event_evidence,
                      home_event_dedupe.same_event_evidence)


class ReviewChannel(Harness):
    """Plan T2.1 — what the strict rule refuses is proposed, never joined."""

    def test_a_subcategory_mismatch_is_refused_by_the_join_and_proposed_for_review(self):
        title = "Зеленски смени командващия сухопътните войски на Украйна"
        st = story("s1", title, "dir.bg")
        st["topics"] = [{"category": "foreign-policy", "subcategory": "ukraine", "primary": True}]
        self.put(st)
        record = analysis(title)
        record["topics"] = [{"category": "foreign-policy", "subcategory": "nato", "primary": True}]
        record["story"]["canonical_title_bg"] = title
        index = self.index_for(st)
        self.assertIsNone(self.aa.auto_merge_host(record, index))
        proposals = self.aa.review_join_candidates(record, index)
        self.assertEqual([p["story_id"] for p in proposals], ["s1"])
        self.assertEqual(proposals[0]["evidence"]["relaxations"], ["topic:category"])
        self.assertEqual(proposals[0]["evidence"]["mode"], "review")
        self.assertTrue(proposals[0]["channels"])

    def test_the_kill_switch_stops_the_join_but_not_the_proposals(self):
        title = "Зеленски смени командващия сухопътните войски на Украйна"
        st = story("s1", title, "dir.bg")
        self.put(st)
        os.environ["NEWS_AUTO_MERGE"] = "0"
        index = self.index_for(st)
        self.assertIsNone(self.aa.auto_merge_host(analysis(title), index))
        proposals = self.aa.review_join_candidates(analysis(title), index)
        self.assertEqual([p["story_id"] for p in proposals], ["s1"])
        # A strict-rule pair proposed here carries NO relaxation: it is the
        # join stage being switched off, and the reviewer sees that.
        self.assertEqual(proposals[0]["evidence"]["relaxations"], [])

    def test_proposals_are_upserted_and_deactivated_never_applied(self):
        title = "Зеленски смени командващия сухопътните войски на Украйна"
        st = story("s1", title, "dir.bg")
        st["topics"] = [{"category": "foreign-policy", "subcategory": "ukraine", "primary": True}]
        self.put(st)
        record = analysis(title)
        record["topics"] = [{"category": "foreign-policy", "subcategory": "nato", "primary": True}]
        path = os.path.join(self.root, "news", "review", "article_join_proposals.json")
        proposals = self.aa.review_join_candidates(record, self.index_for(st))
        doc = self.aa.record_join_proposals([(record, proposals)], "2026-09-22T00:00:00+00:00", path)
        self.assertEqual(doc["counts"], {"total": 1, "active": 1, "pending": 1, "retired": 0})
        item = doc["items"][0]
        self.assertEqual(item["status"], "pending")
        self.assertEqual(item["candidate"]["story_id"], "s1")
        self.assertEqual(item["article"]["url"], record["url"])
        # A human decision survives the next run; a proposal that stopped
        # firing is deactivated, not deleted.
        with open(path, encoding="utf-8") as fh:
            saved = json.load(fh)
        saved["items"][0]["status"] = "rejected"
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(saved, fh)
        doc = self.aa.record_join_proposals([(record, proposals)], "2026-09-22T01:00:00+00:00", path)
        self.assertEqual(doc["items"][0]["status"], "rejected")
        self.assertEqual(doc["items"][0]["first_seen"], "2026-09-22T00:00:00+00:00")
        self.assertEqual(doc["items"][0]["last_seen"], "2026-09-22T01:00:00+00:00")
        doc = self.aa.record_join_proposals([(record, [])], "2026-09-22T02:00:00+00:00", path)
        self.assertFalse(doc["items"][0]["active"])
        self.assertEqual(doc["counts"]["pending"], 0)
        # An inactive, DECIDED item is retired after the retention window; a
        # pending one never is.
        doc = self.aa.record_join_proposals([], "2026-11-01T00:00:00+00:00", path)
        self.assertEqual(doc["counts"]["total"], 0)
        self.assertEqual(doc["counts"]["retired"], 1)
        # ⚠️ NOTHING WAS JOINED: the story on disk still has one member.
        with open(os.path.join(self.stories, "s1.json"), encoding="utf-8") as fh:
            self.assertEqual(len(json.load(fh)["members"]), 1)
        self.assertEqual(record["story"]["action"], "new_story")

    def test_a_hand_broken_sidecar_is_reported_and_left_untouched(self):
        # ⚠️ THE MUTATION THIS CATCHES: a corrupt or half-edited sidecar
        # failing the SAVE — the channel that proposes must not block the
        # join path, and must not replace a file a human was editing.
        path = os.path.join(self.root, "news", "review", "article_join_proposals.json")
        os.makedirs(os.path.dirname(path))
        with open(path, "w", encoding="utf-8") as fh:
            fh.write('{"version": 1, "items": [')   # truncated
        record = analysis("Зеленски смени командващия сухопътните войски на Украйна")
        with self.assertRaisesRegex(ValueError, "not valid JSON"):
            self.aa.record_join_proposals([(record, [])], "2026-09-22T00:00:00+00:00", path)
        with open(path, encoding="utf-8") as fh:
            self.assertEqual(fh.read(), '{"version": 1, "items": [')
        # Items missing keys are tolerated: a hand edit that dropped `active`
        # or `status` does not raise, it is normalised.
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"version": 1, "items": [{"id": "x", "article": {"url": "https://a/b"}}]}, fh)
        doc = self.aa.record_join_proposals([], "2026-09-22T00:00:00+00:00", path)
        self.assertEqual(doc["items"][0]["status"], "pending")
        self.assertFalse(doc["items"][0]["active"])

if __name__ == "__main__":
    unittest.main(verbosity=2)
