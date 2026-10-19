import { describe, test, expect } from "bun:test";
import {
  COMPILE_REQUEST_LIMITS,
  normalizeCompilePath,
  validateCompileRequest,
} from "../src/index.ts";

function base(over: Record<string, unknown> = {}) {
  return {
    projectId: "proj-1",
    mainFile: "main.tex",
    files: { "main.tex": "hello" },
    ...over,
  };
}

describe("limits", () => {
  test("exports expected caps", () => {
    expect(COMPILE_REQUEST_LIMITS.maxFiles).toBe(250);
    expect(COMPILE_REQUEST_LIMITS.maxFileBytes).toBe(1048576);
    expect(COMPILE_REQUEST_LIMITS.maxTotalBytes).toBe(10485760);
    expect(COMPILE_REQUEST_LIMITS.maxRequestBytes).toBe(22020096);
    expect(COMPILE_REQUEST_LIMITS.minTimeoutMs).toBe(1000);
    expect(COMPILE_REQUEST_LIMITS.maxTimeoutMs).toBe(120000);
  });
});

describe("normalizeCompilePath", () => {
  test("accepts nested, unicode, spaces, .gitkeep", () => {
    expect(normalizeCompilePath("main.tex")).toBe("main.tex");
    expect(normalizeCompilePath("ch/sec.tex")).toBe("ch/sec.tex");
    expect(normalizeCompilePath(".gitkeep")).toBe(".gitkeep");
    expect(normalizeCompilePath("a/.gitkeep")).toBe("a/.gitkeep");
    expect(normalizeCompilePath("日本語/ファイル.tex")).toBe(
      "日本語/ファイル.tex",
    );
    expect(normalizeCompilePath("my dir/notes file.tex")).toBe(
      "my dir/notes file.tex",
    );
  });
  test("rejects unsafe", () => {
    for (const p of [
      "",
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
      "a/-x.tex",
      " main.tex",
      "main.tex ",
      "a/ b.tex",
      "a /b.tex",
      "a/b.tex ",
      "a\nb.tex",
      "a\rb.tex",
      "a\tb.tex",
      "a\x7fb.tex",
    ]) {
      expect(normalizeCompilePath(p)).toBeNull();
    }
    expect(normalizeCompilePath(null)).toBeNull();
    expect(normalizeCompilePath(123)).toBeNull();
    expect(normalizeCompilePath(undefined)).toBeNull();
  });
  test("path byte boundary 1024", () => {
    const okBase = "a".repeat(1020) + ".tex";
    expect(new TextEncoder().encode(okBase).length).toBeLessThanOrEqual(1024);
    expect(normalizeCompilePath(okBase)).toBe(okBase);
    const tooLong = "a".repeat(1021) + ".tex";
    expect(new TextEncoder().encode(tooLong).length).toBeGreaterThan(1024);
    expect(normalizeCompilePath(tooLong)).toBeNull();
    const uniOk = "é".repeat(510) + ".tex";
    expect(new TextEncoder().encode(uniOk).length).toBeLessThanOrEqual(1024);
    expect(normalizeCompilePath(uniOk)).toBe(uniOk);
    const uniBad = "é".repeat(511) + "ab.tex";
    expect(new TextEncoder().encode(uniBad).length).toBeGreaterThan(1024);
    expect(normalizeCompilePath(uniBad)).toBeNull();
  });
});

