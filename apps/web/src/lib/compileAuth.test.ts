import { describe, expect, it } from "vitest";
import { getCompileAuthPolicy } from "@/lib/compileAuth";

function makeEnv(overrides: Partial<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    NEXT_PUBLIC_LOCAL_STANDALONE: "false",
    ...overrides,
  };
}

describe("getCompileAuthPolicy", () => {
  it("allows anonymous compile in local standalone mode", () => {
    const policy = getCompileAuthPolicy(makeEnv({
      NEXT_PUBLIC_LOCAL_STANDALONE: "true",
    }));

    expect(policy).toEqual({ allowAnonymous: true });
  });

  it("fails closed when Clerk secret is missing in cloud mode", () => {
    const policy = getCompileAuthPolicy(makeEnv({
      CLERK_SECRET_KEY: "",
    }));

    expect(policy).toEqual({
      error: "Missing required environment variable: CLERK_SECRET_KEY",
    });
  });

  it("fails closed when Clerk secret is a placeholder in cloud mode", () => {
    const policy = getCompileAuthPolicy(makeEnv({
      CLERK_SECRET_KEY: "sk_test_placeholder_value",
    }));

    expect(policy).toEqual({
      error: "Invalid CLERK_SECRET_KEY placeholder value",
    });
  });

  it("requires auth in cloud mode when Clerk secret is configured", () => {
    const policy = getCompileAuthPolicy(makeEnv({
      CLERK_SECRET_KEY: "sk_test_realish_value",
    }));

    expect(policy).toEqual({ allowAnonymous: false });
  });
});
