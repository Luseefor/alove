// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import { Webhook } from "svix";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

const modules = import.meta.glob("../../convex/**/*.*s");

declare global {
  interface ImportMeta {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
}

type TestClient = ReturnType<typeof convexTest>;

const TEST_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const USER_A = "user_alpha_delete_me";
const USER_B = "user_beta_keep_me";

let t: TestClient;
let msgCounter = 0;

beforeEach(() => {
  t = convexTest(schema, modules);
  vi.stubEnv("CLERK_WEBHOOK_SECRET", TEST_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function signedHeaders(raw: string, opts?: { msgId?: string; when?: Date; secret?: string }) {
  const secret = opts?.secret ?? TEST_SECRET;
  const wh = new Webhook(secret);
  const msgId = opts?.msgId ?? `msg_${Date.now()}_${msgCounter++}`;
  const when = opts?.when ?? new Date();
  const signature = wh.sign(msgId, when, raw);
  return {
    "svix-id": msgId,
    "svix-timestamp": Math.floor(when.getTime() / 1000).toString(),
    "svix-signature": signature,
  };
}

async function postWebhook(raw: string, headers: Record<string, string>) {
  return await t.fetch("/clerk-users-webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw,
  });
}

async function postSignedEvent(payload: unknown, opts?: { msgId?: string; when?: Date }) {
  const raw = JSON.stringify(payload);
  return await postWebhook(raw, signedHeaders(raw, opts));
}

async function drainScheduler() {
  vi.useFakeTimers();
  try {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
  }
}

async function seedUser(clerkId: string) {
  const client = t.withIdentity({ subject: clerkId });
  const projectId = await client.mutation(api.projects.create, { template: "blank" });
  await client.mutation(api.files.save, {
    projectId,
    path: "extra.tex",
    content: "owned content",
  });
  await client.mutation(api.presence.heartbeat, {
    projectId,
    name: "Owner",
    color: "red",
  });
  return projectId;
}

async function countOwned(clerkId: string) {
  const client = t.withIdentity({ subject: clerkId });
  const projects = await client.query(api.projects.listMine, {});
  let files = 0;
  let presence = 0;
  for (const project of projects) {
    files += (await client.query(api.files.list, { projectId: project._id })).length;
    presence += (await client.query(api.presence.list, { projectId: project._id })).length;
  }
  return { projects: projects.length, files, presence };
}

describe("clerk account deletion webhook", () => {
  it("deletes only the signed user, files and presence included", async () => {
    await seedUser(USER_A);
    await seedUser(USER_B);
    expect(await countOwned(USER_A)).toEqual({ projects: 1, files: 2, presence: 1 });

    const res = await postSignedEvent({ type: "user.deleted", data: { id: USER_A } });
    expect(res.status).toBe(200);
    await drainScheduler();

    expect(await countOwned(USER_A)).toEqual({ projects: 0, files: 0, presence: 0 });
    expect(await countOwned(USER_B)).toEqual({ projects: 1, files: 2, presence: 1 });
  });

  it("treats a duplicate delivery as idempotent", async () => {
    await seedUser(USER_A);
    const raw = JSON.stringify({ type: "user.deleted", data: { id: USER_A } });
    const headers = signedHeaders(raw, { msgId: "msg_duplicate_1" });

    expect((await postWebhook(raw, headers)).status).toBe(200);
    await drainScheduler();
    expect(await countOwned(USER_A)).toEqual({ projects: 0, files: 0, presence: 0 });

    expect((await postWebhook(raw, headers)).status).toBe(200);
    await drainScheduler();
    expect(await countOwned(USER_A)).toEqual({ projects: 0, files: 0, presence: 0 });
  });

  it("ignores other authentic event types", async () => {
    await seedUser(USER_A);
    const res = await postSignedEvent({ type: "user.created", data: { id: USER_A } });
    expect(res.status).toBe(200);
    await drainScheduler();
    expect(await countOwned(USER_A)).toEqual({ projects: 1, files: 2, presence: 1 });
  });

  it("rejects missing, tampered, and stale signatures with no side effects", async () => {
    await seedUser(USER_A);

    const missing = await t.fetch("/clerk-users-webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "user.deleted", data: { id: USER_A } }),
    });
    expect(missing.status).toBe(400);

    const raw = JSON.stringify({ type: "user.deleted", data: { id: USER_A } });
    const good = signedHeaders(raw);
    const tamperedBody = await postWebhook(
      JSON.stringify({ type: "user.deleted", data: { id: "user_attacker" } }),
      good,
    );
    expect(tamperedBody.status).toBe(401);

    const badSig = { ...signedHeaders(raw), "svix-signature": "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" };
    expect((await postWebhook(raw, badSig)).status).toBe(401);

    const staleDate = new Date(Date.now() - 10 * 60 * 1000);
    const staleRaw = JSON.stringify({ type: "user.deleted", data: { id: USER_A } });
    expect((await postWebhook(staleRaw, signedHeaders(staleRaw, { when: staleDate }))).status).toBe(
      401,
    );

    await drainScheduler();
    expect(await countOwned(USER_A)).toEqual({ projects: 1, files: 2, presence: 1 });
  });

  it("rejects malformed payloads and bad user ids with no side effects", async () => {
    await seedUser(USER_A);

    const notJson = "{oops";
    expect((await postWebhook(notJson, signedHeaders(notJson))).status).toBe(400);

    const noData = await postSignedEvent({ type: "user.deleted", data: {} });
    expect(noData.status).toBe(400);

    const emptyId = await postSignedEvent({ type: "user.deleted", data: { id: "" } });
    expect(emptyId.status).toBe(400);

    const longId = await postSignedEvent({
      type: "user.deleted",
      data: { id: "x".repeat(201) },
    });
    expect(longId.status).toBe(400);

    await drainScheduler();
    expect(await countOwned(USER_A)).toEqual({ projects: 1, files: 2, presence: 1 });
  });

  it("fails closed with 503 when the secret is missing", async () => {
    await seedUser(USER_A);
    vi.stubEnv("CLERK_WEBHOOK_SECRET", "");
    const res = await postSignedEvent({ type: "user.deleted", data: { id: USER_A } });
    expect(res.status).toBe(503);
    await drainScheduler();
    expect(await countOwned(USER_A)).toEqual({ projects: 1, files: 2, presence: 1 });
  });

  it("rejects bodies past 64 KiB with no side effects", async () => {
    await seedUser(USER_A);
    const raw = JSON.stringify({
      type: "user.deleted",
      data: { id: USER_A, padding: "x".repeat(70 * 1024) },
    });
    expect(new TextEncoder().encode(raw).length).toBeGreaterThan(64 * 1024);
    const res = await postWebhook(raw, signedHeaders(raw));
    expect(res.status).toBe(413);
    await drainScheduler();
    expect(await countOwned(USER_A)).toEqual({ projects: 1, files: 2, presence: 1 });
  });
});
