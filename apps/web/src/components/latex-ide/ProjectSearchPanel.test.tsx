import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectSearchPanel } from "@/components/latex-ide/ProjectSearchPanel";
import { useWorkbenchStore } from "@/stores/workbenchStore";

function seedStore(filesByPath: Record<string, string>, role: "owner" | "editor" | "viewer" = "owner") {
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useWorkbenchStore.setState({
    projectId: "panel-test",
    projectRole: role,
    activeFileId: "main.tex",
    openFiles: ["main.tex"],
    filesByPath,
    versionsByPath: Object.fromEntries(Object.keys(filesByPath).map((p) => [p, 1])),
    dirtyByPath: Object.fromEntries(Object.keys(filesByPath).map((p) => [p, false])),
    persistence: {},
  });
}

function setInput(el: HTMLInputElement | null, value: string) {
  expect(el).toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(el!, value);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("ProjectSearchPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    seedStore({ "main.tex": "hello world\nhello again", "chapter.tex": "say hello" });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  function render() {
    act(() => {
      root.render(<ProjectSearchPanel />);
    });
  }

  function findButton(testid: string, index = 0): HTMLButtonElement {
    // Document-scoped: the confirm dialog is a Radix portal in document.body.
    const els = document.querySelectorAll(`[data-testid="${testid}"]`);
    const el = els[index] as HTMLButtonElement | undefined;
    if (!el) throw new Error(`button ${testid}[${index}] not found`);
    return el;
  }

  function findInput(testid: string): HTMLInputElement {
    const el = container.querySelector(`[data-testid="${testid}"]`) as HTMLInputElement | null;
    if (!el) throw new Error(`input ${testid} not found`);
    return el;
  }

  /** Flushes the panel's detached promise chains (replace/replace-all await
   *  the checkpoint hook). DOM assertions must run after this resolves:
   *  asserting inside the act scope would observe pre-flush DOM. */
  async function settle() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
  }

  /** The replace-all preview is a portaled Dialog: query document, not container. */
  function findDialog(testid: string): HTMLElement | null {
    return document.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;
  }

  function pressEscape() {
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
  }

  it("groups matches by file with counts and highlights hits", () => {
    render();
    setInput(findInput("project-search-input"), "hello");
    act(() => {
      findButton("project-search-find").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const count = container.querySelector('[data-testid="project-search-count"]');
    expect(count?.textContent).toContain("3 matches");
    expect(count?.textContent).toContain("2 files");
    expect(container.querySelector('[data-testid="project-search-group-main.tex"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="project-search-group-chapter.tex"]')).toBeTruthy();
    const marks = container.querySelectorAll("mark");
    expect(marks.length).toBe(3);
    expect(marks[0]?.textContent).toBe("hello");
  });

  it("navigates to the exact match offset on click", () => {
    render();
    setInput(findInput("project-search-input"), "world");
    act(() => {
      findButton("project-search-find").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      findButton("project-search-match").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const state = useWorkbenchStore.getState();
    expect(state.activeFileId).toBe("main.tex");
    // "hello world": world starts at offset 6.
    expect(state.nextSelection).toEqual({ start: 6, end: 11 });
    expect(state.focusedLine).toBe(1);
  });

  it("replaces a single match and refreshes results", async () => {
    render();
    setInput(findInput("project-search-input"), "hello");
    setInput(findInput("project-search-replace-input"), "hi");
    act(() => {
      findButton("project-search-find").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelectorAll('[data-testid="project-search-match"]').length).toBe(3);
    act(() => {
      findButton("project-search-replace-one").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    // Groups sort by path, so the first Replace targets chapter.tex.
    expect(useWorkbenchStore.getState().filesByPath["chapter.tex"]).toBe("say hi");
    expect(container.querySelector('[data-testid="project-search-count"]')?.textContent).toContain("2 matches");
  });

  it("requires preview confirmation for replace-all", async () => {
    render();
    setInput(findInput("project-search-input"), "hello");
    setInput(findInput("project-search-replace-input"), "hi");
    act(() => {
      findButton("project-search-find").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      findButton("project-search-replace-all").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(findDialog("project-search-preview")).toBeTruthy();
    expect(findDialog("project-search-preview")?.textContent).toContain("3 matches");
    act(() => {
      findButton("project-search-confirm-replace-all").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await settle();
    const state = useWorkbenchStore.getState();
    expect(state.filesByPath["main.tex"]).toBe("hi world\nhi again");
    expect(state.filesByPath["chapter.tex"]).toBe("say hi");
  });

  it("shows stale results after source edits and refuses replacement", async () => {
    render();
    setInput(findInput("project-search-input"), "hello");
    act(() => {
      findButton("project-search-find").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      useWorkbenchStore.getState().updateActiveFileContent("hello world edited");
    });
    expect(container.querySelector('[data-testid="project-search-stale"]')).toBeTruthy();
    // Stale results disable replacement; nothing may mutate.
    expect(findButton("project-search-replace-one").disabled).toBe(true);
    expect(useWorkbenchStore.getState().filesByPath["main.tex"]).toContain("edited");
    // The stale compare contract refuses at the store layer too.
    const staleRev = useWorkbenchStore.getState().documentRevision - 1;
    expect(
      useWorkbenchStore.getState().replaceAcrossFiles("hello", "hi", { expectedDocumentRevision: staleRev }),
    ).toBe(0);
    expect(useWorkbenchStore.getState().filesByPath["main.tex"]).toContain("edited");
  });

  it("disables replacement for viewers while search still works", () => {
    seedStore({ "main.tex": "hello world" }, "viewer");
    render();
    setInput(findInput("project-search-input"), "hello");
    act(() => {
      findButton("project-search-find").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelectorAll('[data-testid="project-search-match"]').length).toBe(1);
    expect((findInput("project-search-replace-input") as HTMLInputElement).disabled).toBe(true);
    expect(findButton("project-search-replace-all").disabled).toBe(true);
    expect(findButton("project-search-replace-one").disabled).toBe(true);
  });

  it("surfaces invalid regex errors", () => {
    render();
    setInput(findInput("project-search-input"), "([");
    const regex = container.querySelector('[data-testid="project-search-regex"]') as HTMLInputElement;
    act(() => {
      regex.click();
    });
    act(() => {
      findButton("project-search-find").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="project-search-error"]')).toBeTruthy();
  });

  it("only explicit false/proceed:false from the checkpoint hook aborts", async () => {
    render();
    setInput(findInput("project-search-input"), "hello");
    setInput(findInput("project-search-replace-input"), "hi");
    act(() => {
      findButton("project-search-find").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // Void hook: allowed.
    useWorkbenchStore.setState({ persistence: { prepareSourceReplacement: vi.fn(async () => {}) } });
    act(() => {
      findButton("project-search-replace-one").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(useWorkbenchStore.getState().filesByPath["chapter.tex"]).toBe("say hi");

    // Explicit false: blocked.
    act(() => {
      seedStore({ "main.tex": "hello world" });
    });
    render();
    setInput(findInput("project-search-input"), "hello");
    setInput(findInput("project-search-replace-input"), "hi");
    act(() => {
      findButton("project-search-find").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    useWorkbenchStore.setState({ persistence: { prepareSourceReplacement: vi.fn(async () => false) } });
    act(() => {
      findButton("project-search-replace-one").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(document.querySelector('[data-testid="project-search-error"]')).toBeTruthy();
    expect(useWorkbenchStore.getState().filesByPath["main.tex"]).toBe("hello world");

    // { proceed: false }: blocked.
    useWorkbenchStore.setState({
      persistence: { prepareSourceReplacement: vi.fn(async () => ({ proceed: false, message: "nope" })) },
    });
    act(() => {
      findButton("project-search-replace-one").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(document.querySelector('[data-testid="project-search-error"]')?.textContent).toContain("nope");
  });

  it("marks results stale when search options drift without re-running", () => {
    render();
    setInput(findInput("project-search-input"), "hello");
    act(() => {
      findButton("project-search-find").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.querySelector('[data-testid="project-search-stale"]')).toBeNull();
    // Narrow the options after searching: the cached results no longer match.
    const wholeWord = container.querySelector('[data-testid="project-search-whole-word"]') as HTMLInputElement;
    act(() => {
      wholeWord.click();
    });
    expect(document.querySelector('[data-testid="project-search-stale"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="project-search-stale"]')?.textContent).toMatch(/options/i);
    expect(findButton("project-search-replace-one").disabled).toBe(true);
    expect(findButton("project-search-replace-all").disabled).toBe(true);
    expect(useWorkbenchStore.getState().filesByPath["main.tex"]).toBe("hello world\nhello again");
  });

  it("surfaces store replacement failures and releases the busy guard", async () => {
    render();
    setInput(findInput("project-search-input"), "hello");
    setInput(findInput("project-search-replace-input"), "hi");
    act(() => {
      findButton("project-search-find").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const original = useWorkbenchStore.getState().replaceAcrossFiles;
    useWorkbenchStore.setState({
      replaceAcrossFiles: () => {
        throw new Error("disk is on fire");
      },
    });
    act(() => {
      findButton("project-search-replace-one").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(document.querySelector('[data-testid="project-search-error"]')?.textContent).toContain("disk is on fire");
    expect(useWorkbenchStore.getState().filesByPath["chapter.tex"]).toBe("say hello");
    // Busy guard released: the button works again after restoring the store.
    useWorkbenchStore.setState({ replaceAcrossFiles: original });
    act(() => {
      findButton("project-search-replace-one").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(useWorkbenchStore.getState().filesByPath["chapter.tex"]).toBe("say hi");
  });

  it("closes the confirm dialog on Escape without replacing", async () => {
    render();
    setInput(findInput("project-search-input"), "hello");
    setInput(findInput("project-search-replace-input"), "hi");
    act(() => {
      findButton("project-search-find").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      findButton("project-search-replace-all").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(findDialog("project-search-preview")).toBeTruthy();
    pressEscape();
    await settle();
    expect(findDialog("project-search-preview")).toBeNull();
    expect(useWorkbenchStore.getState().filesByPath["main.tex"]).toBe("hello world\nhello again");
  });

  it("blocks Escape while a replacement is running", async () => {
    render();
    setInput(findInput("project-search-input"), "hello");
    setInput(findInput("project-search-replace-input"), "hi");
    act(() => {
      findButton("project-search-find").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // A hook that never settles pins the busy guard.
    useWorkbenchStore.setState({
      persistence: { prepareSourceReplacement: () => new Promise(() => {}) },
    });
    act(() => {
      findButton("project-search-replace-all").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      findButton("project-search-confirm-replace-all").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(findButton("project-search-confirm-replace-all").disabled).toBe(true);
    pressEscape();
    await settle();
    expect(findDialog("project-search-preview")).toBeTruthy();
    expect(useWorkbenchStore.getState().filesByPath["main.tex"]).toBe("hello world\nhello again");
  });
});
