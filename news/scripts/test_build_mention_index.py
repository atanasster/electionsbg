#!/usr/bin/env python3
"""Tests for build_mention_index.py — the reciprocal index.

⚠️ This index puts article links on a NAMED INDIVIDUAL's page, which is the
highest-consequence surface in the whole project: a wrong link there is an
assertion about a real person that they were in the news. Every rule below
exists to keep that assertion honest.

Run:  python3 news/scripts/test_build_mention_index.py
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_mention_index as bmi  # noqa: E402
import resolve_mentions as rm  # noqa: E402


def gz(*entries):
    return rm.Gazetteer({"version": 1, "entries": list(entries)})


class SafeIds(unittest.TestCase):
    """⚠️ An id becomes a FILENAME."""

    def test_a_place_style_id_is_flattened(self):
        self.assertEqual(bmi.safe_id("settlement:68134"), "settlement_68134")

    def test_traversal_cannot_survive(self):
        # A `..` or a slash arriving from corpus data would write outside the
        # output tree.
        for bad in ("../../etc/passwd", "..", "a/../../b", "/abs/path"):
            with self.subTest(bad=bad):
                out = bmi.safe_id(bad)
                self.assertNotIn("/", out)
                self.assertNotIn("..", out)

    def test_an_id_that_flattens_to_nothing_still_has_a_name(self):
        self.assertTrue(bmi.safe_id("///"))
        self.assertTrue(bmi.safe_id(""))

    def test_an_ordinary_id_is_untouched(self):
        self.assertEqual(bmi.safe_id("delyan-peevski-ab12cd"),
                         "delyan-peevski-ab12cd")
        self.assertEqual(bmi.safe_id("000970496"), "000970496")


class WhatMayBeIndexed(unittest.TestCase):
    def test_only_a_LINKED_basis_counts(self):
        # ⚠️ A refusal is a statement about what we could NOT establish.
        # Putting one on a person's page renders „this article may be about
        # you" beside their name.
        self.assertEqual(sorted(bmi.LINKED_BASES),
                         ["coref_resolved", "gazetteer_exact"])
        for refused in ("ambiguous_refused", "not_in_gazetteer"):
            self.assertNotIn(refused, bmi.LINKED_BASES)

    def test_only_kinds_the_MAIN_SITE_routes_on_are_indexed(self):
        # A shard for a kind with no page is a file nobody can reach.
        self.assertEqual(sorted(bmi.INDEXED_KINDS),
                         ["institution", "party", "person"])

    def test_every_excluded_kind_states_a_reason(self):
        # ⚠️ „no places" must never read as „no places were mentioned".
        for kind, why in bmi.EXCLUDED_KINDS.items():
            self.assertNotIn(kind, bmi.INDEXED_KINDS)
            self.assertGreater(len(why), 60, kind)


class TheBuild(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="mention_index_"))
        self.news = self.root / "news" / "data"
        (self.news / "ex.bg").mkdir(parents=True)
        (self.news / "_quarantine").mkdir(parents=True)
        bmi.NEWS_DATA = self.news
        self.addCleanup(setattr, bmi, "NEWS_DATA", bmi.NEWS_DATA)

    def article(self, name, text, *, domain="ex.bg", url=None, published=None):
        d = self.news / domain
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{name}.json").write_text(json.dumps({
            "url": url or f"https://{domain}/{name}",
            "domain": domain, "title": text[:60], "content": text,
            "published": published or "2026-08-20T10:00:00+00:00",
        }, ensure_ascii=False), encoding="utf-8")

    def gaz(self):
        return gz({"kind": "person", "canonical": "Делян Пеевски", "forms": [
            {"surface": "Делян Пеевски", "resolvable": True, "id": "dp-1",
             "form_kind": "two_part", "why": ""},
            {"surface": "Пеевски", "resolvable": False, "id": None,
             "anchor_for": "dp-1", "form_kind": "surname", "why": ""}]},
                  {"kind": "place", "canonical": "Айтос",
                   "place_kind": "settlement", "forms": [
                       {"surface": "Айтос", "resolvable": True,
                        "id": "settlement:1", "form_kind": "name", "why": ""}]})

    def build(self, analysed=()):
        return self.build_with(self.gaz(), analysed)

    def build_with(self, gazetteer, analysed=()):
        by_entity, cov = bmi.build(gazetteer, set(analysed))
        cov["generated_at"] = "2026-08-26T00:00:00+00:00"
        out = self.root / "out"
        bmi.write_shards(by_entity, cov, out)
        return out, cov

    def load(self, out, kind, ident):
        return json.loads((out / kind / f"{bmi.safe_id(ident)}.json")
                          .read_text(encoding="utf-8"))

    def test_a_resolved_person_gets_a_shard(self):
        self.article("a1", "Делян Пеевски заяви нещо. " * 30)
        out, cov = self.build()
        got = self.load(out, "person", "dp-1")
        self.assertEqual(got["article_count"], 1)
        self.assertEqual(got["articles"][0]["basis"], "gazetteer_exact")
        self.assertEqual(got["articles"][0]["form_kind"], "two_part")

    def test_an_excluded_kind_writes_no_shard_but_IS_counted(self):
        self.article("a1", "Айтос е град в България. " * 30)
        out, cov = self.build()
        self.assertFalse((out / "place").exists())
        self.assertEqual(cov["excluded_kinds"]["place"]["mentions"], 1)

    def test_a_QUARANTINED_article_is_never_indexed(self):
        # ⚠️ `_quarantine`, `_html` and `_browser` are working state, not the
        # corpus. Indexing a quarantined record puts an article we REJECTED
        # onto a person's page.
        (self.news / "_quarantine" / "bad.json").write_text(json.dumps({
            "url": "https://x/bad", "domain": "ex.bg", "title": "x",
            "content": "Делян Пеевски заяви нещо. " * 30}), encoding="utf-8")
        self.article("a1", "Няма имена тук изобщо. " * 30)
        out, cov = self.build()
        self.assertFalse((out / "person").exists())

    def test_the_cap_is_visible_beside_the_total(self):
        # ⚠️ „50 articles" beside a cap of 50 is indistinguishable from
        # „exactly 50", and the difference is whether the reader is seeing
        # everything.
        for i in range(bmi.MAX_ARTICLES_PER_ENTITY + 7):
            self.article(f"a{i}", "Делян Пеевски заяви нещо. " * 30,
                         published=f"2026-08-{(i % 28) + 1:02d}T10:00:00+00:00")
        out, _ = self.build()
        got = self.load(out, "person", "dp-1")
        self.assertEqual(got["article_count"], bmi.MAX_ARTICLES_PER_ENTITY + 7)
        self.assertEqual(got["shown"], bmi.MAX_ARTICLES_PER_ENTITY)
        self.assertEqual(len(got["articles"]), bmi.MAX_ARTICLES_PER_ENTITY)

    def test_articles_are_newest_first(self):
        self.article("old", "Делян Пеевски заяви нещо. " * 30,
                     published="2026-01-01T00:00:00+00:00")
        self.article("new", "Делян Пеевски заяви нещо. " * 30,
                     published="2026-08-25T00:00:00+00:00")
        out, _ = self.build()
        got = self.load(out, "person", "dp-1")
        self.assertEqual(got["articles"][0]["published"][:10], "2026-08-25")

    def test_an_UNDATED_article_sorts_last_rather_than_vanishing(self):
        # 13% of the corpus carries no publication date.
        self.article("dated", "Делян Пеевски заяви нещо. " * 30)
        d = self.news / "ex.bg"
        (d / "undated.json").write_text(json.dumps({
            "url": "https://ex.bg/undated", "domain": "ex.bg",
            "title": "t", "published": None,
            "content": "Делян Пеевски заяви нещо. " * 30}), encoding="utf-8")
        out, _ = self.build()
        got = self.load(out, "person", "dp-1")
        self.assertEqual(got["article_count"], 2)
        self.assertIsNone(got["articles"][-1]["published"])

    def test_analysed_is_a_separate_fact_from_collected(self):
        # ⚠️ „we analysed this" is a different claim from „we collected it",
        # and the block sits on a person's page.
        self.article("a1", "Делян Пеевски заяви нещо. " * 30,
                     url="https://ex.bg/seen")
        self.article("a2", "Делян Пеевски пак заяви нещо. " * 30,
                     url="https://ex.bg/unseen")
        out, _ = self.build(analysed={"https://ex.bg/seen"})
        got = self.load(out, "person", "dp-1")
        self.assertEqual(got["analyzed_count"], 1)
        self.assertEqual({a["url"]: a["analyzed"] for a in got["articles"]},
                         {"https://ex.bg/seen": True,
                          "https://ex.bg/unseen": False})

    def test_the_form_kind_split_is_PUBLISHED(self):
        # ⚠️⚠️ 464 of 468 person links rest on a two-part name. „222 entities
        # in the news" must never be quotable without the strength of the
        # evidence beside it.
        self.article("a1", "Делян Пеевски заяви нещо. " * 30)
        _, cov = self.build()
        self.assertEqual(cov["pairs_by_form_kind"], {"person.two_part": 1})
        self.assertIn("may be a person we do not hold",
                      cov["form_kind_meaning"]["two_part"])

    def test_the_index_lists_the_ids_that_have_a_shard(self):
        self.article("a1", "Делян Пеевски заяви нещо. " * 30)
        out, _ = self.build()
        idx = json.loads((out / "index.json").read_text(encoding="utf-8"))
        self.assertEqual(idx["ids"]["person"], ["dp-1"])
        self.assertEqual(idx["ids"]["institution"], [])

    def contested_gaz(self):
        # ⚠️ A gazetteer with a CONTESTED surface. The plain fixture has none,
        # so `ambiguous_refused` is structurally unreachable from it — and a
        # test asserting the LINKED_BASES constant while never exercising the
        # filter stayed green with the filter deleted.
        return gz({"kind": "person", "canonical": "Иван Пеев", "forms": [
            {"surface": "Пеев", "resolvable": False, "id": None,
             "anchor_for": "a-1", "form_kind": "surname", "why": ""}]},
                  {"kind": "person", "canonical": "Георги Пеев", "forms": [
                      {"surface": "Пеев", "resolvable": False, "id": None,
                       "anchor_for": "b-1", "form_kind": "surname",
                       "why": ""}]})

    def test_is_linkable_needs_BOTH_an_id_and_a_linked_basis(self):
        # ⚠️ The basis clause is redundant against today's resolver — a
        # refusal never carries an id — so it cannot be exercised through
        # build(). It is tested here because it is the guard that matters on
        # the day a resolver change breaks that invariant, which is exactly
        # the day nobody is watching.
        for basis in ("ambiguous_refused", "not_in_gazetteer"):
            with self.subTest(basis=basis):
                self.assertFalse(bmi.is_linkable(
                    {"id": "someone-1", "basis": basis}))
        self.assertFalse(bmi.is_linkable({"id": None,
                                          "basis": "gazetteer_exact"}))
        self.assertTrue(bmi.is_linkable({"id": "dp-1",
                                         "basis": "gazetteer_exact"}))

    def test_a_REFUSED_mention_never_reaches_a_shard(self):
        # ⚠️⚠️ Exercised through build(), not asserted about a constant. With
        # a leaking resolver AND the LINKED_BASES clause deleted, a refusal
        # reached a shard and all 17 tests stayed green.
        self.article("a1", "Пеев заяви нещо важно днес. " * 30)
        by_entity, cov = bmi.build(self.contested_gaz(), set())
        self.assertEqual(by_entity, {})
        self.assertEqual(cov["pairs_found"], 0)

    def test_an_empty_index_still_writes_its_index_json(self):
        # A run that indexes nothing must say so rather than crash — relying
        # on the first shard to create the directory raised FileNotFoundError.
        self.article("a1", "Пеев заяви нещо важно днес. " * 30)
        out, cov = self.build_with(self.contested_gaz())
        idx = json.loads((out / "index.json").read_text(encoding="utf-8"))
        self.assertEqual(idx["ids"]["person"], [])

    def test_an_ORPHANED_shard_is_pruned(self):
        # ⚠️⚠️ The header's central claim — „a bucket shard cannot go stale
        # without the file changing" — is the argument the bucket-over-
        # Postgres decision rests on, and it is false without this. An entity
        # that leaves the corpus keeps its old article list for ever, and
        # `bucket:sync` passes no -d, so the bucket copy is permanent.
        self.article("a1", "Делян Пеевски заяви нещо. " * 30)
        out, _ = self.build()
        stale = out / "person" / "gone-1.json"
        stale.write_text('{"kind":"person","id":"gone-1"}', encoding="utf-8")
        _, cov = self.build()
        self.assertFalse(stale.exists())
        self.assertEqual(cov["pruned"], 1)

    def test_the_pruner_keeps_what_it_just_wrote(self):
        self.article("a1", "Делян Пеевски заяви нещо. " * 30)
        out, cov = self.build()
        self.assertTrue((out / "person" / "dp-1.json").exists())
        self.assertEqual(cov["pruned"], 0)

    def test_two_ids_flattening_to_one_filename_are_REFUSED(self):
        # ⚠️ A collision would MERGE two people's article lists — the worst
        # thing this file could do. Injective today by luck, not construction.
        cov = {"generated_at": "t"}
        with self.assertRaises(RuntimeError):
            row = {"form_kind": "name", "analyzed": False,
                   "published": None, "url": "u"}
            bmi.write_shards({("person", "a:b"): [dict(row)],
                              ("person", "a/b"): [dict(row)]},
                             cov, self.root / "clash")

    def test_the_form_split_describes_what_is_SHIPPED(self):
        # ⚠️ Counted before the cap, the published split disagreed with the
        # rows actually in the shards — and that figure is quoted in three
        # files as the reason form_kind exists.
        for i in range(bmi.MAX_ARTICLES_PER_ENTITY + 5):
            self.article(f"a{i}", "Делян Пеевски заяви нещо. " * 30,
                         published=f"2026-08-{(i % 28) + 1:02d}T10:00:00+00:00")
        out, cov = self.build()
        got = self.load(out, "person", "dp-1")
        self.assertEqual(sum(cov["pairs_by_form_kind"].values()), got["shown"])
        self.assertEqual(cov["pairs_shipped"], got["shown"])
        # …and the pre-cap figure is still reported, separately.
        self.assertGreater(cov["pairs_found"], cov["pairs_shipped"])

    def test_the_role_travels_with_the_link(self):
        # A person named once in a closing paragraph does not belong on their
        # own page; a consumer needs the field to be able to say so.
        self.article("a1", "Делян Пеевски заяви нещо. " * 30)
        out, _ = self.build()
        self.assertEqual(self.load(out, "person", "dp-1")["articles"][0]["role"],
                         "mention")

    def test_the_role_is_not_re_added_by_a_masking_default(self):
        # ⚠️ A `setdefault("role", "mention")` in write_shards made the real
        # assignment in build() untestable: deleting it left every test green
        # because the fallback put the field back.
        self.article("a1", "Делян Пеевски заяви нещо. " * 30)
        by_entity, _ = bmi.build(self.gaz(), set())
        rows = next(iter(by_entity.values()))
        self.assertIn("role", rows[0])

    def test_a_coref_link_is_indexed_and_labelled(self):
        self.article("a1", "Делян Пеевски заяви. По-късно Пеевски допълни. " * 20)
        out, _ = self.build()
        got = self.load(out, "person", "dp-1")
        # One article, one entity — the two mentions dedupe onto one id.
        self.assertEqual(got["article_count"], 1)


if __name__ == "__main__":
    unittest.main()
