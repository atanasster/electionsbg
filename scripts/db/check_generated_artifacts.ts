// Does every artifact `db:refresh` regenerates actually REACH the bucket?
//
// WHY THIS EXISTS. `refresh_coverage.test.ts` proves each REFRESH_GENERATORS
// artifact is chain-built, git-tracked and referenced by its generator. All of
// that is about the file on DISK, and every one of these four is a static blob
// the SPA fetches from GCS — so the gate was green throughout the two failures
// it could not see:
//
//   · culture/derived/hub_stats.json      404 for two days after it was
//     committed (2026-08-18 → 2026-08-21). Never uploaded by anything.
//   · governance/declarations_hub_stats.json  4 days stale, ACROSS a schema
//     change (companies/companyMps → organisations/organisationPeople), so the
//     deployed bundle was reading keys the served blob did not carry.
//
// Neither is visible to a row count, a test or a build: the hubs degrade a 404
// to „no figure" on purpose, and a stale blob renders confidently.
//
// The check is a real comparison against the live object, not a reminder — the
// reminder is what already existed, in per-skill prose, and it is what failed.
// Read-only: it never uploads. It PRINTS the publish command and exits 1 so a
// chain or an orchestrator can gate on it.
//
//   npx tsx scripts/db/check_generated_artifacts.ts
//   npx tsx scripts/db/check_generated_artifacts.ts --quiet   # only the verdict

import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REFRESH_GENERATORS } from "./refresh_coverage";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const BUCKET = "https://storage.googleapis.com/data-electionsbg-com";

const md5 = (b: Buffer | string) => createHash("md5").update(b).digest("hex");

type Verdict = "ok" | "stale" | "missing" | "unbuilt" | "unreachable";

interface Row {
  gen: string;
  bucketPath: string;
  verdict: Verdict;
  detail: string;
}

const check = async (
  gen: string,
  artifact: string,
  bucketPath: string,
): Promise<Row> => {
  const local = path.join(ROOT, artifact);
  if (!existsSync(local))
    return {
      gen,
      bucketPath,
      verdict: "unbuilt",
      // Not a publish failure: a checkout that never ran the generator has
      // nothing to publish, and uploading would be the wrong move anyway.
      detail: `${artifact} absent locally — run \`npm run ${gen}\` first`,
    };
  const buf = readFileSync(local);

  let res: Response;
  try {
    res = await fetch(`${BUCKET}/${bucketPath}`, { cache: "no-store" });
  } catch (e) {
    return {
      gen,
      bucketPath,
      verdict: "unreachable",
      detail: `could not reach the bucket: ${(e as Error).message}`,
    };
  }
  if (res.status === 404)
    return {
      gen,
      bucketPath,
      verdict: "missing",
      detail: "404 — the artifact has NEVER been published",
    };
  if (!res.ok)
    return {
      gen,
      bucketPath,
      verdict: "unreachable",
      detail: `HTTP ${res.status}`,
    };

  // Compare BYTES, not Last-Modified. A sync that ran after an unrelated commit
  // stamps a fresh date onto identical content, and `bucket:gz` re-uploads some
  // objects gzipped — so a timestamp says when something was written, never
  // whether it is the current vintage.
  const remote = Buffer.from(await res.arrayBuffer());
  if (md5(remote) === md5(buf))
    return { gen, bucketPath, verdict: "ok", detail: `${buf.length} B` };

  const served = res.headers.get("last-modified") ?? "unknown date";
  return {
    gen,
    bucketPath,
    verdict: "stale",
    detail: `bucket copy differs (served ${served}, ${remote.length} B vs ${buf.length} B local)`,
  };
};

const main = async () => {
  const quiet = process.argv.includes("--quiet");
  const rows = await Promise.all(
    Object.entries(REFRESH_GENERATORS).map(([gen, spec]) =>
      check(gen, spec.artifact, spec.bucketPath),
    ),
  );

  const mark: Record<Verdict, string> = {
    ok: "✓",
    stale: "✗",
    missing: "✗",
    unbuilt: "·",
    unreachable: "?",
  };
  if (!quiet)
    for (const r of rows)
      console.log(
        `${mark[r.verdict]} ${r.bucketPath.padEnd(42)} ${r.verdict.toUpperCase().padEnd(11)} ${r.detail}`,
      );

  const needsPublish = rows.filter(
    (r) => r.verdict === "stale" || r.verdict === "missing",
  );
  if (!needsPublish.length) {
    console.log(
      `\nAll ${rows.length} db:refresh-generated artifacts match the bucket.`,
    );
    return 0;
  }
  console.log(
    `\n${needsPublish.length} artifact(s) not published. Publish them with:\n`,
  );
  console.log(
    `  npm run bucket:sync:paths -- ${needsPublish.map((r) => r.bucketPath).join(" ")}\n`,
  );
  // Deliberately NOT run for the operator. The bucket is production, and this
  // repo's standing rule is that an orchestrator emits the publish command
  // rather than executing it (process-watch-report, "What this skill does NOT
  // do"). The defect here was never that the command was hard to run.
  return 1;
};

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
