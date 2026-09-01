#!/usr/bin/env node

import { applicationDefault } from "firebase-admin/app";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { canonicalJson } from "./eval-contract/canonical.js";
import {
  buildLocalReviewBundle,
  FirestoreOperatorStore,
  readRawSubmissionExport,
  serializeAcceptedAdjudicationSnapshot,
  serializeRawSubmissionExport,
  verifyProjectFeedbackTaskRelease,
  verifyProjectTaskRelease,
  writeAtomicPrivateFile,
  type OperatorFirestore,
} from "./operator.js";

type Arguments = Record<string, string>;

function usage(): string {
  return [
    "Usage:",
    "  operator-cli export --project electionsbg-news --out PATH",
    "  operator-cli export-accepted --project electionsbg-news --out PATH",
    "  operator-cli review-bundle --input PATH --article-root news/data --out PATH",
    "  operator-cli apply --project electionsbg-news --file PATH",
    "  operator-cli sync-tasks --project electionsbg-news --file PATH --live-manifest-url URL",
    "  operator-cli sync-feedback-tasks --project electionsbg-news --file PATH --live-manifest-url URL",
  ].join("\n");
}

function parseArguments(values: readonly string[]): {
  command: string;
  options: Arguments;
} {
  const [command, ...rest] = values;
  if (!command || command === "--help" || command === "-h")
    return { command: "help", options: {} };
  const options: Arguments = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith("--") || !value || value.startsWith("--"))
      throw new Error(`invalid argument near ${flag ?? "end of command"}`);
    const key = flag.slice(2);
    if (Object.hasOwn(options, key)) throw new Error(`duplicate --${key}`);
    options[key] = value;
  }
  return { command, options };
}

function requireOptions(
  options: Arguments,
  required: readonly string[],
): Arguments {
  const expected = new Set(required);
  const unexpected = Object.keys(options).filter((key) => !expected.has(key));
  if (unexpected.length > 0)
    throw new Error(`unexpected options: ${unexpected.sort().join(", ")}`);
  for (const key of required)
    if (!options[key]) throw new Error(`missing --${key}`);
  return options;
}

function assertOperatorProject(project: string): void {
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  if (project === "electionsbg-news") return;
  if (emulator && /^demo-[a-z0-9-]+$/u.test(project)) return;
  throw new Error(
    "operator writes require electionsbg-news, or a demo-* project with FIRESTORE_EMULATOR_HOST",
  );
}

async function withStore<T>(
  project: string,
  callback: (store: FirestoreOperatorStore) => Promise<T>,
): Promise<T> {
  assertOperatorProject(project);
  const app =
    getApps().find((candidate) => candidate.name === "news-eval-operator") ??
    initializeApp(
      {
        projectId: project,
        credential: applicationDefault(),
      },
      "news-eval-operator",
    );
  try {
    const database = getFirestore(app) as unknown as OperatorFirestore;
    return await callback(new FirestoreOperatorStore(database));
  } finally {
    await deleteApp(app);
  }
}

async function readLocalArticle(articleRoot: string, articleKey: string) {
  const separator = articleKey.indexOf("/");
  const domain = articleKey.slice(0, separator);
  const articleId = articleKey.slice(separator + 1);
  const root = resolve(articleRoot);
  const path = resolve(root, domain, `${articleId}.json`);
  if (!path.startsWith(`${root}/`))
    throw new Error("article path escapes its root");
  const article = JSON.parse(await readFile(path, "utf8"));
  return { path, article };
}

async function main(): Promise<void> {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === "help") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (command === "export") {
    requireOptions(options, ["project", "out"]);
    const project = options.project!;
    const destination = resolve(options.out!);
    const exported = await withStore(project, (store) =>
      store.exportSubmissions(project),
    );
    await writeAtomicPrivateFile(
      destination,
      serializeRawSubmissionExport(exported),
    );
    process.stdout.write(
      `${canonicalJson({
        status: "written",
        out: destination,
        record_count: exported.manifest.record_count,
        records_sha256: exported.manifest.records_sha256,
        firestore_read_time: exported.manifest.firestore_read_time,
      })}\n`,
    );
    return;
  }
  if (command === "export-accepted") {
    requireOptions(options, ["project", "out"]);
    const project = options.project!;
    const destination = resolve(options.out!);
    const exported = await withStore(project, (store) =>
      store.exportAcceptedAdjudications(project),
    );
    await writeAtomicPrivateFile(
      destination,
      serializeAcceptedAdjudicationSnapshot(exported),
    );
    process.stdout.write(
      `${canonicalJson({
        status: "written",
        out: destination,
        record_count: exported.manifest.record_count,
        records_sha256: exported.manifest.records_sha256,
        firestore_read_time: exported.manifest.firestore_read_time,
      })}\n`,
    );
    return;
  }
  if (command === "review-bundle") {
    requireOptions(options, ["input", "article-root", "out"]);
    const input = resolve(options.input!);
    const destination = resolve(options.out!);
    const articleRoot = resolve(options["article-root"]!);
    const exported = await readRawSubmissionExport(input);
    const bundle = await buildLocalReviewBundle(exported, (key) =>
      readLocalArticle(articleRoot, key),
    );
    await writeAtomicPrivateFile(destination, `${canonicalJson(bundle)}\n`);
    process.stdout.write(
      `${canonicalJson({
        status: "written",
        out: destination,
        article_count: bundle.article_count,
        submission_count: bundle.submission_count,
      })}\n`,
    );
    return;
  }
  if (command === "apply") {
    requireOptions(options, ["project", "file"]);
    const project = options.project!;
    const file = resolve(options.file!);
    const commandValue = JSON.parse(await readFile(file, "utf8"));
    const result = await withStore(project, (store) =>
      store.apply(commandValue),
    );
    process.stdout.write(`${canonicalJson(result)}\n`);
    return;
  }
  if (command === "sync-tasks") {
    requireOptions(options, ["project", "file", "live-manifest-url"]);
    const project = options.project!;
    const file = resolve(options.file!);
    const manifest = JSON.parse(await readFile(file, "utf8"));
    const proof = await verifyProjectTaskRelease(
      project,
      manifest,
      options["live-manifest-url"]!,
      (url, init) => fetch(url, init),
      process.env.FIRESTORE_EMULATOR_HOST,
    );
    const result = await withStore(project, (store) =>
      store.syncTasks(manifest, proof),
    );
    process.stdout.write(`${canonicalJson(result)}\n`);
    return;
  }
  if (command === "sync-feedback-tasks") {
    requireOptions(options, ["project", "file", "live-manifest-url"]);
    const project = options.project!;
    const file = resolve(options.file!);
    const manifest = JSON.parse(await readFile(file, "utf8"));
    const proof = await verifyProjectFeedbackTaskRelease(
      project,
      manifest,
      options["live-manifest-url"]!,
      (url, init) => fetch(url, init),
      process.env.FIRESTORE_EMULATOR_HOST,
    );
    const result = await withStore(project, (store) =>
      store.syncFeedbackTasks(manifest, proof),
    );
    process.stdout.write(`${canonicalJson(result)}\n`);
    return;
  }
  throw new Error(`unknown operator command: ${command}\n${usage()}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `${canonicalJson({ error: "operator_failed", message })}\n`,
  );
  process.exitCode = 1;
});
