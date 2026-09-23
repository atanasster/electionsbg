#!/usr/bin/env python3
"""T4.4 Phase 3 — per-outlet and over-time aggregation of one subject's rows."""
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import party_rollups as pr  # noqa: E402
import sentiment_rollups as sr  # noqa: E402


def row(domain="a.bg", tone="neutral", published="2026-09-21T10:00:00+00:00",
        url=None, value=None, name=None):
    out = {"domain": domain, "tone": tone, "published": published,
           "url": url or f"https://{domain}/{tone}/{published}"}
    if value is not None:
        out["sentiment"] = {"value": value}
    if name:
        out["subject_name"] = name
    return out


class OutletBreakdown(unittest.TestCase):
    def test_it_counts_each_outlets_tones_with_its_denominator(self):
        # The user-visible answer to "positive: actualno; negative: pik".
        rows = [row("actualno.com", "favorable"), row("actualno.com", "neutral"),
                row("pik.bg", "unfavorable")]
        out = {e["domain"]: e for e in sr.outlet_breakdown(rows)}
        self.assertEqual(out["actualno.com"]["counts"]["favorable"], 1)
        self.assertEqual(out["actualno.com"]["assessed"], 2)
        self.assertEqual(out["pik.bg"]["counts"]["unfavorable"], 1)
        self.assertEqual(out["pik.bg"]["assessed"], 1)

    def test_the_outlet_with_the_most_coverage_comes_first(self):
        rows = [row("z.bg"), row("a.bg"), row("a.bg")]
        self.assertEqual([e["domain"] for e in sr.outlet_breakdown(rows)],
                         ["a.bg", "z.bg"])

    def test_each_outlet_carries_its_own_window(self):
        rows = [row("a.bg", published="2026-09-01T00:00:00+00:00"),
                row("a.bg", published="2026-09-20T00:00:00+00:00"),
                row("b.bg", published="2026-09-10T00:00:00+00:00")]
        out = {e["domain"]: e for e in sr.outlet_breakdown(rows)}
        self.assertEqual(out["a.bg"]["first_published"], "2026-09-01T00:00:00+00:00")
        self.assertEqual(out["a.bg"]["last_published"], "2026-09-20T00:00:00+00:00")
        self.assertEqual(out["b.bg"]["first_published"],
                         out["b.bg"]["last_published"])

    def test_a_row_with_an_unknown_tone_is_not_counted_as_assessed(self):
        rows = [row("a.bg", tone=None), row("a.bg", tone="weird"),
                row("a.bg", tone="neutral")]
        out = sr.outlet_breakdown(rows)[0]
        self.assertEqual(out["assessed"], 1)
        self.assertEqual(sum(out["counts"].values()), 1)

    def test_rows_and_assessed_are_different_denominators(self):
        # ⚠️ A row whose tone the evidence gate withheld is coverage that
        # EXISTS and was not assessed. Counting only the second makes an
        # outlet that published five pieces look like one that published two.
        rows = [row("a.bg", "neutral"), row("a.bg", tone=None),
                row("a.bg", tone=None)]
        out = sr.outlet_breakdown(rows)[0]
        self.assertEqual(out["rows"], 3)
        self.assertEqual(out["assessed"], 1)

    def test_most_coverage_first_means_the_ROWS(self):
        rows = ([row("quiet.bg", "neutral"), row("quiet.bg", "favorable")]
                + [row("loud.bg", tone=None) for _ in range(5)])
        self.assertEqual([e["domain"] for e in sr.outlet_breakdown(rows)],
                         ["loud.bg", "quiet.bg"])

    def test_a_row_with_no_domain_is_skipped_rather_than_bucketed_under_none(self):
        self.assertEqual(sr.outlet_breakdown([{"tone": "neutral"}]), [])

    def test_the_counts_work_with_no_scalar_at_all(self):
        # Every row carries a label today; a `value` arrives only once the Jev
        # pass is live for that article.
        out = sr.outlet_breakdown([row("a.bg", "favorable")])[0]
        self.assertEqual(out["counts"]["favorable"], 1)
        self.assertIsNone(out["value_mean"])
        self.assertEqual(out["value_scored"], 0)


