import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
  assert.equal(
    scripts["deploy:news:evals:public-route"],
    "npm run deploy:news:evals && npm run deploy:news",
  );
  assert.match(scripts["emulator:news:evals"], /-P news/);

  const newsHosting = firebase.hosting.find((entry) => entry.target === "news");
  assert.deepEqual(newsHosting.rewrites[0], {
    source: "/api/news-evals/**",
    function: { functionId: "newsEvals", region: "europe-west3" },
  });
  const broadHeader = newsHosting.headers.findIndex(
    (entry) => entry.source === "**",
  );
  const apiHeader = newsHosting.headers.findIndex(
    (entry) => entry.source === "/api/news-evals/**",
  );
  assert.ok(broadHeader >= 0 && apiHeader > broadHeader);
  assert.deepEqual(newsHosting.headers[apiHeader], {
    source: "/api/news-evals/**",
    headers: [{ key: "Cache-Control", value: "no-store" }],
  });

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

test("the deployed schema copy is byte-identical to the shared contract", () => {
  for (const name of ["contract.json", "submission_request.schema.json"]) {
    assert.deepEqual(
      readFileSync(resolve(ROOT, `news-functions/lib/eval-contract/${name}`)),
      readFileSync(resolve(ROOT, `news/eval_contract/${name}`)),
    );
  }
});
