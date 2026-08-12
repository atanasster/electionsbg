// Measure real CLS for a built route, on a throttled phone, with per-shift
// attribution. This exists because the Playwright CLS gate in tests/perf.spec.ts
// CANNOT measure a data-driven page, and the reason is not obvious:
//
// The gate serves dist from the firebase emulator at 127.0.0.1:5002, while the
// bundle fetches its payloads from the GCS bucket. `scripts/bucket_cors.json`
// admits https://electionsbg.com (plus the staging/ai origins and the Vite dev
// port) — the emulator's origin is not among them, so every data fetch there
// fails CORS. Measured: `net::ERR_FAILED` on all four payloads, zero charts
// rendered. The page never leaves its placeholder state, so a collapse-then-
// expand shift cannot occur and a gate placed there passes with the fix
// reverted. This script therefore serves dist AT the electionsbg.com origin via
// route interception, and lets the data requests hit the real bucket.
//
// Usage:
//   npm run build                                  # dist must be current
//   npm run perf:cls -- /indicators/compare
//   npm run perf:cls -- /indicators/compare --runs 5 --trace
//   npm run perf:cls -- /indicators/compare --slow macro_peers.json:6000
//   npm run perf:cls -- /indicators/compare --desktop
//
// Flags:
//   --runs N      repeat count (default 3). Arrival ORDER varies between runs
//                 and changes the score materially — take the median, and use
//                 --slow to pin the orderings you care about.
//   --settle MS   how long to observe after commit (default 15000).
//   --slow F:MS   hold one payload back, to prove which fetch drives which
//                 shift rather than inferring it from timing.
//   --trace       print section geometry every 200ms — the total says a page is
//                 bad, the trace says which box grew.
//   --desktop     1280x900 instead of Pixel 5. CLS only scores what is IN the
//                 viewport, so a shift that misses the fold on a phone can
//                 still be real here.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const ORIGIN = "https://electionsbg.com";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(argv[i + 1]);
};
const RUNS = flag("runs", 3);
const SETTLE_MS = flag("settle", 15000);
const ROUTES = argv.filter((a) => a.startsWith("/"));
if (!ROUTES.length) {
  console.error("usage: npm run perf:cls -- /some/route [--runs N] [--trace]");
  process.exit(1);
}
if (!fs.existsSync(`${DIST}/assets`)) {
  console.error(`no build at ${DIST} — run \`npm run build\` first`);
  process.exit(1);
}

// Chunk base name -> current filename, so a route's prerendered HTML still
// resolves after a bundle-only rebuild changed every hash.
const assetIndex = new Map();
for (const f of fs.readdirSync(`${DIST}/assets`)) {
  const m = f.match(/^(.*)-[A-Za-z0-9_-]{8,}(\.[a-z]+)$/);
  if (m) assetIndex.set(m[1] + m[2], f);
}
const rewriteAssets = (html) =>
  html.replace(
    /\/assets\/([A-Za-z0-9._-]+?)-[A-Za-z0-9_-]{8,}(\.[a-z]+)/g,
    (whole, base, ext) => {
      const current = assetIndex.get(base + ext);
      return current ? `/assets/${current}` : whole;
    },
  );

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
  ".xml": "application/xml",
  ".md": "text/markdown",
};

const resolveFile = (urlPath) => {
  const clean = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  const direct = path.join(DIST, clean);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
  const asDir = path.join(DIST, clean, "index.html");
  return fs.existsSync(asDir) ? asDir : null;
};

// Records each shift's sources, not just the total: which element moved, from
// where to where. Plus a geometry sample every 200ms.
const OBSERVER = `
window.__cls = { total: 0, shifts: [] };
window.__trace = [];
const describe = (node) => {
  if (!node || node.nodeType !== 1) return "(non-element)";
  const bits = [node.tagName.toLowerCase()];
  if (node.id) bits.push("#" + node.id);
  const cls = (node.getAttribute("class") || "").trim().split(/\\s+/).filter(Boolean).slice(0, 4);
  if (cls.length) bits.push("." + cls.join("."));
  const sect = node.closest && node.closest("[data-og]");
  if (sect) bits.push("[data-og=" + sect.getAttribute("data-og") + "]");
  const txt = (node.textContent || "").trim().slice(0, 40);
  if (txt) bits.push('"' + txt + '"');
  return bits.join(" ");
};
setInterval(() => {
  const secs = [...document.querySelectorAll("main section, #root > div > section")];
  window.__trace.push({
    t: Math.round(performance.now()),
    docH: Math.round(document.documentElement.scrollHeight),
    secs: secs.map((s, i) => {
      const r = s.getBoundingClientRect();
      return (s.getAttribute("data-og") || "section#" + i) +
        ":y" + Math.round(r.y + window.scrollY) + ",h" + Math.round(r.height);
    }),
  });
}, 200);
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    if (e.hadRecentInput) continue;
    window.__cls.total += e.value;
    window.__cls.shifts.push({
      value: e.value,
      t: Math.round(e.startTime),
      sources: (e.sources || []).map((s) => ({
        node: describe(s.node),
        prev: s.previousRect ? [Math.round(s.previousRect.y), Math.round(s.previousRect.height)] : null,
        cur: s.currentRect ? [Math.round(s.currentRect.y), Math.round(s.currentRect.height)] : null,
      })),
    });
  }
}).observe({ type: "layout-shift", buffered: true });
`;

