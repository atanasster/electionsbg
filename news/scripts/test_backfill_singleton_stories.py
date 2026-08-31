import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from news.scripts import backfill_singleton_stories as backfill
from news.scripts.backfill_singleton_stories import (
    load_candidates,
    run_backfill,
    singleton_record,
)


class SingletonStoryBackfillTest(unittest.TestCase):
    def analysis(self, **updates):
        value = {
            "quality": {"verdict": "ok"},
            "site_relevant": True,
            "summary_bg": "Резюме",
            "summary_en": "Summary",
            "story": {"action": "none"},
        }
        value.update(updates)
        return value

    def test_publishable_detached_record_gets_only_a_new_singleton(self):
        source = self.analysis(
            review={"reasons": ["x"]}, party_tones_version=2,
            party_tone_evidence_gate_version=1,
            party_tones=[{
                "party": "П", "tone": "neutral", "confidence": 0.8,
                "evidence": "достатъчно дълго доказателство за тона",
                "party_id": "p", "evidence_grounded": True,
            }],
        )
        got = singleton_record(source, {"title": "Заглавие"}, None)
        self.assertEqual(got["story"], {
            "action": "new_story",
            "canonical_title_bg": "Заглавие",
            "canonical_title_en": "Summary",
            "summary_bg": "Резюме",
            "summary_en": "Summary",
            "related_story_ids": [],
        })
        self.assertNotIn("review", got)
        self.assertNotIn("party_tones_version", got)
        self.assertNotIn("party_tone_evidence_gate_version", got)
        self.assertNotIn("party_id", got["party_tones"][0])
        self.assertNotIn("evidence_grounded", got["party_tones"][0])

    def test_legacy_record_without_story_metadata_is_detached(self):
        source = self.analysis()
        source.pop("story")
        got = singleton_record(source, {"title": "Заглавие"}, None)
        self.assertEqual(got["story"]["action"], "new_story")

    def test_existing_nonpublishable_and_non_none_records_are_untouched(self):
        self.assertIsNone(singleton_record(
            self.analysis(), {"title": "T"}, "existing"))
        self.assertIsNone(singleton_record(
            self.analysis(site_relevant=False), {"title": "T"}, None))
        self.assertIsNone(singleton_record(
            self.analysis(story={"action": "same_story"}),
            {"title": "T"}, None))

    def test_candidate_discovery_honours_index_identity_and_limit(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            data = root / "news" / "data"
            analyses = data / "analysis" / "articles" / "example.com"
            articles = data / "example.com"
            analyses.mkdir(parents=True)
            articles.mkdir(parents=True)

            def write(name, *, url, story_marker="none", article_url=None):
                article_path = articles / f"{name}.json"
                article_path.write_text(json.dumps({
                    "domain": "example.com", "url": article_url or url,
                    "title": f"Title {name}",
                }), encoding="utf-8")
                analysis = self.analysis(
                    domain="example.com", url=url,
                    article_path=f"news/data/example.com/{name}.json",
                )
                if story_marker is None:
                    analysis.pop("story")
                (analyses / f"{name}.json").write_text(
                    json.dumps(analysis), encoding="utf-8")

            write("a", url="https://example.com/a", story_marker=None)
            write("b", url="https://example.com/b")
            write("indexed", url="https://example.com/indexed")
            write("mismatch", url="https://example.com/mismatch",
                  article_url="https://example.com/other")
            (analyses / "invalid.json").write_text(json.dumps(self.analysis(
                domain="example.com", url="https://example.com/invalid",
                article_path="outside.json",
            )), encoding="utf-8")
            (data / "analysis" / "index.json").write_text(json.dumps({
                "articles": {
                    "https://example.com/indexed": {"story_id": "story-1"},
                },
            }), encoding="utf-8")

            with patch.object(backfill, "ROOT", root), patch.object(
                    backfill, "DATA", data):
                records, skipped = load_candidates(limit=1)
                self.assertEqual([record["url"] for record in records],
                                 ["https://example.com/a"])
                records, skipped = load_candidates(limit=0)

            self.assertEqual([record["url"] for record in records], [
                "https://example.com/a", "https://example.com/b",
            ])
            self.assertEqual({item["reason"] for item in skipped}, {
                "identity_mismatch", "invalid_article_path",
            })

    def test_reporting_rejects_partial_success_and_dry_run_does_not_save(self):
        records = [{"url": "a"}, {"url": "b"}]
        calls = []

        def partial(batch):
            calls.append(batch)
            return {"saved": ["a"], "stories_created": ["story-a"]}

        with self.assertRaisesRegex(RuntimeError, "incomplete_backfill_batch"):
            run_backfill(records, [], batch_size=2, dry_run=False,
                         save=partial)
        self.assertEqual(len(calls), 1)
        calls.clear()
        summary = run_backfill(records, [], batch_size=1, dry_run=True,
                               save=partial)
        self.assertEqual(summary["saved"], 0)
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
