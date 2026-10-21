import { describe, expect, it } from "vitest";
import {
  decodeGitHubBlob,
  encodeGitHubBlob,
  isBinarySyncPath,
  isValidBranch,
  isValidSha,
  validateRepoRef,
} from "@/lib/githubSync";

describe("githubSync validation", () => {
  it("accepts well-formed refs and rejects malformed ones", () => {
    expect(validateRepoRef("octo", "hello-world", "main")).toBeNull();
    expect(validateRepoRef("o", "a.b_c-d", "feature/x")).toBeNull();
    expect(validateRepoRef("", "repo", "main")).toBe("Invalid repository owner.");
    expect(validateRepoRef("own er", "repo", "main")).toBe("Invalid repository owner.");
    expect(validateRepoRef("owner", "", "main")).toBe("Invalid repository name.");
    expect(validateRepoRef("owner", "..", "main")).toBe("Invalid repository name.");
    expect(validateRepoRef("owner", "repo", "")).toBe("Invalid branch name.");
    expect(validateRepoRef("owner", "repo", "a..b")).toBe("Invalid branch name.");
    expect(validateRepoRef("owner", "repo", "a b")).toBe("Invalid branch name.");
    expect(validateRepoRef("owner", "repo", "x.lock")).toBe("Invalid branch name.");
  });

  it("validates branch edge cases", () => {
    expect(isValidBranch("main")).toBe(true);
    expect(isValidBranch("feature/nested-ok")).toBe(true);
    expect(isValidBranch("-leading-dash")).toBe(false);
    expect(isValidBranch("trailing/")).toBe(false);
    expect(isValidBranch("a//b")).toBe(false);
    expect(isValidBranch("has space")).toBe(false);
    expect(isValidBranch("has~tilde")).toBe(false);
    expect(isValidBranch("has@{brace")).toBe(false);
    expect(isValidBranch("x".repeat(256))).toBe(false);
  });

  it("validates commit shas", () => {
    expect(isValidSha("a".repeat(40))).toBe(true);
    expect(isValidSha("A".repeat(40))).toBe(false);
    expect(isValidSha("abc")).toBe(false);
    expect(isValidSha(42)).toBe(false);
  });
});

describe("githubSync content codec", () => {
  it("round-trips text through base64 blobs", () => {
    const encoded = encodeGitHubBlob("main.tex", "héllo\n");
    expect(encoded?.encoding).toBe("base64");
    const decoded = decodeGitHubBlob("main.tex", encoded!.content);
    expect(decoded).toEqual({ ok: true, content: "héllo\n" });
  });

  it("round-trips binary assets as dataURIs", () => {
    const raw = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");
    const decoded = decodeGitHubBlob("fig.png", raw);
    if (!decoded.ok) throw new Error("expected binary decode to succeed");
    expect(decoded.content.startsWith("data:image/png;base64,")).toBe(true);
    expect(encodeGitHubBlob("fig.png", decoded.content)).toEqual({
      content: raw,
      encoding: "base64",
    });
  });

  it("rejects undecodable and oversize blobs", () => {
    expect(decodeGitHubBlob("a.tex", "!!!not-base64!!!").ok).toBe(false);
    expect(decodeGitHubBlob("a.bin", "aGVsbG8=").ok).toBe(true);
    // Non-UTF8 bytes at a text path are rejected with guidance.
    const latin1 = Buffer.from([0xff, 0xfe]).toString("base64");
    const rejected = decodeGitHubBlob("notes.tex", latin1);
    expect(rejected.ok).toBe(false);
  });

  it("classifies binary paths by extension", () => {
    expect(isBinarySyncPath("fig.png")).toBe(true);
    expect(isBinarySyncPath("doc.pdf")).toBe(true);
    expect(isBinarySyncPath("main.tex")).toBe(false);
    expect(isBinarySyncPath("refs.bib")).toBe(false);
  });
});
