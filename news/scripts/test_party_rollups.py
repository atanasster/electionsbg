#!/usr/bin/env python3
"""T4.2 — the party rollup's three refusals and its denominators."""
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import party_rollups as pr  # noqa: E402

FULL = lambda a: (a.get("text_scope") or {}).get("kind") == "full"  # noqa: E731


def row(url, domain, tones, *, published="2026-09-20", scope="full", category="politics"):
    return {"url": url, "domain": domain, "published": published, "title": "T",
            "article_id": url[-1], "story_id": "s1",
            "analysis": {"party_tones": tones, "text_scope": {"kind": scope},
                         "topics": [{"category": category, "primary": True}]}}


def tone(party="ГЕРБ", party_id="gerb", label="neutral", spans=None):
    return {"party": party, "party_id": party_id, "tone": label,
            "rationale": "Материалът представя позицията фактически.",
            "evidence_spans": spans or []}


class Refusals(unittest.TestCase):
    def test_an_unresolved_surface_gets_no_row_and_is_counted(self):
        c = pr.collect([row("u1", "a.bg", [tone(party="Х", party_id=None, label="unfavorable"),
                                           tone()])], FULL)
        index = pr.party_index(c, "now", "r")
        # ⚠️ THE MUTATION THIS CATCHES: rolling an unresolved NAME up as a
        # party — name-match is not identity — or dropping it silently.
        self.assertEqual([p["party_id"] for p in index["parties"]], ["gerb"])
        self.assertEqual(index["unresolved_surfaces"],
                         [{"surface": "Х", "pairs": 1, "basis": "unknown"}])
        self.assertEqual(index["unresolved_pairs"], 1)
        # With a registry probe the bucket SPLITS: a surface the registry
        # knows and refuses is a different fact from one it never covered.
        split = pr.party_index(
            pr.collect([row("u1", "a.bg", [tone(party="Х", party_id=None),
                                           tone(party="Чужда", party_id=None)])],
                       FULL, in_registry=lambda name: name == "Х"),
            "now", "r")
        self.assertEqual(split["unresolved_refused_pairs"], 1)
        self.assertEqual(split["unresolved_unknown_pairs"], 1)

    def test_an_unsafe_id_is_refused_once_at_the_producer(self):
        # ⚠️ THE MUTATION THIS CATCHES: an id that reaches a URL and a file
        # path refused by the writer but not by the index — an index row the
        # client cannot link, which is worse than no row.
        c = pr.collect([row("u1", "a.bg", [tone(party="Х", party_id="../etc"), tone()])], FULL)
        index = pr.party_index(c, "now", "r")
        self.assertEqual([p["party_id"] for p in index["parties"]], ["gerb"])
        self.assertEqual(index["refused_id_pairs"], 1)
        self.assertNotIn("../etc", c["parties"])

    def test_one_article_naming_a_party_twice_is_one_pair(self):
        # ⚠️ THE MUTATION THIS CATCHES: `assessed` captioned „(партия,
        # материал)" while counting tone ENTRIES — both story writers dedup,
        # and „ГЕРБ" + „ГЕРБ-СДС" in one article is one identity.
        c = pr.collect([row("u1", "a.bg", [tone(), tone(party="ГЕРБ-СДС")])], FULL)
        index = pr.party_index(c, "now", "r")
        self.assertEqual(index["parties"][0]["assessed"], 1)
        self.assertEqual(index["duplicate_pairs"], 1)
        payload = pr.party_payload(c["parties"]["gerb"], "now", "r")
        self.assertEqual(len(payload["articles"]), 1)
        self.assertEqual(payload["names_seen"], ["ГЕРБ", "ГЕРБ-СДС"])

    def test_an_undated_row_is_counted_rather_than_hidden(self):
        c = pr.collect([row("u1", "a.bg", [tone()], published=None),
                        row("u2", "b.bg", [tone()], published="2026-09-20")], FULL)
        index = pr.party_index(c, "now", "r")
        self.assertEqual(index["parties"][0]["assessed"], 2)
        # ⚠️ THE MUTATION THIS CATCHES: an undated row inside the
        # distribution and invisible in the window that captions it.
        self.assertEqual(index["parties"][0]["undated"], 1)
        self.assertEqual(index["parties"][0]["first_published"], "2026-09-20")

    def test_rows_sort_on_the_instant_not_the_string(self):
        c = pr.collect([row("u1", "a.bg", [tone()], published="2026-09-20T10:00:00+03:00"),
                        row("u2", "b.bg", [tone()], published="2026-09-20T09:00:00Z"),
                        row("u3", "c.bg", [tone()], published=None)], FULL)
        payload = pr.party_payload(c["parties"]["gerb"], "now", "r")
        # 09:00Z is 12:00+03:00 — later than 10:00+03:00 — and the undated
        # row sorts last rather than in the middle of the window.
        self.assertEqual([a["url"] for a in payload["articles"]], ["u2", "u1", "u3"])

    def test_a_scoped_observation_enters_no_distribution_and_is_counted(self):
        c = pr.collect([row("u1", "a.bg", [tone(label="favorable")], scope="prefix"),
                        row("u2", "b.bg", [tone()])], FULL)
        index = pr.party_index(c, "now", "r")
        self.assertEqual(index["parties"][0]["counts"],
                         {"favorable": 0, "neutral": 1, "unfavorable": 0, "mixed": 0})
        self.assertEqual(index["scoped_out_pairs"], 1)
        # And it is not in the article archive either.
        payload = pr.party_payload(c["parties"]["gerb"], "now", "r")
        self.assertEqual([a["url"] for a in payload["articles"]], ["u2"])

    def test_the_order_is_coverage_never_favourability(self):
        rows = [row("u1", "a.bg", [tone(label="unfavorable")]),
                row("u2", "b.bg", [tone(label="unfavorable")]),
                row("u3", "c.bg", [tone(party="БСП", party_id="bsp", label="favorable")])]
        index = pr.party_index(pr.collect(rows, FULL), "now", "r")
        # ⚠️ THE MUTATION THIS CATCHES: ordering by how favourable the
        # coverage is — a leaderboard, which this must never be.
        self.assertEqual([p["party_id"] for p in index["parties"]], ["gerb", "bsp"])
        self.assertEqual([p["assessed"] for p in index["parties"]], [2, 1])
        for p in index["parties"]:
            self.assertNotIn("score", p)


