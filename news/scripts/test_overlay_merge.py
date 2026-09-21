#!/usr/bin/env python3
"""Plan §4.6(a) — merged base+overlay ≡ full rebuild.

Run:  python3 news/scripts/test_overlay_merge.py

⚠️ THE EQUALITY TEST IS THE WHOLE POINT AND IT IS NOT A UNIT TEST. Every
other assertion here could pass against a merge that is subtly wrong in the
same way the fixture is; only comparing against a REAL second build of a
REAL corpus can catch that. So `EqualsFullRebuild` runs `build_app_data`
twice as a subprocess — once on a base corpus, once on that corpus plus new
articles — diffs the two published trees, merges the diff onto the base and
asserts the result equals the second build, PAYLOAD for payload, path for
path. (Payload, not bytes: the merge never serialises, so key order is not
its business and a new outlet's bundle legitimately differs in it.)

What that buys, concretely: a hot release publishes ONE object instead of
~2,100, and the guarantee that a reader holding the base plus that object
sees exactly what an hourly reader would have seen. If this test ever goes
red, the overlay must not be published — a divergence here is a reader
being shown a release that never existed.

⚠️ THE FIRST CUT OF THIS FILE WAS PURELY ADDITIVE, AND THAT IS HOW TWO
CORRECTNESS DEFECTS SHIPPED PAST IT. Every fixture added articles and none
ever removed one, so all four removal arms of the overlay were empty in
every run — a removed outlet's articles stayed at the top of `latest.json`
pointing at a bundle the same release deleted, and a record leaving the
feed's truncation boundary shortened the feed for good. `Removals` below
exists for that reason: an equality test is only as strong as the shapes
its fixture actually produces, and "it passes" says nothing about a branch
no fixture reaches.
"""

import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

# ⚠️ BEFORE the two imports below, not merely above them in the file. Both
# resolve through `news/scripts`, and the second pulls in `build_app_data`
# transitively — so an editor that sorts imports alphabetically would put
# them ahead of the path insert and break the module on a checkout where
# nothing else has put that directory on the path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import overlay_merge as om  # noqa: E402
from test_build_app_data import BuildAppDataFixture  # noqa: E402

BUILD_AS_OF = "2026-09-19T12:00:00+00:00"
LATEST_LIMIT = 150


def read_release(out_dir) -> dict:
    """A published tree as {path: payload}, which is what the merge speaks."""
    root = Path(out_dir)
    return {str(p.relative_to(root)): json.loads(p.read_text(encoding="utf-8"))
            for p in sorted(root.rglob("*.json"))}


class MergePrimitives(unittest.TestCase):
    """The small rules, stated where they can be read without a build."""

    def test_upsert_replaces_in_place_and_appends_the_genuinely_new(self):
        base = [{"k": "a", "v": 1}, {"k": "b", "v": 2}]
        got = om.upsert(base, [{"k": "b", "v": 9}, {"k": "c", "v": 3}],
                        key=lambda r: r["k"])
        self.assertEqual([r["k"] for r in got], ["a", "b", "c"])
        self.assertEqual(got[1]["v"], 9)

    def test_a_touched_record_is_not_published_twice(self):
        # The defect a bare "prepend the overlay" merge has: a re-analysed
        # article is in the base AND in the overlay.
        base = [{"k": "a", "v": 1}]
        got = om.upsert(base, [{"k": "a", "v": 2}], key=lambda r: r["k"])
        self.assertEqual(len(got), 1)

    def test_removals_win_over_an_incoming_row(self):
        got = om.upsert([{"k": "a"}], [{"k": "a"}], key=lambda r: r["k"],
                        removed={"a"})
        self.assertEqual(got, [])

    def test_latest_is_truncated_after_the_sort_not_before(self):
        # Truncating first drops an overlay record that should have
        # displaced an older one — the feed then silently stops updating.
        base = {"articles": [{"url": f"u{i}", "published": f"2026-09-0{i}"}
                             for i in (3, 2, 1)]}
        got = om.merge_latest(base, [{"url": "new", "published": "2026-09-09"}],
                              limit=3, generated_at="S")
        self.assertEqual([r["url"] for r in got["articles"]], ["new", "u3", "u2"])

    def test_an_article_with_no_publication_date_stays_out_of_the_feed(self):
        got = om.merge_latest({"articles": []}, [{"url": "u"}],
                              limit=3, generated_at="S")
        self.assertEqual(got["articles"], [])

    def test_a_moved_member_stops_pointing_at_the_story_it_left(self):
        # ⚠️ The by-url map is REBUILT for every touched story, not patched.
        # When two stories merge, the members move; a dict update leaves the
        # moved urls resolving to a story that no longer contains them, and
        # ArticleScreen then fetches a detail file without the article the
        # reader is on.
        base = {"stories_by_url": {"https://x/1": "old", "https://x/2": "old"}}
        got = om.merge_stories_by_url(
            base,
            [{"id": "old", "members": [{"url": "https://x/1"}]},
             {"id": "new", "members": [{"url": "https://x/2"}]}],
            generated_at="S")
        self.assertEqual(got["stories_by_url"],
                         {"https://x/1": "old", "https://x/2": "new"})

    def test_the_index_repaginates_rather_than_patching_one_page(self):
        pages = [{"page": 1, "pages": 2, "page_size": 2, "total": 4,
                  "stories": [{"id": "d", "last_published": "4"},
                              {"id": "c", "last_published": "3"}]},
                 {"page": 2, "pages": 2, "page_size": 2, "total": 4,
                  "stories": [{"id": "b", "last_published": "2"},
                              {"id": "a", "last_published": "1"}]}]
        got = om.merge_story_index(
            pages, [{"id": "a", "last_published": "9"}],
            page_size=2, generated_at="S")
        # `a` moved to the front, so BOTH pages change — the boundary moved.
        self.assertEqual([s["id"] for s in got[0]["stories"]], ["a", "d"])
        self.assertEqual([s["id"] for s in got[1]["stories"]], ["c", "b"])
        self.assertEqual({p["total"] for p in got}, {4})

    def test_the_page_count_can_go_down(self):
        pages = [{"page": 1, "pages": 2, "page_size": 2, "total": 3,
                  "stories": [{"id": "c"}, {"id": "b"}]},
                 {"page": 2, "pages": 2, "page_size": 2, "total": 3,
                  "stories": [{"id": "a"}]}]
        got = om.merge_story_index(pages, [], removed_ids=["a"],
                                   page_size=2, generated_at="S")
        self.assertEqual(len(got), 1)

    def test_story_objects_are_derived_from_the_detail_files(self):
        overlay = {"story_details": {"s2": {"story": {"id": "s2"}},
                                     "s1": {"story": {"id": "s1"}}}}
        self.assertEqual([s["id"] for s in om.overlay_stories(overlay)],
                         ["s1", "s2"])


