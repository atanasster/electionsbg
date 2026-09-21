#!/usr/bin/env python3
"""The v2→v3 party-tone migration: what it converts, and what it refuses to.

Run:  python3 news/scripts/test_backfill_party_tone_spans.py

⚠️ THE ONE RULE THIS FILE EXISTS TO PIN: the migration never manufactures a
span. A legacy `evidence` string was written under a prompt that accepted „a
verbatim quote OR a concrete verifiable paraphrase", so it is prose of unknown
provenance; promoting it would stamp `located: True` on something nobody
verified — a fabricated quote wearing a verified badge.
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import analyze_articles as aa  # noqa: E402
import backfill_party_tone_spans as bf  # noqa: E402

SCRIPT = Path(__file__).resolve().parent / "backfill_party_tone_spans.py"
BODY = "Увод. ГЕРБ пое ангажимент до петък. Край."


class MigrateTone(unittest.TestCase):
    def test_prose_becomes_a_rationale_and_never_a_span(self):
        out = bf.migrate_tone({"party": "ГЕРБ", "tone": "favorable",
                               "confidence": 0.8,
                               "evidence": "Материалът подкрепя партията."})
        self.assertEqual(out["rationale"], "Материалът подкрепя партията.")
        self.assertEqual(out["evidence_spans"], [])
        self.assertNotIn("evidence", out)
        self.assertEqual(out["party"], "ГЕРБ")

    def test_a_verbatim_legacy_string_is_STILL_not_promoted(self):
        """⚠️ Even when the prose happens to be a real quote. The migration
        cannot know it was chosen as one, and `voice` — whose words they are —
        is unrecoverable. Provenance is earned by re-analysis."""
        out = bf.migrate_tone({"party": "ГЕРБ", "tone": "favorable",
                               "confidence": 0.8,
                               "evidence": "ГЕРБ пое ангажимент"})
        self.assertEqual(out["evidence_spans"], [])

    def test_unrelated_keys_survive(self):
        out = bf.migrate_tone({"party": "ГЕРБ", "tone": "neutral",
                               "evidence": "x", "party_id": "gerb",
                               "human_review": {"status": "accepted"}})
        self.assertEqual(out["party_id"], "gerb")
        self.assertEqual(out["human_review"], {"status": "accepted"})


class EndToEnd(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="tone_migration_")
        self.root = Path(self.temp.name)
        self.analyses = (self.root / "news" / "data" / "analysis"
                         / "articles" / "x.bg")
        self.analyses.mkdir(parents=True)
        self.articles = self.root / "news" / "data" / "x.bg"
        self.articles.mkdir(parents=True)
        (self.articles / "a.json").write_text(
            json.dumps({"title": "", "content": BODY}, ensure_ascii=False),
            encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def write(self, tones, version=2, name="a"):
        path = self.analyses / f"{name}.json"
        path.write_text(json.dumps({
            "party_tones": tones,
            "party_tones_version": version,
            "article_path": "news/data/x.bg/a.json",
        }, ensure_ascii=False), encoding="utf-8")
        return path

    def run_migration(self, *args):
        out = subprocess.run(
            [sys.executable, str(SCRIPT), "--json", *args],
            capture_output=True, text=True,
            env={**os.environ, "DATA_BG_ROOT": str(self.root)})
        self.assertEqual(out.returncode, 0, out.stderr)
        return json.loads(out.stdout.strip().splitlines()[-1])

    def stored(self, name="a"):
        return json.loads((self.analyses / f"{name}.json")
                          .read_text(encoding="utf-8"))

    def test_a_neutral_tone_becomes_supported(self):
        """⚠️ THE UNLOCK. 1,175 of 1,450 legacy pairs are neutral, and they
        were withheld from every reader because the old gate demanded a quote
        to prove that no framing was found."""
        self.write([{"party": "ГЕРБ", "tone": "neutral", "confidence": 0.8,
                     "evidence": "Материалът представя позицията фактически."}])
        report = self.run_migration("--apply")
        self.assertEqual(report["supported_after_migration"], {"neutral": 1})
        self.assertEqual(report["withheld_after_migration"], {})
        tone = self.stored()["party_tones"][0]
        self.assertIs(tone["evidence_grounded"], True)
        self.assertEqual(tone["evidence_spans"], [])

    def test_a_directional_tone_stays_withheld(self):
        """Correctly: nothing in the record shows what the article said."""
        self.write([{"party": "ГЕРБ", "tone": "unfavorable", "confidence": 0.7,
                     "evidence": "Материалът повтаря обвинението некритично."}])
        report = self.run_migration("--apply")
        self.assertEqual(report["withheld_after_migration"], {"unfavorable": 1})
        self.assertIs(self.stored()["party_tones"][0]["evidence_grounded"],
                      False)

    def test_no_span_is_ever_created(self):
        self.write([{"party": "ГЕРБ", "tone": "favorable", "confidence": 0.9,
                     "evidence": "ГЕРБ пое ангажимент"}])
        report = self.run_migration("--apply")
        self.assertEqual(report["spans_created"], 0)
        self.assertEqual(self.stored()["party_tones"][0]["evidence_spans"], [])

    def test_the_record_carries_its_migration_provenance(self):
        self.write([{"party": "ГЕРБ", "tone": "neutral", "confidence": 0.8,
                     "evidence": "Фактическо представяне без оценка."}])
        self.run_migration("--apply")
        stored = self.stored()
        self.assertEqual(stored["party_tones_version"], aa.PARTY_TONES_VERSION)
        self.assertEqual(stored["party_tones_migrated_from"], 2)
        self.assertTrue(stored["party_tones_migrated_at"])

    def test_a_dry_run_writes_nothing(self):
        self.write([{"party": "ГЕРБ", "tone": "neutral", "confidence": 0.8,
                     "evidence": "Фактическо представяне без оценка."}])
        report = self.run_migration()
        self.assertEqual(report["records_migrated"], 1)
        self.assertFalse(report["applied"])
        self.assertEqual(self.stored()["party_tones_version"], 2)

    def test_a_v3_record_is_left_alone(self):
        self.write([{"party": "ГЕРБ", "tone": "neutral", "confidence": 0.8,
                     "rationale": "Вече мигриран запис.",
                     "evidence_spans": []}],
                   version=aa.PARTY_TONES_VERSION)
        report = self.run_migration("--apply")
        self.assertEqual(report["records_migrated"], 0)

    def test_a_record_without_its_article_is_counted_not_migrated(self):
        """The gate re-runs against the article; migrating without one would
        leave `evidence_grounded` decided by nothing."""
        path = self.analyses / "b.json"
        path.write_text(json.dumps({
            "party_tones": [{"party": "ГЕРБ", "tone": "neutral",
                             "confidence": 0.8, "evidence": "нещо"}],
            "party_tones_version": 2,
            "article_path": "news/data/x.bg/missing.json",
        }, ensure_ascii=False), encoding="utf-8")
        report = self.run_migration("--apply")
        self.assertEqual(report["records_without_an_article"], 1)
        self.assertEqual(report["records_migrated"], 0)
        self.assertEqual(json.loads(path.read_text(encoding="utf-8"))
                         ["party_tones_version"], 2)

    def test_a_verbatim_neutral_string_is_reported_not_converted(self):
        self.write([{"party": "ГЕРБ", "tone": "neutral", "confidence": 0.8,
                     "evidence": "ГЕРБ пое ангажимент"}])
        report = self.run_migration("--apply")
        self.assertEqual(report["verbatim_neutral_evidence"], 1)
        self.assertEqual(self.stored()["party_tones"][0]["evidence_spans"], [])

    def test_every_migrated_tone_passes_the_validator_as_MIGRATED(self):
        """⚠️ INCLUDING THE DIRECTIONAL ONES, which is where the first version
        of this test overclaimed: it exercised only `neutral` and so certified
        a property that is false for 19% of what was written. A v3 directional
        tone with no span IS invalid as a submission — the migration cannot
        supply provenance that never existed — so a converted record is
        validated with `migrated=True`, and is still withheld regardless.
        """
        self.write([
            {"party": "ГЕРБ", "tone": "neutral", "confidence": 0.8,
             "evidence": "Материалът представя позицията фактически."},
            {"party": "БСП", "tone": "unfavorable", "confidence": 0.7,
             "evidence": "Материалът повтаря обвинението некритично."},
            {"party": "ДПС", "tone": "mixed", "confidence": 0.6,
             "evidence": "Материалът съдържа и похвала, и критика."}])
        self.run_migration("--apply")
        for tone in self.stored()["party_tones"]:
            with self.subTest(party=tone["party"]):
                self.assertEqual(
                    aa.validate_tone_evidence(tone, "t", migrated=True), [])
        directional = [t for t in self.stored()["party_tones"]
                       if t["tone"] != "neutral"]
        for tone in directional:
            with self.subTest(party=tone["party"]):
                # As a SUBMISSION it would rightly be refused...
                self.assertTrue(aa.validate_tone_evidence(tone, "t"))
                # ...and it never reaches a reader either way.
                self.assertIs(tone["evidence_grounded"], False)

    def test_a_tone_that_already_has_spans_is_refused_not_clobbered(self):
        """⚠️ Writing `[]` over located provenance destroys it, demotes the
        tone, and reports `spans_created: 0` while doing so."""
        self.write([{"party": "ГЕРБ", "tone": "favorable", "confidence": 0.9,
                     "evidence": "Материалът подкрепя партията.",
                     "evidence_spans": [{"quote": "ГЕРБ пое ангажимент",
                                         "field": "body",
                                         "direction": "favorable",
                                         "voice": "journalist"}]}])
        report = self.run_migration("--apply")
        self.assertEqual(report["records_migrated"], 0)
        self.assertTrue(report["refused_records"])
        stored = self.stored()
        self.assertEqual(stored["party_tones_version"], 2)
        self.assertEqual(len(stored["party_tones"][0]["evidence_spans"]), 1)

    def test_nothing_is_ever_demoted_from_grounded(self):
        """A migration may release a withheld tone; it may never withhold a
        published one."""
        self.write([{"party": "ГЕРБ", "tone": "neutral", "confidence": 0.8,
                     "evidence": "Фактическо представяне без оценка.",
                     "evidence_grounded": True}])
        report = self.run_migration("--apply")
        self.assertEqual(report["demoted_from_grounded"], 0)

    def test_the_spans_created_counter_is_measured_not_asserted(self):
        """A hard-coded zero makes the promise unfalsifiable."""
        import inspect
        import backfill_party_tone_spans as module
        source = inspect.getsource(module.main)
        self.assertIn("spans_created += len", source)


if __name__ == "__main__":
    unittest.main(verbosity=1)
