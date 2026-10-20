import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { probeCompileRuntime } from "../src/compileRuntime.ts";

const originalEnv = { ...process.env };
let fixtureDirectory;

afterEach(async () => {
  process.env = { ...originalEnv };
  if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true });
  fixtureDirectory = undefined;
});

async function makeFixtureDir() {
  if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true });
  fixtureDirectory = await mkdtemp(join(tmpdir(), "alove-runtime-fixture-"));
  return fixtureDirectory;
}

async function installFakeDocker() {
  const dir = await makeFixtureDir();
  const recordPath = join(dir, "docker-argv.json");
  const dockerPath = join(dir, "docker");
  await writeFile(
    dockerPath,
    `#!${process.execPath}
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify(process.argv.slice(2)));
const sleepMs = Number(process.env.ALOVE_FIXTURE_SLEEP_MS ?? "0");
if (Number.isFinite(sleepMs) && sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs));
if (process.env.ALOVE_FIXTURE_EXIT === "1") { console.error("boom"); process.exit(1); }
if (process.env.ALOVE_FIXTURE_BIG === "1") { console.log("x".repeat(8192)); process.exit(0); }
if (process.env.ALOVE_FIXTURE_OUTPUT !== undefined) { console.log(process.env.ALOVE_FIXTURE_OUTPUT); process.exit(0); }
console.log("sha256:" + "a".repeat(64) + "|linux/amd64");
`,
  );
  await chmod(dockerPath, 0o755);
  process.env.PATH = `${dir}:${dirname(process.execPath)}:${originalEnv.PATH ?? ""}`;
  return { dir, recordPath };
}

async function installFakeLatexmk() {
  const dir = await makeFixtureDir();
  const recordPath = join(dir, "latexmk-argv.json");
  const latexmkPath = join(dir, "latexmk");
  await writeFile(
    latexmkPath,
    `#!${process.execPath}
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify(process.argv.slice(2)));
if (process.env.ALOVE_FIXTURE_EXIT === "1") { console.error("boom"); process.exit(1); }
console.log("Latexmk, John Collins, fake");
`,
  );
  await chmod(latexmkPath, 0o755);
  process.env.PATH = `${dir}:${dirname(process.execPath)}:${originalEnv.PATH ?? ""}`;
  return { dir, recordPath };
}

async function readArgv(recordPath) {
  return JSON.parse(await readFile(recordPath, "utf8"));
}

describe("probeCompileRuntime docker mode", () => {
  it("returns true for valid inspect output and passes exact argv", async () => {
    const { recordPath } = await installFakeDocker();
    process.env.COMPILE_USE_DOCKER = "true";
    process.env.COMPILE_DOCKER_IMAGE = "test-image:1";
    const ok = await probeCompileRuntime();
    expect(ok).toBe(true);
    expect(await readArgv(recordPath)).toEqual([
      "image",
      "inspect",
      "--format",
      "{{.Id}}|{{.Os}}/{{.Architecture}}",
      "test-image:1",
    ]);
  });

  it("uses the default image when COMPILE_DOCKER_IMAGE is unset", async () => {
    const { recordPath } = await installFakeDocker();
    process.env.COMPILE_USE_DOCKER = "true";
    delete process.env.COMPILE_DOCKER_IMAGE;
    expect(await probeCompileRuntime()).toBe(true);
    expect((await readArgv(recordPath)).at(-1)).toBe(
      "ghcr.io/xu-cheng/texlive-full:latest",
    );
  });

  it("defaults to docker mode when COMPILE_USE_DOCKER is unset", async () => {
    const { recordPath } = await installFakeDocker();
    delete process.env.COMPILE_USE_DOCKER;
    delete process.env.COMPILE_DOCKER_IMAGE;
    expect(await probeCompileRuntime()).toBe(true);
    expect((await readArgv(recordPath))[0]).toBe("image");
  });

  it("returns false when docker exits nonzero", async () => {
    await installFakeDocker();
    process.env.COMPILE_USE_DOCKER = "true";
    process.env.ALOVE_FIXTURE_EXIT = "1";
    expect(await probeCompileRuntime()).toBe(false);
  });

  it("returns false for malformed inspect output", async () => {
    await installFakeDocker();
    process.env.COMPILE_USE_DOCKER = "true";
    const bad = [
      "",
      "not-an-id",
      `sha256:${"A".repeat(64)}|linux/amd64`,
      `sha256:${"a".repeat(63)}|linux/amd64`,
      `sha256:${"a".repeat(64)}`,
      `sha256:${"a".repeat(64)}|`,
      `sha256:${"a".repeat(64)}|linux`,
      `sha256:${"a".repeat(64)}|linux/amd64|extra`,
      `sha256:${"a".repeat(64)}|linux/amd64\nsha256:${"b".repeat(64)}|linux/amd64`,
      "   ",
    ];
    for (const output of bad) {
      process.env.ALOVE_FIXTURE_OUTPUT = output;
      process.env.ALOVE_FIXTURE_EXIT = "";
      expect(await probeCompileRuntime()).toBe(false);
    }
  });

  it("returns false on timeout", async () => {
    await installFakeDocker();
    process.env.COMPILE_USE_DOCKER = "true";
    process.env.ALOVE_FIXTURE_SLEEP_MS = "5000";
    expect(await probeCompileRuntime()).toBe(false);
  }, 10000);

  it("returns false when already aborted", async () => {
    await installFakeDocker();
    process.env.COMPILE_USE_DOCKER = "true";
    const controller = new AbortController();
    controller.abort();
    expect(await probeCompileRuntime(controller.signal)).toBe(false);
  });

  it("returns false when aborted mid-flight", async () => {
    await installFakeDocker();
    process.env.COMPILE_USE_DOCKER = "true";
    process.env.ALOVE_FIXTURE_SLEEP_MS = "2000";
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    expect(await probeCompileRuntime(controller.signal)).toBe(false);
  });

  it("returns false when output exceeds the cap", async () => {
    await installFakeDocker();
    process.env.COMPILE_USE_DOCKER = "true";
    process.env.ALOVE_FIXTURE_BIG = "1";
    expect(await probeCompileRuntime()).toBe(false);
  });

  it("validates sandbox policy before running docker inspect", async () => {
    const { dir } = await installFakeDocker();
    process.env.COMPILE_USE_DOCKER = "true";
    process.env.COMPILE_SANDBOX_MEMORY_MB = "lots";
    const marker = join(dir, "docker-argv.json");
    await rm(marker, { force: true });
    expect(await probeCompileRuntime()).toBe(false);
    let called = true;
    try {
      await readFile(marker, "utf8");
    } catch {
      called = false;
    }
    expect(called).toBe(false);
  });

  it("reads fresh image on every call without caching", async () => {
    const { recordPath } = await installFakeDocker();
    process.env.COMPILE_USE_DOCKER = "true";
    process.env.COMPILE_DOCKER_IMAGE = "image-a:1";
    expect(await probeCompileRuntime()).toBe(true);
    expect((await readArgv(recordPath)).at(-1)).toBe("image-a:1");
    process.env.COMPILE_DOCKER_IMAGE = "image-b:2";
    expect(await probeCompileRuntime()).toBe(true);
    expect((await readArgv(recordPath)).at(-1)).toBe("image-b:2");
  });
});

