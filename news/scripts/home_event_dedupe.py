"""Conservative same-event suppression for the finite home briefing.

This does not rewrite canonical story membership. It suppresses only pairs
with strong deterministic evidence and emits every decision as a merge
proposal for later editorial review.
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


def same_event_evidence(left: dict, right: dict) -> dict | None:
    """Return auditable evidence only for a high-confidence same-event pair."""
    left_at = _instant(left.get("last_published"))
    right_at = _instant(right.get("last_published"))
    if left_at is None or right_at is None:
        return None
    gap_hours = abs((left_at - right_at).total_seconds()) / 3600
    if gap_hours > MAX_EVENT_GAP_HOURS:
        return None

    left_topic, right_topic = _primary_topic(left), _primary_topic(right)
    if left_topic and right_topic and left_topic != right_topic:
        return None

    left_places, right_places = _places(left), _places(right)
    if left_places and right_places and left_places.isdisjoint(right_places):
        return None
    left_numbers, right_numbers = _numbers(left), _numbers(right)
    if left_numbers and right_numbers and left_numbers.isdisjoint(right_numbers):
        return None

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
    if not (entity_backed or multi_entity_backed or near_duplicate_title):
        return None
    return {
        "shared_title_tokens": shared_tokens,
        "shared_entities": shared_entities,
        "shared_places": sorted(left_places & right_places),
        "title_jaccard": round(overlap, 3),
        "published_gap_hours": round(gap_hours, 2),
        "topic": list(left_topic or right_topic) if left_topic or right_topic else None,
    }


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
        current[proposal_id] = {
            "id": proposal_id,
            "status": prior.get("status", "pending"),
            "active": True,
            "first_seen": prior.get("first_seen", generated_at),
            "last_seen": generated_at,
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
    return {
        "version": 1,
        "generated_at": generated_at,
        "counts": {
            "total": len(items),
            "active": sum(item["active"] for item in items),
            "pending": sum(item["status"] == "pending" for item in items),
        },
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
