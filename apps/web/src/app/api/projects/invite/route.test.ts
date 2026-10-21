// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn(), mutation: vi.fn(), users: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth, clerkClient: async () => ({ users: { getUserList: mocks.users } }) }));
vi.mock("convex/nextjs", () => ({ fetchQuery: mocks.query, fetchMutation: mocks.mutation }));
import { POST } from "./route";
function request(args: unknown = { projectId: "p", email: "bob@example.com", role: "editor" }, origin = "https://alove.example") { return new Request("https://alove.example/api/projects/invite", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(args) }); }
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ userId: "alice", getToken: async () => "session-token" }); mocks.query.mockResolvedValue({ _id: "p", ownerId: "alice" }); mocks.users.mockResolvedValue({ data: [{ id: "bob", emailAddresses: [{ emailAddress: "bob@example.com", verification: { status: "verified" } }] }] }); mocks.mutation.mockResolvedValue("invite"); });
describe("invitation email resolution", () => {
  it("rejects cross-origin requests before authentication or user lookup", async () => { expect((await POST(request(undefined, "https://other.example"))).status).toBe(403); expect(mocks.auth).not.toHaveBeenCalled(); });
  it("requires a signed in account", async () => { mocks.auth.mockResolvedValue({ userId: null }); expect((await POST(request())).status).toBe(401); expect(mocks.users).not.toHaveBeenCalled(); });
  it("checks ownership before exposing whether another account exists", async () => { mocks.query.mockResolvedValue({ _id: "p", ownerId: "other", role: "editor" }); expect((await POST(request())).status).toBe(403); expect(mocks.users).not.toHaveBeenCalled(); });
  it("requires the target email to be verified", async () => { mocks.users.mockResolvedValue({ data: [{ id: "bob", emailAddresses: [{ emailAddress: "bob@example.com", verification: { status: "unverified" } }] }] }); expect((await POST(request())).status).toBe(404); expect(mocks.mutation).not.toHaveBeenCalled(); });
  it("resolves verified email to an opaque recipient id using only server authentication", async () => { const result = await POST(request()); expect(result.status).toBe(200); expect(mocks.mutation).toHaveBeenCalledWith(expect.anything(), { projectId: "p", userId: "bob", displayName: "bob@example.com", role: "editor" }, expect.objectContaining({ token: "session-token" })); expect(await result.json()).toEqual({ invited: true }); });
});
