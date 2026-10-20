import { describe, test, expect } from "bun:test";
import { redisConnectionOptions } from "../src/index.ts";

// Pure config tests. No Queue/QueueEvents instantiation, no Redis network.

const SECRET = "s3cr3t-pw-9f8e7d6c5b";

function expectNoSecret(fn: () => unknown, secrets: string[] = [SECRET]) {
  try {
    fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    for (const s of secrets) expect(msg).not.toContain(s);
    return;
  }
  throw new Error("expected to throw");
}

describe("defaults preserve existing worker call", () => {
  test("no-arg call is worker shaped", () => {
    const opts = redisConnectionOptions();
    expect(opts.maxRetriesPerRequest).toBeNull();
    expect(opts.commandTimeout).toBeUndefined();
    expect(typeof opts.host).toBe("string");
    expect(typeof opts.port).toBe("number");
  });
  test("explicit default role matches worker", () => {
    const a = redisConnectionOptions(undefined, {});
    const b = redisConnectionOptions("worker", {});
    expect(a.maxRetriesPerRequest).toBeNull();
    expect(b.maxRetriesPerRequest).toBeNull();
    expect(a.commandTimeout).toBeUndefined();
  });
  test("empty env falls back to localhost", () => {
    const opts = redisConnectionOptions("worker", {});
    expect(opts.host).toBe("127.0.0.1");
    expect(opts.port).toBe(6379);
    expect(opts.db).toBe(0);
  });
});

describe("explicit host/port/auth/db", () => {
  test("reads explicit vars", () => {
    const opts = redisConnectionOptions("worker", {
      REDIS_HOST: "redis.internal",
      REDIS_PORT: "6380",
      REDIS_USERNAME: "default",
      REDIS_PASSWORD: "pw123",
      REDIS_DB: "2",
    });
    expect(opts.host).toBe("redis.internal");
    expect(opts.port).toBe(6380);
    expect(opts.username).toBe("default");
    expect(opts.password).toBe("pw123");
    expect(opts.db).toBe(2);
  });
  test("explicit vars override REDIS_URL", () => {
    const opts = redisConnectionOptions("worker", {
      REDIS_URL: "redis://urlhost:6379/1",
      REDIS_HOST: "override",
      REDIS_PORT: "6381",
    });
    expect(opts.host).toBe("override");
    expect(opts.port).toBe(6381);
  });
});

describe("REDIS_URL", () => {
  test("parses redis:// with auth and db", () => {
    const opts = redisConnectionOptions("worker", {
      REDIS_URL: "redis://bob:hunter2@redis.example:6380/2",
    });
    expect(opts.host).toBe("redis.example");
    expect(opts.port).toBe(6380);
    expect(opts.username).toBe("bob");
    expect(opts.password).toBe("hunter2");
    expect(opts.db).toBe(2);
    expect(opts.tls).toBeUndefined();
  });
  test("decodes percent-encoded credentials", () => {
    const opts = redisConnectionOptions("worker", {
      REDIS_URL: "redis://user:p%40ss%3Aw0rd@h:6379/0",
    });
    expect(opts.username).toBe("user");
    expect(opts.password).toBe("p@ss:w0rd");
  });
  test("rediss:// forces TLS", () => {
    const opts = redisConnectionOptions("worker", {
      REDIS_URL: "rediss://h:6379/0",
    });
    expect(opts.tls).toBeDefined();
    expect(opts.tls?.rejectUnauthorized).toBe(true);
  });
  test("rejects bad protocol without leaking credentials", () => {
    const env = { REDIS_URL: `http://bob:${SECRET}@h:6379/0` };
    let msg = "";
    try {
      redisConnectionOptions("worker", env);
    } catch (err) {
      msg = err instanceof Error ? err.message : String(err);
    }
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).not.toContain(SECRET);
    expect(msg).not.toContain("bob");
  });
  test("rejects missing host, bad port, bad db", () => {
    expect(() =>
      redisConnectionOptions("worker", { REDIS_URL: "redis:///0" }),
    ).toThrow();
    expect(() =>
      redisConnectionOptions("worker", { REDIS_URL: "redis://h:99999/0" }),
    ).toThrow();
    expect(() =>
      redisConnectionOptions("worker", { REDIS_URL: "redis://h/abc" }),
    ).toThrow();
    expect(() =>
      redisConnectionOptions("worker", { REDIS_URL: "not-a-url" }),
    ).toThrow();
  });
});

