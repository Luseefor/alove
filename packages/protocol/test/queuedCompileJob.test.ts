import { describe, test, expect } from "bun:test";
import { validateQueuedCompileJob } from "../src/index.ts";

function baseRequest(over: Record<string, unknown> = {}) {
  return {
    projectId: "proj-1",
    mainFile: "main.tex",
    files: { "main.tex": "hello" },
    ...over,
  };
}

function baseJob(over: Record<string, unknown> = {}) {
  return {
    version: 1,
    owner: { kind: "user", userId: "u-1" },
    request: baseRequest(),
    ...over,
  };
}

describe("valid envelopes", () => {
  test("user owner passes with defaults", () => {
    const r = validateQueuedCompileJob(baseJob());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.version).toBe(1);
    expect(r.value.owner).toEqual({ kind: "user", userId: "u-1" });
    expect(r.value.request.projectId).toBe("proj-1");
    expect(r.value.request.engine).toBe("pdflatex");
  });

  test("local owners pass for loopback origins", () => {
    for (const origin of [
      "http://127.0.0.1:3000",
      "https://127.0.0.1:4000",
      "http://localhost:3000",
      "https://localhost:8443",
      "http://[::1]:3000",
      "https://[::1]:4433",
    ]) {
      const r = validateQueuedCompileJob(
        baseJob({ owner: { kind: "local", origin } }),
      );
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.value.owner).toEqual({ kind: "local", origin });
    }
  });

  test("does not mutate input and copies request", () => {
    const request = baseRequest();
    const owner = { kind: "user", userId: "u-1" };
    const input = { version: 1, owner, request };
    const snap = structuredClone(input);
    const r = validateQueuedCompileJob(input);
    expect(r.ok).toBe(true);
    expect(input).toEqual(snap);
    if (!r.ok) return;
    expect(r.value.request.files).not.toBe(request.files);
    expect(r.value.owner).not.toBe(owner);
  });
});

describe("legacy and version", () => {
  test("bare client payload is rejected", () => {
    expect(validateQueuedCompileJob(baseRequest()).ok).toBe(false);
    expect(validateQueuedCompileJob({ ...baseRequest(), version: 1 }).ok).toBe(
      false,
    );
  });
  test("missing envelope fields rejected", () => {
    const full = baseJob() as Record<string, unknown>;
    for (const key of ["version", "owner", "request"]) {
      const copy = { ...full };
      delete copy[key];
      expect(validateQueuedCompileJob(copy).ok).toBe(false);
    }
    expect(validateQueuedCompileJob({}).ok).toBe(false);
  });
  test("bad versions rejected", () => {
    for (const version of [0, 2, "1", 1.5, null, undefined, true]) {
      expect(
        validateQueuedCompileJob(baseJob({ version })).ok,
      ).toBe(false);
    }
  });
});

