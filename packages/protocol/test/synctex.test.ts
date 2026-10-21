import { describe, expect, it } from "bun:test";
import {
  COMPILE_SYNCTEX_LIMITS,
  type CompileJobResult,
  type SyncTexMapping,
} from "../src/index.ts";

describe("synctex protocol types and limits", () => {
  it("exposes bounded transport limits", () => {
    expect(COMPILE_SYNCTEX_LIMITS.maxCompressedBytes).toBe(5242880);
    expect(COMPILE_SYNCTEX_LIMITS.maxDecompressedBytes).toBe(5242880);
    expect(COMPILE_SYNCTEX_LIMITS.maxEntries).toBe(20000);
    expect(COMPILE_SYNCTEX_LIMITS.maxInputFiles).toBe(1000);
  });

  it("carries an optional mapping on compile results", () => {
    const mapping: SyncTexMapping = {
      version: 1,
      truncated: false,
      entries: [{ file: "main.tex", line: 3, page: 1, x: 100, y: 200 }],
    };
    const ok: CompileJobResult = {
      phase: "ready",
      log: "ok",
      diagnostics: [],
      pdfBase64: "abc",
      synctex: mapping,
    };
    expect(ok.synctex?.entries).toHaveLength(1);
    const failed: CompileJobResult = {
      phase: "failed",
      log: "bad",
      diagnostics: [],
      errorCode: "LATEX_ERROR",
    };
    expect(failed.synctex).toBeUndefined();
  });

  it("carries optional preamble and box extents for coordinate mapping", () => {
    const mapping: SyncTexMapping = {
      version: 1,
      truncated: false,
      preamble: { magnification: 1000, unit: 1, xOffset: 4736287, yOffset: 4736287 },
      entries: [{ file: "main.tex", line: 3, page: 1, x: 4063232, y: 4128768, width: 983040, height: 150 }],
    };
    expect(mapping.preamble?.xOffset).toBe(4736287);
    expect(mapping.entries[0]?.width).toBe(983040);
    // Legacy mappings without a preamble stay valid.
    const legacy: SyncTexMapping = {
      version: 1,
      truncated: false,
      entries: [{ file: "main.tex", line: 3, page: 1, x: 100, y: 200 }],
    };
    expect(legacy.preamble).toBeUndefined();
  });
});
