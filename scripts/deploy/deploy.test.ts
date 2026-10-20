import { describe, expect, test } from "bun:test";
import { deploymentDirectory, immutableImage, rawEnv } from "./deploy";

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


describe("release retries", () => {
  test("uses distinct directories for reruns of the same source commit", () => {
    const revision = "a".repeat(40);
    expect(deploymentDirectory(revision)).not.toBe(deploymentDirectory(revision));
    expect(deploymentDirectory(revision, "run-2")).toBe(`/opt/alove/releases/${revision}-run-2`);
  });
  test("rejects unsafe revisions and release suffixes", () => {
    expect(() => deploymentDirectory("../main", "run-2")).toThrow();
    expect(() => deploymentDirectory("a".repeat(40), "$(id)")).toThrow();
    expect(() => deploymentDirectory("a".repeat(40), "../old")).toThrow();
  });
});
