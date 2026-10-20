import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  ArtifactTooLargeError,
  readDockerArtifact,
} from "../src/dockerArtifact.ts";

const originalEnv = { ...process.env };
let fixtureDirectory;

afterEach(async () => {
  process.env = { ...originalEnv };
  if (fixtureDirectory)
    await rm(fixtureDirectory, { recursive: true, force: true });
  fixtureDirectory = undefined;
});

async function installFakeDocker() {
  fixtureDirectory = await mkdtemp(join(tmpdir(), "alove-artifact-fixture-"));
  const docker = join(fixtureDirectory, "docker");
  await writeFile(
    docker,
    `#!${process.execPath}
const mode = process.env.ALOVE_ARTIFACT_FIXTURE_MODE ?? "binary";
const targetPath = process.argv.at(-3);
const cap = Number(process.argv.at(-2));
const tailFlag = process.argv.at(-1);
if (typeof targetPath !== "string" || !targetPath.startsWith("/work/")) process.exit(65);
if (mode === "binary") {
  process.stdout.write(Buffer.from([0, 1, 2, 127, 128, 200, 254, 255, 65, 0, 66, 13, 10, 0]));
  process.exit(0);
}
if (mode === "missing") process.exit(66);
if (mode === "nonregular") process.exit(65);
if (mode === "oversized") process.exit(67);
if (mode === "overcap-stream") {
  process.stdout.write(Buffer.alloc((Number.isFinite(cap) ? cap : 16) + 4096, 0x58));
  process.exit(0);
}
if (mode === "tail") {
  if (tailFlag !== "1") { console.error("expected tail flag"); process.exit(68); }
  const full = Buffer.from("0123456789ABCDEFGHIJ-tail-marker");
  const take = Number.isFinite(cap) ? cap : 8;
  process.stdout.write(full.subarray(full.length - take));
  process.stderr.write("ALOVE_TRUNCATED\\n");
  process.exit(0);
}
console.error("unknown fixture mode: " + mode);
process.exit(68);
`,
  );
  await chmod(docker, 0o755);
  process.env.PATH = `${fixtureDirectory}:${dirname(process.execPath)}:${originalEnv.PATH}`;
}

describe("readDockerArtifact", () => {
  it("preserves binary bytes including NUL and high bytes", async () => {
    await installFakeDocker();
    process.env.ALOVE_ARTIFACT_FIXTURE_MODE = "binary";
    const expected = Buffer.from([
      0, 1, 2, 127, 128, 200, 254, 255, 65, 0, 66, 13, 10, 0,
    ]);
    const result = await readDockerArtifact(
      "test-container",
      "/work/main.pdf",
      1024,
    );
    expect(result).not.toBeNull();
    expect(result.truncated).toBe(false);
    expect(Buffer.isBuffer(result.data)).toBe(true);
    expect(result.data.equals(expected)).toBe(true);
  });

  it("returns null for missing artifact (exit 66)", async () => {
    await installFakeDocker();
    process.env.ALOVE_ARTIFACT_FIXTURE_MODE = "missing";
    const result = await readDockerArtifact(
      "test-container",
      "/work/missing.log",
      1024,
    );
    expect(result).toBeNull();
  });

  it("rejects nonregular files and escaped paths (exit 65)", async () => {
    await installFakeDocker();
    process.env.ALOVE_ARTIFACT_FIXTURE_MODE = "nonregular";
    let err;
    try {
      await readDockerArtifact("test-container", "/work/link.log", 1024);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ArtifactTooLargeError);
    expect(String(err?.message)).toMatch(/exit 65|regular artifact/);

    for (const escape of ["/etc/passwd", "/work/../evil.log", "/tmp/x.log"]) {
      let escapeErr;
      try {
        await readDockerArtifact("test-container", escape, 1024);
      } catch (e) {
        escapeErr = e;
      }
      expect(escapeErr).toBeInstanceOf(Error);
      expect(escapeErr).not.toBeInstanceOf(ArtifactTooLargeError);
    }
  });

  it("rejects oversized artifacts with ArtifactTooLargeError (exit 67)", async () => {
    await installFakeDocker();
    process.env.ALOVE_ARTIFACT_FIXTURE_MODE = "oversized";
    expect(ArtifactTooLargeError.prototype).toBeInstanceOf(Error);
    let err;
    try {
      await readDockerArtifact("test-container", "/work/main.pdf", 16);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ArtifactTooLargeError);
  });

  it("rejects bounded over-cap stdout streams even without exit 67", async () => {
    await installFakeDocker();
    process.env.ALOVE_ARTIFACT_FIXTURE_MODE = "overcap-stream";
    let err;
    try {
      await readDockerArtifact("test-container", "/work/main.pdf", 16);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ArtifactTooLargeError);
  });

  it("returns tail bytes with truncated flag for log tails", async () => {
    await installFakeDocker();
    process.env.ALOVE_ARTIFACT_FIXTURE_MODE = "tail";
    const cap = 8;
    const full = Buffer.from("0123456789ABCDEFGHIJ-tail-marker");
    const result = await readDockerArtifact(
      "test-container",
      "/work/main.log",
      cap,
      true,
    );
    expect(result).not.toBeNull();
    expect(result.truncated).toBe(true);
    expect(result.data.equals(full.subarray(full.length - cap))).toBe(true);
  });
});
