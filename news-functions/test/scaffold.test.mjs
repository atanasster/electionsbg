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
  assert.match(scripts["emulator:news:evals"], /--project demo-news-evals/);
  assert.match(
    scripts["emulator:news:evals"],
    /--only functions,firestore,hosting/,
  );
  assert.match(scripts["news:evals:test:emulator"], /demo-news-evals/);
  assert.match(
    scripts["news:evals:test:emulator"],
    /NEWS_EVAL_EMULATOR_ADAPTERS=true/,
  );
  for (const scriptName of [
    "deploy:news:evals",
    "deploy:news:evals:rules",
    "emulator:news:evals",
    "news:evals:test:emulator",
    "news:evals:firestore:list",
    "provision:news:evals:firestore",
    "configure:news:evals:secrets",
  ]) {
    assert.match(scripts[scriptName], /npx --yes firebase-tools@15\.18\.0/);
  }

  const workflow = readFileSync(
    resolve(ROOT, ".github/workflows/test.yml"),
    "utf8",
  );
  const nestedInstall = workflow.indexOf("npm --prefix news-functions ci");
  const nestedTests = workflow.indexOf("npm run news:evals:test");
  assert.ok(nestedInstall >= 0 && nestedInstall < nestedTests);
  assert.match(scripts["news:evals:export"], /operator-cli\.js export/);
  assert.match(scripts["news:evals:export"], /--project electionsbg-news/);
  assert.match(
    scripts["news:evals:review-bundle"],
    /operator-cli\.js review-bundle/,
  );
  assert.match(scripts["news:evals:apply-review"], /operator-cli\.js apply/);
  assert.match(
    scripts["news:evals:apply-review"],
    /--project electionsbg-news/,
  );
  assert.match(scripts["news:evals:tasks:write"], /sync_eval_tasks\.py/);
  assert.match(scripts["news:evals:tasks:write"], /--write/);
  assert.ok(
    scripts["build:news"].indexOf("npm run news:data") <
      scripts["build:news"].indexOf("npm run news:evals:tasks:write"),
  );
  assert.ok(
    scripts["build:news"].indexOf("npm run news:evals:tasks:write") <
      scripts["build:news"].indexOf("vite build --config vite.config.news.ts"),
  );
  assert.match(scripts["news:evals:tasks:sync"], /operator-cli\.js sync-tasks/);
  assert.match(scripts["news:evals:tasks:sync"], /electionsbg-news/);
  assert.match(scripts["news:evals:tasks:sync"], /--live-manifest-url https:/);
  assert.match(
    scripts["news:evals:tasks:sync"],
    /https:\/\/storage\.googleapis\.com\/data-electionsbg-com\/news\/app-data\/manifest\.json/,
  );
  assert.doesNotMatch(scripts["news:evals:tasks:sync"], /sync_eval_tasks\.py/);

  const newsHosting = firebase.hosting.find((entry) => entry.target === "news");
  assert.deepEqual(newsHosting.rewrites[0], {
    source: "/api/news-evals/**",
    function: { functionId: "newsEvals", region: "europe-west3" },
  });
  assert.deepEqual(newsHosting.rewrites[1], {
    source: "/evals/article/**",
    destination: "/evals/article/index.html",
  });
  assert.deepEqual(newsHosting.rewrites[2], {
    source: "**",
    destination: "/index.html",
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
    [
      "emulator:news:evals",
      "firebase.news-evals-emulator.json",
      ["news-functions/emulator-package"],
    ],
  ];
  for (const [scriptName, configName, expectedSources] of emulatorBoundaries) {
    assert.match(scripts[scriptName], new RegExp(`--config ${configName}`));
    const config = readJson(configName);
    assert.deepEqual(
      config.functions.map((entry) => entry.source),
      expectedSources,
    );
  }
  const isolated = readJson("firebase.news-evals-emulator.json");
  assert.equal(isolated.functions[0].codebase, "news-evals-emulator");
  assert.equal(isolated.hosting.public, "news-functions/emulator-public");
  assert.deepEqual(isolated.hosting.rewrites, [
    {
      source: "/api/news-evals/**",
      function: { functionId: "newsEvals", region: "europe-west3" },
    },
  ]);
  assert.equal(isolated.emulators.hosting.port, 5002);

  const production = readJson("firebase.news-evals.json");
  assert.equal(production.functions[0].source, "news-functions");
  assert.equal("hosting" in production, false);
  assert.doesNotMatch(
    scripts["deploy:news:evals"],
    /firebase\.news-evals-emulator\.json|demo-news-evals/,
  );
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

  const ttl = scripts["provision:news:evals:ttl"];
  for (const collection of [
    "news_eval_abuse",
    "news_eval_rate",
    "news_feedback_abuse",
    "news_feedback_rate",
  ]) {
    assert.match(ttl, new RegExp(`--collection-group=${collection}`));
  }
  assert.match(ttl, /expires_at/);
  assert.match(ttl, /--database='\(default\)'/);
  assert.match(ttl, /--enable-ttl/);
  assert.match(ttl, /indexes fields update expires_at/);
  assert.match(ttl, /--disable-indexes/);
  assert.match(ttl, /--project=electionsbg-news/);

  const secrets = scripts["configure:news:evals:secrets"];
  assert.match(secrets, /NEWS_EVAL_TURNSTILE_SECRET/);
  assert.match(secrets, /NEWS_EVAL_HMAC_KEYRING/);
  assert.match(secrets, /firebase\.news-evals\.json/);
  assert.match(secrets, /-P news/);
});

