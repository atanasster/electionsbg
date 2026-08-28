import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from news.scripts.build_image_rights_queue import build_queue
from news.scripts.measure_image_coverage import measure


class ImageCoverageTest(unittest.TestCase):
    def fixture(self, *, published="2026-08-20T00:00:00+00:00"):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        root = Path(tmp.name); data = root / "news/data"; (data / "x.bg").mkdir(parents=True)
        analysis_dir = data / "analysis/articles/x.bg"; analysis_dir.mkdir(parents=True)
        selections, articles, stories = [], {}, {}
        for i in range(24):
            aid = f"x.bg/a{i}"; url = f"https://x.bg/{i}"; sid = f"s{i % 8}"
            image = f"https://upload.wikimedia.org/{i}.jpg"
            source = f"https://commons.wikimedia.org/wiki/File:{i}.jpg"
            selections.append({"article_id": aid,
                               "article_path": f"news/data/x.bg/a{i}.json",
                               "article_url": url, "image_url": image,
                               "source_url": source, "creator": "A",
                               "credit_text": "Credit",
                               "licence_name": "CC BY 4.0",
                               "licence_url": "https://creativecommons.org/licenses/by/4.0/",
                               "reviewed_at": "2026-08-28"})
            rights = {"status": "cc", "creator": "A", "credit_text": "Credit",
                      "credit_url": source, "licence_name": "CC BY 4.0",
                      "licence_url": "https://creativecommons.org/licenses/by/4.0/",
                      "source_url": source, "checked_at": "2026-08-28",
                      "display_home": True}
            (data / "x.bg" / f"a{i}.json").write_text(json.dumps({
                "domain": "x.bg", "url": url, "published": published,
                "image": image, "image_rights": rights,
            }))
            (analysis_dir / f"a{i}.json").write_text(json.dumps({
                "domain": "x.bg", "url": url,
                "article_path": f"news/data/x.bg/a{i}.json",
                "analyzed_at": "2026-08-28T00:00:00+00:00",
            }))
            articles[url] = {"story_id": sid, "domain": "x.bg"}
            articles[f"https://y.bg/{sid}"] = {"story_id": sid, "domain": "y.bg"}
            stories[sid] = {"member_count": 2}
        (data / "analysis/index.json").write_text(json.dumps({
            "articles": articles, "stories": stories}))
        sp = root / "selections.json"; sp.write_text(json.dumps({"selections": selections}))
        qp = root / "queue.json"; qp.write_text(json.dumps(build_queue(data)))
        return data, sp, qp

    def test_gate_counts_unique_current_multi_outlet_comparisons(self):
        data, sp, qp = self.fixture()
        report = measure(data, sp, qp, as_of=date(2026, 8, 28))
        self.assertTrue(report["launch_ready"])
        self.assertEqual(report["measured"]["comparison_stories"], 8)
        self.assertEqual(len(report["qualifying_article_ids"]), 24)

    def test_duplicate_future_invalid_rights_and_stale_queue_fail_closed(self):
        data, sp, qp = self.fixture()
        selections = json.loads(sp.read_text())
        selections["selections"][1] = selections["selections"][0]
        sp.write_text(json.dumps(selections))
        self.assertFalse(measure(data, sp, qp, as_of=date(2026, 8, 28))["launch_ready"])

        data, sp, qp = self.fixture(published="2026-08-29T00:00:00+00:00")
        self.assertFalse(measure(data, sp, qp, as_of=date(2026, 8, 28))["launch_ready"])

        data, sp, qp = self.fixture()
        article = data / "x.bg/a0.json"; record = json.loads(article.read_text())
        record["image_rights"]["status"] = "typo"; article.write_text(json.dumps(record))
        self.assertFalse(measure(data, sp, qp, as_of=date(2026, 8, 28))["launch_ready"])

        data, sp, qp = self.fixture(); queue = json.loads(qp.read_text())
        queue["counts"]["total"] = 99; qp.write_text(json.dumps(queue))
        self.assertFalse(measure(data, sp, qp, as_of=date(2026, 8, 28))["launch_ready"])

    def test_same_outlet_members_are_not_comparisons(self):
        data, sp, qp = self.fixture(); index_path = data / "analysis/index.json"
        index = json.loads(index_path.read_text())
        for entry in index["articles"].values(): entry["domain"] = "x.bg"
        index_path.write_text(json.dumps(index))
        report = measure(data, sp, qp, as_of=date(2026, 8, 28))
        self.assertEqual(report["measured"]["comparison_stories"], 0)
        self.assertFalse(report["launch_ready"])

    def test_every_reviewed_attribution_field_is_identity_gated(self):
        mutations = {
            "status": "public_domain", "creator": "Wrong",
            "credit_text": "Wrong", "credit_url": "https://wrong.example/",
            "licence_name": "CC0", "licence_url": "https://wrong.example/license",
            "source_url": "https://wrong.example/source", "checked_at": "2026-08-27",
        }
        for field, value in mutations.items():
            with self.subTest(field=field):
                data, sp, qp = self.fixture()
                article = data / "x.bg/a0.json"
                record = json.loads(article.read_text())
                record["image_rights"][field] = value
                article.write_text(json.dumps(record))
                report = measure(data, sp, qp, as_of=date(2026, 8, 28))
                self.assertFalse(report["launch_ready"])
                self.assertTrue(any(item.startswith("attribution-mismatch:x.bg/a0")
                                    or item.startswith("selection-mismatch:x.bg/a0")
                                    for item in report["measured"]["invalid_selected_records"]))
