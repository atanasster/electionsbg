#!/usr/bin/env python3
"""The party-id re-stamp: what it fills, and everything it refuses to.

Run:  python3 news/scripts/test_backfill_party_ids.py

No network, no corpus: each case builds its own analysis tree and stubs the
resolver, so the assertions are about the BACKFILL's rules rather than about
whichever parties the committed gazetteer happens to claim today.
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

SCRIPT = Path(__file__).resolve().parent / "backfill_party_ids.py"

# What the stub resolver claims. „СДП" is here on purpose: it resolves to a
# Bulgarian id and in this corpus names the German SPD, so it is the case the
# allowlist exists for.
RESOLVES = {"дпс": "p_16", "бсп": "bsp", "сдп": "p_77"}


class Backfill(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="backfill_party_")
        self.root = Path(self.temp.name)
        self.dir = self.root / "news" / "data" / "analysis" / "articles" / "x.bg"
        self.dir.mkdir(parents=True)

    def tearDown(self):
        self.temp.cleanup()

    def write(self, name: str, tones: list) -> Path:
        path = self.dir / f"{name}.json"
        path.write_text(json.dumps({"party_tones": tones}, ensure_ascii=False),
                        encoding="utf-8")
        return path

    def run_backfill(self, *args):
        """Run the real script against a stub `analyze_articles`.

        ⚠️ THE SCRIPT IS COPIED BESIDE THE STUB, not merely run with PYTHONPATH
        pointing at it: `backfill_party_ids` inserts its OWN directory at
        sys.path[0], which would otherwise win and import the real resolver.
        """
        import shutil
        stub = self.root / "stub"
        stub.mkdir(exist_ok=True)
        script = stub / SCRIPT.name
        shutil.copy2(SCRIPT, script)
        (stub / "analyze_articles.py").write_text(
            "import json, os\n"
            f"RESOLVES = {RESOLVES!r}\n"
            "def party_id_for_name(name):\n"
            "    key = ' '.join(str(name or '').casefold().split())\n"
            "    return RESOLVES.get(key)\n"
            "def write_json_atomic(path, obj):\n"
            "    tmp = path + '.' + str(os.getpid()) + '.tmp'\n"
            "    with open(tmp, 'w', encoding='utf-8') as fh:\n"
            "        json.dump(obj, fh, ensure_ascii=False, indent=1)\n"
            "        fh.write('\\n')\n"
            "    os.replace(tmp, path)\n",
            encoding="utf-8")
        env = {**os.environ, "DATA_BG_ROOT": str(self.root),
               "PYTHONPATH": str(stub)}
        out = subprocess.run(
            [sys.executable, str(script), "--json", *args],
            capture_output=True, text=True, env=env)
        self.assertEqual(out.returncode, 0, out.stderr)
        return json.loads(out.stdout.strip().splitlines()[-1])

    def tones(self, path: Path) -> list:
        return json.loads(path.read_text(encoding="utf-8"))["party_tones"]

    # ─────────────────────────────────────────────────────────── the default

    def test_nothing_is_filled_unless_the_surface_is_named(self):
        """⚠️ THE WHOLE SAFETY PROPERTY. A blanket fill would have written a
        Bulgarian id onto German and Romanian coverage."""
        path = self.write("a", [{"party": "ДПС", "party_id": None}])
        report = self.run_backfill()
        self.assertEqual(report["entries_filled"], 0)
        self.assertEqual(report["candidates_not_named"], {"ДПС": 1})
        self.assertIsNone(self.tones(path)[0]["party_id"])

    def test_a_dry_run_reports_without_writing(self):
        path = self.write("a", [{"party": "ДПС", "party_id": None}])
        report = self.run_backfill("--surface", "ДПС")
        self.assertEqual(report["entries_filled"], 1)
        self.assertFalse(report["applied"])
        self.assertIsNone(self.tones(path)[0]["party_id"])

    # ────────────────────────────────────────────────────────────── filling

    def test_apply_fills_only_the_named_surface(self):
        path = self.write("a", [{"party": "ДПС", "party_id": None},
                                {"party": "СДП", "party_id": None}])
        report = self.run_backfill("--surface", "ДПС", "--apply")
        self.assertEqual(report["filled_by_surface"], {"ДПС": 1})
        self.assertEqual(report["candidates_not_named"], {"СДП": 1})
        stored = self.tones(path)
        self.assertEqual(stored[0]["party_id"], "p_16")
        self.assertIsNone(stored[1]["party_id"],
                          "an un-named surface must never be written")

    def test_the_allowlist_folds_the_way_resolution_folds(self):
        """„ дпс " resolves, so it must also match `--surface ДПС` — otherwise
        it is reported as a different, un-named party."""
        path = self.write("a", [{"party": " дпс ", "party_id": None}])
        report = self.run_backfill("--surface", "ДПС", "--apply")
        self.assertEqual(report["entries_filled"], 1)
        self.assertEqual(self.tones(path)[0]["party_id"], "p_16")

    # ───────────────────────────────────────────────────────────── refusals

    def test_an_existing_id_is_never_overwritten(self):
        """A stored id may encode a claim that has since become contested;
        replacing it would move an attribution between two real parties."""
        path = self.write("a", [{"party": "ДПС", "party_id": "old-id"}])
        report = self.run_backfill("--surface", "ДПС", "--apply")
        self.assertEqual(report["entries_filled"], 0)
        self.assertEqual(self.tones(path)[0]["party_id"], "old-id")
        self.assertIn("ДПС: old-id -> p_16",
                      report["disagreements_left_alone"])

    def test_an_unresolvable_surface_is_reported_not_filled(self):
        path = self.write("a", [{"party": "Няма Такава Партия",
                                 "party_id": None}])
        report = self.run_backfill("--surface", "Няма Такава Партия", "--apply")
        self.assertEqual(report["entries_filled"], 0)
        self.assertEqual(report["still_unresolved_entries"], 1)
        self.assertIsNone(self.tones(path)[0]["party_id"])

    def test_a_malformed_tone_entry_does_not_abort_the_run(self):
        path = self.write("a", ["not an object",
                                {"party": "ДПС", "party_id": None}])
        report = self.run_backfill("--surface", "ДПС", "--apply")
        self.assertEqual(report["entries_filled"], 1)
        self.assertEqual(self.tones(path)[1]["party_id"], "p_16")

    def test_an_unreadable_record_is_counted_rather_than_skipped(self):
        """A corpus that stopped parsing looks exactly like one with nothing
        to fill."""
        (self.dir / "broken.json").write_text("{not json", encoding="utf-8")
        self.write("a", [{"party": "ДПС", "party_id": None}])
        report = self.run_backfill("--surface", "ДПС")
        self.assertEqual(report["unreadable"], 1)
        self.assertEqual(report["scanned"], 1)

    def test_domain_narrows_the_scan(self):
        other = self.root / "news" / "data" / "analysis" / "articles" / "y.bg"
        other.mkdir(parents=True)
        (other / "b.json").write_text(
            json.dumps({"party_tones": [{"party": "ДПС", "party_id": None}]}),
            encoding="utf-8")
        self.write("a", [{"party": "ДПС", "party_id": None}])
        report = self.run_backfill("--domain", "y.bg", "--surface", "ДПС")
        self.assertEqual(report["scanned"], 1)
        self.assertEqual(report["entries_filled"], 1)


if __name__ == "__main__":
    unittest.main(verbosity=1)