class EqualsFullRebuild(BuildAppDataFixture):
    """merge(base, full − base) ≡ full, on two real builds."""

    def build_into(self, *extra, latest_limit=LATEST_LIMIT, stamp_from=None):
        """Build into a throwaway tree and return it parsed.

        The tree is registered for cleanup here rather than at each call
        site: every test makes two of them, and `addCleanup(lambda: None)`
        — which is what this replaced — removes nothing at all.

        ⚠️ `stamp_from` is how the REAL hot path builds (`build_overlay.py`
        passes the base), and a test that omitted it was structurally
        blind to stamp preservation: every file carried this build's
        timestamp, so every file differed, and the equality property held
        over a release shape production never produces.
        """
        out = tempfile.mkdtemp(prefix="overlay_release_")
        self.addCleanup(shutil.rmtree, out, True)
        self.out_dir = out
        if stamp_from is not None:
            extra = (*extra, "--stamp-from", str(stamp_from))
        # ⚠️ THE CLOCK IS PINNED. Prominence decays against `as_of`, so a
        # wall-clock build gives every story a different `age_hours` on every
        # run — which makes the committed cross-language vectors unstable and
        # any two-release byte comparison meaningless.
        if not any(str(x) == "--as-of" for x in extra):
            extra = (*extra, "--as-of", BUILD_AS_OF)
        self.run_build("--latest", str(latest_limit), *extra)
        return read_release(out)

    def remove(self, domain, slug, *, drop_outlet=False):
        """Retire an article the way the corpus actually retires one.

        ⚠️ DELETING THE TWO OBVIOUS FILES IS NOT A REMOVAL, and the first
        cut of these tests did exactly that and asserted nothing. The
        article and its analysis went; `analysis/index.json` and
        `analysis/stories/<id>.json` stayed, so the story was still built —
        `removed_story_ids` came back empty and the test passed while
        exercising none of the arm it names. The empty domain DIRECTORY
        survives too, and the builder writes an empty bundle for it, so the
        outlet never looks gone either.
        """
        analysis_root = Path(self.data_dir) / "analysis"
        analysis_path = analysis_root / "articles" / domain / f"{slug}.json"
        url = json.loads(analysis_path.read_text(encoding="utf-8"))["url"]
        analysis_path.unlink()
        (Path(self.data_dir) / domain / f"{slug}.json").unlink()
        if drop_outlet:
            shutil.rmtree(Path(self.data_dir) / domain, ignore_errors=True)
            shutil.rmtree(analysis_root / "articles" / domain, ignore_errors=True)

        index_path = analysis_root / "index.json"
        index = json.loads(index_path.read_text(encoding="utf-8"))
        story_id = (index.get("articles") or {}).pop(url, {}).get("story_id")
        if story_id and not any(row.get("story_id") == story_id
                                for row in (index.get("articles") or {}).values()):
            # The last member went, so the story goes with it — which is
            # what makes this a STORY removal rather than a member change.
            (index.get("stories") or {}).pop(story_id, None)
            (analysis_root / "stories" / f"{story_id}.json").unlink(missing_ok=True)
        index_path.write_text(json.dumps(index, ensure_ascii=False),
                              encoding="utf-8")
        return url

    def article(self, domain, slug, *, published, title):
        return {"url": f"https://{domain}/{slug}", "domain": domain,
                "title": title, "published": published,
                "first_seen": published,
                # ⚠️ Long enough that `excerpt_of` actually TRUNCATES (its
                # limit is 480 characters). Shrinking this to trim the
                # committed vectors took every fixture article below that
                # and quietly stopped exercising the excerpt at all.
                "content": f"Съдържание на {slug}. " * 30}

    def seed_base(self):
        """Two outlets, two stories — one of which the overlay will touch."""
        for index, (domain, slug) in enumerate(
                [("a.bg", "one"), ("a.bg", "two"), ("b.bg", "three")]):
            published = f"2026-09-1{index}T09:00:00+00:00"
            article = self.article(domain, slug, published=published,
                                   title=f"Заглавие {index}")
            self.write_corpus(domain, f"{slug}.json", article)
            self.write_analysis(domain, f"{slug}.json", self.analysis_record(
                article["url"], domain, f"news/data/{domain}/{slug}.json",
                action="new_story" if index != 1 else "add_to_story",
                story_id=None if index != 1 else "story-0"))

    def test_a_new_story_a_touched_story_and_a_new_outlet_merge_exactly(self):
        self.seed_base()
        base = self.build_into()
        base_dir = Path(self.out_dir)

        # Three shapes in one release, because each breaks a different merge:
        #  - a brand-new story in an EXISTING outlet (index insert + detail)
        #  - a new member for an EXISTING story (story object changes)
        #  - an article in a NEW outlet (a bundle the base has no file for)
        for domain, slug, published, action, story_id in [
                ("a.bg", "four", "2026-09-19T09:00:00+00:00", "new_story", None),
                ("b.bg", "five", "2026-09-19T10:00:00+00:00", "add_to_story",
                 "story-0"),
                ("c.bg", "six", "2026-09-19T11:00:00+00:00", "new_story", None)]:
            article = self.article(domain, slug, published=published,
                                   title=f"Ново {slug}")
            self.write_corpus(domain, f"{slug}.json", article)
            self.write_analysis(domain, f"{slug}.json", self.analysis_record(
                article["url"], domain, f"news/data/{domain}/{slug}.json",
                action=action, story_id=story_id))

        full = self.build_into(stamp_from=base_dir)

        overlay = om.diff_overlay(base, full, seq=1, base_run_id="RUN-BASE",
                                  generated_at="2026-09-19T12:00:00Z",
                                  latest_limit=LATEST_LIMIT)
        merged = om.apply_overlay(base, overlay)

        self.assertEqual(sorted(merged), sorted(full),
                         "the merge invented or dropped a published path")
        for path in sorted(full):
            if path.startswith("stories/ranked-"):
                # ⚠️ DELIBERATELY NOT BYTE-EQUAL, and the divergence is the
                # design. Prominence DECAYS with the instant it was scored
                # against, so an overlay that re-ranked would have to re-score
                # the whole corpus — the full rebuild it exists to avoid. It
                # keeps the base's `as_of`, marks `stale_ranking`, and is
                # checked below for the properties that DO have to hold.
                self.assert_ranked_divergence(merged[path], full[path], path)
                continue
            self.assertEqual(merged[path], full[path], path)

    def assert_release_matches(self, merged, full, why=""):
        """Whole-release equality, with the ranked pages' intended lag."""
        self.assertEqual(sorted(merged), sorted(full), why)
        for path in sorted(full):
            if path.startswith("stories/ranked-"):
                self.assert_ranked_divergence(merged[path], full[path], path)
                continue
            self.assertEqual(merged[path], full[path], f"{path} {why}")

    def assert_ranked_divergence(self, merged_page, full_page, path):
        """The ranked page may lag; it may not lie about WHICH stories exist."""
        self.assertEqual({r["id"] for r in merged_page["stories"]},
                         {r["id"] for r in full_page["stories"]}, path)
        self.assertEqual(merged_page["total"], full_page["total"], path)
        self.assertEqual(merged_page["pages"], full_page["pages"], path)
        self.assertIs(full_page["stale_ranking"], False, path)
        self.assertEqual(full_page["as_of"], full_page["generated_at"], path)
        # The merged page is honest about being scored earlier.
        self.assertTrue(merged_page["stale_ranking"], path)
        # ⚠️ NEVER NEWER THAN THE REBUILD — `assertLess` would be wrong, and
        # was: with the fixture clock pinned both builds share one instant, so
        # the merge legitimately equals it. What must never happen is a merged
        # page claiming a FRESHER ranking than it computed.
        self.assertLessEqual(merged_page["as_of"], full_page["as_of"], path)

    def test_a_clock_that_moved_alone_ships_nothing_of_substance(self):
        """⚠️ THE DEFECT THIS SUITE WAS BLIND TO, and it broke the hot path.

        A detail file's stamp is content-derived so an unchanged story stays
        byte-identical between releases. `prominence` decays against the run
        clock, so leaving it in the comparison makes EVERY story look changed:
        measured on this fixture, nothing edited and five minutes of wall
        clock shipped 3 of 3 details. At production scale that is ~3,031
        details / 11.0 MB against the 2 MB overlay ceiling — every hot publish
        refused, every cold one re-uploading the corpus to convey nothing.

        Every other test here pins ONE `--as-of` for both builds, which is
        exactly why none of them could see it.
        """
        self.seed_base()
        base = self.build_into()
        base_dir = self.out_dir
        # Same corpus, later clock. Nothing about any story has changed.
        later = self.build_into("--as-of", "2026-09-19T12:05:00+00:00",
                                stamp_from=base_dir)
        overlay = om.diff_overlay(base, later, seq=1, base_run_id="RUN-BASE",
                                  generated_at="2026-09-19T12:05:00Z",
                                  latest_limit=LATEST_LIMIT)
        self.assertEqual(overlay["story_details"], {},
                         "a clock that moved alone shipped story details")
        # ⚠️ AND NOTHING ELSE OF SUBSTANCE EITHER. The name of this test claims
        # „ships nothing", so it must check more than one arm — the filter
        # index is a whole-corpus file, and while it carried a decaying score
        # it shipped ~248 KB on every run including this one.
        self.assertNotIn("stories/filter-index.json",
                         overlay.get("replaced_paths") or {},
                         "the filter index shipped on a clock-only run")

    def test_the_filter_index_reaches_the_reader_after_a_hot_release(self):
        """⚠️ A story published in the hot window must be FILTERABLE, not just
        present in the pages.

        `_is_merged_path` returned True for everything under `stories/`, and
        nothing merges the filter index — so the overlay passed the BASE's
        copy through and a new story was absent from every facet while being
        listed on every page. That is „filter what you happen to have", one
        layer down from the client defect the index exists to remove.
        """
        self.seed_base()
        base = self.build_into()
        base_dir = self.out_dir
        article = self.article("c.bg", "fresh",
                               published="2026-09-18T09:00:00+00:00",
                               title="Съвсем нова история")
        self.write_corpus("c.bg", "fresh.json", article)
        self.write_analysis("c.bg", "fresh.json", self.analysis_record(
            article["url"], "c.bg", "news/data/c.bg/fresh.json",
            action="new_story", story_id=None))
        full = self.build_into(stamp_from=base_dir)
        overlay = om.diff_overlay(base, full, seq=1, base_run_id="RUN-BASE",
                                  generated_at="2026-09-19T12:00:00Z",
                                  latest_limit=LATEST_LIMIT)
        merged = om.apply_overlay(base, overlay)
        index = merged["stories/filter-index.json"]
        self.assertEqual(index["total"],
                         full["stories/filter-index.json"]["total"])
        self.assertIn("c.bg", index["facets"]["domains"],
                      "the new outlet never reached the facet counts")
        # And the index agrees with the pages about which stories exist.
        paged = {row["id"]
                 for path, page in merged.items()
                 if path.startswith("stories/index-")
                 for row in page["stories"]}
        self.assertEqual({row[0] for row in index["stories"]}, paged)

    def test_a_story_whose_content_changed_still_ships(self):
        """The guard must not become „never ship a detail"."""
        self.seed_base()
        base = self.build_into()
        base_dir = self.out_dir
        self.write_corpus("a.bg", "one.json",
                          self.article("a.bg", "one",
                                       published="2026-09-10T09:00:00+00:00",
                                       title="Различно заглавие"))
        changed = self.build_into(stamp_from=base_dir)
        overlay = om.diff_overlay(base, changed, seq=1,
                                  base_run_id="RUN-BASE",
                                  generated_at="2026-09-19T12:00:00Z",
                                  latest_limit=LATEST_LIMIT)
        self.assertTrue(overlay["story_details"],
                        "a real content change shipped nothing")

    def test_the_overlay_is_a_small_fraction_of_the_release(self):
        # ⚠️ Not a performance nicety — it is the ENTIRE justification. If
        # an overlay is the size of the tree, the hot path has bought
        # nothing and the cadence argument in §5.3 collapses.
        self.seed_base()
        base = self.build_into()
        base_dir = Path(self.out_dir)
        article = self.article("a.bg", "seven",
                               published="2026-09-19T09:00:00+00:00",
                               title="Само една нова")
        self.write_corpus("a.bg", "seven.json", article)
        self.write_analysis("a.bg", "seven.json", self.analysis_record(
            article["url"], "a.bg", "news/data/a.bg/seven.json",
            action="new_story"))
        full = self.build_into(stamp_from=base_dir)
        overlay = om.diff_overlay(base, full, seq=1, base_run_id="RUN-BASE",
                                  generated_at="2026-09-19T12:00:00Z",
                                  latest_limit=LATEST_LIMIT)
        overlay_bytes = len(json.dumps(overlay, ensure_ascii=False).encode())
        release_bytes = sum(
            len(json.dumps(p, ensure_ascii=False).encode()) for p in full.values())
        self.assertLess(overlay_bytes, release_bytes / 2,
                        f"overlay {overlay_bytes} B vs release {release_bytes} B")

    def test_every_arm_of_the_overlay_is_load_bearing(self):
        # ⚠️ A MUTATION SWEEP, because "merged == full" is satisfied by any
        # pair of implementations that are wrong in the same way — and the
        # differ and the merger were written together, which is exactly when
        # that happens. Emptying ANY one arm must break the equality; an arm
        # that can be deleted without the test noticing is an arm the test
        # is not checking, and the next person to touch it gets no warning.
        self.seed_base()
        base = self.build_into()
        base_dir = Path(self.out_dir)
        for domain, slug, action, story_id in [
                ("a.bg", "eight", "new_story", None),
                ("b.bg", "nine", "add_to_story", "story-0")]:
            article = self.article(domain, slug,
                                   published="2026-09-19T09:00:00+00:00",
                                   title=f"Новина {slug}")
            self.write_corpus(domain, f"{slug}.json", article)
            self.write_analysis(domain, f"{slug}.json", self.analysis_record(
                article["url"], domain, f"news/data/{domain}/{slug}.json",
                action=action, story_id=story_id))
        full = self.build_into(stamp_from=base_dir)
        overlay = om.diff_overlay(base, full, seq=1, base_run_id="RUN-BASE",
                                  generated_at="2026-09-19T12:00:00Z",
                                  latest_limit=LATEST_LIMIT)
        self.assert_release_matches(
            om.apply_overlay(base, overlay), full,
            "the unmutated merge must agree before any mutation of it means "
            "anything")
        empty = {"articles": {}, "story_details": {}, "bundle_envelopes": {},
                 "replaced_paths": {}, "home": None}
        for arm, blank in empty.items():
            with self.subTest(arm=arm):
                self.assertTrue(overlay[arm],
                                f"the fixture exercises no {arm} — the "
                                f"mutation below would pass for free")
                merged = om.apply_overlay(base, {**overlay, arm: blank})
                # ⚠️ COMPARED WITHOUT THE RANKED PAGES. Those lag by design,
                # so a whole-dict inequality here would be satisfied by the
                # lag alone and the mutation would pass for free — the exact
                # vacuity this test exists to prevent.
                def without_ranked(release):
                    return {k: v for k, v in release.items()
                            if not k.startswith("stories/ranked-")}
                self.assertNotEqual(
                    without_ranked(merged), without_ranked(full),
                    f"emptying `{arm}` did not break the merge — the "
                    f"equality assertion does not cover it")


