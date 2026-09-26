#!/usr/bin/env python3
"""The outlet × person grid — „Медиите и хората" (news-person-sentiment-v1 §7.1).

It is the densest „by media" view and the closest to a league table, so its
rules are stricter than the rest of the feature's:

- ⚠️ ROWS BY COVERAGE, COLUMNS BY OUTLET VOLUME, NEVER BY TONE — and the
  payload carries NO row or column total of tone. A column average is the
  outlet score this project refuses to publish; it would be one glance away.
- A cell under `CELL_MIN_N` units has NO mean — only its count.
- The grid is PRUNED for density (plan §7.1): the measured grid was 81% blank,
  and a wall of dots reads as „these outlets ignore these people", which the
  data does not say. What was left out is counted and published.
- A period is OFFERED only when the pruned grid is dense enough to read.
- The deviation mode compares one outlet's treatment of one person with that
  person's OTHER outlets; a cell carries a colour only when the interval of the
  gap excludes zero. The legend on the page says it compares treatment of one
  person, not the outlets themselves.
- Only units from days whose corpus coverage passes the §4.2 floor enter, so
  a backlog day cannot tilt a cell.
"""
from __future__ import annotations

import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import person_rollups as pr  # noqa: E402
import sentiment_rollups as sr  # noqa: E402

CELL_MIN_N = 5
HATCH_BELOW_N = 10
# Candidate columns: outlets with at least this many assessed units in the
# period (across the grid's people).
OUTLET_MIN_UNITS = 30
CANDIDATE_PEOPLE = 30
MIN_FILLED_PER_LINE = 4
MAX_ROWS = 25
MAX_COLS = 15
OFFER_MIN_ROWS = 8
OFFER_MIN_FILLED_SHARE = 0.35
PERIODS = (("30", 30), ("90", 90), ("all", None))
Z95 = 1.96


def _instant(value):
    flag, moment = pr.published_key({"published": value})
    return moment if flag else None


def eligible_units(entry: dict, shares: dict, since) -> list:
    """The person's story-basis units inside the period, on covered days.
    `shares` is day → the share of the corpus scored that day."""
    out = []
    for u in entry["units"][pr.DEFAULT_BASIS]:
        moment = _instant(u.get("published"))
        if moment is None or (since and moment < since):
            continue
        day = sr.period_of(u["published"], "day")
        share = shares.get(day)
        if share is None or share < pr.COVERAGE_FLOOR:
            continue
        out.append(u)
    return out


def _stats(values: list) -> dict:
    s = sr.summarize_values(values)
    return {"n": len(values), "mean": s["value_mean"], "se": s["value_se"]}


def cell(units: list, others: list) -> dict:
    """One (person, outlet) cell. The mean and the gap from the person's other
    outlets only from `CELL_MIN_N` units up."""
    labels = pr._labels()  # noqa: SLF001 — the one bucket vocabulary
    counts = {label: 0 for label in labels}
    for u in units:
        if u["bucket"] in counts:
            counts[u["bucket"]] += 1
    out = {"n": len(units), "counts": counts}
    if len(units) < CELL_MIN_N:
        return out
    here = _stats([u["value"] for u in units])
    rest = _stats([u["value"] for u in others])
    out["mean"] = round(here["mean"], 4)
    out["mean_bucket"] = pr._bucket_of_value(here["mean"])  # noqa: SLF001
    if here["se"] is not None:
        out["ci_low"] = round(here["mean"] - Z95 * here["se"], 4)
        out["ci_high"] = round(here["mean"] + Z95 * here["se"], 4)
    if rest["n"] >= CELL_MIN_N and here["se"] is not None and rest["se"] is not None:
        gap = here["mean"] - rest["mean"]
        se = math.sqrt(here["se"] ** 2 + rest["se"] ** 2)
        lo, hi = gap - Z95 * se, gap + Z95 * se
        out["dev"] = round(gap, 4)
        out["dev_ci_low"] = round(lo, 4)
        out["dev_ci_high"] = round(hi, 4)
        # ⚠️ A colour only when the interval EXCLUDES zero.
        out["dev_sign"] = 1 if lo > 0 else -1 if hi < 0 else 0
    return out


def filled(cells: dict, row: str, col: str) -> bool:
    return cells.get(row, {}).get(col, {}).get("n", 0) >= CELL_MIN_N


