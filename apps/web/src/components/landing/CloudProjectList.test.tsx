import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudProjectList } from "@/components/landing/CloudProjectList";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useConvexAuth: vi.fn(),
  useMutation: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  importSource: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("convex/react", () => ({
  useQuery: mocks.useQuery,
  useConvexAuth: mocks.useConvexAuth,
  useMutation: mocks.useMutation,
}));

vi.mock("@clerk/nextjs", async () => {
  const ReactModule = await import("react");
  return {
    UserButton: () =>
      ReactModule.createElement("div", { "data-testid": "user-button" }),
  };
});

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

function makeProjects() {
  return [
    {
      _id: "old-id",
      _creationTime: 1000,
      name: "Old Paper",
      ownerId: "alice",
      designMode: true,
      updatedAt: 1000,
    },
    {
      _id: "new id/with spaces",
      _creationTime: 2000,
      name: "New Paper",
      ownerId: "alice",
      designMode: true,
      updatedAt: 2000,
    },
  ];
}

async function flush(times = 4) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function setInputValue(input: HTMLInputElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  nativeSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("CloudProjectList", () => {
  let container: HTMLDivElement;
  let root: Root;
  let confirmSpy: { mockRestore: () => void } | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.useQuery.mockReset();
    mocks.useConvexAuth.mockReset();
    mocks.useMutation.mockReset();
    mocks.rename.mockReset();
    mocks.remove.mockReset();
    mocks.importSource.mockReset();
    mocks.push.mockReset();
    mocks.useConvexAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    mocks.useMutation.mockImplementation(
      () => async (args: unknown) => {
        if (
          args !== null &&
          typeof args === "object" &&
          "files" in (args as Record<string, unknown>)
        ) {
          return await mocks.importSource(args);
        }
        if (
          args !== null &&
          typeof args === "object" &&
          "name" in (args as Record<string, unknown>)
        ) {
          return await mocks.rename(args);
        }
        return await mocks.remove(args);
      },
    );
    mocks.rename.mockResolvedValue(undefined);
    mocks.remove.mockResolvedValue({ deletedFiles: 1 });
    mocks.importSource.mockResolvedValue("new-project-id");
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    confirmSpy?.mockRestore();
    confirmSpy = null;
    vi.restoreAllMocks();
  });

  it("skips the query until Convex auth is ready", async () => {
    mocks.useConvexAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    });
    mocks.useQuery.mockReturnValue(undefined);
    act(() => {
      root.render(<CloudProjectList />);
    });
    await flush();

    expect(mocks.useQuery).toHaveBeenCalled();
    const args = mocks.useQuery.mock.calls[0] as unknown[];
    expect(args[1]).toBe("skip");
    expect(container.textContent).toMatch(/sign in/i);
  });

  it("shows auth checking state while Convex auth loads", async () => {
    mocks.useConvexAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
    });
    mocks.useQuery.mockReturnValue(undefined);
    act(() => {
      root.render(<CloudProjectList />);
    });
    await flush();

    expect(container.textContent).toMatch(/checking sign in/i);
  });

  it("lists cloud projects sorted by updatedAt desc with encoded open links", async () => {
    mocks.useQuery.mockReturnValue(makeProjects());
    act(() => {
      root.render(<CloudProjectList />);
    });
    await flush();

    const queryArgs = mocks.useQuery.mock.calls[0] as unknown[];
    expect(queryArgs[1]).toEqual({});
    const items = Array.from(container.querySelectorAll("li"));
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("New Paper");
    expect(items[1].textContent).toContain("Old Paper");

    const openNew = container.querySelector(
      'a[aria-label="Open New Paper"]',
    ) as HTMLAnchorElement | null;
    expect(openNew).toBeTruthy();
    expect(openNew?.getAttribute("href")).toBe(
      `/editor?project=${encodeURIComponent("new id/with spaces")}`,
    );
    expect(
      container.querySelector('a[href="/editor?new=true"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('a[href="/editor?template=minimal"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('a[href="/editor?template=bib"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('a[href="/editor?sample=true"]'),
    ).toBeTruthy();
    expect(container.querySelector('[data-testid="user-button"]')).toBeTruthy();
  });

  it("shows loading state when the query is pending", async () => {
    mocks.useQuery.mockReturnValue(undefined);
    act(() => {
      root.render(<CloudProjectList />);
    });
    await flush();

    expect(container.querySelector('[role="status"]')?.textContent).toMatch(
      /loading cloud projects/i,
    );
  });

  it("shows the empty state with a new-project link", async () => {
    mocks.useQuery.mockReturnValue([]);
    act(() => {
      root.render(<CloudProjectList />);
    });
    await flush();

    expect(container.textContent).toContain("No cloud projects yet");
    expect(container.querySelector('a[href="/editor?new=true"]')).toBeTruthy();
  });

  it("filters by title search and shows no-match state", async () => {
    mocks.useQuery.mockReturnValue(makeProjects());
    act(() => {
      root.render(<CloudProjectList />);
    });
    await flush();

    const search = container.querySelector(
      "#cloud-project-search",
    ) as HTMLInputElement | null;
    expect(search).toBeTruthy();
    await act(async () => {
      setInputValue(search!, "old");
    });
    await flush();
    expect(container.textContent).toContain("Old Paper");
    expect(container.textContent).not.toContain("New Paper");

    await act(async () => {
      setInputValue(search!, "missing title xyz");
    });
    await flush();
    expect(container.textContent).toMatch(/no projects match/i);
  });

  it("renames with trimmed title through the backend mutation", async () => {
    mocks.useQuery.mockReturnValue(makeProjects());
    act(() => {
      root.render(<CloudProjectList />);
    });
    await flush();

    act(() => {
      (
        container.querySelector(
          'button[aria-label="Rename Old Paper"]',
        ) as HTMLButtonElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const input = container.querySelector("#rename-old-id") as HTMLInputElement;
    expect(input).toBeTruthy();
    await act(async () => {
      setInputValue(input, "  Renamed  ");
    });
    await act(async () => {
      (
        container.querySelector(
          'button[aria-label="Save new title for Old Paper"]',
        ) as HTMLButtonElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(mocks.rename).toHaveBeenCalledTimes(1);
    expect(mocks.rename).toHaveBeenCalledWith({
      projectId: "old-id",
      name: "Renamed",
    });
  });

  it("rejects blank rename titles without calling the backend", async () => {
    mocks.useQuery.mockReturnValue(makeProjects());
    act(() => {
      root.render(<CloudProjectList />);
    });
    await flush();

    act(() => {
      (
        container.querySelector(
          'button[aria-label="Rename Old Paper"]',
        ) as HTMLButtonElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const input = container.querySelector("#rename-old-id") as HTMLInputElement;
    await act(async () => {
      setInputValue(input, "   ");
    });
    await act(async () => {
      (
        container.querySelector(
          'button[aria-label="Save new title for Old Paper"]',
        ) as HTMLButtonElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(mocks.rename).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(
      /1 to 200/,
    );
    await act(async () => {
      (
        container.querySelector(
          '[aria-label="Dismiss error"]',
        ) as HTMLButtonElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows rename errors with retry and dismiss", async () => {
    mocks.useQuery.mockReturnValue(makeProjects());
    mocks.rename.mockRejectedValueOnce(new Error("rename boom"));
    act(() => {
      root.render(<CloudProjectList />);
    });
    await flush();

    act(() => {
      (
        container.querySelector(
          'button[aria-label="Rename Old Paper"]',
        ) as HTMLButtonElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const input = container.querySelector("#rename-old-id") as HTMLInputElement;
    await act(async () => {
      setInputValue(input, "Attempted");
    });
    await act(async () => {
      (
        container.querySelector(
          'button[aria-label="Save new title for Old Paper"]',
        ) as HTMLButtonElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "rename boom",
    );
    expect(
      Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "Retry",
      ),
    ).toBeTruthy();
    expect(
      container.querySelector('[aria-label="Dismiss error"]'),
    ).toBeTruthy();
    mocks.rename.mockResolvedValueOnce(undefined);
    await act(async () => {
      Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "Retry",
      )!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(mocks.rename).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("does not delete without confirmation", async () => {
    mocks.useQuery.mockReturnValue(makeProjects());
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    act(() => {
      root.render(<CloudProjectList />);
    });
    await flush();

    act(() => {
      (
        container.querySelector(
          'button[aria-label="Delete Old Paper"]',
        ) as HTMLButtonElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(confirmSpy).toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Old Paper");
  });

  it("deletes through the backend remove mutation after confirmation", async () => {
    mocks.useQuery.mockReturnValue(makeProjects());
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    act(() => {
      root.render(<CloudProjectList />);
    });
    await flush();

    await act(async () => {
      (
        container.querySelector(
          'button[aria-label="Delete Old Paper"]',
        ) as HTMLButtonElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith({ projectId: "old-id" });
  });

  it("keeps the list when delete fails and offers retry", async () => {
    mocks.useQuery.mockReturnValue(makeProjects());
    mocks.remove.mockRejectedValueOnce(new Error("delete failed"));
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    act(() => {
      root.render(<CloudProjectList />);
    });
    await flush();

    await act(async () => {
      (
        container.querySelector(
          'button[aria-label="Delete Old Paper"]',
        ) as HTMLButtonElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "delete failed",
    );
    expect(container.textContent).toContain("Old Paper");
    expect(container.textContent).toContain("New Paper");
  });

  it("exposes an accessible archive input and import button", async () => {
    mocks.useQuery.mockReturnValue(makeProjects());
    act(() => {
      root.render(<CloudProjectList />);
    });
    await flush();

    const input = container.querySelector(
      "#cloud-project-import",
    ) as HTMLInputElement | null;
    expect(input).toBeTruthy();
    expect(input?.getAttribute("type")).toBe("file");
    expect(input?.getAttribute("accept")).toContain(".json");
    const label = container.querySelector(
      'label[for="cloud-project-import"]',
    );
    expect(label?.textContent).toMatch(/import source archive/i);
    const button = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Import source archive",
    );
    expect(button).toBeTruthy();
    expect(button?.disabled).toBe(false);
  });

  it("imports a valid source archive through the backend and opens the editor", async () => {
    mocks.useQuery.mockReturnValue(makeProjects());
    mocks.importSource.mockResolvedValueOnce("new-project-id");
    act(() => {
      root.render(<CloudProjectList />);
    });
    await flush();

    const archive = {
      format: "alove-project",
      version: 1,
      title: "Imported Paper",
      files: { "main.tex": "hello", "notes.tex": "world" },
      mainFile: "main.tex",
    };
    const text = JSON.stringify(archive);
    const file = new File([text], "paper.alove.json", {
      type: "application/json",
    });
    Object.defineProperty(file, "text", {
      value: async () => text,
      configurable: true,
    });
    const input = container.querySelector(
      "#cloud-project-import",
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [file],
      configurable: true,
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();

    expect(mocks.importSource).toHaveBeenCalledTimes(1);
    expect(mocks.importSource).toHaveBeenCalledWith({
      name: "Imported Paper",
      mainFile: "main.tex",
      files: [
        { path: "main.tex", content: "hello" },
        { path: "notes.tex", content: "world" },
      ],
    });
    expect(mocks.push).toHaveBeenCalledWith(
      `/editor?project=${encodeURIComponent("new-project-id")}`,
    );
    expect(mocks.rename).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("rejects a malformed archive with a readable error and no backend call", async () => {
    mocks.useQuery.mockReturnValue(makeProjects());
    act(() => {
      root.render(<CloudProjectList />);
    });
    await flush();

    const text = "{not json";
    const file = new File([text], "bad.alove.json", {
      type: "application/json",
    });
    Object.defineProperty(file, "text", {
      value: async () => text,
      configurable: true,
    });
    const input = container.querySelector(
      "#cloud-project-import",
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [file],
      configurable: true,
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();

    expect(mocks.importSource).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toMatch(/invalid archive/i);
    expect(
      container.querySelector('[aria-label="Dismiss import error"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("Old Paper");
    expect(container.textContent).toContain("New Paper");
  });

  it("retries a failed cloud import and navigates on success", async () => {
    mocks.useQuery.mockReturnValue(makeProjects());
    mocks.importSource.mockRejectedValueOnce(new Error("quota exceeded"));
    act(() => {
      root.render(<CloudProjectList />);
    });
    await flush();

    const archive = {
      format: "alove-project",
      version: 1,
      title: "Retry Paper",
      files: { "main.tex": "hello" },
      mainFile: "main.tex",
    };
    const text = JSON.stringify(archive);
    const file = new File([text], "retry.alove.json", {
      type: "application/json",
    });
    Object.defineProperty(file, "text", {
      value: async () => text,
      configurable: true,
    });
    const input = container.querySelector(
      "#cloud-project-import",
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [file],
      configurable: true,
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();

    expect(mocks.importSource).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "quota exceeded",
    );
    expect(mocks.push).not.toHaveBeenCalled();
    const retry = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Retry import",
    );
    expect(retry).toBeTruthy();

    mocks.importSource.mockResolvedValueOnce("retry-project-id");
    await act(async () => {
      retry!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(mocks.importSource).toHaveBeenCalledTimes(2);
    expect(mocks.push).toHaveBeenCalledWith(
      `/editor?project=${encodeURIComponent("retry-project-id")}`,
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
