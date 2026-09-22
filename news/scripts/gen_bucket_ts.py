#!/usr/bin/env python3
"""Generate `newsapp/app/sentimentScale.ts` + its vector fixture from Python.

    python3 news/scripts/gen_bucket_ts.py            # rewrite both files
    python3 news/scripts/gen_bucket_ts.py --check    # exit 1 if either is stale

⚠️ WHY GENERATE IT. Plan §3.6 requires the bucketing rule to have ONE SOURCE OF
TRUTH. It has two consumers that cannot share code — the producer, which stores
`value` and its bucket, and the client, which draws the bar and the chip — and a
rule hand-copied between them fails invisibly: both sides compile, both render,
and only articles near an edge disagree. The repo already has this pattern in
`scripts/db/gen_sql/shlyo_query_fold.ts`; it runs TypeScript → SQL, this one
runs **Python → TypeScript**, because `jev_scales.py` is where the producer
lives and the arithmetic has to be right there first.

⚠️⚠️ IT DOES NOT MAKE THE RULE ONE IMPLEMENTATION, AND THE DIFFERENCE IS WHERE
THE TRUST SITS. The emitted loop is a hand-written TypeScript translation living
in a string literal inside `build_ts` — a second implementation, in a second
language, maintained by hand. Nothing derives it from `jev_scales.bucket_index`
and nothing could, short of transpiling. What binds the string to the Python is
**the vector fixture, and nothing else.**

So: a function added to the emitted module WITHOUT a fixture case is unverified.
That is not hypothetical — it is how `bucketLabel` shipped inferring the scale's
anchor count from the vocabulary's length, which names a bucket one step too
strong for every 9-anchor value. Read "generated" as "kept in step", never as
"cannot be wrong", and do not trim the fixture on the strength of the word.

⚠️ THE VECTOR FIXTURE IS THE HALF THAT ACTUALLY CATCHES DRIFT. A generated file
can be hand-edited; a fixture of (input → expected bucket) pairs computed by the
PYTHON implementation and asserted by the TypeScript one cannot be satisfied by
a TypeScript bug. Its cases are chosen for the failures this rule has actually
had: the edge NEIGHBOURHOODS (a one-sided float tolerance made
`bucket_index(-v)` stop mirroring `bucket_index(v)` a few ULPs from an edge,
reachable from an ordinary two-decimal answer), and both anchor counts (the
edges are on the NORMALIZED value so a 5- and a 9-anchor run stay comparable).
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))

import jev_axes as ax  # noqa: E402
import jev_scales as js  # noqa: E402

OUT_TS = ROOT / "newsapp/app/sentimentScale.ts"
OUT_VECTORS = ROOT / "newsapp/app/sentimentScale.vectors.json"
GENERATOR = "news/scripts/gen_bucket_ts.py"

# ⚠️ READ, NOT RESTATED. `jev_axes.ANCHOR_VARIANTS` is the one place that
# says which anchor counts exist; writing `{5: ..., 9: ...}` here again is how
# a third variant reaches the producer and never reaches the fixture.
SCALES = dict(sorted(ax.ANCHOR_VARIANTS.items()))

# The display vocabularies, in one place: emitted into the module AND into the
# fixture, so the TypeScript test can check the module against the fixture.
VOCABULARIES = {
    "TONE_BUCKET_ORDER": ax.SUBJECT_TONE.labels,
    "LEANING_BUCKET_ORDER": ax.LEANING.labels,
    "RUSSIA_BUCKET_ORDER": ax.RUSSIA_STANCE.labels,
}


def _num(value: float) -> str:
    """A number literal spelled the way PRETTIER writes it.

    ⚠️ PRETTIER IS THE GATE, NOT `Number.toString()`. They differ: JS writes
    `1e+21` and prettier normalizes it to `1e21`, so targeting the runtime's
    spelling leaves `eslint --fix` rewriting the file, which makes it stale
    against `--check`, which rewrites it back. The two gates then fail
    alternately for ever and neither is wrong. Prettier lowercases the `e`,
    strips the `+` and strips zero padding from the exponent.

    `test_gen_bucket_ts` pins these cases, and the `.test.mjs` sibling runs
    prettier itself so the claim is checked against the tool rather than
    against this docstring.
    """
    value = float(value)
    if not math.isfinite(value):
        # `repr(nan)` is "nan" — a bare identifier that compiles to a
        # ReferenceError in the browser, emitted by a helper documented as
        # producing a round-trip literal.
        raise SystemExit(f"_num: {value!r} has no JavaScript literal")
    text = repr(value).lower()
    if "e" in text:
        mantissa, _, exponent = text.partition("e")
        # Prettier STRIPS a positive exponent sign (`1e+21` -> `1e21`) and
        # keeps the negative one, so only "-" survives.
        sign = "-" if exponent.startswith("-") else ""
        digits = exponent.lstrip("+-").lstrip("0") or "0"
        text = f"{mantissa}e{sign}{digits}"
    return text


def build_ts() -> str:
    edges = ", ".join(_num(e) for e in js.BUCKET_EDGES)
    blocks = []
    for name, labels in VOCABULARIES.items():
        # A display vocabulary must partition BUCKET_EDGES + 1 buckets. Caught
        # HERE, not by `bucketLabel`'s throw, which happens in the browser.
        if len(labels) != len(js.BUCKET_EDGES) + 1:
            raise SystemExit(f"{name}: {len(labels)} labels for "
                             f"{len(js.BUCKET_EDGES) + 1} buckets")
        # ⚠️ Each entry already carries its trailing comma. Joining with a
        # comma too emits `"a",,` — which TypeScript reads as an array HOLE, so
        # a 5-label vocabulary arrives as 9 entries and `bucketLabel` refuses
        # it. Caught by the cross-language fixture, not by any Python test.
        # json.dumps, not an f-string: a label carrying a quote, a backslash
        # or a newline would otherwise emit broken TypeScript. The bytes are
        # identical for every label today, so the artifacts do not move.
        entries = "\n".join(
            f"  {json.dumps(label, ensure_ascii=False)}," for label in labels)
        blocks.append(f"export const {name} = [\n{entries}\n] as const;")
    vocab_src = "\n\n".join(blocks)
    max_levels = js.MAX_SCORE_LEVELS
    return f'''// GENERATED by `{GENERATOR}` from `news/scripts/jev_scales.py`
// and `news/scripts/jev_axes.py`. Do not edit by hand.
//
//   python3 {GENERATOR}           # rewrite
//   python3 {GENERATOR} --check   # the staleness gate
//
// The bucketing rule has two consumers that cannot share code — the Python
// producer that stores a score's `value`, and this client that draws the bar
// and the chip. Hand-copying it is how the bar and the number stop agreeing on
// the articles nearest an edge, with both sides rendering happily.
//
// ⚠️ "Generated" means KEPT IN STEP, not "cannot be wrong". This code is a
// hand-written translation of `jev_scales.py`; what binds the two is
// `sentimentScale.vectors.json` — cases computed by the PYTHON implementation
// and replayed against this one by `sentimentScale.test.ts`. A function here
// with no fixture case is unverified. Add the case in `build_vectors` when you
// add the function, and regenerate.
//
// Kept honest by: `gen_bucket_ts.py --check` (a CI step and
// `news/scripts/gen_bucket_ts.test.mjs`), plus the fixture replay above.

/**
 * The bucket boundaries, on the NORMALIZED value (`value / extent`).
 *
 * ⚠️ Normalized, not raw, so a 5-anchor and a 9-anchor answer of the same
 * shape land in the same bucket — `value` lives on ±(levels−1)/2, so a raw cut
 * would mean different things on the two scales.
 */
export const BUCKET_EDGES = [{edges}] as const;

/** How close to an edge counts as ON it. Applied to BOTH sides — see below. */
export const EDGE_TOLERANCE = {_num(js.EDGE_TOLERANCE)};

{vocab_src}

/**
 * The largest absolute level value for a scale of `levels` anchors.
 *
 * ⚠️ Refuses a level count the producer would refuse: `jev_scales.Scale`
 * requires 2..{max_levels} anchors, and `extentFor(1)` is 0, which makes
 * `normalizeValue` return Infinity or NaN rather than raising.
 */
export const extentFor = (levels: number): number => {{
  if (!Number.isInteger(levels) || levels < 2 || levels > {max_levels}) {{
    throw new Error(`levels must be an integer in 2..{max_levels}, got ${{levels}}`);
  }}
  return (levels - 1) / 2;
}};

/** `value` mapped onto [-1, 1]. */
export const normalizeValue = (value: number, levels: number): number =>
  value / extentFor(levels);

/**
 * Which display bucket a value falls in.
 *
 * ⚠️ THE FLOAT TOLERANCE IS TWO-SIDED. Applying it to the positive edges only
 * makes `bucketIndex(-v)` stop mirroring `bucketIndex(v)` a few ULPs from an
 * edge, which is reachable from an ordinary two-decimal answer:
 * `{{1: .20, 2: .10, 3: .70}}` has value 0.49999999999999994, so it would land
 * in *favorable* while its exact mirror landed in *neutral*.
 */
export const bucketIndex = (value: number, levels: number): number => {{
  const n = normalizeValue(value, levels);
  let idx = 0;
  for (const edge of BUCKET_EDGES) {{
    if (Math.abs(n - edge) <= EDGE_TOLERANCE) {{
      // Each interval is closed on its OUTER side: -0.25 belongs to the
      // unfavourable bucket, +0.25 to the favourable one.
      if (edge > 0) idx += 1;
      break;
    }}
    if (n > edge) idx += 1;
    else break;
  }}
  return idx;
}};

/**
 * The bucket's label, in a vocabulary of exactly BUCKET_EDGES.length + 1 entries.
 *
 * ⚠️ `levels` IS THE ANCHOR COUNT OF THE SCALE THE VALUE CAME FROM, never the
 * vocabulary's length. They are equal only for a 5-anchor value. A 9-anchor
 * comparison run is bucketed through this same 5-label display vocabulary —
 * `jev_scales.bucket_label` refuses that call outright and points at
 * `bucket_index` — so inferring the count from `order.length` would normalize
 * a ±4 value by 2 and name a bucket one step too strong, on a named subject,
 * at a 200, with nothing failing.
 */
export const bucketLabel = <T extends string>(
  value: number,
  levels: number,
  order: readonly T[],
): T => {{
  if (order.length !== BUCKET_EDGES.length + 1) {{
    throw new Error(
      `bucketLabel needs ${{BUCKET_EDGES.length + 1}} labels, got ${{order.length}}`,
    );
  }}
  return order[bucketIndex(value, levels)];
}};
'''


def build_vectors() -> str:
    """(levels, value) → expected bucket, computed by the PYTHON implementation."""
    cases: list = []
    seen = set()
    for levels, scale in SCALES.items():
        values = [h / 100 * scale.extent for h in range(-100, 101, 7)]
        # The neighbourhoods a sweep of round numbers steps straight over.
        for edge in js.BUCKET_EDGES:
            for eps in (0.0, 1e-16, 1e-13, 1e-10, 1e-8, 1e-6):
                values += [(edge + eps) * scale.extent, (edge - eps) * scale.extent]
        # The live reproduction: 0.49999999999999994 and its exact negation.
        if levels == 5:
            probs, _ = js.read_probabilities({"1": 0.20, "2": 0.10, "3": 0.70}, scale)
            drifted = sum(p * scale.values[i] for i, p in probs.items())
            values += [drifted, -drifted]
        # ⚠️ The edge neighbourhoods overlap the round-number sweep at eps = 0,
        # so ten cases were exact duplicates. Deduping keeps the fixture's
        # count meaningful as a coverage figure.
        for value in values:
            key = (levels, repr(value))
            if key in seen:
                continue
            seen.add(key)
            cases.append({
                "levels": levels,
                "value": value,
                "normalized": js.normalize(value, scale),
                "bucket": js.bucket_index(value, scale),
                "label": (js.bucket_label(value, ax.SUBJECT_TONE)
                          if scale.renderable else
                          ax.SUBJECT_TONE.labels[js.bucket_index(value, scale)]),
            })
    doc = {
        "generated_by": GENERATOR,
        "source": ["news/scripts/jev_scales.py", "news/scripts/jev_axes.py"],
        "contract_version": js.SCALE_CONTRACT_VERSION,
        "edges": list(js.BUCKET_EDGES),
        "edge_tolerance": js.EDGE_TOLERANCE,
        "vocabularies": {name: list(labels) for name, labels in VOCABULARIES.items()},
        "cases": cases,
    }
    return json.dumps(doc, ensure_ascii=False, indent=2) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true",
                        help="exit 1 when either artifact is stale")
    args = parser.parse_args()
    wanted = {OUT_TS: build_ts(), OUT_VECTORS: build_vectors()}
    if args.check:
        stale = [p for p, text in wanted.items()
                 if not p.exists() or p.read_text(encoding="utf-8") != text]
        for path in stale:
            print(f"stale: {path.relative_to(ROOT)} — run `python3 {GENERATOR}`",
                  file=sys.stderr)
        return 1 if stale else 0
    for path, text in wanted.items():
        path.write_text(text, encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