describe("shape and keys", () => {
  test("non object envelopes rejected", () => {
    for (const v of [null, undefined, [], [1], "x", 42, true]) {
      expect(validateQueuedCompileJob(v).ok).toBe(false);
    }
  });
  test("unknown envelope keys rejected", () => {
    for (const extra of [
      { extra: 1 },
      { projectId: "x" },
      { files: {} },
      { kind: "user" },
    ]) {
      expect(validateQueuedCompileJob({ ...baseJob(), ...extra }).ok).toBe(
        false,
      );
    }
  });
  test("owner shape and kind", () => {
    expect(
      validateQueuedCompileJob(baseJob({ owner: null })).ok,
    ).toBe(false);
    expect(validateQueuedCompileJob(baseJob({ owner: [] })).ok).toBe(false);
    expect(
      validateQueuedCompileJob(baseJob({ owner: { userId: "u" } })).ok,
    ).toBe(false);
    for (const kind of ["admin", "USER", "", 1, null]) {
      expect(
        validateQueuedCompileJob(baseJob({ owner: { kind, userId: "u" } })).ok,
      ).toBe(false);
    }
  });
  test("unknown owner keys rejected", () => {
    expect(
      validateQueuedCompileJob(
        baseJob({ owner: { kind: "user", userId: "u", origin: "x" } }),
      ).ok,
    ).toBe(false);
    expect(
      validateQueuedCompileJob(
        baseJob({
          owner: { kind: "local", origin: "http://127.0.0.1:3000", userId: "u" },
        }),
      ).ok,
    ).toBe(false);
    expect(
      validateQueuedCompileJob(
        baseJob({ owner: { kind: "user", userId: "u", extra: 1 } }),
      ).ok,
    ).toBe(false);
  });
  test("userId blank, long, or wrong type", () => {
    for (const userId of ["", "   ", "\n\t ", 1, null, undefined, {}]) {
      expect(
        validateQueuedCompileJob(baseJob({ owner: { kind: "user", userId } }))
          .ok,
      ).toBe(false);
    }
    expect(
      validateQueuedCompileJob(
        baseJob({ owner: { kind: "user", userId: "a".repeat(257) } }),
      ).ok,
    ).toBe(false);
    expect(
      validateQueuedCompileJob(
        baseJob({ owner: { kind: "user", userId: "a".repeat(256) } }),
      ).ok,
    ).toBe(true);
  });
  test("prototype shapes rejected", () => {
    const evil: Record<string, unknown> = { "main.tex": "x" };
    Object.defineProperty(evil, "__proto__", {
      value: "x",
      enumerable: true,
      configurable: true,
      writable: true,
    });
    expect(
      validateQueuedCompileJob(
        baseJob({ request: baseRequest({ files: evil }) }),
      ).ok,
    ).toBe(false);
    const envelope: Record<string, unknown> = { ...baseJob() };
    Object.defineProperty(envelope, "__proto__", {
      value: 1,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    expect(validateQueuedCompileJob(envelope).ok).toBe(false);
    const owner: Record<string, unknown> = { kind: "user", userId: "u" };
    Object.defineProperty(owner, "constructor", {
      value: 1,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    expect(validateQueuedCompileJob(baseJob({ owner })).ok).toBe(false);
    class Fake {
      version = 1;
    }
    expect(validateQueuedCompileJob(new Fake()).ok).toBe(false);
  });
});

describe("local origins", () => {
  test("non canonical or remote origins rejected", () => {
    for (const origin of [
      "",
      "not-a-url",
      "http://127.0.0.1",
      "http://localhost",
      "http://[::1]",
      "http://127.0.0.1:3000/",
      "http://127.0.0.1:3000/a",
      "http://127.0.0.1:3000?x=1",
      "http://127.0.0.1:3000#frag",
      "http://user@127.0.0.1:3000",
      "http://u:p@127.0.0.1:3000",
      "ftp://127.0.0.1:3000",
      "ws://127.0.0.1:3000",
      "http://example.com:3000",
      "http://0.0.0.0:3000",
      "http://127.0.0.2:3000",
      "http://evil-localhost:3000",
      "http://127.0.0.1:80",
      "HTTP://127.0.0.1:3000",
      " http://127.0.0.1:3000",
      "http://127.0.0.1:3000 ",
      123,
      null,
    ]) {
      const r = validateQueuedCompileJob(
        baseJob({ owner: { kind: "local", origin } }),
      );
      expect(r.ok).toBe(false);
    }
  });
});

describe("request reuse", () => {
  test("invalid requests fail", () => {
    const badRequests: Record<string, unknown>[] = [
      baseRequest({ files: {} }),
      baseRequest({ mainFile: "main.pdf", files: { "main.pdf": "x" } }),
      baseRequest({ engine: "pdftex" }),
      baseRequest({ files: { "main.tex": 1 } }),
      baseRequest({ projectId: "   " }),
      { projectId: "p", mainFile: "main.tex" },
    ];
    for (const request of badRequests) {
      expect(validateQueuedCompileJob(baseJob({ request })).ok).toBe(false);
    }
    expect(validateQueuedCompileJob(baseJob({ request: null })).ok).toBe(
      false,
    );
  });
  test("owner inside client request stays rejected", () => {
    const request = { ...baseRequest(), owner: { kind: "user", userId: "u" } };
    expect(validateQueuedCompileJob(baseJob({ request })).ok).toBe(false);
  });
});
