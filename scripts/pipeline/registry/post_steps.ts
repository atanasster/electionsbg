// Steps that run once per ingest run AFTER the handlers — either always, or
// when a handler that ran names them in `followUps`. Plan §2.5.
//
// ORDER IS THE ARRAY ORDER, and it is load-bearing: the hub generators read
// what the handlers loaded; governance folds the sector hubs; the home
// generators fold governance (hub-stats → flyover → price-events → feed);
// home:health checks them last. db:check-* stay at the very end because
// they report on everything before them.
//
// A generator's bucket path needs no declaration here: its artifact is in
// REFRESH_GENERATORS / UPLOAD_PUBLISHED_ARTIFACTS, and the manifest writer
// adds the bucket path of every registered artifact the run's commit touched
// (generatedPathsTouched). Only non-generator outputs list `paths`.

import { derive, pnpm, tsx, verify } from "./build";
import type { Need, Step } from "./types";

export interface PostStep {
  id: string;
  /** `always` runs on every ingest run that ran at least one handler. */
  when: "always" | "followUp";
  /** Not run when one of these sources moved in this run — the handler it
   *  serves already does the same work. */
  skipWhen?: readonly string[];
  steps: readonly Step[];
  /** Needs of every step; a step can add its own (`Step.needs`). */
  needs?: readonly Need[];
  publish?: { paths?: readonly string[]; cloud?: readonly string[] };
  outputs?: readonly string[];
}

