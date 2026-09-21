#!/usr/bin/env python3
"""build_overlay — the refusals, and the gate on the merged payload.

Run:  python3 news/scripts/test_build_overlay.py

⚠️ THE REFUSALS ARE THE POINT. An overlay is a claim about a specific
base: published against the wrong one it describes a delta from a release
no reader holds, and it fails SILENTLY — every path still parses, every
merge still succeeds, and the reader lands on a release that never
existed. So most of this file is about what must not be built.

Nothing here touches the network or a bucket: the live manifest and the
rebuild are both injected, which is what lets the refusals be tested at
all.
"""

import contextlib
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
sys.path.insert(0, str(SCRIPT_DIR.parent.parent))

import build_overlay as bo  # noqa: E402
from news.scripts.app_data_inventory import tree_inventory  # noqa: E402

# ⚠️ THE REAL GATE REFUSES THIS ONE, and that is what it is for. An
# empty home has no story within 24 h and no default payload, so
# `evaluate_home_payload` returns `ready: false` — which is exactly the
# state a hot release must not be allowed to publish. Note the
# `home_health` field on the payload is NOT what decides: the gate
# recomputes from the stories, so a payload that merely claims to be
# ready is refused like any other.
EMPTY_HOME = {
    "generated_at": "2026-09-20T12:00:00+00:00",
    "home_health": {"ready": True},
    "stories": [],
    "articles": [],
}


def write_tree(root: Path, files: dict) -> Path:
    for name, payload in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False),
                        encoding="utf-8")
    return root


