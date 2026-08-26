#!/usr/bin/env python3
"""Which analysis records need a human — or a better model — to look again.

⚠️⚠️ A BARE CONFIDENCE THRESHOLD ROUTES EXACTLY BACKWARDS, and the corpus
says so. Measured over the 365 analyses on disk:

    leaning        not_applicable  n=329  median confidence 0.80
                   neutral         n= 31  median 0.65
                   progressive     n=  4  median 0.60
    russia_stance  not_applicable  n=344  median 0.90
                   anti_russia     n= 12  median 0.60
                   pro_russia      n=  1  median 0.60

The model is MOST confident where it asserts nothing and LEAST where it takes
a position. „Route everything below 0.7" would therefore send almost every
real judgment to review and none of the 329 not_applicables — the opposite of
useful, at the cost of the whole review budget.

So routing is on CONSEQUENCE × confidence:

  • `not_applicable` and `neutral` assert nothing about the text and are
    reviewed only if the model is genuinely unsure.
  • A positioned label is a claim about an article's framing — reviewed below
    a higher floor.
  • ⚠️ A `strong_*` label is reviewed ALWAYS, whatever the confidence. It is
    the strongest thing this site says about a text, and „the model was very
    sure" is not evidence — the measurement above shows confidence tracks
    how SAFE a label is, not how right.
  • ⚠️ `likely_ai` is reviewed ALWAYS, for the same reason plus one more: it
    is an accusation about a named outlet, and the rubric already calls the
    assessment „probabilistic, hedged, never proof".

A pipeline that knows what it does not know is worth more than one
confidently wrong on a tenth of its political framing calls.
"""

# Assert nothing ADVERSE about the text, so only real uncertainty is worth a
# look.
#
# ⚠️ `likely_human` belongs here and its absence was a live miscalibration:
# it is the SAFE DEFAULT of the AI axis — „this reads like ordinary
# journalism" — and it carries a median confidence of 0.6 because the rubric
# tells the model to hedge. Treated as a positioned claim it put 355 of 365
# records into the review queue, 98% of the corpus, which is the same as
# having no queue at all.
NEUTRAL_LABELS = frozenset({"not_applicable", "neutral", "unclear",
                            "likely_human"})

# ⚠️ Two floors, and the LOWER one is for the labels that say nothing. The
# obvious arrangement — a single floor, or a higher bar for the safe labels —
# spends the review budget confirming 329 not_applicables.
FLOOR_NEUTRAL = 0.40
FLOOR_POSITIONED = 0.75

# Reviewed whatever the confidence. See the module docstring: these are the
# claims where being wrong is worst and where confidence is least informative.
# ⚠️ DERIVED from the analyzer's own vocabularies, not listed. A fifth
# `strong_*` label added there would otherwise ride the 0.75 floor silently —
# and `len(strong) == 4` would stay green while the strongest claim the site
# can make about a text stopped being reviewed.
def _strong_labels() -> frozenset:
    try:
        import analyze_articles as aa
        return frozenset(
            x for x in (set(aa.LEANING_LABELS) | set(aa.RUSSIA_LABELS))
            if x.startswith("strong_"))
    except Exception:  # noqa: BLE001
        # ⚠️ analyze_articles imports THIS module, so on the import that
        # started there the module object exists but its constants may not
        # yet. The literal fallback is the same set and is asserted equal to
        # the derived one by the test — a fallback that could DISAGREE would
        # be worse than no fallback.
        return frozenset({"strong_conservative", "strong_progressive",
                          "strong_pro_russia", "strong_anti_russia"})


ALWAYS_REVIEW = _strong_labels() | {"likely_ai"}

# The fields routing looks at, and where each one's verdict lives.
ROUTED_FIELDS = (("leaning", "label"),
                 ("russia_stance", "label"),
                 ("ai_generated", "verdict"))


def field_review(label, confidence) -> str | None:
    """Why this field needs another look, or None.

    Returns a REASON rather than a boolean: „the model was unsure" and „this
    is the strongest claim we make" are different problems and a reviewer
    triages them differently.
    """
    if label is None:
        # ⚠️ A missing label is not a confident one. It reaches here only
        # from a malformed record, and treating it as „nothing to review"
        # would let the one shape nobody validated through untouched.
        return "no label"
    if label in ALWAYS_REVIEW:
        return f"{label} is the strongest claim this site makes about a text"
    if isinstance(confidence, bool) or not isinstance(
            confidence, (int, float)):
        # ⚠️ `bool` IS an `int` in Python, so `True` reads as a confidence of
        # 1.0 and clears every floor. The project's own `is_num` excludes it
        # for the same reason.
        return "no confidence"
    floor = FLOOR_NEUTRAL if label in NEUTRAL_LABELS else FLOOR_POSITIONED
    if confidence < floor:
        return f"{confidence} is below the {floor} floor for {label!r}"
    return None