export const POST_STEPS: readonly PostStep[] = [
  {
    id: "funds-political-links",
    when: "followUp",
    needs: ["pg-local"],
    steps: [derive("funds:political-links", pnpm("funds:political-links"))],
    outputs: ["data/funds"],
  },
  {
    id: "textbook-market",
    when: "followUp",
    needs: ["pg-local"],
    steps: [
      derive(
        "gen_textbook_market",
        tsx("scripts/education/gen_textbook_market.ts"),
      ),
    ],
    publish: { paths: ["education"] },
    outputs: ["data/education"],
  },
  {
    id: "procurement-hub-stats",
    when: "followUp",
    needs: ["pg-local"],
    steps: [derive("db:gen-hub-stats", pnpm("db:gen-hub-stats"))],
    outputs: ["data/procurement/derived/hub_stats.json"],
  },
  {
    id: "sector-stats",
    when: "followUp",
    needs: ["pg-local"],
    steps: [derive("db:gen-sector-stats", pnpm("db:gen-sector-stats"))],
    outputs: ["data/procurement/derived/sector_stats.json"],
  },
  {
    id: "culture-hub-stats",
    when: "followUp",
    needs: ["pg-local"],
    steps: [
      derive("db:gen-culture-hub-stats", pnpm("db:gen-culture-hub-stats")),
    ],
    outputs: ["data/culture/derived/hub_stats.json"],
  },
  {
    // Reads sector_stats, so it follows it.
    id: "roads-hub-stats",
    when: "followUp",
    needs: ["pg-local"],
    steps: [derive("db:gen-roads-hub-stats", pnpm("db:gen-roads-hub-stats"))],
    outputs: ["data/roads/derived/hub_stats.json"],
  },
  {
    // The riverbed file first: the water hub blob reads it.
    id: "water-hub-stats",
    when: "followUp",
    needs: ["pg-local"],
    steps: [
      derive("db:gen-water-flood", pnpm("db:gen-water-flood")),
      derive("db:gen-water-hub-stats", pnpm("db:gen-water-hub-stats")),
    ],
    outputs: [
      "data/water/flood_maintenance.json",
      "data/water/derived/hub_stats.json",
    ],
  },
  {
    // After the two local transport map loaders, which the procurement
    // db:refresh chain carries.
    id: "transport-hub-stats",
    when: "followUp",
    needs: ["pg-local"],
    steps: [
      derive("db:gen-transport-hub-stats", pnpm("db:gen-transport-hub-stats")),
    ],
    outputs: ["data/transport/derived/hub_stats.json"],
  },
  {
    // The /sector/edu hub blob. Reads contracts, fund_projects,
    // national_competition() and agri_subsidies (the research arm's payout
    // basis), so it follows the procurement, funds and agri reloads.
    id: "edu-hub-stats",
    when: "followUp",
    needs: ["pg-local"],
    steps: [derive("db:gen-edu-hub-stats", pnpm("db:gen-edu-hub-stats"))],
    outputs: ["data/education/derived/hub_stats.json"],
  },
  {
    // The /sector/health hub blob. Reads contracts,
    // national_competition(), fund_projects, nzok_hospital_payments,
    // nzok_drug_quarterly and the committed B1 execution history, so it
    // follows the procurement, funds and НЗОК reloads.
    id: "health-hub-stats",
    when: "followUp",
    needs: ["pg-local"],
    steps: [derive("db:gen-health-hub-stats", pnpm("db:gen-health-hub-stats"))],
    outputs: ["data/health/derived/hub_stats.json"],
  },
  {
    id: "declarations-hub-stats",
    when: "followUp",
    needs: ["pg-local"],
    steps: [
      derive(
        "db:gen-declarations-hub-stats",
        pnpm("db:gen-declarations-hub-stats"),
      ),
    ],
    outputs: ["data/governance/declarations_hub_stats.json"],
  },
  {
    // Built from the energy / fuel / Eurostat inputs the price hub reads,
    // when one of them moved without a kzp_prices ingest that would rebuild
    // it anyway.
    id: "price-hub-payloads",
    when: "followUp",
    // A kzp_prices ingest rebuilds the payloads itself (and its publish runs
    // prices:ingest:cloud); doing it again here costs minutes for nothing.
    skipWhen: ["kzp_prices"],
    needs: ["pg-local"],
    steps: [
      derive("prices:payloads", pnpm("prices:payloads"), { timeoutMin: 60 }),
    ],
    publish: { cloud: ["pnpm run prices:payloads:cloud"] },
  },
  {
    id: "myarea-alerts",
    when: "always",
    needs: ["pg-local"],
    steps: [derive("myarea:alerts", pnpm("myarea:alerts"))],
    publish: { cloud: ["pnpm run myarea:alerts:cloud"] },
  },
  {
    id: "data-map",
    when: "always",
    steps: [derive("data:map", pnpm("data:map"))],
    publish: { paths: ["data_map.json"] },
    outputs: ["data/data_map.json"],
  },
  {
    // A FOLD over the sector hubs, so after every one of them.
    id: "governance-hub-stats",
    when: "always",
    needs: ["pg-local"],
    steps: [
      derive(
        "db:gen-governance-hub-stats",
        pnpm("db:gen-governance-hub-stats"),
      ),
    ],
    outputs: ["data/governance/hub_stats.json"],
  },
  {
    id: "home",
    when: "always",
    // hub-stats and feed fold COMMITTED files; only flyover and price-events
    // read Postgres — so a down database skips just those two.
    steps: [
      derive("db:gen-home-hub-stats", pnpm("db:gen-home-hub-stats")),
      derive("db:gen-home-flyover", pnpm("db:gen-home-flyover"), {
        needs: ["pg-local"],
      }),
      derive("db:gen-home-price-events", pnpm("db:gen-home-price-events"), {
        needs: ["pg-local"],
      }),
      derive("db:gen-home-feed", pnpm("db:gen-home-feed")),
      verify("home:health", pnpm("home:health")),
    ],
    publish: { paths: ["home"] },
    outputs: ["data/home"],
  },
  {
    // Compares local bytes against the bucket over HTTP: no database needed.
    id: "check-generated",
    when: "always",
    steps: [
      verify("db:check-generated", pnpm("db:check-generated"), { okExit: [1] }),
    ],
  },
  {
    // Exit 1 is its FINDING, so without both databases a connection error
    // would also read as exit 1 and pass as "found something". Needs them.
    id: "check-cloud",
    when: "always",
    needs: ["pg-local", "proxy"],
    steps: [verify("db:check-cloud", pnpm("db:check-cloud"), { okExit: [1] })],
  },
];

/** The post-steps an ingest run executes, in POST_STEPS order. */
export const selectPostSteps = (
  followUps: readonly string[],
  flipped: ReadonlySet<string>,
  all: readonly PostStep[] = POST_STEPS,
): PostStep[] => {
  const wanted = new Set(followUps);
  return all.filter(
    (p) =>
      (p.when === "always" || wanted.has(p.id)) &&
      !(p.skipWhen ?? []).some((s) => flipped.has(s)),
  );
};
