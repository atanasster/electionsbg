// Geo-overlay integrity + coverage harness for the chat's map answers.
// Run: npx tsx ai/tools/geo.harness.ts   (part of `npm run ai:test:all`)
//
// Two jobs in one pass over a probe per geographic tool:
//   1. INTEGRITY (hard fail) — for every tool whose envelope carries an
//      `Envelope.geo`, assert the overlay actually renders: level↔joinKey match,
//      the geojson source(s) load, EVERY area/focus code joins to a real feature
//      (the join is what makes the map appear — a typo leaves a blank country),
//      and the colour contract holds (ramp ⇒ numeric values, explicit ⇒ colours).
//   2. COVERAGE (audit, soft) — print which geographic tools ship a map and which
//      don't yet, so map gaps are visible as the feature is wired out.
//
// Auto-discovering: it inspects whatever `geo` each tool returns at runtime, so
// newly-wired maps are validated automatically — no per-map test to remember.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setFetcher } from "./dataClient";
import { runTool, TOOLS } from "./registry";
import type { Envelope, GeoOverlay, Lang, ToolArgs, ToolDef } from "./types";

setFetcher(async (path: string) => {
  const rel = path.startsWith("/") ? path.slice(1) : path;
  return JSON.parse(await readFile(join(process.cwd(), "data", rel), "utf8"));
});

let failures = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    failures += 1;
    console.log(`    ✗ FAIL ${msg}`);
  }
};

// level → the geojson feature property that carries the join code.
const LEVEL_JOINKEY: Record<GeoOverlay["level"], GeoOverlay["joinKey"]> = {
  oblast: "nuts3",
  municipality: "nuts4",
  settlement: "ekatte",
};
// Abroad (МИР "32") has no polygon in ANY source — a documented silent skip.
// (The previously-known Sofia "SOF00" / Plovdiv "PDV22" gaps are now fixed in
// geo.ts — synthetic-Sofia district expansion + the PDV city-МИР sibling source —
// so every other unjoined code is a genuine FAIL.)
const NO_POLYGON = new Set(["32"]);

// Distinct join codes present across a geojson source (or array of sources).
const codesCache = new Map<string, Promise<Set<string>>>();
const codesFor = (
  source: string | string[],
  joinKey: string,
): Promise<Set<string>> => {
  const sources = Array.isArray(source) ? source : [source];
  const key = `${joinKey}::${sources.join("|")}`;
  let p = codesCache.get(key);
  if (!p) {
    p = (async () => {
      const set = new Set<string>();
      for (const s of sources) {
        const rel = s.startsWith("/") ? s.slice(1) : s;
        const fc = JSON.parse(
          await readFile(join(process.cwd(), "data", rel), "utf8"),
        ) as { features?: { properties?: Record<string, unknown> }[] };
        for (const f of fc.features ?? []) {
          const c = f.properties?.[joinKey];
          if (c != null) set.add(String(c));
        }
      }
      return set;
    })();
    codesCache.set(key, p);
  }
  return p;
};

// Validate one overlay against the on-disk geojson. Returns a one-line summary
// (for the coverage table) and records every integrity failure via ok().
const validate = async (label: string, geo: GeoOverlay): Promise<string> => {
  ok(
    LEVEL_JOINKEY[geo.level] === geo.joinKey,
    `${label}: level "${geo.level}" wants joinKey "${LEVEL_JOINKEY[geo.level]}", got "${geo.joinKey}"`,
  );
  ok(geo.areas.length > 0, `${label}: overlay has no areas`);

  let codes: Set<string>;
  try {
    codes = await codesFor(geo.source, geo.joinKey);
  } catch (e) {
    ok(false, `${label}: source load failed (${(e as Error).message})`);
    return "source MISSING";
  }
  ok(codes.size > 0, `${label}: source "${geo.source}" has zero features`);

  const joinable = (c: string) => codes.has(c) || NO_POLYGON.has(c);
  // Every área code must join to a real feature — a non-joining code renders blank.
  const unjoined = [...new Set(geo.areas.map((a) => a.code))].filter(
    (c) => !joinable(c),
  );
  ok(
    unjoined.length === 0,
    `${label}: ${unjoined.length} area code(s) don't join → ${unjoined.slice(0, 10).join(", ")}`,
  );

  const focus = geo.focus ?? [];
  const unfocused = focus.filter((c) => !joinable(c));
  ok(
    unfocused.length === 0,
    `${label}: focus code(s) don't join → ${unfocused.join(", ")}`,
  );

  if (geo.mode === "choropleth") {
    if (geo.colorMode === "explicit") {
      const noColor = geo.areas.filter((a) => !a.color).length;
      ok(
        noColor === 0,
        `${label}: explicit choropleth has ${noColor} area(s) with no colour`,
      );
    } else {
      const numeric = geo.areas.filter(
        (a) => typeof a.value === "number",
      ).length;
      ok(
        numeric > 0,
        `${label}: ramp choropleth has no area with a numeric value`,
      );
    }
  }

  const matched = geo.areas.filter((a) => joinable(a.code)).length;
  return `${geo.level}/${geo.mode}${geo.colorMode ? `(${geo.colorMode})` : ""} · ${matched}/${geo.areas.length} joined`;
};

