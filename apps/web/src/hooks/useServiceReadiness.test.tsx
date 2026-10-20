import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useServiceReadiness } from "@/hooks/useServiceReadiness";

// App source uses the automatic JSX runtime. Vitest compiles this file as
// classic runtime, so expose React globally for the probe below.
(globalThis as unknown as { React: typeof React }).React = React;

type Probe = {
  status: string;
  offline: boolean;
  loading: boolean;
  checks: { configuration: boolean; redis: boolean; worker: boolean } | null;
  retry: () => void;
};

let latest: Probe | null = null;

function Probe() {
  const state = useServiceReadiness();
  latest = {
    status: state.status,
    offline: state.offline,
    loading: state.loading,
    checks: state.checks,
    retry: state.retry,
  };
  return null;
}

function renderProbe() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Probe />);
  });
  return { container, root };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    value,
    configurable: true,
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("useServiceReadiness", () => {
  let rendered: { container: HTMLElement; root: Root } | null = null;

  beforeEach(() => {
    latest = null;
    setOnline(true);
    vi.useRealTimers();
  });

  afterEach(() => {
    if (rendered) {
      act(() => {
        rendered!.root.unmount();
      });
      rendered.container.remove();
      rendered = null;
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
    setOnline(true);
  });

  it("never reports ready from an HTTP error even if its JSON claims healthy checks", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: true, checks: { configuration: true, redis: true, worker: true } }, 503)));
    rendered = renderProbe();
    await flush();
    expect(latest?.status).toBe("unavailable");
  });

  it("fetches /api/ready with no-store and reports ready when all checks pass", async () => {
    const fetchMock = vi.fn(
      async (_url: unknown, _init?: { signal?: AbortSignal }) => {
        void _url; void _init;
        return jsonResponse({
          ok: true,
          checks: { configuration: true, redis: true, worker: true },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    rendered = renderProbe();
    expect(latest?.status).toBe("checking");
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0] as [
      unknown,
      { method?: string; cache?: string; signal?: AbortSignal },
    ];
    expect(firstCall[0]).toBe("/api/ready");
    expect(firstCall[1]).toMatchObject({
      method: "GET",
      cache: "no-store",
    });
    expect(firstCall[1].signal).toBeInstanceOf(AbortSignal);
    expect(latest?.status).toBe("ready");
    expect(latest?.loading).toBe(false);
    expect(latest?.offline).toBe(false);
    expect(latest?.checks).toEqual({
      configuration: true,
      redis: true,
      worker: true,
    });
  });

  it("fails closed on 503 and never reports ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            ok: false,
            checks: { configuration: true, redis: true, worker: false },
          },
          503,
        ),
      ),
    );
    rendered = renderProbe();
    await flush();
    expect(latest?.status).toBe("unavailable");
    expect(latest?.loading).toBe(false);
    expect(latest?.checks).toEqual({
      configuration: true,
      redis: true,
      worker: false,
    });
  });

  it("fails closed on malformed JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: true, checks: { redis: true } })),
    );
    rendered = renderProbe();
    await flush();
    expect(latest?.status).toBe("unavailable");
    expect(latest?.checks).toBeNull();
  });

  it("retry refetches after a failure", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        ok: false,
        checks: { configuration: false, redis: false, worker: false },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    rendered = renderProbe();
    await flush();
    expect(latest?.status).toBe("unavailable");
    fetchMock.mockImplementation(async () =>
      jsonResponse({
        ok: true,
        checks: { configuration: true, redis: true, worker: true },
      }),
    );
    act(() => {
      latest!.retry();
    });
    expect(latest?.status).toBe("checking");
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(latest?.status).toBe("ready");
  });

  it("aborts a slow response after 5 seconds and reports unavailable", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: unknown, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
      ),
    );
    rendered = renderProbe();
    await act(async () => {
      await Promise.resolve();
    });
    expect(latest?.status).toBe("checking");
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(latest?.status).toBe("unavailable");
    expect(latest?.loading).toBe(false);
  });

  it("ignores a late response after unmount", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );
    rendered = renderProbe();
    await act(async () => {
      await Promise.resolve();
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    act(() => {
      rendered!.root.unmount();
    });
    rendered.container.remove();
    rendered = null;
    await act(async () => {
      resolveFetch(
        jsonResponse({
          ok: true,
          checks: { configuration: true, redis: true, worker: true },
        }),
      );
      await Promise.resolve();
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("an older slow response does not overwrite a newer retry result", async () => {
    const resolvers: Array<(value: Response) => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolvers.push(resolve);
          }),
      ),
    );
    rendered = renderProbe();
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      latest!.retry();
    });
    await act(async () => {
      resolvers[1](
        jsonResponse({
          ok: true,
          checks: { configuration: true, redis: true, worker: true },
        }),
      );
      await Promise.resolve();
    });
    expect(latest?.status).toBe("ready");
    await act(async () => {
      resolvers[0](
        jsonResponse({
          ok: false,
          checks: { configuration: false, redis: false, worker: false },
        }),
      );
      await Promise.resolve();
    });
    expect(latest?.status).toBe("ready");
    expect(latest?.checks).toEqual({
      configuration: true,
      redis: true,
      worker: true,
    });
  });

  it("reports offline and resumes on the online event", async () => {
    setOnline(false);
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        ok: true,
        checks: { configuration: true, redis: true, worker: true },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    rendered = renderProbe();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(latest?.offline).toBe(true);
    expect(latest?.status).toBe("unavailable");
    setOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(latest?.offline).toBe(false);
    expect(latest?.status).toBe("ready");
  });
});