class Scalars(unittest.TestCase):
    def test_the_scalar_carries_its_OWN_denominator(self):
        # ⚠️ A mean over the three scored rows of forty is not the page's
        # mean, and publishing it beside `assessed` without its own count is
        # how it would be read as one.
        rows = [row("a.bg", value=1.0), row("a.bg", value=-1.0), row("a.bg")]
        out = sr.outlet_breakdown(rows)[0]
        self.assertEqual(out["assessed"], 3)
        self.assertEqual(out["value_scored"], 2)
        self.assertAlmostEqual(out["value_mean"], 0.0)

    def test_a_single_scored_row_reports_no_standard_error(self):
        # ⚠️ A band of zero width around one point reads as certainty.
        out = sr.summarize_values([1.5])
        self.assertAlmostEqual(out["value_mean"], 1.5)
        self.assertEqual(out["value_scored"], 1)
        self.assertIsNone(out["value_se"])

    def test_the_standard_error_is_the_SAMPLE_one(self):
        # ⚠️ AT n = 2 THE SAMPLE SE AND THE POPULATION SD ARE ALGEBRAICALLY
        # IDENTICAL, so the previous fixture could not tell them apart. At
        # n = 3 they differ: sample sd = 1.0 -> se = 1/sqrt(3) = 0.5774,
        # while a population sd of 0.8165 would give 0.4714.
        import math
        out = sr.summarize_values([1.0, 2.0, 3.0])
        self.assertAlmostEqual(out["value_mean"], 2.0)
        self.assertAlmostEqual(out["value_se"], 1.0 / math.sqrt(3), places=6)

    def test_the_mean_really_divides(self):
        # `[1.0, -1.0]` has mean 0 under any implementation that forgets to.
        self.assertAlmostEqual(sr.summarize_values([2.0, 4.0, 6.0])["value_mean"], 4.0)

    def test_summarize_values_guards_its_own_input(self):
        # It is a public helper: `bool` is an `int`, so `True` would average
        # as 1.0, and one NaN poisons every statistic into NaN silently.
        out = sr.summarize_values([1.0, True, float("nan"), None, "2.0", 3.0])
        self.assertEqual(out["value_scored"], 2)
        self.assertAlmostEqual(out["value_mean"], 2.0)

    def test_a_nonnumeric_or_nonfinite_value_is_not_a_scalar(self):
        for bad in (None, True, "1.0", float("nan"), float("inf")):
            self.assertIsNone(sr.scalar_of({"sentiment": {"value": bad}}), bad)
        self.assertIsNone(sr.scalar_of({"sentiment": "x"}))
        self.assertIsNone(sr.scalar_of({}))