// Auto-fill a tool's args from its declared param TYPES, so the harness covers
// every map tool the registry exposes — including ones wired after this file was
// written — without a per-tool probe to maintain. Optional election/cycle/count/
// year are left unset (use the tool's own defaults; a bare election would also
// risk a multi-ballot-year fan-out).
const ARG_BY_TYPE: Record<string, string> = {
  party: "ГЕРБ",
  person: "Бойко Борисов",
  place: "Пловдив",
  oblast: "Пловдив",
  region: "Пловдив",
  indicator: "безработица",
  metric: "безработица",
};
const fillArgs = (tool: ToolDef): ToolArgs => {
  const args: ToolArgs = {};
  for (const p of tool.params) {
    const v = ARG_BY_TYPE[p.type];
    if (v !== undefined) args[p.name] = v;
  }
  return args;
};

// A tool is a MAP CANDIDATE (so a missing map is a reported gap) if it takes a
// place/oblast/region arg, or is one of these param-less-but-geographic tools.
const GEO_PARAM = new Set(["place", "oblast", "region"]);
const PARAMLESS_GEO = new Set([
  "nationalResults",
  "turnout",
  "wastedVotes",
  "diasporaVote",
  "localMayorsWon",
  "localCouncilVoteShare",
  "problemSections",
  "suspiciousSettlements",
  "riskScore",
  "riskClusters",
]);
// The two anchor maps: if EITHER ever stops emitting a valid overlay, fail hard.
const MAP_EXPECTED = new Set(["nationalResults", "regionBreakdown"]);

const run = async () => {
  const LANGS: Lang[] = ["bg", "en"];
  const withMap: string[] = [];
  const noMap: string[] = [];
  const errored: string[] = [];

  console.log(`=== geo overlay integrity (${TOOLS.length} tools, bg + en) ===`);
  for (const tool of TOOLS) {
    const args = fillArgs(tool);
    const isCandidate =
      tool.params.some((p) => GEO_PARAM.has(p.type)) ||
      PARAMLESS_GEO.has(tool.name);
    let anyGeo = false;
    let summary = "";
    let err = "";
    for (const lang of LANGS) {
      let env: Envelope;
      try {
        env = (await runTool(tool.name, args, {
          lang,
          election: "2026_04_19",
        })) as Envelope;
      } catch (e) {
        err = e instanceof Error ? e.message : String(e);
        continue;
      }
      if (env.geo) {
        anyGeo = true;
        // validate BOTH languages so a lang-specific label/area bug is caught
        summary = await validate(`${tool.name}[${lang}]`, env.geo);
      }
    }
    if (anyGeo) {
      withMap.push(tool.name);
      console.log(`  ✓ ${tool.name.padEnd(24)} ${summary}`);
    } else if (MAP_EXPECTED.has(tool.name)) {
      // anchor maps must always render
      ok(
        false,
        `${tool.name}: expected a map overlay, got none${err ? ` (errored: ${err})` : ""}`,
      );
    } else if (isCandidate && err) {
      errored.push(`${tool.name} (${err})`);
      console.log(`  · ${tool.name.padEnd(24)} (probe errored: ${err})`);
    } else if (isCandidate) {
      noMap.push(tool.name);
      console.log(`  – ${tool.name.padEnd(24)} (no map)`);
    }
    // non-geographic tools (budget, polls, …) are silently ignored
  }

  console.log("\n=== coverage audit ===");
  console.log(
    `  maps shipped (${withMap.length}): ${withMap.join(", ") || "—"}`,
  );
  console.log(
    `  geographic, no map yet (${noMap.length}): ${noMap.join(", ") || "—"}`,
  );
  if (errored.length)
    console.log(
      `  candidates that couldn't be probed (${errored.length}): ${errored.join("; ")}`,
    );

  console.log(
    `\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — geo overlay integrity`,
  );
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
