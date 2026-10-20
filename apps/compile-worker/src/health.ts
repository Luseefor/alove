import { readFile } from "node:fs/promises";

// Each worker writes its own heartbeat after Redis, BullMQ and its runtime probe pass.
// A shared Redis key alone cannot establish the health of this container.
try {
  const beat = Number(await readFile("/tmp/alove-worker-heartbeat", "utf8"));
  process.exit(Number.isFinite(beat) && Date.now() >= beat && Date.now() - beat < 15_000 ? 0 : 1);
} catch { process.exit(1); }
