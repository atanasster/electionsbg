#!/usr/bin/env python3
"""Plan T3.3 — named affairs (казуси): the registry, the article rule, the
story roll-up and the published payloads.

⚠️⚠️ A CASE IS NOT A TOPIC, AND NO MODEL DECIDES IT. `news/config/cases.json`
is a curated, dated, human-owned registry; membership is attached at ARTICLE
level by the deterministic rule each entry carries (required affair terms AND
a context term, minus exclusions), then rolled up to stories with the
supporting article ids. Every attachment carries its evidence — the terms
that matched — and every page that shows a case says inclusion is an
editorial selection, not a finding.

⚠️ `auto_attach` IS EARNED, NOT DECLARED. The build honours it only while
every fixture in `news/evals/case_fixtures.json` for that case classifies
correctly under the entry's `rule_version`; a fixture whose article is
absent from the corpus is UNVERIFIABLE and counts against — a rule nobody
could check publishes nothing. A failing case ships its registry entry with
`membership: "review"` and an empty timeline, never a guessed one.

⚠️ TERMS MATCH AT WORD START, NEVER AS BARE SUBSTRINGS. A stem may continue
(„прокуратур-ата") but must begin a word: measured 2026-09-22 on the live
corpus, the bare-substring rule attached a road bulletin to the Petrohan
case through „данс" inside „Санд**анс**ки" and a Plovdiv street-washing
timetable through „ул. Терзиев" — both shapes the registry's own `basis`
sentence promised were excluded. Python `re` treats word characters as Unicode, so
the lookbehind below is safe for Cyrillic (the JS ASCII word-boundary trap does not apply).

⚠️ THE HIT FLOOR COUNTS MENTIONS OF THE AFFAIR, NOT OF EACH TERM. The
Petrohan entry lists both halves of the affair's name as required terms,
so a per-term sum scored the single phrase „Петрохан – Околчица" as 2 and
cleared a floor of 2 with ONE passing reference — measured, 12 published
members whose whole evidence was one such phrase (three copies of a
minister's press scrum). Adjacent required terms within `MERGE_WINDOW`
characters are one mention. A rule may name `anchor_terms` — participants
whose mention identifies the affair as surely as its name („Калушев") —
and those count toward the floor too, so a development about a participant
that names the affair once is coverage while a road bulletin, which never
carries a participant, is not.

`required_mentions` is RESERVED for the mention layer (plan T4.0) and is
validated as a list but read by nothing yet; membership here is article-level
and names no person.

⚠️ DISCOVERY RUNS OVER EVERY ARTICLE, publication over the publishable
subset. The review artifact (`news/review/case_candidates.json`) lists the
matches the release does NOT show — excluded, unanalysed, withdrawn — so a
reviewer can see missed coverage without assuming all exclusions are wrong.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
DEFAULT_MIN_REQUIRED_HITS = 2
MERGE_WINDOW = 12  # chars between two required terms that still name ONE affair
FIXTURE_KEYS = {"article_path", "url", "content_sha256", "expected", "why"}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
REQUIRED_KEYS = {"slug", "name", "opened_on", "rule_version", "reviewer", "reviewed_on",
                 "description", "sources", "contested", "rule", "namesakes",
                 "auto_attach", "ambiguous_match", "overrides", "history"}
EDITORIAL_NOTE = {
    "bg": "Включването на материал в този казус е редакционен подбор по фиксирано правило (термини за случая плюс контекст), а не констатация за нечие поведение. Правилото и доказателствата за всяко включване са публикувани.",
    "en": "Inclusion in this case is an editorial selection by a fixed rule (affair terms plus context), not a finding about anyone's conduct. The rule and the evidence for every inclusion are published.",
}


def _bilingual(value) -> bool:
    """Reader-facing prose is `{bg, en}` — the page renders one language and
    an English-only string under a Bulgarian heading is a defect that no
    count sees."""
    return (isinstance(value, dict)
            and all(str(value.get(lang, "")).strip() for lang in ("bg", "en")))


def load_cases(path: Path) -> list:
    """The registry, validated — a malformed entry refuses the build rather
    than shipping a page whose description or rule is half there."""
    if not path.exists():
        return []
    doc = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(doc, dict) or doc.get("version") != 1 or not isinstance(doc.get("cases"), list):
        raise ValueError(f"{path}: expected {{version: 1, cases: []}}")
    seen = set()
    out = []
    for entry in doc["cases"]:
        missing = REQUIRED_KEYS - set(entry)
        if missing:
            raise ValueError(f"{path}: case {entry.get('slug')!r} lacks {sorted(missing)}")
        slug = entry["slug"]
        if not SLUG_RE.match(slug) or slug in seen:
            raise ValueError(f"{path}: bad or duplicate slug {slug!r}")
        seen.add(slug)
        for key in ("opened_on", "reviewed_on"):
            if not DATE_RE.match(str(entry[key])):
                raise ValueError(f"{path}: {slug}.{key} must be YYYY-MM-DD")
        for lang in ("bg", "en"):
            if not str(entry["name"].get(lang, "")).strip() or not str(entry["description"].get(lang, "")).strip():
                raise ValueError(f"{path}: {slug} needs a {lang} name and description")
        if not isinstance(entry["rule_version"], int) or entry["rule_version"] < 1:
            raise ValueError(f"{path}: {slug}.rule_version must be a positive integer")
        if not entry["sources"]:
            raise ValueError(f"{path}: {slug} has no sources — a description with no dated attribution is an allegation")
        for src in entry["sources"]:
            if not (isinstance(src, dict) and src.get("url", "").startswith("https://")
                    and _bilingual(src.get("claim")) and DATE_RE.match(str(src.get("published", "")))):
                raise ValueError(f"{path}: {slug} source needs a bg+en claim, https url and published date")
        for claim in entry["contested"]:
            for key in ("claim", "speaker", "note"):
                if not _bilingual(claim.get(key)):
                    raise ValueError(f"{path}: {slug} contested claim needs a bg+en {key}")
            if not DATE_RE.match(str(claim.get("date", ""))):
                raise ValueError(f"{path}: {slug} contested claim date must be YYYY-MM-DD")
            if "response" not in claim:
                raise ValueError(f"{path}: {slug} contested claim must state a response or null")
            if claim["response"] is not None and not _bilingual(claim["response"]):
                raise ValueError(f"{path}: {slug} contested claim response must be bg+en or null")
            if not str(claim.get("source_url") or "").startswith("https://"):
                raise ValueError(f"{path}: {slug} contested claim source_url must be https")
            response_url = claim.get("response_source_url")
            if response_url is not None and not str(response_url).startswith("https://"):
                raise ValueError(f"{path}: {slug} contested claim response_source_url must be https")
        for namesake in entry["namesakes"]:
            if not (isinstance(namesake, dict) and namesake.get("name") and _bilingual(namesake.get("note"))):
                raise ValueError(f"{path}: {slug} namesake needs a name and a bg+en note")
        rule = entry["rule"]
        if not _bilingual(rule.get("basis")):
            raise ValueError(f"{path}: {slug}.rule.basis must be bg+en — it is rendered to readers")
        if not rule.get("required_terms") or not rule.get("context_terms"):
            raise ValueError(f"{path}: {slug}.rule needs required_terms AND context_terms — a bare "
                             "name match is retrieval, not membership")
        floor = rule.get("min_required_hits", DEFAULT_MIN_REQUIRED_HITS)
        if not isinstance(floor, int) or isinstance(floor, bool) or floor < 1:
            raise ValueError(f"{path}: {slug}.rule.min_required_hits must be a positive integer")
        for key in ("excluded_terms", "anchor_terms", "required_mentions"):
            if not isinstance(rule.get(key, []), list):
                raise ValueError(f"{path}: {slug}.rule.{key} must be a list")
        if entry["ambiguous_match"] not in ("review", "clear"):
            raise ValueError(f"{path}: {slug}.ambiguous_match must be review or clear")
        if not isinstance(entry["auto_attach"], bool):
            raise ValueError(f"{path}: {slug}.auto_attach must be a boolean")
        out.append(entry)
    return out


def fold_text(text: str) -> str:
    """The fold every case term is matched against — casefold, whitespace
    collapsed. Public because the candidate-retrieval `case` channel
    (`analyze_articles.candidate_stories`) must match the registry's terms
    under the SAME contract, or an affair the registry sees is invisible to
    retrieval (measured: „помилв" reached 42 articles here and 0 there)."""
    return " ".join((text or "").casefold().split())


_fold = fold_text


def _term_re(term: str) -> re.Pattern:
    """A term must START a word; it may continue one (a stem)."""
    return re.compile(r"(?<![^\W\d_])" + re.escape(_fold(term)))


def has_term(term: str, folded_text: str) -> bool:
    """`term` at word start anywhere in `folded_text` (a `fold_text` output)."""
    return _term_re(term).search(folded_text) is not None


_has = has_term


def _affair_mentions(title: str, body: str, terms: list, window: int = MERGE_WINDOW) -> int:
    """Occurrences of the affair NAME: required terms adjacent within
    `window` chars („Петрохан – Околчица") are one mention; a title mention
    counts double."""
    pattern = re.compile("|".join(f"({_term_re(t).pattern})" for t in terms))

    def count(text: str) -> int:
        # Only DIFFERENT terms merge — „Петрохан – Околчица" is one mention,
        # „Петрохан … Петрохан" is two however close they sit.
        n, last_end, last_term = 0, -window - 1, None
        for m in pattern.finditer(text):
            term = m.lastindex
            if term == last_term or m.start() - last_end > window:
                n += 1
            last_end, last_term = m.end(), term
        return n

    return count(body) + 2 * count(title)


def match_article(case: dict, article: dict) -> dict | None:
    """The evidence for attaching `article` to `case`, or None.

    An explicit override wins in both directions and is recorded as such."""
    url = article.get("url") or ""
    overrides = case.get("overrides") or {}
    if url and url in (overrides.get("exclude") or []):
        return None
    if url and url in (overrides.get("include") or []):
        return {"basis": "override", "rule_version": case["rule_version"],
                "terms": [], "context": [], "hits": None}
    title = _fold(article.get("title") or "")
    body = _fold(article.get("content") or "")
    text = f"{title} {body}"
    rule = case["rule"]
    if any(_has(t, text) for t in rule.get("excluded_terms") or []):
        return None
    terms = [t for t in rule["required_terms"] if _has(t, text)]
    if not terms:
        return None
    # ⚠️ A PASSING REFERENCE IS NOT MEMBERSHIP. A campaign interview that
    # names „случая Петрохан" once in a list of the week's themes would
    # otherwise pull every such article into the case. The affair must be
    # named at least `min_required_hits` times (default 2), a title mention
    # counting double — a headline naming the affair is substantive.
    # Measured 2026-09-22: 37 of 189 Petrohan matches and 13 of 56 pardon
    # matches named the affair exactly once, and those were the digests and
    # the interviews. The count is of the AFFAIR (see the header), not a sum
    # over its terms.
    # An ANCHOR is a named participant whose mention identifies the affair
    # as surely as its name does („Калушев" beside one „Петрохан"), so it
    # counts toward the floor — a development about him that names the
    # affair once is coverage; a road bulletin never carries him.
    anchors = [t for t in rule.get("anchor_terms") or [] if _has(t, text)]
    hits = _affair_mentions(title, body, terms) + (
        _affair_mentions(title, body, anchors) if anchors else 0)
    if hits < int(rule.get("min_required_hits", DEFAULT_MIN_REQUIRED_HITS)):
        return None
    context = [t for t in rule["context_terms"] if _has(t, text)]
    if not context:
        return None
    return {"basis": "rule", "rule_version": case["rule_version"],
            "terms": terms, "anchors": anchors, "context": context, "hits": hits}


class CaseMatcher:
    def __init__(self, cases: list):
        self.cases = cases

    def match(self, article: dict) -> dict:
        hits = {}
        for case in self.cases:
            evidence = match_article(case, article)
            if evidence:
                hits[case["slug"]] = evidence
        return hits


# ---------------------------------------------------------------------------
# fixtures — what EARNS auto_attach
# ---------------------------------------------------------------------------

def load_fixtures(path: Path) -> dict:
    """slug → [{article_path, url, content_sha256, expected, why}], validated
    the way `load_cases` validates the registry — a malformed row is a named
    refusal, not a KeyError three functions later."""
    if not path.exists():
        return {}
    doc = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(doc, dict) or doc.get("version") != 1 or not isinstance(doc.get("cases"), dict):
        raise ValueError(f"{path}: expected {{version: 1, cases: {{slug: []}}}}")
    out = {}
    for slug, rows in doc["cases"].items():
        if not isinstance(rows, list):
            raise ValueError(f"{path}: {slug} fixtures must be a list")
        for index, row in enumerate(rows):
            missing = FIXTURE_KEYS - set(row if isinstance(row, dict) else {})
            if missing:
                raise ValueError(f"{path}: {slug} fixture #{index} lacks {sorted(missing)}")
            if not isinstance(row["expected"], bool):
                raise ValueError(f"{path}: {slug} fixture #{index}.expected must be a boolean")
        out[slug] = rows
    return out


def article_sha256(article: dict) -> str:
    return hashlib.sha256((article.get("content") or "").encode("utf-8")).hexdigest()


def verify_fixtures(case: dict, fixtures: list, read_article) -> dict:
    """Run the case rule over its fixtures. Fails CLOSED: no fixtures, a
    missing article, a re-fetched article whose text no longer matches the
    label's pinned hash, or a wrong classification each withhold auto-attach."""
    if not fixtures:
        return {"ok": False, "reason": "no_fixtures", "checked": 0, "failed": []}
    failed = []
    for fx in fixtures:
        article = read_article(fx["article_path"])
        if not article:
            failed.append({"url": fx.get("url"), "reason": "article_absent"})
            continue
        # ⚠️ THE LABEL WAS MADE FOR A BODY. The harvester rewrites article
        # files, so a fixture verified against different text than it was
        # labelled from is a label for an article that no longer exists — a
        # negative can quietly become a positive with the gate still green.
        if article_sha256(article) != fx.get("content_sha256"):
            failed.append({"url": fx.get("url"), "reason": "article_changed"})
            continue
        got = match_article(case, article) is not None
        if got != bool(fx["expected"]):
            failed.append({"url": fx.get("url"), "expected": fx["expected"], "got": got,
                           "why": fx.get("why")})
    positives = sum(1 for fx in fixtures if fx["expected"])
    negatives = len(fixtures) - positives
    if positives < 2 or negatives < 2:
        failed.append({"reason": f"needs >=2 positives and >=2 negatives, has {positives}/{negatives}"})
    return {"ok": not failed, "reason": None if not failed else "fixtures_failed",
            "checked": len(fixtures), "failed": failed}


# ---------------------------------------------------------------------------
# the roll-up and the payloads
# ---------------------------------------------------------------------------

def attach_case_ids(story: dict, matches_by_url: dict, attachable: set) -> list:
    """Story-level `case_ids`, derived from members; supporting ids travel
    in the payload, not on the story."""
    slugs = set()
    for member in story.get("members") or []:
        for slug in matches_by_url.get(member.get("url") or "", {}):
            if slug in attachable:
                slugs.add(slug)
    return sorted(slugs)


def framing_of(members: list) -> dict:
    by_leaning: dict = {}
    by_russia: dict = {}
    for m in members:
        if m.get("leaning"):
            by_leaning[m["leaning"]] = by_leaning.get(m["leaning"], 0) + 1
        if m.get("russia_stance"):
            by_russia[m["russia_stance"]] = by_russia.get(m["russia_stance"], 0) + 1
    return {"by_leaning": by_leaning, "by_russia_stance": by_russia,
            "rated": len([m for m in members if m.get("leaning")]),
            "articles": len(members)}


def build_case_payload(case: dict, stories: list, matches_by_url: dict,
                       verification: dict, generated_at: str) -> dict:
    slug = case["slug"]
    attached = verification["ok"] and case["auto_attach"]
    timeline = []
    outlets: dict = {}
    matched_members: list = []
    for story in stories:
        supporting = [m for m in story.get("members") or []
                      if slug in matches_by_url.get(m.get("url") or "", {})]
        if not supporting or not attached:
            continue
        for m in supporting:
            outlets[m["domain"]] = outlets.get(m["domain"], 0) + 1
            matched_members.append(m)
        timeline.append({
            "story_id": story["id"],
            "title_bg": story.get("title_bg"),
            "title_en": story.get("title_en"),
            "first_published": story.get("first_published"),
            "last_published": story.get("last_published"),
            "topics": story.get("topics") or [],
            "outlets": sorted({m["domain"] for m in supporting}),
            "supporting": [{"article_id": m.get("article_id"), "domain": m.get("domain"),
                            "url": m.get("url"), "published": m.get("published"),
                            "evidence": matches_by_url[m["url"]][slug]}
                           for m in supporting],
            "member_count": len(story.get("members") or []),
        })
    timeline.sort(key=lambda s: (s["first_published"] or "", s["story_id"]))
    return {
        "generated_at": generated_at,
        "slug": slug,
        "name": case["name"],
        "opened_on": case["opened_on"],
        "rule_version": case["rule_version"],
        "reviewer": case["reviewer"],
        "reviewed_on": case["reviewed_on"],
        "description": case["description"],
        "sources": case["sources"],
        "contested": case["contested"],
        "rule": case["rule"],
        "namesakes": case["namesakes"],
        "ambiguous_match": case["ambiguous_match"],
        "history": case["history"],
        "editorial_note": EDITORIAL_NOTE,
        # ⚠️ `membership` says what the timeline IS: "attached" when the
        # fixtures earned auto-attach, "review" when they did not — an empty
        # timeline under "review" is „not published", not „no coverage".
        "membership": "attached" if attached else "review",
        "verification": verification,
        "timeline": timeline,
        "story_count": len(timeline),
        "article_count": len(matched_members),
        "outlets": dict(sorted(outlets.items())),
        "framing": framing_of(matched_members),
        "first_published": min((s["first_published"] for s in timeline if s["first_published"]),
                               default=None),
        "last_published": max((s["last_published"] for s in timeline if s["last_published"]),
                              default=None),
    }
