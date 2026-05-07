import { defineConfig } from "@playwright/test";

const cmEnabled = process.env.E2E_CODEMIRROR === "1";
const PORT = cmEnabled ? 30130 : 30129;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
  },
  webServer: {
    command: `NEXT_PUBLIC_LOCAL_STANDALONE=true${cmEnabled ? " NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR=true" : ""} bunx next start -p ${PORT}`,
    cwd: ".",
    port: PORT,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "chromium",
      use: {},
    },
  ],
});