class Refusals(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.mkdtemp(prefix="build_overlay_test_")
        self.addCleanup(shutil.rmtree, self.temp, True)
        self.root = Path(self.temp)
        self.base = write_tree(self.root / "base", {
            "home.json": EMPTY_HOME,
            "latest.json": {"generated_at": "2026-09-20T12:00:00+00:00",
                            "articles": []},
            "stats.json": {"generated_at": "2026-09-20T12:00:00+00:00"},
        })
        self.out = self.root / "overlay.json"
        self.manifest = {
            "version": 3,
            "run_id": "2026-09-20T120000Z-1",
            "generated_at": "2026-09-20T12:00:00+00:00",
            "data_base": "versions/2026-09-20T120000Z-1",
            "home_health_ready": True,
            "bundle": tree_inventory(self.base),
        }

    def build(self, *, rebuild=None, manifest=None, real_gate=False):
        """Run the builder with the manifest and the rebuild injected.

        ⚠️ The home gate is stubbed unless a test is ABOUT the gate. The
        fixture home is deliberately one the real gate refuses, so leaving
        it live would make every unrelated refusal test pass for the wrong
        reason — which is how "it raised" becomes "it raised what I meant".
        """
        def fake_build(out_dir: Path, latest: int, base: Path) -> None:
            write_tree(out_dir, rebuild if rebuild is not None else {
                "home.json": EMPTY_HOME,
                "latest.json": {"generated_at": "2026-09-20T12:05:00+00:00",
                                "articles": []},
                "stats.json": {"generated_at": "2026-09-20T12:00:00+00:00"},
            })
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.object(
                bo, "live_manifest", return_value=manifest or self.manifest))
            stack.enter_context(mock.patch.object(
                bo, "build_current", side_effect=fake_build))
            if not real_gate:
                stack.enter_context(mock.patch.object(
                    bo, "evaluate_home_payload", return_value={"ready": True}))
            return bo.build(self.base, self.out, latest=150)

    def test_a_base_that_is_not_the_live_release_is_refused(self):
        # ⚠️ THE REFUSAL THAT MATTERS MOST. A delta from the wrong tree
        # merges cleanly and lands a reader somewhere that never existed,
        # so this cannot be a warning.
        stale = {**self.manifest, "bundle": {**self.manifest["bundle"],
                                             "sha256": "0" * 64}}
        with self.assertRaisesRegex(bo.OverlayError, "not the live release"):
            self.build(manifest=stale)
        self.assertFalse(self.out.exists(), "an overlay was written anyway")

    def test_the_message_names_the_run_it_expected(self):
        # A refusal an operator cannot act on is a refusal they will
        # override. It must say WHICH release the bucket is serving.
        stale = {**self.manifest, "bundle": {**self.manifest["bundle"],
                                             "sha256": "0" * 64}}
        with self.assertRaises(bo.OverlayError) as caught:
            self.build(manifest=stale)
        self.assertIn(self.manifest["run_id"], str(caught.exception))

    def test_a_merged_home_that_fails_the_gate_is_refused(self):
        # ⚠️ The release gate is not suspended because a release is small.
        # A hot release replaces the home payload wholesale, so it can put
        # the front page into exactly the states the gate refuses — and it
        # can do so between two hourly runs that both passed. This runs
        # the REAL evaluator against a home with nothing on it.
        with self.assertRaisesRegex(bo.OverlayError, "home_health refuses"):
            self.build(real_gate=True)
        self.assertFalse(self.out.exists())

    def test_a_home_the_gate_cannot_read_is_refused_the_same_way(self):
        # ⚠️ One failure class, not two. Letting the evaluator's ValueError
        # out gives a traceback that reads as a bug in the builder, and an
        # operator wiring this into the hourly transaction would have to
        # handle both shapes.
        with self.assertRaisesRegex(bo.OverlayError, "cannot read"):
            self.build(real_gate=True, rebuild={
                "home.json": {**EMPTY_HOME, "stories": "not a list"},
                "latest.json": {"generated_at": "2026-09-20T12:05:00+00:00",
                                "articles": []},
            })
        self.assertFalse(self.out.exists())

    def test_the_gate_runs_on_the_MERGED_payload_not_the_overlay(self):
        # ⚠️ The first cut of this asserted the gate saw the BASE's stamp,
        # which is what it sees when the overlay carries no home at all —
        # so it passed whether or not the merge happened. The overlay here
        # replaces home, and the gate must see the REPLACEMENT.
        replaced = {**EMPTY_HOME, "generated_at": "2026-09-20T12:05:00+00:00",
                    "marker": "from-the-overlay"}
        with mock.patch.object(bo, "evaluate_home_payload",
                               return_value={"ready": True}) as gate:
            self.build(real_gate=True, rebuild={
                "home.json": replaced,
                "latest.json": {"generated_at": "2026-09-20T12:05:00+00:00",
                                "articles": []},
            })
        seen = gate.call_args[0][0]
        self.assertEqual(seen.get("marker"), "from-the-overlay")
        self.assertNotEqual(seen["generated_at"], EMPTY_HOME["generated_at"])

    def test_a_failed_rebuild_publishes_nothing(self):
        with mock.patch.object(bo, "live_manifest", return_value=self.manifest), \
                mock.patch.object(
                    bo, "build_current",
                    side_effect=bo.OverlayError("bundles failed")):
            with self.assertRaisesRegex(bo.OverlayError, "bundles failed"):
                bo.build(self.base, self.out, latest=150)
        self.assertFalse(self.out.exists())

    def test_an_oversized_overlay_is_refused(self):
        # A delta the size of the tree means the premise is broken — and
        # publishing it would be strictly worse than a cold release, since
        # the reader pays for the base AND the overlay.
        with mock.patch.object(bo, "MAX_OVERLAY_BYTES", 10):
            with self.assertRaisesRegex(bo.OverlayError, "ceiling"):
                self.build()
        self.assertFalse(self.out.exists())

    def test_keep_tree_refuses_to_delete_anything(self):
        # An inspection flag must not be a destructive one.
        for target, pattern in ((self.base, "may not be the base"),
                                (self.root / "existing", "already exists")):
            (self.root / "existing").mkdir(exist_ok=True)
            with self.assertRaisesRegex(bo.OverlayError, pattern):
                with contextlib.ExitStack() as stack:
                    stack.enter_context(mock.patch.object(
                        bo, "live_manifest", return_value=self.manifest))
                    stack.enter_context(mock.patch.object(
                        bo, "build_current",
                        side_effect=lambda out, latest, base: write_tree(out, {
                            "home.json": EMPTY_HOME,
                            "latest.json": {
                                "generated_at": "2026-09-20T12:05:00+00:00",
                                "articles": []}})))
                    stack.enter_context(mock.patch.object(
                        bo, "evaluate_home_payload",
                        return_value={"ready": True}))
                    bo.build(self.base, self.out, latest=150,
                             keep_tree=target)
        self.assertTrue(self.base.is_dir(), "the base was deleted")

    def test_the_rebuild_never_touches_the_base(self):
        # ⚠️ A hot run that rebuilt into `news/app-data` would destroy the
        # only local copy of the live release, after which `verify_base`
        # could never pass again — and the cause would be several runs
        # upstream of the first refusal.
        before = tree_inventory(self.base)
        self.build()
        self.assertEqual(tree_inventory(self.base)["sha256"], before["sha256"])

    def test_the_working_tree_is_cleaned_up_even_on_a_refusal(self):
        created: list[Path] = []
        real_mkdtemp = tempfile.mkdtemp

        def tracking_mkdtemp(*args, **kwargs):
            path = real_mkdtemp(*args, **kwargs)
            created.append(Path(path))
            return path

        with mock.patch.object(bo.tempfile, "mkdtemp",
                               side_effect=tracking_mkdtemp), \
                mock.patch.object(bo, "MAX_OVERLAY_BYTES", 10):
            with self.assertRaises(bo.OverlayError):
                self.build()
        self.assertTrue(created, "the builder made no working tree")
        for path in created:
            self.assertFalse(path.exists(), f"{path} survived a refusal")


