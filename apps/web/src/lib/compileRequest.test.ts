import { afterEach, expect, it, vi } from "vitest";
import { serializeCompileRequest } from "./compileRequest";
const request = {
  projectId: "p",
  mainFile: "main.tex",
  files: { "main.tex": "Hello" },
};
afterEach(() => vi.unstubAllEnvs());

it("preserves exact source, escaped JSON and non-ASCII characters", () => {
  vi.stubEnv("NEXT_PUBLIC_COMPILE_RUNTIME", "vercel-sandbox");
  const source = {
    ...request,
    files: { "main.tex": '\\section{Résumé}\r\n"quoted"' },
  };
  expect(JSON.parse(serializeCompileRequest(source))).toEqual(source);
});

it("applies the personal limit to UTF-8 bytes before sending an oversized request", () => {
  vi.stubEnv("NEXT_PUBLIC_COMPILE_RUNTIME", "vercel-sandbox");
  expect(() =>
    serializeCompileRequest({
      ...request,
      files: { "main.tex": "é".repeat(1_500_000) },
    }),
  ).toThrow("3 MB");
});

it("keeps the Docker deployment's existing larger transfer limit", () => {
  vi.stubEnv("NEXT_PUBLIC_COMPILE_RUNTIME", "");
  const source = "x".repeat(3_100_000);
  expect(
    JSON.parse(
      serializeCompileRequest({ ...request, files: { "main.tex": source } }),
    ).files["main.tex"],
  ).toBe(source);
});
