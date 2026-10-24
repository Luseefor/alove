import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PdfVisualBlankPage } from "./PdfVisualBlankPage";
import { useWorkbenchStore } from "@/stores/workbenchStore";
import { parseVisualDocument } from "@alove/editor";
import type { PdfEditBridge } from "@/lib/pdfEditBridge";

const BLANK = "\\documentclass{article}\n\\begin{document}\n\\end{document}";
const BLANK_CRLF =
  "\\documentclass{article}\r\n\\begin{document}\r\n\\end{document}";
const NONBLANK =
  "\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}";

let container: HTMLDivElement;
let root: Root;

function seedStore(
  source: string = BLANK,
  overrides: Record<string, unknown> = {},
) {
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  const {
    documentRevision,
    pdfDataUrl,
    pdfSourceRevision,
    pdfMainFile,
    buildStatus,
    buildMessage,
    projectRole,
    persistence,
    runCompile,
    ...skeletonOverrides
  } = overrides as Record<string, unknown>;
  useWorkbenchStore.setState({
    projectId: "proj-1",
    mainFile: "main.tex",
    activeFileId: "main.tex",
    openFiles: ["main.tex"],
    filesByPath: { "main.tex": source },
    versionsByPath: { "main.tex": 1 },
    dirtyByPath: {},
    projectRole: "owner",
    buildStatus: "idle",
    pdfDataUrl: null,
    runCompile: vi.fn(async () => {}),
    ...skeletonOverrides,
  } as Partial<ReturnType<typeof useWorkbenchStore.getState>>);
  useWorkbenchStore.setState({
    documentRevision: 7,
    pdfDataUrl: null,
    pdfSourceRevision: null,
    ...(documentRevision !== undefined ? { documentRevision } : {}),
    ...(pdfDataUrl !== undefined ? { pdfDataUrl } : {}),
    ...(pdfSourceRevision !== undefined ? { pdfSourceRevision } : {}),
    ...(pdfMainFile !== undefined ? { pdfMainFile } : {}),
    ...(buildStatus !== undefined ? { buildStatus } : {}),
    ...(buildMessage !== undefined ? { buildMessage } : {}),
    ...(projectRole !== undefined ? { projectRole } : {}),
    ...(persistence !== undefined ? { persistence } : {}),
    ...(runCompile !== undefined ? { runCompile } : {}),
  } as Partial<ReturnType<typeof useWorkbenchStore.getState>>);
}

function makeBridge(
  source: string,
  opts: { fileId?: string | null; apply?: ReturnType<typeof vi.fn> } = {},
) {
  const apply =
    opts.apply ??
    vi.fn(() => true as boolean);
  const bridge = {
    current: {
      fileId: opts.fileId !== undefined ? opts.fileId : "main.tex",
      getValue: () => source,
      applySourcePatches: apply,
      openObjectAt: vi.fn(() => true),
    } as PdfEditBridge,
  };
  return { bridge: bridge as React.RefObject<PdfEditBridge | null>, apply };
}

function textarea(): HTMLTextAreaElement | null {
  return container.querySelector('textarea[aria-label="PDF text"]');
}

function applyButton(): HTMLButtonElement | null {
  const all = [...container.querySelectorAll("button")];
  return (
    (all.find((b) => b.textContent?.trim() === "Apply & rebuild") as HTMLButtonElement | undefined) ??
    null
  );
}