class HotStoryContinuity(unittest.TestCase):
    """T1.5 on the hot path: an overlay may not retire a story the registry
    does not name — the urgent-removal path is exactly where it matters."""

    def test_an_unaccounted_removal_is_unaccounted_and_a_registered_one_is_not(self):
        overlay = {"removed_story_ids": ["b", "a"]}
        full = {"stories/retired.json": {"retired": {"a": {"reason": "withdrawn"}}}}
        got = bo.hot_story_continuity(overlay, full)
        self.assertEqual(got, {"removed": ["a", "b"], "retired": ["a"],
                               "unaccounted": ["b"]})
        # No registry in the rebuild at all: every removal is unaccounted.
        self.assertEqual(bo.hot_story_continuity(overlay, {})["unaccounted"],
                         ["a", "b"])

    def test_build_refuses_to_write_an_overlay_that_retires_an_unregistered_story(self):
        # ⚠️ THE MUTATION THIS CATCHES: computing the continuity and not
        # raising on it — the overlay would ship and the story page would
        # say „never published" about a deliberate withdrawal.
        source = Path(bo.__file__).read_text(encoding="utf-8")
        self.assertRegex(
            source,
            r'continuity = hot_story_continuity\(overlay, full\)\s*\n\s*if \(continuity'
            r'\["unaccounted"\][\s\S]{0,120}NEWS_ALLOW_STORY_DROPS[\s\S]{0,80}'
            r'raise OverlayError')
        self.assertLess(source.index("continuity = hot_story_continuity("),
                        source.index("out.write_bytes(payload)"))


class Sequence(unittest.TestCase):
    """The sequence is per BASE, and resets with every cold release."""

    def test_a_base_with_no_overlay_starts_at_one(self):
        self.assertEqual(bo.next_seq({"run_id": "r"}), 1)

    def test_it_advances_past_the_live_overlay(self):
        self.assertEqual(bo.next_seq({"overlay": {"seq": 4}}), 5)

    def test_a_malformed_sequence_restarts_rather_than_guessing(self):
        # ⚠️ Never reuse or interpolate: the overlay object is written
        # create-only, so a repeated seq collides with a published object
        # and the publish fails — which is the right way round, but the
        # fix is to start a fresh sequence rather than to invent one.
        for pointer in ({"seq": 0}, {"seq": "3"}, {"seq": -1}, {}):
            self.assertEqual(bo.next_seq({"overlay": pointer}), 1, pointer)


