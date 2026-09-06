// The ticket↔person map, as a set of PUBLISHED CLAIMS ABOUT NAMED INDIVIDUALS.
//
// ⚠⚠ EVERY LINK IN THIS FILE ASSERTS THAT A PRESIDENTIAL CANDIDATE AND A PROFILE ARE THE SAME
// PERSON. Getting one wrong attributes an election — and everything else on that profile:
// declared wealth, company roles, sanctions facets — to somebody who merely shares a name.
// So the gate's job is mostly to prove the REFUSAL still refuses: a resolver that had quietly
// started picking a "best match" would look identical in the committed file except for having
// more links, which is exactly what a reviewer reads as an improvement.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { allRows, dbReachable, end } from "../db/lib/pg";
import { reportSkip } from "../lib/report_skip";
import {
  presidentialCycles,
  resolveTicketPersons,
  ticketNames,
  type TicketPersonLink,
} from "./build_ticket_persons";

const ROOT = process.cwd();
const MAP_FILE = path.join(ROOT, "data", "presidential", "ticket_persons.json");

const readMap = (): Record<string, TicketPersonLink> =>
  (
    JSON.parse(fs.readFileSync(MAP_FILE, "utf8")) as {
      links: Record<string, TicketPersonLink>;
    }
  ).links;

describe("the committed ticket↔person map", () => {
  it("exists — it is COMMITTED, so its absence is a broken working copy", () => {
    // The presidential tree has no database, so this file IS the link. Without it every
    // candidate on every presidential page renders as plain text with nothing saying why.
    expect(fs.existsSync(MAP_FILE), `${MAP_FILE} is missing`).toBe(true);
  });

  it("links a name to at most one person, and never a shared one", () => {
    // ⚠ THE INVARIANT THE WHOLE DESIGN RESTS ON. `candidates > 1` with a slug means the
    // resolver picked one of several people — the defect this exists to prevent.
    for (const [name, l] of Object.entries(readMap())) {
      if (l.slug) expect(l.candidates, name).toBe(1);
      else expect(l.reason, name).toMatch(/^(not_found|ambiguous)$/);
    }
  });

  it("still REFUSES a meaningful number of names", () => {
    // ⚠ NON-VACUITY, AND THE ONE THAT MATTERS. A resolver that started scoring candidates
    // would produce a file with MORE links and no ambiguous entries — which reads as an
    // improvement. Measured 2026-09-06: 140 names, 78 linked, 17 ambiguous, 45 not found.
    const links = Object.values(readMap());
    expect(links.length).toBeGreaterThan(100);
    expect(
      links.filter((l) => l.reason === "ambiguous").length,
    ).toBeGreaterThan(5);
    expect(links.filter((l) => l.slug).length).toBeGreaterThan(30);
  });

  it("names every person on every ballot — both halves of the pair", () => {
    // A vice-president is a named office-holder with a profile of their own; covering only
    // presidents would leave half the ballot unlinkable with nothing saying so.
    const map = readMap();
    for (const name of ticketNames()) expect(map[name], name).toBeDefined();
  });

  it("separates the two refusals rather than collapsing them", () => {
    // ⚠ „nobody by that name" and „several people by that name" are different statements about
    // a named individual, and only the second warrants a warning on the page. A gate that
    // checked only „no slug" would pass on an implementation that reported every refusal as
    // `not_found` — which is what the two-part fallback originally did to 2006's winning
    // president, whose two-part spelling three public figures share.
    const links = Object.values(readMap());
    expect(
      links.filter((l) => l.reason === "not_found").length,
    ).toBeGreaterThan(5);
    for (const l of links) {
      if (l.reason === "ambiguous")
        expect(l.candidates, l.name).toBeGreaterThan(1);
      if (l.reason === "not_found") expect(l.candidates, l.name).toBe(0);
    }
  });

  it("carries no entry for a name no ballot prints", () => {
    // The other direction: a stale entry is a link the corpus can no longer justify.
    const names = new Set(ticketNames());
    const stale = Object.keys(readMap()).filter((n) => !names.has(n));
    expect(stale.slice(0, 5)).toEqual([]);
  });
});

const skipNoDb = !(await dbReachable())
  ? "Postgres unreachable — the person layer cannot be re-resolved"
  : false;
if (skipNoDb) reportSkip(import.meta.url, skipNoDb);