# ⚠️⚠️ A POLITICAL ARTICLE MARKED „no position on the axis" IS A RUBRIC
# ERROR, not a judgment, and it is the commonest one in this corpus: of 82
# analysed articles with a political primary topic, 66% carry
# `not_applicable` on leaning and only 29% `neutral`. The rubric is explicit
# that `neutral` is for a political topic handled even-handedly and
# `not_applicable` for a piece with no political dimension at all — a weather
# report, a football result.
#
# It matters because `not_applicable` is EXCLUDED from the spectrum bar, so
# such an article vanishes from the story's distribution and is counted as
# „unrated". A story with seven equally neutral pieces renders as seven of
# which two were never scored, which is how this was noticed.
#
# ⚠️ The prompt is now explicit about it (news/prompts/analyze_system.md), but
# a prompt change is not retroactive: every record already on disk was
# produced under the old wording. Flagging the combination is what makes those
# records actionable instead of invisible.
POLITICAL_CATEGORIES = frozenset({
    "government", "parliament", "elections-parliamentary", "elections-local",
    "judiciary", "procurement", "state-budget", "foreign-policy",
    "security-defense", "economy", "energy", "healthcare", "education",
    "social-pensions", "environment", "media-press", "eu-funds",
})


def primary_category(analysis: dict):
    for t in analysis.get("topics") or []:
        if isinstance(t, dict) and t.get("primary"):
            return t.get("category")
    return None


def political_not_applicable(analysis: dict) -> str | None:
    """Is this a political article that declined the political axis?"""
    quality = analysis.get("quality")
    if not isinstance(quality, dict) or quality.get("verdict") != "ok":
        # A paywall shell or a listing page is correctly not_applicable.
        return None
    if not analysis.get("site_relevant"):
        return None
    category = primary_category(analysis)
    if category not in POLITICAL_CATEGORIES:
        return None
    leaning = analysis.get("leaning")
    if not isinstance(leaning, dict) or leaning.get("label") != "not_applicable":
        return None
    return (f"primary topic is {category!r} — a political subject handled "
            "even-handedly is `neutral`, and `not_applicable` drops it out "
            "of the spectrum bar entirely")


def record_review(analysis: dict) -> dict:
    """Every field of one record that needs another look.

    ⚠️ PER FIELD, never one verdict for the record. „Its topics are fine and
    its Russia stance is not" is the useful output; a single boolean sends
    the whole record back and loses the part that was right — which is the
    entire point of measuring per field in the first place.
    """
    out = {}
    for field, key in ROUTED_FIELDS:
        block = analysis.get(field) or {}
        if not isinstance(block, dict):
            # ⚠️ „leaning": "progressive" — a string where an object belongs.
            # It reaches here only from a record no validator saw, and
            # calling `.get` on it raised out of the caller's loop.
            out[field] = f"{field} is not an object: {type(block).__name__}"
            continue
        why = field_review(block.get(key), block.get("confidence"))
        if why:
            out[field] = why
    # ⚠️ A NAME THE ARTICLE DOES NOT SPELL THAT WAY. The validator refuses
    # this at save time now, but a prompt and a validator are not
    # retroactive: three records on disk carry „Антон Славев" and „Кая
    # Каллас". Flagging them is what makes those actionable.
    try:
        import analyze_articles as aa
        rec = analysis.get("_article")
        if isinstance(rec, dict):
            bad = aa.check_person_names(
                analysis.get("entities") or {}, rec, analysis)
            if bad:
                out["entities"] = bad[0]
    except Exception:  # noqa: BLE001
        pass

    # ⚠️ Independent of the confidence floors above: this record is flagged
    # because the LABEL is wrong for the topic, however sure the model was —
    # and it was sure, at a median confidence of 0.85.
    if "leaning" not in out:
        mismatch = political_not_applicable(analysis)
        if mismatch:
            out["leaning"] = mismatch
    return out


# ─────────────────────────────────────────────────────────────────────────
# The queue reader. Kept in this file so the ROUTING RULE and the thing that
# reports on it cannot drift — a queue built from a second copy of the rule
# would disagree with the `review` field stamped at save time, and the
# disagreement would look like a data problem.

