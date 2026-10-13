import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
const runId = randomUUID();
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  outputDir: join(tmpdir(), `bead-test-results-${runId}`),
  expect: { timeout: 10000 },
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder: join(tmpdir(), `bead-test-report-${runId}`),
      },
    ],
  ],
  use: {
    baseURL: "http://127.0.0.1:5174",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    channel: process.platform === "win32" ? "msedge" : undefined,
  },
  webServer: [
    {
      command: "npm run dev:api",
      url: "http://127.0.0.1:3011/api/v1/health",
      reuseExistingServer: false,
      timeout: 30000,
      env: {
        PORT: "3011",
        DATABASE_PATH: join(tmpdir(), `bead-e2e-${randomUUID()}.sqlite`),
        SEED_DEMO: "false",
        API_TOKEN: "",
        PUBLIC_ORIGIN: "",
        HOST: "127.0.0.1",
      },
    },
    {
      command: "npm run dev:web -- --port 5174",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: false,
      timeout: 30000,
      env: {
        API_TARGET: "http://127.0.0.1:3011",
        VITE_CACHE_DIR: join(tmpdir(), `bead-vite-${randomUUID()}`),
      },
    },
  ],
});
