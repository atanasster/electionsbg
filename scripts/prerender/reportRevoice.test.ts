// The report copy is written ONCE in the settlement voice and mechanically
// re-voiced for the municipality and section grains (`revoice` in
// dynamicRoutes.ts). That substitution is the only thing standing between a
// municipality page and a meta description that still talks about населени
// места — and nothing about it is type-checked, so it gets a behavioural gate
// that runs the real builder.
//
// It had drifted badly and silently: the old regex `/населен[иa] места?/g` was
// case-sensitive (so every sentence-initial "Населени места" survived), carried
// no definite forms (so "населените места" and "населеното място" survived),
// and its `a` was a LATIN a (U+0061) that could never match a Cyrillic word at
// all. 26 of the 28 non-settlement pages shipped with a <title> saying "по
// общини" over a description saying "Населени места …".
//
// This lives under scripts/** (node project) rather than beside the matrix in
// src/**, because dynamicRoutes.ts reads the filesystem at import time.

import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { buildReportRoutes } from "./dynamicRoutes";

/** Any leftover "населен…" place phrase in copy that should have been
 *  re-voiced. The cross-grain links are stripped first: a settlement-pointing
 *  anchor legitimately reads "по населени места" on every grain, because that
 *  is where it goes. */
const residue = (route: {
  title: string;
  description?: string;
  bodyHtml?: string;
}): string[] => {
  const text = `${route.title}\n${route.description ?? ""}\n${route.bodyHtml ?? ""}`;
  const withoutCrossGrainLinks = text.replace(
    /<a href="[^"]*\/settlement\/[^"]*">[^<]*<\/a>/g,
    "",
  );
  return [
    ...new Set(
      withoutCrossGrainLinks.match(/[Нн]аселен\S*\s+(?:мяст|мест)\S*/g) ?? [],
    ),
  ];
};

describe("per-grain report copy", () => {
  const routes = buildReportRoutes();

  test("no municipality or section page mentions населени места", () => {
    const offenders = routes
      .filter((r) => !r.path.startsWith("reports/settlement/"))
      .map((r) => ({ path: r.path, found: residue(r) }))
      .filter((x) => x.found.length > 0);
    assert.deepEqual(
      offenders.map((o) => `${o.path}: ${o.found.join(", ")}`),
      [],
      "settlement-voiced copy survived re-voicing",
    );
  });

  test("settlement pages KEEP населени места", () => {
    // The mirror image: a substitution broad enough to catch every form must
    // not fire on the grain the copy was written for.
    const settlement = routes.filter((r) =>
      r.path.startsWith("reports/settlement/"),
    );
    assert.ok(settlement.length >= 13, "no settlement report routes built");
    assert.ok(
      settlement.some((r) => residue(r).length > 0),
      "settlement copy lost its own wording — revoice is firing on the source grain",
    );
  });

  test("each grain names itself in the title", () => {
    const expected: Record<string, string> = {
      "reports/municipality/turnout": "по общини",
      "reports/settlement/turnout": "по населени места",
      "reports/section/turnout": "по секции",
    };
    for (const [path, phrase] of Object.entries(expected)) {
      const r = routes.find((x) => x.path === path);
      assert.ok(r, `missing route ${path}`);
      assert.ok(
        r.title.includes(phrase),
        `${path} title should contain "${phrase}", got: ${r.title}`,
      );
    }
  });

  test("definite forms re-voice with the article, not the bare noun", () => {
    // "Класация на населените места по…" must become "на общините", never "на
    // общини" — the longest-first alternation in PLACE_FORMS is what does it.
    const muni = routes.find((r) => r.path === "reports/municipality/turnout");
    assert.ok(muni?.description?.includes("на общините"), muni?.description);
    const section = routes.find((r) => r.path === "reports/section/turnout");
    assert.ok(
      section?.description?.includes("на секциите"),
      section?.description,
    );

    // Singular definite: "в населеното място." → "в общината." / "в секцията."
    const mBody = routes.find(
      (r) => r.path === "reports/municipality/invalid_ballots",
    )?.bodyHtml;
    assert.ok(mBody?.includes("в общината."), mBody);
    const sBody = routes.find(
      (r) => r.path === "reports/section/invalid_ballots",
    )?.bodyHtml;
    assert.ok(sBody?.includes("в секцията."), sBody);
  });

  test("no Latin homoglyph hides inside a Cyrillic word", () => {
    // How the dead `[иa]` alternative and the "нискa" typo both got in. A Latin
    // letter flanked by Cyrillic is never intentional here, and it silently
    // breaks search, matching and screen readers.
    const offenders: string[] = [];
    for (const r of routes) {
      const text = `${r.title} ${r.description ?? ""} ${r.bodyHtml ?? ""}`;
      for (const m of text.matchAll(
        /\p{Script=Cyrillic}[a-zA-Z]|[a-zA-Z]\p{Script=Cyrillic}/gu,
      ))
        offenders.push(
          `${r.path}: …${text.slice(Math.max(0, m.index - 12), m.index + 12)}…`,
        );
    }
    assert.deepEqual(offenders, [], "Latin letter inside a Cyrillic word");
  });
});