class Series(unittest.TestCase):
    def test_the_granularity_is_chosen_from_the_span(self):
        # A month bucket over three weeks is one point; a day bucket over
        # three years is a thousand of mostly nothing.
        def span(days):
            return [row(published=f"2026-01-01T00:00:00+00:00"),
                    row(published=f"2026-01-01T00:00:00+00:00")
                    if not days else
                    {**row(), "published": _plus(days)}]
        self.assertEqual(sr.pick_granularity(span(10)), "day")
        self.assertEqual(sr.pick_granularity(span(200)), "week")
        self.assertEqual(sr.pick_granularity(span(2000)), "month")

    def test_the_granularity_boundaries_are_where_they_are_declared(self):
        for days, expected in ((45, "day"), (46, "week"),
                               (560, "week"), (561, "month")):
            rows = [row(published="2026-01-01T00:00:00+00:00"),
                    row(published=_plus(days))]
            self.assertEqual(sr.pick_granularity(rows), expected, days)

    def test_one_unparseable_date_does_not_flip_the_whole_axis(self):
        # ⚠️ `published_key` returns the year 1 for anything it cannot parse,
        # so one garbage row dragged a clean four-day corpus from `day` to
        # `month` — while `series()` counted that same row as `undated`. The
        # two must agree about which rows have a date.
        clean = [row(published="2026-09-01T00:00:00+00:00"),
                 row(published="2026-09-04T00:00:00+00:00")]
        self.assertEqual(sr.pick_granularity(clean), "day")
        with_junk = clean + [row(published="не се знае")]
        self.assertEqual(sr.pick_granularity(with_junk), "day")
        self.assertEqual(sr.series(with_junk)["undated"], 1)

    def test_a_single_dated_row_needs_no_span_rule(self):
        self.assertEqual(sr.pick_granularity([row()]), "day")
        self.assertEqual(sr.pick_granularity([]), "day")

    def test_a_week_bucket_is_anchored_to_its_monday(self):
        # ⚠️ A date sorts and plots; `2026-W38` does neither without a second
        # rule on the client.
        # 2026-09-23 is a Wednesday.
        self.assertEqual(sr.period_of("2026-09-23T12:00:00+00:00", "week"),
                         "2026-09-21")
        self.assertEqual(sr.period_of("2026-09-21T00:00:00+00:00", "week"),
                         "2026-09-21")

    def test_a_month_bucket_is_the_first_of_the_month(self):
        self.assertEqual(sr.period_of("2026-09-23T12:00:00+00:00", "month"),
                         "2026-09-01")

    def test_the_bucket_is_cut_in_the_CORPUS_wall_clock(self):
        # ⚠️ This is Bulgarian news. 01:00 on 1 January Sofia time is 23:00 on
        # 31 December UTC, so a UTC cut files it under the previous day, the
        # previous month AND the previous year.
        sofia_new_year = "2026-01-01T01:00:00+02:00"
        self.assertEqual(sr.period_of(sofia_new_year, "day"), "2026-01-01")
        self.assertEqual(sr.period_of(sofia_new_year, "month"), "2026-01-01")

    def test_every_point_carries_its_count(self):
        # §6.3: a weekly mean over two articles is not a trend, and the count
        # is annotated rather than inferred from the line's steadiness.
        rows = [row(published="2026-09-21T00:00:00+00:00", tone="favorable"),
                row(published="2026-09-21T06:00:00+00:00", tone="neutral"),
                row(published="2026-09-22T00:00:00+00:00", tone="unfavorable")]
        points = sr.series(rows, "day")["points"]
        self.assertEqual([p["period"] for p in points], ["2026-09-21", "2026-09-22"])
        self.assertEqual(points[0]["assessed"], 2)
        self.assertEqual(points[1]["assessed"], 1)

    def test_an_empty_period_is_ABSENT_not_zero(self):
        # ⚠️ A zero plots as "the press said nothing favourable that week"
        # where the truth is "nothing was published".
        rows = [row(published="2026-09-01T00:00:00+00:00"),
                row(published="2026-09-20T00:00:00+00:00")]
        points = sr.series(rows, "day")["points"]
        self.assertEqual(len(points), 2)
        self.assertNotIn("2026-09-10", [p["period"] for p in points])

    def test_an_undated_row_is_counted_not_bucketed(self):
        out = sr.series([row(published=None), row()], "day")
        self.assertEqual(out["undated"], 1)
        self.assertEqual(len(out["points"]), 1)

    def test_the_points_are_in_chronological_order(self):
        rows = [row(published="2026-09-22T00:00:00+00:00"),
                row(published="2026-09-01T00:00:00+00:00"),
                row(published="2026-09-11T00:00:00+00:00")]
        periods = [p["period"] for p in sr.series(rows, "day")["points"]]
        self.assertEqual(periods, sorted(periods))

    def test_the_chosen_granularity_travels_with_the_series(self):
        # The payload says which rule produced the x-axis.
        self.assertEqual(sr.series([row()])["granularity"], "day")


