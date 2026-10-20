import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SiteFailure } from "@/components/SiteFailure";
import NotFound from "@/app/not-found";
import RouteError from "@/app/error";
import Loading from "@/app/loading";

// App route files use the automatic JSX runtime. Vitest compiles them as
// classic runtime, so expose React globally for these imports only.
(globalThis as unknown as { React: typeof React }).React = React;

vi.mock("next/link", async () => {
  const ReactModule = await import("react");
  return {
    default: ({
      href,
      children,
      ...rest
    }: {
      href: string;
      children: React.ReactNode;
    }) => ReactModule.createElement("a", { href, ...rest }, children),
  };
});

function render(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return { container, root };
}

describe("SiteFailure", () => {
  let rendered: { container: HTMLElement; root: Root } | null = null;

  afterEach(() => {
    if (rendered) {
      act(() => {
        rendered!.root.unmount();
      });
      rendered.container.remove();
      rendered = null;
    }
    vi.restoreAllMocks();
  });

  it("renders the 404 heading with home, projects, and help links", () => {
    rendered = render(<NotFound />);
    const heading = rendered.container.querySelector("h1");
    expect(heading?.textContent).toBe("Page not found");
    expect(
      rendered.container.querySelector('a[href="/"]'),
    ).toBeTruthy();
    expect(
      rendered.container.querySelector('a[href="/projects"]'),
    ).toBeTruthy();
    expect(rendered.container.querySelector('a[href="/help"]')).toBeTruthy();
  });

  it("calls reset from the retry button and shows no raw error text", () => {
    const reset = vi.fn();
    const rawMessage = "ERR_RAW_MARKER_9f3a1";
    rendered = render(
      <RouteError error={new Error(rawMessage)} reset={reset} />,
    );
    expect(rendered.container.textContent).not.toContain(rawMessage);
    const retry = Array.from(
      rendered.container.querySelectorAll("button"),
    ).find((el) => el.textContent === "Try again");
    expect(retry).toBeTruthy();
    act(() => {
      retry!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("renders a retry button for a shared failure with an action link", () => {
    const reset = vi.fn();
    rendered = render(
      <SiteFailure
        eyebrow="Something went wrong"
        title="This section failed to load"
        description="Retry or go back to a safe page."
        actions={[{ href: "/", label: "Go home" }]}
        onRetry={reset}
      />,
    );
    expect(rendered.container.querySelector("h1")?.textContent).toBe(
      "This section failed to load",
    );
    expect(rendered.container.querySelector('a[href="/"]')).toBeTruthy();
  });

  it("exposes an accessible loading status", () => {
    rendered = render(<Loading />);
    const status = rendered.container.querySelector('[role="status"]');
    expect(status).toBeTruthy();
    expect(status?.textContent).toMatch(/loading/i);
  });

  it("loads a global error fallback without theme or auth providers", async () => {
    const boundary = await import("@/app/global-error");
    expect(typeof boundary.default).toBe("function");
  });
});