function setText(value: string) {
  const el = textarea()!;
  const proto = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!;
  act(() => {
    proto.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clickApply() {
  const btn = applyButton()!;
  await act(async () => {
    btn.click();
  });
  await act(async () => {});
}

async function renderBlank(
  bridge: React.RefObject<PdfEditBridge | null>,
) {
  await act(async () => {
    root.render(<PdfVisualBlankPage bridge={bridge} />);
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  (globalThis as unknown as Record<string, unknown>).requestAnimationFrame = (
    cb: () => void,
  ) => {
    cb();
    return 0;
  };
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("PdfVisualBlankPage", () => {
  it("renders a white paper page with serif starter input only for blank main source without a PDF", async () => {
    seedStore();
    const { bridge } = makeBridge(BLANK);
    await renderBlank(bridge);
    const box = container.querySelector(
      '[data-testid="pdf-visual-blank-page"]',
    );
    expect(box).toBeTruthy();
    const paper = box!.querySelector(".bg-white");
    expect(paper).toBeTruthy();
    const area = textarea()!;
    expect(area).toBeTruthy();
    expect(area.getAttribute("placeholder")).toBe(
      "Write your first paragraph…",
    );
    expect(area.className).toMatch(/font-serif/);
    expect(applyButton()?.textContent?.trim()).toBe("Apply & rebuild");
  });

  it("returns null when the body is not blank", async () => {
    seedStore(NONBLANK);
    const { bridge } = makeBridge(NONBLANK);
    await renderBlank(bridge);
    expect(textarea()).toBeNull();
    expect(container.textContent?.trim() ?? "").toBe("");
  });

  it("returns null when a PDF already exists", async () => {
    seedStore(BLANK, { pdfDataUrl: "data:application/pdf;base64,eA==" });
    const { bridge } = makeBridge(BLANK);
    await renderBlank(bridge);
    expect(textarea()).toBeNull();
  });

  it("returns null for viewers", async () => {
    seedStore(BLANK, { projectRole: "viewer" });
    const { bridge } = makeBridge(BLANK);
    await renderBlank(bridge);
    expect(textarea()).toBeNull();
  });

  it("returns null without a main file or source", async () => {
    seedStore(BLANK, { mainFile: null, activeFileId: null });
    const { bridge } = makeBridge(BLANK);
    await renderBlank(bridge);
    expect(textarea()).toBeNull();
  });

  it("disables Apply until there is text and while a build runs", async () => {
    seedStore();
    const { bridge } = makeBridge(BLANK);
    await renderBlank(bridge);
    expect(applyButton()?.disabled).toBe(true);
    setText("hello");
    expect(applyButton()?.disabled).toBe(false);
    act(() => {
      useWorkbenchStore.setState({ buildStatus: "running" });
    });
    expect(applyButton()?.disabled).toBe(true);
  });

  it("opens the main file once when another file is active, not on every render", async () => {
    seedStore(BLANK, {
      activeFileId: "other.tex",
      openFiles: ["other.tex"],
      filesByPath: { "main.tex": BLANK, "other.tex": "other" },
    });
    const origOpen = useWorkbenchStore.getState().openFile;
    const openSpy = vi.fn((id: string) => origOpen(id));
    useWorkbenchStore.setState({ openFile: openSpy });
    const { bridge } = makeBridge(BLANK);
    await renderBlank(bridge);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith("main.tex");
    await renderBlank(bridge);
    await act(async () => {});
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it("checkpoints before one exact-source bridge transaction then rebuilds without direct store writes", async () => {
    seedStore();
    const checkpoint = vi.fn(async () => {
      expect(apply).not.toHaveBeenCalled();
      return { proceed: true };
    });
    useWorkbenchStore.setState({
      persistence: { prepareSourceReplacement: checkpoint },
    });
    const { bridge, apply } = makeBridge(BLANK);
    const runCompile = useWorkbenchStore.getState()
      .runCompile as unknown as ReturnType<typeof vi.fn>;
    await renderBlank(bridge);
    setText("Hello world");
    await clickApply();
    const doc = parseVisualDocument(BLANK);
    expect(checkpoint).toHaveBeenCalledWith({
      query: "Start writing on PDF",
      replaceText: "",
      affectedPaths: ["main.tex"],
      expectedDocumentRevision: 7,
    });
    expect(apply).toHaveBeenCalledTimes(1);
    const [expected, patches] = apply.mock.calls[0] as unknown as [
      string,
      { from: number; to: number; insert: string }[],
    ];
    expect(expected).toBe(BLANK);
    expect(patches).toHaveLength(1);
    expect(patches[0]!.from).toBe(doc.body.from);
    expect(patches[0]!.to).toBe(doc.body.from);
    expect(patches[0]!.insert).toContain("Hello world");
    expect(runCompile).toHaveBeenCalledTimes(1);
    expect(useWorkbenchStore.getState().filesByPath["main.tex"]).toBe(BLANK);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("escapes plain text and preserves the surrounding CRLF line endings", async () => {
    seedStore(BLANK_CRLF);
    useWorkbenchStore.setState({
      persistence: { prepareSourceReplacement: vi.fn(async () => ({ proceed: true })) },
    });
    const { bridge, apply } = makeBridge(BLANK_CRLF);
    await renderBlank(bridge);
    setText("50% & a\nb");
    await clickApply();
    const [, patches] = apply.mock.calls[0] as unknown as [
      string,
      { from: number; to: number; insert: string }[],
    ];
    expect(patches[0]!.insert).toContain("\\%");
    expect(patches[0]!.insert).toContain("\\&");
    expect(patches[0]!.insert).toContain("a\r\nb");
    expect(patches[0]!.insert).not.toContain("a\nb");
  });

  it("inserts at body.from", async () => {
    seedStore();
    useWorkbenchStore.setState({
      persistence: { prepareSourceReplacement: vi.fn(async () => ({ proceed: true })) },
    });
    const { bridge, apply } = makeBridge(BLANK);
    await renderBlank(bridge);
    setText("First");
    await clickApply();
    const doc = parseVisualDocument(BLANK);
    const patch = (apply.mock.calls[0] as unknown as [unknown, { from: number; to: number }[]])[1][0]!;
    expect(patch.from).toBe(doc.body.from);
    expect(patch.to).toBe(doc.body.from);
  });

  it("keeps the draft open after checkpoint refusal and clears the inline error on edit", async () => {
    seedStore();
    useWorkbenchStore.setState({
      persistence: {
        prepareSourceReplacement: vi.fn(async () => ({
          proceed: false,
          message: "Disk full",
        })),
      },
    });
    const { bridge, apply } = makeBridge(BLANK);
    await renderBlank(bridge);
    setText("Hello");
    await clickApply();
    expect(apply).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Disk full",
    );
    setText("Hello again");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("rejects edits that arrive while a checkpoint is pending", async () => {
    seedStore();
    let finish!: (v: { proceed: boolean }) => void;
    const gate = new Promise<{ proceed: boolean }>((r) => {
      finish = r;
    });
    useWorkbenchStore.setState({
      persistence: { prepareSourceReplacement: () => gate },
    });
    const { bridge, apply } = makeBridge(BLANK);
    await renderBlank(bridge);
    setText("Hello");
    const btn = applyButton()!;
    act(() => {
      btn.click();
    });
    await act(async () => {
      useWorkbenchStore.setState({ documentRevision: 8 });
    });
    await act(async () => {
      finish({ proceed: true });
    });
    await act(async () => {});
    expect(apply).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(
      /changed/i,
    );
  });

  it("rejects project switches, viewer transitions, busy builds, and source changes after the checkpoint", async () => {
    for (const mutate of [
      () => ({ projectId: "other" }),
      () => ({ projectRole: "viewer" as const }),
      () => ({ buildStatus: "running" as const }),
      () => ({ filesByPath: { "main.tex": NONBLANK } }),
      () => ({ mainFile: "other.tex", filesByPath: { "main.tex": BLANK, "other.tex": "x" } }),
    ]) {
      seedStore();
      let finish!: (v: { proceed: boolean }) => void;
      const gate = new Promise<{ proceed: boolean }>((r) => {
        finish = r;
      });
      useWorkbenchStore.setState({
        persistence: { prepareSourceReplacement: () => gate },
      });
      const { bridge, apply } = makeBridge(BLANK);
      await renderBlank(bridge);
      setText("Hello");
      const btn = applyButton()!;
      act(() => {
        btn.click();
      });
      await act(async () => {
        useWorkbenchStore.setState(mutate() as Partial<ReturnType<typeof useWorkbenchStore.getState>>);
      });
      await act(async () => {
        finish({ proceed: true });
      });
      await act(async () => {});
      expect(apply).not.toHaveBeenCalled();
      await act(async () => {
        root.unmount();
      });
      container.innerHTML = "";
      root = createRoot(container);
    }
  });

  it("waits one frame for a late bridge without retrying the apply unchecked", async () => {
    seedStore();
    useWorkbenchStore.setState({
      persistence: { prepareSourceReplacement: vi.fn(async () => ({ proceed: true })) },
    });
    const apply = vi.fn(() => true);
    const getValue = vi
      .fn()
      .mockReturnValueOnce("stale")
      .mockReturnValue(BLANK);
    const bridge = {
      current: {
        fileId: "main.tex",
        getValue,
        applySourcePatches: apply,
        openObjectAt: vi.fn(() => true),
      } as PdfEditBridge,
    } as React.RefObject<PdfEditBridge | null>;
    const runCompile = useWorkbenchStore.getState()
      .runCompile as unknown as ReturnType<typeof vi.fn>;
    await renderBlank(bridge);
    setText("Late bridge");
    await clickApply();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(runCompile).toHaveBeenCalledTimes(1);
  });

  it("surfaces a not-ready error when the bridge never becomes ready and never applies", async () => {
    seedStore();
    useWorkbenchStore.setState({
      persistence: { prepareSourceReplacement: vi.fn(async () => ({ proceed: true })) },
    });
    const apply = vi.fn(() => true);
    const bridge = {
      current: {
        fileId: null,
        getValue: () => undefined,
        applySourcePatches: apply,
        openObjectAt: vi.fn(() => true),
      } as unknown as PdfEditBridge,
    } as React.RefObject<PdfEditBridge | null>;
    const runCompile = useWorkbenchStore.getState()
      .runCompile as unknown as ReturnType<typeof vi.fn>;
    await renderBlank(bridge);
    setText("Hello");
    await clickApply();
    expect(apply).not.toHaveBeenCalled();
    expect(runCompile).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(
      /not ready/i,
    );
  });
});
