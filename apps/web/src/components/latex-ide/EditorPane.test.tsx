import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LatexCodeEditorHandle,
  LatexCodeEditorProps,
} from "@/components/latex-ide/LatexCodeEditor";
import { EditorPane } from "@/components/latex-ide/EditorPane";
import { useWorkbenchStore } from "@/stores/workbenchStore";

const codeEditorRuntime = vi.hoisted(() => ({
  latestProps: null as LatexCodeEditorProps | null,
  selection: { start: 2, end: 4 },
  focus: vi.fn(),
  setSelection: vi.fn(),
  replaceRange: vi.fn(),
  runCommand: vi.fn(),
  scrollToLine: vi.fn(),
}));

vi.mock("./LatexCodeEditor", async () => {
  const ReactModule = await import("react");

  const LatexCodeEditor = ReactModule.forwardRef<
    LatexCodeEditorHandle,
    LatexCodeEditorProps
  >(function MockLatexCodeEditor(props, ref) {
    codeEditorRuntime.latestProps = props;
    ReactModule.useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          codeEditorRuntime.focus();
        },
        getValue: () => props.value,
        getSelection: () => codeEditorRuntime.selection,
        setSelection: (start, end) => {
          codeEditorRuntime.setSelection(start, end);
        },
        replaceRange: (start, end, insert) => {
          codeEditorRuntime.replaceRange(start, end, insert);
          props.onChange(`${props.value.slice(0, start)}${insert}${props.value.slice(end)}`);
        },
        runCommand: (command) => {
          codeEditorRuntime.runCommand(command);
        },
        scrollToLine: (line) => {
          codeEditorRuntime.scrollToLine(line);
        },
      }),
      [props],
    );

    return ReactModule.createElement(
      "div",
      { "data-testid": "mock-codemirror-editor" },
      props.value,
    );
  });

  return { LatexCodeEditor };
});

