// The operational half of the home dashboard: does anything actually RUN the generators, and
// does anything PUBLISH what they write?
//
// ⚠️ THIS IS A STATIC GATE OVER PROSE, and it exists because the failure it catches has already
// happened twice in this repo to other artifacts. `culture/derived/hub_stats.json` was
// committed and served 404 for two days because chain membership guarantees the file on DISK
// and says nothing about the bucket; and two procurement blobs went un-regenerated from 2026-06
// to 2026-08 because nothing ran their generator at all. Both are silent: a stale artifact and
// an absent one both answer 200.
//
// `/` is the entry page, so both failures land on the first thing a visitor sees.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REFRESH_GENERATORS } from "../refresh_coverage";
import { STALE_AFTER_DAYS, ADAPTERS } from "./events/adapters";
import { PUBLIC_ARTIFACTS } from "./health";
import { collect } from "../../bucket_gzip";
import { BUCKET_GS, BUCKET_URL } from "../lib/bucket";
import { stripComments } from "../../lib/strip_comments";

const REPO = path.resolve(__dirname, "../../..");
const RUNBOOK = path.join(REPO, ".claude/skills/process-watch-report/SKILL.md");
const runbook = readFileSync(RUNBOOK, "utf-8");
/**
 * ⚠️ THE PART AN ORCHESTRATOR ACTUALLY EXECUTES. `runbook.includes(…)` over the whole
 * ~1,550-line file is satisfied by a mention ANYWHERE — a reference block, a troubleshooting
 * row, even a „do not run this" line. The home section shipped once in the reference region
 * between the source table and the performance trace, ~140 lines above `## Procedure`, so every
 * clause below passed while nothing in the executed run built the entry page's artifacts.
 */
const PROCEDURE = runbook.slice(runbook.indexOf("## Procedure"));
const pkg = JSON.parse(
  readFileSync(path.join(REPO, "package.json"), "utf-8"),
) as { scripts: Record<string, string> };

/** The generators whose artifact is a home one — derived, never hand-listed. */
const HOME_GENERATORS = Object.entries(REFRESH_GENERATORS).filter(([, spec]) =>
  spec.artifact.startsWith("data/home/"),
);

describe("the home generators are operationally reachable", () => {
  it("there are some — the derivation is not vacuous", () => {
    // If the registry ever stopped naming them, every clause below would pass over an empty
    // list while nothing regenerated the entry page.
    expect(HOME_GENERATORS.length).toBeGreaterThanOrEqual(4);
  });

  it("every one is inside the runbook's EXECUTABLE procedure", () => {
    // ⚠️ `db:refresh` membership is NOT enough. A full refresh is a ~75-link chain that an
    // orchestrator run does not always take; the ordinary path is „these three sources moved,
    // run their skills". And a mention in the reference region is not enough either — see
    // PROCEDURE above for the state this shipped in.
    for (const [name] of HOME_GENERATORS)
      expect(
        PROCEDURE.includes(`npm run ${name}`),
        `${name} is not in process-watch-report's ## Procedure — an orchestrator following the ` +
          `numbered steps never runs it`,
      ).toBe(true);
  });

  it("home:publish is exactly the sync AND the gzip", () => {
    // ⚠️ THE WHOLE STRING, not a substring. `"npm run bucket:gz:dry".includes("bucket:gz")` is
    // true, so the substring form passed a `home:publish` whose second half published nothing
    // and printed a plan — on the gate that exists to guarantee the gzip happens.
    expect(pkg.scripts["home:publish"]).toBe(
      "npm run bucket:sync:paths -- home && npm run bucket:gz",
    );
  });

  it("bucket:gz actually covers the objects the page reads", () => {
    // ⚠️ THE CLAUSE ABOVE ONLY CHECKS THE COMMAND IS THERE. It was, and for a while it selected
    // none of these files: `bucket_gzip`'s set is a hand-maintained list, `home/` was not on it,
    // and `bucket:gz:dry | grep home` printed nothing. So the two-command rationale repeated in
    // four documents described a no-op while the entry page's blobs shipped `identity`.
    const gzipped = new Set(collect());
    for (const a of PUBLIC_ARTIFACTS)
      expect(
        gzipped.has(a.object),
        `${a.object} is not in bucket:gz's set — home:publish's second half does nothing for it`,
      ).toBe(true);
  });

  it("the publish is recorded in the upload manifest rather than run inline", () => {
    // The skill publishes nothing by design — it records touched subtrees in
    // state/upload/pending.json and hands off. An inline publish here would be the one on the
    // ENTRY PAGE's critical path with no manifest entry and no timing trace.
    expect(PROCEDURE).toContain("state/upload/pending.json");
  });

  it("the runbook runs the health check, which is a different question from db:check-generated", () => {
    // That one compares local bytes against the bucket — it answers „was it published", never
    // „is it current". A generator that never ran leaves disk and bucket both stale and equal.
    expect(runbook).toContain("npm run home:health");
    expect(pkg.scripts["home:health"]).toBeTruthy();
  });

  it("the runbook runs them in the order they actually require", () => {
    // price-events feeds the feed's adapter through a committed file; hub-stats folds the
    // sibling hubs. Both orderings are silent when wrong — the artifact is written, complete,
    // and one vintage behind.
    //
    // ⚠️ SCOPED TO THE EXECUTED STEP, not `indexOf` over the whole document. Each name happens
    // to occur twice today (the reference section and the step); a first-occurrence comparison
    // over the file would go red on a correctly-ordered step the moment somebody added a
    // troubleshooting row, and green on a wrong one.
    const step = PROCEDURE.slice(
      PROCEDURE.indexOf("7b. **Final post-step: rebuild the HOME dashboard"),
      PROCEDURE.indexOf("8. **Final post-step: verify"),
    );
    expect(
      step.length,
      "the home post-step is not where the gate expects it",
    ).toBeGreaterThan(200);
    const at = (cmd: string) => {
      const i = step.indexOf(`npm run ${cmd}`);
      expect(i, `${cmd} is missing from post-step 7b`).toBeGreaterThan(-1);
      return i;
    };
    expect(at("db:gen-home-feed")).toBeGreaterThan(
      at("db:gen-home-price-events"),
    );
    expect(at("db:gen-home-price-events")).toBeGreaterThan(
      at("db:gen-home-hub-stats"),
    );
    // The flyover reads hub_stats.json's procurement tile OFF DISK, precisely so the moving
    // band and the /procurement tile one screen below cannot show two different euro totals.
    // Run first it quotes the previous vintage and they disagree with nothing failing —
    // ORDER_PAIRS covers the db:refresh chain, and this covers the orchestrator's.
    expect(at("db:gen-home-flyover")).toBeGreaterThan(
      at("db:gen-home-hub-stats"),
    );
  });

  it("the home step precedes the artifact check that verifies its output", () => {
    expect(
      PROCEDURE.indexOf("7b. **Final post-step: rebuild the HOME dashboard"),
    ).toBeLessThan(PROCEDURE.indexOf("8. **Final post-step: verify"));
  });
});