const measure = async (browser, route) => {
  const context = await browser.newContext({
    ...(argv.includes("--desktop")
      ? { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } }
      : devices["Pixel 5"]),
    baseURL: ORIGIN,
  });
  await context.addInitScript(OBSERVER);
  const page = await context.newPage();

  const missed = [];
  await page.route(`${ORIGIN}/**`, async (r) => {
    const url = new URL(r.request().url());
    const file = resolveFile(url.pathname);
    if (!file) {
      missed.push(url.pathname);
      return r.fulfill({ status: 404, body: "not in dist" });
    }
    const ext = path.extname(file);
    if (ext === ".html") {
      return r.fulfill({
        status: 200,
        contentType: MIME[".html"],
        body: rewriteAssets(fs.readFileSync(file, "utf8")),
      });
    }
    return r.fulfill({
      status: 200,
      contentType: MIME[ext] || "application/octet-stream",
      body: fs.readFileSync(file),
    });
  });

  const slow = argv
    .filter((a, i) => argv[i - 1] === "--slow")
    .map((a) => a.split(":"));
  if (slow.length) {
    await page.route("**storage.googleapis.com/**", async (r) => {
      const hit = slow.find(([sub]) => r.request().url().includes(sub));
      if (hit) await new Promise((res) => setTimeout(res, Number(hit[1])));
      await r.continue();
    });
  }

  const t0 = Date.now();
  const dataRequests = [];
  page.on("response", (res) => {
    if (res.url().includes("storage.googleapis.com")) {
      dataRequests.push(
        `${res.status()} ${res.url().split("/").pop()} @${Date.now() - t0}ms`,
      );
    }
  });
  page.on("requestfailed", (r) => {
    if (r.url().includes("storage.googleapis.com")) {
      dataRequests.push(`FAILED ${r.url().split("/").pop()}`);
    }
  });

  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  await page.goto(`${ORIGIN}${route}`, {
    waitUntil: "commit",
    timeout: 120_000,
  });
  await page.waitForTimeout(SETTLE_MS);

  const cls = await page.evaluate(() => window.__cls);
  const trace = await page.evaluate(() => window.__trace);
  await context.close();
  return { cls, trace, dataRequests, missed: [...new Set(missed)] };
};

const browser = await chromium.launch();
let worstOverall = 0;
for (const route of ROUTES) {
  const results = [];
  for (let i = 0; i < RUNS; i++) results.push(await measure(browser, route));
  const totals = results.map((r) => r.cls.total);
  const median = [...totals].sort((a, b) => a - b)[Math.floor(RUNS / 2)];
  worstOverall = Math.max(worstOverall, ...totals);

  console.log(`\n=== ${route} ===`);
  console.log(
    `CLS runs: ${totals.map((t) => t.toFixed(4)).join("  ")}   median=${median.toFixed(4)}`,
  );
  results.forEach((r, i) => {
    console.log(
      `  run ${i + 1}: ${r.cls.total.toFixed(4)} = ${
        r.cls.shifts
          .map((s) => `${s.value.toFixed(4)}@${s.t}ms`)
          .join(" + ") || "(no shifts)"
      }`,
    );
  });

  const worst = results[totals.indexOf(Math.max(...totals))];
  if (worst.missed.length) {
    console.log(`  404 (not in dist): ${worst.missed.slice(0, 10).join(", ")}`);
  }
  console.log(`  data: ${worst.dataRequests.join(" | ") || "(none)"}`);
  for (const s of worst.cls.shifts) {
    console.log(`   ${s.value.toFixed(4)} @${s.t}ms`);
    for (const src of s.sources.slice(0, 6)) {
      console.log(
        `        ${src.node}  y/h ${JSON.stringify(src.prev)} -> ${JSON.stringify(src.cur)}`,
      );
    }
  }
  if (argv.includes("--trace")) {
    console.log(`  --- layout trace (frames that changed) ---`);
    let prev = "";
    for (const f of worst.trace) {
      const line = f.secs.join(" | ");
      if (line === prev) continue;
      prev = line;
      console.log(`   @${f.t}ms docH=${f.docH}\n      ${line}`);
    }
  }
}
await browser.close();

// Non-zero on a WORST-run breach, not a median one: CLS is a per-visit metric
// and the ordering that produces the bad run is a real visit.
if (worstOverall >= 0.1) {
  console.error(`\nCLS ${worstOverall.toFixed(4)} breaches the 0.1 CWV budget`);
  process.exit(1);
}
