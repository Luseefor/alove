import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runCompileJob } from "../src/runCompile.ts";

const originalEnv = { ...process.env };
let fixtureDirectory;

afterEach(async () => {
  process.env = { ...originalEnv };
  if (fixtureDirectory)
    await rm(fixtureDirectory, { recursive: true, force: true });
  fixtureDirectory = undefined;
});

async function installFakeLatexmk() {
  fixtureDirectory = await mkdtemp(join(tmpdir(), "alove-worker-fixture-"));
  const executable = join(fixtureDirectory, "latexmk");
  await writeFile(
    executable,
    `#!${process.execPath}
import { writeFileSync, symlinkSync } from "node:fs";
const args = process.argv.slice(2);
if (!args.includes("-c") && process.env.ALOVE_WORKER_FIXTURE_MODE !== "no-output") {
  const name = args.at(-1);
  writeFileSync(name.replace(/\\.tex$/, ".pdf"), "%PDF-test-fixture");
  if (process.env.ALOVE_WORKER_FIXTURE_MODE === "external-log") {
    symlinkSync(process.env.ALOVE_WORKER_FIXTURE_LOG, name.replace(/\\.tex$/, ".log"));
  } else {
    writeFileSync(name.replace(/\\.tex$/, ".log"), process.env.ALOVE_WORKER_FIXTURE_MODE === "large-log" ? "x".repeat(100000) : JSON.stringify(args));
  }
}
`,
  );
  await chmod(executable, 0o755);
  process.env.PATH = `${fixtureDirectory}:${dirname(process.execPath)}:${originalEnv.PATH}`;
  process.env.COMPILE_USE_DOCKER = "false";
  process.env.COMPILE_TRUSTED_LOCAL = "true";
}

describe("worker process boundary", () => {
  it("passes a metacharacter filename as one argument and disables project rc/shell escape", async () => {
    await installFakeLatexmk();
    const filename = "paper;echo injected.tex";
    const result = await runCompileJob({
      projectId: "local",
      mainFile: filename,
      engine: "xelatex",
      cleanAux: true,
      files: {
        [filename]: "source",
        ".latexmkrc": "This must not be evaluated",
      },
    });
    expect(result.phase).toBe("ready");
    const args = JSON.parse(result.log);
    expect(args).toContain("-norc");
    expect(args).toContain("-no-shell-escape");
    expect(args).toContain("-xelatex");
    expect(args.at(-1)).toBe(`./${filename}`);
    expect(Buffer.from(result.pdfBase64, "base64").toString()).toBe(
      "%PDF-test-fixture",
    );
  });

  it("does not treat caller-supplied PDFs as output from a no-output build", async () => {
    await installFakeLatexmk();
    process.env.ALOVE_WORKER_FIXTURE_MODE = "no-output";
    const result = await runCompileJob({
      projectId: "local",
      mainFile: "main.tex",
      files: {
        "main.tex": "source",
        "main.pdf": "%PDF-stale",
        "main.log": "old log",
      },
    });
    expect(result.phase).toBe("failed");
    expect(result.errorMessage).toContain("no PDF");
    expect(result.pdfBase64).toBeUndefined();
  });

  it("bounds artifact logs before reading them into memory", async () => {
    await installFakeLatexmk();
    process.env.ALOVE_WORKER_FIXTURE_MODE = "large-log";
    process.env.COMPILE_MAX_LOG_BYTES = "128";
    const result = await runCompileJob({
      projectId: "local",
      mainFile: "main.tex",
      files: { "main.tex": "source" },
    });
    expect(result.phase).toBe("ready");
    expect(Buffer.byteLength(result.log)).toBeLessThanOrEqual(128);
    expect(
      result.diagnostics.some((d) => d.message.includes("truncated")),
    ).toBe(true);
  });

  it("rejects artifact symlinks that point outside the job directory", async () => {
    await installFakeLatexmk();
    const externalLog = join(fixtureDirectory, "outside.log");
    await writeFile(externalLog, "fixture-secret-never-returned");
    process.env.ALOVE_WORKER_FIXTURE_MODE = "external-log";
    process.env.ALOVE_WORKER_FIXTURE_LOG = externalLog;
    const result = await runCompileJob({
      projectId: "local",
      mainFile: "main.tex",
      files: { "main.tex": "source" },
    });
    expect(result.phase).toBe("failed");
    expect(result.log).not.toContain("fixture-secret-never-returned");
    expect(result.errorMessage).toContain("leaves compile directory");
  });

  it("requires trusted local opt-in and refuses host execution in production", async () => {
    const payload = {
      projectId: "local",
      mainFile: "main.tex",
      files: { "main.tex": "source" },
    };
    process.env.COMPILE_USE_DOCKER = "false";
    delete process.env.COMPILE_TRUSTED_LOCAL;
    expect((await runCompileJob(payload)).errorCode).toBe("VALIDATION_ERROR");
    process.env.COMPILE_TRUSTED_LOCAL = "true";
    process.env.NODE_ENV = "production";
    expect((await runCompileJob(payload)).errorCode).toBe("VALIDATION_ERROR");
  });

  it("revalidates queue payloads before trying to spawn", async () => {
    // No Docker daemon or TeX binary required: these must fail at validation.
    const base = {
      projectId: "local",
      mainFile: "main.tex",
      files: { "main.tex": "x" },
    };
    for (const payload of [
      null,
      [],
      { ...base, engine: "invalid" },
      { ...base, texliveImage: "caller/image" },
      { ...base, latexmkExtraArgs: ["-shell-escape"] },
    ]) {
      const result = await runCompileJob(payload);
      expect(result.errorCode).toBe("VALIDATION_ERROR");
      expect(result.phase).toBe("failed");
    }
  });

  it("keeps nested file paths when writing the isolated project", async () => {
    await installFakeLatexmk();
    const result = await runCompileJob({
      projectId: "local",
      mainFile: "chapters/main.tex",
      engine: "lualatex",
      files: { "chapters/main.tex": "source", "chapters/empty.tex": "" },
    });
    expect(result.phase).toBe("ready");
    expect(JSON.parse(result.log)).toContain("./chapters/main.tex");
    expect(JSON.parse(result.log)).toContain("-lualatex");
  });
});