describe("every event family declares a staleness cadence", () => {
  it("…and the two lists cannot drift", () => {
    // ⚠️ A NEW ADAPTER WITH NO ENTRY IS INVISIBLE TO `home:health`: `STALE_AFTER_DAYS[id]` is
    // `undefined`, the loop `continue`s, and the family is never checked — reported as fine
    // because nobody asked. Requiring an explicit `null` makes „this source has no cadence" a
    // decision someone wrote down.
    const declared = new Set(Object.keys(STALE_AFTER_DAYS));
    for (const a of ADAPTERS)
      expect(
        declared.has(a.id),
        `${a.id} has no STALE_AFTER_DAYS entry — home:health will never check it`,
      ).toBe(true);
    for (const id of declared)
      expect(
        ADAPTERS.some((a) => a.id === id),
        `STALE_AFTER_DAYS names ${id}, which is not an adapter`,
      ).toBe(true);
  });

  it("a declared ceiling is a positive number of days", () => {
    for (const [id, days] of Object.entries(STALE_AFTER_DAYS)) {
      if (days === null) continue;
      expect(Number.isInteger(days), id).toBe(true);
      expect(days, id).toBeGreaterThan(0);
    }
  });
});

describe("the data bucket has one definition", () => {
  it("the gsutil and https forms name the same bucket", () => {
    // ⚠️ FIVE COPIES EXISTED AND THE FIFTH WAS WRONG — `electionsbg-data`, which does not
    // exist, in the one place that FETCHES. Every `--public` run then reported the artifacts
    // unpublished regardless of the bucket's contents, and a smoke test could not see it
    // because the correct bucket 404s too while the objects are unpublished.
    expect(BUCKET_URL).toBe(
      `https://storage.googleapis.com/${BUCKET_GS.replace("gs://", "")}`,
    );
  });

  it("nothing restates it in CODE", () => {
    // The gate that keeps it at one copy. ⚠️ Comments are stripped first: two of these files
    // name the bucket in prose („the bucket (storage.googleapis.com/…) stores objects", a
    // `gsutil rm` example), which is documentation rather than a second definition — and a
    // scan that flags prose is a scan people delete. `strip_comments.ts` is the repo's shared
    // one; read its header before changing the call.
    const offenders: string[] = [];
    for (const rel of [
      "scripts/bucket_gzip.ts",
      "scripts/bucket_sync_paths.ts",
      "scripts/db/check_generated_artifacts.ts",
      "scripts/db/gen_home/health.ts",
    ]) {
      const src = stripComments(readFileSync(path.join(REPO, rel), "utf-8"), {
        trailing: true,
      });
      if (src.includes("data-electionsbg-com")) offenders.push(rel);
    }
    expect(
      offenders,
      "these restate the bucket instead of importing it",
    ).toEqual([]);
  });
});
