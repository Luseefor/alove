import { describe, expect, it } from "bun:test";
import { gzipSync } from "node:zlib";
import {
  decodeSyncTexGz,
  parseSyncTex,
  resolveSyncTexPath,
} from "../src/synctex.ts";

const SAMPLE = [
  "SyncTeX Version:1",
  "Input:1:/work/./main.tex",
  "Input:2:/opt/texlive/texmf-dist/tex/latex/base/article.cls",
  "Input:3:/work/sections/chap.tex",
  "Output:pdf",
  "Magnification:1000",
  "Unit:1",
  "X Offset:0",
  "Y Offset:0",
  "Content:",
  "!398",
  "{1",
  "[1,5:4736286,46220574:26673152,41484288,0",
  "(1,5:8799518,8865054:22609920,455111,127431",
  "h1,5:8799518,6571294:22609920,0,0",
  "h 1,3:11257121,8865054:100,0,0",
  "x1,3:13314227,8865054",
  "g3,2:16592852,8865054",
  "k1,5:31409438,8865054:11264892",
  "]",
  "!839",
  "}1",
  "{2",
  "[3,1:4736286,42152922:100,100,0",
  "x3,7:4736286,40000000",
  "}",
  "Postamble:",
  "Count:10",
].join("\n");

describe("synctex parser", () => {
  it("parses real engine records with nested includes", () => {
    const mapping = parseSyncTex(SAMPLE, {
      knownFiles: ["main.tex", "sections/chap.tex"],
    });
    expect(mapping.version).toBe(1);
    expect(mapping.truncated).toBe(false);
    // System class input (tag 2) has no records here; payload files resolve.
    const files = new Set(mapping.entries.map((e) => e.file));
    expect(files.has("main.tex")).toBe(true);
    expect(files.has("sections/chap.tex")).toBe(true);
    expect([...files].some((f) => f.includes("article.cls"))).toBe(false);
    const pages = new Set(mapping.entries.map((e) => e.page));
    expect(pages.has(1)).toBe(true);
    expect(pages.has(2)).toBe(true);
    // Anchor coordinates preserved for PDF matching.
    const first = mapping.entries[0];
    expect(first.line).toBeGreaterThan(0);
    expect(Number.isSafeInteger(first.x)).toBe(true);
    expect(Number.isSafeInteger(first.y)).toBe(true);
  });

  it("handles spaced and unspaced record forms plus mid-content inputs", () => {
    const text = [
      "SyncTeX Version:1",
      "Input:1:/work/main.tex",
      "Content:",
      "{1",
      "[1,4:0,41484288:1,2,0",
      "h1,4:0,41484288:1,2,0",
      "h 1,4:0,41484288:1,2,0",
      "Input:2:/work/other.tex",
      "x2,9:100,200",
      "}",
      "Postamble:",
    ].join("\n");
    const mapping = parseSyncTex(text, {
      knownFiles: ["main.tex", "other.tex"],
    });
    expect(mapping.entries.length).toBe(4);
    expect(mapping.entries[3]).toMatchObject({
      file: "other.tex",
      line: 9,
      page: 1,
    });
  });

  it("skips malformed lines without aborting the file", () => {
    const text = [
      "SyncTeX Version:1",
      "Input:1:/work/main.tex",
      "Content:",
      "{1",
      "[1,5:100,200:1,2,0",
      "garbage line",
      "[not-a-record",
      "x1,abc:100,200",
      "]",
      "}",
      "not a page block [1,5:1,2",
      "Postamble:",
    ].join("\n");
    const mapping = parseSyncTex(text, { knownFiles: ["main.tex"] });
    expect(mapping.entries.length).toBe(1);
    expect(mapping.truncated).toBe(false);
  });

  it("drops untrusted system paths and keeps only known payload files", () => {
    const text = [
      "SyncTeX Version:1",
      "Input:1:/opt/texlive/texmf-dist/tex/latex/base/article.cls",
      "Input:2:/work/main.tex",
      "Content:",
      "{1",
      "[1,10:100,200:1,2,0",
      "[2,3:300,400:1,2,0",
      "}",
      "Postamble:",
    ].join("\n");
    const mapping = parseSyncTex(text, { knownFiles: ["main.tex"] });
    expect(mapping.entries.length).toBe(1);
    expect(mapping.entries[0]).toMatchObject({ file: "main.tex", line: 3 });
  });

  it("caps entries and marks truncation", () => {
    const lines = [
      "SyncTeX Version:1",
      "Input:1:/work/main.tex",
      "Content:",
      "{1",
    ];
    for (let i = 1; i <= 10; i += 1) lines.push(`x1,${i}:100,200`);
    lines.push("}", "Postamble:");
    const mapping = parseSyncTex(lines.join("\n"), {
      knownFiles: ["main.tex"],
      maxEntries: 3,
    });
    expect(mapping.entries.length).toBe(3);
    expect(mapping.truncated).toBe(true);
  });

  it("caps input declarations", () => {
    const lines = ["SyncTeX Version:1"];
    for (let i = 1; i <= 5; i += 1) lines.push(`Input:${i}:/work/f${i}.tex`);
    lines.push("Content:", "{1", "}", "Postamble:");
    const mapping = parseSyncTex(lines.join("\n"), {
      knownFiles: ["f1.tex"],
      maxInputFiles: 2,
    });
    expect(mapping.truncated).toBe(false);
    expect(mapping.entries.length).toBe(0);
  });

  it("resolves container paths with dot segments to payload paths", () => {
    expect(
      resolveSyncTexPath("/tmp/syncproof/./chap.tex", ["chap.tex"]),
    ).toBe("chap.tex");
    expect(
      resolveSyncTexPath("/work/./chapters/paper.tex", [
        "chapters/paper.tex",
      ]),
    ).toBe("chapters/paper.tex");
    expect(resolveSyncTexPath("/work/main.tex", ["main.tex"])).toBe(
      "main.tex",
    );
  });

  it("rejects ambiguous basenames and absolute escapes", () => {
    expect(
      resolveSyncTexPath("/work/a.tex", ["x/a.tex", "y/a.tex"]),
    ).toBeNull();
    expect(resolveSyncTexPath("", ["main.tex"])).toBeNull();
    expect(resolveSyncTexPath("/work/../../etc/passwd", ["main.tex"])).toBeNull();
  });

  it("decodes gzip artifacts and bounds decompression", () => {
    const gz = gzipSync(SAMPLE);
    const mapping = decodeSyncTexGz(gz, {
      knownFiles: ["main.tex", "sections/chap.tex"],
    });
    expect(mapping?.entries.length).toBeGreaterThan(0);
    expect(mapping?.truncated).toBe(false);
  });

  it("returns null for missing artifacts and empty mapping for corrupt gzip", () => {
    expect(decodeSyncTexGz(null)).toBeNull();
    expect(decodeSyncTexGz(Buffer.alloc(0))).toBeNull();
    const corrupt = decodeSyncTexGz(Buffer.from("not-gzip-at-all"));
    expect(corrupt?.entries).toEqual([]);
    expect(corrupt?.truncated).toBe(false);
  });

  it("marks oversize compressed artifacts as truncated without parsing", () => {
    const gz = gzipSync(SAMPLE);
    const mapping = decodeSyncTexGz(gz, {
      knownFiles: ["main.tex"],
      maxCompressedBytes: 10,
    });
    expect(mapping?.entries).toEqual([]);
    expect(mapping?.truncated).toBe(true);
  });

  it("marks gzip bombs as truncated instead of allocating unbounded output", () => {
    const big = Array.from(
      { length: 5000 },
      (_, i) => `x1,${(i % 500) + 1}:100,200`,
    ).join("\n");
    const text = [
      "SyncTeX Version:1",
      "Input:1:/work/main.tex",
      "Content:",
      "{1",
      big,
      "}",
      "Postamble:",
    ].join("\n");
    const gz = gzipSync(text);
    const mapping = decodeSyncTexGz(gz, {
      knownFiles: ["main.tex"],
      maxDecompressedBytes: 1024,
    });
    expect(mapping?.truncated).toBe(true);
  });
});
