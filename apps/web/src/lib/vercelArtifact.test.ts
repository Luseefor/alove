// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { VERCEL_ARTIFACT_READER } from "./vercelCompile";

let root: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "weftly-artifact-")));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function read(path: string, cap = 32, tail = false) {
  return spawnSync(
    "python3",
    ["-c", VERCEL_ARTIFACT_READER, root, path, String(cap), tail ? "1" : "0"],
    { timeout: 2000, encoding: "utf8" },
  );
}

it("reads regular files and bounds a log tail", () => {
  const path = join(root, "main.log");
  writeFileSync(path, "a".repeat(50) + "END");
  const oversized = read(path);
  expect(oversized.status).toBe(0);
  expect(JSON.parse(oversized.stdout)).toEqual({ error: "OUTPUT_TOO_LARGE" });
  const tail = read(path, 8, true);
  expect(tail.status).toBe(0);
  const data = JSON.parse(tail.stdout);
  expect(Buffer.from(data.data, "base64").toString()).toBe("aaaaaEND");
  expect(data.truncated).toBe(true);
});

it("rejects symlinks even to a file inside the workspace", () => {
  writeFileSync(join(root, "real"), "private");
  symlinkSync(join(root, "real"), join(root, "main.pdf"));
  expect(read(join(root, "main.pdf")).status).not.toBe(0);
});

it("rejects outside paths and FIFOs without blocking", () => {
  expect(read("/etc/hosts").status).not.toBe(0);
  const fifo = join(root, "main.pdf");
  execFileSync("mkfifo", [fifo]);
  const result = read(fifo);
  expect(result.status).not.toBe(0);
  expect(result.error).toBeUndefined();
});

it("returns missing artifacts without treating them as successful PDFs", () => {
  const result = read(join(root, "missing.pdf"));
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toBeNull();
});