class Removals(EqualsFullRebuild):
    """The shapes the additive fixture above can never produce.

    ⚠️ Inherits the harness AND its tests, which is normally the mistake
    `BuildAppDataFixture` warns about — here it is deliberate and cheap:
    re-running the additive cases costs four subprocess builds on a
    three-article corpus, and it means a change to `build_into` cannot
    leave one class green and the other broken.
    """

    def test_a_removed_outlet_leaves_the_feed_as_well_as_the_bundle(self):
        # ⚠️ THE DEFECT THIS WAS WRITTEN FOR: the differ walked only the
        # domains present in the REBUILD, so a vanished outlet contributed
        # `removed_domains` (which drops the bundle) and no
        # `removed_article_urls` (which is what drops its articles from the
        # corpus-wide feed). Measured before the fix: the removed outlet's
        # article stayed the top card of `latest.json`, linking to a bundle
        # the same release had deleted.
        self.seed_base()
        article = self.article("c.bg", "gone",
                               published="2026-09-19T09:00:00+00:00",
                               title="Ще изчезне")
        self.write_corpus("c.bg", "gone.json", article)
        self.write_analysis("c.bg", "gone.json", self.analysis_record(
            article["url"], "c.bg", "news/data/c.bg/gone.json",
            action="new_story"))
        base = self.build_into()
        base_dir = Path(self.out_dir)
        self.assertIn("articles/c.bg.json", base)
        self.assertIn(article["url"],
                      [r["url"] for r in base["latest.json"]["articles"]])

        self.remove("c.bg", "gone", drop_outlet=True)
        full = self.build_into(stamp_from=base_dir)
        self.assertNotIn("articles/c.bg.json", full,
                         "the fixture did not actually retire the outlet")

        overlay = om.diff_overlay(base, full, seq=1, base_run_id="RUN-BASE",
                                  generated_at="2026-09-19T12:00:00Z",
                                  latest_limit=LATEST_LIMIT)
        self.assertEqual(overlay["removed_domains"], ["c.bg"])
        self.assertIn(article["url"], overlay["removed_article_urls"]["c.bg"])
        merged = om.apply_overlay(base, overlay)
        self.assertEqual(sorted(merged), sorted(full))
        for path in sorted(full):
            if path.startswith("stories/ranked-"):
                self.assert_ranked_divergence(merged[path], full[path], path)
                continue
            self.assertEqual(merged[path], full[path], path)

    def test_a_removed_story_loses_its_detail_page_and_its_index_row(self):
        self.seed_base()
        base = self.build_into()
        base_dir = Path(self.out_dir)
        self.remove("b.bg", "three")
        full = self.build_into(stamp_from=base_dir)
        overlay = om.diff_overlay(base, full, seq=1, base_run_id="RUN-BASE",
                                  generated_at="2026-09-19T12:00:00Z",
                                  latest_limit=LATEST_LIMIT)
        self.assertTrue(overlay["removed_story_ids"],
                        "the fixture removed no story — this asserts nothing")
        merged = om.apply_overlay(base, overlay)
        self.assertEqual(sorted(merged), sorted(full))
        for path in sorted(full):
            if path.startswith("stories/ranked-"):
                self.assert_ranked_divergence(merged[path], full[path], path)
                continue
            self.assertEqual(merged[path], full[path], path)

    def test_the_feed_refills_its_truncation_boundary(self):
        # ⚠️ THE SECOND DEFECT: with the feed at its limit, a record that
        # LEAVES the top N frees a slot whose new occupant is in neither
        # input — it was past the cut in the base and it did not change, so
        # the overlay has no reason to carry it. The merge then publishes a
        # feed one article short, indefinitely, at a 200. A limit of 3 here
        # makes the boundary reachable with a four-article corpus; at the
        # production 150 the same arithmetic needs 151.
        for index in range(4):
            slug = f"feed{index}"
            article = self.article("a.bg", slug,
                                   published=f"2026-09-1{index}T09:00:00+00:00",
                                   title=f"Емисия {index}")
            self.write_corpus("a.bg", f"{slug}.json", article)
            self.write_analysis("a.bg", f"{slug}.json", self.analysis_record(
                article["url"], "a.bg", f"news/data/a.bg/{slug}.json",
                action="new_story"))
        base = self.build_into(latest_limit=3)
        base_dir = Path(self.out_dir)
        self.assertEqual(len(base["latest.json"]["articles"]), 3)

        self.remove("a.bg", "feed3")
        full = self.build_into(latest_limit=3, stamp_from=base_dir)
        self.assertEqual(len(full["latest.json"]["articles"]), 3,
                         "the rebuild refilled the slot, so the merge must too")

        overlay = om.diff_overlay(base, full, seq=1, base_run_id="RUN-BASE",
                                  generated_at="2026-09-19T12:00:00Z",
                                  latest_limit=3)
        merged = om.apply_overlay(base, overlay)
        self.assertEqual(merged["latest.json"], full["latest.json"])

        # ⚠️ And the escape is what did it — without this the assertion
        # above passes for any merge that happens to be right on this
        # fixture. Dropping the carried copy must leave the feed SHORT,
        # which is the defect in its original form.
        self.assertIn("latest.json", overlay["replaced_paths"],
                      "the truncation escape did not fire, so the "
                      "assertion above is not testing it")
        without = {**overlay,
                   "replaced_paths": {k: v for k, v
                                      in overlay["replaced_paths"].items()
                                      if k != "latest.json"}}
        self.assertLess(
            len(om.apply_overlay(base, without)["latest.json"]["articles"]),
            len(full["latest.json"]["articles"]),
            "the merge refilled the slot on its own — then the escape is "
            "machinery for nothing and should be deleted, not kept")

    def test_a_base_missing_a_merged_file_gets_it_rather_than_losing_it(self):
        # ⚠️ Every per-path merge folds into what the BASE holds, so a
        # singleton the base does not have has nothing to merge into — and
        # `_is_merged_path` bars it from `replaced_paths`, so without the
        # `carry_whole` escape there is no second route and the file simply
        # vanishes from the merged release. That is a first overlay against
        # a base an older builder wrote, and nothing about it is loud.
        self.seed_base()
        base = self.build_into()
        base_dir = Path(self.out_dir)
        for path in ("latest.json", "stories/by-url.json", "home.json"):
            with self.subTest(path=path):
                crippled = {k: v for k, v in base.items() if k != path}
                full = self.build_into(stamp_from=base_dir)
                overlay = om.diff_overlay(
                    crippled, full, seq=1, base_run_id="RUN-BASE",
                    generated_at="2026-09-19T12:00:00Z",
                    latest_limit=LATEST_LIMIT)
                merged = om.apply_overlay(crippled, overlay)
                self.assertIn(path, merged)
                if path.startswith("stories/ranked-"):
                    self.assert_ranked_divergence(merged[path], full[path], path)
                    continue
                self.assertEqual(merged[path], full[path])

    def test_a_multi_page_index_repaginates_against_a_real_rebuild(self):
        # The hand-built pages in `MergePrimitives` fix the page size
        # themselves; this one makes the BUILDER produce several pages, so
        # the boundary under test is the one the builder actually writes.
        original = om.STORY_PAGE_SIZE
        for index in range(5):
            slug = f"page{index}"
            article = self.article("a.bg", slug,
                                   published=f"2026-09-1{index}T09:00:00+00:00",
                                   title=f"Страница {index}")
            self.write_corpus("a.bg", f"{slug}.json", article)
            self.write_analysis("a.bg", f"{slug}.json", self.analysis_record(
                article["url"], "a.bg", f"news/data/a.bg/{slug}.json",
                action="new_story"))
        base = self.build_into("--story-page-size", "2")
        base_dir = Path(self.out_dir)
        self.assertGreater(len([p for p in base if p.startswith("stories/index-")]),
                           1, "the fixture produced one page — nothing paginates")
        self.assertEqual(original, om.STORY_PAGE_SIZE, "the import moved")

        article = self.article("a.bg", "newest",
                               published="2026-09-20T09:00:00+00:00",
                               title="Най-новата")
        self.write_corpus("a.bg", "newest.json", article)
        self.write_analysis("a.bg", "newest.json", self.analysis_record(
            article["url"], "a.bg", "news/data/a.bg/newest.json",
            action="new_story"))
        full = self.build_into("--story-page-size", "2", stamp_from=base_dir)

        overlay = om.diff_overlay(base, full, seq=1, base_run_id="RUN-BASE",
                                  generated_at="2026-09-20T12:00:00Z",
                                  latest_limit=LATEST_LIMIT)
        merged = om.apply_overlay(base, overlay)
        self.assertEqual(sorted(merged), sorted(full))
        for path in sorted(full):
            if path.startswith("stories/ranked-"):
                self.assert_ranked_divergence(merged[path], full[path], path)
                continue
            self.assertEqual(merged[path], full[path], path)


