import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DashboardHeader } from "./DashboardHeader";

vi.mock("./landing.module.css", () => ({ default: {} }));

vi.mock("@/lib/localStandalone", () => ({ isLocalStandalone: () => false }));
vi.mock("@/components/theme/ThemeProvider", () => ({
  useTheme: () => ({ resolved: "light", setAppearance: vi.fn() }),
}));
vi.mock("@/components/brand/BrandMark", () => ({
  BrandMark: () => React.createElement("svg"),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.PropsWithChildren<{ href: string }>) =>
    React.createElement("a", { href, ...props }, children),
}));

it("renders the public cloud header without a Clerk provider", async () => {
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  try {
    await act(async () => root.render(<DashboardHeader />));
    expect(element.querySelector('a[href="/sign-in"]')?.textContent).toBe(
      "Sign in",
    );
    expect(element.querySelector('a[href="/editor"]')?.textContent).toContain(
      "Open workspace",
    );
  } finally {
    await act(async () => root.unmount());
    element.remove();
  }
});
