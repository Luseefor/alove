import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkbenchStore } from "@/stores/workbenchStore";
import { prepareSourceReplacement } from "./prepareSourceReplacement";
beforeEach(() => {
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useWorkbenchStore.setState({ projectId: "p", projectRole: "editor", documentRevision: 3, saveStatus: "saved", saveAllDirtyFiles: vi.fn().mockResolvedValue(undefined), persistence: {} });
  useWorkbenchStore.setState({ documentRevision: 3 });
});
describe("replacement checkpoints", () => {
  it("flushes source before requesting a durable cloud checkpoint", async () => {
    const calls: string[] = [];
    useWorkbenchStore.setState({ saveAllDirtyFiles: async () => { calls.push("flush"); }, persistence: { checkpointSource: async revision => { expect(revision).toBe(3); calls.push("checkpoint"); } } });
    expect(await prepareSourceReplacement({ expectedDocumentRevision: 3 })).toEqual({ proceed: true }); expect(calls).toEqual(["flush", "checkpoint"]);
  });
  it("blocks after failed saving without creating a misleading recovery point", async () => {
    const checkpointSource = vi.fn(); useWorkbenchStore.setState({ saveAllDirtyFiles: async () => { useWorkbenchStore.setState({ saveStatus: "error" }); }, persistence: { checkpointSource } });
    expect((await prepareSourceReplacement({ expectedDocumentRevision: 3 })).proceed).toBe(false); expect(checkpointSource).not.toHaveBeenCalled();
  });
  it("blocks typing that arrives while the checkpoint is being written", async () => {
    useWorkbenchStore.setState({ persistence: { checkpointSource: async () => { useWorkbenchStore.setState({ documentRevision: 4 }); } } });
    expect((await prepareSourceReplacement({ expectedDocumentRevision: 3 })).proceed).toBe(false);
  });
  it("blocks project switches and role revocation during the checkpoint", async () => {
    useWorkbenchStore.setState({ persistence: { checkpointSource: async () => { useWorkbenchStore.setState({ projectId: "different", projectRole: "viewer" }); } } });
    expect((await prepareSourceReplacement({ expectedDocumentRevision: 3 })).proceed).toBe(false);
  });
  it("surfaces checkpoint failures and refuses viewers before any save", async () => {
    useWorkbenchStore.setState({ persistence: { checkpointSource: async () => { throw new Error("Quota"); } } }); await expect(prepareSourceReplacement({ expectedDocumentRevision: 3 })).rejects.toThrow("Quota");
    useWorkbenchStore.setState({ projectRole: "viewer", saveAllDirtyFiles: vi.fn() }); expect((await prepareSourceReplacement({ expectedDocumentRevision: 3 })).proceed).toBe(false); expect(useWorkbenchStore.getState().saveAllDirtyFiles).not.toHaveBeenCalled();
  });
});