VECTORS = (Path(__file__).resolve().parents[1]
           / "eval_contract" / "overlay_vectors.json")

# The paths the CLIENT merges. The publisher merges more (the paginated
# index), but a browser holds a prefix rather than a release, so those are
# merged at the hook level and cannot be expressed as a per-path vector.
VECTOR_PATHS = ("latest.json", "stories.json", "stories/by-url.json",
                "home.json")


class SharedVectors(EqualsFullRebuild):
    """The cross-language pin between this merge and the TypeScript one.

    ⚠️ Inherits the harness AND its tests, the same deliberate exception
    `Removals` makes: re-running the additive equality cases costs a few
    subprocess builds on a three-article corpus, and it means a change to
    `build_into` or `scenario` cannot leave one class green and another
    silently broken.

    ⚠️ THE TWO IMPLEMENTATIONS CANNOT SHARE CODE — a browser cannot import
    Python — so they are kept in step the way `canonical.py`/`canonical.ts`
    are: by a committed vectors file that one side GENERATES and the other
    REPLAYS. This test regenerates it from real builds and fails when the
    committed copy is stale; `newsapp/app/overlayMerge.test.ts` fails when
    its merge does not reproduce every case.

    Neither half is optional. Without the generator the file rots into a
    fixture of whatever the TS merge already does, which is the shape that
    makes a twin agree with itself and with nothing else.
    """

    @staticmethod
    def normalise(value, stamps: dict):
        """Replace the two RUN stamps with fixed tokens, recursively.

        ⚠️ WITHOUT THIS THE FILE IS NOT REPRODUCIBLE AND THE PIN IS DEAD.
        `latest.json`, `stories.json` and the story index carry the wall
        clock of the run that wrote them, so two builds of identical
        content differ — the generator would rewrite the vectors on every
        invocation and the "committed copy is stale" failure would fire
        for ever, which trains everyone to ignore it. The content-derived
        stamps (per-domain bundles, story details) are NOT touched: those
        are real facts about the data and a merge that got one wrong must
        still fail here.
        """
        if isinstance(value, dict):
            return {k: SharedVectors.normalise(v, stamps)
                    for k, v in value.items()}
        if isinstance(value, list):
            return [SharedVectors.normalise(v, stamps) for v in value]
        return stamps.get(value, value) if isinstance(value, str) else value

    def scenario(self, name, mutate) -> dict:
        self.seed_base()
        base = self.build_into()
        base_dir = Path(self.out_dir)
        mutate()
        full = self.build_into(stamp_from=base_dir)
        overlay = om.diff_overlay(base, full, seq=1, base_run_id="RUN-BASE",
                                  generated_at="2026-09-19T12:00:00Z",
                                  latest_limit=LATEST_LIMIT)
        merged = om.apply_overlay(base, overlay)
        paths = [p for p in VECTOR_PATHS if p in base]
        # A story the scenario touched, so the detail arm is covered too.
        touched = sorted(overlay["story_details"])[:1]
        paths += [f"stories/{sid}.json" for sid in touched]
        paths += sorted(f"articles/{d}.json" for d in overlay["articles"])
        # ⚠️ AND THE ARM THAT MUST WIN OVER ALL OF THEM. `replaced_paths`
        # carries a whole file when no delta can express it — including
        # `latest.json` when a record leaves the feed's truncation
        # boundary. A twin that consulted it AFTER its merge arms would
        # pass every other vector here and still serve a short feed, so the
        # rows that pin the PRECEDENCE are the ones worth having.
        # ⚠️ THE FILTER INDEX IS ALWAYS INCLUDED WHEN PRESENT, not left to a
        # `[:2]` slice it loses. It sorts third alphabetically, so the slice
        # deterministically EXCLUDED it and the TypeScript twin's handling of
        # a whole-corpus carried file went untested in both directions.
        replaced = sorted(overlay["replaced_paths"])
        pinned = [p for p in replaced if p.endswith("filter-index.json")]
        paths += pinned + [p for p in replaced if p not in pinned][:2]
        stamps = {
            base["latest.json"]["generated_at"]: "BASE-RUN-STAMP",
            full["latest.json"]["generated_at"]: "RELEASE-RUN-STAMP",
        }
        return self.normalise({
            "name": name,
            "overlay": overlay,
            "paths": [{"path": f"/{p}",
                       "base": base.get(p),
                       "expected": merged[p]}
                      for p in dict.fromkeys(paths) if p in merged],
            # A throw cannot be an expected PAYLOAD, so the paths this
            # release retires are listed separately and the TypeScript side
            # asserts each one is refused rather than served stale.
            "removed": sorted(
                [f"/{p}" for p in overlay["removed_paths"]]
                + [f"/stories/{sid}.json"
                   for sid in overlay["removed_story_ids"]]
                + [f"/articles/{d}.json" for d in overlay["removed_domains"]]),
            # The index ROW projection — `story_index_row` decides which
            # fields a list screen gets, and the client has to reproduce it
            # to merge its accumulated prefix. Unpinned it is a callback
            # the caller can get wrong in a way nothing here would see.
            "index_rows": {
                sid: om.story_index_row(payload["story"])
                for sid, payload in sorted(overlay["story_details"].items())
            },
        }, stamps)

    def add(self, domain, slug, *, action="new_story", story_id=None,
            published="2026-09-19T09:00:00+00:00"):
        article = self.article(domain, slug, published=published,
                               title=f"Заглавие {slug}")
        self.write_corpus(domain, f"{slug}.json", article)
        self.write_analysis(domain, f"{slug}.json", self.analysis_record(
            article["url"], domain, f"news/data/{domain}/{slug}.json",
            action=action, story_id=story_id))

    def test_the_committed_vectors_match_what_this_merge_produces(self):
        cases = [
            self.scenario("new story in a new outlet",
                          lambda: self.add("c.bg", "fresh")),
        ]
        self.setUp()
        cases.append(self.scenario(
            # ⚠️ An EXISTING outlet, so the bundle's base is a real file
            # rather than null. Every other case adds a new outlet, and a
            # bundle whose base is absent exercises the "start from empty"
            # arm and none of the upsert — which is where the ordering,
            # the tiebreak and the envelope overwrite actually live.
            "a member joins an existing story in an existing outlet",
            lambda: self.add("a.bg", "joins", action="add_to_story",
                             story_id="story-0")))
        self.setUp()
        cases.append(self.scenario(
            "an outlet is retired",
            lambda: self.remove("b.bg", "three", drop_outlet=True)))

        built = {"schema_version": om.OVERLAY_SCHEMA_VERSION, "cases": cases}
        committed = (json.loads(VECTORS.read_text(encoding="utf-8"))
                     if VECTORS.exists() else None)
        if committed == built:
            return
        # ⚠️ THE FAILURE IS STICKY: by default this does NOT rewrite the
        # committed file. Regenerating on the spot makes the second run
        # pass, which is the worst of both — the tree silently changes
        # under a tracked file, CI goes green on a rerun, and nobody reads
        # the vectors that just moved. Regeneration is an explicit act.
        if not os.environ.get("OVERLAY_VECTORS_REGENERATE"):
            self.fail(
                f"{VECTORS} does not match this merge"
                f"{' (the file is missing)' if committed is None else ''}. "
                f"Re-run with OVERLAY_VECTORS_REGENERATE=1 to rewrite it, "
                f"then commit it AND re-run newsapp/app/overlayMerge.test.ts, "
                f"which replays it — a vectors change is a change to both "
                f"implementations of the merge.")
        VECTORS.parent.mkdir(parents=True, exist_ok=True)
        # ⚠️ Compact and generated, not hand-edited. These are whole
        # published payloads either side of a real merge — the point is
        # that they are the SHAPE the builder writes, not a reduction of
        # it, since the reductions are exactly where a twin stops catching
        # things (`FEED_OMIT`, the sort tiebreak, the feed's truncation).
        # Pretty-printing them adds ~60 KB of whitespace to a file nobody
        # reads by hand.
        VECTORS.write_text(
            json.dumps(built, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":")) + "\n",
            encoding="utf-8")
        self.fail(f"{VECTORS} regenerated — commit it, and re-run the "
                  f"TypeScript overlay tests, which replay it")

    def test_the_vectors_exercise_the_arms_they_claim_to(self):
        # ⚠️ A vectors file that happens to contain only no-ops passes on
        # both sides for ever. Each case must actually change something.
        self.assertTrue(VECTORS.is_file(),
                        f"{VECTORS} is missing — run the generator above")
        committed = json.loads(VECTORS.read_text(encoding="utf-8"))
        self.assertEqual(committed["schema_version"], om.OVERLAY_SCHEMA_VERSION)
        for case in committed["cases"]:
            with self.subTest(case=case["name"]):
                self.assertTrue(case["paths"], "a case with no paths")
                self.assertTrue(
                    any(row["base"] != row["expected"] for row in case["paths"]),
                    "every path in this case merges to its own base — the "
                    "case proves nothing about the merge")
        # ⚠️ Across the SET, not per case: each of these arms is optional in
        # any one scenario and mandatory somewhere, and an arm no case
        # reaches is an arm the TypeScript twin is free to get wrong.
        for arm in ("removed", "index_rows"):
            self.assertTrue(any(case[arm] for case in committed["cases"]),
                            f"no case exercises `{arm}`")
        self.assertTrue(
            any(row["path"].lstrip("/") in case["overlay"]["replaced_paths"]
                for case in committed["cases"] for row in case["paths"]),
            "no vector pins a `replaced_paths` path, so the arm that must "
            "win over every merge below it is untested")
        self.assertTrue(
            any(row["path"].startswith("/articles/") and row["base"] is not None
                for case in committed["cases"] for row in case["paths"]),
            "every bundle vector starts from an absent base, so the upsert "
            "itself — ordering, tiebreak, envelope — is untested")


