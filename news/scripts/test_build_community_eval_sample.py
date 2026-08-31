#!/usr/bin/env python3
"""Tests for the reproducible, public-safe community evaluation sample."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from news.scripts import build_community_eval_sample as sample
from news.scripts.sync_eval_tasks import load_selection


class CommunitySampleTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="community_sample_")
        self.root = Path(self.temp.name)
        self.app_data = self.root / "news/app-data"
        articles_dir = self.app_data / "articles"
        articles_dir.mkdir(parents=True)
        gold = self.root / "news/data/gold"
        gold.mkdir(parents=True)
        rows = []
        for index in range(30):
            domain = f"outlet{index % 6}.bg"
            article_id = {
                29: "nodate-aware-future",
                28: "nodate-naive-future",
                27: "nodate-malformed",
                26: "nodate-undated",
                25: "20270101-filename-future",
            }.get(index, f"article-{index:02d}")
            key = f"{domain}/{article_id}"
            parties = []
            if index % 6 == 0:
                parties = [
                    {"party": "A", "party_id": "party:a", "tone": "neutral"},
                    {"party": "B", "party_id": "party:b", "tone": "mixed"},
                ]
            elif index % 6 == 1:
                parties = [{
                    "party": "A", "party_id": "party:a", "tone": "favorable",
                }]
            leaning = (
                "strong_progressive" if index % 6 == 3
                else "progressive" if index % 6 == 4
                else "not_applicable"
            )
            russia = "anti_russia" if index % 6 == 2 else "not_applicable"
            analysis = {
                "leaning": {"label": leaning},
                "russia_stance": {"label": russia},
                "party_tones": parties,
                "entities": {
                    "parties": [party["party"] for party in parties],
                },
                "topics": [{
                    "category": f"topic-{index % 4}", "primary": True,
                }],
            }
            rows.append({
                "id": article_id,
                "domain": domain,
                "outlet": f"Outlet {index % 6}",
                "title": f"Article title {index}",
                "url": f"https://{domain}/{article_id}",
                "published": (
                    "2027-01-01T00:00:00Z" if index == 29
                    else "2027-01-01T00:00:00" if index == 28
                    else "not-a-date" if index == 27
                    else None if index in {25, 26}
                    else f"2026-{(index % 5) + 1:02d}-01T00:00:00Z"
                ),
                "story_id": f"story-{index // 2}" if index < 4 else f"story-{index}",
                "analysis": analysis,
            })
            article_dir = self.root / "news/data" / domain
            article_dir.mkdir(parents=True, exist_ok=True)
            (article_dir / f"{article_id}.json").write_text(json.dumps({
                "url": f"https://{domain}/{article_id}",
                "content": f"Full article body {index}",
            }), encoding="utf-8")
            analysis_dir = self.root / "news/data/analysis/articles" / domain
            analysis_dir.mkdir(parents=True, exist_ok=True)
            (analysis_dir / f"{article_id}.json").write_text(json.dumps({
                **analysis,
                "article_path": f"news/data/{domain}/{article_id}.json",
                "model": "test-model",
                "prompt_hashes": {},
            }), encoding="utf-8")
        by_domain: dict[str, list[dict]] = {}
        for row in rows:
            by_domain.setdefault(row["domain"], []).append(row)
        for domain, domain_rows in by_domain.items():
            (articles_dir / f"{domain}.json").write_text(json.dumps({
                "domain": domain,
                "generated_at": "2026-09-01T00:00:00Z",
                "articles": domain_rows,
            }), encoding="utf-8")
        (gold / "gold_set.json").write_text(json.dumps({
            "articles": [{
                "path": "news/data/outlet0.bg/article-00.json",
                "url": "https://outlet0.bg/article-00",
            }],
        }), encoding="utf-8")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_selection_is_reproducible_grouped_and_excludes_sealed_membership(self):
        first_selection, first_manifest = sample.build(
            self.root, self.app_data, size=12, seed="fixed", dataset_id="community-v1"
        )
        second_selection, second_manifest = sample.build(
            self.root, self.app_data, size=12, seed="fixed", dataset_id="community-v1"
        )
        self.assertEqual(first_selection, second_selection)
        self.assertEqual(first_manifest, second_manifest)
        self.assertNotIn("outlet0.bg/article-00", first_selection["article_keys"])
        self.assertNotIn("outlet5.bg/nodate-aware-future",
                         first_selection["article_keys"])
        self.assertNotIn("outlet4.bg/nodate-naive-future",
                         first_selection["article_keys"])
        self.assertNotIn("outlet3.bg/nodate-malformed",
                         first_selection["article_keys"])
        self.assertNotIn("outlet1.bg/20270101-filename-future",
                         first_selection["article_keys"])
        self.assertEqual(first_manifest["excluded"]["future_published"], 2)
        self.assertEqual(first_manifest["excluded"]["invalid_published_timestamp"], 2)
        self.assertEqual(sum(
            cell["eligible"]
            for cell in first_manifest["distribution"]["cells"].values()
        ), 25)
        groups = [row["group_id"] for row in first_manifest["records"]]
        self.assertEqual(len(groups), len(set(groups)))
        self.assertEqual(first_manifest["selected_size"], 12)
        self.assertTrue(first_manifest["selection_policy"]
                        ["sampling_signals_are_not_labels"])
        self.assertLessEqual(max(first_manifest["distribution"]["outlets"].values()), 2)

    def test_selection_crosses_the_existing_public_task_contract(self):
        selection, _manifest = sample.build(
            self.root, self.app_data, size=6, seed="contract", dataset_id="community-v1"
        )
        path = self.root / "selection.json"
        path.write_text(json.dumps(selection), encoding="utf-8")
        dataset_id, purpose, keys = load_selection(path)
        self.assertEqual(dataset_id, "community-v1")
        self.assertIn("sampling signals", purpose)
        self.assertEqual(keys, selection["article_keys"])

    def test_changed_seed_changes_membership_without_changing_policy(self):
        first, first_manifest = sample.build(
            self.root, self.app_data, size=6, seed="one", dataset_id="community-v1"
        )
        second, second_manifest = sample.build(
            self.root, self.app_data, size=6, seed="two", dataset_id="community-v1"
        )
        self.assertNotEqual(first["article_keys"], second["article_keys"])
        self.assertEqual(first["purpose"], second["purpose"])
        self.assertNotEqual(first_manifest["selection_sha256"],
                            second_manifest["selection_sha256"])

    def test_refuses_gold_names_oversize_and_insufficient_diversity(self):
        with self.assertRaisesRegex(sample.SampleError, "non-gold"):
            sample.build(
                self.root, self.app_data, size=5, seed="x", dataset_id="gold-copy"
            )
        with self.assertRaisesRegex(sample.SampleError, "between"):
            sample.build(
                self.root, self.app_data, size=201, seed="x", dataset_id="community-v1"
            )
        with self.assertRaisesRegex(sample.SampleError, "requested"):
            sample.build(
                self.root, self.app_data, size=31, seed="x", dataset_id="community-v1"
            )


if __name__ == "__main__":
    unittest.main()
