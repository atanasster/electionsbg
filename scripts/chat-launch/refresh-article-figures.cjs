// Refresh only published figures after a UI change. Public live data is read,
// never fabricated. A local UI can proxy its data reads to the hosted sources.
const { chromium } = require("playwright");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const root = require("node:path").resolve("docs/plans/chat-launch-assets");
const origin =
  process.env.CHAT_CAPTURE_ORIGIN ||
  "https://elections-bg--chat-launch-gu0gkopz.web.app";
const hosted = "https://elections-bg--chat-launch-gu0gkopz.web.app";
const prior = JSON.parse(fs.readFileSync(`${root}/examples.json`)).examples;
const captures = [];
const waitAnswer = (p, question, count = 1) =>
  p.waitForFunction(
    ({ question, count }) => {
      const messages = JSON.parse(
        localStorage.getItem("naiasno.chat.v1") || "[]",
      );
      return (
        messages.filter((m) => m.role === "assistant" && m.env).length ===
          count &&
        messages.filter((m) => m.role === "user").at(-1)?.text === question &&
        !!messages.at(-1)?.meta
      );
    },
    { question, count },
    { timeout: 45000 },
  );
(async () => {
  const browser = await chromium.launch();
  try {
    for (const lang of ["bg", "en"]) {
      const context = await browser.newContext({
        viewport: { width: 800, height: 1200 },
        deviceScaleFactor: 1,
      });
      if (origin !== hosted)
        await context.route("**/*", async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          if (
            url.origin === origin &&
            ["fetch", "xhr"].includes(request.resourceType()) &&
            (url.pathname.startsWith("/api/db/") ||
              url.pathname.endsWith(".json"))
          ) {
            const target = url.pathname.startsWith("/api/db/")
              ? hosted
              : "https://storage.googleapis.com/data-electionsbg-com";
            await route.fulfill({
              response: await route.fetch({
                url: target + url.pathname + url.search,
              }),
            });
          } else await route.continue();
        });
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      const prefix = lang === "en" ? "/en" : "";
      const mode = () =>
        page.getByRole("button", {
          name: lang === "en" ? "Choose mode" : "Изберете режим",
          exact: true,
        });
      await page.goto(origin + prefix + "/chat", {
        waitUntil: "domcontentloaded",
      });
      await mode().waitFor();
      const main = page.locator("main");
      const height = await main.evaluate(
        (e) => e.getBoundingClientRect().height,
      );
      await page.setViewportSize({
        width: 800,
        height: Math.round(1200 + 1024 - height),
      });
      await main.evaluate((e) => (e.scrollTop = 0));
      await main.screenshot({ path: `${root}/originals/start-${lang}.png` });
      captures.push({
        id: "start",
        lang,
        uiOrigin: origin,
        dataOrigin: hosted,
        capturedAt: new Date().toISOString(),
      });
      await page.setViewportSize({ width: 800, height: 1200 });
      await mode().click();
      await page
        .locator("summary")
        .filter({
          hasText:
            lang === "en" ? "Limits and privacy" : "Лимити и поверителност",
        })
        .last()
        .click();
      await page.screenshot({ path: `${root}/originals/limits-${lang}.png` });
      await page.keyboard.press("Escape");
      captures.push({
        id: "limits",
        lang,
        uiOrigin: origin,
        capturedAt: new Date().toISOString(),
      });
      await page.setViewportSize({
        width: 800,
        height: Math.round(1200 + 1024 - height),
      });
      for (const id of ["budget", "tenders"]) {
        const old = prior.find((e) => e.id === id && e.lang === lang);
        await page.goto(origin + old.href, { waitUntil: "domcontentloaded" });
        await waitAnswer(page, old.prompt);
        if (id === "tenders") {
          const follow = prior.find(
            (e) => e.id === "followup" && e.lang === lang,
          );
          await page
            .getByRole("button", { name: follow.prompt, exact: true })
            .click();
          await waitAnswer(page, follow.prompt, 2);
        }
        const actualId = id === "tenders" ? "followup" : id;
        const oldResult = prior.find(
          (e) => e.id === actualId && e.lang === lang,
        );
        const messages = await page.evaluate(() =>
          JSON.parse(localStorage.getItem("naiasno.chat.v1")),
        );
        assert.deepEqual(
          messages.at(-1).env,
          oldResult.messages.at(-1).env,
          `${actualId}/${lang} source payload changed; review before publishing`,
        );
        assert.equal(messages.at(-1).text, oldResult.messages.at(-1).text);
        if (id === "budget") await main.evaluate((e) => (e.scrollTop = 0));
        await main.screenshot({
          path: `${root}/originals/${actualId}-${lang}.png`,
        });
        captures.push({
          id: actualId,
          lang,
          uiOrigin: origin,
          dataOrigin: hosted,
          messages,
          capturedAt: new Date().toISOString(),
        });
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(
    "/tmp/chat-toolbar-figure-captures.json",
    JSON.stringify(captures, null, 2) + "\n",
  );
  console.log(
    "All eight figures captured; answer text and envelopes match reviewed evidence.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
