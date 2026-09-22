"""Conservative same-event suppression for the finite home briefing.

This does not rewrite canonical story membership. It suppresses only pairs
with strong deterministic evidence and emits every decision as a merge
proposal for later editorial review.

⚠️ TWO MODES, ONE FUNCTION, AND ONLY ONE OF THEM MAY JOIN ANYTHING.
`same_event_evidence(left, right)` is the STRICT rule — the three vetoes
(exact topic tuple, disjoint places, disjoint title digits), the 48 h
horizon and the three positive classes, byte-for-byte what `auto_merge_host`
and the home briefing have always run. `mode="review"` (plan T2.1) is the
RELAXED reading that the plan's own safety posture confines to the review
channel: it never joins, it only proposes, and every relaxation it used is
NAMED in the evidence so a reviewer sees which strict veto the pair would
have failed. Its thresholds are versioned (`REVIEW_RULE_VERSION`), because
T2.3 promotes „the exact evaluated rule/version" or nothing.

What review mode relaxes, and what it keeps:

- TOPIC: the strict rule vetoes on the (category, subcategory) TUPLE, so
  `judiciary/vss` and `judiciary/high-profile-cases` can never join. Review
  mode records `topic_agreement` ∈ {exact, category, none}; a category-level
  match is a positive signal, a cross-category pair is allowed through but
  flagged — the plan forbids promoting cross-category joins before the
  held-out precision gate, and this is where they are measured.
- PLACES: a singleton {София} against {Петрохан} can be the court venue and
  the incident scene of ONE development. Review mode vetoes only the hard
  negative — two `local-news` stories in DIFFERENT places (distinct councils
  meeting separately) — and otherwise records `place_conflict`.
- NUMBERS: bare digits are not quantities. Review mode vetoes only two
  DIFFERENT four-digit YEARS in the titles (different elections, different
  budgets); other disagreeing digits are recorded as `number_disagreement`,
  because an evolving casualty count is what the comparison should show.
- LEDE: a fourth positive class, `lede_backed` — shared entity plus lede
  token overlap — read from `lede_bg` when a caller supplies it. Stories
  without a lede fall back to the three title classes unchanged.

⚠️ The 48 h horizon is NOT relaxed in either mode.
"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile


TOKEN_RE = re.compile(r"[0-9A-Za-zА-Яа-яЁё]+", re.UNICODE)
STOPWORDS = frozenset(
    """на за от с без до из по и или че със в към при след преди над под още
    този тази това които как ще са е да не новина новини каза заяви обяви
    the a an of in on for to and with from at by is are says said""".split()
)
STRONG_ENTITY_BUCKETS = ("people", "parties", "institutions", "companies")
GENERIC_ENTITIES = frozenset({
    "българия", "сащ", "русия", "украйна", "ес", "европейски съюз",
    "народно събрание", "бта", "рейтерс",
})
MAX_EVENT_GAP_HOURS = 48
REVIEW_STATUSES = frozenset({"pending", "accepted", "rejected"})
REVIEW_RULE_VERSION = "review-v1"
YEAR_RE = re.compile(r"^(19|20)\d\d$")
LOCAL_NEWS = "local-news"
LEDE_MIN_OVERLAP = 0.35
# ONE definition of „the lede": the first LEDE_CHARS of the text, in the
# retrieval channel (`analyze_articles.candidate_stories`) and in the review
# class below alike — a reviewer reading `lede` in `channels` and `lede` in
# `relaxations` is reading the same text.
LEDE_CHARS = 400
# Every relaxation the review mode can name. The counterfactual report
# buckets on this list; a kind added here and not there zeroes a bucket,
# which `test_home_event_dedupe.ReviewMode` pins.
RELAXATION_KINDS = ("topic:category", "topic:none", "places:disjoint", "numbers:disjoint", "lede")


def _tokens(story: dict) -> set[str]:
    title = story.get("title_bg") or story.get("title_en") or ""
    return {
        token.casefold() for token in TOKEN_RE.findall(title)
        if len(token) >= 3 and token.casefold() not in STOPWORDS
    }


def _instant(value: str | None) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value or "")
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(timezone.utc)


def _primary_topic(story: dict) -> tuple[str, str | None] | None:
    topics = story.get("topics") or []
    topic = next((item for item in topics if item.get("primary")), None)
    topic = topic or (topics[0] if topics else None)
    if not topic or not topic.get("category"):
        return None
    return topic["category"], topic.get("subcategory")


def _strong_entities(story: dict) -> set[str]:
    entities = story.get("entities") or {}
    return {
        name.casefold()
        for bucket in STRONG_ENTITY_BUCKETS
        for raw in (entities.get(bucket) or [])
        if (name := " ".join(str(raw).split()))
        and name.casefold() not in GENERIC_ENTITIES
    }


def _places(story: dict) -> set[str]:
    return {
        name.casefold()
        for raw in ((story.get("entities") or {}).get("places") or [])
        if (name := " ".join(str(raw).split()))
    }


def _numbers(story: dict) -> set[str]:
    title = story.get("title_bg") or story.get("title_en") or ""
    return {token for token in TOKEN_RE.findall(title) if token.isascii() and token.isdigit()}


def _lede_tokens(story: dict) -> set[str]:
    text = (story.get("lede_bg") or "")[:LEDE_CHARS]
    return {
        token.casefold() for token in TOKEN_RE.findall(text)
        if len(token) >= 3 and token.casefold() not in STOPWORDS
    }


def same_event_evidence(left: dict, right: dict, *, mode: str = "strict") -> dict | None:
    """Return auditable evidence only for a high-confidence same-event pair.

    `mode="strict"` is the join rule. `mode="review"` is the relaxed reading
    for proposals only — see the module header for what it relaxes."""
    if mode not in ("strict", "review"):
        raise ValueError(f"unknown same_event_evidence mode {mode!r}")
    review = mode == "review"
    left_at = _instant(left.get("last_published"))
    right_at = _instant(right.get("last_published"))
    if left_at is None or right_at is None:
        return None
    gap_hours = abs((left_at - right_at).total_seconds()) / 3600
    if gap_hours > MAX_EVENT_GAP_HOURS:
        return None

    relaxations: list[str] = []
    left_topic, right_topic = _primary_topic(left), _primary_topic(right)
    topic_agreement = None
    if left_topic and right_topic:
        if left_topic == right_topic:
            topic_agreement = "exact"
        elif left_topic[0] == right_topic[0]:
            topic_agreement = "category"
        else:
            topic_agreement = "none"
        if topic_agreement != "exact":
            if not review:
                return None
            relaxations.append(f"topic:{topic_agreement}")

    left_places, right_places = _places(left), _places(right)
    place_conflict = bool(left_places and right_places and left_places.isdisjoint(right_places))
    if place_conflict:
        if not review:
            return None
        # The hard negative survives review: two local stories in two places
        # are two councils, not one development seen from two venues.
        if (left_topic and right_topic
                and left_topic[0] == LOCAL_NEWS and right_topic[0] == LOCAL_NEWS):
            return None
        relaxations.append("places:disjoint")
    left_numbers, right_numbers = _numbers(left), _numbers(right)
    number_disagreement = bool(left_numbers and right_numbers and left_numbers.isdisjoint(right_numbers))
    if number_disagreement:
        if not review:
            return None
        left_years = {n for n in left_numbers if YEAR_RE.match(n)}
        right_years = {n for n in right_numbers if YEAR_RE.match(n)}
        # Two different years name two different elections or budgets.
        if left_years and right_years and left_years.isdisjoint(right_years):
            return None
        relaxations.append("numbers:disjoint")

    left_tokens, right_tokens = _tokens(left), _tokens(right)
    shared_tokens = sorted(left_tokens & right_tokens)
    union = left_tokens | right_tokens
    overlap = len(shared_tokens) / len(union) if union else 0
    shared_entities = sorted(_strong_entities(left) & _strong_entities(right))

    entity_backed = bool(shared_entities) and len(shared_tokens) >= 3 and overlap >= 0.72
    multi_entity_backed = (
        len(shared_entities) >= 2 and len(shared_tokens) >= 3 and overlap >= 0.35
    )
    near_duplicate_title = len(shared_tokens) >= 5 and overlap >= 0.82
    lede_overlap = None
    lede_backed = False
    if review:
        left_lede, right_lede = _lede_tokens(left), _lede_tokens(right)
        if left_lede and right_lede:
            lede_union = left_lede | right_lede
            lede_overlap = round(len(left_lede & right_lede) / len(lede_union), 3)
            lede_backed = bool(shared_entities) and len(shared_tokens) >= 2 and lede_overlap >= LEDE_MIN_OVERLAP
    if not (entity_backed or multi_entity_backed or near_duplicate_title or lede_backed):
        return None
    if lede_backed and not (entity_backed or multi_entity_backed or near_duplicate_title):
        relaxations.append("lede")
    evidence = {
        "shared_title_tokens": shared_tokens,
        "shared_entities": shared_entities,
        "shared_places": sorted(left_places & right_places),
        "title_jaccard": round(overlap, 3),
        "published_gap_hours": round(gap_hours, 2),
        "topic": list(left_topic or right_topic) if left_topic or right_topic else None,
    }
    if review:
        evidence.update({
            "mode": "review",
            "rule_version": REVIEW_RULE_VERSION,
            "relaxations": relaxations,
            "topic_agreement": topic_agreement,
            "place_conflict": place_conflict,
            "number_disagreement": number_disagreement,
            "lede_jaccard": lede_overlap,
        })
    return evidence


def rejected_story_pairs(queue: dict | None) -> set[frozenset[str]]:
    """Return human-rejected pairs, which always override automatic suppression."""
    if queue is None:
        return set()
    if not isinstance(queue, dict) or not isinstance(queue.get("items"), list):
        raise ValueError("story merge review queue must contain an items array")
    rejected = set()
    for item in queue["items"]:
        if not isinstance(item, dict) or item.get("status") not in REVIEW_STATUSES:
            raise ValueError("story merge review queue contains an invalid item")
        if item["status"] != "rejected":
            continue
        left = (item.get("keeper") or {}).get("id")
        right = (item.get("candidate") or {}).get("id")
        if not isinstance(left, str) or not isinstance(right, str):
            raise ValueError("rejected story merge item is missing story ids")
        rejected.add(frozenset((left, right)))
    return rejected


def dedupe_home_events(
    stories: list[dict], rejected_pairs: set[frozenset[str]] | None = None
) -> tuple[list[dict], list[dict]]:
    """Keep the first-ranked story per connected set of high-confidence pairs."""
    parents = list(range(len(stories)))
    edges: dict[tuple[int, int], dict] = {}
    rejected_pairs = rejected_pairs or set()

    def find(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    def union(left: int, right: int) -> None:
        left_root, right_root = find(left), find(right)
        if left_root == right_root:
            return
        # Input is already product-ranked, so the earliest member remains the
        # visible representative even when a later story bridges two pairs.
        root, child = sorted((left_root, right_root))
        parents[child] = root

    for left in range(len(stories)):
        for right in range(left + 1, len(stories)):
            pair = frozenset((stories[left]["id"], stories[right]["id"]))
            if pair in rejected_pairs:
                continue
            evidence = same_event_evidence(stories[left], stories[right])
            if evidence is None:
                continue
            edges[(left, right)] = evidence
            union(left, right)

    components: dict[int, list[int]] = {}
    for index in range(len(stories)):
        components.setdefault(find(index), []).append(index)

    kept = [stories[root] for root in sorted(components)]
    proposals: list[dict] = []
    for root in sorted(components):
        members = components[root]
        for candidate in members[1:]:
            direct = [
                (other, edges[tuple(sorted((other, candidate)))])
                for other in members
                if other != candidate and tuple(sorted((other, candidate))) in edges
            ]
            matched, evidence = max(
                direct,
                key=lambda item: (
                    item[1]["title_jaccard"],
                    len(item[1]["shared_entities"]),
                    len(item[1]["shared_title_tokens"]),
                    -item[0],
                ),
            )
            proposals.append({
                "keeper_story_id": stories[root]["id"],
                "matched_story_id": stories[matched]["id"],
                "candidate_story_id": stories[candidate]["id"],
                "confidence": "high",
                **evidence,
            })
    return kept, proposals


def _proposal_id(left_id: str, right_id: str) -> str:
    pair = "\0".join(sorted((left_id, right_id)))
    return "story-merge-" + hashlib.sha256(pair.encode("utf-8")).hexdigest()[:16]


def _story_context(story: dict | None) -> dict | None:
    if story is None:
        return None
    return {
        "id": story.get("id"),
        "title_bg": story.get("title_bg"),
        "title_en": story.get("title_en"),
        "last_published": story.get("last_published"),
        "topics": story.get("topics") or [],
        "entities": story.get("entities") or {},
    }


def build_story_merge_queue(
    previous: dict | None,
    proposals: list[dict],
    stories_by_id: dict[str, dict],
    generated_at: str,
) -> dict:
    """Merge current proposals into a durable, human-editable review queue."""
    previous = previous or {"items": []}
    if not isinstance(previous, dict) or not isinstance(previous.get("items"), list):
        raise ValueError("story merge review queue must contain an items array")
    prior_by_id = {}
    for item in previous["items"]:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            raise ValueError("story merge review queue contains an invalid item")
        if item.get("status") not in REVIEW_STATUSES:
            raise ValueError(f"story merge review queue has invalid status: {item.get('status')!r}")
        prior_by_id[item["id"]] = item

    current = {}
    for proposal in proposals:
        proposal_id = _proposal_id(
            proposal["keeper_story_id"], proposal["candidate_story_id"]
        )
        prior = prior_by_id.get(proposal_id, {})
        unchanged_active = prior.get("active") is True
        current[proposal_id] = {
            "id": proposal_id,
            "status": prior.get("status", "pending"),
            "active": True,
            "first_seen": prior.get("first_seen", generated_at),
            "last_seen": prior.get("last_seen", generated_at)
            if unchanged_active else generated_at,
            "keeper": _story_context(stories_by_id.get(proposal["keeper_story_id"])),
            "matched": _story_context(stories_by_id.get(proposal["matched_story_id"])),
            "candidate": _story_context(stories_by_id.get(proposal["candidate_story_id"])),
            "evidence": {
                key: value for key, value in proposal.items()
                if key not in {
                    "keeper_story_id", "matched_story_id", "candidate_story_id"
                }
            },
        }
    for proposal_id, prior in prior_by_id.items():
        if proposal_id not in current:
            current[proposal_id] = {**prior, "active": False}
    items = sorted(
        current.values(),
        key=lambda item: (not item["active"], item["status"] != "pending", item["id"]),
    )
    counts = {
        "total": len(items),
        "active": sum(item["active"] for item in items),
        "pending": sum(item["status"] == "pending" for item in items),
    }
    if (
        previous.get("version") == 1
        and previous.get("items") == items
        and previous.get("counts") == counts
    ):
        return previous
    return {
        "version": 1,
        "generated_at": generated_at,
        "counts": counts,
        "items": items,
    }


def write_story_merge_queue(path: Path, queue: dict) -> None:
    """Atomically replace the durable queue without risking a partial JSON file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=path.parent, delete=False
    ) as handle:
        json.dump(queue, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        temp_path = Path(handle.name)
    try:
        os.replace(temp_path, path)
    finally:
        temp_path.unlink(missing_ok=True)