class ScorePublic(unittest.TestCase):
    """The ONE projection both the party rows and the article page read."""

    SCORE = {"value": -1.2, "normalized": -0.6, "spread": 0.4,
             "confidence_derived": 0.7, "confidence_reported": 0.95,
             "levels": 5, "both_directions": False,
             "probabilities": {"0": 0.3, "1": 0.7, "2": 0.0, "3": 0.0, "4": 0.0}}

    def test_confidence_is_the_DERIVED_field(self):
        # ⚠️ Phase 0 measured the two differ on most answers; whichever a page
        # shows, every page must show the same one.
        self.assertEqual(sr.score_public(self.SCORE)["confidence"], 0.7)

    def test_the_distribution_ships_only_when_asked_for(self):
        # A party row is multiplied across thousands of rows; the article page
        # draws it.
        self.assertNotIn("distribution", sr.score_public(self.SCORE))
        self.assertEqual(
            sr.score_public(self.SCORE, with_distribution=True)["distribution"],
            [0.3, 0.7, 0.0, 0.0, 0.0])

    def test_the_wire_value_is_rounded_but_the_bucket_is_the_EXACT_ones(self):
        # A value a hair under an edge: rounded it sits ON the edge, and a
        # page bucketing the rounded number could land on the other side of
        # the archive's count. The shipped index is the exact value's.
        edge = {**self.SCORE, "value": 0.49999, "normalized": 0.249995}
        out = sr.score_public(edge)
        self.assertEqual(out["value"], 0.5)
        self.assertEqual(out["bucket_index"], 2)       # neutral, not favorable

    def test_float_noise_does_not_reach_the_wire(self):
        noisy = {**self.SCORE, "value": -1.5999999999999999,
                 "spread": 0.6633249580710799}
        out = sr.score_public(noisy)
        self.assertEqual(out["value"], -1.6)
        self.assertEqual(out["spread"], 0.663)

    def test_an_unplaceable_score_has_no_bucket(self):
        self.assertIsNone(sr.score_public({**self.SCORE, "levels": 7})["bucket_index"])
        self.assertIsNone(sr.score_public({**self.SCORE, "value": None})["bucket_index"])

    def test_a_missing_level_is_zero_and_the_length_is_the_scale(self):
        partial = {**self.SCORE, "probabilities": {"1": 1.0}}
        dist = sr.score_public(partial, with_distribution=True)["distribution"]
        self.assertEqual(dist, [0.0, 1.0, 0.0, 0.0, 0.0])


class AttachSentiment(unittest.TestCase):
    """⚠️ EVERY FIXTURE HERE USES A ROW THE COLLECTOR ACTUALLY PRODUCES.

    The previous cut of these tests injected a `name` key that
    `party_rollups.collect` never writes, so they passed while the join
    matched `None` against the first sidecar subject lacking a name — a
    mis-join on every real row, hidden by the fixture.
    """

    def collected_row(self, surface="ПП-ДБ", url="u1"):
        """A row with exactly the keys `party_rollups.collect` emits."""
        return {"url": url, "domain": "a.bg", "article_id": "x", "title": "t",
                "published": "2026-09-21T10:00:00+00:00", "story_id": None,
                "subject_name": surface, "tone": "neutral", "rationale": None,
                "evidence_spans": []}

    def test_the_collector_really_writes_the_key_the_join_reads(self):
        # The assertion whose absence let the mis-join through.
        import analyze_articles as aa
        collected = pr.collect([{
            "url": "u1", "domain": "a.bg", "published": "2026-09-21T10:00:00+00:00",
            "analysis": {"party_tones": [{"party": "ПП-ДБ", "tone": "neutral",
                                          "party_id": "p_6", "rationale": "r"}]},
        }], lambda a: True)
        emitted = collected["parties"]["p_6"]["rows"][0]
        self.assertEqual(emitted["subject_name"], "ПП-ДБ")
        self.assertEqual(sr.attach_sentiment(
            [emitted], {"u1": {"subjects": [
                {"name": "ПП-ДБ", "kind": "party",
                 "tone": {"value": 1.0, "confidence_derived": 0.9, "levels": 5}}]}},
            kind="party"), 1)
        self.assertIsNotNone(aa)  # imported for the collect() contract above

    def test_a_rows_score_is_ITS_OWN_subjects(self):
        records = {"u1": {"subjects": [
            {"name": "ГЕРБ", "kind": "party",
             "tone": {"value": -1.5, "normalized": -0.75,
                      "confidence_derived": 0.8, "levels": 5},
             "subject_role": "secondary"},
            {"name": "ПП-ДБ", "kind": "party",
             "tone": {"value": 1.0, "normalized": 0.5,
                      "confidence_derived": 0.9, "levels": 5},
             "subject_role": "primary"},
        ]}}
        rows = [self.collected_row()]
        self.assertEqual(sr.attach_sentiment(rows, records, kind="party"), 1)
        self.assertAlmostEqual(rows[0]["sentiment"]["value"], 1.0)
        self.assertEqual(rows[0]["sentiment"]["subject_role"], "primary")

    def test_a_nameless_sidecar_subject_never_matches(self):
        # ⚠️ THE EXACT MIS-JOIN. `s.get("name") == None` matched this row.
        records = {"u1": {"subjects": [
            {"kind": "party", "tone": {"value": -9.9, "levels": 5}},
            {"name": "ПП-ДБ", "kind": "party", "tone": {"value": 1.0, "levels": 5}},
        ]}}
        rows = [self.collected_row()]
        self.assertEqual(sr.attach_sentiment(rows, records, kind="party"), 1)
        self.assertAlmostEqual(rows[0]["sentiment"]["value"], 1.0)

    def test_a_row_with_no_surface_attaches_nothing(self):
        records = {"u1": {"subjects": [
            {"kind": "party", "tone": {"value": -9.9, "levels": 5}}]}}
        rows = [{**self.collected_row(), "subject_name": None}]
        self.assertEqual(sr.attach_sentiment(rows, records, kind="party"), 0)
        self.assertNotIn("sentiment", rows[0])

    def test_a_party_never_takes_a_persons_score(self):
        # `jev_sentiment` dedupes on (kind, name); a party and a person can
        # share a surface.
        records = {"u1": {"subjects": [
            {"name": "Възраждане", "kind": "person",
             "tone": {"value": -2.0, "levels": 5}},
            {"name": "Възраждане", "kind": "party",
             "tone": {"value": 2.0, "levels": 5}},
        ]}}
        rows = [self.collected_row("Възраждане")]
        self.assertEqual(sr.attach_sentiment(rows, records, kind="party"), 1)
        self.assertAlmostEqual(rows[0]["sentiment"]["value"], 2.0)

    def test_the_surface_match_is_casefolded_like_the_dedupe(self):
        records = {"u1": {"subjects": [
            {"name": "ГЕРБ", "kind": "party", "tone": {"value": 1.0, "levels": 5}}]}}
        rows = [self.collected_row("герб")]
        self.assertEqual(sr.attach_sentiment(rows, records, kind="party"), 1)

    def test_a_subject_the_record_does_not_carry_gets_nothing(self):
        records = {"u1": {"subjects": [
            {"name": "ГЕРБ", "kind": "party", "tone": {"value": 1.0}}]}}
        rows = [self.collected_row()]
        self.assertEqual(sr.attach_sentiment(rows, records, kind="party"), 0)
        self.assertNotIn("sentiment", rows[0])

    def test_an_unassessed_subject_gets_nothing(self):
        records = {"u1": {"subjects": [{"name": "ПП-ДБ", "kind": "party",
                                        "tone": None,
                                        "subject_role": "incidental"}]}}
        rows = [self.collected_row()]
        self.assertEqual(sr.attach_sentiment(rows, records, kind="party"), 0)


