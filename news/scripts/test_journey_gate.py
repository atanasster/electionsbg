#!/usr/bin/env python3
"""Stage C — the acceptance-journey gate.

⚠️ Every test here builds its own corpus. The gate's job is to REPORT which
steps a reader can take, so each assertion is about a step being blocked,
walkable or unavailable for a stated reason — never about the live corpus
happening to be in a good state today."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import journey_gate as jg  # noqa: E402


def span(**over):
    row = {"quote": "цитат", "field": "body", "direction": "unfavorable",
           "voice": "journalist", "located": True}
    row.update(over)
    return row


def build(tmp: Path, *, members=2, person_rows=None, people=1,
          timeline_story="s1", person_story="s1", extra_pages=None,
          second_rows=None, ambiguous=0, other_events=()) -> Path:
    app = tmp / "app-data"
    (app / "cases").mkdir(parents=True, exist_ok=True)
    (app / "stories").mkdir(exist_ok=True)
    (app / "person").mkdir(exist_ok=True)
    (app / "home.json").write_text(json.dumps(
        {"stories": [{"id": "s1"}]}), encoding="utf-8")
    (app / "cases.json").write_text(json.dumps(
        {"cases": [{"slug": "petrohan", "article_count": 9,
                    "story_count": 2}]}), encoding="utf-8")
    timeline = [{"story_id": sid, "member_count": n}
                for sid, n in list(other_events)]
    timeline.append({"story_id": timeline_story, "member_count": members})
    (app / "cases" / "petrohan.json").write_text(json.dumps(
        {"timeline": timeline}), encoding="utf-8")
    for entry in timeline:
        n = entry["member_count"]
        (app / "stories" / f"{entry['story_id']}.json").write_text(json.dumps(
            {"story": {"members": [{"domain": f"o{i}.bg"} for i in range(n)]}}),
            encoding="utf-8")
    persons = [{"news_person_id": "np_1", "coverage": {"eligible": 3}}]
    if people > 1:
        persons.append({"news_person_id": "np_2",
                        "coverage": {"eligible": 2} if second_rows is not None
                        else None})
    (app / "news_persons.json").write_text(json.dumps({"persons": persons}),
                                           encoding="utf-8")
    rows = person_rows if person_rows is not None else [
        {"url": "https://o0.bg/1", "story_id": person_story,
         "assessment_status": "assessed", "tone": "unfavorable",
         "evidence_spans": [span()]},
        {"url": "https://o1.bg/2", "story_id": person_story,
         "assessment_status": "assessed", "tone": "neutral",
         "evidence_spans": []},
    ]
    pages = list(extra_pages or [])
    (app / "person" / "np_1.json").write_text(json.dumps(
        {"news_person_id": "np_1", "eligible": 3, "assessed": 2,
         "total_pages": 1 + len(pages), "page": 1,
         "articles": rows}), encoding="utf-8")
    for i, page_rows in enumerate(pages, start=2):
        (app / "person" / f"np_1-{i}.json").write_text(json.dumps(
            {"news_person_id": "np_1", "page": i, "total_pages": 1 + len(pages),
             "articles": page_rows}), encoding="utf-8")
    if second_rows is not None:
        (app / "person" / "np_2.json").write_text(json.dumps(
            {"news_person_id": "np_2", "eligible": 2, "assessed": 1,
             "total_pages": 1, "page": 1, "articles": second_rows}),
            encoding="utf-8")
    (tmp / "review").mkdir(exist_ok=True)
    (tmp / "review" / "news_person_candidates.json").write_text(json.dumps(
        {"counts": {"ambiguous": ambiguous, "surfaces": 7}}), encoding="utf-8")
    return app


class TheJourney(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def status(self, report, name):
        for row in report["steps"] + report["variants"]:
            if row["step"] == name:
                return row["status"]
        raise AssertionError(f"no step {name}")

    def test_a_complete_corpus_is_walkable_end_to_end(self):
        report = jg.walk(build(self.root))
        self.assertTrue(report["passed"], report["blocked"])
        for name in ("briefing", "find_case", "choose_event", "compare_outlets",
                     "select_person", "inspect_evidence", "open_original",
                     "share_comparison"):
            self.assertEqual(self.status(report, name), "ok", name)

    def test_walkable_is_not_complete_while_the_variants_have_no_subject(self):
        report = jg.walk(build(self.root))
        # ⚠️ THE MUTATION THIS CATCHES: reporting „passed" as Stage C done.
        # Two of the plan's three subjects have nobody to walk them, and that
        # is a reviewer backlog — but it is not completion.
        self.assertTrue(report["passed"])
        self.assertFalse(report["stage_c_complete"])
        self.assertEqual(sorted(report["variants_unavailable"]),
                         ["variant_ambiguous_namesake", "variant_non_political"])
        # Each unavailable variant names WHY it has no subject, so nobody
        # reads „n/a" as „checked and fine".
        for row in report["variants"]:
            self.assertTrue((row["note"] or "").strip(), row["step"])
            self.assertRegex(row["note"], "registry|ambiguous")

    def test_a_neutral_row_needs_no_quote_and_a_directional_one_does(self):
        # ⚠️ THE MUTATION THIS CATCHES: demanding a quote for EVERY assessed
        # row. Neutral rests on there being no directional claim — „an
        # absence is not provable by a quote" — so such a gate would push the
        # producer toward inventing one.
        ok = jg.walk(build(self.root))
        self.assertEqual(self.status(ok, "inspect_evidence"), "ok")
        stripped = jg.walk(build(self.root, person_rows=[
            {"url": "https://o0.bg/1", "story_id": "s1",
             "assessment_status": "assessed", "tone": "unfavorable",
             "evidence_spans": []}]))
        self.assertEqual(self.status(stripped, "inspect_evidence"), "blocked")

    def test_an_unvoiced_quote_does_not_satisfy_the_evidence_step(self):
        report = jg.walk(build(self.root, person_rows=[
            {"url": "https://o0.bg/1", "story_id": "s1",
             "assessment_status": "assessed", "tone": "unfavorable",
             "evidence_spans": [span(voice=None)]}]))
        self.assertEqual(self.status(report, "inspect_evidence"), "blocked")

    def test_a_single_outlet_event_cannot_be_compared(self):
        report = jg.walk(build(self.root, members=1))
        self.assertEqual(self.status(report, "choose_event"), "blocked")
        self.assertEqual(self.status(report, "compare_outlets"), "blocked")
        self.assertEqual(self.status(report, "share_comparison"), "blocked")
        self.assertFalse(report["passed"])

    def test_a_person_unreachable_from_the_case_blocks_the_step(self):
        # ⚠️ REACHABILITY, not existence: a page nobody can arrive at from
        # the event they were reading is not a step a reader can take.
        report = jg.walk(build(self.root, person_story="somewhere-else"))
        self.assertEqual(self.status(report, "select_person"), "blocked")
        self.assertIn("select_person", report["blocked"])

    def test_a_row_with_no_original_blocks_the_step(self):
        report = jg.walk(build(self.root, person_rows=[
            {"url": None, "story_id": "s1", "assessment_status": "assessed",
             "tone": "unfavorable", "evidence_spans": [span()]}]))
        self.assertEqual(self.status(report, "open_original"), "blocked")

    def test_every_page_of_a_paginated_shard_is_read(self):
        # ⚠️ THE MUTATION THIS CATCHES: reading page 1 only. „every
        # directional assessment" and „each row links out" are UNIVERSAL
        # claims; evaluated over one page they judge a subset while printing
        # the whole-identity totals beside them.
        app = build(self.root, extra_pages=[[
            {"url": None, "story_id": "s1", "assessment_status": "assessed",
             "tone": "unfavorable", "evidence_spans": []}]])
        report = jg.walk(app)
        found = next(r["found"] for r in report["steps"]
                     if r["step"] == "select_person")
        self.assertEqual(found["pages_read"], 2)
        # The page-2 row has no evidence and no URL, so both universal
        # claims must now be blocked.
        self.assertEqual(self.status(report, "inspect_evidence"), "blocked")
        self.assertEqual(self.status(report, "open_original"), "blocked")

    def test_the_chosen_event_must_carry_the_person_not_merely_the_case(self):
        # ⚠️ THE MUTATION THIS CATCHES: checking the person against the whole
        # CASE. The journey is „choose an event → compare → select the
        # person", so an event the person is not on is a path the gate would
        # bless and a reader could not walk. Here the first qualifying event
        # has no person rows and a later one does.
        app = build(self.root, timeline_story="s-with-person",
                    person_story="s-with-person",
                    other_events=(("s-without-person", 3),))
        report = jg.walk(app)
        chosen = next(r["found"] for r in report["steps"]
                      if r["step"] == "choose_event")
        self.assertEqual(chosen["chosen"], "s-with-person")
        self.assertEqual(chosen["qualifying"], 2)
        self.assertEqual(chosen["walkable_end_to_end"], 1)
        self.assertEqual(self.status(report, "select_person"), "ok")
        # And when NO event carries the person, the step is blocked rather
        # than rescued by the case-level count.
        blocked = jg.walk(build(self.root / "b", person_story="elsewhere"))
        self.assertEqual(self.status(blocked, "select_person"), "blocked")
        self.assertEqual(self.status(blocked, "choose_event"), "blocked")

    def test_a_second_walkable_identity_makes_the_variant_reachable(self):
        # ⚠️ THE MUTATION THIS CATCHES: `ok=False` hardcoded on the variants,
        # which makes `stage_c_complete` unreachable by construction — and
        # makes the transition state a note-less BLOCK.
        app = build(self.root, people=2, ambiguous=0, second_rows=[
            {"url": "https://o0.bg/9", "story_id": "s1",
             "assessment_status": "assessed", "tone": "unfavorable",
             "evidence_spans": [span()]}])
        report = jg.walk(app)
        self.assertEqual(self.status(report, "variant_non_political"), "ok")
        # A second identity whose own journey does NOT complete is blocked
        # WITH a reason — never a note-less BLOCK.
        broken = jg.walk(build(self.root / "c", people=2, second_rows=[
            {"url": "https://o0.bg/9", "story_id": "s1",
             "assessment_status": "assessed", "tone": "unfavorable",
             "evidence_spans": []}]))
        row = next(v for v in broken["variants"]
                   if v["step"] == "variant_non_political")
        self.assertEqual(row["status"], "blocked")
        self.assertTrue(row["note"])

    def test_an_unlocated_quote_is_not_evidence(self):
        # ⚠️ The producer renders an unlocated span struck through and
        # refuses it as support; reading it as evidence accepts exactly what
        # the producer rejects.
        report = jg.walk(build(self.root, person_rows=[
            {"url": "https://o0.bg/1", "story_id": "s1",
             "assessment_status": "assessed", "tone": "unfavorable",
             "evidence_spans": [span(located=False)]}]))
        self.assertEqual(self.status(report, "inspect_evidence"), "blocked")

    def test_the_ambiguous_variant_follows_the_corpus(self):
        # ⚠️ THE MUTATION THIS CATCHES: a hardcoded `ambiguous_refusals: 0`,
        # which keeps printing „no surface has been refused" after one is.
        quiet = jg.walk(build(self.root, ambiguous=0))
        row = next(v for v in quiet["variants"]
                   if v["step"] == "variant_ambiguous_namesake")
        self.assertEqual(row["status"], "unavailable")
        self.assertEqual(row["found"]["ambiguous_refusals"], 0)
        loud = jg.walk(build(self.root / "d", ambiguous=4))
        row = next(v for v in loud["variants"]
                   if v["step"] == "variant_ambiguous_namesake")
        self.assertEqual(row["found"]["ambiguous_refusals"], 4)
        self.assertEqual(row["status"], "blocked")
        self.assertIn("IS refused", row["note"])

    def test_a_malformed_artifact_is_named_not_read_as_absent(self):
        app = build(self.root)
        (app / "stories" / "s1.json").write_text("{not json", encoding="utf-8")
        jg.MALFORMED.clear()
        report = jg.walk(app)
        self.assertEqual([m["path"].rsplit("/", 1)[-1]
                          for m in report["malformed_files"]], ["s1.json"])

    def test_it_fails_closed_on_an_empty_corpus(self):
        report = jg.walk(self.root / "nothing")
        self.assertFalse(report["passed"])
        self.assertFalse(report["stage_c_complete"])
        # Every step blocked, not an empty report that reads as clean.
        self.assertEqual(len(report["blocked"]), len(report["steps"]))
        self.assertEqual(jg.main(["--app-data", str(self.root / "nothing"),
                                  "--enforce"]), 1)

    def test_an_unavailable_variant_is_not_a_failure(self):
        # `--enforce` guards the STEPS; a variant with no subject is a
        # backlog item and must not fail a build.
        self.assertEqual(jg.main(["--app-data", str(build(self.root)),
                                  "--enforce"]), 0)


if __name__ == "__main__":
    unittest.main()
