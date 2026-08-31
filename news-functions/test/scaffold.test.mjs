import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { closedScaffoldHandler } from "../lib/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const readJson = (path) =>
  JSON.parse(readFileSync(resolve(ROOT, path), "utf8"));

test("news evals is an isolated Firebase codebase on the news project", () => {
  const firebase = readJson("firebase.json");
  const codebase = firebase.functions.find(
    (entry) => entry.codebase === "news-evals",
  );
  assert.deepEqual(
    { source: codebase?.source, runtime: codebase?.runtime },
    { source: "news-functions", runtime: "nodejs22" },
  );

  const aliases = readJson(".firebaserc");
  assert.equal(aliases.projects.news, "electionsbg-news");

  const scripts = readJson("package.json").scripts;
  assert.match(scripts["deploy:news:evals"], /functions:news-evals/);
  assert.match(scripts["deploy:news:evals"], /firebase\.news-evals\.json/);
  assert.match(scripts["deploy:news:evals"], /firestore:rules/);
  assert.match(scripts["deploy:news:evals"], /-P news/);
  assert.match(scripts["emulator:news:evals"], /-P news/);

  const emulatorBoundaries = [
    ["emulator", "firebase.main-functions.json", ["functions"]],
    ["emulator:ai", "firebase.ai-functions.json", ["functions"]],
    ["emulator:news:evals", "firebase.news-evals.json", ["news-functions"]],
  ];
  for (const [scriptName, configName, expectedSources] of emulatorBoundaries) {
    assert.match(scripts[scriptName], new RegExp(`--config ${configName}`));
    const config = readJson(configName);
    assert.deepEqual(
      config.functions.map((entry) => entry.source),
      expectedSources,
    );
  }
});

test("Firestore remains closed to every browser read and write", () => {
  const rules = readFileSync(resolve(ROOT, "firestore.rules"), "utf8");
  const executable = rules.replaceAll(/\/\/.*$/gm, "");
  const allowStatements = [...executable.matchAll(/\ballow\b[^;]*;/g)].map(
    ([statement]) => statement.replaceAll(/\s+/g, " ").trim(),
  );
  assert.match(rules, /match \/\{document=\*\*\}/);
  assert.deepEqual(allowStatements, ["allow read, write: if false;"]);
});

test("the isolated package has no private archive or Cloud SQL dependency", () => {
  const manifest = readJson("news-functions/package.json");
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), [
    "firebase-admin",
    "firebase-functions",
  ]);
  assert.equal(manifest.main, "lib/index.js");
});

test("the scaffold handler is closed and uncacheable for every request", () => {
  for (const request of [
    { method: "GET", path: "/aggregate/example" },
    { method: "POST", path: "/submit" },
    { method: "OPTIONS", path: "/submit" },
  ]) {
    const headers = new Map();
    let status = 0;
    let body = "";
    const response = {
      set(name, value) {
        headers.set(name.toLowerCase(), value);
        return this;
      },
      status(value) {
        status = value;
        return this;
      },
      send(value) {
        body = value;
      },
    };
    closedScaffoldHandler(request, response);
    assert.equal(status, 503);
    assert.equal(headers.get("cache-control"), "no-store");
    assert.equal(
      headers.get("content-type"),
      "application/json; charset=utf-8",
    );
    assert.deepEqual(JSON.parse(body), {
      error: {
        code: "not_implemented",
        message: "The public evaluation API is not enabled yet.",
      },
    });
  }
});

test("Firestore provisioning choices are explicit and news-project scoped", () => {
  const scripts = readJson("package.json").scripts;
  const provision = scripts["provision:news:evals:firestore"];
  assert.match(provision, /databases:create "\(default\)"/);
  assert.match(provision, /--location=europe-west3/);
  assert.match(provision, /--edition=standard/);
  assert.match(provision, /--delete-protection=ENABLED/);
  assert.match(provision, /--point-in-time-recovery=ENABLED/);
  assert.match(provision, /-P news/);
});
