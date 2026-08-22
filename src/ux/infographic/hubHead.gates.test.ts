// Static gates for the hub head (SKILL.md §9). Each exists because its absence shipped a
// defect in the commit that introduced the head, and each defect rendered fine:
//
//   • a basis line naming „2007–2026" against a corpus whose first contract is 2011-01-03;
//   • four KPI figures that were byte-identical to four tile metrics on the same page;
//   • the rule "a screen using HubHead must not also render <Title>" living only in a comment;
//   • ten screens left with a left-aligned <h1> over a centred deck by the H1 alignment flip.
//
// These are source scans on purpose: the first two are properties of what a page CLAIMS, which
// no render test can see, and the last two are properties of the tree rather than of a module.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { SCOPE_FIRST_YEAR } from "@/data/scope/constants";

const read = (p: string) => readFileSync(p, "utf8");

const HUB_SCREENS = [
  "src/screens/ProcurementScreen.tsx",
  "src/screens/GovernanceScreen.tsx",
];

describe("hub head — the basis line", () => {
  // The band's whole thesis is that a figure without its denominator is a false sentence, so
  // a window naming years the corpus does not hold is the one defect it must not ship.
  it("names no year before the corpus starts", () => {
    const offenders: string[] = [];
    for (const f of HUB_SCREENS) {
      read(f)
        .split("\n")
        .forEach((line, i) => {
          if (line.trimStart().startsWith("//")) return; // prose may quote the old value
          for (const [, y] of line.matchAll(/\b(\d{4})\s*[–-]\s*\d{4}\b/g))
            if (Number(y) < SCOPE_FIRST_YEAR)
              offenders.push(`${f}:${i + 1} names ${y}`);
        });
    }
    expect(
      offenders,
      `a basis window starts before the corpus (${SCOPE_FIRST_YEAR}): ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});

describe("hub head — the band and the tiles are disjoint", () => {
  // §3.1 rule 5. Both read the same hub_stats blob at the same scope, so an overlap renders
  // the identical string twice on one page — which reads as two different facts.
  it("no /procurement KPI figure is also a tile metric", () => {
    const src = read("src/screens/ProcurementScreen.tsx");

    // `metric: "x"` ids on the SUBPAGES entries → the HubStat field each resolves to.
    const FIELD_OF: Record<string, string> = {
      total: "totalEur",
      contracts: "contracts",
      contractors: "contractors",
      connected: "connected",
      tenders: "tenders",
      appeals: "appeals",
      ngos: "ngos",
      places: "places",
      flags: "flags",
      watch: "", // local watchlist count, not a HubStat field
    };
    const tileMetrics = [...src.matchAll(/metric: "([a-z]+)"/g)].map(
      (m) => m[1],
    );
    expect(tileMetrics.length).toBeGreaterThan(0);
    for (const m of tileMetrics)
      expect(
        FIELD_OF,
        `unknown tile metric "${m}" — extend this table`,
      ).toHaveProperty(m);

    const kpiBlock = src.slice(
      src.indexOf("const kpis"),
      src.indexOf("const evidenceRows"),
    );
    expect(kpiBlock.length).toBeGreaterThan(0);
    const kpiFields = new Set(
      [...kpiBlock.matchAll(/stat\.([A-Za-z]+)/g)].map((m) => m[1]),
    );
    expect(kpiFields.size).toBeGreaterThan(0);

    const clash = tileMetrics.filter(
      (m) => FIELD_OF[m] && kpiFields.has(FIELD_OF[m]),
    );
    expect(
      clash,
      `tile metric(s) also in the KPI band: ${clash.join(", ")}`,
    ).toEqual([]);
  });

  it("no two KPI cells share a destination", () => {
    for (const f of HUB_SCREENS) {
      const src = read(f);
      // Bounded to the KPI array literal itself — the next top-level `const` in the
      // component. A wider slice swallows the evidence rows, whose `to:` values are a
      // different set and legitimately repeat a destination.
      const start = src.indexOf("const kpi");
      const end = src.indexOf("\n  const ", start + 1);
      const block = src.slice(start, end === -1 ? undefined : end);
      const tos = [...block.matchAll(/^\s+to: "([^"]+)"/gm)].map((m) => m[1]);
      expect(
        new Set(tos).size,
        `${f}: duplicate KPI destination in ${tos.join(", ")}`,
      ).toBe(tos.length);
    }
  });
});

describe("hub head — one h1 per page", () => {
  it("no screen renders both HubHead and Title", () => {
    const files = execSync("grep -rl 'HubHead' src/screens --include=*.tsx", {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(files.length).toBeGreaterThan(0);
    const both = files.filter((f) => /<Title\b/.test(read(f)));
    expect(
      both,
      `HubHead renders the page's h1, so these would emit two: ${both.join(", ")}`,
    ).toEqual([]);
  });
});

describe("H1 alignment — no left heading over a centred sibling", () => {
  // The H1 base is `text-left` now. A deck that kept `mx-auto text-center` (or a block that
  // kept `flex-col items-center` / `justify-center`) was centred BECAUSE the h1 used to be,
  // so it now reads as a broken axis. A heading that opts into centring in its OWN className
  // is deliberate and exempt — ErrorSection is the sanctioned case.
  const CENTRED =
    /\btext-center\b|flex-col\s+items-center|items-center\s+flex-col|\bjustify-center\b/;

  it("no header block pairs a default-aligned heading with a centred sibling", () => {
    const files = execSync("grep -rl '<H1\\|<Title' src --include=*.tsx", {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(files.length).toBeGreaterThan(20);

    const offenders: string[] = [];
    for (const f of files) {
      const lines = read(f).split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!/<(H1|Title)\b/.test(lines[i])) continue;
        // The heading's own opening tag may span lines; read to its `>`.
        let end = i;
        let own = lines[i];
        while (!/>/.test(own.slice(own.indexOf("<"))) && end < lines.length - 1)
          own += " " + lines[++end];
        if (CENTRED.test(own)) continue; // deliberate — the heading centres itself

        for (let j = end + 1; j < Math.min(end + 9, lines.length); j++) {
          const l = lines[j];
          if (/<\/div>|<\/section>|<\/header>|<\/>|\{\s*$|\? \(|&& \(/.test(l))
            break;
          if (!/className=/.test(l)) continue;
          if (CENTRED.test(l)) {
            offenders.push(`${f}:${j + 1}`);
            break;
          }
        }
      }
    }
    expect(
      offenders,
      `left-aligned heading over a centred sibling: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
