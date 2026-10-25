import { expect, it, vi } from "vitest";
import { getConvexToken } from "./convexToken";

it.each(["convex", ["convex", "another-service"]])("uses the native session token for its verified Convex audience: %s", async aud => {
  const getToken = vi.fn().mockResolvedValue("native-token");
  expect(await getConvexToken({ sessionClaims: { aud }, getToken })).toBe("native-token");
  expect(getToken).toHaveBeenCalledWith();
});

it.each([undefined, "other-service", ["other-service"]])("preserves legacy template installations when Convex is absent from session claims: %s", async aud => {
  const getToken = vi.fn().mockResolvedValue("template-token");
  expect(await getConvexToken({ sessionClaims: { aud }, getToken })).toBe("template-token");
  expect(getToken).toHaveBeenCalledWith({ template: "convex" });
});

it("does not replace a missing native token with a token for a different audience", async () => {
  const getToken = vi.fn().mockResolvedValue(null);
  expect(await getConvexToken({ sessionClaims: { aud: "convex" }, getToken })).toBeNull();
  expect(getToken).toHaveBeenCalledOnce();
});
