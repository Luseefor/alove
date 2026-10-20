import { Queue, QueueEvents } from "bullmq";
import type { QueuedCompileJob, CompileJobResult } from "@alove/protocol";
import type { RedisOptions } from "ioredis";

export const COMPILE_QUEUE_NAME = "compile";

export type RedisConnectionRole = "producer" | "worker";

function parsePort(
  raw: string | undefined,
  source: string,
): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid ${source}: must be an integer 1..65535`);
  }
  return n;
}

function parseDb(
  raw: string | undefined,
  source: string,
): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid ${source}: must be a nonnegative integer`);
  }
  return n;
}

function safeDecode(value: string, source: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`Invalid ${source}: malformed percent-encoding`);
  }
}

export function redisConnectionOptions(
  role: RedisConnectionRole = "worker",
  env: NodeJS.ProcessEnv = process.env,
): RedisOptions {
  let urlHost: string | undefined;
  let urlPort: number | undefined;
  let urlUsername: string | undefined;
  let urlPassword: string | undefined;
  let urlDb: number | undefined;
  let urlProtocol: string | undefined;

  if (env.REDIS_URL && env.REDIS_URL !== "") {
    const rawUrl = env.REDIS_URL;
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error("Invalid REDIS_URL: unable to parse");
    }
    if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
      throw new Error("Invalid REDIS_URL: protocol must be redis:// or rediss://");
    }
    if (!parsed.hostname) {
      throw new Error("Invalid REDIS_URL: missing host");
    }
    urlHost = parsed.hostname;
    urlProtocol = parsed.protocol;
    if (parsed.port !== "") {
      const p = Number(parsed.port);
      if (!Number.isInteger(p) || p < 1 || p > 65535) {
        throw new Error("Invalid REDIS_URL: port must be an integer 1..65535");
      }
      urlPort = p;
    }
    if (parsed.username !== "") {
      urlUsername = safeDecode(parsed.username, "REDIS_URL credentials");
    }
    if (parsed.password !== "") {
      urlPassword = safeDecode(parsed.password, "REDIS_URL credentials");
    }
    if (parsed.pathname !== "" && parsed.pathname !== "/") {
      const dbPart = parsed.pathname.startsWith("/")
        ? parsed.pathname.slice(1)
        : parsed.pathname;
      if (!/^\d+$/.test(dbPart)) {
        throw new Error("Invalid REDIS_URL: db must be a nonnegative integer");
      }
      const dbNum = Number(dbPart);
      if (!Number.isInteger(dbNum) || dbNum < 0) {
        throw new Error("Invalid REDIS_URL: db must be a nonnegative integer");
      }
      urlDb = dbNum;
    }
    if (urlUsername !== undefined && /\s/.test(urlUsername)) {
      throw new Error("Invalid REDIS_URL credentials");
    }
  }

  const explicitHost =
    env.REDIS_HOST !== undefined && env.REDIS_HOST.trim() !== ""
      ? env.REDIS_HOST.trim()
      : undefined;
  const host = explicitHost ?? urlHost ?? "127.0.0.1";
  if (host.trim() === "") {
    throw new Error("Invalid REDIS_HOST: must be a non-empty host");
  }

  const port = parsePort(env.REDIS_PORT, "REDIS_PORT") ?? urlPort ?? 6379;

  const username =
    env.REDIS_USERNAME !== undefined && env.REDIS_USERNAME !== ""
      ? env.REDIS_USERNAME
      : urlUsername;
  if (username !== undefined && /\s/.test(username)) {
    throw new Error("Invalid REDIS_USERNAME: must not contain whitespace");
  }

  const password =
    env.REDIS_PASSWORD !== undefined && env.REDIS_PASSWORD !== ""
      ? env.REDIS_PASSWORD
      : urlPassword;

  const db = parseDb(env.REDIS_DB, "REDIS_DB") ?? urlDb ?? 0;

  const tlsFlag = (env.REDIS_TLS ?? "").toLowerCase() === "true";
  const isRediss = urlProtocol === "rediss:";
  const caRaw = env.REDIS_TLS_CA;
  const ca =
    caRaw !== undefined && caRaw.trim() !== ""
      ? caRaw.replace(/\\n/g, "\n")
      : undefined;
  const tlsEnabled = tlsFlag || isRediss || ca !== undefined;

  const base: RedisOptions = {
    host,
    port,
    username,
    password,
    db,
    retryStrategy: role === "producer" ? (times: number) => times > 1 ? null : 100 : (times: number) => Math.min(2000, 100 * 2 ** Math.min(times - 1, 5)),
    ...(tlsEnabled
      ? { tls: { rejectUnauthorized: true, ...(ca ? { ca } : {}) } }
      : {}),
  };

  if (role === "producer") {
    return {
      ...base,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2000,
      commandTimeout: 3000,
    };
  }

  return {
    ...base,
    maxRetriesPerRequest: null,
  };
}

export function createCompileQueue() {
  const connection = redisConnectionOptions("producer");
  const queue = new Queue<QueuedCompileJob, CompileJobResult>(
    COMPILE_QUEUE_NAME,
    {
      connection,
      defaultJobOptions: {
        removeOnComplete: { age: 3600, count: 10 },
        removeOnFail: { age: 86400, count: 20 },
        attempts: 1,
      },
    },
  );
  queue.on("error", () => console.error(JSON.stringify({ event: "compile.queue.unavailable" })));
  return queue;
}

export function createCompileQueueEvents() {
  return new QueueEvents(COMPILE_QUEUE_NAME, {
    connection: redisConnectionOptions("worker"),
  });
}
