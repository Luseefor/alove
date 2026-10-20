import { describe, expect, test } from "bun:test";
import { immutableImage, rawEnv } from "./deploy";

describe("deployment data boundaries", () => {
  test("raw env preserves dollar signs, quotes, equals and backslashes without shell evaluation", () => {
    expect(rawEnv({ REDIS_URL: "rediss://u:p$'\"=\\@host:6380" })).toBe("REDIS_URL=rediss://u:p$'\"=\\@host:6380\n");
  });
  test("rejects newline injection and invalid variable names without echoing values", () => {
    for (const value of ["secret\nINJECTED=true", "secret\r", "secret\0"]) {
      expect(() => rawEnv({ REDIS_URL: value })).toThrow("Invalid deployment environment entry");
    }
    expect(() => rawEnv({ "BAD=KEY": "secret" })).toThrow();
    expect(() => rawEnv({ KEY: undefined })).toThrow();
  });
  test("accepts immutable registry digests only", () => {
    const ref = `ghcr.io/luseefor/alove-web@sha256:${"a".repeat(64)}`;
    expect(immutableImage(ref)).toBe(ref);
    for (const bad of [undefined, "ghcr.io/luseefor/alove-web:main", ref + ";id", ref + "\n", "-bad@sha256:" + "a".repeat(64)]) expect(() => immutableImage(bad)).toThrow();
  });
});
