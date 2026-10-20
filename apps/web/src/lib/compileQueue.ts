import type { Queue } from "bullmq";
import { createCompileQueue } from "@alove/queue";
import type { QueuedCompileJob, CompileJobResult } from "@alove/protocol";

const globalForQueue = globalThis as unknown as {
  compileQueue?: Queue<QueuedCompileJob, CompileJobResult>;
};

export function getCompileQueue() {
  if (!globalForQueue.compileQueue) {
    const queue = createCompileQueue();
    globalForQueue.compileQueue = queue;
    const discard = () => {
      if (globalForQueue.compileQueue === queue) globalForQueue.compileQueue = undefined;
      void queue.close().catch(() => {});
    };
    void queue.client.then((client) => client.once("end", discard)).catch(discard);
    void queue.waitUntilReady().catch(discard);
  }
  return globalForQueue.compileQueue;
}
