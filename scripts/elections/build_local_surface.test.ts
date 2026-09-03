// The local builder, against the corpus it will run on.
//
// ⚠ THE CENTRAL RULE IS THAT MAYOR AND COUNCIL ARE TWO BALLOTS WITH TWO DENOMINATORS. §2
// decision 4 states it and the corpus enforces it: `protocol.numValidVotes` is the COUNCIL's
// total in 289 of 289 municipalities and the mayor's in 0, and a polling station publishes both
// side by side (168 council against 201 mayor at Пазарджик 131900001). A surface that shares one
// denominator publishes one of the two races at the wrong scale, and every percentage on it is
// individually plausible — which is why these assertions run over the whole corpus.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as L from "./build_local_surface";
import {
  isWellFormedElectionSurfaceV1,
  surfaceCapViolations,
} from "../../src/data/elections/surfaceTypes";
import {
  SURFACE_BUDGET_BYTES,
  emittedLevels,
} from "../../src/data/elections/surfacePath";
import { PROSE_EXEMPT_FIELDS } from "../../src/data/elections/surfaceTypes";

const CYCLE = "2023_10_29_mi";
const hasCycle = fs.existsSync(path.join(L.DATA_ROOT, CYCLE, "index.json"));
const ctx: L.LocalContext = {
  cycle: CYCLE,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const municipalities = () =>
  L.municipalityCodes(CYCLE)
    .map((c) => L.readMunicipality(CYCLE, c))
    .filter((m): m is L.LocalMunicipality => m !== null)
    .map((m) => L.buildMunicipalitySurface(m, ctx));

describe("two ballots, two denominators (§2 decision 4)", () => {
  it.runIf(hasCycle)(
    "gives the mayor and the council their own valid-vote totals",
    () => {
      // ⚠ THE MEASUREMENT BEHIND THE RULE. In Пазарджик the council ran on 29,533 valid votes
      // and the mayor on 34,961 — an 18% difference. Sharing one figure misstates a race.
      let differing = 0;
      for (const s of municipalities()) {
        const mayor = s.ballots.find((b) => b.kind === "municipality_mayor");
        const council = s.ballots.find((b) => b.kind === "municipal_council");
        expect(council, `${s.place.id} has no council ballot`).toBeTruthy();
        if (!mayor) continue;
        expect(mayor.totals.validVotes).toBeGreaterThan(0);
        if (mayor.totals.validVotes !== council!.totals.validVotes) differing++;
      }
      // Non-vacuity: if the two agreed everywhere, this assertion would prove nothing.
      expect(
        differing,
        "the two ballots share a denominator everywhere — one of them is wrong",
      ).toBeGreaterThan(200);
    },
  );

  it.runIf(hasCycle)("never merges the two into one ballot", () => {
    for (const s of municipalities()) {
      const kinds = s.ballots.map((b) => b.kind);
      expect(new Set(kinds).size, s.place.id).toBe(kinds.length);
      expect(kinds, s.place.id).toContain("municipal_council");
    }
  });

  it.runIf(hasCycle)(
    "reads the COUNCIL's total from the protocol, never the mayor's",
    () => {
      // 289 of 289 vs 0 of 289 — the direction is what matters.
      let councilMatches = 0;
      let mayorMatches = 0;
      for (const code of L.municipalityCodes(CYCLE)) {
        const m = L.readMunicipality(CYCLE, code);
        if (!m) continue;
        const nv = m.protocol.numValidVotes ?? 0;
        const councilSum = (m.council ?? []).reduce(
          (a, r) => a + r.totalVotes,
          0,
        );
        const mayorSum = (m.mayor?.round1 ?? []).reduce(
          (a, r) => a + r.votes,
          0,
        );
        if (Math.abs(nv - councilSum) <= 2) councilMatches++;
        if (mayorSum > 0 && Math.abs(nv - mayorSum) <= 2) mayorMatches++;
      }
      expect(councilMatches).toBeGreaterThan(280);
      expect(mayorMatches).toBe(0);
    },
  );

  it.runIf(hasCycle)("keeps both denominators at a polling station too", () => {
    // The level that PROVES the rule: the corpus publishes `numValidVotes` and `mayorValid`
    // side by side, so a shared denominator here is contradicted by the source itself.
    const f = L.readLocalSection(
      path.join(L.DATA_ROOT, CYCLE, "sections", "PAZ19", "131900001.json"),
    );
    const s = L.buildLocalSectionSurface(f, ctx);
    const mayor = s.ballots.find((b) => b.kind === "municipality_mayor")!;
    const council = s.ballots.find((b) => b.kind === "municipal_council")!;
    expect(mayor.totals.validVotes).toBe(f.section.mayorValid);
    expect(council.totals.validVotes).toBe(f.section.numValidVotes);
    expect(mayor.totals.validVotes).not.toBe(council.totals.validVotes);
  });

  it.runIf(hasCycle)(
    "names the ballot on every fact that belongs to one",
    () => {
      // A mayoral margin beside a council seat count with nothing saying which is which is the
      // merge §2 decision 4 forbids, done one component later.
      for (const s of municipalities())
        for (const f of s.facts) {
          if (f.code === "turnout" || f.code === "split_control") continue;
          expect(
            f.ballot,
            `${s.place.id}/${f.code} does not name its ballot`,
          ).toBeTruthy();
        }
    },
  );
});

describe("the decisive round", () => {
  it.runIf(hasCycle)("headlines round 2 wherever one was held", () => {
    // ⚠ READING ROUND 1 AS THE RESULT names the leader of a race that did not end there.
    let runoffs = 0;
    for (const code of L.municipalityCodes(CYCLE)) {
      const m = L.readMunicipality(CYCLE, code);
      if (!m || !m.mayor?.round2?.length) continue;
      runoffs++;
      const s = L.buildMunicipalitySurface(m, ctx);
      const mayor = s.ballots.find((b) => b.kind === "municipality_mayor")!;
      expect(mayor.round, code).toBe(2);
      // …and the elected candidate is in the preview, marked.
      const elected = mayor.preview.filter((e) => e.isElected);
      expect(
        elected.length,
        `${code} marks ${elected.length} winners`,
      ).toBeLessThanOrEqual(1);
    }
    expect(
      runoffs,
      "no runoff in the corpus — the rule is untested",
    ).toBeGreaterThan(20);
  });

  it("falls back to round 1 when no second round was held", () => {
    const d = L.decisiveMayorRound({
      round1: [
        {
          candidateName: "A",
          localPartyNum: 1,
          round: 1,
          votes: 10,
          pctOfValid: 50,
        },
      ],
    });
    expect(d).toEqual({ round: 1, rows: expect.any(Array) });
  });

  it("returns null when the corpus covers no mayoral race", () => {
    // An absence, never an unelected office.
    expect(L.decisiveMayorRound(undefined)).toBeNull();
    expect(L.decisiveMayorRound({ round1: [], round2: [] })).toBeNull();
  });
});

describe("split control — a claim about who runs a council", () => {
  it("needs BOTH parties, and reports nothing when either is missing", () => {
    // ⚠ RETURNING TRUE BECAUSE ONE SIDE IS NULL reports "split control" wherever a party could
    // not be resolved — a claim about a named council derived from a missing value. 44 of 289
    // municipalities have no canonical party for their elected mayor.
    expect(L.isSplitControl(null, "gerb")).toBe(false);
    expect(L.isSplitControl("gerb", null)).toBe(false);
    expect(L.isSplitControl(undefined, undefined)).toBe(false);
    expect(L.isSplitControl("gerb", "gerb")).toBe(false);
    expect(L.isSplitControl("gerb", "bsp")).toBe(true);
  });

  it.runIf(hasCycle)("stays rare enough to be a finding (§7)", () => {
    // §7 keeps this signal only because it is rare. Measured HERE: 28 of the 241 municipalities
    // carrying both a mayor party and a council lead party (11.6%). The methodology records 32
    // of 245 (13.1%) from a different derivation of the mayor's party; the conclusion — rare,
    // therefore reportable — is the same, and the ceiling is a third.
    let both = 0;
    let split = 0;
    for (const code of L.municipalityCodes(CYCLE)) {
      const m = L.readMunicipality(CYCLE, code);
      if (!m) continue;
      const mp = m.mayor?.elected?.primaryCanonicalId ?? null;
      const cp =
        [...(m.council ?? [])].sort((a, b) => b.totalVotes - a.totalVotes)[0]
          ?.primaryCanonicalId ?? null;
      if (!mp || !cp) continue;
      both++;
      if (mp !== cp) split++;
    }
    expect(both).toBeGreaterThan(200);
    expect(split / both).toBeLessThan(1 / 3);
    expect(
      split,
      "split control fires nowhere — the signal is dead",
    ).toBeGreaterThan(10);
  });
});

describe("settlement surfaces", () => {
  it.runIf(hasCycle)(
    "omits a kmetstvo whose settlement cannot be resolved",
    () => {
      // ⚠ 0 of 3,032 KMETSTVO RACES CARRY AN EKATTE, so they are resolved through the committed
      // map the site already uses. 43 do not resolve — guessing one would publish a village's
      // mayoral result under a different village's page.
      const map = L.loadKmetstvoEkatte();
      expect(map.size).toBeGreaterThan(2_500);
      let races = 0;
      let resolved = 0;
      for (const code of L.municipalityCodes(CYCLE)) {
        const m = L.readMunicipality(CYCLE, code);
        if (!m) continue;
        races += (m.kmetstva ?? []).length;
        resolved += L.settlementRacesOf(m, map).length;
      }
      expect(races).toBeGreaterThan(3_000);
      expect(resolved).toBeLessThan(races);
      expect(
        races - resolved,
        "every kmetstvo resolved — the guard is untested",
      ).toBeGreaterThan(0);
    },
  );

  it.runIf(hasCycle)(
    "never attributes the parent council as a settlement office",
    () => {
      // §"Data gates". A kmetstvo elects a mayor and no council.
      const map = L.loadKmetstvoEkatte();
      const m = L.readMunicipality(CYCLE, "PAZ19")!;
      const races = L.settlementRacesOf(m, map);
      expect(races.length).toBeGreaterThan(0);
      for (const r of races) {
        const s = L.buildSettlementSurface({ obshtina: "PAZ19", ...r }, ctx);
        expect(
          s.ballots.map((b) => b.kind),
          r.ekatte,
        ).not.toContain("municipal_council");
      }
    },
  );

  it.runIf(hasCycle)(
    "publishes no turnout where there is no denominator",
    () => {
      // A kmetstvo has no protocol of its own in this corpus. An absence, not a zero.
      const map = L.loadKmetstvoEkatte();
      const m = L.readMunicipality(CYCLE, "PAZ19")!;
      const r = L.settlementRacesOf(m, map)[0];
      const s = L.buildSettlementSurface({ obshtina: "PAZ19", ...r }, ctx);
      expect(s.ballots[0].totals.turnoutBasis).toBe("unavailable");
      expect(s.facts.map((f) => f.code)).not.toContain("turnout");
    },
  );
});

describe("who was elected — the claim that names a person", () => {
  it.runIf(hasCycle)("names at most ONE winner per settlement race", () => {
    // ⚠⚠ 441 OF 2,989 SETTLEMENT SURFACES NAMED TWO. `isElected` on a ROUND-1 row means the
    // candidate was elected TO the runoff, not to the office, so copying the flag published 445
    // named people as elected village mayors who were not — in Дрянковец it marked Павел
    // Валентинов Касабов alongside the real winner Мухарем Бейямин Ахмед.
    const map = L.loadKmetstvoEkatte();
    let races = 0;
    let multi = 0;
    for (const code of L.municipalityCodes(CYCLE)) {
      const m = L.readMunicipality(CYCLE, code);
      if (!m) continue;
      for (const r of L.settlementRacesOf(m, map)) {
        const s = L.buildSettlementSurface({ obshtina: code, ...r }, ctx);
        races++;
        const won = (s.ballots[0]?.preview ?? []).filter((e) => e.isElected);
        expect(won.length, `${r.ekatte} ${r.kmetstvoName}`).toBeLessThanOrEqual(
          1,
        );
        if (won.length > 1) multi++;
        // …and when the corpus names a winner, it is THAT person.
        if (r.elected && won.length === 1)
          expect(won[0].candidateName, r.ekatte).toBe(r.elected.candidateName);
      }
    }
    expect(races).toBeGreaterThan(2_500);
    expect(multi).toBe(0);
  });

  it("marks the corpus's elected candidate, not the row's own flag", () => {
    // The unit form of the same rule: both finalists flagged, one `elected` record.
    const rows: L.LocalMayorRow[] = [
      {
        candidateName: "A",
        localPartyNum: 1,
        round: 1,
        votes: 60,
        pctOfValid: 40,
        isElected: true,
      },
      {
        candidateName: "B",
        localPartyNum: 2,
        round: 1,
        votes: 50,
        pctOfValid: 33,
        isElected: true,
      },
    ];
    const s = L.buildSettlementSurface(
      {
        ekatte: "1",
        obshtina: "X",
        kmetstvoName: "K",
        candidates: rows,
        elected: rows[1],
      },
      ctx,
    );
    const won = s.ballots[0].preview.filter((e) => e.isElected);
    expect(won.map((e) => e.candidateName)).toEqual(["B"]);
  });
});

describe("a round-2 ballot carries no round-1 turnout", () => {
  it.runIf(hasCycle)("suppresses turnout on every runoff mayor ballot", () => {
    // ⚠ THE MUNICIPALITY PROTOCOL IS THE FIRST-ROUND DAY — it reproduces the section sums
    // exactly — so attaching its rate to the round that decided the office publishes the wrong
    // day's participation. 111 of 113 runoff municipalities did. Пловдив's round 2 drew ~30%
    // fewer voters than the 34.02% the round-1 protocol reports.
    let runoffs = 0;
    for (const code of L.municipalityCodes(CYCLE)) {
      const m = L.readMunicipality(CYCLE, code);
      if (!m?.mayor?.round2?.length) continue;
      runoffs++;
      const s = L.buildMunicipalitySurface(m, ctx);
      const mayor = s.ballots.find((b) => b.kind === "municipality_mayor")!;
      expect(mayor.round).toBe(2);
      expect(mayor.totals.turnoutBasis, code).toBe("unavailable");
    }
    expect(runoffs).toBeGreaterThan(100);
  });

  it.runIf(hasCycle)(
    "still publishes turnout on a single-round mayor ballot",
    () => {
      // The other half: suppressing everywhere would be its own defect.
      let single = 0;
      let withRate = 0;
      for (const code of L.municipalityCodes(CYCLE)) {
        const m = L.readMunicipality(CYCLE, code);
        if (!m || m.mayor?.round2?.length) continue;
        const mayor = L.buildMunicipalitySurface(m, ctx).ballots.find(
          (b) => b.kind === "municipality_mayor",
        );
        if (!mayor) continue;
        single++;
        if (mayor.totals.turnoutBasis === "registered_voters") withRate++;
      }
      expect(single).toBeGreaterThan(100);
      expect(
        withRate,
        "no single-round mayor ballot has a turnout",
      ).toBeGreaterThan(100);
    },
  );
});

describe("`independent` is a sentinel, not a party", () => {
  it("never reports split control against it", () => {
    // ⚠ THE CORPUS USES IT AS A CANONICAL ID 18 TIMES. Treating it as a party published
    // "разделено управление" about municipalities whose mayor stands for nobody — 3 of the 28
    // the signal fired on, and self-contradicting inside one artifact, since the preview
    // already renders `partyId: null` for the same candidate.
    expect(L.NON_PARTY_IDS.has("independent")).toBe(true);
    expect(L.isSplitControl("independent", "gerb")).toBe(false);
    expect(L.isSplitControl("gerb", "independent")).toBe(false);
    expect(L.isSplitControl("gerb", "bsp")).toBe(true);
  });

  it.runIf(hasCycle)("never emits it as a partyId either", () => {
    for (const s of municipalities())
      for (const b of s.ballots)
        for (const e of b.preview)
          expect(e.partyId, `${s.place.id} ${b.kind}`).not.toBe("independent");
  });
});

describe("a seat count is not a vote share", () => {
  it.runIf(hasCycle)(
    "publishes no vote percentage a region source cannot support",
    () => {
      // ⚠ ГЕРБ IN ВАРНА READ 40.18 AGAINST A TRUE 23.17%. The region source carries seats and no
      // per-party votes, so a seat share in the vote-share field overstated by 17 points on a
      // ballot whose own validVotes (141,998) made it checkable.
      for (const o of L.regionCodes(CYCLE)) {
        const r = L.readRegion(CYCLE, o);
        if (!r) continue;
        const s = L.buildRegionSurface(r, ctx);
        for (const e of s.ballots[0].preview) {
          expect(e.pct, `${o} publishes a vote share`).toBe(0);
          expect(e.seats, `${o} lost its seat count`).toBeGreaterThan(0);
        }
      }
    },
  );

  it.runIf(hasCycle)(
    "gives the country a seat COUNT under the seats code",
    () => {
      // `election_fact_seats` renders "Места"/"Seats", so a percentage there reads "Места: 23.95%".
      const c = L.buildCountrySurface(
        L.readIndex(CYCLE)!,
        ctx,
        L.nationalSeatsByParty(CYCLE),
      );
      const seats = c.facts.find((f) => f.code === "seats");
      expect(seats?.unit).toBe("seats");
      expect(seats!.value).toBeGreaterThan(100);
      expect(Number.isInteger(seats!.value)).toBe(true);
      // …and the mayoral headline is a COUNT of offices, never a share of anything.
      const winner = c.facts.find((f) => f.code === "winner")!;
      expect(winner.unit).toBe("count");
      expect(winner.ballot).toBe("municipality_mayor");
    },
  );

  it.runIf(hasCycle)(
    "omits the seats fact rather than inventing a zero",
    () => {
      const c = L.buildCountrySurface(L.readIndex(CYCLE)!, ctx);
      expect(c.facts.some((f) => f.code === "seats")).toBe(false);
    },
  );
});

describe("shape, budget and determinism", () => {
  it.runIf(hasCycle)("has a builder for every level the policy emits", () => {
    const builders: Record<string, unknown> = {
      country: L.buildCountrySurface,
      region: L.buildRegionSurface,
      municipality: L.buildMunicipalitySurface,
      settlement: L.buildSettlementSurface,
    };
    for (const level of emittedLevels("local"))
      expect(builders[level], `no builder for local/${level}`).toBeTypeOf(
        "function",
      );
  });

  it.runIf(hasCycle)("emits every level well-formed and inside budget", () => {
    const check = (s: unknown, label: string, budget: number) => {
      expect(isWellFormedElectionSurfaceV1(s), label).toBe(true);
      expect(
        surfaceCapViolations(s as Parameters<typeof surfaceCapViolations>[0]),
        label,
      ).toEqual([]);
      const bytes = Buffer.byteLength(JSON.stringify(s));
      expect(bytes, `${label} is ${bytes} B`).toBeLessThanOrEqual(budget);
    };
    check(
      L.buildCountrySurface(L.readIndex(CYCLE)!, ctx),
      "country",
      SURFACE_BUDGET_BYTES.country,
    );
    let regions = 0;
    for (const o of L.regionCodes(CYCLE)) {
      const r = L.readRegion(CYCLE, o);
      if (!r) continue;
      regions++;
      check(
        L.buildRegionSurface(r, ctx),
        `region/${o}`,
        SURFACE_BUDGET_BYTES.region,
      );
    }
    expect(regions).toBeGreaterThan(25);
    const munis = municipalities();
    expect(munis.length).toBeGreaterThan(280);
    for (const s of munis)
      check(s, `municipality/${s.place.id}`, SURFACE_BUDGET_BYTES.municipality);
  });

  it.runIf(hasCycle)(
    "embeds every polling station inside the section budget",
    () => {
      let n = 0;
      let max = 0;
      for (const ob of L.sectionObshtini(CYCLE))
        for (const file of L.sectionFilesOf(CYCLE, ob)) {
          const s = L.buildLocalSectionSurface(L.readLocalSection(file), ctx);
          n++;
          const bytes = Buffer.byteLength(JSON.stringify(s));
          max = Math.max(max, bytes);
          expect(isWellFormedElectionSurfaceV1(s), file).toBe(true);
          expect(bytes, `${file} is ${bytes} B`).toBeLessThanOrEqual(
            SURFACE_BUDGET_BYTES.section,
          );
        }
      expect(n).toBeGreaterThan(12_000);
      expect(max).toBeLessThan(SURFACE_BUDGET_BYTES.section);
    },
  );

  it.runIf(hasCycle)("rebuilds byte-identically (§9)", () => {
    expect(JSON.stringify(municipalities())).toBe(
      JSON.stringify(municipalities()),
    );
  });

  it.runIf(hasCycle)(
    "carries a reconciliation iff the cycle ships a sidecar (§5)",
    () => {
      let withSidecar = 0;
      for (const s of municipalities()) {
        const has = fs.existsSync(
          path.join(L.DATA_ROOT, CYCLE, "officials_diff", `${s.place.id}.json`),
        );
        expect(Boolean(s.status.reconciliation), s.place.id).toBe(has);
        if (has) withSidecar++;
      }
      expect(withSidecar).toBeGreaterThan(200);
    },
  );

  // ⚠ EVERY LEVEL THE GENERATOR EMITS, NOT JUST THE MUNICIPALITY ONE. This gate read
  // convincingly and ran on one of three: the country and region builders pass the local
  // corpus's bucket id straight through, and that id IS the party's lowercased Bulgarian name
  // (`local:движение заедно за промяна`) — 51 of the corpus's 122 distinct party ids, 108
  // preview rows, one of them a person's name. A gate that skips the levels where the producer
  // differs is the vacuous-coverage shape, and it survived because the level it did cover
  // resolves `primaryCanonicalId`, which is null rather than name-bearing when absent.
  const everyLevel = () => [
    ...municipalities(),
    ...L.regionCodes(CYCLE)
      .map((o) => L.readRegion(CYCLE, o))
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .map((r) => L.buildRegionSurface(r, ctx)),
    L.buildCountrySurface(
      L.readIndex(CYCLE)!,
      ctx,
      L.nationalSeatsByParty(CYCLE),
    ),
  ];

  /** Strip the values of the fields §5.3 exempts — read from the shared list, so a third
   *  exception cannot be introduced by a generator without appearing there. */
  const withoutExemptProse = (s: unknown): string => {
    let blob = JSON.stringify(s);
    const collect = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.flatMap(collect)
        : v && typeof v === "object"
          ? Object.entries(v as Record<string, unknown>).flatMap(([k, x]) =>
              PROSE_EXEMPT_FIELDS.includes(
                k as (typeof PROSE_EXEMPT_FIELDS)[number],
              ) && typeof x === "string"
                ? [x]
                : collect(x),
            )
          : [];
    for (const n of new Set(collect(s))) if (n) blob = blob.split(n).join("");
    return blob;
  };

  it.runIf(hasCycle)("carries no prose — codes and ids only (§5.2)", () => {
    // ⚠ A CANDIDATE'S NAME IS ONE EXCEPTION and a local-only list's own name is the other; both
    // are deliberate (§5.3), Bulgarian in BOTH languages, and both are named in
    // `PROSE_EXEMPT_FIELDS` so the exemption is a decision rather than a silent pass.
    for (const s of everyLevel())
      expect(withoutExemptProse(s), s.place.id).not.toMatch(/[Ѐ-ӿ]/);
  });

  it.runIf(hasCycle)("never smuggles a name through an ID (§5.3)", () => {
    // The specific shape the level gap hid: `partyId` and a fact's `labelParams.partyId` must
    // name a party the renderer can resolve, and `local:<name>` is not one — it resolves to no
    // label in EITHER language while looking like a perfectly good id.
    for (const s of everyLevel()) {
      for (const b of s.ballots)
        for (const e of b.preview) {
          expect(e.partyId ?? "", `${s.place.id} ${b.kind}`).not.toMatch(
            /^local:/,
          );
          // …and when there is no canonical party, the name is in the field that says so.
          if (e.partyId === null && e.localPartyName)
            expect(e.localPartyName).not.toMatch(/^local:/);
        }
      for (const f of s.facts)
        expect(
          String(f.labelParams?.partyId ?? ""),
          `${s.place.id} fact ${f.code}`,
        ).not.toMatch(/^local:/);
    }
  });

  it.runIf(hasCycle)("names a local-only list rather than dropping it", () => {
    // ⚠ NON-VACUITY. „no `local:` ids" is satisfiable by emitting nothing at all, so the rows
    // must still be there — a region whose whole council is local lists would otherwise
    // publish an unlabelled ranking. Measured on this cycle: 39 named rows reach a preview
    // (108 across the three published cycles), so the floor sits well under it and moves only
    // if the builders start dropping them.
    const named = everyLevel().flatMap((s) =>
      s.ballots.flatMap((b) =>
        b.preview.filter((e) => e.partyId === null && e.localPartyName),
      ),
    );
    expect(named.length).toBeGreaterThan(30);
    for (const e of named) expect(e.localPartyName).toMatch(/[Ѐ-ӿ]/);
  });
});
