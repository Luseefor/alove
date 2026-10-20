import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import type { CompileJobOwner } from "@alove/protocol";
import {
  reserveCompileAdmission,
  releaseCompileAdmission,
  compileAdmissionLimits,
} from "../src/admission.ts";

// Integration tests against a real Redis. They run only when CI sets
// TEST_REDIS_PORT or TEST_REDIS_URL. Without either, the suite skips
// instead of failing or opening a network connection by default.
const portRaw = process.env.TEST_REDIS_PORT;
const urlRaw = process.env.TEST_REDIS_URL;
const hasRedis =
  (portRaw !== undefined && portRaw.trim() !== "") ||
  (urlRaw !== undefined && urlRaw.trim() !== "");

const describeRedis = hasRedis ? describe : describe.skip;

function buildClient(): Redis {
  if (urlRaw !== undefined && urlRaw.trim() !== "") return new Redis(urlRaw);
  return new Redis({
    host: "127.0.0.1",
    port: Number(portRaw),
  });
}

function testPrefix(): string {
  return `alove:test:admission:${randomUUID()}`;
}

function user(id: string): CompileJobOwner {
  return { kind: "user", userId: id };
}

// Delete only keys under this test prefix. Never flush the database,
// never touch Bull keys or any existing worker data.
async function cleanupPrefix(client: Redis, prefix: string): Promise<void> {
  let cursor = "0";
  do {
    const [next, found] = await client.scan(
      cursor,
      "MATCH",
      `${prefix}*`,
      "COUNT",
      100,
    );
    cursor = next;
    if (found.length > 0) await client.del(...found);
  } while (cursor !== "0");
}