class PartyPayload(unittest.TestCase):
    def party(self, rows):
        return {"party_id": "p_6", "names": {"ПП-ДБ": len(rows)},
                "counts": sr.empty_counts(), "assessed": len(rows),
                "articles": {r["url"] for r in rows},
                "outlets": {r["domain"] for r in rows},
                "first_published": None, "last_published": None, "undated": 0,
                "rows": rows}

    def test_the_payload_carries_the_breakdown_and_the_series(self):
        rows = [row("pik.bg", "unfavorable"), row("actualno.com", "favorable")]
        out = pr.party_payload(self.party(rows), "now", "v1")
        self.assertEqual(len(out["by_outlet"]), 2)
        self.assertIn("granularity", out["series"])

    def test_they_describe_the_ARCHIVE_not_the_page(self):
        # ⚠️ Computed from `window`, they would describe the newest fifty
        # while sitting under a header whose counts describe all of them.
        rows = [row("a.bg", published=_plus(i)) for i in range(60)]
        rows.append(row("rare.bg", published="2020-01-01T00:00:00+00:00"))
        payload = pr.party_payload(self.party(rows), "now", "v1", page=1)
        self.assertEqual(payload["total_pages"], 2)
        self.assertEqual(len(payload["articles"]), 50)
        self.assertIn("rare.bg", [e["domain"] for e in payload["by_outlet"]])

    def test_they_are_identical_on_every_page(self):
        rows = [row("a.bg", published=_plus(i)) for i in range(60)]
        first = pr.party_payload(self.party(rows), "now", "v1", page=1)
        second = pr.party_payload(self.party(rows), "now", "v1", page=2)
        self.assertEqual(first["by_outlet"], second["by_outlet"])
        self.assertEqual(first["series"], second["series"])


def _plus(days: int) -> str:
    from datetime import datetime, timedelta, timezone
    base = datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(days=days)
    return base.isoformat()


if __name__ == "__main__":
    unittest.main()
