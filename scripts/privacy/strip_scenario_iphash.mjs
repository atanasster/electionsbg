// One-off privacy cleanup for the budget-scenario store (docs/plans/gdpr-consent-v1.md, T3).
//
// Until 2026-09-26 every `scenario_submissions` doc carried an `ipHash` — a salted SHA-256 of the
// submitter's IP under a salt committed to this repo, so reversible for IPv4 — and was kept
// indefinitely. Nothing ever read the field. The writer no longer sets it; this removes it from
// the docs already written, and deletes the stale `scenario_rate` docs that predate their
// `expiresAt` TTL field (a rate doc only guards the day it was written on).
//
// Dry run by default. Uses Application Default Credentials (`gcloud auth application-default
// login`) against the elections-bg project.
//
//   node scripts/privacy/strip_scenario_iphash.mjs            # report only
//   node scripts/privacy/strip_scenario_iphash.mjs --apply    # write
//
// Idempotent: a second --apply finds nothing to do.

import { createRequire } from "node:module";

const require = createRequire(
  new URL("../../functions/package.json", import.meta.url),
);
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const APPLY = process.argv.includes("--apply");
initializeApp({ credential: applicationDefault(), projectId: "elections-bg" });
const db = getFirestore();

const today = new Date().toISOString().slice(0, 10);

const commitInChunks = async (ops) => {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    for (const op of ops.slice(i, i + 400)) op(batch);
    await batch.commit();
  }
};

const subs = await db.collection("scenario_submissions").get();
const withHash = subs.docs.filter((d) => d.get("ipHash") !== undefined);
console.log(
  `scenario_submissions: ${subs.size} docs, ${withHash.length} carry ipHash`,
);

const rates = await db.collection("scenario_rate").get();
const staleRates = rates.docs.filter(
  (d) => d.get("expiresAt") === undefined && d.get("day") !== today,
);
console.log(
  `scenario_rate: ${rates.size} docs, ${staleRates.length} stale (no expiresAt, not today)`,
);

if (!APPLY) {
  console.log("dry run — pass --apply to write");
  process.exit(0);
}

await commitInChunks(
  withHash.map((d) => (b) => b.update(d.ref, { ipHash: FieldValue.delete() })),
);
await commitInChunks(staleRates.map((d) => (b) => b.delete(d.ref)));
console.log(
  `stripped ipHash from ${withHash.length} submissions, deleted ${staleRates.length} rate docs`,
);
