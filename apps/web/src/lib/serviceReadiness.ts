import { getCompileQueue } from "./compileQueue";
import { getCompileAuthPolicy } from "./compileAuth";
import { COMPILE_HEARTBEAT_KEY } from "@alove/queue/admission";
import { Snapshot } from "@vercel/sandbox";
import { vercelCompileSnapshot } from "./vercelCompile";

export async function serviceReadiness() {
  const checks = {
    configuration: !("error" in getCompileAuthPolicy()),
    redis: false,
    worker: false,
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        const client = await getCompileQueue().client;
        await client.ping();
        checks.redis = true;
        if (process.env.COMPILE_RUNTIME === "vercel-sandbox") {
          const snapshot = await Snapshot.get({
            snapshotId: vercelCompileSnapshot(),
            signal: AbortSignal.timeout(2000),
          });
          checks.worker =
            snapshot.status === "created" &&
            (!snapshot.expiresAt || snapshot.expiresAt.getTime() > Date.now());
        } else {
          const beat = Number(await client.get(COMPILE_HEARTBEAT_KEY));
          checks.worker =
            Number.isFinite(beat) &&
            beat > 0 &&
            Date.now() - beat >= 0 &&
            Date.now() - beat < 15_000;
        }
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Readiness timeout")), 2500);
      }),
    ]);
  } catch {
    /* Missing dependencies are unavailable, not healthy. */
  } finally {
    if (timer) clearTimeout(timer);
  }
  // Snapshot the result: a late connection must not mutate a response already returned.
  return { ok: Object.values(checks).every(Boolean), checks: { ...checks } };
}