def prune(rows: list, cols: list, cells: dict) -> tuple:
    """Drop any row or column with fewer than `MIN_FILLED_PER_LINE` filled
    cells and cap at the heaviest `MAX_ROWS` × `MAX_COLS`, repeatedly, until
    stable. ⚠️ THE CAP IS INSIDE THE LOOP: cutting after the density pass can
    strand a line under its floor once its partners are gone."""
    rows, cols = list(rows), list(cols)
    while True:
        keep_rows = [r for r in rows
                     if sum(filled(cells, r, c) for c in cols)
                     >= MIN_FILLED_PER_LINE][:MAX_ROWS]
        keep_cols = [c for c in cols
                     if sum(filled(cells, r, c) for r in keep_rows)
                     >= MIN_FILLED_PER_LINE][:MAX_COLS]
        if keep_rows == rows and keep_cols == cols:
            return rows, cols
        rows, cols = keep_rows, keep_cols


def build_period(people: dict, metas: dict, shares: dict, since) -> dict:
    """One period's grid. `people` is id → collected entry (published only)."""
    units_by_person = {pid: eligible_units(e, shares, since)
                       for pid, e in people.items()}
    by_cell: dict = {}
    outlet_units: dict = {}
    for pid, units in units_by_person.items():
        for u in units:
            by_cell.setdefault(pid, {}).setdefault(u["domain"], []).append(u)
            outlet_units[u["domain"]] = outlet_units.get(u["domain"], 0) + 1
    # ⚠️ ORDERED BY COVERAGE: people by their units in the period, outlets by
    # volume — never by anything a tone decides.
    person_order = sorted((p for p in units_by_person if units_by_person[p]),
                          key=lambda p: (-len(units_by_person[p]), p))
    candidates_rows = person_order[:CANDIDATE_PEOPLE]
    candidates_cols = sorted((d for d, n in outlet_units.items()
                              if n >= OUTLET_MIN_UNITS),
                             key=lambda d: (-outlet_units[d], d))
    cells: dict = {}
    for pid in candidates_rows:
        mine = by_cell.get(pid, {})
        for d in candidates_cols:
            units = mine.get(d, [])
            if not units:
                continue
            others = [u for dd, us in mine.items() if dd != d for u in us]
            cells.setdefault(pid, {})[d] = cell(units, others)
    rows, cols = prune(candidates_rows, candidates_cols, cells)
    total = len(rows) * len(cols)
    n_filled = sum(filled(cells, r, c) for r in rows for c in cols)
    share = (n_filled / total) if total else 0.0
    offered = len(rows) >= OFFER_MIN_ROWS and share >= OFFER_MIN_FILLED_SHARE
    return {
        "offered": offered,
        "rows": [{"id": pid, "name_bg": (metas.get(pid) or {}).get("name_bg"),
                  "name_en": (metas.get(pid) or {}).get("name_en"),
                  "n": len(units_by_person[pid])} for pid in rows],
        "cols": [{"domain": d, "n": outlet_units[d]} for d in cols],
        "cells": {pid: {d: cells[pid][d] for d in cols if d in cells.get(pid, {})}
                  for pid in rows},
        "filled_share": round(share, 3),
        # What was left out, so the page can say it in words.
        "omitted": {
            "people": len([p for p in person_order if p not in rows]),
            "outlets": len([d for d in outlet_units if d not in cols]),
        },
    }


def build(people: dict, metas: dict, coverage_days: dict,
          generated_at: str) -> dict:
    """Every period's grid. `people` holds only PUBLISHED persons."""
    now = _instant(generated_at) or datetime.now(timezone.utc)
    shares = pr.coverage_by_period(coverage_days, "day")
    periods = {}
    for key, days in PERIODS:
        since = (now - timedelta(days=days)) if days else None
        periods[key] = build_period(people, metas, shares, since)
    return {
        "version": 1, "generated_at": generated_at,
        "basis": "one unit per (outlet, story), only from days whose corpus "
                 "coverage passes the floor; no row or column total of tone "
                 "exists by design",
        "rules": {"cell_min_n": CELL_MIN_N, "hatch_below_n": HATCH_BELOW_N,
                  "outlet_min_units": OUTLET_MIN_UNITS,
                  "min_filled_per_line": MIN_FILLED_PER_LINE,
                  "offer_min_rows": OFFER_MIN_ROWS,
                  "offer_min_filled_share": OFFER_MIN_FILLED_SHARE,
                  "coverage_floor": pr.COVERAGE_FLOOR},
        "periods": periods,
    }
