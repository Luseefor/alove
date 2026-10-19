import { describe, it, expect, vi } from "vitest";
import { GET } from "./route";

vi.mock("next/server", () => {
  return {
    NextResponse: {
      json: vi.fn((body) => body),
    },
  };
});

describe("Health Check API", () => {
  it("returns configured status for production", async () => {
    const originalEnv = process.env;
    process.env = { ...originalEnv, NEXT_PUBLIC_LOCAL_STANDALONE: "false", CLERK_SECRET_KEY: "secret" };
    
    const response = await GET();
    
    expect(response).toMatchObject({
      ok: true,
      service: "web",
      mode: "cloud",
      auth: "configured",
    });

    process.env = originalEnv;
  });

  it("returns local_bypass for local standalone", async () => {
    const originalEnv = process.env;
    process.env = { ...originalEnv, NEXT_PUBLIC_LOCAL_STANDALONE: "true" };
    
    const response = await GET();
    
    expect(response).toMatchObject({
      ok: true,
      service: "web",
      mode: "local",
      auth: "local_bypass",
    });

    process.env = originalEnv;
  });

  it("identifies missing clerk config", async () => {
    const originalEnv = process.env;
    process.env = { ...originalEnv, NEXT_PUBLIC_LOCAL_STANDALONE: "false", CLERK_SECRET_KEY: "placeholder" };
    
    const response = await GET();
    
    expect(response).toMatchObject({
      ok: true,
      service: "web",
      mode: "cloud",
      auth: "missing",
    });

    process.env = originalEnv;
  });
});
