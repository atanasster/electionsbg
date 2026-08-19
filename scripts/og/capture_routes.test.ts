// og:image captures name a ROUTE and a SELECTOR, and nothing connects the two.
//
// When /culture became the sector hub and its film dashboard moved to
// /culture/subsidies, `data-og="culture-hero"` moved with it — and the capture
// entry kept pointing at /culture. The failure is not subtle at runtime (a 30 s
// wait, a throw, the whole run exits 1) but it is invisible in review, because
// the two halves live in different files and neither mentions the other.
//
// So: every `data-og` selector a capture waits for must exist in the source of a
// screen the capture's route can actually reach. That is a coarse check — it
// matches the attribute anywhere under src/ — but it is exactly strong enough to
// catch a selector that has moved to a page the entry no longer names.
//
// ⚠️ MARKERS ARE NOT ALWAYS LITERALS. `BudgetCompositionScreen` writes
// ``data-og={`budget-${kind}`}``, so `budget-revenue` and `budget-expenditure`
// exist only at runtime. A literal-only scan reports both as missing — this gate
// did, on its first run, against two captures that work fine. Template PREFIXES
// are therefore collected too and a marker matching one is accepted. The cost is
// that a genuinely dead `budget-*` marker would pass; the alternative is a gate
// that cries wolf, which is a gate someone deletes.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
};

/** eik/slug-shaped route params make an entry un-checkable by path alone; those
 *  entries are covered by the selector check only. */
const captureSource = () =>
  readFileSync(path.join(ROOT, "scripts/og/capture-screens.ts"), "utf8");

const srcFiles = (): { file: string; body: string }[] =>
  walk(path.join(ROOT, "src")).map((f) => ({
    file: path.relative(ROOT, f),
    body: readFileSync(f, "utf8"),
  }));

describe("og capture entries", () => {
  const entries = [
    ...captureSource().matchAll(
      /slug:\s*"([^"]+)"[\s\S]*?routePath:\s*(?:"([^"]*)"|`([^`]*)`)[\s\S]*?(?=\n {2}\{|\n\];)/g,
    ),
  ].map((m) => ({
    slug: m[1],
    routePath: m[2] ?? m[3] ?? "",
    block: m[0],
  }));

  it("parses at least a dozen entries, so the gate is not vacuous", () => {
    expect(entries.length).toBeGreaterThan(12);
  });

  it("waits only for data-og selectors that exist somewhere in src/", () => {
    const files = srcFiles();
    for (const e of entries) {
      for (const m of e.block.matchAll(/\[data-og="([^"]+)"\]/g)) {
        const marker = m[1];
        const literal = files.some((f) =>
          f.body.includes(`data-og="${marker}"`),
        );
        const templated = files.some((f) =>
          [...f.body.matchAll(/data-og=\{`([^`$]*)\$\{/g)].some((t) =>
            marker.startsWith(t[1]),
          ),
        );
        expect(
          literal || templated,
          `capture "${e.slug}" waits for [data-og="${marker}"], which no screen ` +
            `defines as a literal or builds from a template prefix. The capture ` +
            `will wait out its timeout and fail the whole run.`,
        ).toBe(true);
      }
    }
  });

  it("keeps the culture capture pointed at the page that owns its hero", () => {
    // The specific regression: the hero moved to /culture/subsidies with the
    // dashboard, and an entry left on /culture would hang. Named explicitly
    // because the generic check above cannot tell WHICH page owns a selector.
    const culture = entries.find((e) => e.slug === "culture");
    expect(culture, "no capture entry with slug 'culture'").toBeTruthy();
    expect(culture!.routePath).toBe("culture/subsidies");
    const owner = srcFiles().find((f) =>
      f.body.includes('data-og="culture-hero"'),
    );
    expect(owner?.file).toBe("src/screens/culture/CultureSubsidiesScreen.tsx");
  });
});
