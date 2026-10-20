import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runCompileJob } from "../src/runCompile.ts";

const originalEnv = { ...process.env };
const cleanupDirs = [];

afterEach(async () => {
  process.env = { ...originalEnv };
  for (const dir of cleanupDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function trackTemp(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

async function installFakeLatexmk() {
  const fixtureDirectory = await trackTemp("alove-cancel-fixture-");
  const executable = join(fixtureDirectory, "latexmk");
  await writeFile(
    executable,
    `#!${process.execPath}
import { appendFileSync, writeFileSync } from "node:fs";
const marker = process.env.ALOVE_SPAWN_MARKER;
if (marker) {
  try { appendFileSync(marker, "spawn\\n"); } catch {}
}
const capture = process.env.ALOVE_CAPTURE_FILE;
if (capture) {
  try { writeFileSync(capture, process.cwd()); } catch {}
}
const mode = process.env.ALOVE_WORKER_FIXTURE_MODE;
if (mode === "slow") {
  await Bun.sleep(8000);
  const name = process.argv.at(-1);
  writeFileSync(name.replace(/\\.tex$/, ".pdf"), "%PDF-slow-fixture");
  writeFileSync(name.replace(/\\.tex$/, ".log"), "slow done");
} else {
  const name = process.argv.at(-1);
  writeFileSync(name.replace(/\\.tex$/, ".pdf"), "%PDF-test-fixture");
  writeFileSync(name.replace(/\\.tex$/, ".log"), "fast done");
}
`,
  );
  await chmod(executable, 0o755);
  process.env.PATH = `${fixtureDirectory}:${dirname(process.execPath)}:${originalEnv.PATH}`;
  process.env.COMPILE_USE_DOCKER = "false";
  process.env.COMPILE_TRUSTED_LOCAL = "true";
  return fixtureDirectory;
}

function payload() {
  return {
    projectId: "local",
    mainFile: "main.tex",
    files: { "main.tex": "source" },
  };
}

async function aloveTexLeftovers(root) {
  const resolved = await realpath(root);
  const entries = await readdir(resolved);
  return entries.filter((e) => e.startsWith("alove-tex-"));
}

describe("runCompile cancellation", () => {
  it("pre-aborted signal returns CANCELLED without spawning or temp", async () => {
    const fixture = await installFakeLatexmk();
    const workRoot = await trackTemp("alove-cancel-work-");
    process.env.COMPILE_WORK_ROOT = workRoot;
    const marker = join(fixture, "spawns.log");
    process.env.ALOVE_SPAWN_MARKER = marker;
    const before = await aloveTexLeftovers(workRoot);

    const controller = new AbortController();
    controller.abort();
    const result = await runCompileJob(payload(), { signal: controller.signal });

    expect(result.phase).toBe("failed");
    expect(result.errorCode).toBe("CANCELLED");
    expect(result.errorCode).not.toBe("TIMEOUT");
    expect(result.timedOut ?? false).toBe(false);
    expect(result.pdfBase64).toBeUndefined();
    let spawned = false;
    try {
      await Bun.file(marker).text();
      spawned = true;
    } catch {
      spawned = false;
    }
    expect(spawned).toBe(false);
    expect(await aloveTexLeftovers(workRoot)).toEqual(before);
  });

  it("abort during slow run returns CANCELLED promptly and cleans temp", async () => {
    await installFakeLatexmk();
    const workRoot = await trackTemp("alove-cancel-work-");
    process.env.COMPILE_WORK_ROOT = workRoot;
    process.env.ALOVE_WORKER_FIXTURE_MODE = "slow";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 200);
    const started = Date.now();
    try {
      const result = await runCompileJob(
        { ...payload(), timeoutMs: 10000 },
        { signal: controller.signal },
      );
      const elapsed = Date.now() - started;
      expect(result.phase).toBe("failed");
      expect(result.errorCode).toBe("CANCELLED");
      expect(result.timedOut ?? false).toBe(false);
      expect(result.pdfBase64).toBeUndefined();
      expect(elapsed).toBeLessThan(5000);
      expect(await aloveTexLeftovers(workRoot)).toEqual([]);
    } finally {
      clearTimeout(timer);
    }
  });

  it("slow run without abort still reports TIMEOUT", async () => {
    await installFakeLatexmk();
    const workRoot = await trackTemp("alove-cancel-work-");
    process.env.COMPILE_WORK_ROOT = workRoot;
    process.env.ALOVE_WORKER_FIXTURE_MODE = "slow";
    const result = await runCompileJob({ ...payload(), timeoutMs: 1000 });
    expect(result.errorCode).toBe("TIMEOUT");
    expect(result.timedOut).toBe(true);
    expect(result.pdfBase64).toBeUndefined();
    expect(await aloveTexLeftovers(workRoot)).toEqual([]);
  });

  it("configured COMPILE_WORK_ROOT is used for temp", async () => {
    await installFakeLatexmk();
    const workRoot = await trackTemp("alove-cancel-work-");
    process.env.COMPILE_WORK_ROOT = workRoot;
    const capture = join(workRoot, "cwd.txt");
    process.env.ALOVE_CAPTURE_FILE = capture;
    const result = await runCompileJob(payload());
    expect(result.phase).toBe("ready");
    const cwd = await Bun.file(capture).text();
    expect(cwd.startsWith(await realpath(workRoot))).toBe(true);
    expect(await aloveTexLeftovers(workRoot)).toEqual([]);
  });

  it("relative COMPILE_WORK_ROOT is rejected", async () => {
    await installFakeLatexmk();
    process.env.COMPILE_WORK_ROOT = "relative/path";
    const result = await runCompileJob(payload());
    expect(result.phase).toBe("failed");
    expect(result.errorMessage).toMatch(/COMPILE_WORK_ROOT/i);
    expect(result.pdfBase64).toBeUndefined();
  });
});