class RetiredRegistryUnderAnOverlay(EqualsFullRebuild):
    def test_the_retired_registry_is_carried_whole_never_read_as_a_story(self):
        """⚠️ `stories/retired.json` matches the detail-file pattern by name.
        Read as a story it raises KeyError on `story` in the differ and ships
        as a detail nobody can merge; carried whole it reaches the reader in
        `replaced_paths`, which is how a withdrawal published between two
        cold releases reaches a bookmark in the hot window."""
        self.seed_base()
        base = self.build_into()
        base_dir = self.out_dir
        config = Path(self.root) / "news" / "config"
        config.mkdir(parents=True, exist_ok=True)
        (config / "retired_stories.json").write_text(json.dumps({
            "version": 1,
            "retired": {"20200101-deadbeef": {
                "reason": "withdrawn", "on": "2026-09-19", "note": "n"}}}),
            encoding="utf-8")
        full = self.build_into(stamp_from=base_dir)
        overlay = om.diff_overlay(base, full, seq=1, base_run_id="RUN-BASE",
                                  generated_at="2026-09-19T12:00:00Z",
                                  latest_limit=LATEST_LIMIT)
        self.assertNotIn("retired", overlay["story_details"],
                         "the registry was shipped as a story detail")
        self.assertIn("stories/retired.json", overlay["replaced_paths"])
        merged = om.apply_overlay(base, overlay)
        self.assertEqual(merged["stories/retired.json"]["retired"],
                         full["stories/retired.json"]["retired"])


if __name__ == "__main__":
    unittest.main()
