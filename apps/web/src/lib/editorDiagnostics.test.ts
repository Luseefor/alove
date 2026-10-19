import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import type { Diagnostic as ProtoDiagnostic } from "@alove/protocol";
import { toCmDiagnostics } from "./editorDiagnostics";

const doc = Text.of(["hello world", "second line here", "third"]);
const err = (
  over: Partial<ProtoDiagnostic> & { message: string },
): ProtoDiagnostic => ({ severity: "error", line: 1, ...over });

describe("toCmDiagnostics source filtering", () => {
  it("two-arg callers still work without file filtering", () => {
    const out = toCmDiagnostics(doc, [err({ message: "a" })]);
    expect(out).toHaveLength(1);
    expect(out[0].message).toBe("a");
  });

  it("empty rows clears", () => {
    expect(toCmDiagnostics(doc, [], "main.tex", "main.tex")).toEqual([]);
  });

  it("keeps only diagnostics for the active file", () => {
    const rows = [
      err({ message: "root", file: "main.tex" }),
      err({ message: "chapter", file: "chapters/intro.tex" }),
    ];
    const out = toCmDiagnostics(doc, rows, "main.tex", "main.tex");
    expect(out.map((d) => d.message)).toEqual(["root"]);
    const out2 = toCmDiagnostics(doc, rows, "chapters/intro.tex", "main.tex");
    expect(out2.map((d) => d.message)).toEqual(["chapter"]);
  });

  it("missing file belongs to mainFile only, never an arbitrary chapter", () => {
    const rows = [err({ message: "nofile" })];
    expect(
      toCmDiagnostics(doc, rows, "main.tex", "main.tex"),
    ).toHaveLength(1);
    expect(
      toCmDiagnostics(doc, rows, "chapters/intro.tex", "main.tex"),
    ).toHaveLength(0);
  });

  it("missing file falls back to root when mainFile is absent", () => {
    const rows = [err({ message: "nofile" })];
    expect(toCmDiagnostics(doc, rows, "main.tex")).toHaveLength(1);
    expect(
      toCmDiagnostics(doc, rows, "main.tex", null),
    ).toHaveLength(1);
    expect(
      toCmDiagnostics(doc, rows, "chapters/intro.tex", null),
    ).toHaveLength(0);
  });

  it("normalizes ./, /work/ and backslash paths", () => {
    const rows = [
      err({ message: "dot", file: "./main.tex" }),
      err({ message: "work", file: "/work/main.tex" }),
    ];
    expect(
      toCmDiagnostics(doc, rows, "main.tex", "main.tex").map((d) => d.message),
    ).toEqual(["dot", "work"]);
    const back = [err({ message: "bs", file: "chapters\\intro.tex" })];
    expect(
      toCmDiagnostics(doc, back, "chapters/intro.tex", "main.tex"),
    ).toHaveLength(1);
    expect(
      toCmDiagnostics(doc, back, "./chapters/intro.tex", "main.tex"),
    ).toHaveLength(1);
  });

  it("rejects external absolutes and traversal escapes", () => {
    const rows = [
      err({ message: "abs", file: "/etc/passwd.tex" }),
      err({ message: "up", file: "../secret.tex" }),
      err({ message: "esc", file: "chapters/../../evil.tex" }),
    ];
    expect(toCmDiagnostics(doc, rows, "main.tex", "main.tex")).toHaveLength(0);
    expect(
      toCmDiagnostics(doc, rows, "/etc/passwd.tex", "main.tex"),
    ).toHaveLength(0);
    expect(
      toCmDiagnostics(doc, rows, "../secret.tex", "main.tex"),
    ).toHaveLength(0);
  });

  it("skips missing/invalid/out-of-range lines", () => {
    const rows = [
      err({ message: "ok", file: "main.tex", line: 1 }),
      err({ message: "missing", file: "main.tex", line: undefined }),
      err({ message: "zero", file: "main.tex", line: 0 }),
      err({ message: "nan", file: "main.tex", line: NaN }),
      err({ message: "float", file: "main.tex", line: 1.5 }),
      err({ message: "oob", file: "main.tex", line: 999 }),
    ];
    const out = toCmDiagnostics(doc, rows, "main.tex", "main.tex");
    expect(out.map((d) => d.message)).toEqual(["ok"]);
  });

  it("respects and clamps columns, preserves severity and bounded spans", () => {
    const line1 = doc.line(1); // "hello world" (11 chars)
    const rows = [
      err({ message: "col", file: "main.tex", line: 1, column: 3 }),
      { severity: "warning" as const, message: "far", file: "main.tex", line: 1, column: 999 },
    ];
    const out = toCmDiagnostics(doc, rows, "main.tex", "main.tex");
    expect(out[0].from).toBe(line1.from + 2);
    expect(out[0].severity).toBe("error");
    expect(out[1].from).toBe(line1.to);
    expect(out[1].severity).toBe("warning");
    for (const d of out) expect(d.to - d.from).toBeLessThanOrEqual(200);
    const badCol = toCmDiagnostics(
      doc,
      [err({ message: "c0", file: "main.tex", line: 1, column: 0 })],
      "main.tex",
      "main.tex",
    );
    expect(badCol[0].from).toBe(line1.from);
  });
});
