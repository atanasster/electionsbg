#!/usr/bin/env python3
"""T4.4 — the person accounting. ⚠️ Every assertion here is about a
DENOMINATOR: what is inside M, what is beside it, and what the writer
refuses to publish when the two identities do not hold."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import person_rollups as pr  # noqa: E402


def article(url, *, domain="a.bg", title="Заглавие", published="2026-09-01T00:00:00Z",
            story_id="s1", persons=(), tones=()):
    return {"url": url, "domain": domain, "article_id": url.rsplit("/", 1)[-1],
            "title": title, "published": published, "story_id": story_id,
            "analysis": {"news_persons": [{"news_person_id": p} for p in persons],
                         "person_tones": list(tones)}}


def tone(person_id, *, role="primary", status="assessed", value="unfavorable",
         scope="full"):
    return {"news_person_id": person_id, "subject_role": role,
            "assessment_status": status, "tone": value,
            "rationale": "Причина.", "evidence_spans": [
                {"quote": "цитат", "field": "body", "direction": value,
                 "voice": "journalist", "located": True, "offset": 12}],
            "text_scope": {"kind": scope}, "rubric_version": "person-treatment-v1",
            "identity_version": "2026-09-22.1:abc"}


class Accounting(unittest.TestCase):
    def test_the_two_identities_hold_across_every_status(self):
        rows = [
            article("https://a.bg/1", persons=["np_1"], tones=[tone("np_1")]),
            article("https://a.bg/2", title="Второ", persons=["np_1"],
                    tones=[tone("np_1", value="neutral")]),
            article("https://b.bg/3", domain="b.bg", title="Трето", persons=["np_1"],
                    tones=[tone("np_1", status="insufficient_text", value=None)]),
            # A mention with no stored tone at all is PENDING, not „no framing".
            article("https://b.bg/4", domain="b.bg", title="Четвърто", persons=["np_1"]),
            # A stored row that is neither assessed nor insufficient is refused.
            article("https://c.bg/5", domain="c.bg", title="Пето", persons=["np_1"],
                    tones=[tone("np_1", status="no_evidence", value=None)]),
        ]
        entry = pr.collect(rows, {"np_1"})["np_1"]
        self.assertEqual(entry["eligible"], 5)
        self.assertEqual(entry["assessed"], 2)
        self.assertEqual(entry["counts"], {"unfavorable": 1, "neutral": 1})
        self.assertEqual(entry["insufficient_text"], 1)
        self.assertEqual(entry["pending"], 1)
        self.assertEqual(entry["refused"], 1)
        self.assertEqual(pr.check_accounting(entry), [])
        # ⚠️ THE MUTATION THIS CATCHES: a tone counted without N moving, or a
        # status silently dropped out of the parts. Either breaks an identity.
        broken = dict(entry, counts={"unfavorable": 9})
        self.assertTrue(pr.check_accounting(broken))
        self.assertTrue(pr.check_accounting(dict(entry, pending=0)))

    def test_incidental_and_unknown_identities_stay_outside_M(self):
        rows = [
            article("https://a.bg/1", persons=["np_1"], tones=[tone("np_1")]),
            article("https://a.bg/2", title="Второ", persons=["np_1"],
                    tones=[tone("np_1", role="incidental", status="not_assessed",
                                value=None)]),
            # Resolved to nobody: no identity, so it can never join anyone's M.
            article("https://a.bg/3", title="Трето"),
            # An identity the registry has not activated gets no entry at all.
            article("https://a.bg/4", title="Четвърто", persons=["np_2"],
                    tones=[tone("np_2")]),
        ]
        people = pr.collect(rows, {"np_1"})
        self.assertEqual(set(people), {"np_1"})     # no page by being mentioned
        entry = people["np_1"]
        self.assertEqual(entry["eligible"], 1)
        self.assertEqual(entry["incidental"], 1)
        self.assertEqual(pr.check_accounting(entry), [])
        # The incidental row is carried so the page can show it — labelled
        # ineligible, with no tone forced onto it.
        (row,) = entry["incidental_rows"]
        self.assertFalse(row["eligible"])
        self.assertIsNone(row["tone"])
        # ⚠️ An incidental mention must not reach the outlet or story counts,
        # which are counts of the coverage M is over.
        self.assertEqual(entry["outlet_count"], 1)

    def test_one_pair_per_article_even_when_named_twice(self):
        row = article("https://a.bg/1", persons=["np_1", "np_1"], tones=[tone("np_1")])
        entry = pr.collect([row], {"np_1"})["np_1"]
        self.assertEqual(entry["eligible"], 1)
        self.assertEqual(pr.check_accounting(entry), [])

    def test_same_headline_copies_are_named_beside_the_raw_denominator(self):
        rows = [
            article("https://a.bg/1", title="Едно и също", persons=["np_1"],
                    tones=[tone("np_1")]),
            article("https://b.bg/1", domain="b.bg", title=" едно и  СЪЩО ",
                    persons=["np_1"], tones=[tone("np_1")]),
            article("https://c.bg/9", domain="c.bg", title="Различно",
                    persons=["np_1"], tones=[tone("np_1")]),
        ]
        entry = pr.collect(rows, {"np_1"})["np_1"]
        # ⚠️ Both denominators are published; neither replaces the other.
        self.assertEqual(entry["eligible"], 3)
        self.assertEqual(entry["same_headline_copies"], 1)
        self.assertEqual(entry["eligible_deduplicated"], 2)
        # THE MUTATION THIS CATCHES: folding by headline alone, so one outlet
        # republishing itself would deflate the denominator.
        same_outlet = pr.collect([
            article("https://a.bg/1", title="Едно", persons=["np_1"], tones=[tone("np_1")]),
            article("https://a.bg/2", title="Едно", persons=["np_1"], tones=[tone("np_1")]),
        ], {"np_1"})["np_1"]
        self.assertEqual(same_outlet["same_headline_copies"], 0)
        self.assertEqual(same_outlet["eligible_deduplicated"], 2)

    def test_per_outlet_carries_each_outlet_s_own_distribution(self):
        rows = [
            article("https://a.bg/1", persons=["np_1"], tones=[tone("np_1")]),
            article("https://a.bg/2", title="Второ", persons=["np_1"],
                    tones=[tone("np_1", value="neutral")]),
            article("https://a.bg/3", title="Трето", persons=["np_1"],
                    tones=[tone("np_1", status="insufficient_text", value=None)]),
            article("https://b.bg/4", domain="b.bg", title="Четвърто",
                    persons=["np_1"], tones=[tone("np_1", value="favorable")]),
        ]
        entry = pr.collect(rows, {"np_1"})["np_1"]
        outlets = pr.per_outlet(entry)
        self.assertEqual([o["domain"] for o in outlets], ["a.bg", "b.bg"])
        # ⚠️ THE MUTATION THIS CATCHES: one inferred tone per outlet. a.bg
        # carries THREE eligible articles and two different assessed tones.
        self.assertEqual(outlets[0]["eligible"], 3)
        self.assertEqual(outlets[0]["assessed"], 2)
        self.assertEqual(outlets[0]["counts"], {"unfavorable": 1, "neutral": 1})
        self.assertEqual(outlets[1]["counts"], {"favorable": 1})
        # Each outlet's own parts still sum inside its own eligible count.
        for bucket in outlets:
            self.assertLessEqual(sum(bucket["counts"].values()), bucket["eligible"])
            self.assertEqual(sum(bucket["counts"].values()), bucket["assessed"])

    def test_rows_carry_short_evidence_and_no_body(self):
        entry = pr.collect([article("https://a.bg/1", persons=["np_1"],
                                    tones=[tone("np_1")])], {"np_1"})["np_1"]
        (row,) = entry["rows"]
        self.assertEqual(row["text_scope"], "full")
        (span,) = row["evidence_spans"]
        self.assertEqual(span["quote"], "цитат")
        # Provenance only: no offsets, no body, nothing that reconstructs text.
        self.assertNotIn("offset", span)
        self.assertEqual(set(span), {"quote", "field", "direction", "voice", "located"})

    def test_a_tone_beside_a_non_assessed_status_is_never_published(self):
        rows = [
            # An incidental mention carrying a tone: OUTSIDE M, in no count,
            # supported by no evidence the accounting checked.
            article("https://a.bg/1", persons=["np_1"],
                    tones=[tone("np_1", role="incidental",
                                status="not_assessed", value="unfavorable")]),
            # And a row inside M whose status is not `assessed`.
            article("https://a.bg/2", title="Второ", persons=["np_1"],
                    tones=[tone("np_1", status="insufficient_text",
                                value="favorable")]),
        ]
        entry = pr.collect(rows, {"np_1"})["np_1"]
        self.assertEqual(pr.check_accounting(entry), [])   # it would PUBLISH
        # ⚠️ THE MUTATION THIS CATCHES: copying `tone` through regardless of
        # status. Both rows would then render a framing label about a named
        # person that appears in no count and rests on nothing.
        self.assertEqual(entry["counts"], {})
        self.assertIsNone(entry["incidental_rows"][0]["tone"])
        self.assertIsNone(entry["rows"][0]["tone"])
        self.assertEqual(entry["incidental_rows"][0]["assessment_status"],
                         "not_assessed")

    def test_an_unreadable_role_costs_a_row_not_the_whole_page(self):
        rows = [
            article("https://a.bg/1", persons=["np_1"], tones=[tone("np_1")]),
            article("https://a.bg/2", title="Второ", persons=["np_1"],
                    tones=[tone("np_1", role=None)]),
        ]
        entry = pr.collect(rows, {"np_1"})["np_1"]
        # ⚠️ THE MUTATION THIS CATCHES: counting it as `refused` without the
        # matching `eligible`, which breaks the second identity by
        # construction — one malformed row would refuse the whole shard and
        # be reported as an accounting failure rather than as a bad role.
        self.assertEqual(pr.check_accounting(entry), [])
        self.assertEqual(entry["eligible"], 1)
        self.assertEqual(entry["unreadable_role"], 1)
        self.assertEqual(entry["refused"], 0)
        # Outside M on every axis: not in the window, not in per_outlet's M.
        self.assertEqual(sum(b["eligible"] for b in pr.per_outlet(entry)), 1)
        self.assertGreaterEqual(entry["eligible_deduplicated"], 0)

    def test_partial_scope_is_split_out_of_insufficient_text(self):
        rows = [
            article("https://a.bg/1", persons=["np_1"],
                    tones=[tone("np_1", status="insufficient_text",
                                value=None, scope="prefix")]),
            article("https://a.bg/2", title="Второ", persons=["np_1"],
                    tones=[tone("np_1", status="insufficient_text",
                                value=None, scope="full")]),
        ]
        entry = pr.collect(rows, {"np_1"})["np_1"]
        # A SPLIT, not a fifth part: the identity is untouched.
        self.assertEqual(entry["insufficient_text"], 2)
        self.assertEqual(entry["partial_scope"], 1)
        self.assertEqual(pr.check_accounting(entry), [])

    def test_the_window_is_ordered_on_the_instant_and_undated_rows_are_counted(self):
        rows = [
            # ⚠️ `Z` and `+00:00` string-sort against each other wrongly; the
            # later instant here is the one spelled with the offset.
            article("https://a.bg/1", published="2026-09-01T10:00:00Z",
                    persons=["np_1"], tones=[tone("np_1")]),
            article("https://a.bg/2", title="Второ",
                    published="2026-09-01T12:00:00+00:00",
                    persons=["np_1"], tones=[tone("np_1")]),
            article("https://a.bg/3", title="Трето", published="",
                    persons=["np_1"], tones=[tone("np_1")]),
        ]
        entry = pr.collect(rows, {"np_1"})["np_1"]
        self.assertEqual(entry["first_published"], "2026-09-01T10:00:00Z")
        self.assertEqual(entry["last_published"], "2026-09-01T12:00:00+00:00")
        # Inside M and outside the window: counted, so the window cannot read
        # as covering every row it is printed beside.
        self.assertEqual(entry["undated"], 1)
        self.assertEqual(entry["eligible"], 3)

    def test_the_archive_is_paginated_and_the_accounting_is_over_all_rows(self):
        rows = [article(f"https://a.bg/{i}", title=f"Заглавие {i}",
                        published=f"2026-09-{(i % 28) + 1:02d}T00:00:00Z",
                        persons=["np_1"], tones=[tone("np_1")])
                for i in range(120)]
        entry = pr.collect(rows, {"np_1"})["np_1"]
        first = pr.payload(entry, {}, "now", "r")
        self.assertEqual(first["total_pages"], 3)
        self.assertEqual(len(first["articles"]), pr.PERSON_PAGE_SIZE)
        # ⚠️ The accounting is over ALL rows on EVERY page — a page must never
        # show a denominator it is not the whole of.
        last = pr.payload(entry, {}, "now", "r", page=3)
        self.assertEqual(last["eligible"], 120)
        self.assertEqual(first["assessed"], last["assessed"])
        self.assertEqual(len(last["articles"]), 20)
        # An out-of-range page serves a real page rather than an empty one.
        self.assertEqual(pr.payload(entry, {}, "now", "r", page=99)["page"], 3)
        seen = [r["url"] for pg in (1, 2, 3)
                for r in pr.payload(entry, {}, "now", "r", page=pg)["articles"]]
        self.assertEqual(len(set(seen)), 120)

    def test_fails_closed_on_an_empty_corpus(self):
        self.assertEqual(pr.collect([], {"np_1"}), {})
        self.assertEqual(pr.collect([article("https://a.bg/1")], set()), {})


class ShardWriter(unittest.TestCase):
    """`write_person_shards` — the refusal and the pruning."""

    def setUp(self):
        import build_app_data
        self.bad = build_app_data
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)

    def _index(self, *ids):
        # ⚠️ The REAL index shape: `public_index` exports `reviewed_at` and
        # NOT `reviewed_by`. A fixture that invents the key passes under an
        # implementation that publishes a null reviewer for every person.
        return {"persons": [{"news_person_id": i, "name_bg": "Име",
                             "identity_version": "v1",
                             "reviewed_at": "2026-09-22",
                             "verified_main_site_slug": None} for i in ids]}

    def _registry(self, *ids):
        return {"persons": [{"news_person_id": i, "reviewed_by": "реда́ктор"}
                            for i in ids]}

    def test_writes_a_shard_only_for_an_active_identity_and_prunes_the_rest(self):
        stale = self.out / "person" / "np_gone.json"
        stale.parent.mkdir(parents=True, exist_ok=True)
        stale.write_text("{}", encoding="utf-8")
        rows = [article("https://a.bg/1", persons=["np_1"], tones=[tone("np_1")]),
                article("https://a.bg/2", title="Второ", persons=["np_2"],
                        tones=[tone("np_2")])]
        out = self.bad.write_person_shards(self.out, self._registry("np_1"),
                                           self._index("np_1"), rows,
                                           "2026-09-22T00:00:00Z")
        self.assertEqual([r["news_person_id"] for r in out["rows"]], ["np_1"])
        self.assertTrue((self.out / "person" / "np_1.json").exists())
        # ⚠️ A deactivated identity's page is REMOVED, not left serving.
        self.assertFalse(stale.exists())
        self.assertFalse((self.out / "person" / "np_2.json").exists())
        payload = json.loads((self.out / "person" / "np_1.json").read_text("utf-8"))
        self.assertEqual(payload["eligible"], 1)
        self.assertEqual(sum(payload["counts"].values()), payload["assessed"])
        self.assertIsNone(payload["verified_main_site_slug"])
        # ⚠️ THE MUTATION THIS CATCHES: reading the reviewer from the public
        # index, which does not carry one — every shard would then publish a
        # null owner while the policy promises a named one.
        self.assertEqual(payload["reviewed_by"], "реда́ктор")

    def test_refuses_a_shard_whose_accounting_does_not_check_out(self):
        rows = [article("https://a.bg/1", persons=["np_1"], tones=[tone("np_1")])]
        real = pr.check_accounting
        try:
            pr.check_accounting = lambda entry: ["forced"]
            out = self.bad.write_person_shards(self.out, {}, self._index("np_1"),
                                               rows, "2026-09-22T00:00:00Z")
        finally:
            pr.check_accounting = real
        # ⚠️ THE MUTATION THIS CATCHES: publishing anyway. An unverifiable
        # accounting about a named person is refused, and SAID.
        self.assertEqual(out["rows"], [])
        self.assertEqual(out["refused"][0]["news_person_id"], "np_1")
        self.assertFalse((self.out / "person" / "np_1.json").exists())

    def test_refuses_an_id_the_client_charset_would_not_serve(self):
        rows = [article("https://a.bg/1", persons=["../etc"],
                        tones=[tone("../etc")])]
        out = self.bad.write_person_shards(self.out, {}, self._index("../etc"), rows,
                                           "2026-09-22T00:00:00Z")
        self.assertEqual(out["rows"], [])
        self.assertEqual(out["refused"][0]["problems"], ["unsafe id"])
        self.assertEqual(list((self.out / "person").glob("*.json")), [])


if __name__ == "__main__":
    unittest.main()
