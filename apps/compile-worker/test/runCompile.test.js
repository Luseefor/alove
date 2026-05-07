import { afterEach, describe, expect, it } from "bun:test";
import { __testOnly } from "../src/runCompile.ts";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("runCompile safety helpers", () => {
  it("caps requested timeout by COMPILE_TIMEOUT_MS", () => {
    process.env.COMPILE_TIMEOUT_MS = "30000";
    const limits = __testOnly.resolveLimits({
      projectId: "p",
      mainFile: "main.tex",
      files: { "main.tex": "\\documentclass{article}" },
      timeoutMs: 120000,
    });

    expect(limits.timeoutMs).toBe(30000);
  });

  it("rejects unsafe paths as validation errors", () => {
    const limits = {
      timeoutMs: 30000,
      maxFiles: 10,
      maxFileBytes: 1024,
      maxTotalBytes: 2048,
      maxLogBytes: 4096,
      maxPdfBytes: 8192,
    };
    const validated = __testOnly.validatePayload(
      {
        projectId: "p",
        mainFile: "../main.tex",
        files: { "../main.tex": "\\documentclass{article}" },
      },
      limits,
      "ghcr.io/xu-cheng/texlive-full:latest",
    );

    expect(validated.ok).toBe(false);
    if (validated.ok) throw new Error("Expected validation failure");
    expect(validated.result.errorCode).toBe("VALIDATION_ERROR");
  });

  it("truncates long logs to configured max bytes", () => {
    const veryLongLog = "x".repeat(1000);
    const trimmed = __testOnly.trimLog(veryLongLog, 120);

    expect(trimmed.truncated).toBe(true);
    expect(Buffer.byteLength(trimmed.text, "utf8")).toBeLessThanOrEqual(120);
  });
});
