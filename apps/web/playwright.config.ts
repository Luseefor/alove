import { defineConfig } from "@playwright/test";

const externalBaseUrl = process.env.E2E_BASE_URL;
const explicitEditorMode = process.env.E2E_EDITOR_MODE;
const editorMode =
  explicitEditorMode === "codemirror" || explicitEditorMode === "textarea"
    ? explicitEditorMode
    : process.env.E2E_CODEMIRROR === "0"
      ? "textarea"
      : "codemirror";
const PORT = editorMode === "codemirror" ? 30130 : 30129;
const editorModeEnv =
  editorMode === "textarea" ? " NEXT_PUBLIC_EDITOR_MODE=textarea" : "";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  use: {
    baseURL: externalBaseUrl ?? `http://127.0.0.1:${PORT}`,
  },
  webServer: externalBaseUrl ? undefined : {
    command: `NEXT_PUBLIC_LOCAL_STANDALONE=true ALOVE_LOCAL_COMPILE_ORIGIN=http://127.0.0.1:${PORT}${editorModeEnv} bunx next start -H 127.0.0.1 -p ${PORT}`,
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
