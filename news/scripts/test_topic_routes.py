#!/usr/bin/env python3
"""Every topic route must be a route the main site actually declares.

⚠️ A TOPIC CHIP IS A LINK OFF THIS SITE, so a route that no longer exists is
a 404 on electionsbg.com reached from a page that looks healthy. Nothing in
the news pipeline can see that: `news/topics.json` is a committed file and
`src/routes.tsx` lives in the other half of the repo, so a route renamed there
leaves this file green for ever.

The check is STATIC over routes.tsx rather than a fetch, so it runs offline on
the standalone analysis box and cannot pass because a server happened to serve
an SPA shell at 200 for an unknown path — which is exactly what Firebase does.
"""
import json
import os
import re
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
TOPICS = os.path.join(ROOT, "news", "topics.json")
ROUTES_TSX = os.path.join(ROOT, "src", "routes.tsx")

PATH_RE = re.compile(r'path=\{?"([^"]*)"')
# A dynamic segment matches anything, so `/sector/agri` is served by
# `/sector/:id`. Compared segment-wise — a `:param` never spans a `/`.
PARAM_RE = re.compile(r"^:")


def strip_comments(src: str) -> str:
    """⚠️ Prose that MENTIONS a route is not a declaration of one, and
    routes.tsx is heavily commented. A commented-out `<Route path="…">` left
    during a refactor would otherwise keep this gate green after the route is
    gone — the failure it exists to catch."""
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"^\s*//.*$", "", src, flags=re.M)


def declared_routes() -> set:
    with open(ROUTES_TSX, encoding="utf-8") as fh:
        src = strip_comments(fh.read())
    out = set()
    for p in PATH_RE.findall(src):
        if not p or p == "*":
            continue
        out.add(p if p.startswith("/") else "/" + p)
    return out


def is_served(route: str, declared: set) -> bool:
    # ⚠️ The site root is declared as `<Route index …>`, with no `path`
    # attribute at all, so no amount of regex over `path="…"` will find it.
    if route == "/":
        return True
    if route in declared:
        return True
    want = [s for s in route.split("/") if s]
    for d in declared:
        have = [s for s in d.split("/") if s]
        if len(have) != len(want):
            continue
        if all(PARAM_RE.match(h) or h == w for h, w in zip(have, want)):
            return True
    return False


def topic_routes() -> list:
    with open(TOPICS, encoding="utf-8") as fh:
        doc = json.load(fh)
    out = []
    for c in doc["categories"]:
        if c.get("route"):
            out.append((c["id"], c["route"]))
        for s in c.get("subcategories") or []:
            if s.get("route"):
                out.append(f"{c['id']}/{s['id']}"), out.append(
                    (f"{c['id']}/{s['id']}", s["route"]))
    return [t for t in out if isinstance(t, tuple)]


class CommentedRoutesDoNotCount(unittest.TestCase):
    """⚠️ Tested DIRECTLY, on synthetic input, because routes.tsx currently
    carries no commented-out `<Route>` — so deleting strip_comments changes
    nothing measurable today and a corpus-driven assertion cannot see it. The
    day someone comments one out during a refactor is the day this matters,
    and by then the gate would already be silently wrong."""

    def test_a_commented_out_route_is_not_declared(self):
        src = ('<Route path="real" />\n'
               '        // <Route path="line-commented" />\n'
               '        /* <Route path="block-commented" /> */')
        self.assertEqual(set(PATH_RE.findall(strip_comments(src))), {"real"})

    def test_a_route_MENTIONED_in_prose_is_not_declared(self):
        src = ('// we used to serve path="retired-page" here\n'
               '<Route path="live" />')
        self.assertEqual(set(PATH_RE.findall(strip_comments(src))), {"live"})


class TopicRoutesResolve(unittest.TestCase):
    def setUp(self):
        if not os.path.exists(ROUTES_TSX):
            self.skipTest("src/routes.tsx absent — analysis-box checkout")
        self.declared = declared_routes()

    def test_routes_tsx_parses_to_a_plausible_route_set(self):
        # ⚠️ Non-vacuity. A regex that stopped matching would make every
        # assertion below fail rather than pass — but a `strip_comments` that
        # ate the whole file would too, and this names which.
        self.assertGreater(len(self.declared), 200, "routes.tsx parsed thin")
        self.assertIn("/persons", self.declared)

    def test_every_topic_route_is_served(self):
        bad = [(i, r) for i, r in topic_routes()
               if not is_served(r, self.declared)]
        self.assertEqual(bad, [], f"topic routes with no page: {bad}")

    def test_the_check_still_DISCRIMINATES(self):
        # Otherwise "every route resolves" is satisfiable by a matcher that
        # says yes to everything — the dynamic-segment arm makes that easy to
        # write by accident.
        self.assertFalse(is_served("/no-such-page-xyz", self.declared))
        self.assertFalse(is_served("/persons/no-such-child", self.declared))

    def test_a_dynamic_segment_serves_its_children(self):
        self.assertTrue(is_served("/sector/agri", self.declared))
        self.assertTrue(is_served("/sector/energy", self.declared))

    def test_the_subcategory_the_report_asked_for_is_wired(self):
        # „Декларации и конфликти на интереси" → the declarations register.
        got = dict(topic_routes())
        self.assertEqual(got.get("officials-people/declarations-conflicts"),
                         "/governance/declarations")
        self.assertEqual(got.get("officials-people"), "/persons")


if __name__ == "__main__":
    sys.exit(0 if unittest.main(exit=False).result.wasSuccessful() else 1)
