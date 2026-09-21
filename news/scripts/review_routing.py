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
INHERENTLY_POLITICAL_CATEGORIES = frozenset({
    "government", "parliament", "elections-parliamentary", "elections-local",
    "judiciary", "procurement", "state-budget", "foreign-policy",
    "security-defense",
})

# These are policy beats, not proof that an individual article has a
# political dimension. A company-results story is still `economy`, a patient
# advice piece is still `healthcare`, and a wildfire report is still
# `environment`. Treat the beat as political only when the analysis also
# found a party; otherwise this rule turns ordinary subject taxonomy into a
# fabricated leaning judgment and floods the review queue.
POLICY_CATEGORIES = frozenset({
    "economy", "energy", "healthcare", "education", "social-pensions",
    "environment", "media-press", "eu-funds",
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
    if category not in INHERENTLY_POLITICAL_CATEGORIES | POLICY_CATEGORIES:
        return None
    parties = (analysis.get("entities") or {}).get("parties") or []
    party_mentions = [
        mention for mention in (analysis.get("mentions") or [])
        if isinstance(mention, dict) and mention.get("kind") == "party"
    ]
    if category in POLICY_CATEGORIES and not (parties or party_mentions):
        return None
    leaning = analysis.get("leaning")
    if not isinstance(leaning, dict) or leaning.get("label") != "not_applicable":
        return None
    return (f"primary topic is {category!r} — a political subject handled "
            "even-handedly is `neutral`, and `not_applicable` drops it out "
            "of the spectrum bar entirely")


# ⚠️⚠️ A REFUSAL THE REGISTRY HAS ALREADY ADJUDICATED IS NOT A REVIEW ITEM.
# Measured 2026-09-21: 747 unresolved-party-identity entries, the single
# largest contributor to this queue — and they are THREE different jobs
# wearing one label. Asking a human to confirm „Възраждане is an ordinary
# Bulgarian noun" seventy-eight times is asking them to re-adjudicate standing
# policy, once per article, for ever.
#
#   118 over   8 surfaces  already decided, in writing → NOT routed
#               Възраждане 78 (gazetteer `refusal: common_word`), the generic
#               labels („Демократическа партия"…), Зелените 15, Атака 2
#   602 over 133 surfaces  no gazetteer claim at all → routed, and ACTIONABLE
#               Демократична България 54, Алтернатива за Германия 53, ХДС 34,
#               ДПС 29, БСП 28, Единна Русия 25
#    25              the gazetteer claims one surface more than once → routed
#     2              resolvable, yet the stored `party_id` is None → re-stamp
#
# ⚠️ THE 602 ARE A DATA GAP, NOT A JUDGMENT CALL, and they are worth reading
# twice: the gazetteer does not claim ДПС, БСП or Демократична България. Their
# `party_id` is therefore None, their tone never publishes, and the party never
# appears in an aggregate — so this queue is also the clearest evidence for why
# the site says so little about parties. Adding those surfaces removes ~80% of
# this arm and publishes real party coverage; it is not review work.
#
# ⚠️⚠️ ASK THE REGISTRY THAT STAMPED THE FIELD, NOT A DIFFERENT ONE. There are
# TWO party registries here and they do not agree:
#
#   data/gazetteer.json           — what `party_id_for_name` reads. It made the
#                                   decision that `party_id` is None and it
#                                   carries the refusal REASON per surface.
#   config/party_identity_v2.json — a separate reviewed-policy file used by
#                                   `party_identity.py` for article-level
#                                   country/context resolution.
#
# The first cut of this guard asked the SECOND about a decision the FIRST had
# made, and was inverted on a large slice: it routed „Възраждане", which the
# gazetteer refuses in writing, and skipped „ХДС"/„ДБ"/„Демократична България",
# which the gazetteer does not contain at all — precisely the actionable case.
# A guard that silences the actionable half and keeps the settled half is worse
# than no guard.
#
# ⚠️ AND IT FAILS OPEN, LOUDLY. `_party_claims` returns None when the gazetteer
# cannot be loaded, which is indistinguishable from „no claim" unless it is
# handled; treating that as „adjudicated" would empty this queue whenever its
# own dependency broke. The reason names the outage instead, and the warning
# below fires once per process so a policy-version bump does not read as a
# corpus regression.
_IDENTITY_OUTAGE_WARNED: list = []


def _warn_identity_outage(detail: str) -> None:
    """Say it once — a per-tone warning is noise nobody reads."""
    if _IDENTITY_OUTAGE_WARNED:
        return
    _IDENTITY_OUTAGE_WARNED.append(True)
    import sys as _sys
    print(f"review_routing: party identity registry unavailable ({detail}); "
          "every unresolved surface is being routed", file=_sys.stderr)


_FOREIGN_SURFACES: list = []


def _declared_foreign(surface: str) -> bool:
    """Is this surface one `party_identity_v2.json` declares a foreign party's?

    ⚠️ A SEPARATE CHECK FROM THE GAZETTEER'S, because the two files answer
    different questions and a surface can be missing from one and decided in
    the other. „ХДС" is not in the gazetteer at all — it is three characters
    and not on the curated short-surface allowlist — so the gazetteer has no
    claim to refuse. The policy file DOES have a decision about it: it is the
    German CDU, and all 45 of its tones in this corpus are German coverage.
    Routing it as „nobody has decided this" would ask a reviewer to add a
    Bulgarian party for German reporting.
    """
    if not _FOREIGN_SURFACES:
        import json
        from pathlib import Path
        path = (Path(__file__).resolve().parents[1] / "config"
                / "party_identity_v2.json")
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, ValueError):
            doc = {}
        _FOREIGN_SURFACES.append(frozenset(
            x.strip().casefold()
            for row in doc.get("foreign_parties") or []
            for x in row.get("surfaces") or []
            if isinstance(x, str) and x.strip()))
    return surface.strip().casefold() in _FOREIGN_SURFACES[0]


def _identity_reason(surface: str, analysis: dict) -> str | None:
    """Why this unresolved party surface still needs a human, or None."""
    try:
        import analyze_articles as aa
        folded = " ".join(str(surface or "").casefold().split()).strip('"„”')
        if folded in aa.GENERIC_PARTY_IDENTITY_LABELS:
            return None
        claims = aa._party_claims(surface)
    except Exception as exc:  # noqa: BLE001
        _warn_identity_outage(type(exc).__name__)
        return "unresolved party identity (registry unavailable)"
    if claims is None:
        _warn_identity_outage("gazetteer did not load")
        return "unresolved party identity (gazetteer unavailable)"
    if _declared_foreign(surface):
        return None
    if not claims:
        return "unresolved party identity: no gazetteer claim for this surface"
    if len(claims) > 1:
        return "unresolved party identity: the gazetteer claims this surface more than once"
    claim = claims[0]
    if claim.get("resolvable") and claim.get("id"):
        # The registry CAN resolve it, so a stored None is a stale stamp.
        return ("stored party_id is None although the gazetteer resolves this "
                "surface — re-stamp, not a judgment")
    # An explicit, written refusal: standing policy, already decided.
    return None


def _tone_is_grounded(tone: dict, analysis: dict, rec) -> bool | None:
    """Whether this tone reaches a reader, or None when it cannot be decided.

    ⚠️ ASKS THE PUBLICATION PATH, not a second copy of it.
    `analyze_articles.party_tone_published` is the one definition the public
    bundle uses; a private re-implementation here drifted from it, and the
    dangerous direction is a tone the bundle PUBLISHES that this queue then
    never asks anyone about — a claim on the page nobody was asked to check.

    ⚠️ THE THIRD STATE IS THE POINT. `party_tone_evidence_grounded` returns
    **False** rather than raising when its own dependency is missing, so
    „the gate says no" and „the gate is broken" are the same value there. A
    caller that skips on False would treat a total outage as a corpus of
    correctly-withheld tones and empty this queue at exit 0. Probing the
    dependency is what separates them.
    """
    if not isinstance(rec, dict):
        return None
    try:
        import analyze_articles as aa
        return bool(aa.party_tone_published(tone, analysis, rec))
    except Exception:  # noqa: BLE001
        # ⚠️ NO DEPENDENCY PROBE HERE. A probe would discard the answer for
        # every record whose gate version is current — where the verdict comes
        # from stored state and needs no gate at all — and during an outage
        # that turns this queue into a copy of the corpus, which the module
        # docstring calls „the same as having no queue at all".
        # `party_tone_published` raises only when it actually needed the gate.
        return None


def _tone_is_grounded(tone: dict, analysis: dict, rec) -> bool | None:
    """Whether this tone reaches a reader, or None when it cannot be decided.

    ⚠️ ASKS THE PUBLICATION PATH, not a second copy of it.
    `analyze_articles.party_tone_published` is the one definition the public
    bundle uses; a private re-implementation here drifted from it, and the
    dangerous direction is a tone the bundle PUBLISHES that this queue then
    never asks anyone about — a claim on the page nobody was asked to check.

    ⚠️ THE THIRD STATE IS THE POINT. `party_tone_evidence_grounded` returns
    **False** rather than raising when its own dependency is missing, so
    „the gate says no" and „the gate is broken" are the same value there. A
    caller that skips on False would treat a total outage as a corpus of
    correctly-withheld tones and empty this queue at exit 0. Probing the
    dependency is what separates them.
    """
    if not isinstance(rec, dict):
        return None
    try:
        import analyze_articles as aa
        return bool(aa.party_tone_published(tone, analysis, rec))
    except Exception:  # noqa: BLE001
        # ⚠️ NO DEPENDENCY PROBE HERE. A probe would discard the answer for
        # every record whose gate version is current — where the verdict comes
        # from stored state and needs no gate at all — and during an outage
        # that turns this queue into a copy of the corpus, which the module
        # docstring calls „the same as having no queue at all".
        # `party_tone_published` raises only when it actually needed the gate.
        return None


def _identity_is_actionable(surface: str, analysis: dict) -> bool:
    """Has anyone yet decided what this party surface means?"""
    return _identity_reason(surface, analysis) is not None


def record_review(analysis: dict) -> dict:
    """Every field of one record that needs another look.

    ⚠️ PER FIELD, never one verdict for the record. „Its topics are fine and
    its Russia stance is not" is the useful output; a single boolean sends
    the whole record back and loses the part that was right — which is the
    entire point of measuring per field in the first place.
    """
    out = {}
    provenance = analysis.get("analysis_provenance") or {}
    claim_sources = provenance.get("claim_sources") or {}
    skipped_assessments = set()
    if (provenance.get("analysis_route") == "free_triage"
            and analysis.get("site_relevant") is False):
        skipped_assessments = {
            field for field, source in claim_sources.items()
            if source == "not_performed_out_of_scope"
        }
    for field, key in ROUTED_FIELDS:
        if field in skipped_assessments:
            continue
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

    tone_reasons = []
    party_mentions = {
        str(m.get("id")) for m in (analysis.get("mentions") or [])
        if isinstance(m, dict) and m.get("kind") == "party" and m.get("id")
    }
    tone_ids = {
        str(t.get("party_id")) for t in (analysis.get("party_tones") or [])
        if isinstance(t, dict) and t.get("party_id")
    }
    missing_candidates = sorted(party_mentions - tone_ids)
    if missing_candidates:
        tone_reasons.append(
            "resolved party candidates absent from model entities/tones: "
            + ", ".join(missing_candidates))
    rec = analysis.get("_article")
    for tone in analysis.get("party_tones") or []:
        if not isinstance(tone, dict):
            tone_reasons.append("party tone is not an object")
            continue
        party = tone.get("party") or "(unknown party)"
        ident = tone.get("party_id")
        # ⚠️ NESTED, NOT CHAINED. Written as `if ident is None and (why := …)`
        # with an `elif`, an ADJUDICATED refusal fell through to the mention
        # check — and `str(None)` is „None", which is never in `party_mentions`
        # — so the record was routed anyway under a reason that is false.
        # Measured: 73 spurious „canonical identity disagrees" reasons over 61
        # records, 44 of them „Възраждане", the exact surface the guard exists
        # to silence.
        if ident is None:
            if why := _identity_reason(party, analysis):
                tone_reasons.append(f"{party}: {why}")
        elif party_mentions and str(ident) not in party_mentions:
            tone_reasons.append(
                f"{party}: canonical identity disagrees with party mentions")
        # ⚠️⚠️ A WITHHELD TONE IS NOT A CLAIM THIS SITE MAKES, so its quality
        # is not what a reviewer's time buys. `build_app_data` drops every
        # ungrounded tone from the public bundle, and measured 2026-09-21 that
        # is 1,190 of 1,194 pairs — so routing their confidence, their `mixed`
        # symmetry and their grounding put ~521 records into the queue for
        # output no reader can see. This module's whole thesis is
        # CONSEQUENCE × confidence; spending the scarcest input on the least
        # visible output is that thesis inverted.
        #
        # ⚠️ IT IS NOT A CARVE-OUT AND IT EXPIRES BY ITSELF. The predicate is
        # the grounding, not a constant: when T4.1 repairs the prompt/gate
        # contract (the prompt asks for „дословен цитат ИЛИ конкретна
        # проверима перифраза" while the gate demands a contiguous substring —
        # see the plan §1.5), grounded tones become the majority and re-enter
        # this queue with no edit here.
        #
        # ⚠️ AND THE IDENTITY REASONS ABOVE STAY UNCONDITIONAL, because they
        # are about the party CHIP, which renders on the article page whether
        # or not its tone survived the gate. „We could not resolve this party"
        # is reader-visible; „this withheld tone was 0.6 confident" is not.
        # ⚠️ AN UNGROUNDED TONE IS STILL ROUTED, and the first cut of this
        # change wrongly stopped routing it. The reasoning looked sound — the
        # publication gate withholds it, so no reader sees it, so why spend a
        # reviewer on it — and it is wrong twice. This IS the path by which a
        # human accepts a correct paraphrase the automated gate cannot match
        # (`party_tone_published` honours `human_review.status == "accepted"`),
        # so removing it removes the only way an ungrounded tone ever becomes
        # publishable. And `sync_eval_tasks` shares this function, so the items
        # would have vanished from the public eval feed too — a consumer the
        # „no reader sees it" argument never covered.
        why = field_review(tone.get("tone"), tone.get("confidence"))
        if why:
            tone_reasons.append(f"{party}: {why}")
        grounded = (_tone_is_grounded(tone, analysis, rec)
                    if isinstance(rec, dict) else None)
        if grounded is False:
            tone_reasons.append(f"{party}: evidence grounding needs review")
        elif grounded is None and isinstance(rec, dict):
            # ⚠️ THE GATE ITSELF IS DOWN, which is NOT „withheld".
            # `party_tone_evidence_grounded` fails CLOSED — it returns False,
            # not an exception, when `resolve_mentions` will not import — so
            # without this arm a broken gate is indistinguishable from a
            # corpus of correctly-withheld tones.
            tone_reasons.append(f"{party}: evidence grounding could not run")
        if tone.get("tone") == "mixed":
            tone_reasons.append(
                f"{party}: mixed requires both directions to be checked")
    if tone_reasons:
        out["party_tones"] = "; ".join(dict.fromkeys(tone_reasons))
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
                         "ai_generated / party_tones)")
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
            if field == "party_tones":
                items = []
                for tone in b if isinstance(b, list) else []:
                    if not isinstance(tone, dict):
                        continue
                    items.append({
                        "party": tone.get("party"),
                        "party_id": tone.get("party_id"),
                        "tone": tone.get("tone"),
                        "confidence": tone.get("confidence"),
                        # ⚠️ EITHER CONTRACT. A v3 tone carries `rationale`
                        # and no `evidence`, so reading only the legacy key
                        # gave the reviewer a row with an empty justification —
                        # the one field the row exists to show.
                        "evidence": str(tone.get("rationale")
                                        or tone.get("evidence") or "")[:200],
                        "evidence_spans": [
                            {k: x.get(k) for k in
                             ("quote", "field", "direction", "voice",
                              "speaker", "located")}
                            for x in tone.get("evidence_spans") or []
                            if isinstance(x, dict)],
                    })
                block[field] = {"items": items, "why": review[field]}
                continue
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