class Denominators(unittest.TestCase):
    def test_every_figure_carries_its_basis(self):
        rows = [row("u1", "a.bg", [tone(label="favorable")], published="2026-09-01"),
                row("u2", "a.bg", [tone(label="neutral")], published="2026-09-20"),
                row("u3", "b.bg", [tone(label="neutral")], published="2026-09-10")]
        c = pr.collect(rows, FULL)
        payload = pr.party_payload(c["parties"]["gerb"], "now", "rubric-1")
        self.assertEqual(payload["assessed"], 3)
        self.assertEqual(payload["article_count"], 3)
        self.assertEqual(payload["outlet_count"], 2)   # a.bg twice is ONE outlet
        self.assertEqual((payload["first_published"], payload["last_published"]),
                         ("2026-09-01", "2026-09-20"))
        self.assertEqual(payload["rubric_version"], "rubric-1")
        self.assertEqual(sum(payload["counts"].values()), payload["assessed"])
        # Newest first, and the evidence is SHORT: quotes, never a body.
        self.assertEqual([a["url"] for a in payload["articles"]], ["u2", "u3", "u1"])

    def test_only_short_evidence_leaves_the_rollup(self):
        spans = [{"quote": "цитат", "field": "body", "direction": "unfavorable",
                  "voice": "journalist", "located": True, "start": 1, "end": 6,
                  "article_content_hash": "h"}]
        c = pr.collect([row("u1", "a.bg", [tone(label="unfavorable", spans=spans)])], FULL)
        span = pr.party_payload(c["parties"]["gerb"], "now", "r")["articles"][0]["evidence_spans"][0]
        self.assertEqual(set(span), {"quote", "field", "direction", "voice", "located"})

    def test_topic_rollups_key_on_the_primary_topic_and_resolved_ids(self):
        rows = [row("u1", "a.bg", [tone(), tone(party="Х", party_id=None)], category="politics"),
                row("u2", "b.bg", [tone(label="favorable")], category="economy")]
        topics = pr.collect(rows, FULL)["topics"]
        self.assertEqual(set(topics), {"politics", "economy"})
        self.assertEqual(topics["politics"]["gerb"]["neutral"], 1)
        self.assertEqual(list(topics["politics"]), ["gerb"])

    def test_no_tones_no_rows(self):
        c = pr.collect([row("u1", "a.bg", [])], FULL)
        self.assertEqual(pr.party_index(c, "now", "r")["parties"], [])
        self.assertEqual(pr.party_index(c, "now", "r")["unresolved_pairs"], 0)


