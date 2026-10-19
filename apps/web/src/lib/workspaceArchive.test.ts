import { describe, expect, it } from "vitest";
import {
  parseWorkspaceSource,
  serializeWorkspaceSource,
  type WorkspaceSource,
} from "@/lib/workspaceArchive";

function makeSource(overrides: Partial<WorkspaceSource> = {}): WorkspaceSource {
  return {
    title: "Test project",
    files: {
      "main.tex": "\\documentclass{article}",
      "chapters/intro.tex": "",
    },
    mainFile: "main.tex",
    ...overrides,
  };
}

function makeArchive(overrides: Record<string, unknown> = {}): string {
  const base = {
    format: "alove-project",
    version: 1,
    title: "Test project",
    files: { "main.tex": "hello" },
    mainFile: "main.tex",
  };
  return JSON.stringify({ ...base, ...overrides });
}

describe("workspaceArchive", () => {
  it("roundtrips unicode, multiline, nested, and empty source", () => {
    const input: WorkspaceSource = {
      title: "Ünïcodé — テスト 🚀",
      files: {
        "main.tex":
          "\\documentclass{article}\n\\begin{document}\nHello 🌍 — テスト\n\\end{document}",
        "chapters/intro.tex":
          "line1\nline2\nline3 with émojis 🎉\n多行テキスト",
        "nested/deep/notes.tex": "",
        "assets/data.txt": "",
      },
      mainFile: "main.tex",
    };
    const text = serializeWorkspaceSource(input);
    const envelope = JSON.parse(text) as Record<string, unknown>;
    expect(envelope.format).toBe("alove-project");
    expect(envelope.version).toBe(1);
    expect(envelope.title).toBe(input.title);
    expect(envelope.files).toEqual(input.files);
    expect(envelope.mainFile).toBe("main.tex");
    const out = parseWorkspaceSource(text);
    expect(out).toEqual(input);
  });

  it("rejects wrong version and wrong format", () => {
    expect(() => parseWorkspaceSource(makeArchive({ version: 2 }))).toThrow();
    expect(() => parseWorkspaceSource(makeArchive({ version: "1" }))).toThrow();
    expect(() => parseWorkspaceSource(makeArchive({ version: 0 }))).toThrow();
    expect(() =>
      parseWorkspaceSource(makeArchive({ format: "other" })),
    ).toThrow();
    expect(() =>
      parseWorkspaceSource(
        JSON.stringify({ version: 1, title: "t", files: {}, mainFile: null }),
      ),
    ).toThrow();
  });

  it("rejects arrays", () => {
    expect(() => parseWorkspaceSource("[]")).toThrow();
    expect(() => parseWorkspaceSource(makeArchive({ files: [] }))).toThrow();
    expect(() =>
      parseWorkspaceSource(makeArchive({ files: ["main.tex"] })),
    ).toThrow();
    expect(() => parseWorkspaceSource(JSON.stringify([]))).toThrow();
  });

  it("rejects non-string file content", () => {
    expect(() =>
      parseWorkspaceSource(makeArchive({ files: { "a.tex": 42 } })),
    ).toThrow();
    expect(() =>
      parseWorkspaceSource(makeArchive({ files: { "a.tex": null } })),
    ).toThrow();
    expect(() =>
      parseWorkspaceSource(makeArchive({ files: { "a.tex": {} } })),
    ).toThrow();
    expect(() =>
      parseWorkspaceSource(makeArchive({ files: { "a.tex": ["x"] } })),
    ).toThrow();
  });

  it("rejects unsafe file paths", () => {
    const unsafe = [
      "/abs.tex",
      "a//b.tex",
      "./a.tex",
      "a/./b.tex",
      "../a.tex",
      "a/../b.tex",
      ".",
      "..",
      "a\\b.tex",
      "\\abs.tex",
      "a/\u0000b.tex",
      "a\nb.tex",
      "a\rb.tex",
      "a\u007fb.tex",
      "__proto__",
      "a/__proto__/b.tex",
      "constructor",
      "a/constructor/b.tex",
      "prototype",
      "a/prototype/b.tex",
      "",
      "a/",
      "/",
    ];
    for (const path of unsafe) {
      const text = JSON.stringify({
        format: "alove-project",
        version: 1,
        title: "t",
        files: { [path]: "x" },
        mainFile: null,
      });
      expect(() => parseWorkspaceSource(text), path || "(empty)").toThrow();
    }
  });

  it("rejects invalid mainFile", () => {
    expect(() =>
      parseWorkspaceSource(makeArchive({ mainFile: "missing.tex" })),
    ).toThrow();
    expect(() =>
      parseWorkspaceSource(
        makeArchive({ files: { "notes.txt": "x" }, mainFile: "notes.txt" }),
      ),
    ).toThrow();
    expect(() => parseWorkspaceSource(makeArchive({ mainFile: 42 }))).toThrow();
    expect(() =>
      parseWorkspaceSource(makeArchive({ mainFile: "/main.tex" })),
    ).toThrow();
    expect(() =>
      parseWorkspaceSource(makeArchive({ mainFile: "../main.tex" })),
    ).toThrow();
  });

  it("rejects missing root fields", () => {
    expect(() =>
      parseWorkspaceSource(
        JSON.stringify({
          format: "alove-project",
          version: 1,
          files: {},
          mainFile: null,
        }),
      ),
    ).toThrow();
    expect(() =>
      parseWorkspaceSource(
        JSON.stringify({
          format: "alove-project",
          version: 1,
          title: "t",
          mainFile: null,
        }),
      ),
    ).toThrow();
    expect(() =>
      parseWorkspaceSource(
        JSON.stringify({
          format: "alove-project",
          version: 1,
          title: "t",
          files: {},
        }),
      ),
    ).toThrow();
    expect(() =>
      parseWorkspaceSource(
        JSON.stringify({ title: "t", files: {}, mainFile: null }),
      ),
    ).toThrow();
    expect(() => parseWorkspaceSource(JSON.stringify({}))).toThrow();
    expect(() => parseWorkspaceSource("null")).toThrow();
    expect(() => parseWorkspaceSource("{not json")).toThrow();
  });

  it("rejects oversize input before parsing", () => {
    const oversize = "a".repeat(20 * 1024 * 1024 + 1);
    expect(() => parseWorkspaceSource(oversize)).toThrow();
  });

  it("rejects more than 1000 files on import but export has no cap", () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 1001; i += 1) many[`f${i}.tex`] = "x";
    const text = JSON.stringify({
      format: "alove-project",
      version: 1,
      title: "t",
      files: many,
      mainFile: null,
    });
    expect(() => parseWorkspaceSource(text)).toThrow();
    const ok: Record<string, string> = {};
    for (let i = 0; i < 1000; i += 1) ok[`f${i}.tex`] = "x";
    expect(() =>
      parseWorkspaceSource(
        JSON.stringify({
          format: "alove-project",
          version: 1,
          title: "t",
          files: ok,
          mainFile: null,
        }),
      ),
    ).not.toThrow();
    const large = makeSource({ files: many, mainFile: null });
    expect(() => serializeWorkspaceSource(large)).not.toThrow();
  });

  it("never mutates prototypes via __proto__", () => {
    const evil =
      '{"format":"alove-project","version":1,"title":"evil","files":{"__proto__":{"polluted":"yes"}},"mainFile":null}';
    expect(() => parseWorkspaceSource(evil)).toThrow();
    expect(({} as unknown as Record<string, unknown>).polluted).toBeUndefined();
    expect(
      (Object.prototype as unknown as Record<string, unknown>).polluted,
    ).toBeUndefined();
    const nested =
      '{"format":"alove-project","version":1,"title":"evil","files":{"a/__proto__/b.tex":"x"},"mainFile":null}';
    expect(() => parseWorkspaceSource(nested)).toThrow();
    expect(({} as unknown as Record<string, unknown>).polluted).toBeUndefined();
    expect(
      (Object.prototype as unknown as Record<string, unknown>).polluted,
    ).toBeUndefined();
  });
});
