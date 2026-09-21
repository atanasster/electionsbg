#!/usr/bin/env python3
"""prune_published_versions — the refusals, which are the whole point.

Run:  python3 news/scripts/test_prune_published_versions.py

Nothing here touches the network or a bucket: `plan()` is a pure function
over a version list, which is exactly why the destructive decision was put
in one.

⚠️ A wrong deletion here is an OUTAGE, not untidiness: a reader holding a
manifest that points at a deleted tree gets 404s for every file of the
release it is reading. The tests are therefore mostly about what must NOT
be deleted.
"""

import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
import prune_published_versions as pp  # noqa: E402


def ids(*hours):
    return [f"2026-09-20T{h:02d}0000Z-{1000+h}" for h in hours]


class Refusals(unittest.TestCase):
    def test_the_live_tree_is_never_deletable(self):
        versions = ids(1, 2, 3, 4, 5)
        for live in versions:
            kept, deletable = pp.plan(versions, live, keep=2)
            self.assertNotIn(live, deletable, live)
            self.assertIn(live, kept, live)

    def test_nothing_newer_than_live_is_deletable(self):
        # ⚠️ A publish writes its tree BEFORE it CASes the manifest, so the
        # newest tree is routinely one the manifest has not adopted yet.
        # Deleting it races the publisher and destroys the release it is
        # about to announce.
        versions = ids(1, 2, 3, 4, 5)
        _kept, deletable = pp.plan(versions, ids(3)[0], keep=2)
        for newer in ids(4, 5):
            self.assertNotIn(newer, deletable)
        self.assertEqual(deletable, ids(1, 2))

    def test_it_keeps_k_in_total(self):
        versions = ids(*range(1, 11))
        kept, deletable = pp.plan(versions, versions[-1], keep=4)
        self.assertEqual(len(kept), 4)
        self.assertEqual(len(deletable), 6)
        self.assertEqual(kept[-1], versions[-1], "the live one is kept")

    def test_k_counts_the_newer_trees_against_the_budget(self):
        # With the live release mid-list, the trees after it already occupy
        # the keep budget — so K=2 with one newer tree leaves room for none
        # older, not for two.
        versions = ids(1, 2, 3, 4, 5)
        kept, _deletable = pp.plan(versions, ids(4)[0], keep=2)
        self.assertEqual(kept, ids(4, 5))

    def test_a_small_bucket_deletes_nothing(self):
        versions = ids(1, 2)
        _kept, deletable = pp.plan(versions, versions[-1], keep=8)
        self.assertEqual(deletable, [])

    def test_an_unknown_live_release_refuses_rather_than_guessing(self):
        # If the manifest names a tree that is not there, something is wrong
        # that deletion cannot improve.
        with self.assertRaises(SystemExit):
            pp.plan(ids(1, 2, 3), "2026-09-19T000000Z-999", keep=2)

    def test_only_pipeline_run_ids_match(self):
        # The bucket also holds hand-made trees that predate this pipeline
        # and that nobody here is entitled to remove.
        for foreign in ("deploy-20260901T052500Z-final",
                        "release-20260901T121500Z-116cadac0a",
                        "image-cache-default-test", "versions", ""):
            self.assertIsNone(pp.RUN_ID_RE.match(foreign), foreign)
        for own in ("2026-09-20T080009Z-15592", "2026-09-02T145946Z-16095"):
            self.assertIsNotNone(pp.RUN_ID_RE.match(own), own)

    def test_run_ids_sort_chronologically(self):
        # `plan` slices on list order, so this is load-bearing rather than
        # cosmetic: a format whose lexical order differed from its
        # chronological one would make "older" mean the wrong thing.
        self.assertEqual(sorted(ids(3, 1, 2)), ids(1, 2, 3))
        self.assertLess("2026-09-02T145946Z-16095", "2026-09-20T080009Z-15592")

    def test_keep_below_two_is_rejected_by_the_cli(self):
        for bad in ("0", "1", "-3"):
            with self.assertRaises(SystemExit):
                pp.main(["--keep", bad])


class RetentionPolicy(unittest.TestCase):
    """T1.5 — the number of trees kept is derived from what a reader can
    still hold, and the CLI refuses a K that does not cover it."""

    def test_the_default_covers_readers_with_rollback_room(self):
        policy = pp.retention_policy()
        self.assertTrue(policy["covers_readers"])
        self.assertGreaterEqual(policy["rollback_releases"], 1)
        self.assertGreater(policy["required_span_seconds"],
                           pp.READER_EXPOSURE_SECONDS)

    def test_a_k_too_small_for_the_cache_grace_is_refused(self):
        # ⚠️ THE MUTATION THIS CATCHES: a policy that only counted the
        # manifest poll. K=2 spans one hourly release — 3600 s — which is
        # under poll + retry + grace, and the CLI must refuse it.
        self.assertFalse(pp.retention_policy(2)["covers_readers"])
        self.assertEqual(pp.MIN_KEEP, 3)
        with self.assertRaises(SystemExit):
            pp.main(["--keep", "2"])

    def test_the_default_is_derived_from_the_rollback_room(self):
        self.assertEqual(pp.DEFAULT_KEEP, pp.ROLLBACK_RELEASES + 2)
        self.assertEqual(pp.retention_policy()["rollback_releases"],
                         pp.ROLLBACK_RELEASES)

    def test_a_failed_delete_is_reported_and_fails_the_run(self):
        # ⚠️ Unattended now: „deleted 3 trees" about three failures is how a
        # permissions problem stays invisible. Counted by exit code.
        from unittest import mock
        with mock.patch.object(pp, "live_run_id", return_value="2026-09-21T100000Z-1"), \
             mock.patch.object(pp, "list_versions", return_value=(
                 ["2026-09-21T060000Z-1", "2026-09-21T070000Z-1",
                  "2026-09-21T080000Z-1", "2026-09-21T090000Z-1",
                  "2026-09-21T100000Z-1"], 5)), \
             mock.patch.object(pp.subprocess, "run",
                               return_value=mock.Mock(returncode=1)) as run:
            code = pp.main(["--apply", "--keep", "3"])
        self.assertEqual(code, 1)
        self.assertEqual(run.call_count, 2)

    def test_storage_is_bounded_by_k(self):
        policy = pp.retention_policy(8)
        self.assertLess(policy["storage_bytes_estimate"], 400 * 1024 * 1024)


if __name__ == "__main__":
    unittest.main()