describe("TLS", () => {
  test("REDIS_TLS=true enables TLS with rejectUnauthorized true", () => {
    const opts = redisConnectionOptions("worker", { REDIS_TLS: "true" });
    expect(opts.tls).toBeDefined();
    expect(opts.tls?.rejectUnauthorized).toBe(true);
  });
  test("REDIS_TLS_CA PEM is passed as ca, \\n unescaped", () => {
    const pem = "-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----";
    const opts = redisConnectionOptions("worker", {
      REDIS_TLS: "true",
      REDIS_TLS_CA: pem,
    });
    expect(opts.tls?.rejectUnauthorized).toBe(true);
    expect(opts.tls?.ca).toBe(pem.replace(/\\n/g, "\n"));
  });
  test("no TLS by default", () => {
    const opts = redisConnectionOptions("worker", {});
    expect(opts.tls).toBeUndefined();
  });
});

describe("roles", () => {
  test("producer fails fast", () => {
    const opts = redisConnectionOptions("producer", {});
    expect(opts.maxRetriesPerRequest).toBe(1);
    expect(opts.enableOfflineQueue).toBe(false);
    expect(opts.connectTimeout).toBe(2000);
    expect(opts.commandTimeout).toBe(3000);
  });
  test("worker allows blocking", () => {
    const opts = redisConnectionOptions("worker", {});
    expect(opts.maxRetriesPerRequest).toBeNull();
    expect(opts.commandTimeout).toBeUndefined();
    expect(opts.enableOfflineQueue).not.toBe(false);
  });
  test("producer stops retrying quickly while worker reconnect delay stays bounded", () => {
    const producer = redisConnectionOptions("producer", {}).retryStrategy!;
    expect(producer(1)).toBe(100);
    expect(producer(2)).toBeNull();
    const worker = redisConnectionOptions("worker", {}).retryStrategy!;
    expect(worker(1)).toBeGreaterThan(0);
    expect(worker(1000)).toBe(2000);
  });
});

describe("invalid env", () => {
  test("rejects bad ports", () => {
    for (const p of ["0", "65536", "abc", "6.5", "-1"]) {
      expect(() =>
        redisConnectionOptions("worker", { REDIS_PORT: p }),
      ).toThrow();
    }
  });
  test("rejects bad db", () => {
    for (const d of ["-1", "1.5", "abc"]) {
      expect(() =>
        redisConnectionOptions("worker", { REDIS_DB: d }),
      ).toThrow();
    }
  });
  test("rejects whitespace username", () => {
    expect(() =>
      redisConnectionOptions("worker", { REDIS_USERNAME: "bad name" }),
    ).toThrow();
  });
  test("password never appears in error messages", () => {
    expectNoSecret(() =>
      redisConnectionOptions("worker", {
        REDIS_PASSWORD: SECRET,
        REDIS_PORT: "bogus",
      }),
    );
    expectNoSecret(() =>
      redisConnectionOptions("producer", {
        REDIS_PASSWORD: SECRET,
        REDIS_DB: "-5",
      }),
    );
    expectNoSecret(
      () =>
        redisConnectionOptions("worker", {
          REDIS_URL: `redis://u:${encodeURIComponent(SECRET)}@h:6379/0`,
          REDIS_PORT: "bogus",
        }),
      [SECRET, encodeURIComponent(SECRET)],
    );
  });
});