describe.skipIf(skipNoDb)("the map against the live person layer", () => {
  it("still resolves to what the committed file says", async () => {
    // ⚠ THE COMMITTED FILE IS A SNAPSHOT of a layer that moves — `db:resolve:persons`
    // re-mints slugs. This is what says „re-run the builder", and it is the only thing that
    // can: nothing else compares the two.
    const names = ticketNames();
    const live = await resolveTicketPersons(names);
    const map = readMap();
    const drifted = names.filter(
      (n) =>
        (live[n]?.slug ?? null) !== (map[n]?.slug ?? null) ||
        live[n]?.candidates !== map[n]?.candidates,
    );
    expect(
      drifted.slice(0, 5),
      `${drifted.length} name(s) resolve differently now — re-run ` +
        "`npx tsx scripts/parsers_presidential/build_ticket_persons.ts --write`",
    ).toEqual([]);
    await end();
  });

  it("still refuses what a WIDENED gate would link — the mutation check", async () => {
    // ⚠⚠ THE ASSERTION ABOVE COMPARES THE BUILDER AGAINST ITSELF, and its failure message
    // says „re-run the builder" — so a resolver that quietly dropped `is_public_figure`, or
    // started picking a best match, produces a file with MORE links and a green suite the
    // moment someone follows that instruction. This runs the widened query directly and
    // requires that it would link names the committed map refuses: if it would not, the
    // refusal is no longer doing anything and the gate above is measuring nothing.
    const map = readMap();
    // ⚠ EACH REFUSAL IS RE-RUN ON THE KEY IT WAS DECIDED ON. The two-part ballot spellings are
    // refused on the BLOCK key and match NOTHING on the full fold, so a single fold query
    // would find them absent and read that as „the refusal is doing nothing".
    const refused = Object.entries(map).filter(
      ([, l]) => l.reason === "ambiguous",
    );
    expect(refused.length).toBeGreaterThan(5);
    const byBasis = {
      fold: refused.filter(([, l]) => l.basis !== "block").map(([n]) => n),
      block: refused.filter(([, l]) => l.basis === "block").map(([n]) => n),
    };
    const KEY = {
      fold: "p.name_fold = translit_bg_latin(t.name)",
      block: `p.given_fold = translit_bg_latin(split_part(t.name, ' ', 1))
              AND p.family_fold = translit_bg_latin(
                    split_part(t.name, ' ', array_length(string_to_array(t.name, ' '), 1)))`,
    };
    for (const basis of ["fold", "block"] as const) {
      const names = byBasis[basis];
      if (!names.length) continue;
      const rows = await allRows<{ name: string; n: string }>(
        `SELECT t.name, count(*)::text AS n
           FROM unnest($1::text[]) AS t(name)
           JOIN person p ON ${KEY[basis]}
            AND p.is_public_figure AND p.status = 'active'
          GROUP BY t.name`,
        [names],
      );
      // Every refused name really does have more than one servable public figure behind it —
      // so „refuse" is a decision about the corpus, not a query returning nothing.
      for (const r of rows)
        expect(Number(r.n), `${basis}: ${r.name}`).toBeGreaterThan(1);
      expect(rows.length, basis).toBe(names.length);
    }
    // Both keys are exercised, so neither arm can go quietly empty.
    expect(byBasis.fold.length).toBeGreaterThan(5);
    expect(byBasis.block.length).toBeGreaterThan(0);
    await end();
  });
});

describe("the corpus this reads", () => {
  it("covers every ingested cycle, and each one contributes names", () => {
    // ⚠ A TOTAL FLOOR CANNOT SEE A CYCLE VANISH. 140 names across five ballots means one whole
    // cycle can drop out — its 6 to 23 candidates unlinked with nothing saying why — and
    // `> 100` stays green. The per-cycle floor is what catches it; the smallest ballot in the
    // corpus is 2001's six pairs, i.e. at most twelve names.
    const cycles = presidentialCycles();
    expect(cycles.length).toBeGreaterThanOrEqual(5);
    const map = readMap();
    for (const cycle of cycles) {
      const file = path.join(ROOT, "data", cycle, "tickets.json");
      const { tickets } = JSON.parse(fs.readFileSync(file, "utf8")) as {
        tickets: { president: string; vicePresident: string }[];
      };
      expect(tickets.length, cycle).toBeGreaterThanOrEqual(6);
      for (const t of tickets) {
        expect(
          map[t.president.trim()],
          `${cycle}: ${t.president}`,
        ).toBeDefined();
        expect(
          map[t.vicePresident.trim()],
          `${cycle}: ${t.vicePresident}`,
        ).toBeDefined();
      }
    }
    expect(ticketNames().length).toBeGreaterThan(100);
  });
});
