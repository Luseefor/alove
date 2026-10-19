import type { CompileJobPayload } from "@alove/protocol";

export type RecoveryBenchmarkCase = {
  id: string;
  label: string;
  category: string;
  expected: "verified" | "unresolved" | "incompatible";
  expectedPath?: string;
  good: Omit<CompileJobPayload, "projectId">;
  failed: Omit<CompileJobPayload, "projectId">;
  /** Files whose failed-version content must survive a verified restoration. */
  preservePaths: string[];
};
