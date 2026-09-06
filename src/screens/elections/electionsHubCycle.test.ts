// Which election the hub is about, and what it says when it cannot tell.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  CYCLE_SURFACE,
  ELECTION_EVENTS,
  KINDS_WITHOUT_SURFACE,
  LATEST_ELECTION_EVENT,
  LATEST_RESOLVABLE_EVENT,
  hubCycleHref,
  resolveHubCycle,
  type ElectionsHubKind,
} from "./electionsHubCycle";
import allElections from "@/data/json/elections.json";
import allLocal from "@/data/json/local_elections.json";
import allPresidential from "@/data/json/presidential_elections.json";
import { formatDate } from "@/lib/formatDate";

describe("the event catalogue", () => {
  it("carries every cycle from ALL THREE files", () => {
    // ⚠ THE PARAM IS VALIDATED AGAINST ALL OF THEM (§3.2 rule 1). Validating against the
    // parliamentary catalogue alone makes every local cycle "unknown", so a reader arriving
    // from `/local/2019_10_27_mi` is told their selection could not be read.
    expect(ELECTION_EVENTS).toHaveLength(
      allElections.length + allLocal.length + allPresidential.length,
    );
    for (const e of allElections)
      expect(ELECTION_EVENTS.find((x) => x.id === e.name)?.kind).toBe(
        "parliamentary",
      );
    for (const l of allLocal)
      expect(ELECTION_EVENTS.find((x) => x.id === l.name)?.kind).toBe("local");
    for (const p of allPresidential)
      expect(ELECTION_EVENTS.find((x) => x.id === p.name)?.kind).toBe(
        "presidential",
      );
  });

  it("dates a presidential cycle from round 1, not from its id", () => {
    // The id carries `_pvr`, so `id.split("_").join("-")` produces `2021-11-14-pvr` — which
    // `formatDate` passes through VERBATIM rather than rejecting, i.e. the folder id on the
    // page. Same trap as the local `_mi` suffix, one catalogue over.
    const p = ELECTION_EVENTS.find((e) => e.id === "2021_11_14_pvr")!;
    expect(p.date).toBe("2021-11-14");
    expect(formatDate(p.date, "bg")).not.toContain("pvr");
  });

  it("is sorted newest-first by DATE, not by file order", () => {
    // Both files are newest-first today, so `[0]` reads correctly — and would go on reading
    // correctly right up until a cycle is appended rather than prepended.
    const dates = ELECTION_EVENTS.map((e) => e.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(LATEST_ELECTION_EVENT.id).toBe("2026_04_19");
  });

  it("dates a local cycle from its round-1 date, not from its id", () => {
    // The id carries `_mi`, so `id.split("_").join("-")` would produce `2023-10-29-mi` — an
    // unparseable date that `formatDate` passes through VERBATIM rather than rejecting, i.e.
    // the folder id on the page.
    const l = ELECTION_EVENTS.find((e) => e.id === "2023_10_29_mi")!;
    expect(l.date).toBe("2023-10-29");
    expect(formatDate(l.date, "bg")).not.toContain("mi");
    expect(formatDate(l.date, "bg")).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("never offers an id as a label", () => {
    // ⚠ A CYCLE IDENTIFIER IS A KEY. Every entry carries a formattable ISO date beside it, so
    // no caller has to reach for the id — the defect that put „2026-04-19" on 31 surfaces.
    for (const e of ELECTION_EVENTS) {
      expect(e.date, e.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(formatDate(e.date, "bg"), e.id).not.toBe(e.date);
      expect(formatDate(e.date, "en"), e.id).not.toBe(e.date);
    }
  });
});

describe("per-kind surfaces", () => {
  const ROUTES = fs.readFileSync(
    path.join(process.cwd(), "src/routes.tsx"),
    "utf8",
  );

  it("declares a route for exactly the kinds that have one", () => {
    // ⚠ A BICONDITIONAL AGAINST `routes.tsx`, not a hand-flipped boolean. Adding
    // `/presidential/:cycle` turns this red until `KINDS_WITHOUT_SURFACE` is emptied, and
    // emptying it early turns it red too — so the two cannot drift the way a flag would.
    for (const [kind, surface] of Object.entries(CYCLE_SURFACE) as [
      ElectionsHubKind,
      (typeof CYCLE_SURFACE)[ElectionsHubKind],
    ][]) {
      const declared = ROUTES.includes(`path="${surface.routePattern}"`);
      const expected = !KINDS_WITHOUT_SURFACE.includes(kind);
      expect(
        declared,
        expected
          ? `${kind}: routes.tsx has no path="${surface.routePattern}", yet the kind is ` +
              `not in KINDS_WITHOUT_SURFACE — the hub would link to a 404`
          : `${kind}: routes.tsx now declares path="${surface.routePattern}" — remove the ` +
              `kind from KINDS_WITHOUT_SURFACE so the hub can resolve it`,
      ).toBe(expected);
      // ⚠ THE GATE'S OWN INPUT, CHECKED. For a withheld kind BOTH sides of the
      // biconditional are false whatever `routePattern` says, and nothing else in the
      // codebase reads that field — so a typo („presidental/:cycle") is invisible today
      // AND survives T5, silently disabling the trigger this whole design leans on.
      // `href` is the field that actually renders, so the two must agree.
      expect(
        surface.href("ID"),
        `${kind}: routePattern and href are two spellings of one fact and disagree`,
      ).toBe(`/${surface.routePattern.replace(/:[A-Za-z]+/, "ID")}`);
    }
    // The control: the two kinds that DO have routes, so an assertion that passed because
    // the file could not be read would fail here.
    expect(ROUTES).toContain('path="local/:cycle"');
    expect(ROUTES.length).toBeGreaterThan(1000);
  });

  it("builds each kind's href from its own id", () => {
    expect(hubCycleHref(resolveHubCycle("2013_05_12"))).toBe(
      "/elections/2013_05_12",
    );
    expect(hubCycleHref(resolveHubCycle("2019_10_27_mi"))).toBe(
      "/local/2019_10_27_mi",
    );
    // ⚠ Constructed by hand rather than resolved, because a presidential cycle is exactly
    // what `resolveHubCycle` refuses today — this pins that the href, when the surface
    // lands, is the presidential one and not `/elections/<a _pvr id>`.
    expect(
      hubCycleHref({
        kind: "presidential",
        id: "2021_11_14_pvr",
        date: "2021-11-14",
        fellBack: false,
      }),
    ).toBe("/presidential/2021_11_14_pvr");
  });
});

describe("resolution", () => {
  it("prefers the param over the latest event", () => {
    // The whole point: a reader arriving from `/elections/2013_05_12` carries
    // `?elections=2013_05_12`, and a hub that ignores it renders 2026 while everything else on
    // the page resolves 2013.
    const r = resolveHubCycle("2013_05_12");
    expect(r.id).toBe("2013_05_12");
    expect(r.fellBack).toBe(false);
  });

  it("resolves a LOCAL cycle from the param too", () => {
    const r = resolveHubCycle("2019_10_27_mi");
    expect(r.kind).toBe("local");
    expect(r.date).toBe("2019-10-27");
  });

  it("falls back to the latest event and SAYS SO", () => {
    // Rule 3. A silent fallback renders a first screen the reader cannot account for.
    const r = resolveHubCycle("not-a-cycle");
    expect(r.id).toBe(LATEST_ELECTION_EVENT.id);
    expect(r.fellBack).toBe(true);
    expect(r.fellBackReason).toBe("unknown");
    expect(r.requested).toBe("not-a-cycle");
  });

  it("never returns a kind whose screens do not exist", () => {
    // ⚠ THE UNREACHABILITY EVERY OTHER MODULE RELIES ON. `electionsSearch` declines a
    // presidential place on the strength of this, and the hub's scope pill, „full result"
    // link and „other kind" link would each name a route that is not there.
    for (const e of ELECTION_EVENTS) {
      const r = resolveHubCycle(e.id);
      expect(
        KINDS_WITHOUT_SURFACE.includes(r.kind),
        `${e.id} resolved to ${r.kind}, which has no surface`,
      ).toBe(false);
    }
    // …and it is NOT vacuous: there really is a catalogued kind being withheld.
    expect(KINDS_WITHOUT_SURFACE.length).toBeGreaterThan(0);
    expect(
      ELECTION_EVENTS.some((e) => KINDS_WITHOUT_SURFACE.includes(e.kind)),
    ).toBe(true);
  });

  it("anchors the default and the fallback on an event it can OPEN", () => {
    // ⚠ THE PATH THE GUARD DID NOT COVER. `resolveHubCycle` checked the kind of the
    // MATCHED cycle only; both other exits returned `ELECTION_EVENTS[0]` whatever its
    // kind. The merge is sorted by date across three catalogues, so that becomes
    // presidential the moment the 2026-11 cycle is catalogued — and every reader arriving
    // with no param at all would get a „пълен резултат" link pointing at a 404.
    expect(KINDS_WITHOUT_SURFACE.includes(LATEST_RESOLVABLE_EVENT.kind)).toBe(
      false,
    );
    for (const r of [resolveHubCycle(null), resolveHubCycle("not-a-cycle")]) {
      expect(
        KINDS_WITHOUT_SURFACE.includes(r.kind),
        `${r.id} is a ${r.kind}, which has no surface`,
      ).toBe(false);
    }
    // …and it is the newest one that qualifies, not merely some resolvable one — so a
    // find that had started returning the OLDEST would fail here.
    const resolvable = ELECTION_EVENTS.filter(
      (e) => !KINDS_WITHOUT_SURFACE.includes(e.kind),
    );
    expect(LATEST_RESOLVABLE_EVENT.id).toBe(resolvable[0].id);
    // Today the two anchors coincide, because the newest event is parliamentary. Pinned so
    // the day they diverge is a decision rather than a surprise.
    expect(LATEST_ELECTION_EVENT.id).toBe(LATEST_RESOLVABLE_EVENT.id);
  });

  it("distinguishes an unknown cycle from one we simply cannot show yet", () => {
    // ⚠ TWO DIFFERENT STATEMENTS ABOUT THE READER'S SELECTION. „We did not recognise
    // 2021_11_14_pvr" is false — we publish a catalogue of it — and it asks the reader to
    // fix something that is on our side.
    const r = resolveHubCycle("2021_11_14_pvr");
    expect(r.id).toBe(LATEST_ELECTION_EVENT.id);
    expect(r.fellBack).toBe(true);
    expect(r.fellBackReason).toBe("no-surface");
    expect(r.requested).toBe("2021_11_14_pvr");
    // ⚠ And it carries the CYCLE, so the notice can name it without printing a folder id.
    expect(r.requestedCycle).toEqual({
      kind: "presidential",
      date: "2021-11-14",
    });
    // The control: a genuinely unknown value still reports `unknown`, so the two reasons
    // are not one reason under two names — and carries no cycle, because there is none.
    const unknown = resolveHubCycle("2021_11_14_zzz");
    expect(unknown.fellBackReason).toBe("unknown");
    expect(unknown.requestedCycle).toBeUndefined();
  });

  it("does NOT report an absent param as a fallback", () => {
    // ⚠ ARRIVING WITH NO PARAM IS THE ORDINARY CASE. Reporting it would put „we could not read
    // your selection" on the page on every first visit.
    for (const v of [undefined, null, ""]) {
      const r = resolveHubCycle(v);
      expect(r.fellBack, JSON.stringify(v)).toBe(false);
      expect(r.fellBackReason, JSON.stringify(v)).toBeUndefined();
      expect(r.requested, JSON.stringify(v)).toBeUndefined();
    }
  });
});

describe("CYCLE_SURFACE", () => {
  it("declares a prefix that agrees with its own href", () => {
    // ⚠ THE TWO USED TO BE ONE, AS `href("")`, AND THAT IS WHY THIS GATE EXISTS. Callers took
    // the prefix by calling `href` with an empty id — fine while every kind's URL was
    // `prefix + id`, and a crash the moment the presidential row started building through
    // `presidentialUrl`, which refuses an empty id. Declaring the prefix fixes the crash and
    // creates a second declaration; this is what stops the two drifting.
    for (const [kind, surface] of Object.entries(CYCLE_SURFACE)) {
      expect(surface.href("SOME_CYCLE"), kind).toBe(
        `${surface.prefix}SOME_CYCLE`,
      );
      // …and the prefix is a path, not a fragment of one.
      expect(surface.prefix.startsWith("/"), kind).toBe(true);
      expect(surface.prefix.endsWith("/"), kind).toBe(true);
    }
  });

  it("gives every kind a route pattern its own href satisfies", () => {
    for (const [kind, surface] of Object.entries(CYCLE_SURFACE)) {
      const re = new RegExp(
        `^/${surface.routePattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:[A-Za-z]+/g, "[^/]+")}$`,
      );
      expect(re.test(surface.href("2021_11_14_pvr")), kind).toBe(true);
    }
  });
});
