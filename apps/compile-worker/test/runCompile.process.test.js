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
import { writeFileSync, symlinkSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
if (!args.includes("-c") && process.env.ALOVE_WORKER_FIXTURE_MODE !== "no-output") {
  const name = args.at(-1);
  writeFileSync(name.replace(/\\.tex$/, ".pdf"), ["invalid-pdf", "timeout-invalid-pdf"].includes(process.env.ALOVE_WORKER_FIXTURE_MODE) ? "not a PDF" : "%PDF-test-fixture");
  if (process.env.ALOVE_WORKER_FIXTURE_MODE === "external-log") {
    symlinkSync(process.env.ALOVE_WORKER_FIXTURE_LOG, name.replace(/\\.tex$/, ".log"));
  } else {
    writeFileSync(name.replace(/\\.tex$/, ".log"), process.env.ALOVE_WORKER_FIXTURE_MODE === "large-log" ? "x".repeat(100000) : process.env.ALOVE_WORKER_FIXTURE_MODE === "binary-asset" ? readFileSync("figure.png").toString("hex") : JSON.stringify(args));
  }
}
if (process.env.ALOVE_WORKER_FIXTURE_MODE === "timeout-invalid-pdf") await Bun.sleep(5000);
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

  it("writes uploaded binary assets as bytes before starting TeX", async () => {
    await installFakeLatexmk();
    process.env.ALOVE_WORKER_FIXTURE_MODE = "binary-asset";
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const result = await runCompileJob({ projectId: "local", mainFile: "main.tex", files: { "main.tex": "source", "figure.png": "data:image/png;base64," + bytes.toString("base64") } });
    expect(result.phase).toBe("ready");
    expect(result.log).toBe(bytes.toString("hex"));
  });

  it("rejects malformed asset encoding as a validation error", async () => {
    const result = await runCompileJob({ projectId: "local", mainFile: "main.tex", files: { "main.tex": "source", "figure.png": "data:image/png;base64,invalid!" } });
    expect(result.errorCode).toBe("VALIDATION_ERROR");
    expect(result.errorMessage).toContain("figure.png");
  });

  it("refuses non-PDF output even if the process reports success", async () => {
    await installFakeLatexmk();
    process.env.ALOVE_WORKER_FIXTURE_MODE = "invalid-pdf";
    const result = await runCompileJob({ projectId: "local", mainFile: "main.tex", files: { "main.tex": "source" } });
    expect(result.phase).toBe("failed");
    expect(result.errorMessage).toContain("PDF signature");
    expect(result.pdfBase64).toBeUndefined();
  });

  it("reports timeout before inspecting a partial invalid PDF", async () => {
    await installFakeLatexmk();
    process.env.ALOVE_WORKER_FIXTURE_MODE = "timeout-invalid-pdf";
    const result = await runCompileJob({ projectId: "local", mainFile: "main.tex", timeoutMs: 1000, files: { "main.tex": "source" } });
    expect(result.errorCode).toBe("TIMEOUT");
    expect(result.timedOut).toBe(true);
    expect(result.pdfBase64).toBeUndefined();
  });

  it("runs the resolved Docker image identity and returns its fingerprint", async () => {
    await installFakeLatexmk();
    const docker = join(fixtureDirectory, "docker");
    const fakeRoot = fixtureDirectory;
    await writeFile(docker, `#!${process.execPath}
import { writeFileSync, readFileSync } from "node:fs";
import { basename } from "node:path";
process.chdir(${JSON.stringify(fakeRoot)});
if (process.argv[2] === "image") { console.log("sha256:" + "a".repeat(64) + "|linux/amd64"); process.exit(0); }
if (process.argv[2] === "run") writeFileSync(".sandbox-args.json", JSON.stringify(process.argv.slice(2)));
if (process.argv[2] === "exec" && process.argv[4] === "latexmk") {
  writeFileSync("main.pdf", "%PDF-fixture");
  writeFileSync("main.log", readFileSync(".sandbox-args.json"));
}
if (process.argv[2] === "exec" && process.argv[4] === "perl") process.stdout.write(readFileSync(basename(process.argv.at(-3))));
`);
    await chmod(docker, 0o755);
    process.env.COMPILE_USE_DOCKER = "true";
    process.env.COMPILE_DOCKER_IMAGE = "configured-image:mutable";
    const result = await runCompileJob({ projectId: "local", mainFile: "main.tex", files: { "main.tex": "source" } });
    expect(result.phase).toBe("ready");
    expect(result.environment).toMatchObject({ mode: "docker", runtimeId: "sha256:" + "a".repeat(64), platform: "linux/amd64" });
    expect(result.environment.policyId).toMatch(/^alove-tex-sandbox-v1:[a-f0-9]{64}$/);
    expect(JSON.parse(result.log)).toContain(result.environment.runtimeId);
    expect(JSON.parse(result.log)).not.toContain("configured-image:mutable");
  });

  it("waits for Docker auto-removal racing with timeout cleanup", async () => {
    await installFakeLatexmk();
    const docker = join(fixtureDirectory, "docker");
    const marker = join(fixtureDirectory, "removing");
    await writeFile(docker, `#!${process.execPath}
import { existsSync, writeFileSync } from "node:fs";
if (process.argv[2] === "image") { console.log("sha256:" + "a".repeat(64) + "|linux/amd64"); process.exit(0); }
if (process.argv[2] === "run") await Bun.sleep(5000);
if (!existsSync(${JSON.stringify(marker)})) {
  writeFileSync(${JSON.stringify(marker)}, "1");
  console.error("Error response from daemon: removal of container is already in progress");
  process.exit(1);
}
console.error("Error response from daemon: No such container");
process.exit(1);
`);
    await chmod(docker, 0o755);
    process.env.COMPILE_USE_DOCKER = "true";
    const result = await runCompileJob({ projectId: "local", mainFile: "main.tex", timeoutMs: 1000, files: { "main.tex": "source" } });
    expect(result.errorCode, result.errorMessage).toBe("TIMEOUT");
    expect(result.timedOut).toBe(true);
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
    expect(JSON.parse(result.log)).toContain("-outdir=./chapters");
  });
});
