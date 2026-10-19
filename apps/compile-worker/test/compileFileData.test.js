import { describe, expect, it } from "bun:test";
import { decodeCompileFileData } from "../src/compileFileData.ts";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("decodeCompileFileData", () => {
  it("decodes a known PNG data URL to preserved bytes", () => {
    const out = decodeCompileFileData(
      "images/fig.png",
      `data:image/png;base64,${PNG_BASE64}`,
    );
    expect(out instanceof Uint8Array).toBe(true);
    expect(Buffer.from(out).toString("base64")).toBe(PNG_BASE64);
    expect(Buffer.from(out).subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  it("decodes PDF bytes with a case-insensitive extension", () => {
    const pdfText = "%PDF-1.4\n1 0 obj\n<<>>\nendobj\n";
    const b64 = Buffer.from(pdfText, "utf8").toString("base64");
    const out = decodeCompileFileData("doc.PDF", `data:application/pdf;base64,${b64}`);
    expect(out instanceof Uint8Array).toBe(true);
    expect(Buffer.from(out).toString("utf8")).toBe(pdfText);
  });

  it("decodes unicode SVG bytes exactly", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><text>h\u00e9llo \u{1F30D}</text></svg>`;
    const b64 = Buffer.from(svg, "utf8").toString("base64");
    const out = decodeCompileFileData("fig.svg", `data:image/svg+xml;base64,${b64}`);
    expect(out instanceof Uint8Array).toBe(true);
    expect(Buffer.from(out).toString("utf8")).toBe(svg);
  });

  it("leaves ordinary text and raw non-data-URL strings unchanged", () => {
    const tex = "\\documentclass{article}\\begin{document}hi\\end{document}";
    expect(decodeCompileFileData("main.tex", tex)).toBe(tex);
    const bib = "@book{k, author={A}}";
    expect(decodeCompileFileData("refs.bib", bib)).toBe(bib);
    const raw = "not-a-data-url-just-bytes";
    expect(decodeCompileFileData("images/fig.png", raw)).toBe(raw);
    expect(decodeCompileFileData("notes.txt", "plain text")).toBe("plain text");
  });

  it("never decodes data URLs in .tex or .bib", () => {
    const texDataUrl = `data:image/png;base64,${PNG_BASE64}`;
    expect(decodeCompileFileData("main.tex", texDataUrl)).toBe(texDataUrl);
    expect(decodeCompileFileData("MAIN.TEX", texDataUrl)).toBe(texDataUrl);
    expect(decodeCompileFileData("refs.bib", texDataUrl)).toBe(texDataUrl);
    expect(decodeCompileFileData("refs.BIB", texDataUrl)).toBe(texDataUrl);
  });

  it("rejects binary MIME mismatches with the path in the error", () => {
    let err = null;
    try {
      decodeCompileFileData(
        "images/fig.png",
        `data:image/jpeg;base64,${PNG_BASE64}`,
      );
    } catch (e) {
      err = e;
    }
    expect(err instanceof Error).toBe(true);
    expect(err.message).toContain("images/fig.png");
  });

  it("rejects bad base64, missing marker, and malformed payloads", () => {
    // Trailing junk / silently-ignored chars must not be accepted.
    expect(() =>
      decodeCompileFileData("a.png", "data:image/png;base64,aGVsbG8=!!!"),
    ).toThrow();
    // Embedded whitespace must not be accepted.
    expect(() =>
      decodeCompileFileData("a.png", "data:image/png;base64,aGVs bG8="),
    ).toThrow();
    // Bad length.
    expect(() =>
      decodeCompileFileData("a.png", "data:image/png;base64,abc"),
    ).toThrow();
    // Missing ;base64 marker.
    expect(() =>
      decodeCompileFileData("a.png", "data:image/png,aGVsbG8="),
    ).toThrow();
    // Missing comma separator.
    expect(() =>
      decodeCompileFileData("a.png", "data:image/png;base64aGVsbG8="),
    ).toThrow();
    // Non-canonical padding bits.
    expect(() =>
      decodeCompileFileData("a.png", "data:image/png;base64,Af=="),
    ).toThrow();
  });

  it("has no prototype relevance", () => {
    expect(decodeCompileFileData("file.toString", "data:text/plain;base64,aGk=")).toBe(
      "data:text/plain;base64,aGk=",
    );
    expect(decodeCompileFileData("file.__proto__", "data:text/plain;base64,aGk=")).toBe(
      "data:text/plain;base64,aGk=",
    );
    expect(decodeCompileFileData("file.constructor", "data:text/plain;base64,aGk=")).toBe(
      "data:text/plain;base64,aGk=",
    );
    expect({}.polluted).toBeUndefined();
  });
});
