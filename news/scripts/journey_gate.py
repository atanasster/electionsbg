#!/usr/bin/env python3
"""Stage C exit criterion — the required end-to-end acceptance journey.

The plan states it in one sentence: „open the 24h briefing → find the
Петрохан case → choose a specific event → compare at least two
independently identified outlets → select Калушев → inspect each
assessment's voice and evidence → open the original → share the filtered
comparison", and then: „Validate the same journey with a non-political
person and an ambiguous namesake."

⚠️ THIS WALKS THE BUILT CORPUS, NOT A BROWSER. It answers „can a reader
complete this journey with the data the site actually serves" — every step
names what it required and what it found, so a step that cannot be taken is
reported as such rather than inferred from a green test. What it cannot
check is rendering; the vitest suites do that per screen.

⚠️ THE TWO VARIANTS ARE EXPECTED TO BE UNAVAILABLE TODAY, and saying so is
the point. The news identity registry holds ONE active identity and has
refused no surface as ambiguous (T4.0/T4.5), so „the same journey with a
non-political person" and „with an ambiguous namesake" have no subject to
walk. That is a REVIEWER backlog, not a code gap, and this gate reports it
as `unavailable` with the reason — never as a pass, and never as a failure
of the code.

⚠️ „INDEPENDENTLY IDENTIFIED" IS READ NARROWLY. This checks that an event
carries members from at least two distinct DOMAINS. Whether two domains
share an owner is not in this corpus, so the gate says „distinct domains"
and claims nothing about ownership independence.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP_DATA = HERE.parent / "app-data"

CASE_SLUG = "petrohan"
MIN_OUTLETS = 2


MALFORMED: list = []


def read(path: Path):
    """⚠️ A MISSING file and a MALFORMED one are different states, and only
    the first is an ordinary „this corpus has no such thing". A parse error
    is recorded so a blocked step cannot be blamed on absent data."""
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        MALFORMED.append({"path": str(path), "error": type(err).__name__})
        return None


def read_person(app_data: Path, person_id: str) -> dict | None:
    """A person shard is PAGINATED (T4.4, 50 rows a page) and the page-1
    payload carries the whole-identity accounting with only its own slice of
    `articles`. ⚠️ A universal claim („every directional assessment", „each
    row links out") must be evaluated over EVERY page — reading page 1 alone
    judged 50 of 53 rows while printing `assessed: 26` beside a count of 24
    in the same report."""
    first = read(app_data / "person" / f"{person_id}.json")
    if not first:
        return None
    rows = list(first.get("articles") or [])
    for page in range(2, int(first.get("total_pages") or 1) + 1):
        more = read(app_data / "person" / f"{person_id}-{page}.json")
        rows.extend((more or {}).get("articles") or [])
    return {**first, "articles": rows, "pages_read": int(first.get("total_pages") or 1)}


def step(name: str, required: str, *, ok: bool, found, note: str | None = None,
         unavailable: str | None = None) -> dict:
    return {"step": name, "required": required,
            "status": "unavailable" if unavailable else ("ok" if ok else "blocked"),
            "found": found, "note": note or unavailable}


def walk(app_data: Path) -> dict:
    steps = []

    home = read(app_data / "home.json") or {}
    stories_home = home.get("stories") or []
    steps.append(step(
        "briefing",
        f"the briefing ({home.get('window_days') or '?'}-day window) lists at "
        "least one event",
        ok=bool(stories_home),
        found={"stories": len(stories_home),
               "window_days": home.get("window_days")}))

    cases = (read(app_data / "cases.json") or {}).get("cases") or []
    case_row = next((c for c in cases if c.get("slug") == CASE_SLUG), None)
    detail = read(app_data / "cases" / f"{CASE_SLUG}.json") if case_row else None
    steps.append(step(
        "find_case",
        f"the {CASE_SLUG} case is listed and has a detail shard (a reader "
        "reaches it from the cases hub; whether today's briefing happens to "
        "carry one of its events is REPORTED, not required)",
        ok=bool(case_row and detail),
        found={"listed": bool(case_row),
               "reached_from_briefing": bool(
                   {s.get("id") for s in stories_home}
                   & {t.get("story_id")
                      for t in ((detail or {}).get("timeline") or [])}),
               "detail": bool(detail),
               "articles": (case_row or {}).get("article_count"),
               "stories": (case_row or {}).get("story_count")}))

    index = read(app_data / "news_persons.json") or {}
    people = index.get("persons") or []
    subject = next((p for p in people
                    if (p.get("coverage") or {}).get("eligible")), None)
    shard = read_person(app_data, subject["news_person_id"]) if subject else None
    person_rows = (shard or {}).get("articles") or []

    timeline = (detail or {}).get("timeline") or []
    # ⚠️ PICK THE EVENT THAT SATISFIES THE WHOLE CHAIN, not the first with
    # enough members. The journey's own sentence is „choose a specific event
    # → compare → select Калушев": the reader picks ONE event and then has to
    # take every later step FROM it, so an event the person is not on is a
    # path the gate would bless and a reader could not walk.
    candidates = []
    for entry in timeline:
        if int(entry.get("member_count") or 0) < MIN_OUTLETS:
            continue
        payload = read(app_data / "stories" / f"{entry.get('story_id')}.json")
        # The story shard nests the story under `story`; the top level
        # carries `related` and `synthesis` beside it.
        entry_story = (payload or {}).get("story") or {}
        entry_members = entry_story.get("members") or []
        entry_domains = sorted({m.get("domain") for m in entry_members
                                if m.get("domain")})
        on_event = [r for r in person_rows
                    if r.get("story_id") == entry.get("story_id")]
        candidates.append((entry, entry_members, entry_domains, on_event))
    walkable = [c for c in candidates
                if len(c[2]) >= MIN_OUTLETS and c[3]]
    chosen = walkable[0] if walkable else (candidates[0] if candidates
                                           else (None, [], [], []))
    event, members, domains, on_event = chosen
    steps.append(step(
        "choose_event",
        f"the case timeline carries an event with ≥{MIN_OUTLETS} members that "
        "the rest of the journey can be taken FROM",
        ok=bool(event) and bool(walkable),
        found={"events": len(timeline), "qualifying": len(candidates),
               "walkable_end_to_end": len(walkable),
               "chosen": (event or {}).get("story_id")}))
    steps.append(step(
        "compare_outlets",
        f"the event carries members from ≥{MIN_OUTLETS} distinct domains",
        ok=len(domains) >= MIN_OUTLETS,
        found={"members": len(members), "domains": domains[:6],
               "distinct_domains": len(domains)},
        note="distinct DOMAINS; this corpus says nothing about ownership"))

    # ⚠️ REACHABILITY FROM THE EVENT JUST COMPARED, not existence and not
    # „somewhere in this case". A page nobody can arrive at from the surface
    # they were reading is not a step a reader can take — the
    # `/council/resolution/**` failure one repo over. The case-level count
    # rides along as secondary evidence, never as the verdict.
    case_story_ids = {t.get("story_id") for t in timeline}
    from_case = [r for r in person_rows if r.get("story_id") in case_story_ids]
    steps.append(step(
        "select_person",
        "the person is on the EVENT just compared, with a servable page",
        ok=bool(shard) and bool(on_event),
        found={"active_identities": len(people),
               "person": (subject or {}).get("news_person_id"),
               "eligible": (shard or {}).get("eligible"),
               "assessed": (shard or {}).get("assessed"),
               "rows_on_this_event": len(on_event),
               "rows_inside_this_case": len(from_case),
               "pages_read": (shard or {}).get("pages_read")}))

    assessed = [r for r in person_rows
                if r.get("assessment_status") == "assessed"]
    # ⚠️ A DIRECTIONAL claim needs a located quote; `neutral` does not, and
    # must not — „an absence is not provable by a quote" (T4.1b/T4.3). A
    # gate demanding evidence for every row would push the pipeline toward
    # inventing a quote for a judgement that rests on there being none.
    directional = [r for r in assessed
                   if r.get("tone") in ("favorable", "unfavorable", "mixed")]
    # ⚠️ THE PRODUCER'S OWN RULE: a directional claim needs a LOCATED quote
    # (T4.1b/T4.3). An unlocated span is rendered struck through, so reading
    # it as evidence accepts exactly what the producer refuses.
    with_evidence = [r for r in directional
                     if any(s.get("quote") and s.get("voice")
                            and s.get("located") is not False
                            for s in (r.get("evidence_spans") or []))]
    neutral = [r for r in assessed if r.get("tone") == "neutral"]
    steps.append(step(
        "inspect_evidence",
        "every DIRECTIONAL assessment carries a LOCATED quote with its voice",
        ok=bool(directional) and len(with_evidence) == len(directional),
        found={"assessed_rows": len(assessed), "directional": len(directional),
               "with_voiced_quote": len(with_evidence), "neutral": len(neutral)},
        note="neutral rows carry no quote BY DESIGN — an absence is not "
             "provable by one"))

    with_original = [r for r in person_rows if r.get("url")]
    steps.append(step(
        "open_original", "each row links out to the publisher",
        ok=bool(with_original)
        and len(with_original) == len((shard or {}).get("articles") or []),
        found={"rows": len(person_rows), "with_url": len(with_original)}))

    # The share step is a URL the story page can mint; what this gate can
    # check is that the comparison it would share has something in it.
    steps.append(step(
        "share_comparison",
        "the compared event has ≥2 members to put in a shareable selection",
        ok=len(members) >= MIN_OUTLETS,
        found={"selectable_members": len(members)},
        note="the URL itself is covered by storyCompare's unit tests"))

    variants = []
    # ⚠️ A VARIANT NEEDS A SUBJECT WITH A WALKABLE PAGE, not merely a second
    # row in the registry: an identity with no coverage has no shard, so the
    # journey cannot be walked for it at all.
    walkable_people = [p for p in people
                       if (p.get("coverage") or {}).get("eligible")]
    second = next((p for p in walkable_people
                   if p.get("news_person_id")
                   != (subject or {}).get("news_person_id")), None)
    second_found, second_ok = {}, False
    if second:
        # ⚠️ The variant WALKS its subject rather than asserting it could be
        # walked — otherwise `ok` is unreachable by construction and the
        # field that exists to prevent overstatement never tracks anything.
        second_shard = read_person(app_data, second["news_person_id"])
        second_rows = (second_shard or {}).get("articles") or []
        second_on_case = [r for r in second_rows
                          if r.get("story_id") in case_story_ids]
        second_directional = [
            r for r in second_rows
            if r.get("assessment_status") == "assessed"
            and r.get("tone") in ("favorable", "unfavorable", "mixed")]
        second_evidenced = [
            r for r in second_directional
            if any(sp.get("quote") and sp.get("voice")
                   and sp.get("located") is not False
                   for sp in (r.get("evidence_spans") or []))]
        second_found = {"person": second["news_person_id"],
                        "rows": len(second_rows),
                        "rows_inside_this_case": len(second_on_case),
                        "directional": len(second_directional),
                        "with_located_quote": len(second_evidenced)}
        second_ok = bool(second_rows) and bool(second_on_case) and (
            len(second_evidenced) == len(second_directional))
    variants.append(step(
        "variant_non_political",
        "the same journey for a second person who is not a public official",
        ok=second_ok,
        found={"active_identities": len(people),
               "with_coverage": len(walkable_people), **second_found},
        note=None if second_ok else
        ("a second identity has coverage but its journey does not complete — "
         "see `found`" if second else None),
        unavailable=("the registry holds no second active identity with "
                     "coverage — a reviewer backlog (1,802 queued surfaces), "
                     "not a code gap")
        if len(walkable_people) < 2 else None))

    # ⚠️ DERIVED, never a literal. The review queue publishes the count of
    # surfaces the resolver refused as ambiguous; a hardcoded 0 would keep
    # printing „no surface has been refused" long after one was, with
    # `stage_c_complete` false for a reason that had stopped being true.
    queue = read(app_data.parent / "review"
                 / "news_person_candidates.json") or {}
    ambiguous = int((queue.get("counts") or {}).get("ambiguous") or 0)
    variants.append(step(
        "variant_ambiguous_namesake",
        "the same journey for a surface the registry refuses as ambiguous",
        ok=False,
        found={"ambiguous_refusals": ambiguous,
               "queued_surfaces": (queue.get("counts") or {}).get("surfaces")},
        note=("a surface IS refused as ambiguous — the journey for it is not "
              "walked by this gate yet") if ambiguous else None,
        unavailable=("no surface has been refused as ambiguous: one active "
                     "identity cannot collide with another")
        if not ambiguous else None))

    # ⚠️ A variant that is not `ok` MUST say why. A bare `BLOCK` with no
    # reason is the shape this gate exists to refuse — and it is exactly what
    # the hardcoded `ok=False` produced the moment a second identity landed.
    assert all(v["note"] for v in variants if v["status"] != "ok"), \
        "a variant that is not ok must say why"

    blocked = [s for s in steps if s["status"] == "blocked"]
    return {
        "version": 1,
        "case": CASE_SLUG,
        # A malformed artifact is not „no such data" — a blocked step must
        # not be blamed on absent data when the file was there and unreadable.
        "malformed_files": list(MALFORMED),
        "steps": steps,
        "variants": variants,
        "passed": not blocked,
        "blocked": [s["step"] for s in blocked],
        "variants_unavailable": [v["step"] for v in variants
                                 if v["status"] == "unavailable"],
        # ⚠️ The journey is only COMPLETE when the variants can be walked too.
        # Saying „passed" while two of the plan's three subjects have nobody
        # to walk them is the overstatement this field exists to prevent.
        "stage_c_complete": (not blocked
                             and not [v for v in variants
                                      if v["status"] != "ok"]),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--app-data", type=Path, default=APP_DATA)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--enforce", action="store_true",
                    help="exit non-zero when a step is BLOCKED (an unavailable "
                         "variant is reported, never a failure)")
    args = ap.parse_args(argv)
    report = walk(args.app_data)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print("Stage C acceptance journey:"
              f" {'walkable' if report['passed'] else 'BLOCKED'}"
              f" · complete: {report['stage_c_complete']}")
        for row in report["steps"] + report["variants"]:
            mark = {"ok": "ok  ", "blocked": "BLOCK", "unavailable": "n/a "}[row["status"]]
            print(f"  {mark} {row['step']}: {row['found']}")
            if row["note"]:
                print(f"        {row['note']}")
    return 1 if (args.enforce and not report["passed"]) else 0


if __name__ == "__main__":
    raise SystemExit(main())