describe("validateCompileRequest valid", () => {
  test("nested unicode empty content defaults", () => {
    const r = validateCompileRequest(
      base({
        mainFile: "ch/main.tex",
        files: {
          "ch/main.tex": "",
          "ch/日本語 file.tex": "\\input",
          "ch/.gitkeep": "",
        },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.engine).toBe("pdflatex");
    expect(r.value.mainFile).toBe("ch/main.tex");
    expect("cleanAux" in r.value).toBe(false);
    expect("timeoutMs" in r.value).toBe(false);
  });
  test("explicit options pass through fresh copy", () => {
    const files = { "main.tex": "x" };
    const input = base({
      engine: "lualatex",
      cleanAux: true,
      timeoutMs: 5000,
      files,
    });
    const r = validateCompileRequest(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.engine).toBe("lualatex");
    expect(r.value.cleanAux).toBe(true);
    expect(r.value.timeoutMs).toBe(5000);
    expect(r.value.files).toEqual({ "main.tex": "x" });
    expect(r.value.files).not.toBe(files);
  });
});

describe("validateCompileRequest shape", () => {
  test("null array primitives reject before access", () => {
    for (const v of [null, undefined, [], [1], "x", 42, true]) {
      const r = validateCompileRequest(v);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(400);
    }
  });
  test("nonstring fields", () => {
    expect(validateCompileRequest(base({ projectId: 1 })).ok).toBe(false);
    expect(validateCompileRequest(base({ projectId: "   " })).ok).toBe(false);
    expect(
      validateCompileRequest(base({ projectId: "a".repeat(201) })).ok,
    ).toBe(false);
    expect(validateCompileRequest(base({ mainFile: 1 })).ok).toBe(false);
    expect(validateCompileRequest(base({ files: null })).ok).toBe(false);
    expect(validateCompileRequest(base({ files: [] })).ok).toBe(false);
    expect(validateCompileRequest(base({ files: { "main.tex": 1 } })).ok).toBe(
      false,
    );
    const r = validateCompileRequest(base({ files: {} }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(413);
  });
  test("unknown fields rejected", () => {
    for (const extra of [
      { texliveImage: "texlive:2024" },
      { latexmkExtraArgs: ["-x"] },
      { image: "x" },
      { owner: "u" },
      { ownerId: "u" },
      { extra: 1 },
    ]) {
      const r = validateCompileRequest({ ...base(), ...extra });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(400);
    }
  });
});

describe("paths and main", () => {
  test("unsafe keys rejected 400", () => {
    for (const bad of [
      "",
      "/m.tex",
      "a\\b.tex",
      "a:b.tex",
      "a//b.tex",
      ".",
      "a/./b.tex",
      "a/../b.tex",
      "__proto__",
      "a/__proto__/b.tex",
      "constructor",
      "-f.tex",
      " m.tex",
    ]) {
      const files: Record<string, string> = { "main.tex": "x" };
      Object.defineProperty(files, bad, {
        value: "x",
        enumerable: true,
        configurable: true,
        writable: true,
      });
      const r = validateCompileRequest(base({ files }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(400);
    }
  });
  test("file vs parent conflicts", () => {
    const r1 = validateCompileRequest(
      base({
        mainFile: "a/b.tex",
        files: { a: "x", "a/b.tex": "y" },
      }),
    );
    expect(r1.ok).toBe(false);
    const r2 = validateCompileRequest(
      base({
        mainFile: "a/b/c.tex",
        files: { "a/b": "x", "a/b/c.tex": "y" },
      }),
    );
    expect(r2.ok).toBe(false);
  });
  test("main missing or non-tex", () => {
    expect(
      validateCompileRequest(base({ files: { "other.tex": "x" } })).ok,
    ).toBe(false);
    const { mainFile: _omit, ...noMain } = base() as Record<string, unknown>;
    void _omit;
    expect(validateCompileRequest(noMain).ok).toBe(false);
    expect(
      validateCompileRequest(
        base({
          mainFile: "main.pdf",
          files: { "main.pdf": "x" },
        }),
      ).ok,
    ).toBe(false);
    expect(
      validateCompileRequest(
        base({ mainFile: "toString", files: { "main.tex": "x" } }),
      ).ok,
    ).toBe(false);
  });
});

describe("engine cleanAux timeout", () => {
  test("engine allowlist and default", () => {
    expect(validateCompileRequest(base()).ok).toBe(true);
    if (validateCompileRequest(base()).ok) {
      const r = validateCompileRequest(base());
      if (r.ok) expect(r.value.engine).toBe("pdflatex");
    }
    for (const e of ["lualatex", "xelatex", "pdflatex"]) {
      expect(validateCompileRequest(base({ engine: e })).ok).toBe(true);
    }
    for (const e of ["pdftex", "", null, 123, "PDFLATEX"]) {
      const r = validateCompileRequest(base({ engine: e }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(400);
    }
  });
  test("cleanAux runtime boolean", () => {
    expect(validateCompileRequest(base({ cleanAux: true })).ok).toBe(true);
    expect(validateCompileRequest(base({ cleanAux: false })).ok).toBe(true);
    for (const v of ["true", 1, 0, null]) {
      const r = validateCompileRequest(base({ cleanAux: v }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(400);
    }
  });
  test("timeout bounds no clamp", () => {
    expect(validateCompileRequest(base({ timeoutMs: 1000 })).ok).toBe(true);
    expect(validateCompileRequest(base({ timeoutMs: 120000 })).ok).toBe(true);
    for (const v of [999, 120001, 0, -1, 1.5, "5000", NaN, Infinity, null]) {
      const r = validateCompileRequest(base({ timeoutMs: v }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(400);
    }
    const big = Number.MAX_SAFE_INTEGER + 1;
    expect(validateCompileRequest(base({ timeoutMs: big })).ok).toBe(false);
  });
});

describe("size and count utf8", () => {
  test("per-file boundary ascii and multibyte", () => {
    const one = "a".repeat(1048576);
    expect(
      validateCompileRequest(base({ files: { "main.tex": one } })).ok,
    ).toBe(true);
    const over = "a".repeat(1048577);
    const r = validateCompileRequest(base({ files: { "main.tex": over } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(413);
    const uniOk = "é".repeat(524288);
    expect(new TextEncoder().encode(uniOk).length).toBe(1048576);
    expect(
      validateCompileRequest(base({ files: { "main.tex": uniOk } })).ok,
    ).toBe(true);
    const uniOver = "é".repeat(524289);
    const r2 = validateCompileRequest(base({ files: { "main.tex": uniOver } }));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.status).toBe(413);
  });
  test("total and count boundaries", () => {
    const files250: Record<string, string> = { "main.tex": "x" };
    for (let i = 0; i < 249; i++) files250[`f${i}.tex`] = "x";
    expect(validateCompileRequest(base({ files: files250 })).ok).toBe(true);
    const files251 = { ...files250, "extra.tex": "x" };
    const rc = validateCompileRequest(base({ files: files251 }));
    expect(rc.ok).toBe(false);
    if (!rc.ok) expect(rc.status).toBe(413);
    const big1m = "b".repeat(1048576);
    const files10: Record<string, string> = { "main.tex": big1m };
    for (let i = 0; i < 9; i++) files10[`g${i}.tex`] = "x";
    const totalOk = validateCompileRequest(base({ files: files10 }));
    expect(totalOk.ok).toBe(true);
    const filesOver: Record<string, string> = {};
    for (let i = 0; i < 11; i++) filesOver[`h${i}.tex`] = big1m;
    filesOver["main.tex"] = big1m;
    const rt = validateCompileRequest(
      base({ mainFile: "h0.tex", files: filesOver }),
    );
    expect(rt.ok).toBe(false);
    if (!rt.ok) expect(rt.status).toBe(413);
  });
});