class Summary(unittest.TestCase):
    def test_it_reports_what_changed_and_what_it_will_cost_a_reader(self):
        temp = tempfile.mkdtemp(prefix="build_overlay_summary_")
        self.addCleanup(shutil.rmtree, temp, True)
        root = Path(temp)
        base = write_tree(root / "base", {
            "home.json": EMPTY_HOME,
            "latest.json": {"generated_at": "2026-09-20T12:00:00+00:00",
                            "articles": []},
        })
        manifest = {"run_id": "2026-09-20T120000Z-1",
                    "bundle": tree_inventory(base)}

        def fake_build(out_dir: Path, latest: int, base: Path) -> None:
            write_tree(out_dir, {
                "home.json": EMPTY_HOME,
                "latest.json": {"generated_at": "2026-09-20T12:05:00+00:00",
                                "articles": []},
                "articles/new.bg.json": {
                    "domain": "new.bg", "outlet": "New",
                    "generated_at": "2026-09-20T12:04:00+00:00",
                    "articles": [{"url": "https://new.bg/1",
                                  "published": "2026-09-20T12:04:00+00:00"}]},
                "stories/s1.json": {"generated_at": "2026-09-20T12:04:00+00:00",
                                    "story": {"id": "s1"}, "related": []},
            })

        with mock.patch.object(bo, "live_manifest", return_value=manifest), \
                mock.patch.object(bo, "build_current", side_effect=fake_build), \
                mock.patch.object(bo, "evaluate_home_payload",
                                  return_value={"ready": True}):
            summary = bo.build(base, root / "overlay.json", latest=150)

        self.assertEqual(summary["base_run_id"], manifest["run_id"])
        self.assertEqual(summary["seq"], 1)
        self.assertEqual(summary["changed"]["article_domains"], 1)
        self.assertEqual(summary["changed"]["story_details"], 1)
        # The bytes and the hash are what the manifest pointer will carry,
        # so they describe the file that was actually written.
        written = (root / "overlay.json").read_bytes()
        self.assertEqual(summary["bytes"], len(written))
        overlay = json.loads(written)
        self.assertEqual(overlay["base_run_id"], manifest["run_id"])
        self.assertEqual(overlay["schema_version"], bo.om.OVERLAY_SCHEMA_VERSION)

    def test_the_overlay_is_a_fraction_of_the_tree_it_replaces(self):
        # ⚠️ The justification, asserted rather than assumed. If an overlay
        # is the size of the tree the hot path has bought nothing.
        temp = tempfile.mkdtemp(prefix="build_overlay_size_")
        self.addCleanup(shutil.rmtree, temp, True)
        root = Path(temp)
        bulk = {f"stories/s{i}.json": {"generated_at": "2026-09-20T12:00:00+00:00",
                                       "story": {"id": f"s{i}", "x": "y" * 200},
                                       "related": []}
                for i in range(200)}
        base = write_tree(root / "base", {"home.json": EMPTY_HOME, **bulk})
        manifest = {"run_id": "r", "bundle": tree_inventory(base)}

        def fake_build(out_dir: Path, latest: int, base: Path) -> None:
            write_tree(out_dir, {
                "home.json": EMPTY_HOME, **bulk,
                "stories/new.json": {"generated_at": "2026-09-20T12:05:00+00:00",
                                     "story": {"id": "new"}, "related": []},
            })

        with mock.patch.object(bo, "live_manifest", return_value=manifest), \
                mock.patch.object(bo, "build_current", side_effect=fake_build), \
                mock.patch.object(bo, "evaluate_home_payload",
                                  return_value={"ready": True}):
            summary = bo.build(base, root / "overlay.json", latest=150)
        tree_bytes = sum(p.stat().st_size for p in base.rglob("*.json"))
        self.assertLess(summary["bytes"], tree_bytes / 10,
                        f"overlay {summary['bytes']} B against a "
                        f"{tree_bytes} B tree")


if __name__ == "__main__":
    unittest.main()
