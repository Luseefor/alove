import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalProjectList } from "@/components/landing/LocalProjectList";
import type { LocalProjectRepository } from "@/components/landing/LocalProjectList";

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
      id: "old-id",
      title: "Old Paper",
      mainFile: "main.tex",
      updatedAt: 1000,
      revision: 1,
      fileCount: 2,
    },
    {
      id: "new id/with spaces",
      title: "New Paper",
      mainFile: null,
      updatedAt: 2000,
      revision: 4,
      fileCount: 1,
    },
  ];
}

function makeRepo(
  overrides: Partial<Record<keyof LocalProjectRepository, unknown>> = {},
): LocalProjectRepository & {
  list: ReturnType<typeof vi.fn>;
  load: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
} {
  return {
    list: vi.fn(async () => makeProjects()),
    load: vi.fn(async () => null),
    save: vi.fn(async () => {
      throw new Error("not implemented");
    }),
    remove: vi.fn(async () => {}),
    ...(overrides as Record<string, unknown>),
  } as unknown as LocalProjectRepository & {
    list: ReturnType<typeof vi.fn>;
    load: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
}

async function flush(times = 4) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function getByText(container: HTMLElement, text: string): HTMLElement | null {
  return Array.from(container.querySelectorAll("*")).find(
    (el) => el.children.length === 0 && el.textContent === text,
  ) as HTMLElement | null;
}

describe("LocalProjectList", () => {
  let container: HTMLDivElement;
  let root: Root;
  let confirmSpy: { mockRestore: () => void } | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
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

  it("lists saved projects sorted by updatedAt desc with encoded open links", async () => {
    const repo = makeRepo();
    act(() => {
      root.render(<LocalProjectList repository={repo} />);
    });
    await flush();

    expect(repo.list).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Old Paper");
    expect(container.textContent).toContain("New Paper");
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
    const newLinks = Array.from(
      container.querySelectorAll('a[href="/editor?new=true"]'),
    );
    expect(newLinks.length).toBeGreaterThanOrEqual(1);
  });

  it("filters by title search", async () => {
    const repo = makeRepo();
    act(() => {
      root.render(<LocalProjectList repository={repo} />);
    });
    await flush();

    const search = container.querySelector(
      "#local-project-search",
    ) as HTMLInputElement | null;
    expect(search).toBeTruthy();
    // NOTE: use the prototype setter so React's value tracker sees a change.
    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeSetter?.call(search!, "old");
      search!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    expect(container.textContent).toContain("Old Paper");
    expect(container.textContent).not.toContain("New Paper");
  });

  it("renames by loading latest and saving with the current revision", async () => {
    const latest = {
      schemaVersion: 1 as const,
      id: "old-id",
      title: "Old Paper",
      files: { "main.tex": "x" },
      mainFile: "main.tex",
      activeFile: null,
      openFiles: [] as string[],
      revision: 1,
      updatedAt: 1000,
    };
    const repo = makeRepo({
      load: vi.fn(async () => latest),
      save: vi.fn(async () => ({ ...latest, title: "Renamed", revision: 2 })),
      list: vi
        .fn()
        .mockResolvedValueOnce(makeProjects())
        .mockResolvedValueOnce([
          {
            id: "old-id",
            title: "Renamed",
            mainFile: "main.tex",
            updatedAt: 3000,
            revision: 2,
            fileCount: 1,
          },
          makeProjects()[1],
        ]),
    });
    act(() => {
      root.render(<LocalProjectList repository={repo} />);
    });
    await flush();

    const renameBtn = container.querySelector(
      'button[aria-label="Rename Old Paper"]',
    ) as HTMLButtonElement | null;
    expect(renameBtn).toBeTruthy();
    act(() => {
      renameBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const input = container.querySelector(
      "#rename-old-id",
    ) as HTMLInputElement | null;
    expect(input).toBeTruthy();
    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeSetter?.call(input!, "Renamed");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const saveBtn = container.querySelector(
      'button[aria-label="Save new title for Old Paper"]',
    ) as HTMLButtonElement | null;
    expect(saveBtn).toBeTruthy();
    await act(async () => {
      saveBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flush();

    expect(repo.load).toHaveBeenCalledWith("old-id");
    expect(repo.save).toHaveBeenCalledTimes(1);
    const [savedInput, revision] = repo.save.mock.calls[0] as unknown as [
      { title: string },
      number,
    ];
    expect(savedInput.title).toBe("Renamed");
    expect(revision).toBe(1);
    expect(container.textContent).toContain("Renamed");
  });

  it("fails rename closed when the summary revision is stale", async () => {
    const repo = makeRepo({
      load: vi.fn(async () => ({
        schemaVersion: 1 as const,
        id: "old-id",
        title: "Changed Elsewhere",
        files: { "main.tex": "x" },
        mainFile: "main.tex",
        activeFile: null,
        openFiles: [] as string[],
        revision: 9,
        updatedAt: 9999,
      })),
    });
    act(() => {
      root.render(<LocalProjectList repository={repo} />);
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
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeSetter?.call(input, "Attempted");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (
        container.querySelector(
          'button[aria-label="Save new title for Old Paper"]',
        ) as HTMLButtonElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(repo.save).not.toHaveBeenCalled();
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toMatch(/changed elsewhere/i);
    expect(container.textContent).toContain("Old Paper");
    expect(container.textContent).toContain("New Paper");
  });

  it("keeps the list when rename save fails", async () => {
    const repo = makeRepo({
      load: vi.fn(async () => ({
        schemaVersion: 1 as const,
        id: "old-id",
        title: "Old Paper",
        files: { "main.tex": "x" },
        mainFile: "main.tex",
        activeFile: null,
        openFiles: [] as string[],
        revision: 1,
        updatedAt: 1000,
      })),
      save: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    act(() => {
      root.render(<LocalProjectList repository={repo} />);
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
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeSetter?.call(input, "Attempted");
      input.dispatchEvent(new Event("input", { bubbles: true }));
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
      "boom",
    );
    expect(container.textContent).toContain("Old Paper");
    expect(container.textContent).toContain("New Paper");
  });

  it("does not delete without confirmation", async () => {
    const repo = makeRepo();
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    act(() => {
      root.render(<LocalProjectList repository={repo} />);
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
    expect(repo.remove).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Old Paper");
  });

  it("deletes with the expected revision after confirmation", async () => {
    const remaining = [makeProjects()[1]];
    const repo = makeRepo({
      list: vi
        .fn()
        .mockResolvedValueOnce(makeProjects())
        .mockResolvedValueOnce(remaining),
    });
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    act(() => {
      root.render(<LocalProjectList repository={repo} />);
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

    expect(repo.remove).toHaveBeenCalledWith("old-id", 1);
    expect(container.textContent).not.toContain("Old Paper");
    expect(container.textContent).toContain("New Paper");
  });

  it("keeps the list when delete fails", async () => {
    const repo = makeRepo({
      remove: vi.fn(async () => {
        throw new Error("delete failed");
      }),
    });
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    act(() => {
      root.render(<LocalProjectList repository={repo} />);
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

  it("shows load errors with retry", async () => {
    const repo = makeRepo({
      list: vi
        .fn()
        .mockRejectedValueOnce(new Error("db down"))
        .mockResolvedValueOnce(makeProjects()),
    });
    act(() => {
      root.render(<LocalProjectList repository={repo} />);
    });
    await flush();

    expect(getByText(container, "Retry")).toBeTruthy();
    expect(container.textContent).toMatch(/could not load/i);
    await act(async () => {
      getByText(container, "Retry")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await flush();
    expect(repo.list).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Old Paper");
  });

  it("shows the empty state with a new-project link", async () => {
    const repo = makeRepo({ list: vi.fn(async () => []) });
    act(() => {
      root.render(<LocalProjectList repository={repo} />);
    });
    await flush();

    expect(container.textContent).toContain("No saved projects yet");
    expect(container.querySelector('a[href="/editor?new=true"]')).toBeTruthy();
  });
});
