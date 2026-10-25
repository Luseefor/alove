import { spawnSync } from "node:child_process";

// Explicit administrative proof only. Ordinary builds never create test VMs.
if (process.env.WEFTLY_VERIFY_SANDBOX === "1") {
  await import("./verify-vercel-sandbox");
}

const build = spawnSync(
  "bunx",
  [
    "--no-install",
    "convex",
    "deploy",
    "--cmd",
    "bun run build",
    "--cmd-url-env-var-name",
    "NEXT_PUBLIC_CONVEX_URL",
  ],
  { stdio: "inherit", env: process.env },
);
if (build.error) throw build.error;
process.exit(build.status ?? 1);
