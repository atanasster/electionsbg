// Run from repository root after refreshing the isolated preview. Does not publish.
const { chromium } = require("playwright");
const fs = require("fs");
const root = require("path").resolve("docs/plans/chat-launch-assets");
const waitAnswer = (p, q) =>
  p.waitForFunction(
    (q) => {
      const ms = JSON.parse(localStorage.getItem("naiasno.chat.v1") || "[]");
      return (
        ms[0]?.text === q &&
        ms.at(-1)?.role === "assistant" &&
        !!ms.at(-1)?.meta
      );
    },
    q,
    { timeout: 45000 },
  );
(async () => {
  const b = await chromium.launch({ headless: true });
  const result = [];
  for (const lang of ["bg", "en"]) {
    const c = await b.newContext({
      viewport: { width: 800, height: 1200 },
      deviceScaleFactor: 1,
    });
    const p = await c.newPage();
    const prefix = lang === "en" ? "/en" : "";
    const origin = "https://elections-bg--chat-launch-gu0gkopz.web.app";
    await p.goto(origin + prefix + "/chat");
    await p
      .getByRole("button", {
        name: lang === "bg" ? "Изберете режим" : "Choose mode",
      })
      .waitFor();
    await p.waitForTimeout(1000);
    await p.locator("main").evaluate((el) => (el.scrollTop = 0));
    await p
      .locator("main")
      .screenshot({ path: `${root}/originals/start-${lang}.png` });
    await p
      .getByRole("button", {
        name: lang === "bg" ? "Изберете режим" : "Choose mode",
      })
      .click();
    await p
      .locator("summary")
      .filter({
        hasText:
          lang === "bg" ? "Лимити и поверителност" : "Limits and privacy",
      })
      .last()
      .click();
    await p.screenshot({ path: `${root}/originals/limits-${lang}.png` });
    await p.keyboard.press("Escape");
    const prompts = [
      [
        "prices",
        lang === "bg"
          ? "Какви са цените в Пловдив?"
          : "What are the prices in Plovdiv?",
      ],
      [
        "budget",
        lang === "bg"
          ? "Какъв е държавният бюджет — план и изпълнение?"
          : "What is the state budget — plan and actual spending?",
      ],
      [
        "seats",
        lang === "bg"
          ? "Колко места има всяка партия в парламента?"
          : "How many seats does each party hold in parliament?",
      ],
      [
        "tenders",
        lang === "bg"
          ? "Покажи ми всички търгове за пътни предпазни съоръжения през 2025"
          : "Show me all road-guardrail tenders in 2025",
      ],
      [
        "section",
        lang === "bg"
          ? "Как е гласувала секция 050900092 през годините?"
          : "How has section 050900092 voted over the years?",
      ],
      [
        "gap",
        lang === "bg"
          ? "Какъв е държавният бюджет през 2027?"
          : "What is the state budget in 2027?",
      ],
    ];
    for (const [id, q] of prompts) {
      const href = prefix + "/chat?" + new URLSearchParams({ q });
      await p.goto(origin + href);
      await waitAnswer(p, q);
      await p.waitForTimeout(700);
      const messages = await p.evaluate(() =>
        JSON.parse(localStorage.getItem("naiasno.chat.v1") || "[]"),
      );
      const links = await p.locator("main a").evaluateAll((els) =>
        els.map((a) => ({
          text: a.textContent,
          href: a.getAttribute("href"),
        })),
      );
      result.push({
        id,
        lang,
        prompt: q,
        href,
        messages,
        links,
        capturedAt: new Date().toISOString(),
      });
      fs.writeFileSync(
        "/tmp/chat-launch-final-examples.json",
        JSON.stringify(result, null, 2),
      );
      await p.locator("main").evaluate((el) => (el.scrollTop = 0));
      await p
        .locator("main")
        .screenshot({ path: `${root}/originals/${id}-${lang}.png` });
      console.log(id, lang, messages.at(-1)?.text);
      if (id === "tenders") {
        const follow =
          lang === "bg"
            ? "Покажи поръчката 00044-2025-0125"
            : "Show tender 00044-2025-0125";
        await p.getByRole("button", { name: follow, exact: true }).click();
        await p.waitForFunction(
          () =>
            JSON.parse(localStorage.getItem("naiasno.chat.v1") || "[]").filter(
              (m) => m.role === "assistant" && m.env,
            ).length === 2,
          {},
          { timeout: 45000 },
        );
        await p.waitForTimeout(500);
        const followMessages = await p.evaluate(() =>
          JSON.parse(localStorage.getItem("naiasno.chat.v1") || "[]"),
        );
        result.push({
          id: "followup",
          lang,
          prompt: follow,
          messages: followMessages,
          capturedAt: new Date().toISOString(),
        });
        fs.writeFileSync(
          "/tmp/chat-launch-final-examples.json",
          JSON.stringify(result, null, 2),
        );
        await p
          .locator("main")
          .screenshot({ path: `${root}/originals/followup-${lang}.png` });
      }
    }
    await c.close();
  }
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
