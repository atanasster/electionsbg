#!/usr/bin/env python3
"""The election freeze for the person-sentiment aggregates
(news-person-sentiment-v1 §8.2).

Windows live in `news/data/publication_freezes.json` (committed). Inside one —
00:00 on the day before a vote to 20:00 on voting day, Europe/Sofia — the
person pages, `/persons`, the outlet × person grid and the article rail's
„в други материали" baseline are served from the LAST PRE-WINDOW BUILD,
byte-identical from build to build. The per-article tone keeps updating; it
describes one article and is not a statement about the race.

⚠️ COPY-FORWARD, NEVER „SKIP THE STAGE". The app-data tree is rebuilt whole, so
a skipped stage would serve an EMPTY archive on election day — the worst
possible reading. Builds in the 24 hours before a window refresh a snapshot in
`news/var/freeze/<id>/`; builds inside the window re-emit it with a
`frozen: {id, as_of, until}` stamp.

⚠️ NO SNAPSHOT MEANS WITHHELD, NEVER FRESH. If no pre-window build took one
(the machine was off the whole day before), the aggregates are replaced by an
empty index carrying `withheld: {id, until}` — the pages show the banner
alone. The first build after `until` recomputes everything and drops the stamp.

⚠️ THE DATE IS DATA. An `estimated` window within 45 days warns on every run
until the decree date replaces it; after a first round closes, the operator
records either a runoff entry (`runoff_of`) or `"runoff": "none"`, and until
then every run warns.

Run:  python3 news/scripts/publication_freeze.py [--now ISO] [--check-post]
      --check-post exits 1 inside a window or within 24 h of one — the
      `naiasno-post` skill's refusal for person-sentiment posts.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
# DATA_BG_ROOT, like build_app_data's REPO, so a test build in a temp root can
# neither read the committed windows nor write into the real snapshot tree.
REPO = Path(os.environ.get("DATA_BG_ROOT") or HERE.parent.parent)
FREEZES_PATH = REPO / "news" / "data" / "publication_freezes.json"
SNAPSHOT_ROOT = REPO / "news" / "var" / "freeze"
SOFIA = ZoneInfo("Europe/Sofia")

AGGREGATE_FILES = ("persons.json", "person_baselines.json",
                   "person_outlet_matrix.json")
AGGREGATE_DIR = "person"
SNAPSHOT_LEAD = timedelta(hours=24)
POST_LEAD = timedelta(hours=24)
ESTIMATE_WARN = timedelta(days=45)
RUNOFF_WARN = timedelta(days=14)
ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
STATUSES = ("estimated", "decreed")


class FreezeConfigError(ValueError):
    """A freeze file that cannot be trusted — never read as „no freeze"."""


def _instant(raw, where: str) -> datetime:
    try:
        when = datetime.fromisoformat(str(raw))
    except ValueError as exc:
        raise FreezeConfigError(f"{where}: {raw!r} is not an ISO instant") from exc
    if when.tzinfo is None:
        # A naive time would be read as UTC by one reader and as local by
        # another — the two- or three-hour late start §8.2 warns about.
        raise FreezeConfigError(f"{where}: {raw!r} carries no UTC offset")
    return when


def load_freezes(path: Path = FREEZES_PATH) -> list:
    """The validated windows. An absent file is no windows; a malformed one
    refuses the build."""
    if not path.exists():
        return []
    doc = json.loads(path.read_text(encoding="utf-8"))
    rows = doc.get("freezes") if isinstance(doc, dict) else None
    if not isinstance(rows, list):
        raise FreezeConfigError(f"{path}: expected {{freezes: [...]}}")
    out, seen = [], set()
    for row in rows:
        fid = str((row or {}).get("id") or "")
        if not ID_RE.match(fid) or fid in seen:
            raise FreezeConfigError(f"{path}: bad or duplicate freeze id {fid!r}")
        seen.add(fid)
        start = _instant(row.get("from"), f"{path}: {fid}.from")
        end = _instant(row.get("until"), f"{path}: {fid}.until")
        if end <= start:
            raise FreezeConfigError(f"{path}: {fid} ends before it starts")
        if row.get("status") not in STATUSES:
            raise FreezeConfigError(f"{path}: {fid}.status must be one of {STATUSES}")
        out.append({**row, "id": fid, "from_dt": start, "until_dt": end})
    return out


def active(freezes: list, now: datetime):
    return next((f for f in freezes if f["from_dt"] <= now < f["until_dt"]), None)


def upcoming(freezes: list, now: datetime, lead: timedelta):
    return next((f for f in freezes if now < f["from_dt"] <= now + lead), None)


def sofia_day_before(voting_day: str) -> tuple:
    """(from, until) for a vote on `voting_day` (YYYY-MM-DD): 00:00 on the day
    before to 20:00 on the day, Europe/Sofia — the helper a new entry is
    written with, so nobody hand-computes an offset across a DST change."""
    day = datetime.fromisoformat(voting_day).date()
    start = datetime(day.year, day.month, day.day, tzinfo=SOFIA) - timedelta(days=1)
    end = datetime(day.year, day.month, day.day, 20, tzinfo=SOFIA)
    return start.isoformat(), end.isoformat()


def warnings(freezes: list, now: datetime) -> list:
    out = []
    for f in freezes:
        if (f["status"] == "estimated" and now < f["until_dt"]
                and f["from_dt"] - now <= ESTIMATE_WARN):
            out.append(f"freeze {f['id']} starts {f['from_dt'].isoformat()} and "
                       "is still an ESTIMATE — replace it with the decree date "
                       "and set status: decreed")
        is_first_round = not f.get("runoff_of")
        closed_recently = f["until_dt"] <= now < f["until_dt"] + RUNOFF_WARN
        if is_first_round and closed_recently and f.get("runoff") != "none" and \
                not any(g.get("runoff_of") == f["id"] for g in freezes):
            out.append(f"freeze {f['id']} has closed with no runoff recorded — "
                       "add the runoff window (runoff_of: "
                       f"{f['id']}) or set \"runoff\": \"none\"")
    return out


