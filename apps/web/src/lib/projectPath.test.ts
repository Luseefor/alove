import { describe, expect, it } from "vitest";
import {
  PROJECT_MAX_FILE_BYTES,
  shouldStoreUploadAsDataUrl,
  uploadLogicalPathFor,
  utf8ByteLength,
  validateNewProjectPath,
  validateProjectFileContentSize,
  validateProjectFolderPath,
  validateRenameProjectPath,
} from "./projectPath";

describe("validateNewProjectPath", () => {
  it("accepts a normal nested path", () => {
    expect(validateNewProjectPath("ch/sec.tex", {})).toEqual({
      ok: true,
      path: "ch/sec.tex",
    });
  });

  it("does not trim: padded whitespace is rejected (UI trims before calling)", () => {
    for (const padded of ["  notes.tex  ", " notes.tex", "notes.tex "]) {
      const out = validateNewProjectPath(padded, {});
      expect(out.ok, padded).toBe(false);
    }
    // UI convenience: trim first, then the trimmed value validates.
    expect(validateNewProjectPath("  notes.tex  ".trim(), {})).toEqual({
      ok: true,
      path: "notes.tex",
    });
  });

  it("rejects empty input", () => {
    expect(validateNewProjectPath("", {}).ok).toBe(false);
    expect(validateNewProjectPath("   ", {}).ok).toBe(false);
    expect(validateNewProjectPath(null, {}).ok).toBe(false);
  });

  it("rejects unsafe paths via normalizeCompilePath", () => {
    for (const bad of [
      "/abs.tex",
      "a\\b.tex",
      "a:b.tex",
      "a//b.tex",
      "a/",
      ".",
      "..",
      "a/./b.tex",
      "a/../b.tex",
      "__proto__",
      "constructor",
      "prototype",
      "a/__proto__/b.tex",
      "-opt.tex",
      " main.tex",
      "main.tex ",
    ]) {
      expect(validateNewProjectPath(bad, {}).ok, bad).toBe(false);
    }
  });

  it("rejects exact collisions", () => {
    const out = validateNewProjectPath("main.tex", { "main.tex": "x" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/already exists/);
  });

  it("rejects ancestor file blocking a nested path", () => {
    const out = validateNewProjectPath("a/b.tex", { a: "x" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/blocks/);
  });

  it("rejects a file that would shadow an existing directory", () => {
    const out = validateNewProjectPath("a", { "a/b.tex": "y" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/folder/);
  });

  it("allows siblings under an existing directory", () => {
    expect(
      validateNewProjectPath("a/c.tex", { "a/b.tex": "y" }),
    ).toEqual({ ok: true, path: "a/c.tex" });
  });
});

describe("validateRenameProjectPath", () => {
  it("treats unchanged path as valid", () => {
    expect(
      validateRenameProjectPath("a.tex", "a.tex", { "a.tex": "x" }),
    ).toEqual({ ok: true, path: "a.tex" });
  });

  it("rejects renaming onto an existing file", () => {
    const out = validateRenameProjectPath("a.tex", "b.tex", {
      "a.tex": "x",
      "b.tex": "y",
    });
    expect(out.ok).toBe(false);
  });

  it("rejects renaming to a folder containing files", () => {
    const out = validateRenameProjectPath("z.tex", "a", {
      "z.tex": "x",
      "a/b.tex": "y",
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/folder/);
  });

  it("rejects renaming under an ancestor file", () => {
    const out = validateRenameProjectPath("z.tex", "a/b.tex", {
      "z.tex": "x",
      a: "blocked",
    });
    expect(out.ok).toBe(false);
  });

  it("rejects unsafe rename targets", () => {
    expect(
      validateRenameProjectPath("a.tex", "../evil.tex", { "a.tex": "x" }).ok,
    ).toBe(false);
  });

  it("does not trim rename targets", () => {
    expect(
      validateRenameProjectPath("a.tex", " b.tex", { "a.tex": "x" }).ok,
    ).toBe(false);
    expect(
      validateRenameProjectPath("a.tex", "b.tex ", { "a.tex": "x" }).ok,
    ).toBe(false);
  });
});

describe("validateProjectFolderPath", () => {
  it("returns base and keepPath for a fresh folder", () => {
    expect(validateProjectFolderPath("figures", {})).toEqual({
      ok: true,
      base: "figures",
      keepPath: "figures/.gitkeep",
    });
  });

  it("rejects unsafe folder names", () => {
    for (const bad of [
      "/abs",
      "a\\b",
      "..",
      "a/../b",
      "__proto__",
      "-opt",
      "",
      "   ",
      " figures",
      "figures ",
      "figures/",
    ]) {
      expect(validateProjectFolderPath(bad, {}).ok, bad).toBe(false);
    }
  });

  it("rejects when a file already exists at the folder path", () => {
    const out = validateProjectFolderPath("a", { a: "x" });
    expect(out.ok).toBe(false);
  });

  it("rejects when the folder already contains files", () => {
    const out = validateProjectFolderPath("a", { "a/b.tex": "y" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/already exists/);
  });

  it("rejects when an ancestor file blocks the folder", () => {
    const out = validateProjectFolderPath("a/b", { a: "x" });
    expect(out.ok).toBe(false);
  });
});

describe("upload helpers", () => {
  it("prefers webkitRelativePath and normalizes backslashes", () => {
    expect(uploadLogicalPathFor("fig.png", "assets/fig.png")).toBe(
      "assets/fig.png",
    );
    expect(uploadLogicalPathFor("a.tex", "a\\b.tex")).toBe("a/b.tex");
    expect(uploadLogicalPathFor("solo.tex", "")).toBe("solo.tex");
  });

  it("stores images and pdfs as data urls, text as text", () => {
    expect(shouldStoreUploadAsDataUrl("fig.png")).toBe(true);
    expect(shouldStoreUploadAsDataUrl("doc.PDF")).toBe(true);
    expect(shouldStoreUploadAsDataUrl("notes.tex")).toBe(false);
    expect(shouldStoreUploadAsDataUrl("fig.svg")).toBe(false);
    expect(shouldStoreUploadAsDataUrl("weird.bin", "image/png")).toBe(true);
    expect(shouldStoreUploadAsDataUrl("weird.bin", "text/plain")).toBe(false);
  });

  it("caps encoded content at the compile 1 MiB limit", () => {
    expect(PROJECT_MAX_FILE_BYTES).toBe(1048576);
    const one = "a".repeat(1048576);
    expect(utf8ByteLength(one)).toBe(1048576);
    expect(validateProjectFileContentSize("m.tex", one).ok).toBe(true);
    const over = "a".repeat(1048577);
    const out = validateProjectFileContentSize("m.tex", over);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/1 MB/);
  });

  it("measures multibyte content as utf8 bytes", () => {
    const ok = "é".repeat(524288);
    expect(utf8ByteLength(ok)).toBe(1048576);
    expect(validateProjectFileContentSize("m.tex", ok).ok).toBe(true);
    expect(
      validateProjectFileContentSize("m.tex", "é".repeat(524289)).ok,
    ).toBe(false);
  });
});