class TheWriter(unittest.TestCase):
    """T4.2 — `build_app_data.write_parties`: index and payloads stay in step,
    pages are written and stale ones pruned."""

    def setUp(self):
        import tempfile
        self.tmp = tempfile.TemporaryDirectory(prefix="parties_")
        self.addCleanup(self.tmp.cleanup)
        self.out = Path(self.tmp.name)
        sys.path.insert(0, str(HERE))
        import build_app_data as bad
        self.bad = bad

    def rows(self, n, party_id="gerb"):
        return [row(f"u{i}", f"d{i % 3}.bg",
                    [tone(party_id=party_id)], published=f"2026-09-{i % 28 + 1:02d}")
                for i in range(n)]

    def test_index_and_payloads_stay_in_step_and_pages_are_written(self):
        import party_rollups as pr
        self.bad.write_parties(self.out, self.rows(pr.PARTY_PAGE_SIZE + 3), "now")
        import json
        index = json.loads((self.out / "parties.json").read_text())
        self.assertEqual([p["party_id"] for p in index["parties"]], ["gerb"])
        first = json.loads((self.out / "party" / "gerb.json").read_text())
        second = json.loads((self.out / "party" / "gerb-2.json").read_text())
        self.assertEqual((first["page"], first["total_pages"]), (1, 2))
        self.assertEqual(len(first["articles"]), pr.PARTY_PAGE_SIZE)
        self.assertEqual(len(second["articles"]), 3)
        # Every row is on exactly one page, and the index's count is theirs.
        urls = [a["url"] for a in first["articles"] + second["articles"]]
        self.assertEqual(len(set(urls)), index["parties"][0]["assessed"])

    def test_a_party_that_loses_its_last_tone_loses_its_pages(self):
        import json
        self.bad.write_parties(self.out, self.rows(2), "now")
        self.assertTrue((self.out / "party" / "gerb.json").exists())
        # ⚠️ THE MUTATION THIS CATCHES: a stale payload surviving a rebuild —
        # a claim nobody re-derived, served for ever.
        self.bad.write_parties(self.out, self.rows(2, party_id="bsp"), "now")
        self.assertFalse((self.out / "party" / "gerb.json").exists())
        self.assertTrue((self.out / "party" / "bsp.json").exists())
        index = json.loads((self.out / "parties.json").read_text())
        self.assertEqual([p["party_id"] for p in index["parties"]], ["bsp"])

    def test_an_unsafe_id_produces_neither_a_row_nor_a_file(self):
        import json
        self.bad.write_parties(self.out, [row("u1", "a.bg", [tone(party_id="../etc")]),
                                          row("u2", "a.bg", [tone()])], "now")
        index = json.loads((self.out / "parties.json").read_text())
        self.assertEqual([p["party_id"] for p in index["parties"]], ["gerb"])
        self.assertEqual(index["refused_id_pairs"], 1)
        self.assertEqual(sorted(p.name for p in (self.out / "party").iterdir()),
                         ["gerb.json"])


if __name__ == "__main__":
    unittest.main()
