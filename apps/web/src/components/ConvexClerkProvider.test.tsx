import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConvexClerkProvider } from "@/components/ConvexClerkProvider";

// App route files use the automatic JSX runtime. Vitest compiles them as
// classic runtime, so expose React globally for these imports only.
(globalThis as unknown as { React: typeof React }).React = React;

const { mockUsePathname, mockClerkProvider, mockConvexConstructor } = vi.hoisted(
  () => ({
    mockUsePathname: vi.fn(),
    mockClerkProvider: vi.fn(),
    mockConvexConstructor: vi.fn(),
  }),
);

vi.mock("next/navigation", () => ({
  usePathname: mockUsePathname,
}));

vi.mock("@clerk/nextjs", async () => {
  const ReactModule = await import("react");
  return {
    ClerkProvider: (props: {
      children: React.ReactNode;
      publishableKey?: string;
      signInUrl?: string;
      signUpUrl?: string;
      signInFallbackRedirectUrl?: string;
      signUpFallbackRedirectUrl?: string;
    }) => {
      mockClerkProvider(props);
      return ReactModule.createElement(
        "div",
        { "data-testid": "clerk-provider" },
        props.children,
      );
    },
    useAuth: () => () => null,
  };
});

vi.mock("convex/react", () => ({
  ConvexReactClient: class {
    constructor(address: string) {
      mockConvexConstructor(address);
    }
  },
}));

vi.mock("convex/react-clerk", async () => {
  const ReactModule = await import("react");
  return {
    ConvexProviderWithClerk: ({
      children,
    }: {
      children: React.ReactNode;
    }) =>
      ReactModule.createElement(
        "div",
        { "data-testid": "convex-provider" },
        children,
      ),
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

describe("ConvexClerkProvider", () => {
  let rendered: { container: HTMLElement; root: Root } | null = null;
  const env = { ...process.env };

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.NEXT_PUBLIC_LOCAL_STANDALONE;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    mockUsePathname.mockReset();
    mockClerkProvider.mockClear();
    mockConvexConstructor.mockClear();
  });

  afterEach(() => {
    process.env = { ...env };
    if (rendered) {
      act(() => {
        rendered!.root.unmount();
      });
      rendered.container.remove();
      rendered = null;
    }
    vi.restoreAllMocks();
  });

  it("returns children without Clerk or Convex in local mode", () => {
    process.env.NEXT_PUBLIC_LOCAL_STANDALONE = "true";
    mockUsePathname.mockReturnValue("/editor");
    rendered = render(
      <ConvexClerkProvider>
        <span>local editor</span>
      </ConvexClerkProvider>,
    );
    expect(rendered.container.textContent).toContain("local editor");
    expect(mockClerkProvider).not.toHaveBeenCalled();
    expect(mockConvexConstructor).not.toHaveBeenCalled();
    expect(
      rendered.container.querySelector('[data-testid="clerk-provider"]'),
    ).toBeNull();
  });

  it("returns children without keys on a public route", () => {
    mockUsePathname.mockReturnValue("/");
    rendered = render(
      <ConvexClerkProvider>
        <span>public home</span>
      </ConvexClerkProvider>,
    );
    expect(rendered.container.textContent).toContain("public home");
    expect(mockClerkProvider).not.toHaveBeenCalled();
    expect(mockConvexConstructor).not.toHaveBeenCalled();
  });

  it("shows an accessible config error with home and help links on a protected route", () => {
    mockUsePathname.mockReturnValue("/projects");
    rendered = render(
      <ConvexClerkProvider>
        <span>protected</span>
      </ConvexClerkProvider>,
    );
    const alert = rendered.container.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert?.textContent).toContain(
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    );
    expect(
      rendered.container.querySelector('a[href="/"]'),
    ).toBeTruthy();
    expect(
      rendered.container.querySelector('a[href="/help"]'),
    ).toBeTruthy();
    expect(mockClerkProvider).not.toHaveBeenCalled();
    expect(mockConvexConstructor).not.toHaveBeenCalled();
  });

  it("mounts Clerk and Convex providers when cloud config is valid", () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_valid_key_123";
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://happy-otter-123.convex.cloud";
    mockUsePathname.mockReturnValue("/editor");
    rendered = render(
      <ConvexClerkProvider>
        <span>editor body</span>
      </ConvexClerkProvider>,
    );
    expect(
      rendered.container.querySelector('[data-testid="clerk-provider"]'),
    ).toBeTruthy();
    expect(
      rendered.container.querySelector('[data-testid="convex-provider"]'),
    ).toBeTruthy();
    expect(rendered.container.textContent).toContain("editor body");
    expect(mockConvexConstructor).toHaveBeenCalledTimes(1);
    const clerkProps = mockClerkProvider.mock.calls[0][0];
    expect(clerkProps.signInUrl).toBe("/sign-in");
    expect(clerkProps.signUpUrl).toBe("/sign-up");
    expect(clerkProps.signInFallbackRedirectUrl).toBe("/projects");
    expect(clerkProps.signUpFallbackRedirectUrl).toBe("/projects");
    expect(clerkProps.publishableKey).toBe("pk_test_valid_key_123");
    expect(String(clerkProps.publishableKey)).not.toContain("convex");
  });

  it("shows a safe error for an invalid Convex URL without throwing", () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_valid_key_123";
    process.env.NEXT_PUBLIC_CONVEX_URL = "not-a-url";
    mockUsePathname.mockReturnValue("/projects");
    expect(() => {
      rendered = render(
        <ConvexClerkProvider>
          <span>protected</span>
        </ConvexClerkProvider>,
      );
    }).not.toThrow();
    const alert = rendered!.container.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert?.textContent).toContain("NEXT_PUBLIC_CONVEX_URL");
    expect(alert?.textContent).not.toContain("not-a-url");
    expect(mockClerkProvider).not.toHaveBeenCalled();
    expect(mockConvexConstructor).not.toHaveBeenCalled();
  });
});
