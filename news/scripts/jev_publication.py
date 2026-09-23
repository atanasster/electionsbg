#!/usr/bin/env python3
"""T4.4 Phase 5 — which Jev axes are published, and to whom.

Plan: `docs/plans/news-jev-sentiment-scales-v1.md` Phase 5. „Flipped per axis,
never all at once, and only for axes Phase 0 cleared. Rollback is one
environment variable."

⚠️⚠️ NOTHING IS PUBLISHED BY DEFAULT, AND THAT IS THE POINT OF THE FILE.
`jev_ask.NEWS_JEV_SENTIMENT` decides whether the pass RUNS; this decides
whether what it produced reaches a reader, and the two are deliberately
separate. The whole of Phase 0 is a shadow run — the sidecars are written, the
eval reads them, and no page changes — so a single switch covering both would
make measuring the pass and publishing it the same act.

⚠️ PER AXIS, NOT ONE FLAG. Phase 0 scores `leaning`, `russia_stance` and
`subject_tone` separately and can clear them separately: the benchmark that
preceded this one found Jev winning by +53 points on one question and LOSING to
a constant on another, in the same run. A single boolean would publish the
second on the strength of the first.

    NEWS_JEV_PUBLISH=subject_tone            # one axis
    NEWS_JEV_PUBLISH=leaning,russia_stance   # two
    NEWS_JEV_PUBLISH=                        # the default: none

⚠️ AN UNKNOWN NAME IS REFUSED, NOT IGNORED. A typo („subject-tone",
„party_tone") would otherwise read as „publish nothing" and look identical to
the default — so the one case where an operator believes they have shipped and
have not is the one this raises on.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import jev_axes as ax  # noqa: E402

PUBLISH_ENV = "NEWS_JEV_PUBLISH"

# Every axis Phase 0 scores. `subject_tone` is the one the party and person
# archives read; the other two are article-level.
PUBLISHABLE_AXES = frozenset(
    {axis["id"] for axis in ax.ARTICLE_AXES} | {ax.SUBJECT_TONE.id})


class JevPublicationError(ValueError):
    """The publication set cannot be read. Never silently empty."""


def published_axes(env=None) -> frozenset:
    """The axes cleared for publication, from the environment.

    Empty by default — Phase 0 runs in shadow and no page changes.
    """
    raw = (env if env is not None else os.environ).get(PUBLISH_ENV) or ""
    names = [part.strip() for part in raw.split(",") if part.strip()]
    unknown = sorted(set(names) - PUBLISHABLE_AXES)
    if unknown:
        raise JevPublicationError(
            f"{PUBLISH_ENV}: unknown axis {unknown} — "
            f"known axes are {sorted(PUBLISHABLE_AXES)}")
    return frozenset(names)


def publishes(axis: str, env=None) -> bool:
    return axis in published_axes(env)


def attach_for_parties(collected: dict, data_dir, *, env=None) -> dict:
    """Attach stored subject scores to a party rollup's rows, if published.

    Returns a report: which axis, how many rows carried a score, and how many
    could be offered one. ⚠️ BOTH NUMBERS, because „0 attached" and „0
    available" are different states — the first is a join that failed, the
    second is a pass that has not run — and a single count reads as the
    happier of the two.
    """
    report = {"axis": ax.SUBJECT_TONE.id, "published": False,
              "records": 0, "stale": 0, "rows": 0, "attached": 0,
              "withheld": {}, "editorial": 0, "jev_subjects_without_row": 0}
    if not publishes(ax.SUBJECT_TONE.id, env):
        return report
    report["published"] = True

    import jev_sentiment as sm  # noqa: PLC0415
    import sentiment_rollups as sr  # noqa: PLC0415

    records = {}
    for path in sm.sentiment_dir(data_dir).glob("*.json"):
        try:
            import json  # noqa: PLC0415
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        # ⚠️ THE STORE'S OWN FILTER, NOT A COPY OF PART OF IT. This gate once
        # kept only the `status` check and dropped all four version stamps, so
        # a record the store itself refuses as stale published verbatim onto a
        # party page and reported a clean attach — reachable from an ordinary
        # `NEWS_JEV_SENTIMENT=off` plus a cleared axis, which is exactly the
        # configuration the two flags exist to allow.
        if not isinstance(doc, dict) or not doc.get("url"):
            continue
        if not sm.answered(doc):
            # Counted, so „nothing to publish" and „everything is stale" are
            # not the same silence.
            report["stale"] += 1
            continue
        records[doc["url"]] = doc
    report["records"] = len(records)
    # ⚠️ NO EARLY RETURN ON AN EMPTY STORE. Publishing means Jev is the
    # producer of this archive; with nothing scored yet every row is
    # `not_scored`, which the page says. Returning here instead kept every
    # row on GLM's tone — the axis reported as published while the archive
    # showed the other producer's verdicts, on exactly the host that has not
    # backfilled yet.
    reviewed = collected.get("row_reviewed") or {}
    have_row = set()
    for party_id, party in (collected.get("parties") or {}).items():
        rows = party.get("rows") or []
        report["rows"] += len(rows)
        report["attached"] += sr.attach_sentiment(rows, records, kind="party")
        party["tone_producer"] = "jev"
        party["tone_rubric_version"] = sm.RUBRIC_VERSION
        for row in rows:
            have_row.add((row.get("url"),
                          str(row.get("subject_name") or "").casefold()))
            # ⚠️ AN ACCEPTED EDITORIAL VERDICT WINS, as it does on the article
            # page (`article_public` withholds the whole block there). A human
            # decided this row's tone; relabelling it would publish a model
            # verdict on the party page and the human one on the article page
            # — two answers to one question.
            if reviewed.get((row.get("url"), party_id)):
                row["tone_producer"] = "editorial"
                report["editorial"] += 1
                continue
            reason = relabel_row(row, records.get(row.get("url")))
            if reason:
                report["withheld"][reason] = report["withheld"].get(reason, 0) + 1
    # ⚠️ THE ARCHIVE'S ROW SET IS STILL GLM'S. A row exists where GLM toned a
    # party on an article it read in full; Jev may have scored a party on an
    # article GLM scoped out or never toned, and that score has no row to land
    # on. Counted, so the gap is a number rather than an unstated limit.
    for url, doc in records.items():
        for subject in doc.get("subjects") or []:
            if (isinstance(subject, dict) and subject.get("kind") == "party"
                    and isinstance(subject.get("tone"), dict)
                    and (url, str(subject.get("name") or "").casefold())
                    not in have_row):
                report["jev_subjects_without_row"] += 1
    # ⚠️ AND THE COUNTS FOLLOW THE ROWS. `collect` folded GLM's tones into
    # `counts`, `assessed` and `topics` as it walked; without this the header
    # would count one producer's verdicts over a list showing another's.
    import party_rollups  # noqa: PLC0415
    party_rollups.recount(collected)
    return report


def _dropped_party(names: list, surface: str) -> bool:
    """Was a PARTY with this surface dropped past the cap?

    Entries are `{"kind", "name"}`; a record written before that carried bare
    names, and one of those matches on the name alone — the safe direction,
    since a match reads `not_scored` rather than claiming absence.
    """
    for entry in names:
        if isinstance(entry, dict):
            if (entry.get("kind") == "party"
                    and str(entry.get("name") or "").casefold() == surface):
                return True
        elif str(entry).casefold() == surface:
            return True
    return False


# The four labels the archive counts over, from the five display buckets. The
# strong degrees are an ordinal refinement of the same side, and the row keeps
# its `bucket` so a page can still say „силно негативен".
_COUNT_LABEL = {
    "strongly_unfavorable": "unfavorable",
    "unfavorable": "unfavorable",
    "neutral": "neutral",
    "favorable": "favorable",
    "strongly_favorable": "favorable",
}


def relabel_row(row: dict, record) -> str | None:
    """Make Jev the producer of this archive row. Returns why it has no tone.

    ⚠️⚠️ THIS IS WHAT PUBLISHING `subject_tone` MEANS FOR THE ARCHIVE. Before
    it, publishing only ATTACHED a Jev score beside each row while `tone` —
    which the counts, the per-outlet breakdown and the row label all read —
    stayed GLM's. Measured on the ПП-ДБ archive with the axis published: it
    still read „pik.bg — негативен" and „actualno — позитивен", the two
    verdicts this whole plan was opened to fix.

    A row Jev did not score gets NO tone and a named reason, never GLM's tone:
    one distribution over two producers is a number that means neither.
      - `incidental`    — Jev judged the party a passing mention (plan §3.7);
      - `not_a_subject` — the party is not in the text Jev read at all (the
                          pik.bg case: zero mentions);
      - `not_scored`    — no current record for this article yet.

    GLM's `rationale` and quotes leave with its verdict: they argued for a
    label this row no longer shows.
    """
    row["tone_producer"] = "jev"
    row["rationale"] = None
    row["evidence_spans"] = []
    sentiment = row.get("sentiment")
    index = (sentiment or {}).get("bucket_index") if isinstance(sentiment, dict) else None
    if isinstance(index, int) and 0 <= index < len(ax.SUBJECT_TONE.labels):
        # ⚠️ THE SHIPPED INDEX, computed from the EXACT value — never a
        # re-bucketing of `value`, which `score_public` rounds for the wire.
        bucket = ax.SUBJECT_TONE.labels[index]
        row["bucket"] = bucket
        # `mixed` is DERIVED from the distribution (plan §3.5), never stored.
        row["tone"] = ("mixed" if sentiment.get("both_directions")
                       else _COUNT_LABEL[bucket])
        row.pop("tone_withheld", None)
        return None
    row["tone"] = None
    row.pop("bucket", None)
    if not isinstance(record, dict):
        reason = "not_scored"
    else:
        surface = str(row.get("subject_name") or "").casefold()
        subject = next((s for s in record.get("subjects") or []
                        if isinstance(s, dict) and s.get("kind") == "party"
                        and str(s.get("name") or "").casefold() == surface), None)
        if subject is None and not record.get("subjects") and (
                record.get("subjects_total") or 0) > 0:
            # ⚠️ The record HAD subjects and scored none of them: its subject
            # calls failed. That says nothing about whether the party is in
            # the article. (Such a record is `partial` and not published
            # today; this holds the rule for any record that reaches here.)
            reason = "not_scored"
        elif subject is None:
            # ⚠️ ABSENT FROM `subjects` IS NOT ABSENT FROM THE ARTICLE. The
            # record holds only the subjects it SCORED; past the cap a party
            # is missing because it was dropped. Measured: all 8 ПП-ДБ rows
            # first labelled „не е субект" had dropped subjects, and the text
            # of most of them names the party outright. Absence is claimed
            # only when the record can show it — nothing dropped, or a named
            # list of what was dropped that does not include this party.
            dropped = record.get("subjects_dropped") or 0
            names = record.get("subjects_dropped_names")
            if dropped and not isinstance(names, list):
                reason = "not_scored"          # an older record: undecidable
            elif isinstance(names, list) and _dropped_party(names, surface):
                reason = "not_scored"          # past the cap
            else:
                reason = "not_a_subject"
        elif subject.get("subject_role") == "incidental":
            reason = "incidental"
        else:
            # A substantial subject with no tone: the call failed for it.
            reason = "not_scored"
    row["tone_withheld"] = reason
    return reason


def article_public(article: dict, analysis: dict, data_dir, *, env=None,
                   human_reviewed: bool = False, axes=None):
    """The Jev block ONE article page carries, or None when there is none.

    ⚠️ ONLY PUBLISHED AXES, and each is gated on its own. `NEWS_JEV_PUBLISH`
    is per axis so the three can clear Phase 0 at different times; a block
    that shipped every stored axis would publish the unreviewed ones the day
    the first one cleared.

    ⚠️ `current_for`, NOT `answered`. The party side holds only records and can
    check their version stamps; this side holds the article, so it can also
    check that the record was computed over THESE words and THIS subject set.
    A record for an article re-extracted since the last ask is refused here
    rather than shown beside text it no longer describes.

    ⚠️ A HUMAN REVIEW WINS, and the block says so rather than vanishing. An
    accepted editorial review covers leaning, russia_stance and party tones
    together; a model scale printed beside „Проверено от редакционния екип"
    would contradict the human verdict on the same question.

    Absent (None) means „nothing to show": no axis published, or no current
    record. It is never a neutral.
    """
    # The build resolves the publication set ONCE and passes it; reading the
    # environment per article would let two articles in one build disagree.
    axes = published_axes(env) if axes is None else axes
    if not axes:
        return None
    if human_reviewed:
        return {"withheld": "human_reviewed"}

    import jev_sentiment as sm  # noqa: PLC0415
    import sentiment_rollups as sr  # noqa: PLC0415

    doc = sm.current_for(article, analysis, data_dir)
    if not doc:
        return None

    out = {
        "rubric_version": doc.get("rubric_version"),
        # A list when the calls resolved to different model ids — joined so
        # the page's type holds and the byline names every one.
        "model": (", ".join(doc["model"]) if isinstance(doc.get("model"), list)
                  else doc.get("model")),
        "assessed_at": doc.get("generated_at"),
        # What Jev actually READ — a truncated article must not wear a
        # whole-text badge. Stamped by the ask from what was sent.
        "text_scope": doc.get("text_scope"),
        "axes": {},
    }
    for axis in ax.ARTICLE_AXES:
        if axis["id"] not in axes:
            continue
        stored = (doc.get("axes") or {}).get(axis["id"])
        if not isinstance(stored, dict) or not isinstance(stored.get("score"), dict):
            continue
        out["axes"][axis["id"]] = {
            # How likely the axis is to APPLY at all — kept beside the score,
            # never folded into it: a confident zero on an article the axis
            # does not fit is a different finding from a neutral article it
            # does (plan §3.3).
            "applies": stored.get("applies"),
            **sr.score_public(stored["score"], with_distribution=True),
        }
    if ax.SUBJECT_TONE.id in axes:
        subjects = []
        for subject in doc.get("subjects") or []:
            if not isinstance(subject, dict) or not subject.get("name"):
                continue
            row = {
                "name": subject["name"],
                "kind": subject.get("kind"),
                "subject_role": subject.get("subject_role"),
                "mentions": subject.get("mentions"),
            }
            # ⚠️ AN INCIDENTAL SUBJECT SHIPS WITH NO TONE, not a neutral one.
            # Jev is never asked about a subject the article only mentions in
            # passing (plan §3.7) — which is the whole fix for a party quoted
            # once in a comment being scored as the article's target.
            if isinstance(subject.get("tone"), dict):
                row["tone"] = sr.score_public(subject["tone"],
                                              with_distribution=True)
            subjects.append(row)
        out["subjects"] = subjects
        out["subjects_total"] = doc.get("subjects_total")
        out["subjects_dropped"] = doc.get("subjects_dropped")
        # The cap itself, so the page states the real number rather than a
        # literal that goes stale the day the cap moves (it said „six" for 18).
        out["subjects_max"] = sm.MAX_SUBJECTS
    if not out["axes"] and not out.get("subjects"):
        return None
    return out
