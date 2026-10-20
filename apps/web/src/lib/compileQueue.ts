import type { Queue } from "bullmq";
import { createCompileQueue } from "@alove/queue";
import type { QueuedCompileJob, CompileJobResult } from "@alove/protocol";

const globalForQueue = globalThis as unknown as {
  compileQueue?: Queue<QueuedCompileJob, CompileJobResult>;
};

export function getCompileQueue() {
  if (!globalForQueue.compileQueue) {
    globalForQueue.compileQueue = createCompileQueue();
  }
  return globalForQueue.compileQueue;
}