def _aggregate_paths(out_dir: Path) -> list:
    paths = [out_dir / name for name in AGGREGATE_FILES
             if (out_dir / name).exists()]
    person_dir = out_dir / AGGREGATE_DIR
    if person_dir.is_dir():
        paths += sorted(person_dir.glob("*.json"))
    return paths


def _clear(out_dir: Path) -> None:
    for p in _aggregate_paths(out_dir):
        p.unlink()


def snapshot(out_dir: Path, freeze: dict, now: datetime,
             root: Path = SNAPSHOT_ROOT) -> Path:
    """Copy this build's aggregates to `root/<id>/`, replacing any earlier
    pre-window copy — so the one served is the LAST build before `from`."""
    dest = root / freeze["id"]
    tmp = root / f".{freeze['id']}.tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    for src in _aggregate_paths(out_dir):
        target = tmp / src.relative_to(out_dir)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, target)
    tmp.mkdir(parents=True, exist_ok=True)
    (tmp / "_snapshot.json").write_text(json.dumps(
        {"id": freeze["id"], "as_of": now.astimezone(timezone.utc).isoformat()}),
        encoding="utf-8")
    shutil.rmtree(dest, ignore_errors=True)
    tmp.rename(dest)
    return dest


def _write(path: Path, doc: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8")


def _snapshot_as_of(src: Path, freeze: dict):
    """The snapshot's instant — or None when there is none, or when it was not
    taken in the 24 h before THIS window. A window moved by the decree keeps
    its id, and a copy from weeks earlier is not a pre-window build."""
    meta_path = src / "_snapshot.json"
    if not meta_path.exists():
        return None
    as_of = datetime.fromisoformat(
        json.loads(meta_path.read_text(encoding="utf-8"))["as_of"])
    if not freeze["from_dt"] - SNAPSHOT_LEAD <= as_of < freeze["from_dt"]:
        return None
    return as_of


def restore(out_dir: Path, freeze: dict, root: Path = SNAPSHOT_ROOT) -> dict:
    """Replace this build's aggregates with the frozen snapshot, stamped; or,
    with no usable snapshot, with the withheld state. Returns {state, rows}."""
    # The slug redirects are identity, not coverage — they keep working
    # through a withheld window.
    live_retired = {}
    if (out_dir / "persons.json").exists():
        live_retired = json.loads((out_dir / "persons.json").read_text(
            encoding="utf-8")).get("retired_ids") or {}
    _clear(out_dir)
    until = freeze["until_dt"].isoformat()
    src = root / freeze["id"]
    as_of = _snapshot_as_of(src, freeze)
    if as_of is None:
        withheld = {"id": freeze["id"], "until": until}
        _write(out_dir / "persons.json", {
            "version": 1, "generated_at": freeze["from_dt"].isoformat(),
            "default_basis": "story", "persons": [], "retired_ids": live_retired,
            "matrix": False, "withheld": withheld})
        _write(out_dir / "person_baselines.json", {
            "version": 1, "generated_at": freeze["from_dt"].isoformat(),
            "persons": {}, "withheld": withheld})
        return {"state": "withheld", "rows": []}
    stamp = {"id": freeze["id"], "as_of": as_of.isoformat(), "until": until}
    rows = []
    for file in sorted(src.rglob("*.json")):
        if file.name == "_snapshot.json":
            continue
        doc = json.loads(file.read_text(encoding="utf-8"))
        if isinstance(doc, dict):
            doc = {**doc, "frozen": stamp}
        rel = file.relative_to(src)
        _write(out_dir / rel, doc)
        if rel.as_posix() == "persons.json":
            rows = doc.get("persons") or []
    return {"state": "frozen", "rows": rows}


def apply(out_dir: Path, now: datetime, freezes: list,
          root: Path = SNAPSHOT_ROOT) -> dict:
    """The one call the build makes after writing the aggregates."""
    window = active(freezes, now)
    if window is not None:
        return {**restore(out_dir, window, root), "id": window["id"]}
    soon = upcoming(freezes, now, SNAPSHOT_LEAD)
    if soon is not None:
        snapshot(out_dir, soon, now, root)
        return {"state": "snapshot", "id": soon["id"]}
    return {"state": "live"}


def post_blocked(freezes: list, now: datetime):
    """The window a person-sentiment post may not be published in — inside
    one, or within 24 h before it."""
    return active(freezes, now) or upcoming(freezes, now, POST_LEAD)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--now", help="ISO instant (default: the clock)")
    ap.add_argument("--check-post", action="store_true")
    args = ap.parse_args(argv)
    now = (_instant(args.now, "--now") if args.now
           else datetime.now(timezone.utc))
    freezes = load_freezes()
    for w in warnings(freezes, now):
        print(f"WARNING: {w}", file=sys.stderr)
    if args.check_post:
        blocked = post_blocked(freezes, now)
        if blocked:
            print(f"refused: person-sentiment posts are held from 24 h before "
                  f"{blocked['from_dt'].isoformat()} until "
                  f"{blocked['until_dt'].isoformat()} (freeze {blocked['id']})")
            return 1
        print("ok: no election freeze within 24 h")
        return 0
    window = active(freezes, now)
    print(json.dumps({"active": window["id"] if window else None,
                      "freezes": [f["id"] for f in freezes]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
