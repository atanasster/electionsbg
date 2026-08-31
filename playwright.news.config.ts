import { defineConfig, devices } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:5190";

export default defineConfig({
  testDir: "./tests/news",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: "npm run dev:news -- --host 127.0.0.1",
    url: `${BASE_URL}/test-fixtures/story-cards.html`,
    reuseExistingServer: true,
    timeout: 30_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