describe("EditorPane", () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalCodeMirrorFlag = process.env.NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR;
  const originalEditorMode = process.env.NEXT_PUBLIC_EDITOR_MODE;

  function seedStore(overrides: Partial<ReturnType<typeof useWorkbenchStore.getState>> = {}) {
    useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
    useWorkbenchStore.setState({
      projectId: "project-1",
      activeFileId: "main.tex",
      openFiles: ["main.tex"],
      filesByPath: { "main.tex": "Initial content" },
      versionsByPath: { "main.tex": 1 },
      dirtyByPath: { "main.tex": false },
      ...overrides,
    });
  }

  function clickButton(label: string) {
    const button = Array.from(container.querySelectorAll("button")).find(
      (el) => el.textContent?.trim() === label,
    );
    expect(button).toBeTruthy();
    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    seedStore();
    codeEditorRuntime.latestProps = null;
    codeEditorRuntime.selection = { start: 2, end: 4 };
    codeEditorRuntime.focus.mockReset();
    codeEditorRuntime.setSelection.mockReset();
    codeEditorRuntime.replaceRange.mockReset();
    codeEditorRuntime.runCommand.mockReset();
    codeEditorRuntime.scrollToLine.mockReset();
    delete process.env.NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR;
    delete process.env.NEXT_PUBLIC_EDITOR_MODE;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    if (originalCodeMirrorFlag === undefined) {
      delete process.env.NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR;
    } else {
      process.env.NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR = originalCodeMirrorFlag;
    }
    if (originalEditorMode === undefined) {
      delete process.env.NEXT_PUBLIC_EDITOR_MODE;
    } else {
      process.env.NEXT_PUBLIC_EDITOR_MODE = originalEditorMode;
    }
  });

  it("renders the empty editor hint when no file is active", () => {
    useWorkbenchStore.setState({
      activeFileId: null,
      openFiles: [],
      filesByPath: {},
      dirtyByPath: {},
    });

    act(() => {
      root.render(<EditorPane />);
    });

    expect(container.textContent).toContain(
      "Open a `.tex` file from the project sidebar to start editing.",
    );
  });

  it("renders CodeMirror path with initial active file content by default", () => {
    act(() => {
      root.render(<EditorPane />);
    });

    const mockEditor = container.querySelector(
      '[data-testid="mock-codemirror-editor"]',
    );
    expect(mockEditor).toBeTruthy();
    expect(mockEditor?.textContent).toContain("Initial content");
    expect(codeEditorRuntime.latestProps?.value).toBe("Initial content");
  });

  it("renders textarea fallback when NEXT_PUBLIC_EDITOR_MODE=textarea", () => {
    process.env.NEXT_PUBLIC_EDITOR_MODE = "textarea";
    act(() => {
      root.render(<EditorPane />);
    });
    expect(container.querySelector('[data-testid="mock-codemirror-editor"]')).toBeNull();
    const textarea = container.querySelector(
      '[data-testid="latex-editor-textarea"]',
    ) as HTMLTextAreaElement | null;
    expect(textarea).toBeTruthy();
    expect(textarea?.value).toContain("Initial content");
  });

  it("updates active file content and dirty state through shared update path", () => {
    act(() => {
      root.render(<EditorPane />);
    });

    act(() => {
      codeEditorRuntime.latestProps?.onChange("Updated via CodeMirror");
    });

    const state = useWorkbenchStore.getState();
    expect(state.filesByPath["main.tex"]).toBe("Updated via CodeMirror");
    expect(state.dirtyByPath["main.tex"]).toBe(true);
    expect(container.textContent).toContain("• unsaved");
  });

  it("switches files correctly in CodeMirror mode", () => {
    seedStore({
      activeFileId: "main.tex",
      openFiles: ["main.tex", "chapter.tex"],
      filesByPath: {
        "main.tex": "Main body",
        "chapter.tex": "Chapter body",
      },
      versionsByPath: {
        "main.tex": 1,
        "chapter.tex": 1,
      },
      dirtyByPath: {
        "main.tex": false,
        "chapter.tex": false,
      },
    });

    act(() => {
      root.render(<EditorPane />);
    });

    expect(codeEditorRuntime.latestProps?.value).toBe("Main body");
    clickButton("chapter.tex");
    expect(useWorkbenchStore.getState().activeFileId).toBe("chapter.tex");
    expect(codeEditorRuntime.latestProps?.value).toBe("Chapter body");
  });

  it("preserves selection and find/search integration in CodeMirror mode", () => {
    seedStore({
      filesByPath: {
        "main.tex": "alpha beta alpha",
      },
    });

    act(() => {
      root.render(<EditorPane />);
    });

    act(() => {
      useWorkbenchStore.setState({ nextSelection: { start: 1, end: 3 } });
    });
    expect(codeEditorRuntime.focus).toHaveBeenCalled();
    expect(codeEditorRuntime.setSelection).toHaveBeenCalledWith(1, 3);
    expect(useWorkbenchStore.getState().nextSelection).toBeNull();

    act(() => {
      useWorkbenchStore.setState({ findBarRequestId: 1 });
    });
    const findInput = container.querySelector(
      'input[placeholder="Find in current file..."]',
    );
    expect(findInput).toBeTruthy();
    act(() => {
      if (findInput instanceof HTMLInputElement) {
        findInput.value = "alpha";
        findInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    clickButton("Next");
    expect(codeEditorRuntime.setSelection).toHaveBeenCalled();
  });

  it("keeps compile trigger and editor command wiring intact in CodeMirror mode", () => {
    const runCompile = vi.fn(async () => {});
    seedStore({ runCompile });

    act(() => {
      root.render(<EditorPane />);
    });

    clickButton("Compile");
    expect(runCompile).toHaveBeenCalledTimes(1);

    act(() => {
      useWorkbenchStore.setState({
        editorCommand: { kind: "selectAll", nonce: 1 },
      });
    });
    expect(codeEditorRuntime.runCommand).toHaveBeenCalledWith("selectAll");
    expect(useWorkbenchStore.getState().activeSelection).toEqual({ start: 2, end: 4 });
  });
});