describe("probeCompileRuntime host mode", () => {
  it("returns true for trusted host with working latexmk and exact argv", async () => {
    const { recordPath } = await installFakeLatexmk();
    process.env.COMPILE_USE_DOCKER = "false";
    process.env.COMPILE_TRUSTED_LOCAL = "true";
    delete process.env.NODE_ENV;
    expect(await probeCompileRuntime()).toBe(true);
    expect(await readArgv(recordPath)).toEqual(["-v"]);
  });

  it("treats COMPILE_USE_DOCKER=0 as host mode", async () => {
    const { recordPath } = await installFakeLatexmk();
    process.env.COMPILE_USE_DOCKER = "0";
    process.env.COMPILE_TRUSTED_LOCAL = "true";
    delete process.env.NODE_ENV;
    expect(await probeCompileRuntime()).toBe(true);
    expect(await readArgv(recordPath)).toEqual(["-v"]);
  });

  it("returns false without spawning when host is untrusted", async () => {
    const { dir } = await installFakeLatexmk();
    process.env.COMPILE_USE_DOCKER = "false";
    delete process.env.COMPILE_TRUSTED_LOCAL;
    const marker = join(dir, "latexmk-argv.json");
    await rm(marker, { force: true });
    expect(await probeCompileRuntime()).toBe(false);
    let called = true;
    try {
      await readFile(marker, "utf8");
    } catch {
      called = false;
    }
    expect(called).toBe(false);
  });

  it("returns false without spawning in production even when trusted", async () => {
    const { dir } = await installFakeLatexmk();
    process.env.COMPILE_USE_DOCKER = "false";
    process.env.COMPILE_TRUSTED_LOCAL = "true";
    process.env.NODE_ENV = "production";
    const marker = join(dir, "latexmk-argv.json");
    await rm(marker, { force: true });
    expect(await probeCompileRuntime()).toBe(false);
    let called = true;
    try {
      await readFile(marker, "utf8");
    } catch {
      called = false;
    }
    expect(called).toBe(false);
  });

  it("returns false when latexmk is missing", async () => {
    const dir = await makeFixtureDir();
    process.env.COMPILE_USE_DOCKER = "false";
    process.env.COMPILE_TRUSTED_LOCAL = "true";
    delete process.env.NODE_ENV;
    process.env.PATH = `${dir}:${dirname(process.execPath)}`;
    expect(await probeCompileRuntime()).toBe(false);
  });

  it("returns false when latexmk exits nonzero", async () => {
    await installFakeLatexmk();
    process.env.COMPILE_USE_DOCKER = "false";
    process.env.COMPILE_TRUSTED_LOCAL = "true";
    delete process.env.NODE_ENV;
    process.env.ALOVE_FIXTURE_EXIT = "1";
    expect(await probeCompileRuntime()).toBe(false);
  });
});