test("only the isolated Function binds the two eval secrets", () => {
  const source = readFileSync(
    resolve(ROOT, "news-functions/src/index.ts"),
    "utf8",
  );
  assert.match(source, /defineSecret\(TURNSTILE_SECRET_NAME\)/);
  assert.match(source, /defineJsonSecret\(HMAC_KEYRING_SECRET_NAME\)/);
  assert.match(source, /secrets: \[turnstileSecret, hmacKeyringSecret\]/);
  assert.doesNotMatch(source, /operator|adjudication|exportSubmissions/);

  for (const path of ["functions/index.js"]) {
    const other = readFileSync(resolve(ROOT, path), "utf8");
    assert.doesNotMatch(
      other,
      /NEWS_EVAL_(?:TURNSTILE_SECRET|HMAC_KEYRING)/,
      `${path} must not receive news-eval secrets`,
    );
  }

  const emulatorWrapper = readFileSync(
    resolve(ROOT, "news-functions/emulator-package/index.js"),
    "utf8",
  );
  assert.match(emulatorWrapper, /emulatorAdapters/);
  assert.doesNotMatch(
    emulatorWrapper,
    /define(?:Json)?Secret|NEWS_EVAL_(?:TURNSTILE_SECRET|HMAC_KEYRING)/,
  );
});

test("the deployed schema copy is byte-identical to the shared contract", () => {
  for (const name of [
    "contract.json",
    "article_evaluation.schema.json",
    "event.schema.json",
    "submission_request.schema.json",
  ]) {
    assert.deepEqual(
      readFileSync(resolve(ROOT, `news-functions/lib/eval-contract/${name}`)),
      readFileSync(resolve(ROOT, `news/eval_contract/${name}`)),
    );
  }
  const contract = readJson("news/eval_contract/contract.json");
  const schema = readJson("news/eval_contract/submission_request.schema.json");
  assert.equal(
    schema.properties.turnstile_token.maxLength,
    contract.public_abuse_controls.turnstile_token_characters,
  );
  assert.equal(
    contract.public_abuse_controls.trusted_client_ip_available,
    false,
  );
  assert.equal("ip_daily_submissions" in contract.public_abuse_controls, false);
  assert.equal(
    contract.community_aggregate_release.public_distribution_enabled,
    false,
  );
  assert.equal(
    schema.properties.base_task_revision.maximum,
    Number.MAX_SAFE_INTEGER,
  );
});
