import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollCompileJob } from "@/lib/compilePoll";

const completedBody = {
  state: "completed",
  result: { phase: "ready", pdfBase64: "cGRm" },
};

function jsonResponse(body: unknown, init?: { status?: number; ok?: boolean }): Response {
  const status = init?.status ?? 200;
  const ok = init?.ok ?? (status >= 200 && status < 300);
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe("pollCompileJob", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns the completed result", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(completedBody));
    await expect(pollCompileJob("job-1")).resolves.toEqual(completedBody.result);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/compile/job-1");
  });

  it("rejects failed state with job error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ state: "failed", error: "boom" }));
    await expect(pollCompileJob("job-1")).rejects.toThrow("boom");
  });

  it("rejects non-ok status with error detail", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "E", detail: "D" }, { status: 422, ok: false }),
    );
    await expect(pollCompileJob("job-1")).rejects.toThrow("E: D");
  });

  it("does not fetch when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(pollCompileJob("job-1", controller.signal)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts during delay with no second fetch and no timer leak", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ state: "running" }));
    const controller = new AbortController();
    const pending = pollCompileJob("job-1", controller.signal);
    const assertion = expect(pending).rejects.toThrow();
    // Let the first fetch + json resolve and the delay timer arm.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    // Advancing further must not issue more requests.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("passes the same abort signal to fetch", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(completedBody));
    const controller = new AbortController();
    await pollCompileJob("job-1", controller.signal);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal);
  });

  it("URL-encodes the jobId path component", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(completedBody));
    const jobId = "a/b?c&d";
    await pollCompileJob(jobId);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/compile/${encodeURIComponent(jobId)}`);
  });
});