def main() -> int:
    import argparse
    import glob
    import json
    import os
    from pathlib import Path

    ap = argparse.ArgumentParser(
        description="List the analysed records that need another look.")
    ap.add_argument("--field", default=None,
                    help="only this field (leaning / russia_stance / "
                         "ai_generated)")
    # ⚠️ 0 MEANS UNLIMITED, and it has to: run_nightly.sh passes it to get
    # the whole queue into the report, and `rows[:0]` shipped
    # `needing_review: 16, shown: 0, queue: []` every night at exit 0 — a
    # report that names the number and then withholds every row.
    ap.add_argument("--limit", type=int, default=50,
                    help="0 for all of them")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    root = os.environ.get("DATA_BG_ROOT") or str(
        Path(__file__).resolve().parents[2])
    pattern = os.path.join(root, "news", "data", "analysis", "articles",
                           "*", "*.json")

    rows = []
    malformed = []
    scanned = 0
    by_field: dict = {}
    for path in sorted(glob.glob(pattern)):
        try:
            with open(path, encoding="utf-8") as fh:
                a = json.load(fh)
        except (OSError, json.JSONDecodeError):
            continue
        scanned += 1
        # ⚠️ RE-DERIVED, not read from the stored `review` field. A record
        # saved before the rule existed carries none, and one saved under an
        # older rule carries a stale one — a queue that trusted the stamp
        # would silently skip both. The stamp is for consumers; this is the
        # authority.
        #
        # ⚠️ The ARTICLE is attached first, so the name check can run. It
        # rides under a leading underscore and is never stored — elsewhere
        # `record_review` is a pure function of the analysis, and a corpus
        # record inside a saved analysis would be a second copy of the text.
        art = a.get("article_path")
        if art:
            try:
                with open(os.path.join(root, art), encoding="utf-8") as fh:
                    a["_article"] = json.load(fh)
            except (OSError, json.JSONDecodeError):
                pass
        try:
            review = record_review(a)
        except (AttributeError, TypeError) as exc:
            # ⚠️ NAMED, not fatal. A record whose `leaning` is a string
            # rather than an object raised out of the loop, killing all 365
            # — and, through run_nightly.sh's non-zero-exit grep, the whole
            # night's run. One malformed record must cost one record.
            malformed.append({"path": path, "detail": f"{type(exc).__name__}: {exc}"})
            continue
        if not review:
            continue
        if args.field and args.field not in review:
            continue
        for field in review:
            by_field[field] = by_field.get(field, 0) + 1
        block = {}
        for field in review:
            b = a.get(field)
            # ⚠️ THE SAME GUARD AS record_review's, and its absence here was
            # a SECOND instance of the same crash: record_review flagged the
            # malformed field correctly and then this loop called `.get` on
            # the same string, raising out of the reader anyway. One fix in
            # one place is not enough when two places dereference the block.
            b = b if isinstance(b, dict) else {}
            block[field] = {
                "label": b.get("label") or b.get("verdict"),
                "confidence": b.get("confidence"),
                # ⚠️ `ai_generated` carries `signals`, not `evidence` —
                # reading only `evidence` gave every AI row an empty string,
                # i.e. a review queue entry with nothing to review.
                "evidence": (b.get("evidence")
                             or "; ".join(b.get("signals") or [])
                             or "")[:200],
                "why": review[field],
            }
        rows.append({"url": a.get("url"), "domain": a.get("domain"),
                     "model": a.get("model"), "fields": block})

    if args.limit < 0:
        print(json.dumps({"error": "bad_limit",
                          "detail": "--limit must be >= 0 (0 for all)"}))
        return 3
    shown = rows if args.limit == 0 else rows[:args.limit]
    out = {
        "scanned": scanned,
        # Counts beside their denominator, never a bare rate.
        "needing_review": len(rows),
        # ⚠️ Reported. A record this rule could not read is a record nobody
        # reviewed, which is exactly what the queue exists to surface.
        "malformed": malformed,
        "by_field": dict(sorted(by_field.items())),
        "shown": len(shown),
        "floors": {"neutral": FLOOR_NEUTRAL, "positioned": FLOOR_POSITIONED,
                   "always": sorted(ALWAYS_REVIEW)},
        "queue": shown,
    }
    print(json.dumps(out, ensure_ascii=False,
                     indent=None if args.json else 1))
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