describe("compileAdmissionLimits bounds", () => {
  test("defaults match public contract", () => {
    expect(compileAdmissionLimits({} as NodeJS.ProcessEnv)).toEqual({
      perMinute: 30,
      perOwner: 3,
      global: 12,
    });
  });

  test("accepts values at the max boundary", () => {
    const limits = compileAdmissionLimits({
      COMPILE_RATE_PER_MINUTE: "300",
      COMPILE_MAX_OWNER_JOBS: "10",
      COMPILE_MAX_QUEUED_JOBS: "100",
    } as unknown as NodeJS.ProcessEnv);
    expect(limits).toEqual({ perMinute: 300, perOwner: 10, global: 100 });
  });

  test("rejects zero, negative, fractional, and non numeric input", () => {
    for (const bad of ["0", "-1", "1.5", "abc", ""]) {
      expect(() =>
        compileAdmissionLimits({
          COMPILE_RATE_PER_MINUTE: bad,
        } as unknown as NodeJS.ProcessEnv),
      ).toThrow("Invalid COMPILE_RATE_PER_MINUTE");
      expect(() =>
        compileAdmissionLimits({
          COMPILE_MAX_OWNER_JOBS: bad,
        } as unknown as NodeJS.ProcessEnv),
      ).toThrow("Invalid COMPILE_MAX_OWNER_JOBS");
      expect(() =>
        compileAdmissionLimits({
          COMPILE_MAX_QUEUED_JOBS: bad,
        } as unknown as NodeJS.ProcessEnv),
      ).toThrow("Invalid COMPILE_MAX_QUEUED_JOBS");
    }
  });

  test("rejects values above the max", () => {
    expect(() =>
      compileAdmissionLimits({
        COMPILE_RATE_PER_MINUTE: "301",
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow("Invalid COMPILE_RATE_PER_MINUTE");
    expect(() =>
      compileAdmissionLimits({
        COMPILE_MAX_OWNER_JOBS: "11",
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow("Invalid COMPILE_MAX_OWNER_JOBS");
    expect(() =>
      compileAdmissionLimits({
        COMPILE_MAX_QUEUED_JOBS: "101",
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow("Invalid COMPILE_MAX_QUEUED_JOBS");
  });
});

describeRedis("admission redis integration", () => {
  let client: Redis;

  beforeAll(async () => {
    client = buildClient();
    await client.ping();
  });

  afterAll(async () => {
    if (client) await client.quit();
  });

  test("per owner cap holds across 20 parallel attempts", async () => {
    const prefix = testPrefix();
    try {
      const owner = user(`owner-${randomUUID()}`);
      const limits = { perMinute: 100, perOwner: 3, global: 100 };
      const now = Date.now();
      const tag = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          reserveCompileAdmission(
            client,
            owner,
            `job-${tag}-${i}`,
            prefix,
            limits,
            now,
          ),
        ),
      );
      const allowed = results.filter((r) => r.allowed);
      const denied = results.filter((r) => !r.allowed);
      expect(allowed.length).toBe(3);
      expect(denied.length).toBe(17);
      for (const r of allowed) expect(r.retryAfter).toBe(0);
      for (const r of denied) expect(r.retryAfter).toBe(5);
    } finally {
      await cleanupPrefix(client, prefix);
    }
  });

  test("global cap holds across distinct owners", async () => {
    const prefix = testPrefix();
    try {
      const limits = { perMinute: 30, perOwner: 3, global: 12 };
      const now = Date.now();
      const tag = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          reserveCompileAdmission(
            client,
            user(`global-${tag}-${i}`),
            `job-${tag}-${i}`,
            prefix,
            limits,
            now,
          ),
        ),
      );
      expect(results.filter((r) => r.allowed).length).toBe(12);
      expect(results.filter((r) => !r.allowed).length).toBe(8);
      for (const r of results.filter((r) => !r.allowed))
        expect(r.retryAfter).toBe(5);
    } finally {
      await cleanupPrefix(client, prefix);
    }
  });

  test("per minute rate still applies after slot release", async () => {
    const prefix = testPrefix();
    try {
      const owner = user(`rate-${randomUUID()}`);
      const limits = { perMinute: 3, perOwner: 10, global: 100 };
      const now = Date.now();
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      for (const id of ids) {
        const r = await reserveCompileAdmission(
          client,
          owner,
          id,
          prefix,
          limits,
          now,
        );
        expect(r.allowed).toBe(true);
      }
      for (const id of ids)
        await releaseCompileAdmission(client, owner, id, prefix);
      const blocked = await reserveCompileAdmission(
        client,
        owner,
        randomUUID(),
        prefix,
        limits,
        now,
      );
      expect(blocked.allowed).toBe(false);
      expect(blocked.retryAfter).toBeGreaterThanOrEqual(1);
      expect(blocked.retryAfter).toBeLessThanOrEqual(60);
      const afterWindow = await reserveCompileAdmission(
        client,
        owner,
        randomUUID(),
        prefix,
        limits,
        now + 61_000,
      );
      expect(afterWindow.allowed).toBe(true);
    } finally {
      await cleanupPrefix(client, prefix);
    }
  });

  test("expired reservation with no job is reclaimed after 30s", async () => {
    const prefix = testPrefix();
    try {
      const owner = user(`expiry-${randomUUID()}`);
      const limits = { perMinute: 100, perOwner: 1, global: 100 };
      const now = Date.now();
      const first = await reserveCompileAdmission(
        client,
        owner,
        "job-a",
        prefix,
        limits,
        now,
      );
      expect(first.allowed).toBe(true);
      const full = await reserveCompileAdmission(
        client,
        owner,
        "job-b",
        prefix,
        limits,
        now,
      );
      expect(full.allowed).toBe(false);
      const reclaimed = await reserveCompileAdmission(
        client,
        owner,
        "job-c",
        prefix,
        limits,
        now + 31_000,
      );
      expect(reclaimed.allowed).toBe(true);
    } finally {
      await cleanupPrefix(client, prefix);
    }
  });

  test("waiting job hash keeps its slot through an outage", async () => {
    const prefix = testPrefix();
    try {
      const owner = user(`outage-${randomUUID()}`);
      const limits = { perMinute: 100, perOwner: 1, global: 100 };
      const now = Date.now();
      const held = await reserveCompileAdmission(
        client,
        owner,
        "job-held",
        prefix,
        limits,
        now,
      );
      expect(held.allowed).toBe(true);
      await client.hset(`${prefix}:job-held`, "state", "waiting");
      const afterExpiry = await reserveCompileAdmission(
        client,
        owner,
        "job-new",
        prefix,
        limits,
        now + 31_000,
      );
      expect(afterExpiry.allowed).toBe(false);
      const longOutage = await reserveCompileAdmission(
        client,
        owner,
        "job-late",
        prefix,
        limits,
        now + 600_000,
      );
      expect(longOutage.allowed).toBe(false);
    } finally {
      await cleanupPrefix(client, prefix);
    }
  });

  test("job with finishedOn frees its slot after expiry", async () => {
    const prefix = testPrefix();
    try {
      const owner = user(`finished-${randomUUID()}`);
      const limits = { perMinute: 100, perOwner: 1, global: 100 };
      const now = Date.now();
      const first = await reserveCompileAdmission(
        client,
        owner,
        "job-done",
        prefix,
        limits,
        now,
      );
      expect(first.allowed).toBe(true);
      await client.hset(`${prefix}:job-done`, "finishedOn", String(now));
      const immediate = await reserveCompileAdmission(
        client,
        owner,
        "job-next",
        prefix,
        limits,
        now,
      );
      expect(immediate.allowed).toBe(false);
      const afterExpiry = await reserveCompileAdmission(
        client,
        owner,
        "job-next",
        prefix,
        limits,
        now + 31_000,
      );
      expect(afterExpiry.allowed).toBe(true);
    } finally {
      await cleanupPrefix(client, prefix);
    }
  });

  test("release with onlyIfJobMissing keeps a possibly enqueued job", async () => {
    const prefix = testPrefix();
    try {
      const owner = user(`ambiguous-${randomUUID()}`);
      const limits = { perMinute: 100, perOwner: 1, global: 100 };
      const now = Date.now();
      const first = await reserveCompileAdmission(
        client,
        owner,
        "job-amb",
        prefix,
        limits,
        now,
      );
      expect(first.allowed).toBe(true);
      await client.hset(`${prefix}:job-amb`, "state", "waiting");
      await releaseCompileAdmission(client, owner, "job-amb", prefix, true);
      const stillFull = await reserveCompileAdmission(
        client,
        owner,
        "job-other",
        prefix,
        limits,
        now,
      );
      expect(stillFull.allowed).toBe(false);
    } finally {
      await cleanupPrefix(client, prefix);
    }
  });

  test("release with onlyIfJobMissing frees a reservation with no job", async () => {
    const prefix = testPrefix();
    try {
      const owner = user(`missing-${randomUUID()}`);
      const limits = { perMinute: 100, perOwner: 1, global: 100 };
      const now = Date.now();
      const first = await reserveCompileAdmission(
        client,
        owner,
        "job-ghost",
        prefix,
        limits,
        now,
      );
      expect(first.allowed).toBe(true);
      await releaseCompileAdmission(client, owner, "job-ghost", prefix, true);
      const freed = await reserveCompileAdmission(
        client,
        owner,
        "job-after",
        prefix,
        limits,
        now,
      );
      expect(freed.allowed).toBe(true);
    } finally {
      await cleanupPrefix(client, prefix);
    }
  });

  test("unconditional release frees the slot even when the job exists", async () => {
    const prefix = testPrefix();
    try {
      const owner = user(`force-${randomUUID()}`);
      const limits = { perMinute: 100, perOwner: 1, global: 100 };
      const now = Date.now();
      const first = await reserveCompileAdmission(
        client,
        owner,
        "job-x",
        prefix,
        limits,
        now,
      );
      expect(first.allowed).toBe(true);
      await client.hset(`${prefix}:job-x`, "state", "waiting");
      await releaseCompileAdmission(client, owner, "job-x", prefix, false);
      const freed = await reserveCompileAdmission(
        client,
        owner,
        "job-y",
        prefix,
        limits,
        now,
      );
      expect(freed.allowed).toBe(true);
    } finally {
      await cleanupPrefix(client, prefix);
    }
  });

  test("owners are isolated from each other", async () => {
    const prefix = testPrefix();
    try {
      const ownerA = user(`iso-a-${randomUUID()}`);
      const ownerB = user(`iso-b-${randomUUID()}`);
      const limits = { perMinute: 100, perOwner: 2, global: 10 };
      const now = Date.now();
      expect(
        (await reserveCompileAdmission(client, ownerA, "a-1", prefix, limits, now))
          .allowed,
      ).toBe(true);
      expect(
        (await reserveCompileAdmission(client, ownerA, "a-2", prefix, limits, now))
          .allowed,
      ).toBe(true);
      expect(
        (await reserveCompileAdmission(client, ownerA, "a-3", prefix, limits, now))
          .allowed,
      ).toBe(false);
      expect(
        (await reserveCompileAdmission(client, ownerB, "b-1", prefix, limits, now))
          .allowed,
      ).toBe(true);
    } finally {
      await cleanupPrefix(client, prefix);
    }
  });

  test("per minute rate is tracked per owner", async () => {
    const prefix = testPrefix();
    try {
      const ownerA = user(`rate-a-${randomUUID()}`);
      const ownerB = user(`rate-b-${randomUUID()}`);
      const limits = { perMinute: 2, perOwner: 10, global: 100 };
      const now = Date.now();
      expect(
        (await reserveCompileAdmission(client, ownerA, "ra-1", prefix, limits, now))
          .allowed,
      ).toBe(true);
      expect(
        (await reserveCompileAdmission(client, ownerA, "ra-2", prefix, limits, now))
          .allowed,
      ).toBe(true);
      expect(
        (await reserveCompileAdmission(client, ownerA, "ra-3", prefix, limits, now))
          .allowed,
      ).toBe(false);
      expect(
        (await reserveCompileAdmission(client, ownerB, "rb-1", prefix, limits, now))
          .allowed,
      ).toBe(true);
    } finally {
      await cleanupPrefix(client, prefix);
    }
  });
});
