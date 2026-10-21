import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import type { Id } from "../../../convex/_generated/dataModel";
import { CloudProjectTools } from "./CloudProjectTools";
import { useWorkbenchStore } from "@/stores/workbenchStore";
const mocks = vi.hoisted(() => ({ mutate: vi.fn(), prepare: vi.fn(), history: [] as unknown[], revision: null as unknown, reviews: { threads: [], suggestions: [] } as { threads: unknown[]; suggestions: unknown[] } }));
vi.mock("convex/react", () => ({
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) => mocks.mutate(getFunctionName(ref), args),
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    if (args === "skip") return undefined;
    switch (getFunctionName(ref)) {
      case "members:list": return { ownerId: "alice", members: [], invitations: [] };
      case "sourceHistory:list": return mocks.history;
      case "sourceHistory:get": return mocks.revision;
      case "reviews:list": return mocks.reviews;
    }
  },
}));
vi.mock("@/lib/prepareSourceReplacement", () => ({ prepareSourceReplacement: mocks.prepare }));
function click(text: string) {
  const element = [...document.querySelectorAll("button")].find(item => item.textContent?.trim() === text);
  if (!element) throw new Error(`Missing button: ${text}`);
  act(() => element.click()); return element;
}
function input(label: string, value: string) {
  const element = document.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  const prototype = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : element.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => { Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true })); });
}
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
describe("cloud history and review controls", () => {
  let root: Root; let host: HTMLDivElement;
  beforeEach(() => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
    useWorkbenchStore.setState({ projectId: "p", cloudUserId: "alice", projectRole: "editor", activeFileId: "main.tex", activeSelection: { start: 0, end: 5 }, filesByPath: { "main.tex": "hello source" }, versionsByPath: { "main.tex": 3 }, incarnationsByPath: { "main.tex": "row-a" }, documentRevision: 7, saveStatus: "saved" });
    mocks.mutate.mockReset().mockResolvedValue(undefined); mocks.prepare.mockReset().mockResolvedValue({ proceed: true }); mocks.history = []; mocks.revision = null; mocks.reviews = { threads: [], suggestions: [] };
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
  function render() { act(() => root.render(<CloudProjectTools projectId={"p" as Id<"projects">} />)); }
  it("keeps a proposed replacement out of canonical source and forwards the saved identity", async () => {
    render(); click("Review"); input("Proposed replacement", "greetings"); click("Propose tracked change"); await flush();
    expect(mocks.mutate).toHaveBeenCalledWith("reviews:suggest", { projectId: "p", path: "main.tex", from: 0, to: 5, expectedVersion: 3, expectedIncarnation: "row-a", replacement: "greetings" });
    expect(useWorkbenchStore.getState().filesByPath["main.tex"]).toBe("hello source");
  });
  it("refuses a captured selection after intervening edits", async () => {
    render(); click("Review"); input("New comment", "check this"); act(() => useWorkbenchStore.setState({ documentRevision: 8 })); click("Add comment"); await flush();
    expect(mocks.mutate).not.toHaveBeenCalled(); expect(document.body.textContent).toContain("Source changed. Capture the selection again.");
  });
  it("does not mutate history when the pre-restore save fails", async () => {
    mocks.history = [{ _id: "rev", path: "main.tex", version: 1, operation: "save", createdAt: 1, authorId: "alice" }]; mocks.revision = { _id: "rev", path: "main.tex", content: "earlier" }; mocks.prepare.mockResolvedValue({ proceed: false, message: "Checkpoint unavailable" });
    render(); click("History"); input("Saved revision", "rev"); click("Restore this file"); await flush();
    expect(mocks.mutate).not.toHaveBeenCalled(); expect(document.body.textContent).toContain("Checkpoint unavailable");
  });
  it("restores with current file CAS after saving and retains a separate preview", async () => {
    mocks.history = [{ _id: "rev", path: "main.tex", version: 1, operation: "save", createdAt: 1, authorId: "alice" }]; mocks.revision = { _id: "rev", path: "main.tex", content: "earlier" };
    render(); click("History"); input("Saved revision", "rev"); expect(document.body.textContent).toContain("hello source"); expect(document.body.textContent).toContain("earlier"); click("Restore this file"); await flush();
    expect(mocks.mutate).toHaveBeenCalledWith("sourceHistory:restore", { revisionId: "rev", expectedVersion: 3, expectedIncarnation: "row-a" });
  });
  it("offers readers review/history without write or invite controls", () => {
    useWorkbenchStore.setState({ projectRole: "viewer" }); render(); click("Review");
    expect(document.body.textContent).not.toContain("Capture editor selection"); expect(document.body.textContent).not.toContain("Propose tracked change");
  });
  it("surfaces rejected server actions without changing source", async () => {
    mocks.mutate.mockRejectedValue(new Error("Forbidden")); render(); click("Review"); input("New comment", "test"); click("Add comment"); await flush();
    expect(document.body.textContent).toContain("Forbidden"); expect(useWorkbenchStore.getState().filesByPath["main.tex"]).toBe("hello source");
  });
});
