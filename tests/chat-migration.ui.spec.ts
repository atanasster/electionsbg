import { expect, test } from "@playwright/test";

for (const prefix of ["", "/en"]) {
  test(`integrated chat navigation ${prefix || "bg"}`, async ({
    page,
  }, testInfo) => {
    const en = prefix === "/en";
    await page.goto(`${prefix}/chat`);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: en ? "Ask Наясно" : "Попитай Наясно",
      }),
    ).toBeAttached({ timeout: 20_000 });
    const toolbar = page.locator("[data-chat-toolbar]");
    await expect(toolbar.getByRole("button")).toHaveCount(3);
    await expect(
      page.getByRole("link", { name: "Наясно AI", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: en ? "Theme" : "Тема", exact: true }),
    ).toHaveCount(0);
    const tools = page.getByRole("button", {
      name: en ? "Tools" : "Инструменти",
      exact: true,
    });
    await tools.click();
    await expect(page).toHaveURL(new RegExp(`${prefix}/chat/tools$`));
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: en ? "Tools & data" : "Инструменти и данни",
      }),
    ).toBeVisible();
    await page.goBack();
    await expect(
      page.getByRole("textbox", {
        name: en ? "Ask about the data…" : "Попитайте за данните…",
      }),
    ).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`${prefix}/chat/tools$`));
    await toolbar
      .getByRole("button", { name: en ? "Accuracy" : "Точност", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${prefix}/chat/evals$`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      en ? "AI tool evaluation" : "Оценка на AI инструментите",
    );
    await expect(page.locator("footer")).toHaveCount(0);
    await expect(toolbar.getByRole("button")).toHaveCount(3);
    await toolbar
      .getByRole("button", { name: en ? "New chat" : "Нов чат", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${prefix}/chat$`));
    await expect(page.getByRole("textbox")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`evals-${en ? "en" : "bg"}.png`),
    });
  });
}

test("a linked question has an answer, source and reachable composer", async ({
  page,
}, testInfo) => {
  await page.goto(
    `/chat?q=${encodeURIComponent("Колко места има всяка партия в парламента?")}`,
  );
  await expect(page.locator("[data-answer-card]")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("link", { name: /Народно събрание/ }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Нов чат", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("textbox")).toBeVisible();
  const overflowing = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflowing).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("chat-answer.png") });
  await page
    .locator("[data-chat-toolbar]")
    .getByRole("button", { name: "Нов чат", exact: true })
    .click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.locator("[data-answer-card]")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("naiasno.chat.v1") || "[]").length,
      ),
    )
    .toBe(0);
});
