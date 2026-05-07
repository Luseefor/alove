import { afterEach, describe, expect, it } from "vitest";
import { getEditorMode } from "./editorMode";

const originalEditorMode = process.env.NEXT_PUBLIC_EDITOR_MODE;
const originalLegacyFlag = process.env.NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR;

describe("getEditorMode", () => {
  afterEach(() => {
    if (originalEditorMode === undefined) {
      delete process.env.NEXT_PUBLIC_EDITOR_MODE;
    } else {
      process.env.NEXT_PUBLIC_EDITOR_MODE = originalEditorMode;
    }
    if (originalLegacyFlag === undefined) {
      delete process.env.NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR;
    } else {
      process.env.NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR = originalLegacyFlag;
    }
  });

  it("defaults to codemirror when no env vars are set", () => {
    delete process.env.NEXT_PUBLIC_EDITOR_MODE;
    delete process.env.NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR;
    expect(getEditorMode()).toBe("codemirror");
  });

  it("respects explicit NEXT_PUBLIC_EDITOR_MODE=codemirror", () => {
    process.env.NEXT_PUBLIC_EDITOR_MODE = "codemirror";
    process.env.NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR = "false";
    expect(getEditorMode()).toBe("codemirror");
  });

  it("respects explicit NEXT_PUBLIC_EDITOR_MODE=textarea", () => {
    process.env.NEXT_PUBLIC_EDITOR_MODE = "textarea";
    process.env.NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR = "true";
    expect(getEditorMode()).toBe("textarea");
  });

  it("uses legacy true flag for codemirror when explicit mode is unset", () => {
    delete process.env.NEXT_PUBLIC_EDITOR_MODE;
    process.env.NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR = "true";
    expect(getEditorMode()).toBe("codemirror");
  });

  it("uses legacy false flag for textarea when explicit mode is unset", () => {
    delete process.env.NEXT_PUBLIC_EDITOR_MODE;
    process.env.NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR = "false";
    expect(getEditorMode()).toBe("textarea");
  });

  it("defaults unknown NEXT_PUBLIC_EDITOR_MODE values to codemirror", () => {
    process.env.NEXT_PUBLIC_EDITOR_MODE = "unknown";
    delete process.env.NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR;
    expect(getEditorMode()).toBe("codemirror");
  });
});
