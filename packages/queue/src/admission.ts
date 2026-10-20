import { createHash } from "node:crypto";
import type { CompileJobOwner } from "@alove/protocol";
import type { RedisClient } from "bullmq";

export const COMPILE_ADMISSION_DEFAULTS = { perMinute: 30, perOwner: 3, global: 12 } as const;
export const COMPILE_HEARTBEAT_KEY = "alove:compile:worker:heartbeat";

export type AdmissionLimits = { perMinute: number; perOwner: number; global: number };
export function compileAdmissionLimits(env: NodeJS.ProcessEnv = process.env): AdmissionLimits {
  function integer(name: string, fallback: number, max: number): number {
    const n = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new Error(`Invalid ${name}`);
    return n;
  }
  return {
    perMinute: integer("COMPILE_RATE_PER_MINUTE", 30, 300),
    perOwner: integer("COMPILE_MAX_OWNER_JOBS", 3, 10),
    global: integer("COMPILE_MAX_QUEUED_JOBS", 12, 100),
  };
}

function keys(owner: CompileJobOwner, queuePrefix: string) {
  const hash = createHash("sha256").update(JSON.stringify(owner)).digest("hex");
  const prefix = `${queuePrefix}:admission`;
  return { global: `${prefix}:active`, owner: `${prefix}:owner:${hash}`, rate: `${prefix}:rate:${hash}` };
}

// An expired reservation is reclaimed only when its job never arrived or finished.
// Waiting/active jobs retain their slot through long worker or Redis outages.
const RESERVE = `
local global = KEYS[1]
local owner = KEYS[2]
local rate = KEYS[3]
local now = tonumber(ARGV[1])
local id = ARGV[2]
local prefix = ARGV[3]
for _, token in ipairs(redis.call('ZRANGEBYSCORE', global, '-inf', now)) do
  local job = prefix .. token
  if redis.call('EXISTS', job) == 0 or redis.call('HEXISTS', job, 'finishedOn') == 1 then
    local ownerKey = redis.call('HGET', KEYS[4], token)
    if ownerKey then redis.call('ZREM', ownerKey, token) end
    redis.call('ZREM', global, token)
    redis.call('HDEL', KEYS[4], token)
  end
end
redis.call('ZREMRANGEBYSCORE', rate, '-inf', now - 60000)
if redis.call('ZCARD', global) >= tonumber(ARGV[6]) then return {0, 5} end
if redis.call('ZCARD', owner) >= tonumber(ARGV[5]) then return {0, 5} end
if redis.call('ZCARD', rate) >= tonumber(ARGV[4]) then
  local oldest = redis.call('ZRANGE', rate, 0, 0, 'WITHSCORES')
  return {0, math.max(1, math.ceil((tonumber(oldest[2]) + 60000 - now) / 1000))}
end
redis.call('ZADD', global, now + 30000, id)
redis.call('ZADD', owner, now + 30000, id)
redis.call('HSET', KEYS[4], id, owner)
redis.call('ZADD', rate, now, id)
redis.call('PEXPIRE', rate, 61000)
return {1, 0}
`;

export async function reserveCompileAdmission(client: RedisClient, owner: CompileJobOwner, id: string,
  queuePrefix: string, limits = compileAdmissionLimits(), now = Date.now()): Promise<{ allowed: boolean; retryAfter: number }> {
  const k = keys(owner, queuePrefix);
  const result = await client.eval(RESERVE, 4, k.global, k.owner, k.rate, `${queuePrefix}:admission:owners`,
    now, id, `${queuePrefix}:`, limits.perMinute, limits.perOwner, limits.global) as [number, number];
  return { allowed: result[0] === 1, retryAfter: result[1] };
}

export async function releaseCompileAdmission(client: RedisClient, owner: CompileJobOwner, id: string,
  queuePrefix: string, onlyIfJobMissing = false): Promise<void> {
  const k = keys(owner, queuePrefix);
  await client.eval(`
if ARGV[2] == '1' and redis.call('EXISTS', KEYS[4]) == 1 then return 0 end
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('HDEL', KEYS[3], ARGV[1])
return 1`, 4, k.global, k.owner, `${queuePrefix}:admission:owners`, `${queuePrefix}:${id}`, id, onlyIfJobMissing ? "1" : "0");
}

export function compileCancellationKey(jobId: string): string { return `alove:compile:cancel:${jobId}`; }
