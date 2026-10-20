import { describe, it, expect } from "vitest";
import { GET } from "./route";

describe("web liveness", () => {
  it("reports only web process availability with no service-health claims", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, service: "web" });
  });
});
